import { describe, expect, it } from "vitest";
import { canonicalize, compareForSync } from "../src/database/sync";
import { collectForeignKeys, diffERD } from "../src/sql/ERDDiff";
import type { ERDFileData } from "../src/types";
import { addTable, emptyDoc, field } from "./fixtures";

/** member + 자식 테이블 count개 (각각 member를 참조) */
function manyChildren(count: number): ERDFileData {
	const doc = emptyDoc();
	addTable(doc, "p", { physicalName: "member", keys: [field("m1", "member_id", "INT", { isPK: true, notNull: true })], fields: [] });
	for (let i = 0; i < count; i++) {
		addTable(doc, "c" + i, {
			physicalName: "child" + i,
			keys: [field(`k${i}`, "id", "INT", { isPK: true, notNull: true })],
			fields: [field(`f${i}`, "member_id", "INT", { parent: "member", parentID: "m1" })],
		});
		doc.relationData.push({ id: "r" + i, parent: "p", child: "c" + i, relationType: "ak", relationCard: "many", relationSelect: "mm", name: "fk_" + i });
	}
	return doc;
}

describe("foreign key matching (grouped)", () => {
	it("matches unchanged foreign keys and keeps the order of changed ones", () => {
		const base = manyChildren(40), current = manyChildren(40);
		// 일부만 변경: 참조 동작, 이름
		current.relationData[3].onDelete = "CASCADE";
		current.relationData[17].name = "fk_renamed";
		current.relationData[29].onUpdate = "SET NULL";
		// 순서를 섞어도 결과는 새 문서의 순서
		current.relationData.reverse();

		const diff = diffERD(base, current);
		expect(diff.removedForeignKeys.map(fk => fk.name)).toEqual(["fk_3", "fk_17", "fk_29"]);
		expect(diff.addedForeignKeys.map(fk => fk.name)).toEqual(["fk_29", "fk_renamed", "fk_3"]);
		expect(diffERD(base, manyChildren(40)).addedForeignKeys).toEqual([]);
	});

	it("matches duplicated identical foreign keys one to one", () => {
		const base = manyChildren(1), current = manyChildren(1);
		// 같은 관계가 두 번 (비정상 문서): 기존 하나와 새 둘 -> 하나만 추가로
		current.relationData.push({ ...current.relationData[0], id: "dup" });
		current.relationData[1].name = "fk_0";
		const newFKs = collectForeignKeys(current);
		const diff = diffERD(base, current);
		expect(diff.removedForeignKeys).toEqual([]);
		expect(diff.addedForeignKeys).toEqual([newFKs[1]]);
	});
});

describe("sync helpers", () => {
	it("canonicalize keeps only the first table of the same name", () => {
		const doc = manyChildren(2);
		addTable(doc, "dup", { physicalName: "MEMBER", keys: [field("x1", "x", "INT", { isPK: true })], fields: [] });
		const canonical = canonicalize(doc);
		expect(Object.keys(canonical.entityData).sort()).toEqual(["CHILD0", "CHILD1", "MEMBER"]);
		expect(canonical.entityData.MEMBER.data.keys[0].id).toBe("MEMBER.MEMBER_ID");
		expect(canonical.relationData).toHaveLength(2);
	});

	it("groups foreign key only differences by child table", () => {
		const db = canonicalize(manyChildren(5)), model = manyChildren(5);
		model.relationData[1].onDelete = "CASCADE";
		model.relationData[4].name = "fk_x";
		const items = compareForSync(db, canonicalize(model));
		expect(items.map(item => [item.key, item.status])).toEqual([["CHILD1", "different"], ["CHILD4", "different"]]);
		// 다른 테이블의 외래키는 섞이지 않는다
		expect(items[1].details.some(line => line.includes("fk_x"))).toBe(true);
		expect(items[1].details.some(line => line.includes("fk_1"))).toBe(false);
		expect(items[0].details.some(line => line.includes("fk_1"))).toBe(true);
	});
});
