import { DIAGRAM_TYPE, STATE_TYPE } from "../constants";
import type { DiagramType, StateType } from "../constants";
import { Area9 } from "../diagram/Area9";
import { Entity9 } from "../diagram/Entity9";
import { Relation9 } from "../diagram/Relation9";
import { Text9 } from "../diagram/Text9";
import { sqlMakerManager } from "../sql/SQLMaker";
import { areaMap, entityMap, relationMap, state, textMap } from "../state";
import type { AnyDiagram } from "../state";
import type { AreaData, DiagramSnapshot, EntityData, EntityModel, PositionState, RelationLink, RelationOption, RelationSnapshot } from "../types";
import { diagramUtil } from "../util/diagramUtil";

type RelationValues = RelationOption & { name?: string };
type DiagramData = EntityModel | AreaData | string;

/** 여러 엔터티를 한 번에 수정 (도메인/표준 일괄 적용). 실행취소 한 번으로 모두 되돌린다 */
export const MULTY_MODIFY = "mm" as const;
/** data: 수정 전, backupData: 수정 후 (ENTITY_MODIFY와 같은 규칙) */
interface ModifiedDiagram { id: string; data: DiagramData; backupData: DiagramData }

type StackData =
	| ({ workType: typeof STATE_TYPE.RELATION_MODIFY; id: string; backupData: RelationValues } & RelationValues)
	| ({ workType: typeof STATE_TYPE.RELATION_CREATE | typeof STATE_TYPE.RELATION_REMOVE } & RelationSnapshot)
	| { workType: typeof STATE_TYPE.ENTITY_MOVE; data: PositionState[] }
	| { workType: typeof STATE_TYPE.MULTY_CREATE | typeof STATE_TYPE.MULTY_REMOVE; data: (DiagramSnapshot | RelationSnapshot)[] }
	| { workType: typeof MULTY_MODIFY; data: ModifiedDiagram[] }
	| ({ workType: typeof STATE_TYPE.ENTITY_CREATE | typeof STATE_TYPE.ENTITY_REMOVE | typeof STATE_TYPE.ENTITY_MODIFY;
		 backupData?: DiagramData; relationData?: RelationLink[] } & DiagramSnapshot);

type EntityOrText = Entity9 | Text9 | Area9;

/** 자동 저장에 함께 보관하는 실행취소 기록 */
export interface StackState {
	stack: unknown[];
	index: number;
}

/** 실행취소 가능한 최대 작업 수 */
const MAX_UNDO = 100;

export class DiagramStack {
	stateStack: StackData[] = [];
	currentStateIndex = -1;
	isModified = false; // 수정 여부
	/** 변경될 때마다 증가 (자동 저장에서 변경 여부 확인용) */
	changeCount = 0;

	clearState(): void {
		this.stateStack = [];
		this.currentStateIndex = -1;
		this.isModified = false;
		this.changeCount++;
	}

	/** 실행취소 이외의 변경 (뷰, 시퀀스 등) */
	markModified(): void {
		this.isModified = true;
		this.changeCount++;
	}

	/**
	 * 자동 저장용. 복사하지 않고 현재 기록을 그대로 넘기므로 바로 직렬화하거나
	 * IndexedDB에 넣어야 한다(put이 호출 즉시 복사). 결과를 보관하거나 수정하면 안 된다.
	 */
	exportState(): StackState {
		return { stack: this.stateStack.slice(), index: this.currentStateIndex };
	}
	importState(saved: StackState | undefined): void {
		if (!saved || !Array.isArray(saved.stack) || typeof saved.index !== "number") return;
		this.stateStack = saved.stack as StackData[];
		this.currentStateIndex = Math.min(Math.max(-1, saved.index), this.stateStack.length - 1);
	}

