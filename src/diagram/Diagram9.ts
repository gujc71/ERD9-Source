import type { DiagramType } from "../constants";
import { state } from "../state";
import type { AnyDiagram } from "../state";
import type { Rect, Sel } from "../types";

export abstract class Diagram9 {
  parent: Sel<SVGGElement>;
  id: string;
  x1: number;
  y1: number;
  x2 = 0;
  y2 = 0;
  g!: Sel<SVGGElement>;
  diagramMenu: Sel<SVGTextElement> | null = null;

  constructor(parent: Sel<SVGGElement>, id: string, x: number, y: number) {
    this.parent = parent;
    this.id = id;
    this.x1 = x;
    this.y1 = y;
  }

  abstract get diagramType(): DiagramType;
  abstract removeDiagram(): void;
  abstract rePosition(x?: number, y?: number): void;

  /** 선택된 도형들을 같이 이동. 관계선은 엔터티를 따라 이동하므로 구현하지 않음 */
  modifyEntity(_incX: number, _incY: number): void {}

  getClientRect(): Rect {
	  return {x1: this.x1, y1: this.y1, x2: this.x2, y2: this.y2};
  }

  selectDiagram(diagramMenu?: Sel<SVGTextElement> | null): void {
	if (diagramMenu) this.diagramMenu = diagramMenu;
	if (!this.diagramMenu) return;

	this.diagramMenu.raise();
	this.diagramMenu.attr("x", this.x1-15)
					.attr("y", this.y1-20)
					.attr("visibility", "visible");
	this.diagramMenu.selectAll("tspan")
		.attr("x", this.x1-15)
		.attr("visibility", "visible");
  }

  deselectDiagram(_diagramMenu?: Sel<SVGTextElement> | null): void {
	if (!this.diagramMenu) return;
	this.diagramMenu.attr("visibility", "hidden");
	this.diagramMenu.selectAll("tspan")
		.attr("visibility", "hidden");
	this.diagramMenu = null;
  }

  ev_mousedown(): void {
	state.clickedDiagram = this as unknown as AnyDiagram;
	if (this.g) this.g.raise();
  }
}
