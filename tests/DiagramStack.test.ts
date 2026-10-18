// @vitest-environment jsdom
import { select } from "d3-selection";
import { beforeEach, describe, expect, it } from "vitest";
import { STATE_TYPE } from "../src/constants";
import { DiagramStack } from "../src/core/DiagramStack";
import { createManyToMany } from "../src/core/manyToMany";
import { SelectMgr } from "../src/core/SelectMgr";
import { NameCellEditor } from "../src/standard/nameEditor";
import { Area9 } from "../src/diagram/Area9";
import { Entity9 } from "../src/diagram/Entity9";
import { Relation9 } from "../src/diagram/Relation9";
import { areaMap, entityMap, relationMap, state, textMap } from "../src/state";
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
}

function makeEntity(name: string, keyId: string): Entity9 {
	return new Entity9(state.canvas, 0, 0, null, { physicalName: name, keys: [field(keyId, `${name}_id`, "INT", { isPK: true })], fields: [] });
}

describe("DiagramStack", () => {
	beforeEach(setup);

	it("undo / redo entity creation and modification", () => {
		const stack = state.diagramStack;
		const entity = makeEntity("member", "k1");
		stack.saveState(STATE_TYPE.ENTITY_CREATE, entity);

		const backup = structuredClone(entity.data);
		entity.setTableData({ ...structuredClone(entity.data), logicalName: "Member", color: "#e8f0fe" });
		stack.saveState(STATE_TYPE.ENTITY_MODIFY, entity, backup);
		expect(stack.isModified).toBe(true);

		stack.undoState();
		expect(entityMap.get(entity.id)!.data.color).toBeUndefined();
		stack.redoState();
		expect(entityMap.get(entity.id)!.data).toMatchObject({ logicalName: "Member", color: "#e8f0fe" });

		stack.undoState();
		stack.undoState();
		expect(entityMap.size).toBe(0);
		stack.redoState();
		expect(entityMap.size).toBe(1);
	});

	it("restores relation options when a removed relation is undone", () => {
		const parent = makeEntity("member", "k1"), child = makeEntity("orders", "k2");
		const relation = Relation9.create(state.canvas, parent, child, true, "ak", null, { name: "fk_orders", onDelete: "CASCADE", relationCard: "one" })!;
		expect(child.data.fields[0]).toMatchObject({ column: "member_id", parentID: "k1" });

		state.diagramStack.saveState(STATE_TYPE.RELATION_REMOVE, relation);
		relation.removeDiagram();
		expect(relationMap.size).toBe(0);

		state.diagramStack.undoState();
		const restored = relationMap.get(relation.id)!;
		expect(restored.getOption()).toMatchObject({ name: "fk_orders", onDelete: "CASCADE", relationCard: "one" });
	});

	it("relation option changes are undoable", () => {
		const relation = Relation9.create(state.canvas, makeEntity("a", "k1"), makeEntity("b", "k2"), true, "ak")!;
		const backup = relation.getOption();
		relation.changeRelation({ ...backup, onUpdate: "SET NULL", name: "fk_b" });
		state.diagramStack.saveState(STATE_TYPE.RELATION_MODIFY, relation, backup);

		state.diagramStack.undoState();
		expect(relation.onUpdate).toBeUndefined();
		expect(relation.name).toBeUndefined();
		state.diagramStack.redoState();
		expect(relation.getOption()).toMatchObject({ onUpdate: "SET NULL", name: "fk_b" });
	});

	it("area resize and contained diagrams", () => {
		const area = new Area9(state.canvas, 0, 0);
		const backup = area.getData();
		area.resize(400, 300);
		state.diagramStack.saveState(STATE_TYPE.ENTITY_MODIFY, area, backup);
		state.diagramStack.undoState();
		expect(area.data.width).toBe(backup.width);

		const entity = makeEntity("member", "k1");
		entity.rePosition(20, 20);
		expect(area.getContainedDiagrams()).toContain(entity);
	});

	it("M:N creates a mapping table that undo / redo as one step", () => {
		const student = makeEntity("student", "k1"), course = makeEntity("course", "k2");
		const mapping = createManyToMany(student, course)!;
		expect(mapping.data.physicalName).toBe("student_course");
		expect(mapping.data.keys.map(k => [k.column, k.parentID])).toEqual([["student_id", "k1"], ["course_id", "k2"]]);
		expect(relationMap.size).toBe(2);

		state.diagramStack.undoState();
		expect(entityMap.has(mapping.id)).toBe(false);
		expect(relationMap.size).toBe(0);
		state.diagramStack.redoState();
		expect(entityMap.has(mapping.id)).toBe(true);
		expect(relationMap.size).toBe(2);
	});

	it("exportState / importState keeps the undo history (autosave)", () => {
		const entity = makeEntity("member", "k1");
		state.diagramStack.saveState(STATE_TYPE.ENTITY_CREATE, entity);
		const saved = JSON.parse(JSON.stringify(state.diagramStack.exportState()));

		const stack = new DiagramStack();
		stack.importState(saved);
		state.diagramStack = stack;
		stack.undoState();
		expect(entityMap.size).toBe(0);
	});
});
