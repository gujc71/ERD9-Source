/**
 * 문서(ERD) 단위 작업: 생성/저장/불러오기, 복사/붙여넣기, 보기 모드 변경 등
 */
import { select, selectAll } from "d3-selection";
import { DIAGRAM_TYPE, ERD_FILE_VERSION, MOUSE_ACTION_TYPE, STATE_TYPE, VIEW_DATA, VIEW_MODE } from "./constants";
import type { DbmsType, DiagramType, ViewData, ViewMode } from "./constants";
import { getMainPosition, getPagesData, resetPages, showCurrentPage } from "./core/pages";
import { nextPaint } from "./core/nextPaint";
import { resetViewport } from "./core/viewport";
import { Area9 } from "./diagram/Area9";
import { Entity9 } from "./diagram/Entity9";
import { Relation9 } from "./diagram/Relation9";
import { Text9 } from "./diagram/Text9";
import { isDesktopApp } from "./database/connection";
import { AreaDialog9, EntityDiagramDialog9, RelationDialog9, TextDialog9 } from "./dialogs/diagramDialogs";
import { DeleteFromPageDialog9 } from "./dialogs/pageDialog";
import { areaMap, docObjects, entityMap, pageState, relationMap, state, textMap } from "./state";
import type { AnyDiagram } from "./state";
import { chooseOpenPath, chooseSavePath, fileTitle, pathFileId, readERDFile, writeERDFile } from "./storage/desktopFile";
import { withDB } from "./storage/IndexedDBManager";
import type { AreaData, AreaFileData, DomainObject, EntityData, ERDFileData, EntityFileData, FieldData, RelationFileData, TextFileData } from "./types";
import { hideDropdown, hideLoadingScreen, showLoadingScreen } from "./ui";
import { dataTypeUtil } from "./util/dataTypeUtil";
import { diagramUtil } from "./util/diagramUtil";

export function createDiagramMenu(): void {
	const diagramMenu = state.canvas.append("text")
			.attr("fill", "blue")
			.attr("font-weight", "bold")
			.attr("font-size", "13px")
			.attr("visibility", "hidden");

	diagramMenu.append("tspan")
			.attr("dy", 20)
			.text("ⓧ")
			.on("mousedown", ev_deleteDiagram);
	diagramMenu.append("tspan")
			.attr("dy", 20)
			.text("ⓔ")
			.on("mousedown", function(event: MouseEvent){
				event.preventDefault();
				openDiagramDialog(state.movingDia);
			});
	state.diagramMenu = diagramMenu;
}

/** 도형 종류에 맞는 수정 다이얼로그 열기 */
export function openDiagramDialog(diagram: AnyDiagram | null): void {
	if (diagram instanceof Entity9) new EntityDiagramDialog9(diagram);
	else
	if (diagram instanceof Relation9) new RelationDialog9(diagram);
	else
	if (diagram instanceof Text9) new TextDialog9(diagram);
	else
	if (diagram instanceof Area9) new AreaDialog9(diagram);
}

/* -----------------------------------------------------------------------------------
 * copy & paste
 */
type CopiedDiagram =
	| { kind: "entity"; x1: number; y1: number; data: EntityData }
	| { kind: "text"; x1: number; y1: number; data: string }
	| { kind: "area"; x1: number; y1: number; data: AreaData };
let buffer2copy: CopiedDiagram[] | null = null;

export function copyDiagram(): void {
	const selectList = state.selectMgr.getSelectList();
	if (selectList.length === 0 || (selectList[0] instanceof Relation9)) return;

	function removeFK(myFld: { parent?: string | null; parentID?: string | null }) {
		delete myFld.parent;
		delete myFld.parentID;
	}

	buffer2copy = [];
	for (const item of selectList) {
		if (item instanceof Entity9) {
			const { allFields: _allFields, ...data } = diagramUtil.deepCopy(item.data);
			data.keys.forEach(removeFK);
			data.fields.forEach(removeFK);
			buffer2copy.push({ kind: "entity", x1: item.x1, y1: item.y1, data });
		} else
		if (item instanceof Text9) {
			buffer2copy.push({ kind: "text", x1: item.x1, y1: item.y1, data: item.data });
		} else
		if (item instanceof Area9) {
			buffer2copy.push({ kind: "area", x1: item.x1, y1: item.y1, data: item.getData() });
		}
	}
}

