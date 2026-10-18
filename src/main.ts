import "./styles/erd9.css";
import { drag } from "d3-drag";
import type { D3DragEvent } from "d3-drag";
import { select, selectAll } from "d3-selection";
import { DIAGRAM_TYPE, MOUSE_ACTION_TYPE, STATE_TYPE, VIEW_MODE } from "./constants";
import type { RelationEnd } from "./constants";
import { autoLayout } from "./core/AutoLayout";
import { DiagramStack } from "./core/DiagramStack";
import { findDiagram } from "./core/findDiagram";
import { SelectMgr } from "./core/SelectMgr";
import { createManyToMany } from "./core/manyToMany";
import { renderPageTabs } from "./core/pages";
import { NameCellEditor } from "./standard/nameEditor";
import { initViewport, isPanKeyPressed, zoomStep } from "./core/viewport";
import { Area9 } from "./diagram/Area9";
import { Entity9 } from "./diagram/Entity9";
import { Relation9 } from "./diagram/Relation9";
import { Text9 } from "./diagram/Text9";
import { ImportFileDialog9, OpenFileDialog9, openHistoryDialog, PrintFileDialog9, RecoveryDialog9, SamplesDialog9 } from "./dialogs/fileDialogs";
import {
	copyDiagram, createDiagramMenu, ev_deleteDiagram, ev_selectDBMS, ev_selectViewData, exportFile, getRelationKind,
	newDocument, openDesktopFile, openDiagramDialog, pasteDiagram, saveFile, saveFileAs, setMakeDiagramType, toggleViewMode,
} from "./erdManager";
import { isDesktopApp } from "./database/connection";
import { state } from "./state";
import { getAutoSave, startAutoSave } from "./storage/autoSave";
import { initTheme } from "./theme";
import { hideDropdown, showDropdown } from "./ui";
import { WithAI9 } from "./withAI";

/** 부가 기능 다이얼로그는 메뉴를 클릭할 때 불러온다 (코드 분할) */
const loadAddon = () => import("./dialogs/addonDialogs");

