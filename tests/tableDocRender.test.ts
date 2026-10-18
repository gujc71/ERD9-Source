// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { toDocColumn, toTableDoc } from "../src/export/tableDocModel";
import { diagramUtil } from "../src/util/diagramUtil";
import { createYielder } from "../src/util/sleep";
import { field } from "./fixtures";

const cells = (row: Element) => [...row.querySelectorAll("td")].map(td => td.textContent);

describe("table definition renderer", () => {
	it("toDocColumn keeps default value 0", () => {
		expect(toDocColumn(field("1", "stock", "INT", { defaultValue: 0 })).defaultValue).toBe("0");
		expect(toDocColumn(field("1", "stock", "INT")).defaultValue).toBe("");
		expect(toDocColumn(field("1", "id", "INT"), { pk: true, fk: "p.id" })).toMatchObject({ pk: true, fk: "p.id" });
	});

	it("renderTableDoc: title, columns, indexes, checks", () => {
		const parent = document.createElement("div");
		diagramUtil.renderTableDoc(parent, toTableDoc({
			physicalName: "product", logicalName: "Product",
			columns: [field("1", "id", "INT", { isPK: true, notNull: true, ai: true }), field("2", "stock", "INT", { defaultValue: 0, comment: "Stock", uniqueKey: true })],
			indexes: [{ name: "ix_stock", fields: "stock", unique: true }],
			checks: [{ name: "ck_stock", expression: "stock >= 0" }],
		}));
		expect(parent.querySelector("h4.tableName-span")?.textContent).toBe("product - Product");
		const tables = parent.querySelectorAll("table");
		expect(tables).toHaveLength(3);
		const rows = tables[0].querySelectorAll("tbody tr");
		expect(cells(rows[0])).toEqual(["id", "", "INT", "", "Y", "", "Y", "Y"]);
		expect(cells(rows[1])).toEqual(["stock", "Stock", "INT", "0", "", "Y", "", ""]);
		expect(cells(tables[1].querySelectorAll("tr")[1])).toEqual(["ix_stock", "stock", "Y"]);
		expect(cells(tables[2].querySelectorAll("tr")[1])).toEqual(["ck_stock", "stock >= 0"]);
	});

	it("makeTableDesc (AI ERD) shows default 0 and keys as PK", () => {
		const parent = document.createElement("div");
		diagramUtil.makeTableDesc(parent, { physicalName: "t", keys: [field("1", "id", "INT")], fields: [field("2", "cnt", "INT", { defaultValue: 0 })] });
		const rows = parent.querySelectorAll("tbody tr");
		expect(cells(rows[0])[4]).toBe("Y");
		expect(cells(rows[1])[3]).toBe("0");
		expect(parent.querySelectorAll("table")).toHaveLength(1);		// 색인, CHECK가 없으면 표를 만들지 않음
	});

	it("renderRelationDocs: header widths, nothing when empty", () => {
		const parent = document.createElement("div");
		diagramUtil.renderRelationDocs(parent, []);
		expect(parent.childNodes).toHaveLength(0);
		diagramUtil.renderRelationDocs(parent, [{ name: "fk", childTable: "c", childFields: "a", parentTable: "p", parentFields: "a", onDelete: "CASCADE", onUpdate: "" }], ["120px", "70px", "150px", "70px", "150px", "80px", "80px"]);
		expect(parent.querySelector("th")?.style.width).toBe("120px");
		expect(cells(parent.querySelectorAll("tr")[1])).toEqual(["fk", "c", "a", "p", "a", "CASCADE", ""]);
	});
});

describe("createYielder", () => {
	it("yields only after the time budget", async () => {
		let yielded = 0;
		const yieldToUI = createYielder(1000, () => yielded++);
		for (let i = 0; i < 1000; i++) await yieldToUI();
		expect(yielded).toBe(0);
		const always = createYielder(0, () => yielded++);
		await always();
		expect(yielded).toBe(1);
	});
});
