import {
	DIAGRAM_TYPE, ENTITY_HEADER_COLOR, ENTITY_LAYOUT, RELATION_TYPE, VIEW_DATA, VIEW_MODE,
} from "../constants";
import type { RelationKind } from "../constants";
import { entityMap, state } from "../state";
import type { DiagramSnapshot, EntityData, EntityModel, FieldData, RelationLink, Sel } from "../types";
import { diagramUtil } from "../util/diagramUtil";
import { addToCurrentPage } from "../core/pages";
import { select } from "d3-selection";
import { Diagram9 } from "./Diagram9";
import { measureWidth } from "./measure";
import type { Relation9 } from "./Relation9";

const { HEADER_HEIGHT, ROW_HEIGHT, SECTION_PADDING, EMPTY_SECTION_HEIGHT, PADDING_X, BADGE_WIDTH, COLUMN_GAP, MIN_WIDTH, CORNER_RADIUS } = ENTITY_LAYOUT;

/** 내보낸 이미지에도 남는 기본 색 (화면의 다크 모드는 CSS가 덮어쓴다) */
const BORDER_COLOR = "#8c96a3";
const DIVIDER_COLOR = "#d5dbe3";
const MUTED_TEXT_COLOR = "#6b7280";
const BADGE_COLORS = { PK: "#c27803", FK: "#2f6fde", PF: "#7c3aed" } as const;

/** 컬럼 한 줄에 표시할 값: 이름, 데이터 타입, 설명 (보기 모드에 따라 없는 열은 null) */
interface FieldCells { name: string; type: string | null; extra: string | null }
type FieldFormatter = (data: FieldData) => FieldCells;
/** 이름 열이 아닌 tspan에 연결하는 데이터. FieldData를 직접 연결하지 않아 선택/찾기 표시는 이름에만 적용된다 */
interface CellDatum { field: FieldData }

/** 키 영역 또는 일반 컬럼 영역의 글자 (열마다 text 하나, 줄마다 tspan 하나) */
interface Section {
	badge: Sel<SVGTextElement>;
	name: Sel<SVGTextElement>;
	type: Sel<SVGTextElement>;
	extra: Sel<SVGTextElement>;
}

/** 컬럼 순서 변경(끌기) 중인 상태 */
interface FieldDrag {
	field: FieldData;
	isKey: boolean;
	/** 끌기 전 데이터 (실행취소) */
	backup: EntityModel;
	/** 놓을 위치 (끄는 컬럼을 뺀 표시 목록 기준) */
	target: number;
}

/** 측정한 열 폭 */
interface Measured { title: number; name: number; type: number; extra: number }

export type SetTableDataResult = "error" | "nothing" | "ok";

