import { getViewportSize, panTo, setCanvasSize } from "../core/viewport";
import { state } from "../state";
import type { Point } from "../types";

/** 가져오기(DDL, AI)로 생성되는 엔터티의 위치 계산 */
export class CalcPosition {
	private ENTITY_GAP = 20; // 간격
	private maxHeightInSession = 0;
	private maxHeight = 0;												// 한 행내에서 가장 큰 높이
	private beforeWidth = 0;         									// 이전 크기. 현재 X 좌표 = 이전 좌표 + 이전 크기 + ENTITY_GAP
	private currentPos: Point = {x: this.ENTITY_GAP, y: this.ENTITY_GAP}; // 출력할 엔터티의 위치
	private sectionPos: Point = {x: 0, y:0};							// 분할 화면의(section) 위치
	private SVG_SIZE: Point;
	private SECTION_SIZE: Point;

	constructor() {
		this.SVG_SIZE = {x: state.canvasSize.width, y: state.canvasSize.height};

		// 분활 화면 크기: 분활 화면이란(section) 사용자에게 보여지는 부분 (100% 기준). 캔버스보다 크면 캔버스 크기
		const viewport = getViewportSize();
		this.SECTION_SIZE = {x: Math.min(viewport.width, this.SVG_SIZE.x), y: Math.min(viewport.height, this.SVG_SIZE.y) };
	}

	getPosition(width: number, height: number): Point {
		if (height > this.maxHeight) this.maxHeight = height;

		this.currentPos.x += this.beforeWidth;

		if (this.currentPos.x + width + this.ENTITY_GAP > this.sectionPos.x + this.SECTION_SIZE.x  || 	// 한 행의 너비(한 분활의 width 크기)보다 크면 다음 행(Y)으로
		    this.currentPos.x + width + this.ENTITY_GAP > this.SVG_SIZE.x  ) {							// SVG의 너비보다 크면 다음 분활 화면(Y)으로

			this.currentPos.y += this.maxHeight + this.ENTITY_GAP;
			this.maxHeight = height;
			if (this.currentPos.y + height > this.sectionPos.y + this.SECTION_SIZE.y || this.currentPos.y + height >= this.SVG_SIZE.y ) {   // 한 분활 화면을 다 채웠으면(한 분활의 height 크기) 다음 X 분활 화면으로
				this.maxHeightInSession = Math.max(this.maxHeightInSession, this.currentPos.y);
				this.sectionPos.x += this.SECTION_SIZE.x;
				this.currentPos.y = this.sectionPos.y + this.ENTITY_GAP;
				panTo(this.sectionPos.x);
			}
			if (this.sectionPos.x >= this.SVG_SIZE.x) {			 // SVG의 너비보다 크면(X 분활을 다 채웠으면) 다음 Y 분활로
				this.sectionPos.x = 0;
				this.sectionPos.y = this.maxHeightInSession;
				this.currentPos.y = this.sectionPos.y + this.ENTITY_GAP;
				if (this.currentPos.y + height  >= this.SVG_SIZE.y ) {
					this.SVG_SIZE.y = this.currentPos.y + this.SECTION_SIZE.y;
					setCanvasSize(this.SVG_SIZE.x, this.SVG_SIZE.y);
				}
				panTo(0, this.sectionPos.y);
			}
			this.currentPos.x = this.sectionPos.x + this.ENTITY_GAP;
		}

		this.beforeWidth = width + this.ENTITY_GAP;
		return {x:this.currentPos.x, y:this.currentPos.y};
	}
}