export function pasteDiagram(): void {
	if (!buffer2copy) return;

	const selectMgr = state.selectMgr;
	selectMgr.deselectDiagram();

	for (const item of buffer2copy) {
		item.x1 = item.x1 + 20;
		item.y1 = item.y1 + 20;
		if (item.kind === "text") {
			selectMgr.addSelectDiagram(new Text9(state.canvas, item.x1, item.y1, null, item.data));
		} else
		if (item.kind === "area") {
			selectMgr.addSelectDiagram(new Area9(state.canvas, item.x1, item.y1, null, item.data));
		} else {
			item.data.physicalName = diagramUtil.getUniqueValue(item.data.physicalName);
			selectMgr.addSelectDiagram(new Entity9(state.canvas, item.x1, item.y1, null, diagramUtil.deepCopy(item.data)));
		}
	}
	state.diagramStack.saveState(STATE_TYPE.MULTY_CREATE, selectMgr.getSelectList());
}

export function ev_deleteDiagram(): void {
	const selectMgr = state.selectMgr;
	if (selectMgr.getSelectList().length === 0) return;

	// 페이지에서 엔터티를 지우면 페이지에서만 뺄지, 모델에서 삭제할지 선택
	if (pageState.current && selectMgr.getSelectList().some(item => item instanceof Entity9)) {
		new DeleteFromPageDialog9(removeSelectedDiagrams);
		return;
	}
	if (!confirm("Are you sure you want to remove?")) return;
	removeSelectedDiagrams();
}

/** 선택된 도형을 모델에서 삭제 */
export function removeSelectedDiagrams(): void {
	const selectMgr = state.selectMgr;
	state.actionParent = null;
	state.mouseActionType = MOUSE_ACTION_TYPE.FUNCTION;

	state.diagramStack.saveState(STATE_TYPE.MULTY_REMOVE, selectMgr.getSelectList());
	for (const item of selectMgr.getSelectList()) {
		item.removeDiagram();
	}
	selectMgr.deselectDiagram(null, null);
}

/* -----------------------------------------------------------------------------------
 * file
 */
export function setFileName(fileName: string): void {
	select("#filename").text(fileName);
}
export function getFileName(): string {
	return select("#filename").text();
}

/** 현재 문서가 저장된 곳: IndexedDB 파일 id, 실행 파일의 파일 경로, 표시 이름 */
export interface DocumentRef {
	fileId: number | null;
	filePath: string | null;
	fileName: string;
}
export function getDocumentRef(): DocumentRef {
	return { fileId: state.savedFileID, filePath: state.savedFilePath, fileName: getFileName() };
}
/** 문서를 다시 연 뒤(openERDData는 새 문서로 초기화) 같은 파일로 계속 작업할 때 */
export function setDocumentRef(ref: DocumentRef): void {
	state.savedFileID = ref.fileId;
	state.savedFilePath = ref.filePath;
	setFileName(ref.fileName || "no name");
	select("#filename").attr("title", ref.filePath);
}
/** 실행 파일: .erd9 파일 경로 */
function setDocumentPath(path: string): void {
	setDocumentRef({ fileId: pathFileId(path), filePath: path, fileName: fileTitle(path) });
}

/* -----------------------------------------------------------------------------------
 * 파일 검증 (zod)은 첫 화면에 필요 없으므로 따로 불러온다 (코드 분할)
 */
type ERDValidator = (value: unknown) => ERDFileData;
let erdValidator: ERDValidator | null = null;
let erdValidatorLoading: Promise<ERDValidator> | null = null;

