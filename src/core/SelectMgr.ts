import { areaMap, entityMap, textMap } from "../state";
import { isDiagramVisible } from "./pages";
import type { AnyDiagram } from "../state";
import type { PositionState, Sel } from "../types";

export class SelectMgr {
	selectedRect!: Sel<SVGRectElement>;
	/** 선택된 순서대로. 직접 수정하지 말고 메소드를 사용 (selectedSet과 함께 관리) */
	selectList: AnyDiagram[] = [];
	/** 선택 여부를 O(1)로 확인 */
	private selectedSet = new Set<AnyDiagram>();
	private x1 = 0;
	private y1 = 0;
	private x2 = 0;
	private y2 = 0;

	constructor(canvas: Sel<SVGGElement>) {
		this.initialize(canvas);
	}

	initialize(canvas: Sel<SVGGElement>): void {
		this.selectedRect = canvas.append("rect")
				.attr("class","selectRect");
		this.selectList = [];
		this.selectedSet.clear();
	}

	setPosition(x1: number, y1: number, x2: number, y2: number): void {
		this.x1 = x1;
		this.y1 = y1;
		this.x2 = x2;
		this.y2 = y2;
		this.selectedRect
			.attr("x", 		Math.min(x1, x2))
			.attr("y", 		Math.min(y1, y2))
			.attr("width",  Math.abs(x2 - x1))
			.attr("height", Math.abs(y2 - y1)).attr("display", "").raise();
	}

	setEntityPosition(incX: number, incY: number): void {
		this.selectList.forEach(item => {
			item.modifyEntity(incX, incY);
		});
	}

	deselectDiagram(selectedDiagram?: AnyDiagram | null, diagramMenu?: Sel<SVGTextElement> | null): void {
		// 기존 선택 취소
		this.selectList.forEach(item => {
			item.deselectDiagram();
		});
		this._clear();
		// 선택된 하나 등록
		if (selectedDiagram) {
			selectedDiagram.selectDiagram(diagramMenu);
			this._add(selectedDiagram);
		}
	}

	private _add(item: AnyDiagram): void {
		if (this.selectedSet.has(item)) return;
		this.selectedSet.add(item);
		this.selectList.push(item);
	}
	private _clear(): void {
		this.selectList.length = 0;
		this.selectedSet.clear();
	}

	selectDiagram(): void {
		this.selectedRect.attr("display", "none");

		const selectionRect = {
			x1: Math.min(this.x1, this.x2),
			y1: Math.min(this.y1, this.y2),
			x2: Math.max(this.x1, this.x2),
			y2: Math.max(this.y1, this.y2)
		};

		for (const item of entityMap.values()) {
			if (!isDiagramVisible(item)) continue;
			if ( !(item.x1 > selectionRect.x2 ||
				   item.x2 < selectionRect.x1 ||
				   item.y1 > selectionRect.y2 ||
				   item.y2 < selectionRect.y1) ) {
				item.selectDiagram();
				this._add(item);
			}
		}
		for (const item of textMap.values()) {
			if (!isDiagramVisible(item)) continue;
			const rectData = item.getClientRect();		// DOM을 읽지 않고 저장된 크기 사용
			if ( !(rectData.x1 > selectionRect.x2 ||
				   rectData.x2 < selectionRect.x1 ||
				   rectData.y1 > selectionRect.y2 ||
				   rectData.y2 < selectionRect.y1) ) {
				item.selectDiagram();
				this._add(item);
			}
		}
		// 주제 영역은 범위 안에 완전히 들어온 경우만 (큰 배경이라 걸치기만 해도 선택되면 불편)
		for (const item of areaMap.values()) {
			if (!isDiagramVisible(item)) continue;
			if (item.x1 >= selectionRect.x1 && item.x2 <= selectionRect.x2 &&
				item.y1 >= selectionRect.y1 && item.y2 <= selectionRect.y2) {
				item.selectDiagram();
				this._add(item);
			}
		}
	}

	addSelectDiagram(selectedDiagram: AnyDiagram): void {
		if (this.selectedSet.has(selectedDiagram)) return;
		selectedDiagram.selectDiagram();
		this._add(selectedDiagram);
	}

	selectDiagramAll(): void {
		this._clear();
		for (const item of [...entityMap.values(), ...textMap.values(), ...areaMap.values()]) {
			if (!isDiagramVisible(item)) continue;
			item.selectDiagram();
			this._add(item);
		}
	}

	getSelectedDiagramState(): PositionState[] {
		return this.selectList.map(item => ({
			id: item.id,
			x1: item.x1,
			y1: item.y1,
		}));
	}

	// 선택된 dia가 리스트에 있는 것인지 확인
	isInSelectList(selectedDiagram: AnyDiagram): boolean {
		return this.selectedSet.has(selectedDiagram);
	}

	getSelectList(): AnyDiagram[] {
		return this.selectList;
	}
}