	saveState(workType: typeof STATE_TYPE.RELATION_MODIFY, workDiagram: Relation9, backupData: RelationValues): void;
	saveState(workType: typeof STATE_TYPE.RELATION_CREATE | typeof STATE_TYPE.RELATION_REMOVE, workDiagram: Relation9): void;
	saveState(workType: typeof STATE_TYPE.ENTITY_MOVE, workDiagram: PositionState[]): void;
	saveState(workType: typeof STATE_TYPE.MULTY_CREATE | typeof STATE_TYPE.MULTY_REMOVE, workDiagram: AnyDiagram[]): void;
	saveState(workType: typeof STATE_TYPE.ENTITY_CREATE | typeof STATE_TYPE.ENTITY_REMOVE | typeof STATE_TYPE.ENTITY_MODIFY,
			  workDiagram: EntityOrText, backupData?: DiagramData): void;
	saveState(workType: StateType, workDiagram: unknown, backupData?: unknown): void {
		let data: StackData;

		if (workType===STATE_TYPE.RELATION_MODIFY){
			const relation = workDiagram as Relation9;
			data = {
				workType,
				id: relation.id,
				...(backupData as RelationValues),
				backupData: relation.getOption(),
			};
		} else
		if (workType===STATE_TYPE.RELATION_CREATE || workType===STATE_TYPE.RELATION_REMOVE){
			data = { workType, ...(workDiagram as Relation9).duplicateData() };
		} else
		if (workType===STATE_TYPE.ENTITY_MOVE){
			data = { workType, data: workDiagram as PositionState[] };
		} else
		if (workType===STATE_TYPE.MULTY_CREATE || workType===STATE_TYPE.MULTY_REMOVE){
			const diagrams = workDiagram as AnyDiagram[];
			const newDataList: (DiagramSnapshot | RelationSnapshot)[] = diagrams.map(item => item.duplicateData());
			const ids = new Set(newDataList.map(item => item.id));
			for (const item of sqlMakerManager.getUsedRelationList(diagrams)) {
				if (!ids.has(item.id)) newDataList.push( item.duplicateData() );
			}
			data = { workType, data: newDataList };
		} else {
			const diagram = workDiagram as EntityOrText;
			const entityData: StackData = { workType, ...diagram.duplicateData() };

			if (backupData) {  // 도형 수정일 경우에는 현재 정보가 백업이고, backupData가 이전 정보
				entityData.backupData = entityData.data;
				entityData.data = backupData as DiagramData;
			}
			if (workType!==STATE_TYPE.ENTITY_CREATE && diagram instanceof Entity9) {
				entityData.relationData = diagram.getRelationData();
			}
			data = entityData;
		}
		this._pushState(data);
	}

	/**
	 * 여러 엔터티를 한 번에 수정한 작업을 하나의 실행취소 단위로 저장.
	 * items: 이미 수정된 엔터티와 수정 전 데이터(backupData, 이후에 바뀌지 않는 객체)
	 */
	saveModifyGroup(items: { diagram: EntityOrText; backupData: DiagramData }[]): void {
		if (items.length === 0) return;
		const data = items.map(({ diagram, backupData }): ModifiedDiagram => ({
			id: diagram.id,
			data: backupData,
			backupData: diagram.duplicateData().data,
		}));
		this._pushState({ workType: MULTY_MODIFY, data });
	}

	private _pushState(data: StackData): void {
		this.stateStack.length = ++this.currentStateIndex;
		this.stateStack.push(data);
		// 오래된 기록은 버려 메모리 사용 제한
		if (this.stateStack.length > MAX_UNDO) {
			this.stateStack.shift();
			this.currentStateIndex--;
		}
		this.markModified();
	}

	undoState(): void {
		if (this.currentStateIndex === -1 ) return;

		const stackData = this.stateStack[this.currentStateIndex--];
		switch(stackData.workType) {
			case STATE_TYPE.RELATION_CREATE: relationMap.get(stackData.id)?.removeDiagram(); break;
			case STATE_TYPE.RELATION_REMOVE: this._createRelation(stackData, true); break;
			case STATE_TYPE.RELATION_MODIFY: relationMap.get(stackData.id)?.changeRelation(stackData); break;
			case STATE_TYPE.ENTITY_CREATE: this._getDiagram(stackData.id)?.removeDiagram(); break;
			case STATE_TYPE.ENTITY_REMOVE:
				this._createDiagram(stackData);
				for (const item of stackData.relationData ?? []) {
					this._createRelation(item);
				}
				break;
			case STATE_TYPE.ENTITY_MODIFY: this._setTableData(stackData.id, stackData.data); break;
			case STATE_TYPE.ENTITY_MOVE:
				for (const item of stackData.data) {
					const workDiagram = this._getDiagram(item.id);
					if (!workDiagram) continue;
					if (!item.x2) {  // redo를 대비해서 현재 좌표를 저장
						item.backupX = workDiagram.x1;
						item.backupY = workDiagram.y1;
					}
					workDiagram.rePosition(item.x1, item.y1);
				}
				break;
			case STATE_TYPE.MULTY_CREATE:   // MULTY_CREATE가 있는데 ENTITY_CREATE와 RELATION_CREATE 필요할까?
				for (const item of stackData.data) {
					// 관계는 entity가 삭제되면 같이 삭제 되기 때문에 stack에 관계가 있으면 undefined가 반환 될 수 있음.
					this._getDiagram(item.id, item.diagramType)?.removeDiagram();
				}
				break;
			case STATE_TYPE.MULTY_REMOVE:  // MULTY_REMOVE가 있는데 ENTITY_REMOVE와 RELATION_REMOVE 필요할까?
				this._createDiagrams(stackData.data);
				break;
			case MULTY_MODIFY:	// 수정한 순서의 반대로 되돌린다 (부모 키 변경이 자식 FK에 반영되는 경우)
				for (let i = stackData.data.length - 1; i >= 0; i--) {
					this._setTableData(stackData.data[i].id, stackData.data[i].data);
				}
				break;
		}
		this.markModified();
	}

