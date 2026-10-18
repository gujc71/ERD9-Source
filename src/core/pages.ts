/**
 * 다이어그램 페이지 (ERwin의 Subject Area).
 * Main은 모든 엔터티를 보여주고, 페이지는 고른 엔터티만 페이지마다 다른 위치로 보여준다.
 * 엔터티는 모델에 하나만 있으며, 페이지를 바꾸면 보이는 엔터티의 위치를 저장하고 새 페이지의 위치로 옮긴다.
 * 관계는 양쪽 엔터티가 모두 보일 때만, 글상자와 영역은 만든 페이지에서만 보인다.
 */
import { DIAGRAM_TYPE } from "../constants";
import { Entity9 } from "../diagram/Entity9";
import { areaMap, entityMap, pageState, relationMap, state, textMap } from "../state";
import type { AnyDiagram } from "../state";
import type { PageData, Point, Sel } from "../types";
import { diagramUtil } from "../util/diagramUtil";

/** 현재 페이지에 보이는 엔터티인지 */
export function isEntityVisible(entity: { id: string }): boolean {
	return !pageState.current || entity.id in pageState.current.entities;
}

/** 글상자, 영역이 현재 페이지의 것인지 (pageId가 없으면 Main) */
export function isOnCurrentPage(item: { pageId?: string }): boolean {
	return (item.pageId ?? null) === (pageState.current?.id ?? null);
}

export function isDiagramVisible(diagram: AnyDiagram): boolean {
	switch (diagram.diagramType) {
		case DIAGRAM_TYPE.ENTITY: return isEntityVisible(diagram);
		case DIAGRAM_TYPE.TEXT:
		case DIAGRAM_TYPE.AREA: return isOnCurrentPage(diagram as { pageId?: string });
	}
	const relation = diagram as { parentEntity: { id: string }; childEntity: { id: string } };
	return isEntityVisible(relation.parentEntity) && isEntityVisible(relation.childEntity);
}

/** 새로 만든 엔터티는 현재 페이지에 추가 */
export function addToCurrentPage(entity: { id: string; x1: number; y1: number }): void {
	const page = pageState.current;
	if (page && !(entity.id in page.entities)) page.entities[entity.id] = { x: entity.x1, y: entity.y1 };
}

/** 현재 페이지에 보이는 엔터티의 위치 저장 */
export function savePagePositions(): void {
	const page = pageState.current;
	if (!page) {
		entityMap.forEach(entity => pageState.mainPos.set(entity.id, { x: entity.x1, y: entity.y1 }));
		return;
	}
	for (const id of Object.keys(page.entities)) {
		const entity = entityMap.get(id);
		if (entity) page.entities[id] = { x: entity.x1, y: entity.y1 };
	}
}

/** Main 페이지에서의 위치 */
export function getMainPosition(entity: { id: string; x1: number; y1: number }): Point {
	if (!pageState.current) return { x: entity.x1, y: entity.y1 };
	return pageState.mainPos.get(entity.id) ?? { x: entity.x1, y: entity.y1 };
}

function setVisible(g: Sel<SVGGElement>, visible: boolean): void {
	g.style("display", visible ? "" : "none");
}

/** 현재 페이지에 맞게 엔터티를 보이거나 숨기고 위치를 옮긴다 */
export function showCurrentPage(): void {
	const page = pageState.current;
	const visibleEntities: Entity9[] = [];
	for (const entity of entityMap.values()) {
		const visible = isEntityVisible(entity);
		setVisible(entity.g, visible);
		if (visible) visibleEntities.push(entity);
	}
	// 숨겨진 동안 바뀐 내용은 크기 계산이 안 되었으므로 다시 그림 (모두 그린 후 한 번에 측정)
	Entity9.layoutAll(visibleEntities);
	for (const entity of visibleEntities) {
		const pos = page ? page.entities[entity.id] : pageState.mainPos.get(entity.id);
		if (pos && (pos.x !== entity.x1 || pos.y !== entity.y1)) entity.modifyEntity(pos.x - entity.x1, pos.y - entity.y1, true);	// 관계선은 아래에서 한 번만 계산
	}
	for (const relation of relationMap.values()) {
		const visible = isDiagramVisible(relation);
		setVisible(relation.g, visible);
		if (visible) relation.rePosition();
	}
	for (const item of [...textMap.values(), ...areaMap.values()]) {
		setVisible(item.g, isOnCurrentPage(item));
	}
}

export function switchPage(page: PageData | null): void {
	if (page === pageState.current) return;
	state.selectMgr.deselectDiagram();
	savePagePositions();
	pageState.current = page;
	showCurrentPage();
	renderPageTabs();
}

