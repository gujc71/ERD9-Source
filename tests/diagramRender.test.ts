// @vitest-environment jsdom
import { select } from "d3-selection";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ENTITY_LAYOUT, RELATION_CARDINALITY, RELATION_SELECTION, VIEW_DATA, VIEW_MODE } from "../src/constants";
import { DiagramStack } from "../src/core/DiagramStack";
import { showCurrentPage } from "../src/core/pages";
import { SelectMgr } from "../src/core/SelectMgr";
import { Area9 } from "../src/diagram/Area9";
import { Entity9 } from "../src/diagram/Entity9";
import { Relation9 } from "../src/diagram/Relation9";
import { Text9 } from "../src/diagram/Text9";
import { NameCellEditor } from "../src/standard/nameEditor";
import { areaMap, entityMap, relationMap, state, textMap } from "../src/state";
import type { EntityData } from "../src/types";
import { field } from "./fixtures";

/** jsdom에는 레이아웃이 없으므로 getBBox를 글자 수로 흉내 (글자당 6, 줄당 14) */
const CHAR_WIDTH = 6;
function fakeBBox(this: SVGElement): DOMRect {
	const spans = [...this.querySelectorAll("tspan")];
	const lines = spans.length > 0 ? spans.map(span => span.textContent ?? "") : [this.textContent ?? ""];
	const width = Math.max(0, ...lines.map(line => line.length * CHAR_WIDTH));
	return { x: 0, y: 0, width, height: lines.length * 14 } as DOMRect;
}

beforeAll(() => {
	(SVGElement.prototype as unknown as { getBBox: unknown }).getBBox = fakeBBox;
});
afterAll(() => {
	delete (SVGElement.prototype as unknown as { getBBox?: unknown }).getBBox;
});

function setup(): void {
	document.body.innerHTML = "<svg width='1000' height='1000'></svg>";
	entityMap.clear();
	relationMap.clear();
	textMap.clear();
	areaMap.clear();
	state.svg = select<SVGSVGElement, unknown>("svg");
	state.canvas = state.svg.append("g");
	state.selectMgr = new SelectMgr(state.canvas);
	state.diagramStack = new DiagramStack();
	state.nameEditor = new NameCellEditor();
	state.diagramMenu = state.canvas.append("text");
	state.svgRate = 1;
	state.viewData = VIEW_DATA.ALL;
	state.viewMode = VIEW_MODE.PHYSICAL;
}

function memberData(): EntityData {
	// "member_id : INT" = 15자, "name : VARCHAR(50)" = 18자
	return { physicalName: "member", keys: [field("k1", "member_id", "INT", { isPK: true })], fields: [field("f1", "name", "VARCHAR(50)")] };
}

const width = (entity: Entity9) => entity.x2 - entity.x1;
const spanTexts = (text: Element) => [...text.querySelectorAll("tspan")].map(span => span.textContent);

/**
 * 개체 폭: PK/FK 표시 열 + 이름 열 + 간격 + 타입 열 + 오른쪽 여백 (최소 MIN_WIDTH).
 * memberData: 이름 열은 "member_id"(9자), 타입 열은 "VARCHAR(50)"(11자)
 */
const { PADDING_X, BADGE_WIDTH, COLUMN_GAP, MIN_WIDTH, HEADER_HEIGHT } = ENTITY_LAYOUT;
const columnsWidth = (nameChars: number, typeChars: number) =>
	PADDING_X + BADGE_WIDTH + nameChars * CHAR_WIDTH + COLUMN_GAP + typeChars * CHAR_WIDTH + PADDING_X;

