import { describe, expect, it } from "vitest";
import { collectForeignKeys, diffERD, isEmptyDiff, makeAlterScript, summarizeDiff } from "../src/sql/ERDDiff";
import { sqlMakerManager } from "../src/sql/SQLMaker";
import { addTable, field, shopDoc } from "./fixtures";

describe("ERDDiff", () => {
	it("no differences for the same document", () => {
		expect(isEmptyDiff(diffERD(shopDoc(), shopDoc()))).toBe(true);
	});

	it("collects foreign keys from the relations", () => {
		expect(collectForeignKeys(shopDoc())).toMatchObject([{ name: "fk_orders_member", info: { childTable: "orders", childFields: "member_id", parentTable: "member", parentFields: "member_id" } }]);
	});

	it("detects column changes and renames by id", () => {
		const base = shopDoc(), current = shopDoc();
		const member = current.entityData.e1.data;
		member.fields[0] = { ...member.fields[0], column: "full_name" };			// 이름 변경 (같은 id)
		member.indexes = [{ name: "ix_member_name", fields: "full_name" }];		// 색인도 새 이름을 가리킴
		member.fields[1] = { ...member.fields[1], dataType: "VARCHAR(200)" };	// 타입 변경
		member.fields.push(field("m4", "phone", "VARCHAR(20)"));				// 추가
		current.entityData.e2.data.fields.pop();								// amount 삭제

		const diff = diffERD(base, current);
		const memberDiff = diff.tables.find(t => t.newTable?.physicalName === "member")!;
		expect(memberDiff.addedColumns.map(f => f.column)).toEqual(["phone"]);
		expect(memberDiff.changedColumns.map(c => [c.oldField.column, c.newField.column, c.renamed, c.definitionChanged]))
			.toEqual([["name", "full_name", true, false], ["email", "email", false, true]]);
		// 컬럼명이 바뀌어도 색인은 그대로 (DB가 따라서 바꿈)
		expect(memberDiff.addedIndexes).toEqual([]);

		const script = makeAlterScript(diff, sqlMakerManager.getMaker("mariadb"));
		expect(script).toContain("ALTER TABLE member RENAME COLUMN name TO full_name;");
		expect(script).toContain("ALTER TABLE member MODIFY COLUMN email    VARCHAR(200);");
		expect(script).toContain("ALTER TABLE member ADD COLUMN phone    VARCHAR(20);");
		expect(script).toContain("ALTER TABLE orders DROP COLUMN amount;");
		expect(script).toContain("WARNING");
		// 외래키는 그대로
		expect(script).not.toContain("FOREIGN KEY");
	});

	it("orders drops before creates and handles added / removed tables and foreign keys", () => {
		const base = shopDoc(), current = shopDoc();
		delete current.entityData.e2;
		current.relationData = [];
		addTable(current, "e3", {
			physicalName: "address",
			keys: [field("a1", "address_id", "INT", { isPK: true, notNull: true })],
			fields: [field("a2", "member_id", "INT", { parent: "member", parentID: "m1" })],
		});
		current.relationData.push({ id: "r2", parent: "e1", child: "e3", relationType: "ak", relationCard: "many", relationSelect: "mm", onDelete: "CASCADE" });

		const diff = diffERD(base, current);
		expect(summarizeDiff(diff)).toEqual(expect.arrayContaining(["- Table orders", "+ Table address", "+ Foreign key r2 (address → member)"]));

		const script = makeAlterScript(diff, sqlMakerManager.getMaker("postgresql"));
		// 삭제되는 테이블의 외래키는 따로 지우지 않음
		expect(script).not.toContain("DROP CONSTRAINT fk_orders_member");
		expect(script.indexOf("DROP TABLE orders;")).toBeLessThan(script.indexOf("CREATE TABLE address"));
		expect(script.indexOf("CREATE TABLE address")).toBeLessThan(script.indexOf("ADD CONSTRAINT r2 FOREIGN KEY"));
		expect(script).toContain("REFERENCES member ( member_id ) ON DELETE CASCADE;");
	});

	it("detects table rename, primary key, index, check and foreign key option changes", () => {
		const base = shopDoc(), current = shopDoc();
		const orders = current.entityData.e2.data;
		orders.physicalName = "purchase";
		orders.fields[0] = { ...orders.fields[0], parent: "member" };
		orders.checks = [{ name: "ck_amount", expression: "amount > 0" }];
		orders.indexes = [{ name: "ux_purchase", fields: "member_id,amount", unique: true }];
		current.relationData[0] = { ...current.relationData[0], onDelete: "CASCADE" };
		const member = current.entityData.e1.data;
		member.keys.push({ ...member.fields.shift()!, isPK: true });		// name을 기본키로

		const diff = diffERD(base, current);
		const script = makeAlterScript(diff, sqlMakerManager.getMaker("oracle"));
		expect(script).toContain("ALTER TABLE orders DROP CONSTRAINT fk_orders_member;");
		expect(script).toContain("ALTER TABLE orders DROP CONSTRAINT ck_amount;");
		expect(script).toContain("ALTER TABLE member DROP CONSTRAINT PK_member;");
		expect(script).toContain("ALTER TABLE orders RENAME TO purchase;");
		expect(script).toContain("ALTER TABLE member ADD CONSTRAINT  PK_member  PRIMARY KEY (member_id,name);");
		expect(script).toContain("ALTER TABLE purchase ADD CONSTRAINT ck_amount CHECK (amount > 0);");
		expect(script).toContain("CREATE UNIQUE INDEX ux_purchase ON purchase (member_id,amount);");
		expect(script).toContain("ALTER TABLE purchase ADD CONSTRAINT fk_orders_member FOREIGN KEY ( member_id ) REFERENCES member ( member_id ) ON DELETE CASCADE;");
		// 이름 변경 전에 삭제, 이름 변경 후에 추가
		expect(script.indexOf("DROP CONSTRAINT ck_amount")).toBeLessThan(script.indexOf("RENAME TO purchase"));
		expect(script.indexOf("RENAME TO purchase")).toBeLessThan(script.indexOf("ADD CONSTRAINT ck_amount"));
	});

	it("matches tables by name when ids differ (file from another document)", () => {
		const base = shopDoc(), current = shopDoc();
		current.entityData = { x1: current.entityData.e1, x2: current.entityData.e2 };
		current.relationData[0] = { ...current.relationData[0], parent: "x1", child: "x2" };
		expect(isEmptyDiff(diffERD(base, current))).toBe(true);
	});

	it("views and sequences", () => {
		const base = shopDoc(), current = shopDoc();
		base.views = [{ id: "v1", name: "v_old", query: "select 1" }, { id: "v2", name: "v_same", query: "select 2" }];
		current.views = [{ id: "v2", name: "v_same", query: "select 22" }, { id: "v3", name: "v_new", query: "select 3" }];
		current.sequences = [{ id: "s1", name: "seq_a", start: 1 }];
		const script = makeAlterScript(diffERD(base, current), sqlMakerManager.getMaker("postgresql"));
		expect(script).toContain("DROP VIEW v_old;");
		expect(script).toContain("CREATE OR REPLACE VIEW v_same AS\nselect 22;");
		expect(script).toContain("CREATE VIEW v_new AS\nselect 3;");
		expect(script).toContain("CREATE SEQUENCE seq_a START WITH 1;");
	});
});