/** 새 페이지. entities: 처음 넣을 엔터티 (현재 위치 사용) */
export function createPage(name: string, entities: { id: string; x1: number; y1: number }[]): PageData {
	const page: PageData = { id: "pg" + diagramUtil.getUniqueID(), name, entities: {} };
	for (const entity of entities) page.entities[entity.id] = { x: entity.x1, y: entity.y1 };
	pageState.list.push(page);
	state.diagramStack.markModified();
	switchPage(page);
	return page;
}

/** 페이지 삭제. 엔터티는 모델에 남고, 페이지의 글상자와 영역은 삭제 */
export function deletePage(page: PageData): void {
	if (pageState.current === page) switchPage(null);
	for (const item of [...textMap.values(), ...areaMap.values()]) {
		if (item.pageId === page.id) item.removeDiagram();
	}
	pageState.list = pageState.list.filter(item => item !== page);
	state.diagramStack.markModified();
	renderPageTabs();
}

/** 페이지 이름과 엔터티 목록 변경. 새로 넣은 엔터티는 Main 위치에 놓는다 */
export function updatePage(page: PageData, name: string, entityIds: Set<string>): void {
	const isCurrent = page === pageState.current;
	if (isCurrent) savePagePositions();

	page.name = name;
	for (const id of Object.keys(page.entities)) {
		if (!entityIds.has(id)) delete page.entities[id];
	}
	for (const id of entityIds) {
		const entity = entityMap.get(id);
		if (entity && !(id in page.entities)) page.entities[id] = getMainPosition(entity);
	}
	if (isCurrent) {
		state.selectMgr.deselectDiagram();
		showCurrentPage();
	}
	state.diagramStack.markModified();
	renderPageTabs();
}

/** 현재 페이지에서 엔터티만 뺀다 (모델에는 남음) */
export function removeFromCurrentPage(ids: string[]): void {
	const page = pageState.current;
	if (!page) return;
	for (const id of ids) delete page.entities[id];
	state.selectMgr.deselectDiagram();
	showCurrentPage();
	state.diagramStack.markModified();
}

/** 새 문서 */
export function resetPages(pages: PageData[] = []): void {
	pageState.list = pages;
	pageState.current = null;
	pageState.mainPos.clear();
	renderPageTabs();
}

/** 저장할 페이지 목록 (삭제된 엔터티 제외) */
export function getPagesData(): PageData[] {
	savePagePositions();
	return pageState.list.map(page => ({
		id: page.id,
		name: page.name,
		entities: Object.fromEntries(Object.entries(page.entities).filter(([id]) => entityMap.has(id)).map(([id, pos]) => [id, { ...pos }])),
	}));
}

/* -----------------------------------------------------------------------------------
 * 화면 아래 페이지 탭
 */
const openPageDialog = async (page: PageData) => new (await import("../dialogs/pageDialog")).PageDialog9(page);

function newPage(): void {
	const name = prompt("New page name:", "Page " + (pageState.list.length + 1))?.trim();
	if (!name) return;
	// 선택된 엔터티가 있으면 새 페이지에 넣는다
	const selected = state.selectMgr.getSelectList().filter(item => item.diagramType === DIAGRAM_TYPE.ENTITY);
	const page = createPage(name, selected);
	if (selected.length === 0) openPageDialog(page);
}

export function renderPageTabs(): void {
	let bar = document.getElementById("pageTabs");
	if (!bar) {
		bar = diagramUtil.createHTMLElement(document.body, "div", "page-tabs");
		bar.id = "pageTabs";
	}
	bar.replaceChildren();

	const addTab = (page: PageData | null) => {
		const active = page === pageState.current;
		const tab = diagramUtil.createHTMLElement(bar, "div", "page-tab" + (active ? " active" : ""));
		diagramUtil.createHTMLElement(tab, "span", null, page ? page.name : "Main");
		tab.title = page ? `${page.name} (${Object.keys(page.entities).length} entities)\nDouble-click to edit` : "All entities";
		tab.addEventListener("click", () => switchPage(page));
		if (!page) return;
		tab.addEventListener("dblclick", () => openPageDialog(page));
		if (active) {
			const edit = diagramUtil.createHTMLElement(tab, "button", "page-tab-button", "✎");
			edit.title = "Edit page";
			edit.addEventListener("click", (event) => {
				event.stopPropagation();
				openPageDialog(page);
			});
		}
	};
	addTab(null);
	pageState.list.forEach(addTab);

	const add = diagramUtil.createHTMLElement(bar, "button", "page-tab-add", "+");
	add.title = "New page (the selected entities are added to it)";
	add.addEventListener("click", newPage);
}