describe("Entity9 width", () => {
	beforeEach(setup);
	afterEach(() => { state.svgRate = 1; });

	it("is computed from the column widths and does not grow on every save", () => {
		const entity = new Entity9(state.canvas, 0, 0, null, memberData());
		const expected = columnsWidth(9, 11);
		expect(width(entity)).toBe(expected);
		expect(entity.fieldRect.attr("width")).toBe(String(expected));

		entity.setData(entity.data);
		entity.setData(entity.data);
		expect(width(entity)).toBe(expected);
	});

	it("shrinks when the text gets shorter, but not below the minimum width", () => {
		const entity = new Entity9(state.canvas, 0, 0, null, memberData());
		entity.setTableData({ ...memberData(), fields: [field("f1", "nickname_text", "INT")] });
		expect(width(entity)).toBe(columnsWidth(13, 3));
		entity.setTableData({ physicalName: "member", keys: [field("k1", "id", "INT", { isPK: true })], fields: [] });
		expect(width(entity)).toBe(MIN_WIDTH);
	});

	it("does not depend on the zoom rate; entity view shows only the header", () => {
		state.svgRate = 2;
		const entity = new Entity9(state.canvas, 0, 0, null, memberData());
		expect(width(entity)).toBe(columnsWidth(9, 11));
		state.viewData = VIEW_DATA.ENTITY;
		entity.changeViewData();
		expect(width(entity)).toBe(Math.round("member".length * CHAR_WIDTH + PADDING_X * 2));
		expect(entity.y2 - entity.y1).toBe(HEADER_HEIGHT);
	});

	it("deferLayout draws without measuring; layoutAll measures later", () => {
		const entity = new Entity9(state.canvas, 10, 0, null, memberData(), true);
		expect(width(entity)).toBe(MIN_WIDTH);
		expect(spanTexts(entity.fieldText.node()!)).toEqual(["name"]);
		Entity9.layoutAll([entity]);
		expect(width(entity)).toBe(columnsWidth(9, 11));
	});

	it("height fits the rows (no fixed empty space)", () => {
		const { ROW_HEIGHT, SECTION_PADDING, EMPTY_SECTION_HEIGHT } = ENTITY_LAYOUT;
		const entity = new Entity9(state.canvas, 0, 0, null, memberData());
		expect(entity.y2 - entity.y1).toBe(HEADER_HEIGHT + 2 * (SECTION_PADDING * 2 + ROW_HEIGHT));
		const empty = new Entity9(state.canvas, 0, 0, null, { physicalName: "empty", keys: [], fields: [] });
		expect(empty.y2 - empty.y1).toBe(HEADER_HEIGHT + 2 * EMPTY_SECTION_HEIGHT);
	});

	it("shows the data type in its own column and marks keys", () => {
		const entity = new Entity9(state.canvas, 0, 0, null, memberData());
		expect(spanTexts(entity.keyFieldText.node()!)).toEqual(["member_id"]);
		expect(entity.g.select("text.erd-col-type.erd-keys").text()).toBe("INT");
		expect(entity.g.select("text.erd-badge.erd-keys").text()).toBe("PK");
		// 타입 열은 같은 x에서 시작
		const typeX = [...entity.g.node()!.querySelectorAll("text.erd-col-type tspan")].map(span => span.getAttribute("x"));
		expect(new Set(typeX).size).toBe(1);
	});
});

