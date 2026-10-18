/** 테스트용 ERD 문서 */
import type { EntityData, ERDFileData, FieldData } from "../src/types";

export function field(id: string, column: string, dataType: string, extra: Partial<FieldData> = {}): FieldData {
	return { id, column, dataType, ...extra };
}

export function emptyDoc(): ERDFileData {
	return { version: 2, dbms: "mariadb", entityData: {}, relationData: [], textData: [], areaData: [], views: [], sequences: [], pages: [], domains: [], words: [], terms: [] };
}

export function addTable(doc: ERDFileData, id: string, data: EntityData): void {
	doc.entityData[id] = { x1: 0, y1: 0, x2: 100, y2: 100, data };
}

/** 회원(member) - 주문(orders) */
export function shopDoc(): ERDFileData {
	const doc = emptyDoc();
	addTable(doc, "e1", {
		physicalName: "member",
		logicalName: "Member",
		keys: [field("m1", "member_id", "INT", { isPK: true, notNull: true })],
		fields: [field("m2", "name", "VARCHAR(50)", { notNull: true, comment: "Name" }), field("m3", "email", "VARCHAR(100)")],
		indexes: [{ name: "ix_member_name", fields: "name" }],
	});
	addTable(doc, "e2", {
		physicalName: "orders",
		logicalName: "Orders",
		keys: [field("o1", "order_id", "INT", { isPK: true, notNull: true })],
		fields: [field("o2", "member_id", "INT", { parent: "member", parentID: "m1" }), field("o3", "amount", "DECIMAL(10,2)")],
		checks: [{ name: "ck_amount", expression: "amount >= 0" }],
	});
	doc.relationData.push({ id: "r1", parent: "e1", child: "e2", relationType: "ak", relationCard: "many", relationSelect: "mm", name: "fk_orders_member" });
	return doc;
}
