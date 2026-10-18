import { describe, expect, it } from "vitest";
import { buildSchema, mssqlDataType, normalizeDefault, oracleDataType, pgDataType, stripOuterParens, toReferentialAction } from "../src/database/schemaReader";
import type { RawSchema } from "../src/database/schemaReader";
import { buildDBTarget, canonicalize, compareForSync, mergeIntoModel, schemaToERDData } from "../src/database/sync";
import { diffERD, makeAlterScript, sameDataType, sameDefault, sameQuery } from "../src/sql/ERDDiff";
import { getAllFields, sqlMakerManager } from "../src/sql/SQLMaker";
import { shopDoc } from "./fixtures";

/** shopDoc()과 같은 구조의 DB 카탈로그 */
function shopRaw(): RawSchema {
	return {
		tables: [{ name: "member", comment: "Member" }, { name: "orders", comment: "Orders" }],
		columns: [
			{ table: "member", column: "member_id", dataType: "INT", notNull: true, ai: false, position: 1 },
			{ table: "member", column: "name", dataType: "VARCHAR(50)", notNull: true, comment: "Name", ai: false, position: 2 },
			{ table: "member", column: "email", dataType: "VARCHAR(100)", notNull: false, ai: false, position: 3 },
			{ table: "orders", column: "order_id", dataType: "INT", notNull: true, ai: false, position: 1 },
			{ table: "orders", column: "member_id", dataType: "INT", notNull: false, ai: false, position: 2 },
			{ table: "orders", column: "amount", dataType: "DECIMAL(10,2)", notNull: false, ai: false, position: 3 },
		],
		constraints: [
			{ name: "PRIMARY", kind: "P", table: "member", column: "member_id", position: 1 },
			{ name: "PRIMARY", kind: "P", table: "orders", column: "order_id", position: 1 },
			{ name: "fk_orders_member", kind: "F", table: "orders", column: "member_id", position: 1, refTable: "member", refColumn: "member_id" },
		],
		indexes: [
			{ table: "member", name: "ix_member_name", unique: false, column: "name", position: 1 },
			{ table: "orders", name: "fk_orders_member", unique: false, column: "member_id", position: 1 },		// MariaDB 자동 색인
		],
		checks: [{ table: "orders", name: "ck_amount", expression: "(`amount` >= 0)" }],
		views: [],
		sequences: [],
	};
}

describe("schema reader", () => {
	it("normalizes catalog values", () => {
		expect(stripOuterParens("((0))")).toBe("0");
		expect(stripOuterParens("(a) + (b)")).toBe("(a) + (b)");
		expect(normalizeDefault("((0))", "mssql")).toBe("0");
		expect(normalizeDefault("(getdate())", "mssql")).toBe("getdate()");
		expect(normalizeDefault("'Y'::character varying", "postgresql")).toBe("'Y'");
		expect(normalizeDefault("NULL", "mariadb")).toBeUndefined();
		expect(normalizeDefault("Y", "mariadb")).toBe("'Y'");				// MySQL: 따옴표 없는 문자열
		expect(normalizeDefault("current_timestamp()", "mariadb")).toBe("CURRENT_TIMESTAMP");
		expect(normalizeDefault("current_timestamp(3)", "mariadb")).toBe("current_timestamp(3)");
		expect(pgDataType("character varying(100)")).toBe("VARCHAR(100)");
		expect(pgDataType("timestamp(3) with time zone")).toBe("TIMESTAMPTZ(3)");
		expect(pgDataType("timestamp without time zone")).toBe("TIMESTAMP");
		expect(mssqlDataType("nvarchar", 200, 0, 0)).toBe("NVARCHAR(100)");
		expect(mssqlDataType("varchar", -1, 0, 0)).toBe("VARCHAR(MAX)");
		expect(mssqlDataType("decimal", 9, 10, 2)).toBe("DECIMAL(10,2)");
		expect(oracleDataType("NUMBER", 22, 0, "10", "0")).toBe("NUMBER(10)");
		expect(oracleDataType("VARCHAR2", 400, 100, "", "")).toBe("VARCHAR2(100)");
		expect(toReferentialAction("c", "postgresql")).toBe("CASCADE");
		expect(toReferentialAction("SET_NULL", "mssql")).toBe("SET NULL");
		expect(toReferentialAction("NO ACTION", "oracle")).toBeUndefined();
	});

	it("builds tables, keys, relations and indexes", () => {
		const schema = buildSchema(shopRaw(), "mariadb");
		const orders = schema.tables.find(t => t.physicalName === "orders")!;
		expect(orders.primaryKey).toEqual(["order_id"]);
		expect(orders.columns.find(c => c.column === "order_id")).toMatchObject({ isPK: true, notNull: true });
		expect(orders.indexes).toBeUndefined();		// 외래키 자동 색인 제외
		expect(orders.checks).toEqual([{ name: "ck_amount", expression: "`amount` >= 0" }]);
		expect(schema.relations).toEqual([{ name: "fk_orders_member", childTable: "orders", childFields: "member_id", parentTable: "member", parentFields: "member_id", onDelete: undefined, onUpdate: undefined }]);
	});

	it("treats a system-named single column unique as the column's UNIQUE", () => {
		const raw = shopRaw();
		raw.constraints.push({ name: "email", kind: "U", table: "member", column: "email", position: 1, systemNamed: true });
		raw.constraints.push({ name: "uq_name_email", kind: "U", table: "member", column: "name", position: 1 });
		raw.constraints.push({ name: "uq_name_email", kind: "U", table: "member", column: "email", position: 2 });
		const member = buildSchema(raw, "mariadb").tables.find(t => t.physicalName === "member")!;
		expect(member.columns.find(c => c.column === "email")?.uniqueKey).toBe(true);
		expect(member.indexes).toContainEqual({ name: "uq_name_email", fields: "name,email", unique: true });
	});
});