describe("Entity9 view", () => {
	beforeEach(setup);

	it("KEYS view keeps showing only FK fields when the view mode changes", () => {
		const parent = new Entity9(state.canvas, 0, 0, null, memberData());
		const child = new Entity9(state.canvas, 300, 0, null, {
			physicalName: "orders", keys: [field("o1", "order_id", "INT", { isPK: true })],
			fields: [field("o2", "amount", "INT", { comment: "Amount" }), field("o3", "member_id", "INT", { comment: "Member", parent: "member", parentID: "k1" })],
		});
		Relation9.create(state.canvas, parent, child, false, "ak");

		state.viewData = VIEW_DATA.KEYS;
		Entity9.layoutAll(entityMap.values());
		expect(spanTexts(child.fieldText.node()!)).toEqual(["member_id"]);
		expect(child.g.select("text.erd-badge.erd-fields").text()).toBe("FK");

		state.viewMode = VIEW_MODE.LOGICAL;
		child.changeViewMode();
		expect(spanTexts(child.fieldText.node()!)).toEqual(["Member"]);
	});

	it("selecting an entity marks the FK fields of its relations once per relation", () => {
		const parent = new Entity9(state.canvas, 0, 0, null, memberData());
		const child = new Entity9(state.canvas, 300, 0, null, { physicalName: "orders", keys: [field("o1", "order_id", "INT", { isPK: true })], fields: [] });
		Relation9.create(state.canvas, parent, child, true, "ak");
		const spy = vi.spyOn(child, "selectChildField");

		state.selectMgr.deselectDiagram(parent, state.diagramMenu);
		expect(spy).toHaveBeenCalledTimes(1);
		const fk = child.data.fields.find(fld => fld.parentID === "k1")!;
		const span = child.fieldText.node()!.querySelector(`tspan[id="${fk.id}"]`)!;
		expect(span.classList.contains("selectedField")).toBe(true);
		expect(span.classList.contains("childRelation")).toBe(true);
		// 다른 필드는 표시하지 않음
		expect(child.g.node()!.querySelectorAll("tspan.selectedField").length).toBe(1);

		state.selectMgr.deselectDiagram();
		expect(child.g.node()!.querySelectorAll("tspan.selectedField").length).toBe(0);
	});
});

describe("showCurrentPage", () => {
	beforeEach(setup);

	it("computes each relation only once", () => {
		const a = new Entity9(state.canvas, 0, 0, null, memberData());
		const b = new Entity9(state.canvas, 300, 0, null, { physicalName: "b", keys: [field("b1", "b_id", "INT", { isPK: true })], fields: [] });
		const c = new Entity9(state.canvas, 0, 300, null, { physicalName: "c", keys: [field("c1", "c_id", "INT", { isPK: true })], fields: [] });
		Relation9.create(state.canvas, a, b, true, "ak");
		Relation9.create(state.canvas, b, c, true, "ak");
		Relation9.create(state.canvas, a, c, true, "ak");

		const spy = vi.spyOn(Relation9.prototype, "makeRelation");
		showCurrentPage();
		expect(spy).toHaveBeenCalledTimes(relationMap.size);
		spy.mockRestore();
	});
});