	redoState(): void {
		if (this.currentStateIndex >= this.stateStack.length - 1) return;
		const stackData = this.stateStack[++this.currentStateIndex];

		switch(stackData.workType) {
			case STATE_TYPE.RELATION_CREATE: this._createDiagram(stackData); break;
			case STATE_TYPE.RELATION_REMOVE: relationMap.get(stackData.id)?.removeDiagram(); break;
			case STATE_TYPE.RELATION_MODIFY: relationMap.get(stackData.id)?.changeRelation(stackData.backupData); break;
			case STATE_TYPE.ENTITY_CREATE: this._createDiagram(stackData); break;
			case STATE_TYPE.ENTITY_REMOVE: this._getDiagram(stackData.id)?.removeDiagram(); break;
			case STATE_TYPE.ENTITY_MODIFY: if (stackData.backupData) this._setTableData(stackData.id, stackData.backupData); break;
			case STATE_TYPE.ENTITY_MOVE:
				for (const item of stackData.data) {
					this._getDiagram(item.id)?.rePosition(item.backupX ?? item.x1, item.backupY ?? item.y1);
				}
				break;
			case STATE_TYPE.MULTY_CREATE:
				this._createDiagrams(stackData.data);
				break;
			case STATE_TYPE.MULTY_REMOVE:
				for (const item of stackData.data) {
					this._getDiagram(item.id, item.diagramType)?.removeDiagram();
				}
				break;
			case MULTY_MODIFY:
				for (const item of stackData.data) {
					this._setTableData(item.id, item.backupData);
				}
				break;
		}
		this.markModified();
	}

	/** isSetKeys: 삭제된 관계를 되살릴 때 자식의 FK 컬럼도 다시 연결 */
	private _createRelation(item: RelationLink, isSetKeys = false): void {
		Relation9.create(state.canvas, entityMap.get(item.pid), entityMap.get(item.cid), isSetKeys, item.relationType, item.id, item);
	}

	/**
	 * 스냅샷 여러 개로 생성.
	 * 엔터티는 모두 그린 다음 크기를 한 번에 계산하고(Entity9.layoutAll), 관계는 엔터티 크기가 정해진 뒤에 만든다.
	 */
	private _createDiagrams(items: (DiagramSnapshot | RelationSnapshot)[]): void {
		const entities: Entity9[] = [];
		for (const item of items) {
			if ("pid" in item) continue;
			const diagram = this._createDiagram(item, true);
			if (diagram instanceof Entity9) entities.push(diagram);
		}
		Entity9.layoutAll(entities);
		for (const item of items) {
			if ("pid" in item) this._createRelation(item);
		}
	}

	/** 스냅샷으로 도형 생성. 스택의 데이터가 수정되지 않도록 복사해서 사용 */
	private _createDiagram(item: DiagramSnapshot | RelationSnapshot, deferLayout = false): Entity9 | void {
		const canvas = state.canvas;
		if ("pid" in item) {
			this._createRelation(item);
		} else
		if (item.diagramType===DIAGRAM_TYPE.ENTITY) {
			return new Entity9(canvas, item.x1, item.y1, item.id, diagramUtil.deepCopy(item.data as EntityData), deferLayout);
		} else
		if (item.diagramType===DIAGRAM_TYPE.AREA) {
			new Area9(canvas, item.x1, item.y1, item.id, item.data as AreaData);
		} else {
			new Text9(canvas, item.x1, item.y1, item.id, item.data as string);
		}
	}

	private _setTableData(id: string, data: DiagramData): void {
		const diagram = this._getDiagram(id);
		if (diagram instanceof Entity9) diagram.setTableData(diagramUtil.deepCopy(data as EntityData));
		else if (diagram instanceof Text9) diagram.setTableData(data as string);
		else if (diagram instanceof Area9) diagram.setTableData(data as AreaData);
	}

	private _getDiagram(id: string): EntityOrText | undefined;
	private _getDiagram(id: string, diagramType: DiagramType): AnyDiagram | undefined;
	private _getDiagram(id: string, diagramType?: DiagramType): AnyDiagram | undefined {
		if (!diagramType) return entityMap.get(id) ?? textMap.get(id) ?? areaMap.get(id);

		if (diagramType===DIAGRAM_TYPE.ENTITY) return entityMap.get(id);
		if (diagramType===DIAGRAM_TYPE.TEXT) return textMap.get(id);
		if (diagramType===DIAGRAM_TYPE.AREA) return areaMap.get(id);

		return relationMap.get(id);
	}
}