/** 색을 지정하지 않은 엔터티 (흰색은 지정하지 않은 것으로 본다) */
function isDefaultColor(color?: string | null): boolean {
	return !color || /^(white|#fff(fff)?)$/i.test(color);
}

/** 위쪽 모서리만 둥근 사각형 (머리글) */
function roundedTopPath(width: number, height: number, r: number): string {
	return `M0,${height} V${r} Q0,0 ${r},0 H${width - r} Q${width},0 ${width},${r} V${height} Z`;
}

export class Entity9 extends Diagram9 {
	static entityCount = 0;

	data: EntityModel;
	myParentList = new Set<Relation9>();    // i'm child   (i===this)
	myChildList = new Set<Relation9>();		// i'm parent  (i===this)
	selected = false;

	tableName!: Sel<SVGTextElement>;
	/** 키 컬럼 이름 / 일반 컬럼 이름 (FieldData가 연결된 tspan) */
	keyFieldText!: Sel<SVGTextElement>;
	fieldText!: Sel<SVGTextElement>;
	/** 엔터티 바탕 (폭 = 엔터티 폭) */
	fieldRect!: Sel<SVGRectElement>;
	private shadowRect!: Sel<SVGRectElement>;
	private headerPath!: Sel<SVGPathElement>;
	private headerLine!: Sel<SVGLineElement>;
	private dividerLine!: Sel<SVGLineElement>;
	private rowLayer!: Sel<SVGGElement>;
	private borderRect!: Sel<SVGRectElement>;
	/** 컬럼을 끌 때 놓을 위치 표시 */
	private dropLine!: Sel<SVGLineElement>;
	private fieldDrag: FieldDrag | null = null;
	private outlineRect!: Sel<SVGRectElement>;
	private keySection!: Section;
	private fieldSection!: Section;
	/** 컬럼 줄의 가운데 y (그룹 기준 좌표). 관계선을 컬럼에 연결할 때 사용 */
	private rowCenters = new Map<string, number>();
	/** 엔터티 높이 (그룹 기준) */
	private height: number = HEADER_HEIGHT + EMPTY_SECTION_HEIGHT * 2;

  /**
   * @param deferLayout true면 내용만 그리고 크기는 계산하지 않음 (엔터티마다 일어나는 강제 레이아웃 방지).
   *                    여러 엔터티를 한 번에 만들 때 사용하며, 이후 Entity9.layoutAll()로 크기를 계산해야 한다.
   */
  constructor(parent: Sel<SVGGElement>, x: number, y: number, id?: string | null, data?: EntityData, deferLayout = false) {
    super(parent, id || "er" + diagramUtil.getUniqueID(), x, y);

	const entityData = data ?? Entity9._newEntityData();
	if (!entityData.keys)   entityData.keys = [];
	if (!entityData.fields) entityData.fields = [];
	this.data = entityData as EntityModel;
	this.data.allFields = this.data.keys.concat(this.data.fields);  // allFields는 존재하는 값이 아닌 keys + fields 참조
	// 크기를 계산하기 전 기본 크기
	this.x2 = this.x1 + MIN_WIDTH;
	this.y2 = this.y1 + this.height;

	this.makeDiagram();

	if (deferLayout) {
		this._render();
		this._applyLayout(null);
	}
	else this.setData(entityData);
  }

  get diagramType() {
	return DIAGRAM_TYPE.ENTITY;
  }

  private static _newEntityData(): EntityData {
	const physicalName = "TABLE_" + (++Entity9.entityCount);
	return { keys: [], fields: [], physicalName, logicalName: physicalName };
  }

  /**
   * 그룹(g)을 transform으로 (x1, y1)에 놓고 내부 요소는 그룹 기준 좌표로 그린다. 원점은 엔터티의 왼쪽 위.
   * 이동할 때는 transform 하나만 바꾼다. (캔버스 좌표가 필요하면 x1, y1, x2, y2 사용)
   */
  makeDiagram(): void {
		// 폰트 사이즈를 지정하지 않으면 export image 실행시 문제 발생.
		this.g = state.canvas.append("g").attr("id", this.id).attr("class", "erd-entity").attr("font-size", "11px");
		this._setTransform();
		const r = CORNER_RADIUS;

		this.shadowRect = this.g.append("rect").attr("class", "erd-shadow")
			.attr("x", 1).attr("y", 2).attr("rx", r).attr("fill", "#000").attr("fill-opacity", 0.07);
		this.fieldRect = this.g.append("rect").attr("class", "erd-body")
			.attr("x", 0).attr("y", 0).attr("rx", r).attr("fill", "white");
		this.headerPath = this.g.append("path").attr("class", "erd-header");
		this.rowLayer = this.g.append("g").attr("class", "erd-rows");
		this.headerLine = this.g.append("line").attr("class", "erd-header-line").attr("x1", 0).attr("stroke", BORDER_COLOR);
		this.dividerLine = this.g.append("line").attr("class", "erd-divider").attr("x1", 0).attr("stroke", DIVIDER_COLOR);

		this.tableName = this.g.append("text").attr("class", "erd-title")
			.attr("x", PADDING_X).attr("y", 17).attr("font-size", "12px").attr("font-weight", "bold")
			.text(this.data.physicalName);

		const section = (kind: string): Section => ({
			badge: this.g.append("text").attr("class", `erd-badge erd-${kind}`).attr("font-size", "8px").attr("font-weight", "bold"),
			name:  this.g.append("text").attr("class", `erd-col-name erd-${kind}`),
			type:  this.g.append("text").attr("class", `erd-col-type erd-${kind}`).attr("fill", MUTED_TEXT_COLOR),
			extra: this.g.append("text").attr("class", `erd-col-extra erd-${kind}`).attr("fill", MUTED_TEXT_COLOR),
		});
		this.keySection = section("keys");
		this.fieldSection = section("fields");
		this.keyFieldText = this.keySection.name;
		this.fieldText = this.fieldSection.name;

		this.borderRect = this.g.append("rect").attr("class", "erd-border")
			.attr("x", 0).attr("y", 0).attr("rx", r).attr("fill", "none").attr("stroke", BORDER_COLOR).attr("stroke-width", 1);
		this.dropLine = this.g.append("line").attr("class", "erd-drop-line").attr("x1", 1).attr("visibility", "hidden");
		this.outlineRect = this.g.append("rect").attr("class", "erd-outline")
			.attr("x", -3).attr("y", -3).attr("rx", r + 3).attr("fill", "none").attr("stroke", "none");

		entityMap.set(this.id, this);
		addToCurrentPage(this);

		this.g.on("mousedown", this.ev_mousedown.bind(this));
	}
	private _setTransform(): void {
		this.g.attr("transform", `translate(${this.x1},${this.y1})`);
	}
	addParent(parentRelation: Relation9): void {
		this.myParentList.add(parentRelation);
	}
	addChild(childRelation: Relation9): void {
		this.myChildList.add(childRelation);
	}
	removeParentEntity(parentRelation: Relation9): void {
		this.myParentList.delete(parentRelation);
	}
	removeChildEntity(childRelation: Relation9): void {
		function removeFieldRelation (fields: FieldData[], id: string) {
			for (const fld of fields) {
				if (fld.parentID === id) {
					fld.parentID = null;
					fld.parent = null;
					return;
				}
			}
		}
		this.myChildList.delete(childRelation);

		const childEntity = childRelation.childEntity;
		this.data.keys.forEach(function(myFld) {
			removeFieldRelation (childEntity.data.keys, myFld.id);
			removeFieldRelation (childEntity.data.fields, myFld.id);
		});

		childEntity.changeViewMode();  // redraw
		childEntity.recalculateRelation();
	}
	hasChild(entity: Entity9): boolean {
		for (const relation of this.myParentList) {
			if (relation.hasParent(entity)) return true;
		}
		for (const relation of this.myChildList) {
			if (relation.hasChild(entity)) return true;
		}
		return false;
	}
	/**
	 * 위치 수정
	 * @param incX : X 증가값
	 * @param incY : Y 증가값
	 * @param isReRelation : rePosition()에서 recalculateRelation()를 호출해서 계산하기 때문에 2번 호출을 막기 위해 추가
	 */
	override modifyEntity(incX: number, incY: number, isReRelation?: boolean): void {
		this.x1 += incX;
		this.y1 += incY;
		this.x2 += incX;
		this.y2 += incY;

		this._setTransform();		// 내부 요소는 그룹 기준 좌표이므로 그룹만 이동

		super.selectDiagram();

		if (isReRelation) return;

		this.myParentList.forEach(function(relation) {
			relation.modifyRelationPos(RELATION_TYPE.CHILD, incX, incY );
		});
		this.myChildList.forEach(function(relation) {
			relation.modifyRelationPos(RELATION_TYPE.PARENT, incX, incY );
		});
	}
	rePosition(x: number, y: number): void {
		this.modifyEntity(x - this.x1, y - this.y1, true);
		this.recalculateRelation();
	}
	/**
	 * 관계선 다시 계산. 이 엔터티의 관계뿐 아니라 상대 엔터티의 다른 관계도 다시 계산한다
	 * (같은 변에 붙은 관계선의 연결 위치를 나눠 쓰므로 한쪽이 바뀌면 이웃의 위치도 바뀐다)
	 */
	recalculateRelation(): void {
		const relations = new Set<Relation9>();
		const add = (entity: Entity9) => {
			entity.myParentList.forEach(relation => relations.add(relation));
			entity.myChildList.forEach(relation => relations.add(relation));
		};
		add(this);
		for (const relation of [...relations]) {
			if (relation.parentEntity) add(relation.parentEntity);
			if (relation.childEntity) add(relation.childEntity);
		}
		relations.forEach(relation => relation.makeRelation(relation.parentEntity, relation.childEntity));
	}

	setData(data: EntityData): void {
		if (!data.keys)   data.keys = [];
		if (!data.fields) data.fields = [];

		data.allFields = data.keys.concat(data.fields);
		this.data = data as EntityModel;

		this._layout();

		this.recalculateRelation();
	}

	/**
	 * 여러 엔터티를 다시 그리고 크기 계산.
	 * 모두 그린 다음(쓰기) 모두 측정하고(읽기) 크기를 반영해서, 엔터티마다 강제 레이아웃이 일어나지 않게 한다.
	 * 관계선은 다시 계산하지 않으므로 필요하면 호출한 곳에서 계산.
	 */
	static layoutAll(entities: Iterable<Entity9>): void {
		const list = [...entities].filter(entity => entity.data);
		for (const entity of list) entity._render();
		const measured = list.map(entity => entity._measure());
		list.forEach((entity, i) => entity._applyLayout(measured[i]));
	}

	/** 다시 그리고 크기 계산 (한 엔터티) */
	private _layout(): void {
		this._render();
		this._applyLayout(this._measure());
	}

	/** 이름 열의 x (PK/FK 표시 열이 있으면 그만큼 오른쪽) */
	private nameX: number = PADDING_X;

	/** 내용을 다시 그림. DOM 쓰기만 하고 크기는 측정하지 않는다 */
	private _render(): void {
		const custom = !isDefaultColor(this.data.color);
		this.headerPath.attr("fill", custom ? this.data.color! : ENTITY_HEADER_COLOR).classed("erd-header--default", !custom);
		this.tableName.classed("erd-title--oncolor", custom);

		const format = this._getDataFunction(this.data);
		this.rowCenters.clear();

		// 엔터티 보기: 머리글(테이블 이름)만
		if (state.viewData === VIEW_DATA.ENTITY) {
			this._renderSection(this.keySection, [], HEADER_HEIGHT, format, true);
			this._renderSection(this.fieldSection, [], HEADER_HEIGHT, format, false);
			this._renderRows([]);
			this.headerLine.attr("visibility", "hidden");
			this.dividerLine.attr("visibility", "hidden");
			this.height = HEADER_HEIGHT;
			return;
		}

		const keys = this.data.keys;
		const fields = this._displayFields();
		this.nameX = PADDING_X + (keys.length > 0 || fields.some(field => field.parentID) ? BADGE_WIDTH : 0);

		const keyHeight = this._renderSection(this.keySection, keys, HEADER_HEIGHT, format, true);
		const fieldTop = HEADER_HEIGHT + keyHeight;
		const fieldHeight = this._renderSection(this.fieldSection, fields, fieldTop, format, false);
		this.height = fieldTop + fieldHeight;

		this._renderRows(keys.concat(fields));
		this.headerLine.attr("visibility", null).attr("y1", HEADER_HEIGHT).attr("y2", HEADER_HEIGHT);
		this.dividerLine.attr("visibility", null).attr("y1", fieldTop).attr("y2", fieldTop);
	}

	/**
	 * 컬럼 목록을 열(표시, 이름, 타입, 설명)마다 tspan으로 표시하고 영역 높이를 돌려준다.
	 * 이름 tspan은 컬럼 id로 연결해서 다시 사용 (선택 표시 유지)
	 */
	private _renderSection(section: Section, fields: FieldData[], top: number, format: FieldFormatter, isKey: boolean): number {
		const rowTop = (i: number) => top + SECTION_PADDING + i * ROW_HEIGHT;
		const baseline = (i: number) => rowTop(i) + 14;
		const cells = fields.map(format);
		fields.forEach((field, i) => this.rowCenters.set(field.id, rowTop(i) + ROW_HEIGHT / 2));

		section.name.selectAll<SVGTSpanElement, FieldData>("tspan")
			.data(fields, function(d) { return d.id; })
			.join("tspan")
			.order()
			.attr("id", function(d) { return d.id; })
			.attr("x", this.nameX)
			.attr("y", (_d, i) => baseline(i))
			.attr("font-weight", d => isKey || d.notNull ? "bold" : null)
			.text((_d, i) => cells[i].name);

		const cellSpans = (text: Sel<SVGTextElement>, value: (i: number) => string | null) =>
			text.selectAll<SVGTSpanElement, CellDatum>("tspan")
				.data(fields.map(field => ({ field })), function(d) { return d.field.id; })
				.join("tspan")
				.order()
				// 측정 전에는 모두 x=0 (getBBox 폭에 이전 위치가 섞이지 않게). 실제 위치는 _applyLayout
				.attr("x", 0)
				.attr("y", (_d, i) => baseline(i))
				.text((_d, i) => value(i) ?? "");

		cellSpans(section.type,  i => cells[i].type);
		cellSpans(section.extra, i => cells[i].extra);
		cellSpans(section.badge, i => Entity9._badge(fields[i], isKey))
			.attr("x", PADDING_X)
			.attr("y", (_d, i) => baseline(i) - 1)
			.attr("fill", d => {
				const badge = Entity9._badge(d.field, isKey);
				return badge ? BADGE_COLORS[badge] : null;
			})
			.attr("class", d => Entity9._badge(d.field, isKey) ? `erd-badge-${Entity9._badge(d.field, isKey)!.toLowerCase()}` : null);

		return fields.length ? SECTION_PADDING * 2 + fields.length * ROW_HEIGHT : EMPTY_SECTION_HEIGHT;
	}

	/** PK / FK / PF(PK이면서 FK) 표시 */
	private static _badge(field: FieldData, isKey: boolean): keyof typeof BADGE_COLORS | null {
		const pk = isKey || !!field.isPK;
		if (pk && field.parentID) return "PF";
		if (pk) return "PK";
		return field.parentID ? "FK" : null;
	}

	/** 마우스를 올린 컬럼 줄을 강조하는 사각형 (CSS :hover) */
	private _renderRows(fields: FieldData[]): void {
		this.rowLayer.selectAll<SVGRectElement, FieldData>("rect")
			.data(fields, function(d) { return d.id; })
			.join("rect")
			.attr("class", "erd-row")
			.attr("x", 1)
			.attr("y", d => (this.rowCenters.get(d.id) ?? 0) - ROW_HEIGHT / 2)
			.attr("height", ROW_HEIGHT)
			.attr("fill", "transparent");
	}

	/**
	 * 열 폭 측정 (DOM 읽기만 함).
	 * 사각형이 아니라 글자(text)의 폭으로 계산하므로 저장할 때마다 커지지 않고 줄어들 수도 있으며,
	 * getBBox()는 사용자 좌표이므로 확대/축소와 무관하다.
	 */
	private _measure(): Measured {
		const title = measureWidth(this.tableName.node());
		if (state.viewData === VIEW_DATA.ENTITY) return { title, name: 0, type: 0, extra: 0 };
		const width = (column: keyof Section) => Math.max(measureWidth(this.keySection[column].node()), measureWidth(this.fieldSection[column].node()));
		return { title, name: width("name"), type: width("type"), extra: width("extra") };
	}

	/** 측정한 폭으로 열 위치와 엔터티 크기를 정한다 (DOM 쓰기만 함). null이면 측정 전 기본 크기 */
	private _applyLayout(measured: Measured | null): void {
		const titleWidth = Math.round((measured?.title ?? 0) + PADDING_X * 2);
		let width: number;
		if (state.viewData === VIEW_DATA.ENTITY) {
			width = measured ? titleWidth : MIN_WIDTH;
		} else {
			let right = this.nameX + Math.ceil(measured?.name ?? 0);
			const typeX = right + COLUMN_GAP;
			if (measured && measured.type > 0) right = typeX + Math.ceil(measured.type);
			const extraX = right + COLUMN_GAP;
			if (measured && measured.extra > 0) right = extraX + Math.ceil(measured.extra);
			for (const section of [this.keySection, this.fieldSection]) {
				section.type.selectAll("tspan").attr("x", typeX);
				section.extra.selectAll("tspan").attr("x", extraX);
			}
			width = Math.max(MIN_WIDTH, Math.round(right + PADDING_X), titleWidth);
		}

		const height = this.height;
		this.x2 = this.x1 + width;
		this.y2 = this.y1 + height;

		for (const rect of [this.shadowRect, this.fieldRect, this.borderRect]) rect.attr("width", width).attr("height", height);
		this.outlineRect.attr("width", width + 6).attr("height", height + 6);
		this.headerPath.attr("d", roundedTopPath(width, HEADER_HEIGHT, CORNER_RADIUS));
		this.headerLine.attr("x2", width);
		this.dividerLine.attr("x2", width);
		this.rowLayer.selectAll("rect").attr("width", Math.max(0, width - 2));
		this.dropLine.attr("x2", width - 1);
	}

	/**
	 * 컬럼 줄(.erd-row)을 누른 경우 컬럼 순서 변경을 시작한다. 시작했으면 true.
	 * 키는 키끼리, 일반 컬럼은 일반 컬럼끼리만 옮긴다.
	 */
	startFieldDrag(target: EventTarget | null): boolean {
		if (!(target instanceof SVGRectElement) || !target.classList.contains("erd-row")) return false;
		const field = select<SVGRectElement, FieldData>(target).datum();
		if (!field) return false;
		const isKey = this.data.keys.includes(field);
		if (!isKey && !this.data.fields.includes(field)) return false;

		const shown = this._dragList(isKey);
		this.fieldDrag = { field, isKey, backup: diagramUtil.deepCopy(this.data), target: shown.indexOf(field) };
		select(target).classed("erd-row--dragging", true);
		return true;
	}

	/** 끄는 중: 마우스 y(캔버스 좌표)로 놓을 위치를 정하고 표시 */
	dragFieldTo(canvasY: number): void {
		const drag = this.fieldDrag;
		if (!drag) return;
		const y = canvasY - this.y1;
		const others = this._dragList(drag.isKey).filter(fld => fld !== drag.field);
		drag.target = others.filter(fld => (this.rowCenters.get(fld.id) ?? 0) < y).length;

		// 놓을 위치 바로 뒤 컬럼의 위쪽, 맨 끝이면 마지막 컬럼의 아래쪽
		const half = ROW_HEIGHT / 2;
		const lineY = drag.target < others.length
			? (this.rowCenters.get(others[drag.target].id) ?? 0) - half
			: (this.rowCenters.get((others[others.length - 1] ?? drag.field).id) ?? 0) + half;
		this.dropLine.attr("y1", lineY).attr("y2", lineY).attr("visibility", null);
	}

	/** 끌기 끝. 순서가 바뀌었으면 끌기 전 데이터(실행취소용)를 돌려준다 */
	endFieldDrag(): EntityModel | null {
		const drag = this.fieldDrag;
		this.fieldDrag = null;
		this.dropLine.attr("visibility", "hidden");
		this.rowLayer.selectAll(".erd-row--dragging").classed("erd-row--dragging", false);
		if (!drag) return null;

		const list = drag.isKey ? this.data.keys : this.data.fields;
		const others = this._dragList(drag.isKey).filter(fld => fld !== drag.field);
		const before = list.indexOf(drag.field);
		list.splice(before, 1);
		// KEYS 보기에서 숨겨진 컬럼이 있어도 표시된 컬럼 기준으로 끼워 넣는다
		let at: number;
		if (drag.target < others.length) at = list.indexOf(others[drag.target]);
		else at = others.length ? list.indexOf(others[others.length - 1]) + 1 : list.length;
		list.splice(at, 0, drag.field);
		if (at === before) return null;

		this.setData(this.data);
		return drag.backup;
	}

	/** 끌 수 있는 (화면에 표시된) 컬럼 목록 */
	private _dragList(isKey: boolean): FieldData[] {
		return isKey ? this.data.keys : this._displayFields();
	}

	/** 컬럼 줄의 가운데 y (캔버스 좌표). 화면에 표시되지 않은 컬럼이면 null */
	getFieldAnchorY(fieldId: string): number | null {
		const y = this.rowCenters.get(fieldId);
		return y === undefined ? null : this.y1 + y;
	}

	private _getDataFunction(data: EntityData): FieldFormatter {
		if (state.viewMode === VIEW_MODE.LOGICAL) {
			this.tableName.text(data.logicalName ? data.logicalName : data.physicalName);
			return Entity9.showLogical;
		}
		if (state.viewMode === VIEW_MODE.MIXED) {
			this.tableName.text(data.logicalName ? `${data.physicalName} (${data.logicalName})` : data.physicalName);
			return Entity9.showMixed;
		}
		this.tableName.text(data.physicalName);
		return Entity9.showPhysical;
	}

	/** 화면에 표시할 일반 컬럼. KEYS 보기에서는 FK인 항목만 */
	private _displayFields(): FieldData[] {
		return state.viewData === VIEW_DATA.ALL
			? this.data.fields
			: this.data.fields.filter(function(d) { return d.parent; });
	}

	setTableData (data: EntityData, isModifiedKey?: boolean): SetTableDataResult {
		// 테이블 명이 수정되면 중복 확인
		let isModifiedTableName = false;
		if (data.physicalName!==this.data.physicalName) {
			for (const value of entityMap.values()) {
				if (data.physicalName===value.data.physicalName) {
					alert ("there are same table name : " + data.physicalName);
					return "error";
			    }
			}
			isModifiedTableName = true;
		} else {
			isModifiedTableName = data.logicalName!==this.data.logicalName;
		}

		// check modified key field
		if (!isModifiedKey) isModifiedKey = this._checkModified (this.data.keys, data.keys);
		const isModifiedField = this._checkModified (this.data.fields, data.fields);
		// 인덱스, CHECK 제약, 색상
		const isModifiedExtra = JSON.stringify(this.data.indexes ?? []) !== JSON.stringify(data.indexes ?? []) ||
								JSON.stringify(this.data.checks ?? []) !== JSON.stringify(data.checks ?? []) ||
								this.data.color !== data.color;

		// nothing modify
		if (!isModifiedKey && !isModifiedField && !isModifiedTableName && !isModifiedExtra) return "nothing";

		// 테이블명이 바뀌면 자식의 FK 컬럼이 가리키는 부모 이름도 변경
		const oldName = this.data.physicalName;
		if (data.physicalName !== oldName) {
			this.myChildList.forEach(function(relation) {
				for (const fld of relation.childEntity.data.allFields) {
					if (fld.parent === oldName) fld.parent = data.physicalName;
				}
			});
			// 자기참조 FK (자신의 이전 데이터가 아닌 새 데이터에 반영)
			for (const fld of data.keys.concat(data.fields)) {
				if (fld.parent === oldName) fld.parent = data.physicalName;
			}
		}

		// update field infomaion
		this.setData(data) ;

		// update key field of Child Entity
		if (!isModifiedKey) return "ok";

		this.myChildList.forEach((relation) => {
			// 자기참조는 다시 자신의 setTableData를 호출하면 끝나지 않으므로 따로 처리
			if (relation.isSelf) this._updateSelfFK();
			else relation.childEntity.updateFKField(relation.relationType, relation.parentEntity.data.physicalName, data.keys);
		});
		return "ok";
	}

	/** 자기참조 관계의 FK 컬럼 이름 (PARENT_컬럼, 같은 이름이 있으면 번호 추가) */
	private _selfFKName(column: string): string {
		let name = "PARENT_" + column;
		while (this.getMyField(name)) name = diagramUtil.getUniqueValue(name);
		return name;
	}
	private _newSelfFK(keyFld: FieldData): FieldData {
		const fld = diagramUtil.copyNewFK(keyFld, this.data.physicalName);
		fld.column = this._selfFKName(keyFld.column);
		if (keyFld.comment) fld.comment = (/[가-힣]/.test(keyFld.comment) ? "상위 " : "Parent ") + keyFld.comment;
		// 최상위 행은 부모가 없으므로 NULL 허용
		delete fld.notNull;
		delete fld.ai;
		delete fld.uniqueKey;
		delete fld.defaultValue;
		return fld;
	}

	/** 자기참조 관계 생성: 자신의 키를 일반 컬럼(FK)으로 추가 */
	addSelfFK(): void {
		for (const keyFld of this.data.keys) {
			this.data.fields.push(this._newSelfFK(keyFld));
			this.data.allFields = this.data.keys.concat(this.data.fields);
		}
		this.setData(this.data);
	}

	/** 키가 바뀌면 자기참조 FK 컬럼 갱신. 컬럼명은 부모 키와 다르므로 유지하고 데이터 타입만 맞춘다 */
	private _updateSelfFK(): void {
		const keys = this.data.keys;
		const name = this.data.physicalName;
		for (const keyFld of keys) {
			const myFld = this.data.allFields.find(fld => fld.parentID === keyFld.id);
			if (myFld) {
				myFld.dataType = keyFld.dataType;
			} else {
				this.data.fields.push(this._newSelfFK(keyFld));
				this.data.allFields = this.data.keys.concat(this.data.fields);
			}
		}
		const isKept = (myFld: FieldData) => myFld.parent !== name || keys.some(key => key.id === myFld.parentID);
		this.data.fields = this.data.fields.filter(isKept);
		this.setData(this.data);
	}

	updateFKField(relationType: RelationKind, parentName: string, parentKeys: FieldData[]): void {
		// update or add key
		for (const parentFld of parentKeys) {
			let chk = false;
			for (const myFld of this.data.allFields) {
				chk = myFld.parentID === parentFld.id;
				if (chk) { // modify
					myFld.column   = parentFld.column;
					myFld.comment  = parentFld.comment;
					myFld.dataType = parentFld.dataType;
					myFld.defaultValue = parentFld.defaultValue;
					myFld.notNull = parentFld.notNull;
					if (parentFld.domain) myFld.domain = parentFld.domain;
					else delete myFld.domain;
					break;
				}
			}
			// If it's not, add.
			if (!chk) {
				// check once more with column name
				chk = this.data.allFields.some(myFld => myFld.column === parentFld.column);
				if (!chk) {
					if (relationType===DIAGRAM_TYPE.RELATION_PK)
						 this.data.keys.push( { ...diagramUtil.copyNewFK(parentFld, parentName), isPK: true } );
					else this.data.fields.push( diagramUtil.copyNewFK(parentFld, parentName) );
				}
			}
		}
		// If it has been deleted from the parent(if not there), delete
		const isKept = (myFld: FieldData) => myFld.parent !== parentName || parentKeys.some(key => key.id === myFld.parentID);
		this.data.keys   = this.data.keys.filter(isKept);
		this.data.fields = this.data.fields.filter(isKept);

		this.setTableData (this.data, true) ;
	}

	// 같은 위치의 컬럼끼리 비교
	private _checkModified (data1: FieldData[], data2: FieldData[]): boolean {
		if (data1.length !== data2.length) return true;

		return data1.some((field1, inx) => {
			const field2 = data2[inx];
			return field1.column !== field2.column || field1.comment !== field2.comment || field1.dataType !== field2.dataType ||
				   field1.defaultValue !== field2.defaultValue || !!field1.notNull !== !!field2.notNull ||
				   !!field1.uniqueKey !== !!field2.uniqueKey || !!field1.ai !== !!field2.ai || field1.domain !== field2.domain;
		});
	}

	// copy from parent's keys
	setRelationData(parentData: EntityData, relationType: RelationKind): RelationKind {
		if (!parentData.keys || parentData.keys.length===0) return relationType;

		const addedKeys: FieldData[] = [];
		let isPK = false;

		parentData.keys.forEach((keyFld) => {
			const field = this.getMyField(keyFld.column);
			if (!field) { // If not, add as FK
				addedKeys.push( diagramUtil.copyNewFK(keyFld, parentData.physicalName) );
			} else
			if (!field.parent) { // If there is, but no parent, specify a parent
				field.parent = parentData.physicalName;
				field.parentID = keyFld.id;
				if (!isPK && field.isPK) isPK = true;
			}
		});

		// 식별 관계로 요청했거나, 자식에 이미 있는 같은 컬럼이 PK이면 식별 관계
		if (isPK) relationType = DIAGRAM_TYPE.RELATION_PK;

		if (relationType === DIAGRAM_TYPE.RELATION_PK)
			 this.data.keys   = this.data.keys.concat(addedKeys.map(fld => ({ ...fld, isPK: true })));
		else this.data.fields = this.data.fields.concat(addedKeys);

		this.setData(this.data);

		return relationType;
	}

	getRelationData(): RelationLink[] {
		const relaionData: RelationLink[] = [];
		const toLink = (relation: Relation9): RelationLink => {
			const { diagramType: _diagramType, ...link } = relation.duplicateData();
			return link;
		};
		this.myParentList.forEach(relation => relaionData.push(toLink(relation)));
		this.myChildList.forEach(relation => {
			if (!relation.isSelf) relaionData.push(toLink(relation));	// 자기참조는 myParentList에서 추가됨
		});
		return relaionData;
	}

	getMyField(columnName: string): FieldData | null {
		const upper = columnName.toUpperCase();
		return this.data.allFields.find(field => field.column === columnName) ??
			   this.data.allFields.find(field => field.column.toUpperCase() === upper) ?? null;
	}

	setMyField(columnName: string, parent: string, id: string): FieldData | null {
		const field = this.getMyField(columnName);
		if (!field) return null;
		field.parent = parent;
		field.parentID = id;
		return field;
	}

	/** 보기 모드(논리/물리) 변경 후 다시 그림. 관계선은 다시 계산하지 않음 (여러 엔터티는 Entity9.layoutAll) */
	changeViewMode(): void {
		if (!this.data) return;
		this._layout();
	}

	/** 보기 데이터(전체/키/엔터티) 변경 후 다시 그림. 관계선은 다시 계산하지 않음 (여러 엔터티는 Entity9.layoutAll) */
	changeViewData(): void {
		if (!this.data) return;
		this._layout();
	}

	/** DBMS 변경에 따라 데이터 타입만 변환하고 다시 그리지는 않음. 타입이 보여서 다시 그려야 하면 true */
	convertDataTypes(convert: (dataType: string, field: FieldData) => string): boolean {
		if (!this.data || !this.data.allFields) return false;

		this.data.allFields.forEach(function(myFld) {
			myFld.dataType = convert(myFld.dataType, myFld);
		});
		return state.viewMode !== VIEW_MODE.LOGICAL;
	}

	static showLogical(data: FieldData): FieldCells {
		return { name: data.comment ? data.comment : data.column, type: null, extra: null };
	}
	static showPhysical(data: FieldData): FieldCells {
		const dataType = data.dataType.length < 21 ? data.dataType : data.dataType.substring(0, 20) + "…";
		return { name: data.column, type: dataType, extra: null };
	}
	static showMixed(data: FieldData): FieldCells {
		return { ...Entity9.showPhysical(data), extra: data.comment || null };
	}

	override selectDiagram(diagramMenu?: Sel<SVGTextElement> | null): void {
		super.selectDiagram(diagramMenu);
		this.borderRect.classed("selectedEntity", true);
		this.outlineRect.classed("selectedEntity", true);

		this.selected = true;
		if (!diagramMenu) return;

		for (const relation of this.myParentList) {
			relation.selectDiagram(null, "parent");
		}
		for (const relation of this.myChildList) {
			relation.selectDiagram(null, "child");
		}
	}

	override deselectDiagram(): void {
		super.deselectDiagram();
		this.borderRect.classed("selectedEntity", false);
		this.outlineRect.classed("selectedEntity", false);
		this.deselectChildField ();

		if (!this.selected) return;
		this.selected = false;

		for (const relation of this.myParentList) {
			relation.deselectDiagram();
		}
		for (const relation of this.myChildList) {
			relation.deselectDiagram();
		}
	}

	removeDiagram(): void {
		this.deselectDiagram();
		this.g.remove();
		entityMap.delete (this.id);

		for (const relation of this.myParentList) {
			relation.removeDiagram();
		}
		for (const relation of this.myChildList) {
			relation.removeDiagram();
		}
	}

	/** 부모 키(keys)를 참조하는 컬럼(FK) 표시. tspan에 연결된 컬럼 데이터(parentID)로 찾는다 */
	selectChildField (keys: FieldData[], role?: "parent" | "child"): void {
		if (keys.length === 0) return;
		const keyIds = new Set(keys.map(key => key.id));
		const cls = role ? `selectedField ${role}Relation` : "selectedField";

		this.g.selectAll<SVGTSpanElement, FieldData | undefined>("tspan")
			.filter(function(d) { return !!d?.parentID && keyIds.has(d.parentID); })
			.classed(cls, true);
	}
	deselectChildField (): void {
		this.g.selectAll("text").selectAll("tspan.selectedField").classed("selectedField parentRelation childRelation", false);
	}

	getRelationFields(parentEntity: Entity9): { childFields: string; parentFields: string } {
		const childFields: string[] = [];
		const parentFields: string[] = [];
		for (const fld of this.data.allFields) {
			if (fld.parent===parentEntity.data.physicalName) {
				const parent = this._getRelationFields(parentEntity, fld.parentID);
				if (!parent) {
					console.error(`no parent ${parentEntity.data.physicalName}-${fld.column}`);
					continue;
				}
				childFields.push(fld.column);
				parentFields.push(parent);
			}
		}
		return {childFields:childFields.toString(), parentFields:parentFields.toString()};
	}
	private _getRelationFields(parentEntity: Entity9, parentID?: string | null): string | null {
		return parentEntity.data.allFields.find(fld => fld.id===parentID)?.column ?? null;
	}

	duplicateData(): DiagramSnapshot {
		return {
			id: this.id,
			x1: this.x1,
			y1: this.y1,
			data: diagramUtil.deepCopy(this.data),
			diagramType: DIAGRAM_TYPE.ENTITY,
		};
	}
}