describe("Relation9 geometry", () => {
	beforeEach(setup);

	const table = (name: string, extra: Partial<EntityData> = {}): EntityData => ({
		physicalName: name, keys: [field(`${name}_k`, `${name}_id`, "INT", { isPK: true })], fields: [], ...extra,
	});
	const lineD = (relation: Relation9) => relation.g.select("path.erd-line").attr("d");

	it("relations on the same side of an entity get separate anchors", () => {
		const parent = new Entity9(state.canvas, 0, 0, null, table("p"));
		const upper = new Entity9(state.canvas, 400, -200, null, table("a"));
		const lower = new Entity9(state.canvas, 400, 300, null, table("b"));
		const r1 = Relation9.create(state.canvas, parent, upper, false, "ak")!;
		const r2 = Relation9.create(state.canvas, parent, lower, false, "ak")!;
		expect(r1.x1).toBe(parent.x2);
		expect(r2.x1).toBe(parent.x2);
		expect(r1.y1).toBeLessThan(r2.y1);		// 위쪽 자식으로 가는 선이 위
	});

	it("connects to the FK column row and the referenced key row", () => {
		const parent = new Entity9(state.canvas, 0, 0, null, memberData());
		const child = new Entity9(state.canvas, 400, 100, null, {
			physicalName: "orders", keys: [field("o1", "order_id", "INT", { isPK: true })],
			fields: [field("o2", "amount", "INT"), field("o3", "member_id", "INT", { parent: "member", parentID: "k1" })],
		});
		const relation = Relation9.create(state.canvas, parent, child, false, "ak")!;
		expect(relation.y1).toBe(parent.getFieldAnchorY("k1"));
		expect(relation.y2).toBe(child.getFieldAnchorY("o3"));
		expect(relation.route).toHaveLength(4);
	});

	it("keeps the bend set by the user (ratio between the two ends)", () => {
		const parent = new Entity9(state.canvas, 0, 0, null, table("p"));
		const child = new Entity9(state.canvas, 500, 200, null, table("c"));
		const relation = Relation9.create(state.canvas, parent, child, false, "ak")!;
		expect(relation.canBend()).toBe(true);
		relation.setBendAt(relation.x1 + (relation.x2 - relation.x1) / 4, 0);
		expect(relation.bend).toBeCloseTo(0.25, 2);
		expect(relation.route[1].x).toBe(Math.round(relation.x1 + (relation.x2 - relation.x1) * relation.bend!));
		// 개체를 옮겨도 비율 유지
		child.rePosition(700, 200);
		expect(relation.route[1].x).toBe(Math.round(relation.x1 + (relation.x2 - relation.x1) * relation.bend!));
		expect(relation.getOption().bend).toBe(relation.bend);
	});

	it("routes the middle segment around another entity", () => {
		const parent = new Entity9(state.canvas, 0, 0, null, table("p"));
		const child = new Entity9(state.canvas, 600, 300, null, { physicalName: "c", keys: [], fields: [] });
		const fields = Array.from({ length: 8 }, (_v, i) => field(`x${i}`, `col${i}`, "INT"));
		const obstacle = new Entity9(state.canvas, 330, 100, null, { physicalName: "obstacle", keys: [], fields });
		const relation = Relation9.create(state.canvas, parent, child, false, "ak")!;
		const middle = relation.route[1].x;
		const margin = 10;
		expect(middle <= obstacle.x1 - margin || middle >= obstacle.x2 + margin).toBe(true);
	});

	it("draws a jump where a horizontal segment crosses another relation", () => {
		const p1 = new Entity9(state.canvas, 0, 0, null, table("p1"));
		const c1 = new Entity9(state.canvas, 600, 300, null, table("c1"));
		const p2 = new Entity9(state.canvas, 0, 150, null, table("p2"));
		const c2 = new Entity9(state.canvas, 600, -150, null, table("c2"));
		const r1 = Relation9.create(state.canvas, p1, c1, false, "ak")!;
		const r2 = Relation9.create(state.canvas, p2, c2, false, "ak", null, { bend: 0.3 })!;
		Relation9.updateJumps();
		const crossesFirst = (relation: Relation9, other: Relation9) => {
			const vertical = other.route[1];
			const [a, b] = [relation.route[0], relation.route[1]];
			return vertical.x > Math.min(a.x, b.x) && vertical.x < Math.max(a.x, b.x);
		};
		expect(crossesFirst(r1, r2)).toBe(true);
		expect(lineD(r1)).toMatch(/ A 4 4 /);
		expect(lineD(r2)).not.toMatch(/ A /);
	});

	it("draws IE notation: circles for optional ends, solid markers apart from the dashed line", () => {
		const parent = new Entity9(state.canvas, 0, 0, null, table("p"));
		const child = new Entity9(state.canvas, 400, 0, null, table("c"));
		const relation = Relation9.create(state.canvas, parent, child, false, "ak", null,
			{ relationSelect: RELATION_SELECTION.OO, relationCard: RELATION_CARDINALITY.O2M })!;
		expect(relation.g.selectAll("circle.erd-rel-circle").size()).toBe(2);
		expect(relation.g.select("path.erd-line").attr("stroke-dasharray")).toBe("5 4");
		expect(relation.g.select("path.erd-marker").attr("stroke-dasharray")).toBeNull();
		// 까마귀발: 한 점에서 세 갈래
		const marker = relation.g.select("path.erd-marker").attr("d");
		const tip = `${relation.x2 - 12},${relation.y2}`;
		expect(marker.split(`M ${tip}`).length - 1).toBe(3);

		relation.changeRelation({ ...relation.getOption(), relationSelect: RELATION_SELECTION.MM });
		expect(relation.g.selectAll("circle.erd-rel-circle").size()).toBe(0);
	});

	it("self relation loops on the right side and cannot be bent", () => {
		const entity = new Entity9(state.canvas, 0, 0, null, table("tree"));
		const relation = Relation9.create(state.canvas, entity, entity, false, "ak")!;
		expect(relation.route).toHaveLength(4);
		expect(relation.route[0].x).toBe(entity.x2);
		expect(relation.canBend()).toBe(false);
	});

	it("shows the label in the middle of the line", () => {
		const parent = new Entity9(state.canvas, 0, 0, null, table("p"));
		const child = new Entity9(state.canvas, 400, 0, null, table("c"));
		const relation = Relation9.create(state.canvas, parent, child, false, "ak", null, { label: "places" })!;
		expect(relation.g.select("text.erd-rel-label-text").text()).toBe("places");
		relation.changeRelation({ ...relation.getOption(), label: undefined });
		expect(relation.g.select("text.erd-rel-label-text").empty()).toBe(true);
	});
});