/** 파일 검증기 불러오기. 파일을 열기 전에 await */
export function loadERDValidator(): Promise<ERDValidator> {
	erdValidatorLoading ??= import("./storage/validateERDFile").then(module => (erdValidator = module.validateERDFile));
	erdValidatorLoading.catch(() => { erdValidatorLoading = null; });
	return erdValidatorLoading;
}

/** 브라우저가 쉬고 있을 때 미리 불러온다 (동기 함수 loadERDData를 바로 쓸 수 있도록) */
export function preloadERDValidator(): void {
	const load = () => { loadERDValidator().catch(() => {}); };
	if (typeof requestIdleCallback === "function") requestIdleCallback(load, { timeout: 3000 });
	else setTimeout(load, 1000);
}

function validateLoaded(fileData: unknown): ERDFileData {
	if (!erdValidator) {
		loadERDValidator().catch(() => {});
		throw new Error("ERD9 is still loading. Please try again in a moment.");
	}
	return erdValidator(fileData);
}

/** 검증기를 불러온 뒤 loadERDData */
export async function openERDData(fileData: unknown, confirmDiscard = true): Promise<boolean> {
	try {
		await loadERDValidator();
	} catch {
		alert("Failed to load the file validator. Check the network and try again.");
		return false;
	}
	return loadERDData(fileData, confirmDiscard);
}

/** 저장하지 않은 작업 기록(자동 저장) 삭제 */
export function clearAutoSave(): void {
	withDB(db => db.clearAutoSave(), true);
}

export async function saveFile(): Promise<void> {
	hideDropdown();
	if (isDesktopApp()) return saveDesktopFile(false);

	let userInput: string | undefined;
	if (!state.savedFileID) {
		userInput = prompt("Store the ERD data you created in the current web browser (IndexedDB).\nPlease enter new file name:") ?? undefined;
		if (!userInput) return;
		state.savedFileID = Date.now();
		setFileName(userInput);
	}

	showLoadingScreen();

	const fileId = state.savedFileID;
	// 문서 내용은 saveDocument 안에서 바로 복사(structured clone)되므로 따로 복사하지 않는다.
	// DB를 연 뒤(await) 만들어야 그 사이의 변경이 섞이지 않는다
	const saved = await withDB(async db => {
		await db.saveDocument({ fileId, fileName: userInput, historyFileName: getFileName(), data: makeERDData(false),
								entityCount: entityMap.size, relationCount: relationMap.size });
		return true;
	});
	if (saved) state.diagramStack.isModified = false;

	hideLoadingScreen();
}

/** 실행 파일: 다른 이름으로 저장 */
export async function saveFileAs(): Promise<void> {
	hideDropdown();
	if (isDesktopApp()) await saveDesktopFile(true);
}

/**
 * 실행 파일: .erd9 파일로 저장. 저장한 적이 없거나 saveAs이면 파일을 고른다.
 * 저장할 때마다 이 PC(IndexedDB)에 이력을 남겨 History에서 비교, 복원할 수 있다.
 */
async function saveDesktopFile(saveAs: boolean): Promise<void> {
	let path = saveAs ? null : state.savedFilePath;
	if (!path) {
		path = await chooseSavePath(getDocumentName());
		if (!path) return;
	}
	showLoadingScreen();
	try {
		const changeCount = state.diagramStack.changeCount;
		await writeERDFile(path, JSON.stringify(makeERDData(false), null, 2));
		setDocumentPath(path);
		// 쓰는 동안 바뀌지 않았으면 저장된 상태
		if (state.diagramStack.changeCount === changeCount) state.diagramStack.isModified = false;
		const fileId = state.savedFileID!;
		await withDB(async db => {
			await db.addHistory({ fileId, fileName: getFileName(), savedAt: Date.now(), entityCount: entityMap.size, relationCount: relationMap.size, data: makeERDData(false) });
			await db.clearAutoSave();
		}, true);
	} catch (error) {
		alert("Failed to save the file.\n" + (error instanceof Error ? error.message : String(error)));
	} finally {
		hideLoadingScreen();
	}
}

