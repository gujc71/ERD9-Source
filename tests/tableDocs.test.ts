import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { columnName, makeSheets, toHTML, toMarkdown, toXlsx } from "../src/export/tableDocs";
import type { TableDocument } from "../src/export/tableDocs";

const column = { column: "id", comment: "a|b", dataType: "INT", defaultValue: "", pk: true, unique: false, notNull: true, ai: true, fk: "" };
const doc: TableDocument = {
	title: "Shop <ERD>",
	dbms: "mariadb",
	tables: [
		{ physicalName: "member", logicalName: "Member", columns: [column], indexes: [{ name: "ux", fields: "id", unique: true }], checks: [] },
		{ physicalName: "a/very:long*table[name]that-exceeds-31-chars", logicalName: "", columns: [], indexes: [], checks: [{ name: "ck", expression: "x > 0" }] },
	],
	relations: [{ name: "fk1", childTable: "orders", childFields: "member_id", parentTable: "member", parentFields: "id", onDelete: "CASCADE", onUpdate: "" }],
};

describe("table description export", () => {
	it("markdown escapes table separators", () => {
		const md = toMarkdown(doc);
		expect(md).toContain("## member - Member");
		expect(md).toContain("| 1 | id | a\\|b | INT |  | Y |  | Y | Y |  |");
		expect(md).toContain("| ux | id | Y |");
		expect(md).toContain("## Relationships");
	});

	it("html escapes values", () => {
		const html = toHTML(doc);
		expect(html).toContain("<title>Shop &lt;ERD&gt;</title>");
		expect(html).not.toContain("<ERD>");
	});

	it("column names for cells", () => {
		expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
	});

	it("sheet names are valid and unique", () => {
		const names = makeSheets(doc).map(s => s.name);
		expect(names[0]).toBe("Tables");
		expect(names).toContain("Relationships");
		for (const name of names) {
			expect(name.length).toBeLessThanOrEqual(31);
			expect(name).not.toMatch(/[:\\/?*[\]]/);
		}
	});

	it("xlsx is a valid package", () => {
		const files = unzipSync(toXlsx(doc));
		expect(Object.keys(files)).toEqual(expect.arrayContaining([
			"[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml",
			"xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/worksheets/sheet3.xml", "xl/worksheets/sheet4.xml",
		]));
		const workbook = strFromU8(files["xl/workbook.xml"]);
		expect(workbook).toContain('<sheet name="member" sheetId="2" r:id="rId2"/>');
		const sheet = strFromU8(files["xl/worksheets/sheet2.xml"]);
		expect(sheet).toContain('<c r="B4" t="inlineStr" s="2"><is><t xml:space="preserve">id</t></is></c>');
		expect(strFromU8(files["xl/worksheets/sheet1.xml"])).toContain("Shop &lt;ERD&gt;");
	});
});
