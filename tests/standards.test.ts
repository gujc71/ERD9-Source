import { describe, expect, it } from "vitest";
import { applyDomainValues, checkStandards, extractTerms, ISSUE_KIND, parseCSV, StdConverter, toCSV } from "../src/standard/standards";
import type { DomainObject, FieldData } from "../src/types";

const words = [
	{ logical: "고객", physical: "CUST" },
	{ logical: "번호", physical: "NO" },
	{ logical: "주문", physical: "ORD" },
	{ logical: "주문번호", physical: "ORDNO" },
	{ logical: "명", physical: "NM" },
	{ logical: "Customer", physical: "CUST" },
	{ logical: "Name", physical: "NM" },
];
const domains: DomainObject[] = [
	{ id: "d1", name: "ID", dataType: "BIGINT", notNull: true },
	{ id: "d2", name: "NAME", dataType: "VARCHAR(100)" },
];
const terms = [{ logical: "고객 번호", physical: "CUST_ID", domain: "d1" }];
const converter = new StdConverter(words, terms);

describe("StdConverter", () => {
	it("uses the term first, ignoring spaces", () => {
		expect(converter.toPhysical("고객번호")).toMatchObject({ physical: "CUST_ID", unknown: [], term: terms[0] });
	});

	it("splits compound words by the longest word in the dictionary", () => {
		expect(converter.toPhysical("고객주문번호")).toEqual({ physical: "CUST_ORDNO", unknown: [] });
		expect(converter.toPhysical("고객 명")).toEqual({ physical: "CUST_NM", unknown: [] });
		expect(converter.toPhysical("customer name")).toEqual({ physical: "CUST_NM", unknown: [] });
	});

	it("keeps unknown parts and reports them", () => {
		expect(converter.toPhysical("고객등급번호")).toEqual({ physical: "CUST_등급_NO", unknown: ["등급"] });
	});

	it("converts a physical name back to a logical name", () => {
		expect(converter.toLogical("CUST_ID").logical).toBe("고객 번호");
		expect(converter.toLogical("cust_ord")).toEqual({ logical: "Customer주문", unknown: [] });
		expect(converter.toLogical("CUST_XX").unknown).toEqual(["XX"]);
	});
});

describe("checkStandards", () => {
	it("reports names, domains, unknown words and missing comments; skips FK columns", () => {
		const fields: FieldData[] = [
			{ id: "f1", column: "CUSTNO", comment: "고객번호", dataType: "INT" },
			{ id: "f2", column: "CUST_NM", comment: "고객명", dataType: "VARCHAR(100)" },
			{ id: "f3", column: "GRADE", comment: "등급", dataType: "CHAR(1)" },
			{ id: "f4", column: "ETC", dataType: "TEXT" },
			{ id: "f5", column: "X", comment: "zz", dataType: "INT", parentID: "p1", parent: "T" },
		];
		const issues = checkStandards([{ id: "e1", physicalName: "CUSTOMER", fields }], converter, domains);
		expect(issues.map(i => [i.fieldId, i.kind, i.suggestion])).toEqual([
			["f1", ISSUE_KIND.NAME, "CUST_ID"],
			["f1", ISSUE_KIND.DOMAIN, "d1"],
			["f3", ISSUE_KIND.WORD, undefined],
			["f4", ISSUE_KIND.NO_LOGICAL, undefined],
		]);
	});
});

describe("extractTerms", () => {
	it("makes terms from comments, picks the most used column name and keeps a shared domain", () => {
		const tables = [
			{ id: "e1", physicalName: "A", fields: [
				{ id: "1", column: "CUST_ID", comment: "고객 번호", dataType: "INT", domain: "d1" },
				{ id: "2", column: "NM", comment: "이름", dataType: "VARCHAR(10)", domain: "d2" },
				{ id: "3", column: "ETC", dataType: "TEXT" },
			] },
			{ id: "e2", physicalName: "B", fields: [
				{ id: "4", column: "cust_id", comment: "고객번호", dataType: "INT", domain: "d1" },
				{ id: "5", column: "CUSTNO", comment: "고객번호", dataType: "INT" },
				{ id: "6", column: "NAME", comment: "이름", dataType: "VARCHAR(10)" },
				{ id: "7", column: "CUST_ID", comment: "주문자", dataType: "INT", parentID: "1", parent: "A" },
				{ id: "8", column: "REG_DT", comment: "등록일시", dataType: "DATETIME" },
			] },
		];
		const result = extractTerms(tables, [{ logical: "등록 일시", physical: "REG_DT" }]);
		expect(result.terms).toEqual([
			{ logical: "고객 번호", physical: "CUST_ID", domain: "d1" },
			{ logical: "이름", physical: "NM", domain: "d2" },
		]);
		expect(result.conflicts).toEqual(["고객 번호: CUST_ID(2), CUSTNO(1)", "이름: NM(1), NAME(1)"]);
	});
});

describe("applyDomainValues", () => {
	it("copies type, default and not null from the domain", () => {
		const field: FieldData = { id: "f1", column: "A", dataType: "INT", defaultValue: 0, notNull: true };
		applyDomainValues(field, domains[1]);
		expect(field).toEqual({ id: "f1", column: "A", dataType: "VARCHAR(100)", domain: "d2" });
		applyDomainValues(field, domains[0]);
		expect(field).toMatchObject({ dataType: "BIGINT", notNull: true, domain: "d1" });
	});
});

describe("CSV", () => {
	it("round-trips quotes, commas and new lines", () => {
		const rows = [["logical", "physical"], ["고객, 회원", 'say "hi"'], ["a\nb", ""]];
		expect(parseCSV(toCSV(rows))).toEqual(rows.map(r => r.map(c => c.trim())));
	});
});