describe("two-way sync", () => {
	it("compares type aliases and quoted defaults as the same", () => {
		expect(sameDataType("integer", "INT")).toBe(true);
		expect(sameDataType("character varying(10)", "VARCHAR(10)")).toBe(true);
		expect(sameDataType("VARCHAR(10)", "VARCHAR(20)")).toBe(false);
		expect(sameDefault("'Y'", "Y")).toBe(true);
		expect(sameDefault("((0))", 0)).toBe(true);
		expect(sameDefault("current_timestamp()", "CURRENT_TIMESTAMP")).toBe(true);
		expect(sameDefault("now()", "CURRENT_TIMESTAMP")).toBe(true);
		expect(sameDefault("CURRENT_DATE", "CURRENT_TIMESTAMP")).toBe(false);
		// 정수의 표시 너비는 무시
		expect(sameDataType("TINYINT(4)", "TINYINT")).toBe(true);
		expect(sameDataType("INT(11)", "INT")).toBe(true);
		expect(sameDataType("DECIMAL(12,0)", "DECIMAL(12,2)")).toBe(false);
		// MariaDB가 다시 써서 돌려주는 뷰 쿼리
		const mariadbView = "select `o`.`ORDER_NO` AS `ORDER_NO`,`c`.`CUST_NM` AS `CUST_NM` from (`orders` `o` join `customer` `c` on(`c`.`CUST_NO` = `o`.`CUST_NO`))";
		expect(sameQuery(mariadbView, "SELECT O.ORDER_NO, C.CUST_NM\n  FROM ORDERS O JOIN CUSTOMER C ON C.CUST_NO = O.CUST_NO;")).toBe(true);
		expect(sameQuery(mariadbView, "SELECT O.ORDER_NO, C.CUST_NM AS NAME FROM ORDERS O JOIN CUSTOMER C ON C.CUST_NO = O.CUST_NO")).toBe(false);
	});

	it("finds no differences between the ERD and the same database", () => {
		const db = schemaToERDData(buildSchema(shopRaw(), "mariadb"));
		expect(compareForSync(db, canonicalize(shopDoc()))).toEqual([]);
	});

	it("lists differences with default directions", () => {
		const raw = shopRaw();
		raw.tables.push({ name: "log" });
		raw.columns.push({ table: "log", column: "id", dataType: "INT", notNull: true, ai: true, position: 1 });
		raw.columns.find(c => c.column === "email")!.dataType = "VARCHAR(200)";
		const model = shopDoc();
		model.entityData.e3 = { x1: 0, y1: 0, x2: 0, y2: 0, data: { physicalName: "product", keys: [{ id: "p1", column: "product_id", dataType: "INT", isPK: true }], fields: [] } };

		const items = compareForSync(schemaToERDData(buildSchema(raw, "mariadb")), canonicalize(model));
		expect(items.map(i => [i.name, i.status, i.direction])).toEqual([
			["log", "dbOnly", "toERD"], ["member", "different", "toDB"], ["product", "erdOnly", "toDB"],
		]);
		expect(items[1].details.join("\n")).toContain("type VARCHAR(200) → VARCHAR(100)");
	});

	it("makes the ALTER script only for the ERD → DB items", () => {
		const raw = shopRaw();
		raw.columns.find(c => c.column === "email")!.dataType = "VARCHAR(200)";
		raw.tables.push({ name: "log" });
		raw.columns.push({ table: "log", column: "id", dataType: "INT", notNull: true, ai: false, position: 1 });
		const db = schemaToERDData(buildSchema(raw, "mariadb")), model = canonicalize(shopDoc());
		const items = compareForSync(db, model);
		items.find(i => i.name === "log")!.direction = "toDB";		// DB에만 있는 테이블 삭제

		const script = makeAlterScript(diffERD(db, buildDBTarget(db, model, items)), sqlMakerManager.getMaker("mariadb"));
		expect(script).toContain("ALTER TABLE member MODIFY COLUMN email    VARCHAR(100);");
		expect(script).toContain("DROP TABLE log;");
		expect(script).not.toContain("FOREIGN KEY");

		items.forEach(i => i.direction = "skip");
		expect(makeAlterScript(diffERD(db, buildDBTarget(db, model, items)), sqlMakerManager.getMaker("mariadb"))).toBe("");
	});

	it("merges DB → ERD items into the document, keeping ids of the same columns", () => {
		const raw = shopRaw();
		raw.columns.find(c => c.column === "email")!.dataType = "VARCHAR(200)";
		raw.columns.push({ table: "member", column: "phone", dataType: "VARCHAR(20)", notNull: false, ai: false, position: 4 });
		raw.tables.push({ name: "coupon" });
		raw.columns.push({ table: "coupon", column: "coupon_id", dataType: "INT", notNull: true, ai: false, position: 1 });
		raw.columns.push({ table: "coupon", column: "member_id", dataType: "INT", notNull: false, ai: false, position: 2 });
		raw.constraints.push({ name: "PRIMARY", kind: "P", table: "coupon", column: "coupon_id", position: 1 });
		raw.constraints.push({ name: "fk_coupon_member", kind: "F", table: "coupon", column: "member_id", position: 1, refTable: "member", refColumn: "member_id" });
		const model = shopDoc();
		const db = schemaToERDData(buildSchema(raw, "mariadb"));
		const items = compareForSync(db, canonicalize(model)).map(i => ({ ...i, direction: "toERD" as const }));

		let n = 0;
		const { data, warnings } = mergeIntoModel(model, db, items, prefix => prefix + "new" + (++n));
		expect(warnings).toEqual([]);
		const member = data.entityData.e1.data;
		expect(member.fields.map(f => [f.id.replace(/\d+$/, ""), f.column, f.dataType])).toEqual([
			["m", "name", "VARCHAR(50)"], ["m", "email", "VARCHAR(200)"], ["fnew", "phone", "VARCHAR(20)"],
		]);
		expect(member.fields.slice(0, 2).map(f => f.id)).toEqual(["m2", "m3"]);
		// 기존 관계는 그대로, 새 테이블의 외래키는 새 관계로
		expect(data.relationData.find(r => r.id === "r1")).toMatchObject({ parent: "e1", child: "e2" });
		const couponId = Object.keys(data.entityData).find(id => data.entityData[id].data.physicalName === "coupon")!;
		const couponRelation = data.relationData.find(r => r.child === couponId)!;
		expect(couponRelation).toMatchObject({ parent: "e1", name: "fk_coupon_member", relationType: "ak" });
		expect(getAllFields(data.entityData[couponId].data).find(f => f.column === "member_id")).toMatchObject({ parent: "member", parentID: "m1" });
		// 반영 후에는 차이가 없다
		expect(compareForSync(db, canonicalize(data))).toEqual([]);
	});

	it("removes an ERD-only table and its relations when DB → ERD is chosen", () => {
		const raw = shopRaw();
		raw.tables = raw.tables.filter(t => t.name !== "orders");
		raw.constraints = raw.constraints.filter(c => c.table !== "orders");
		const db = schemaToERDData(buildSchema(raw, "mariadb"));
		const model = shopDoc();
		const items = compareForSync(db, canonicalize(model)).map(i => ({ ...i, direction: "toERD" as const }));
		const { data } = mergeIntoModel(model, db, items);
		expect(Object.keys(data.entityData)).toEqual(["e1"]);
		expect(data.relationData).toEqual([]);
	});

	it("ignores table and column names that differ only in case, using the DB names in the script", () => {
		// DB가 이름을 소문자로 돌려주는 경우 (Windows의 MariaDB)
		const model = shopDoc();
		for (const entity of Object.values(model.entityData)) {
			entity.data.physicalName = entity.data.physicalName.toUpperCase();
			for (const f of getAllFields(entity.data)) {
				f.column = f.column.toUpperCase();
				if (f.parent) f.parent = f.parent.toUpperCase();
			}
		}
		model.views = [{ id: "v1", name: "V_MEMBER", query: "SELECT M.MEMBER_ID, M.NAME FROM MEMBER M" }];
		const raw = shopRaw();
		raw.views = [{ name: "v_member", definition: "select `m`.`member_id` AS `member_id`,`m`.`name` AS `name` from `member` `m`" }];
		const db = schemaToERDData(buildSchema(raw, "mariadb"));
		expect(compareForSync(db, canonicalize(model))).toEqual([]);

		model.entityData.e1.data.fields.push({ id: "m9", column: "PHONE", dataType: "VARCHAR(20)" });
		const items = compareForSync(db, canonicalize(model));
		expect(items.map(i => [i.name, i.status, i.details])).toEqual([["member", "different", ["    + column PHONE VARCHAR(20)"]]]);
		const script = makeAlterScript(diffERD(db, buildDBTarget(db, canonicalize(model), items)), sqlMakerManager.getMaker("mariadb"));
		expect(script).toContain("ALTER TABLE member ADD COLUMN PHONE");
		expect(script).not.toContain("RENAME");

		// DB → ERD로 반영해도 ERD의 이름 표기는 유지
		const { data } = mergeIntoModel(model, db, items.map(i => ({ ...i, direction: "toERD" as const })));
		expect(data.entityData.e1.data.physicalName).toBe("MEMBER");
		expect(getAllFields(data.entityData.e1.data).map(f => f.column)).toEqual(["MEMBER_ID", "NAME", "EMAIL"]);
	});
});