describe("move with transform", () => {
	beforeEach(setup);

	it("moving an entity, text or area changes only the group transform", () => {
		const entity = new Entity9(state.canvas, 10, 20, null, memberData());
		const text = new Text9(state.canvas, 10, 20, null, "hello");
		const area = new Area9(state.canvas, 10, 20);
		const snapshot = (g: Element) => [...g.querySelectorAll("*")].map(el => el.outerHTML).join("");
		const before = [entity, text, area].map(item => snapshot(item.g.node()!));

		for (const item of [entity, text, area]) item.modifyEntity(5, 7);
		expect([entity, text, area].map(item => snapshot(item.g.node()!))).toEqual(before);
		for (const item of [entity, text, area]) {
			expect(item.g.attr("transform")).toBe("translate(15,27)");
			expect([item.x1, item.y1]).toEqual([15, 27]);
		}
		expect(entity.keyFieldText.select("tspan").attr("x")).toBe(String(ENTITY_LAYOUT.PADDING_X + ENTITY_LAYOUT.BADGE_WIDTH));
		expect(area.x2).toBe(15 + area.data.width);
	});
});

describe("Text9 and SelectMgr", () => {
	beforeEach(setup);

	it("Text9 size comes from the text and does not grow; x2/y2 follow moves", () => {
		const text = new Text9(state.canvas, 50, 50, null, "hello");
		const rect = text.getClientRect();
		expect(rect).toEqual({ x1: 48, y1: 38, x2: 48 + 5 * CHAR_WIDTH + 4, y2: 38 + 14 + 4 });
		text.setData("hello");
		text.setData("hello");
		expect(text.getClientRect()).toEqual(rect);
		text.modifyEntity(10, 20);
		expect(text.getClientRect()).toEqual({ x1: 58, y1: 58, x2: rect.x2 + 10, y2: rect.y2 + 20 });
	});

	it("range select uses the stored text rect, and selection lookups are deduplicated", () => {
		const text = new Text9(state.canvas, 50, 50, null, "hello");
		new Text9(state.canvas, 500, 500, null, "far");
		const entity = new Entity9(state.canvas, 0, 0, null, memberData());
		const mgr = state.selectMgr;

		mgr.setPosition(40, 40, 60, 60);
		mgr.selectDiagram();
		expect(mgr.getSelectList()).toEqual([entity, text]);
		expect(mgr.isInSelectList(text)).toBe(true);

		mgr.addSelectDiagram(text);
		expect(mgr.getSelectList().length).toBe(2);

		mgr.deselectDiagram();
		expect(mgr.isInSelectList(text)).toBe(false);
		expect(mgr.getSelectList().length).toBe(0);
	});
});