function bindKeyboard(): void {
	select(document.body).on("keydown", function(event: KeyboardEvent) {
		if ((event.target as HTMLElement).id==="chatMessage") return;
		if (state.popupWindow) return;
		// 찾기 입력 중에는 Delete, Ctrl + C/V 등을 입력 상자가 처리 (Ctrl + F만 제외)
		if ((event.target as HTMLElement).id==="findKeyword" && !((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==="f")) return;

		if (event.key === "Delete") ev_deleteDiagram();
		else
		if (event.ctrlKey || event.metaKey){
		    event.preventDefault();
			switch (event.key.toLowerCase()) {
				case '0': zoomStep(0); break;
				case '+':
				case '=': zoomStep(1); break;
				case '-': zoomStep(-1); break;
				case 'a': state.selectMgr.selectDiagramAll(); break;
				case 's': if (event.shiftKey) saveFileAs(); else saveFile(); break;
				case 'c': copyDiagram(); break;
				case 'v': pasteDiagram(); break;
				case 'z': state.diagramStack.undoState(); break;
				case 'y': state.diagramStack.redoState(); break;
				case 'f': findDiagram.open(); break;
			}
		}
	});
}

type DragEvent = D3DragEvent<SVGSVGElement, unknown, unknown>;

function bindMouse(): void {
	const svg = state.svg;
	const selectMgr = state.selectMgr;
	const diagramStack = state.diagramStack;

	let selfRelation = false;	// 자기참조 관계를 만드는 두 번째 클릭
	// 관계선의 꺾이는 위치나 끝을 끄는 중: 대상 관계, 끄는 끝(없으면 꺾이는 위치), 끌기 전 옵션 (실행취소)
	let bending: { relation: Relation9; end: RelationEnd | null; backup: ReturnType<Relation9["getOption"]>; moved: boolean } | null = null;
	// 컬럼 순서를 바꾸는 중인 엔터티
	let fieldDragEntity: Entity9 | null = null;
	let clickCount = 0; 	// 클릭 횟수를 추적하는 변수
    let clickTimer: ReturnType<typeof setTimeout>; 	// 클릭 딜레이를 위한 타이머 변수

	// 드래그로 처리하지 않는 누름(오른쪽/가운데 버튼, Space + 드래그)은 눌린 도형만 정리.
	// 화면 이동(d3-zoom)이 시작되면 이후 리스너가 호출되지 않으므로 가장 먼저 등록
	svg.on("mousedown.reset", function(event: MouseEvent){
		if (event.button === 0 && !isPanKeyPressed()) return;
		if (event.button === 1) event.preventDefault();		// 가운데 버튼 자동 스크롤 방지
		state.resizeArea = null;
		state.clickedDiagram = null;
	});

	function dragStarted(event: DragEvent): void {
		const sourceEvent = event.sourceEvent as MouseEvent;
		if (state.popupWindow) {
			state.resizeArea = null;
			return;
		}
		// 주제 영역 크기 조절 (모서리 핸들을 누른 경우)
		if (state.resizeArea) {
			state.mouseActionType = MOUSE_ACTION_TYPE.AREA_RESIZE;
			state.resizeBackup = state.resizeArea.getData();
			state.clickedDiagram = null;
			return;
		}

		clickCount++;
		if (clickCount === 1) {
			clickTimer = setTimeout(function() {clickCount = 0;}, 200);
		} else if (clickCount === 2) { // mouse double click
			clearTimeout(clickTimer);
			clickCount = 0;
			// 첫 번째 클릭으로 선택된 도형(movingDia)과 두 번째 클릭한 도형이 같아야 더블 클릭. 다르면 일반 클릭으로 처리
			const clicked = state.clickedDiagram, target = state.movingDia;
			// 관계 도구에서는 같은 엔터티를 두 번 누르면 자기참조 관계를 만들므로 다이얼로그를 열지 않음
			if (clicked === target && !(target && target === state.actionParent)) {
				state.clickedDiagram = null;
				if (target instanceof Entity9 || target instanceof Text9 || target instanceof Area9 || target instanceof Relation9) openDiagramDialog(target);
				return;
			}
			clickCount = 1;
			clickTimer = setTimeout(function() {clickCount = 0;}, 200);
		}

		if (state.mouseActionType===MOUSE_ACTION_TYPE.FUNCTION) {
			state.mouseActionType = MOUSE_ACTION_TYPE.NONE;
			return;
		}
		state.mouseActionType = MOUSE_ACTION_TYPE.NONE;

		// 이미 (혼자) 선택된 엔터티의 컬럼 줄을 끌면 컬럼 순서 변경. 선택되지 않은 엔터티는 기존처럼 이동
		const clicked = state.clickedDiagram;
		if (clicked instanceof Entity9 && clicked.selected && state.makeDiagramType === DIAGRAM_TYPE.NONE && !sourceEvent.shiftKey &&
			selectMgr.getSelectList().length <= 1 && clicked.startFieldDrag(sourceEvent.target)) {
			fieldDragEntity = clicked;
			state.movingDia = clicked;		// 더블 클릭 확인용
			state.clickedDiagram = null;
			state.mouseActionType = MOUSE_ACTION_TYPE.FIELD_MOVE;
			return;
		}

		const movingDia = state.movingDia = state.clickedDiagram;
		state.clickedDiagram = null;

		// 관계 도구로 부모를 고른 뒤 같은 엔터티를 다시 누르면 자기참조 관계 (다대다 도구 제외)
		selfRelation = false;
		if (movingDia && movingDia === state.actionParent &&
			(state.makeDiagramType === DIAGRAM_TYPE.RELATION_PK || state.makeDiagramType === DIAGRAM_TYPE.RELATION_AK)) {
			selfRelation = true;
			state.mouseActionType = MOUSE_ACTION_TYPE.ENTITY_RELATION;
			return;
		}

		// 선택된 도형이 선이면
		if (movingDia instanceof Relation9) {
			selectMgr.deselectDiagram(movingDia, state.diagramMenu);
			// 끝 근처를 끌면 끝을 엔터티 변을 따라 옮기고, 나머지를 끌면 가운데 꺾이는 위치를 옮긴다
			const end = movingDia.endAt(event.x, event.y);
			if (end || movingDia.canBend()) {
				bending = { relation: movingDia, end, backup: movingDia.getOption(), moved: false };
				state.mouseActionType = MOUSE_ACTION_TYPE.RELATION_BEND;
			}
			return;
		}

		const currentX = event.x, currentY = event.y;
		state.movingPos.x = currentX;
		state.movingPos.y = currentY;

		// 선택된 도형이 없으면
		if (!movingDia) {
			selectMgr.deselectDiagram(movingDia, state.diagramMenu);
			if (state.makeDiagramType === DIAGRAM_TYPE.NONE && sourceEvent.target===svg.node()) {
				selectMgr.setPosition(currentX, currentY, currentX, currentY);
				state.mouseActionType = MOUSE_ACTION_TYPE.SELECT;
			} else
			if (state.makeDiagramType === DIAGRAM_TYPE.TEXT)   diagramStack.saveState(STATE_TYPE.ENTITY_CREATE, new Text9(state.canvas, currentX, currentY));
			else
			if (state.makeDiagramType === DIAGRAM_TYPE.ENTITY) diagramStack.saveState(STATE_TYPE.ENTITY_CREATE, new Entity9(state.canvas, currentX, currentY));
			else
			if (state.makeDiagramType === DIAGRAM_TYPE.AREA)   diagramStack.saveState(STATE_TYPE.ENTITY_CREATE, new Area9(state.canvas, currentX, currentY));
			state.actionParent = null;
			return;
		}
		// 선택된 도형이 선택 리스트에 있으면 - 테이블
		if (selectMgr.isInSelectList(movingDia)) {
			state.mouseActionType = MOUSE_ACTION_TYPE.ENTITY_MOVE;
			return;
		}
		if (sourceEvent.shiftKey) {
			selectMgr.addSelectDiagram(movingDia);
			state.mouseActionType = MOUSE_ACTION_TYPE.NONE;
			return;
		}
		// 선택 리스트 해제, 선택 도형 추가
		selectMgr.deselectDiagram(movingDia, state.diagramMenu);

		if (state.makeDiagramType === DIAGRAM_TYPE.RELATION_PK || state.makeDiagramType === DIAGRAM_TYPE.RELATION_AK || state.makeDiagramType === DIAGRAM_TYPE.RELATION_MN) {
			state.mouseActionType = MOUSE_ACTION_TYPE.ENTITY_RELATION;
			if (state.actionParent === null && movingDia instanceof Entity9) state.actionParent = movingDia;
		} else {
			// 주제 영역을 옮기면 안에 있는 도형도 함께 이동
			if (movingDia instanceof Area9) {
				for (const item of movingDia.getContainedDiagrams()) selectMgr.addSelectDiagram(item);
			}
			state.mouseActionType = MOUSE_ACTION_TYPE.ENTITY_MOVE;
		}
	}

	// 도형 이동은 프레임당 한 번만 반영
	let pendingMove: { x: number; y: number } | null = null;
	const applyMove = () => {
		if (!pendingMove) return;
		const { x, y } = pendingMove;
		pendingMove = null;
		selectMgr.setEntityPosition(x - state.movingPos.x, y - state.movingPos.y);
		state.movingPos.x = x;
		state.movingPos.y = y;
	};

	function dragged(event: DragEvent): void {
		const mouseActionType = state.mouseActionType;
		if (mouseActionType === MOUSE_ACTION_TYPE.NONE) return;

		const currentX = event.x, currentY = event.y;

		if (mouseActionType === MOUSE_ACTION_TYPE.AREA_RESIZE) {
			const area = state.resizeArea;
			if (area) area.resize(currentX - area.x1, currentY - area.y1);
			return;
		}
		if (mouseActionType === MOUSE_ACTION_TYPE.RELATION_BEND) {
			if (bending) {
				if (bending.end) bending.relation.setEndAt(bending.end, currentX, currentY);
				else bending.relation.setBendAt(currentX, currentY);
				bending.moved = true;
			}
			return;
		}
		if (mouseActionType === MOUSE_ACTION_TYPE.FIELD_MOVE) {
			fieldDragEntity?.dragFieldTo(currentY);
			return;
		}
		if ( mouseActionType === MOUSE_ACTION_TYPE.SELECT) {
			selectMgr.setPosition(state.movingPos.x, state.movingPos.y, currentX, currentY);
			return;
		}

		if (mouseActionType === MOUSE_ACTION_TYPE.ENTITY_MOVE) {
			if (currentX === state.movingPos.x && currentY === state.movingPos.y) return; 		// 마우스 위치 변환가 없으면 다음 작업 하지 않음
			diagramStack.saveState(STATE_TYPE.ENTITY_MOVE, selectMgr.getSelectedDiagramState());
		}
		state.mouseActionType = MOUSE_ACTION_TYPE.ENTITY_MOVING;

		if (!pendingMove) requestAnimationFrame(applyMove);
		pendingMove = { x: currentX, y: currentY };
	}

	function dragEnded(): void {
		if (state.mouseActionType === MOUSE_ACTION_TYPE.NONE) return;
		applyMove();

		const movingDia = state.movingDia;
		const actionParent = state.actionParent;
		if (state.mouseActionType === MOUSE_ACTION_TYPE.RELATION_BEND) {
			if (bending?.moved) {
				diagramStack.saveState(STATE_TYPE.RELATION_MODIFY, bending.relation, bending.backup);
				selectMgr.deselectDiagram(bending.relation, state.diagramMenu);		// 도형 메뉴를 새 위치로
			}
			bending = null;
		} else
		if (state.mouseActionType === MOUSE_ACTION_TYPE.FIELD_MOVE) {
			const entity = fieldDragEntity;
			fieldDragEntity = null;
			const backup = entity?.endFieldDrag();
			if (entity && backup) diagramStack.saveState(STATE_TYPE.ENTITY_MODIFY, entity, backup);
		} else
		if (state.mouseActionType === MOUSE_ACTION_TYPE.AREA_RESIZE) {
			const area = state.resizeArea;
			if (area && state.resizeBackup && JSON.stringify(state.resizeBackup) !== JSON.stringify(area.getData())) {
				diagramStack.saveState(STATE_TYPE.ENTITY_MODIFY, area, state.resizeBackup);
			}
			state.resizeArea = null;
			state.resizeBackup = null;
		} else
		if ( state.mouseActionType === MOUSE_ACTION_TYPE.SELECT) {
			selectMgr.selectDiagram();
		} else
		if ( actionParent != null && (actionParent !== movingDia || selfRelation)) {
			selfRelation = false;
			if (movingDia instanceof Entity9) {
				if (state.makeDiagramType === DIAGRAM_TYPE.RELATION_MN) {
					createManyToMany(actionParent, movingDia);
				} else {
					const r = Relation9.create(state.canvas, actionParent, movingDia, true, getRelationKind()) ;
					if (r) diagramStack.saveState(STATE_TYPE.RELATION_CREATE, r);
				}
			}
			state.actionParent = null;
			movingDia?.deselectDiagram();
			selectMgr.deselectDiagram();
		} else
		if ( state.mouseActionType === MOUSE_ACTION_TYPE.ENTITY_MOVING) {
			// 함께 이동한 엔터티와 그 이웃 엔터티의 관계선을 한 번씩 다시 계산 (같은 변의 연결 위치를 나눠 쓰므로)
			Relation9.recalculateAround(selectMgr.getSelectList().filter((item): item is Entity9 => item instanceof Entity9));
		}

		state.mouseActionType = MOUSE_ACTION_TYPE.NONE;
	}

	// 왼쪽 버튼만. 가운데 버튼, Space + 드래그, 터치는 화면 이동 (core/viewport)
	svg.call(drag<SVGSVGElement, unknown>()
		.container(() => state.canvas.node()!)
		.filter((event: MouseEvent) => event.type === "mousedown" && event.button === 0 && !event.ctrlKey && !isPanKeyPressed())
		.on("start", dragStarted)
		.on("drag", dragged)
		.on("end", dragEnded));
}

function bindMenu(): void {
	select("#newDocument").on("click", function(){ newDocument(); });
	select("#saveFile").on("click", saveFile);
	select("#exportFile").on("click", exportFile);

	select("#view_data_all").on("click", ev_selectViewData);
	select("#view_data_entity").on("click", ev_selectViewData);
	select("#view_data_keys").on("click", ev_selectViewData);

	select("#dbms4mariadb").on("click", ev_selectDBMS);
	select("#dbms4oracle").on("click", ev_selectDBMS);
	select("#dbms4mssql").on("click", ev_selectDBMS);
	select("#dbms4postgresql").on("click", ev_selectDBMS);

	select("#importFile").on("click", function(){ new ImportFileDialog9(); });
	select("#simpleImportDDL").on("click", async function(){ new (await loadAddon()).SimpleImportDDLDialog9(); });
	select("#generateDDL").on("click", async function(){ new (await loadAddon()).GenerateDDLDialog9(); });
	select("#tableDescription").on("click", async function(){ new (await loadAddon()).GenerateTableDescriptionDialog9(); });
	select("#detectRelationship").on("click", async function(){ new (await loadAddon()).DetectRelationshipDialog9(); });
	select("#generateLogicalNames").on("click", async function(){ hideDropdown(); new (await loadAddon()).GenerateLogicalNamesDialog9(); });
	select("#makeERDwithAI").on("click", async function(){ (await loadAddon()).openMakeERDwithAI(); });
	select("#autoLayout").on("click", function(){ autoLayout().catch(error => alert(error instanceof Error ? error.message : error)); });
	select("#compareERD").on("click", async function(){ hideDropdown(); new (await import("./dialogs/compareDialog")).CompareERDDialog9(); });
	select("#viewsSequences").on("click", async function(){ hideDropdown(); new (await loadAddon()).ViewsSequencesDialog9(); });
	select("#standards").on("click", async function(){ hideDropdown(); new (await import("./dialogs/standardsDialog")).StandardsDialog9(); });
	select("#columnTemplates").on("click", async function(){ hideDropdown(); new (await loadAddon()).ColumnTemplatesDialog9(); });

	select("#openFile").on("click", function(){ if (isDesktopApp()) openDesktopFile(); else new OpenFileDialog9(); });
	select("#openSamples").on("click", function(){ new SamplesDialog9(); });
	select("#printFile").on("click", function(){ new PrintFileDialog9(); });
	select("#fileHistory").on("click", openHistoryDialog);

	select<HTMLElement, unknown>("#arrowBtn").on("mousedown", function(){ setMakeDiagramType(DIAGRAM_TYPE.NONE, this); });
	select<HTMLElement, unknown>("#entityBtn").on("mousedown", function(){ setMakeDiagramType(DIAGRAM_TYPE.ENTITY, this); });
	select<HTMLElement, unknown>("#relationPKBtn").on("mousedown", function(){ setMakeDiagramType(DIAGRAM_TYPE.RELATION_PK, this); });
	select<HTMLElement, unknown>("#relationAKBtn").on("mousedown", function(){ setMakeDiagramType(DIAGRAM_TYPE.RELATION_AK, this); });
	select<HTMLElement, unknown>("#relationMNBtn").on("mousedown", function(){ setMakeDiagramType(DIAGRAM_TYPE.RELATION_MN, this); });
	select<HTMLElement, unknown>("#textBtn").on("mousedown", function(){ setMakeDiagramType(DIAGRAM_TYPE.TEXT, this); });
	select<HTMLElement, unknown>("#areaBtn").on("mousedown", function(){ setMakeDiagramType(DIAGRAM_TYPE.AREA, this); });

	select("#logicalBtn").on("mousedown", () => toggleViewMode(VIEW_MODE.LOGICAL));
	select("#physicalBtn").on("mousedown", () => toggleViewMode(VIEW_MODE.PHYSICAL));

	findDiagram.init();

	selectAll(".dropdown").on("mouseleave", hideDropdown);
	select("#filesDropbtn").on("mouseover", showDropdown);
	select("#dbmsDropbtn").on("mouseover", showDropdown);
	select("#addonsDropbtn").on("mouseover", showDropdown);
	select("#view_DataDropbtn").on("mouseover", showDropdown);

	bindDesktopFileMenu();
	bindDatabaseMenu();
	initTheme();
}

/** 실행 파일(Tauri): 문서를 브라우저(IndexedDB) 대신 .erd9 파일로 저장하고 연다 */
function bindDesktopFileMenu(): void {
	if (!isDesktopApp()) return;
	select("#openFile").attr("title", "open an .erd9 file (JSON)");
	select("#saveFile").attr("title", "save to an .erd9 file (JSON) (Ctrl+S)");
	select("#saveAsFile").style("display", null).on("click", saveFileAs);
	select("#fileHistory").attr("title", "versions kept on this PC each time you save");
}

/** 데이터베이스 메뉴: DB 서버에 연결해야 하므로 실행 파일(Tauri)에서만 보인다 */
function bindDatabaseMenu(): void {
	if (!isDesktopApp()) return;
	const loadDatabase = () => import("./dialogs/databaseDialogs");
	select("#databaseMenu").style("display", null);
	document.documentElement.classList.add("desktopApp");		// 툴바가 넓어지므로 좁은 창 규칙을 더 넓은 창부터 적용 (erd9.css)
	select("#databaseDropbtn").on("mouseover", showDropdown);
	select("#forwardEngineering").on("click", async function(){ hideDropdown(); new (await loadDatabase()).ForwardEngineeringDialog9(); });
	select("#reverseEngineering").on("click", async function(){ hideDropdown(); new (await loadDatabase()).ReverseEngineeringDialog9(); });
	select("#syncDatabase").on("click", async function(){ hideDropdown(); new (await loadDatabase()).SyncDialog9(); });
}

async function initApp(): Promise<void> {
	state.svg = select<SVGSVGElement, unknown>("body > svg");		// 툴바 아이콘 svg와 구분
	state.canvas = state.svg.append("g").attr("class", "canvas");

	state.selectMgr = new SelectMgr(state.canvas);
	state.diagramStack = new DiagramStack();
	state.nameEditor = new NameCellEditor();

	createDiagramMenu();
	renderPageTabs();

	bindKeyboard();
	bindMouse();
	initViewport();		// bindMouse()의 mousedown.reset 보다 뒤에 등록
	bindMenu();

	// 저장하지 않은 작업이 있으면 복구할지 묻고, 없으면 샘플 안내
	const unsaved = await getAutoSave();
	if (unsaved) {
		new RecoveryDialog9(unsaved);
	} else {
		if (import.meta.env.DEV) {
			const { setTestData } = await import("./dev/testData");
			setTestData();
		}
		if (localStorage.getItem("dontShow")!=="true") new SamplesDialog9();
	}
	startAutoSave();

	new WithAI9();

	window.addEventListener("beforeunload", function(event) {
		if (!state.diagramStack.isModified) return;
		event.preventDefault();
	});
}

initApp();