/** 실행 파일: .erd9 파일 열기 */
export async function openDesktopFile(): Promise<void> {
	hideDropdown();
	const path = await chooseOpenPath();
	if (!path) return;
	let data: unknown;
	try {
		data = await readERDFile(path);
	} catch (error) {
		alert(error instanceof Error ? error.message : String(error));
		return;
	}
	showLoadingScreen();
	try {
		if (await openERDData(data)) setDocumentPath(path);
	} finally {
		hideLoadingScreen();
	}
}

/**
 * 현재 문서를 파일 형식으로.
 * copy=false: 도형 데이터를 복사하지 않고 참조한다. 결과를 바로 직렬화(JSON.stringify)하거나
 *             IndexedDB에 넣을 때(호출 즉시 복사됨)만 사용하고, 결과를 보관하거나 수정하면 안 된다.
 */
export function makeERDData(copy = true): ERDFileData {
	const clone = <T>(value: T): T => copy ? diagramUtil.deepCopy(value) : value;
	const entityList: Record<string, EntityFileData> = {};
	const relationData: RelationFileData[] = [];
	const textData: TextFileData[] = [];
	const areaData: AreaFileData[] = [];

	const pages = getPagesData();
	entityMap.forEach((item) => {
		const { allFields: _allFields, ...data } = item.data;
		// 다른 페이지를 보고 있어도 Main 페이지 위치로 저장
		const pos = getMainPosition(item);
		entityList[item.id] = {
			x1: pos.x,
			y1: pos.y,
			x2: pos.x + item.x2 - item.x1,
			y2: pos.y + item.y2 - item.y1,
			data: clone(data),
		};
	});
	relationMap.forEach((item) => {
		relationData.push({
			id: item.id,
			parent: item.parentEntity.id,
			child: item.childEntity.id,
			relationType: item.relationType,
			...item.getOption(),
		});
	});
	textMap.forEach((item) => {
		textData.push({ x1: item.x1, y1: item.y1, data: item.data, ...(item.pageId ? { page: item.pageId } : {}) });
	});
	areaMap.forEach((item) => {
		areaData.push({ id: item.id, x1: item.x1, y1: item.y1, ...item.getData(), ...(item.pageId ? { page: item.pageId } : {}) });
	});

	return {
		version: ERD_FILE_VERSION,
		dbms: state.dbmsType,
		entityData: entityList,
		relationData: relationData,
		textData: textData,
		areaData: areaData,
		views: clone(docObjects.views),
		sequences: clone(docObjects.sequences),
		pages,
		domains: clone(docObjects.domains),
		words: clone(docObjects.words),
		terms: clone(docObjects.terms),
	};
}

/** 파일 이름 (확장자 제외) */
export function getDocumentName(): string {
	const filename = getFileName();
	return !filename || filename === "no name" ? "erd9" : filename.replace(/\.json$/i, "");
}

