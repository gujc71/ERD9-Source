import { DIAGRAM_TYPE } from "../constants";
import { isEntityVisible, isOnCurrentPage } from "../core/pages";
import { areaMap, entityMap, pageState, state, textMap } from "../state";
import type { AnyDiagram } from "../state";
import type { AreaData, DiagramSnapshot, Sel } from "../types";
import { diagramUtil } from "../util/diagramUtil";
import { Diagram9 } from "./Diagram9";

export const AREA_MIN_SIZE = 50;
export const AREA_COLORS = ["#e8f0fe", "#e6f4ea", "#fef7e0", "#fce8e6", "#f3e8fd", "#e4f7fb", "#f1f3f4"];

/**
 * 주제 영역. 엔터티들을 묶어 보여주는 배경 사각형.
 * 다른 도형보다 항상 뒤에 그리며, 내부를 클릭해도 범위 선택이 되도록 이름과 테두리만 마우스로 선택한다.
 */
export class Area9 extends Diagram9 {
	data: AreaData;
	/** 영역이 있는 페이지 id. 없으면 Main (core/pages) */
	pageId?: string;
	private rect!: Sel<SVGRectElement>;
	private border!: Sel<SVGRectElement>;
	private label!: Sel<SVGTextElement>;
	private handle!: Sel<SVGRectElement>;

	constructor(parent: Sel<SVGGElement>, x: number, y: number, id?: string | null, data?: AreaData) {
		super(parent, id || "ar" + diagramUtil.getUniqueID(), x, y);
		this.data = data ? { name: data.name, color: data.color, width: data.width, height: data.height }
						 : { name: "Subject Area", color: AREA_COLORS[areaMap.size % AREA_COLORS.length], width: 300, height: 200 };
		this.pageId = pageState.current?.id;

		this.g = state.canvas.insert("g", ":first-child").attr("id", this.id).attr("font-size", "12px");
		this.rect = this.g.append("rect")
			.attr("fill-opacity", 0.6)
			.attr("stroke", "#9aa0a6")
			.attr("stroke-width", 1)
			.attr("stroke-dasharray", "6 3")
			.style("pointer-events", "none");
		this.border = this.g.append("rect")
			.attr("fill", "none")
			.attr("stroke", "transparent")
			.attr("stroke-width", 8)
			.style("pointer-events", "stroke")
			.style("cursor", "move");
		this.label = this.g.append("text")
			.attr("font-weight", "bold")
			.attr("fill", "#3c4043")
			.style("cursor", "move");
		this.handle = this.g.append("rect")
			.attr("width", 10)
			.attr("height", 10)
			.attr("fill", "#9aa0a6")
			.style("cursor", "nwse-resize")
			.on("mousedown", () => { state.resizeArea = this; });

		this._draw();
		areaMap.set(this.id, this);

		this.g.on("mousedown", this.ev_mousedown.bind(this));
	}

	get diagramType() {
		return DIAGRAM_TYPE.AREA;
	}

	/** 그룹(g)을 transform으로 (x1, y1)에 놓고 내부 요소는 그룹 기준 좌표로 그림. 이동은 transform만 바꾼다 */
	private _draw(): void {
		const { width, height, color, name } = this.data;
		this._setPosition();
		this.rect.attr("x", 0).attr("y", 0).attr("width", width).attr("height", height).attr("fill", color);
		this.border.attr("x", 0).attr("y", 0).attr("width", width).attr("height", height);
		this.label.attr("x", 8).attr("y", 18).text(name);
		this.handle.attr("x", width - 10).attr("y", height - 10);
	}
	private _setPosition(): void {
		this.x2 = this.x1 + this.data.width;
		this.y2 = this.y1 + this.data.height;
		this.g.attr("transform", `translate(${this.x1},${this.y1})`);
	}

	/** 다른 도형 위로 올리지 않음 (배경이므로) */
	override ev_mousedown(): void {
		state.clickedDiagram = this;
	}

	override modifyEntity(incX: number, incY: number): void {
		this.x1 += incX;
		this.y1 += incY;
		this._setPosition();
		super.selectDiagram();
	}
	rePosition(x: number, y: number): void {
		this.modifyEntity(x - this.x1, y - this.y1);
	}

	resize(width: number, height: number): void {
		this.data.width = Math.max(AREA_MIN_SIZE, Math.round(width));
		this.data.height = Math.max(AREA_MIN_SIZE, Math.round(height));
		this._draw();
	}

	getData(): AreaData {
		return { ...this.data };
	}
	setData(data: AreaData): void {
		this.data = { ...data };
		this._draw();
	}
	setTableData(data: AreaData): void {
		this.setData(data);
	}

	/** 영역 안에 완전히 들어있는 엔터티와 텍스트 */
	getContainedDiagrams(): AnyDiagram[] {
		const inside = (d: { x1: number; y1: number; x2: number; y2: number }) => d.x1 >= this.x1 && d.y1 >= this.y1 && d.x2 <= this.x2 && d.y2 <= this.y2;
		const list: AnyDiagram[] = [];
		for (const entity of entityMap.values()) if (isEntityVisible(entity) && inside(entity)) list.push(entity);
		for (const text of textMap.values()) if (isOnCurrentPage(text) && inside(text.getClientRect())) list.push(text);
		return list;
	}

	removeDiagram(): void {
		this.deselectDiagram();
		this.g.remove();
		areaMap.delete(this.id);
	}

	override selectDiagram(diagramMenu?: Sel<SVGTextElement> | null): void {
		super.selectDiagram(diagramMenu);
		this.rect.classed("selectedEntity", true);
	}
	override deselectDiagram(): void {
		super.deselectDiagram();
		this.rect.classed("selectedEntity", false);
	}

	duplicateData(): DiagramSnapshot {
		return {
			id: this.id,
			x1: this.x1,
			y1: this.y1,
			data: this.getData(),
			diagramType: DIAGRAM_TYPE.AREA,
		};
	}
}
