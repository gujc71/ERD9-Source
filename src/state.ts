/**
 * 애플리케이션 전역 상태.
 * 기존에 전역 변수로 흩어져 있던 값들을 한 곳에 모은 것으로, 모듈 간 순환 import를 피하기 위해 클래스는 타입으로만 참조한다.
 */
import { DBMS_TYPE, DIAGRAM_TYPE, MOUSE_ACTION_TYPE, VIEW_DATA, VIEW_MODE } from "./constants";
import type { DbmsType, DiagramType, MouseActionType, ViewData, ViewMode } from "./constants";
import type { AreaData, DomainObject, PageData, Point, SequenceObject, Sel, StdTerm, StdWord, ViewObject } from "./types";
import type { Area9 } from "./diagram/Area9";
import type { Entity9 } from "./diagram/Entity9";
import type { Relation9 } from "./diagram/Relation9";
import type { Text9 } from "./diagram/Text9";
import type { SelectMgr } from "./core/SelectMgr";
import type { DiagramStack } from "./core/DiagramStack";
import type { NameCellEditor } from "./standard/nameEditor";
import type { PopupDialog9 } from "./dialogs/PopupDialog9";

export type AnyDiagram = Entity9 | Text9 | Relation9 | Area9;

export const entityMap = new Map<string, Entity9>();
export const relationMap = new Map<string, Relation9>();
export const textMap = new Map<string, Text9>();
export const areaMap = new Map<string, Area9>();

/** 화면에 그리지 않는 문서 단위 객체 (뷰, 시퀀스, 도메인, 표준 사전) */
export const docObjects: {
	views: ViewObject[];
	sequences: SequenceObject[];
	domains: DomainObject[];
	words: StdWord[];
	terms: StdTerm[];
} = { views: [], sequences: [], domains: [], words: [], terms: [] };

/** 다이어그램 페이지 (core/pages) */
export const pageState = {
	list: [] as PageData[],
	/** 현재 페이지. null이면 모든 엔터티를 보여주는 Main */
	current: null as PageData | null,
	/** Main 페이지에서의 엔터티 위치 (다른 페이지를 보는 동안 보관) */
	mainPos: new Map<string, Point>(),
};

interface AppState {
	/** 화면(뷰포트). 확대/이동 이벤트를 받는다 */
	svg: Sel<SVGSVGElement>;
	/** 도형을 그리는 곳. 확대/이동은 이 요소의 transform으로 처리 (core/viewport) */
	canvas: Sel<SVGGElement>;
	/** 이동할 수 있는 영역 크기 */
	canvasSize: { width: number; height: number };
	/** 선택된 도형 옆에 표시되는 메뉴 (삭제/수정) */
	diagramMenu: Sel<SVGTextElement>;
	/** 확대/축소 비율 */
	svgRate: number;
	viewMode: ViewMode;
	viewData: ViewData;
	makeDiagramType: DiagramType;
	dbmsType: DbmsType;
	mouseActionType: MouseActionType;
	/** 현재 실행중인 popupDialog */
	popupWindow: PopupDialog9 | null;
	/** 관계 생성시 부모 엔터티 */
	actionParent: Entity9 | null;
	movingDia: AnyDiagram | null;
	clickedDiagram: AnyDiagram | null;
	movingPos: Point;
	/** 크기 조절 중인 주제 영역과 조절 전 값 (실행취소용) */
	resizeArea: Area9 | null;
	resizeBackup: AreaData | null;
	/** IndexedDB에 저장된 파일 id. 실행 파일은 파일 경로로 만든 이력 키 (storage/desktopFile.pathFileId) */
	savedFileID: number | null;
	/** 실행 파일: 저장한 .erd9 파일 경로 */
	savedFilePath: string | null;
	selectMgr: SelectMgr;
	diagramStack: DiagramStack;
	/** 엔터티 편집 그리드의 컬럼명/주석 셀 편집기 (표준 용어 자동완성) */
	nameEditor: NameCellEditor;
}

// svg, canvas, diagramMenu, selectMgr, diagramStack, nameEditor는 initApp()에서 설정된다.
export const state: AppState = {
	svg: null!,
	canvas: null!,
	canvasSize: { width: 5555, height: 5555 },
	diagramMenu: null!,
	svgRate: 1,
	viewMode: VIEW_MODE.PHYSICAL,
	viewData: VIEW_DATA.ALL,
	makeDiagramType: DIAGRAM_TYPE.NONE,
	dbmsType: DBMS_TYPE.MARIADB,
	mouseActionType: MOUSE_ACTION_TYPE.NONE,
	popupWindow: null,
	actionParent: null,
	movingDia: null,
	clickedDiagram: null,
	movingPos: { x: 0, y: 0 },
	resizeArea: null,
	resizeBackup: null,
	savedFileID: null,
	savedFilePath: null,
	selectMgr: null!,
	diagramStack: null!,
	nameEditor: null!,
};