/** 파일 다운로드 */
export function downloadFile(filename: string, content: BlobPart, type: string): void {
	const url = URL.createObjectURL(new Blob([content], { type }));
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

export function exportFile(): void {
	hideDropdown();
	downloadFile(getDocumentName() + ".json", JSON.stringify(makeERDData(false), null, 2), "application/json");
}

/** confirmDiscard: 수정된 문서가 있으면 확인 */
export function newDocument(confirmDiscard = true): boolean {
	hideDropdown();
	if (confirmDiscard && state.diagramStack.isModified) {
		if (! confirm("Your work hasn't been saved, do you want to continue?") ) return false;
	}

	setDocumentRef({ fileId: null, filePath: null, fileName: "no name" });
	state.canvas.selectAll("*").remove();
	entityMap.clear();
	relationMap.clear();
	textMap.clear();
	areaMap.clear();
	docObjects.views = [];
	docObjects.sequences = [];
	docObjects.domains = [];
	docObjects.words = [];
	docObjects.terms = [];
	resetPages();
	createDiagramMenu();
	resetViewport();
	state.selectMgr.initialize(state.canvas);
	state.diagramStack.clearState();
	clearAutoSave();

	state.viewData = VIEW_DATA.ALL;
	select("#view_DataDropbtn").text(select("#view_data_all").text());

	return true;
}

/** 외부 데이터로 문서 열기. 형식이 올바르지 않으면 현재 문서는 그대로 두고 false 반환 */
export function loadERDData(fileData: unknown, confirmDiscard = true): boolean {
	let data: ERDFileData;
	try {
		data = validateLoaded(fileData);
	} catch (error) {
		alert(error instanceof Error ? error.message : String(error));
		return false;
	}
	if (!newDocument(confirmDiscard) ) return false;
	setDBMS(data.dbms);

	const canvas = state.canvas;
	// 페이지가 없는 글상자, 영역은 Main
	const pageIds = new Set(data.pages.map(page => page.id));
	const toPage = (page?: string) => page && pageIds.has(page) ? page : undefined;
	for (const item of data.areaData) {
		new Area9(canvas, item.x1, item.y1, item.id, item).pageId = toPage(item.page);
	}
	for (const key in data.entityData) {
		const item = data.entityData[key];
		new Entity9(canvas, item.x1, item.y1, key, item.data, true);		// 크기는 showCurrentPage()에서 한 번에 계산
	}
	for (const item of data.relationData) {
		Relation9.create(canvas, entityMap.get(item.parent), entityMap.get(item.child), false, item.relationType, item.id, item);
	}
	for (const item of data.textData) {
		new Text9(canvas, item.x1, item.y1, null, item.data).pageId = toPage(item.page);
	}
	docObjects.views = data.views;
	docObjects.sequences = data.sequences;
	docObjects.domains = data.domains;
	docObjects.words = data.words;
	docObjects.terms = data.terms;
	resetPages(data.pages);
	showCurrentPage();
	return true;
}

/* -----------------------------------------------------------------------------------
 * view
 */
export function setDBMS(dbms: DbmsType): void {
	state.dbmsType = dbms;
	select("#dbmsDropbtn").text(select("#dbms4"+dbms).text());
}

/**
 * DBMS를 바꾸기 전의 타입 (컬럼, 도메인별). 변환한 타입을 그대로 둔 채 원래 DBMS로 돌아가면 원래 타입으로 복원한다.
 * 대응 타입이 달라 왕복하면 타입이 바뀌는 것(TINYINT -> NUMBER(3) -> SMALLINT, TEXT -> CLOB -> LONGTEXT)을 막는다.
 */
const typeOrigins = new WeakMap<FieldData | DomainObject, { dbms: DbmsType; dataType: string; converted: string }>();

function convertWithOrigin(item: FieldData | DomainObject, sourceDB: DbmsType, targetDB: DbmsType, convert: (dataType: string) => string): string {
	const origin = typeOrigins.get(item);
	const current = origin?.converted === item.dataType ? origin : undefined;		// 변환한 뒤 직접 바꾸지 않은 타입만
	if (current?.dbms === targetDB) {
		typeOrigins.delete(item);
		return current.dataType;
	}
	const converted = convert(item.dataType);
	typeOrigins.set(item, current ? { ...current, converted } : { dbms: sourceDB, dataType: item.dataType, converted });
	return converted;
}

export async function ev_selectDBMS(event: MouseEvent): Promise<void> {
	const dbmsType = state.dbmsType;
	const dbmsNew = (event.target as HTMLElement).id.replace("dbms4", "") as DbmsType;
	if (dbmsNew===dbmsType) return;

	hideDropdown();
	if (!dataTypeUtil.canConvert(dbmsType, dbmsNew)) return;

	showLoadingScreen();
	await nextPaint();		// 로딩 화면을 먼저 그림
	const unmapped = new Set<string>();
	try {
		const convert = (dataType: string) => dataTypeUtil.convertDataType(dataType, dbmsType, dbmsNew, unmapped);
		// 논리 보기에서도 데이터는 변환 (보이는 이름은 그대로이므로 다시 그리지 않음)
		const converted = [...entityMap.values()].filter(entity => entity.convertDataTypes((_, field) => convertWithOrigin(field, dbmsType, dbmsNew, convert)));
		// 폭이 바뀌므로 다시 그리고(모두 그린 후 한 번에 측정) 관계선도 다시 계산
		if (converted.length > 0) {
			Entity9.layoutAll(converted);
			relationMap.forEach(function(relation) {
				relation.rePosition();
			});
		}
		// 도메인 타입도 변환 (컬럼과 같은 규칙이므로 도메인을 쓰는 컬럼과 일치)
		for (const domain of docObjects.domains) {
			domain.dataType = convertWithOrigin(domain, dbmsType, dbmsNew, convert);
		}

		setDBMS(dbmsNew);
		state.diagramStack.markModified();
	} finally {
		hideLoadingScreen();
	}
	if (unmapped.size > 0) {
		alert(`새 DBMS에 대응하는 타입이 없어 그대로 둔 데이터 타입:\n${[...unmapped].join(", ")}`);
	}
}

export async function ev_selectViewData(event: MouseEvent): Promise<void> {
	const target = event.target as HTMLElement;
	const viewNew = target.id.replace("view_data_", "") as ViewData;
	if (viewNew===state.viewData) return;

	hideDropdown();
	showLoadingScreen();
	await nextPaint();		// 로딩 화면을 먼저 그림
	try {
		state.selectMgr.deselectDiagram();

		state.viewData = viewNew;
		select("#view_DataDropbtn").text(target.innerText);

		Entity9.layoutAll(entityMap.values());
		relationMap.forEach(function(relation) {
			relation.rePosition();
		});
	} finally {
		hideLoadingScreen();
	}
}

export function setMakeDiagramType(diagramType: DiagramType, btn: HTMLElement): void {
	state.selectMgr.deselectDiagram();
	state.makeDiagramType = diagramType;
	selectAll(".toggle-diagram").classed('active', false);
	btn.classList.toggle("active");
	state.actionParent = null;
}

/** Logical/Physical 버튼을 각각 켜고 끔. 둘 다 켜면 MIXED, 둘 다 끌 수는 없음 */
export function toggleViewMode(viewMode: typeof VIEW_MODE.LOGICAL | typeof VIEW_MODE.PHYSICAL): void {
	let logical  = state.viewMode !== VIEW_MODE.PHYSICAL;
	let physical = state.viewMode !== VIEW_MODE.LOGICAL;
	if (viewMode === VIEW_MODE.LOGICAL) logical = !logical;
	else physical = !physical;
	if (!logical && !physical) return;

	void setViewMode(logical && physical ? VIEW_MODE.MIXED : logical ? VIEW_MODE.LOGICAL : VIEW_MODE.PHYSICAL);
}

export async function setViewMode(viewMode: ViewMode): Promise<void> {
	if (state.viewMode === viewMode) return;
	showLoadingScreen();
	await nextPaint();		// 로딩 화면을 먼저 그림
	try {
		state.viewMode = viewMode;
		select("#logicalBtn").classed("active", viewMode !== VIEW_MODE.PHYSICAL);
		select("#physicalBtn").classed("active", viewMode !== VIEW_MODE.LOGICAL);

		Entity9.layoutAll(entityMap.values());
		relationMap.forEach(function(relation) {
			relation.rePosition();
		});
	} finally {
		hideLoadingScreen();
	}
}

/** 관계 생성 버튼(식별/비식별)으로 선택된 관계 종류 */
export function getRelationKind(): typeof DIAGRAM_TYPE.RELATION_PK | typeof DIAGRAM_TYPE.RELATION_AK {
	return state.makeDiagramType === DIAGRAM_TYPE.RELATION_PK ? DIAGRAM_TYPE.RELATION_PK : DIAGRAM_TYPE.RELATION_AK;
}
