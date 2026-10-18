import { describe, expect, it } from "vitest";
import { detectMissingRelations, findField } from "../src/util/detectRelationship";
import type { DetectEntity } from "../src/util/detectRelationship";
import type { FieldData } from "../src/types";
import { field } from "./fixtures";

type Rel = { parentEntity: Node; childEntity: Node };
type Node = DetectEntity & { myChildList: Set<Rel>; myParentList: Set<Rel> };

function entity(id: string, keys: FieldData[], fields: FieldData[] = []): Node {
	return { id, data: { physicalName: id, keys, allFields: keys.concat(fields) }, myChildList: new Set(), myParentList: new Set() };
}
function link(parent: Node, child: Node): void {
	const r = { parentEntity: parent, childEntity: child };
	parent.myChildList.add(r);
	child.myParentList.add(r);
}
const pairs = (entities: Node[]) => detectMissingRelations(entities).map(r => `${r.parent.id}>${r.child.id}`);

describe("detectMissingRelations", () => {
	it("finds children that have all parent key columns (case-insensitive)", () => {
		const member = entity("member", [field("m1", "member_id", "INT", { isPK: true })]);
		const orders = entity("orders", [field("o1", "order_id", "INT", { isPK: true })], [field("o2", "MEMBER_ID", "BIGINT")]);
		const other = entity("other", [field("x1", "x_id", "INT", { isPK: true })]);
		const result = detectMissingRelations([member, orders, other]);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ parent: member, child: orders, sameType: false, isPK: false, reversible: false });
		expect(result[0].childFields[0].id).toBe("o2");
	});

	it("requires every key column of a composite key", () => {
		const parent = entity("p", [field("p1", "a", "INT", { isPK: true }), field("p2", "b", "INT", { isPK: true })]);
		const partial = entity("c1", [field("c1", "id", "INT", { isPK: true })], [field("c2", "a", "INT")]);
		const full = entity("c2", [field("d1", "a", "INT", { isPK: true }), field("d2", "b", "INT", { isPK: true })]);
		expect(pairs([parent, partial, full])).toEqual(["p>c2"]);
	});

	it("skips existing relations in both directions (child -> parent too)", () => {
		const member = entity("member", [field("m1", "member_id", "INT", { isPK: true })]);
		const orders = entity("orders", [field("o1", "order_id", "INT", { isPK: true })], [field("o2", "member_id", "INT"), field("o3", "status_id", "INT")]);
		const status = entity("status", [field("s1", "status_id", "INT", { isPK: true })], [field("s2", "order_id", "INT")]);
		link(member, orders);
		// orders → status, status → orders 모두 후보
		expect(pairs([member, orders, status])).toEqual(["orders>status", "status>orders"]);

		// orders가 부모인 관계가 있으면 status 입장에서는 부모(myParentList)와의 관계.
		// 기존 코드는 부모 목록에서 자기 자신의 id를 넣어 status>orders가 누락으로 표시되었음
		link(orders, status);
		expect(pairs([member, orders, status])).toEqual([]);
	});

	it("reports mutual primary keys once and marks them reversible", () => {
		const a = entity("a", [field("a1", "id", "INT", { isPK: true })]);
		const b = entity("b", [field("b1", "ID", "INT", { isPK: true })]);
		const result = detectMissingRelations([a, b]);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ parent: a, child: b, isPK: true, reversible: true, sameType: true });
	});

	it("findField prefers the exact name", () => {
		const fields = [field("1", "NAME", "INT"), field("2", "name", "INT")];
		expect(findField(fields, "name")?.id).toBe("2");
		expect(findField(fields, "Name")?.id).toBe("1");
		expect(findField(fields, "none")).toBeNull();
	});
});
