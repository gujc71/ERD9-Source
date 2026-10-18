// @vitest-environment jsdom
import { select } from "d3-selection";
import { beforeEach, describe, expect, it } from "vitest";
import { DiagramStack, MULTY_MODIFY } from "../src/core/DiagramStack";
import { SelectMgr } from "../src/core/SelectMgr";
import { Entity9 } from "../src/diagram/Entity9";
import { applyIssues, syncDomainFields } from "../src/standard/applyStandards";
import { ISSUE_KIND } from "../src/standard/standards";
import { NameCellEditor } from "../src/standard/nameEditor";
import { areaMap, docObjects, entityMap, relationMap, state, textMap } from "../src/state";
import { field } from "./fixtures";

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
	docObjects.domains = [{ id: "d1", name: "NAME", dataType: "VARCHAR(50)" }, { id: "d2", name: "AMOUNT", dataType: "DECIMAL(10,2)", notNull: true }];
}

function makeEntities(count: number): Entity9[] {
	const list: Entity9[] = [];
	for (let i = 0; i < count; i++) {
		list.push(new Entity9(state.canvas, 0, 0, null, {
			physicalName: "t" + i,
			keys: [field(`k${i}`, "id", "INT", { isPK: true, notNull: true })],
			fields: [field(`n${i}`, "name", "VARCHAR(50)", { domain: "d1" }), field(`a${i}`, "amount", "DECIMAL(10,2)", { domain: "d2", notNull: true })],
		}));
	}
	return list;
}

describe("domain / standards apply as one undo step", () => {
	beforeEach(setup);

	it("syncDomainFields saves one MULTY_MODIFY item even for more entities than the undo limit", () => {
		const entities = makeEntities(150);
		const stack = state.diagramStack;
		stack.clearState();

		// 바뀌는 것이 없으면 기록하지 않는다
		expect(syncDomainFields()).toBe(0);
		expect(stack.stateStack).toHaveLength(0);

		docObjects.domains[0].dataType = "VARCHAR(100)";
		expect(syncDomainFields()).toBe(150);
		expect(stack.stateStack).toHaveLength(1);
		expect(stack.stateStack[0].workType).toBe(MULTY_MODIFY);
		expect(entities.every(e => e.data.fields[0].dataType === "VARCHAR(100)")).toBe(true);
		// 다른 컬럼은 그대로
		expect(entities[0].data.fields[1]).toMatchObject({ dataType: "DECIMAL(10,2)", notNull: true });

		stack.undoState();
		expect(entities.every(e => entityMap.get(e.id)!.data.fields[0].dataType === "VARCHAR(50)")).toBe(true);
		stack.redoState();
		expect(entities.every(e => entityMap.get(e.id)!.data.fields[0].dataType === "VARCHAR(100)")).toBe(true);

		// 자동 저장 형식으로 저장 후 복원해도 실행취소 가능
		const saved = JSON.parse(JSON.stringify(stack.exportState()));
		const restored = new DiagramStack();
		restored.importState(saved);
		state.diagramStack = restored;
		restored.undoState();
		expect(entityMap.get(entities[149].id)!.data.fields[0].dataType).toBe("VARCHAR(50)");
	});

	it("removed domains are unlinked and notNull follows the domain", () => {
		const [entity] = makeEntities(1);
		docObjects.domains = [{ id: "d2", name: "AMOUNT", dataType: "DECIMAL(10,2)" }];
		expect(syncDomainFields()).toBe(1);
		expect(entity.data.fields[0]).not.toHaveProperty("domain");
		expect(entity.data.fields[1]).not.toHaveProperty("notNull");
		expect(entity.data.keys[0].notNull).toBe(true);
		state.diagramStack.undoState();
		expect(entityMap.get(entity.id)!.data.fields[0].domain).toBe("d1");
		expect(entityMap.get(entity.id)!.data.fields[1].notNull).toBe(true);
	});

	it("applyIssues renames columns in one undo step", () => {
		const entities = makeEntities(3);
		const stack = state.diagramStack;
		stack.clearState();
		const issues = entities.map(e => ({ entityId: e.id, fieldId: e.data.fields[0].id, table: e.data.physicalName, column: "name", comment: "",
			kind: ISSUE_KIND.NAME, message: "", suggestion: "CUST_NM" }));
		expect(applyIssues(issues).applied).toBe(3);
		expect(stack.stateStack).toHaveLength(1);
		expect(entities.map(e => entityMap.get(e.id)!.data.fields[0].column)).toEqual(["CUST_NM", "CUST_NM", "CUST_NM"]);
		stack.undoState();
		expect(entities.map(e => entityMap.get(e.id)!.data.fields[0].column)).toEqual(["name", "name", "name"]);
	});
});
