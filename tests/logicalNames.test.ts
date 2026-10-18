// @vitest-environment jsdom
import { select } from "d3-selection";
import { describe, expect, it } from "vitest";
import { DiagramStack, MULTY_MODIFY } from "../src/core/DiagramStack";
import { SelectMgr } from "../src/core/SelectMgr";
import { Entity9 } from "../src/diagram/Entity9";
import { applyLogicalNames, findLogicalNames, parseDictionaryCSV, splitPhysicalName, toLogicalName } from "../src/standard/logicalNames";
import { NameCellEditor } from "../src/standard/nameEditor";
import { areaMap, entityMap, relationMap, state, textMap } from "../src/state";
import { field } from "./fixtures";

const en = parseDictionaryCSV("﻿USER,사용자\r\nABNORMAL,비정상\r\nABNORMAL FINDING,이상소견\r\nNAME,이름\r\n");
const abbr = parseDictionaryCSV("NM,명\nID,아이디\nUSER,유저\n");

describe("logicalNames", () => {
	it("parses CSV with BOM and keeps the first value", () => {
		expect(en.get("USER")).toBe("사용자");
		expect(en.get("ABNORMAL FINDING")).toBe("이상소견");
	});

	it("splits physical names", () => {
		expect(splitPhysicalName("user_nm")).toEqual(["user", "nm"]);
		expect(splitPhysicalName("userId")).toEqual(["user", "Id"]);
	});

	it("translates with dictionaries in order and keeps unknown words", () => {
		expect(toLogicalName("USER_NM", [en, abbr])).toBe("사용자 명");
		expect(toLogicalName("user_nm", [abbr, en])).toBe("유저 명");
		expect(toLogicalName("USER_XYZ", [en])).toBe("사용자 XYZ");
		expect(toLogicalName("ABNORMAL_FINDING_ID", [en, abbr])).toBe("이상소견 아이디");
	});

	it("returns null when no word is found", () => {
		expect(toLogicalName("XYZ_QQ", [en, abbr])).toBeNull();
	});
});

describe("find / apply logical names", () => {
	function setup(): Entity9 {
		document.body.innerHTML = "<svg width='1000' height='1000'></svg>";
		[entityMap, relationMap, textMap, areaMap].forEach(map => map.clear());
		state.svg = select<SVGSVGElement, unknown>("svg");
		state.canvas = state.svg.append("g");
		state.selectMgr = new SelectMgr(state.canvas);
		state.diagramStack = new DiagramStack();
		state.nameEditor = new NameCellEditor();
		return new Entity9(state.canvas, 0, 0, null, {
			physicalName: "USER", logicalName: "USER",
			keys: [field("k1", "USER_ID", "INT", { isPK: true, notNull: true })],
			fields: [field("f1", "USER_NM", "VARCHAR(50)", { comment: "이름" }), field("f2", "XYZ", "INT")],
		});
	}

	it("previews without changing the entity, then applies checked items in one undo step", () => {
		const entity = setup();
		const changes = findLogicalNames([entity], [en, abbr], { overwrite: false, includeTables: true });
		expect(changes.map(c => [c.column, c.after])).toEqual([["", "사용자"], ["USER_ID", "사용자 아이디"]]);
		expect(entity.data.keys[0].comment).toBeUndefined();

		const overwrite = findLogicalNames([entity], [en, abbr], { overwrite: true, includeTables: false });
		expect(overwrite.map(c => c.column)).toEqual(["USER_ID", "USER_NM"]);

		expect(applyLogicalNames(changes)).toBe(2);
		const applied = entityMap.get(entity.id)!.data;
		expect(applied.logicalName).toBe("사용자");
		expect(applied.keys[0].comment).toBe("사용자 아이디");
		expect(applied.fields[0].comment).toBe("이름");
		expect(state.diagramStack.stateStack).toHaveLength(1);
		expect(state.diagramStack.stateStack[0].workType).toBe(MULTY_MODIFY);

		state.diagramStack.undoState();
		expect(entityMap.get(entity.id)!.data.keys[0].comment).toBeUndefined();
	});
});
