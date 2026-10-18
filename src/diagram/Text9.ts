import { DIAGRAM_TYPE } from "../constants";
import { pageState, state, textMap } from "../state";
import type { DiagramSnapshot, Rect, Sel } from "../types";
import { diagramUtil } from "../util/diagramUtil";
import { Diagram9 } from "./Diagram9";
import { measureBox } from "./measure";

export class Text9 extends Diagram9 {
  data: string;
  fieldText: Sel<SVGTextElement>;
  fieldRect: Sel<SVGRectElement>;
  /** 글상자가 있는 페이지 id. 없으면 Main (core/pages) */
  pageId?: string;

  constructor(parent: Sel<SVGGElement>, x1: number, y1: number, id?: string | null, text?: string) {
	super(parent, id || "txt" + diagramUtil.getUniqueID(), x1, y1);

	this.data = text ? text : "Comment";
	this.pageId = pageState.current?.id;

	// 그룹(g)을 transform으로 (x1, y1)에 놓고 내부 요소는 그룹 기준 좌표로 그림. 이동은 transform만 바꾼다
	this.g = state.canvas.append("g").attr("id", this.id);
	this._setTransform();
	this.fieldText = this.g.append("text")
			.attr("id", this.id)
			.attr("x", 0)
			.attr("y", 0)
			.attr("font-size", "11px");

	this.fieldRect = this.g.append("rect").attr("fill", "transparent");

	this._setSpanData();
	this._setRect();

	textMap.set(this.id, this);

	this.g.on("mousedown", this.ev_mousedown.bind(this));
  }

  get diagramType() {
	return DIAGRAM_TYPE.TEXT;
  }

  /**
   * 글자 크기에 맞춰 배경 사각형 설정. 사각형을 포함한 그룹이 아니라 글자(text)의 크기로 계산하므로
   * 수정할 때마다 커지지 않으며, getBBox()는 사용자 좌표이므로 확대/축소와 무관하다.
   * x2, y2는 사각형의 오른쪽 아래 (getClientRect, 범위 선택에서 사용)
   */
  private _setRect(): void {
	const box = measureBox(this.fieldText.node());
	const width = box.width + 4, height = box.height + 4;
	this.fieldRect.attr("x", -2)
		.attr("y", -12)
		.attr("width", width)
		.attr("height", height);
	this.x2 = this.x1 - 2 + width;
	this.y2 = this.y1 - 12 + height;
  }

  private _setTransform(): void {
	this.g.attr("transform", `translate(${this.x1},${this.y1})`);
  }

  override getClientRect(): Rect {
	return { x1: this.x1 - 2, y1: this.y1 - 12, x2: this.x2, y2: this.y2 };
  }

	override modifyEntity(incX: number, incY: number): void {
		this.x1 += incX;
		this.y1 += incY;
		this.x2 += incX;
		this.y2 += incY;
		this._setTransform();

		super.selectDiagram();
	}
	rePosition(x: number, y: number): void {
		this.modifyEntity(x - this.x1, y - this.y1);
	}

	getData(): string {
		return this.data;
	}

	setTableData(text: string): void {
		this.setData(text);
	}

	setData(text: string): void {
		this.data = text;
		this._setSpanData();
		this._setRect();
	}

	private _setSpanData(): void {
		const spans = this.data.split("\n");
		this.fieldText.selectAll("tspan").remove();
		this.fieldText.selectAll("tspan")
			.data(spans)
			.enter()
			.append("tspan")
			.text(function(d) {return d.length===0 ? " " : d;})
			.attr("x", 0)
			.attr("dy", function(_d, i) { return i===0 ? 0 : 20; });
	}

	removeDiagram(): void {
		this.deselectDiagram();

		this.fieldRect.remove();
		this.fieldText.remove();
		this.g.remove();
		textMap.delete(this.id);
	}

	override selectDiagram(diagramMenu?: Sel<SVGTextElement> | null): void {
		super.selectDiagram(diagramMenu);
		this.fieldRect.classed("selectedEntity", true);
	}
	override deselectDiagram(): void {
		super.deselectDiagram();
		this.fieldRect.classed("selectedEntity", false);
	}

	duplicateData(): DiagramSnapshot {
		return {
			id: this.id,
			x1: this.x1,
			y1: this.y1,
			data: this.data,
			diagramType: DIAGRAM_TYPE.TEXT,
		};
	}
}
