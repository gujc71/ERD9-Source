import { describe, expect, it } from "vitest";
import { ERD_FILE_VERSION } from "../src/constants";
import { toColor, validateERDFile } from "../src/storage/validateERDFile";

const v1File = {
	dbms: "oracle",
	entityData: {
		er1: { x1: 10, y1: 20, data: { physicalName: "T1", keys: [{ id: "f1", column: "ID", dataType: "NUMBER" }], fields: [] } },
	},
	relationData: [],
	textData: [{ x1: 1, y1: 2, data: "memo" }],
};

describe("validateERDFile", () => {
	it("reads a version 1 file (no version) and fills the new values", () => {
		const data = validateERDFile(v1File);
		expect(data.version).toBe(ERD_FILE_VERSION);
		expect(data.areaData).toEqual([]);
		expect(data.views).toEqual([]);
		expect(data.sequences).toEqual([]);
		expect(data.pages).toEqual([]);
		expect(data.textData[0]).toEqual({ x1: 1, y1: 2, data: "memo" });
		expect(data.entityData.er1.x2).toBe(10);
		expect(data.entityData.er1.data.keys[0].parent).toBeNull();
	});

	it("rejects a file saved by a newer version", () => {
		expect(() => validateERDFile({ ...v1File, version: ERD_FILE_VERSION + 1 })).toThrow(/newer version/);
	});

	it("rejects an unknown DBMS", () => {
		expect(() => validateERDFile({ ...v1File, dbms: "sqlite" })).toThrow(/dbms/);
	});

	it("accepts PostgreSQL", () => {
		expect(validateERDFile({ ...v1File, dbms: "postgresql" }).dbms).toBe("postgresql");
	});

	it("keeps only known relation options", () => {
		const data = validateERDFile({
			...v1File,
			relationData: [{ id: "r1", parent: "a", child: "b", relationType: "pk", onDelete: "CASCADE", onUpdate: "DROP TABLE x", name: "fk1" }],
		});
		expect(data.relationData[0]).toMatchObject({ onDelete: "CASCADE", name: "fk1", relationCard: "many", relationSelect: "mm" });
		expect(data.relationData[0].onUpdate).toBeUndefined();
	});

	it("reads the relation label and bend (bend is kept between 0.05 and 0.95)", () => {
		const data = validateERDFile({
			...v1File,
			relationData: [
				{ id: "r1", parent: "a", child: "b", relationType: "ak", label: "places", bend: 0.3 },
				{ id: "r2", parent: "a", child: "b", relationType: "ak", bend: 7 },
				{ id: "r3", parent: "a", child: "b", relationType: "ak", bend: "x" },
			],
		});
		expect(data.relationData[0]).toMatchObject({ label: "places", bend: 0.3 });
		expect(data.relationData[1].bend).toBe(0.95);
		expect(data.relationData[2].bend).toBeUndefined();
	});

	it("validates entity colors, checks, unique indexes and areas", () => {
		const data = validateERDFile({
			...v1File,
			version: 2,
			entityData: {
				er1: { x1: 0, y1: 0, data: { physicalName: "T1", keys: [], fields: [], color: "#ABCDEF",
					checks: [{ name: "ck", expression: "a > 0" }], indexes: [{ name: "ux", fields: "a,b", unique: 1 }] } },
				er2: { x1: 0, y1: 0, data: { physicalName: "T2", keys: [], fields: [], color: "red;stroke:url(x)" } },
			},
			areaData: [{ id: "a1", x1: 0, y1: 0, width: 10, height: 500, name: "Sales", color: "javascript:" }],
			views: [{ id: "v1", name: "v", query: "select 1" }],
			sequences: [{ id: "s1", name: "seq", start: 1, cycle: true }],
		});
		expect(data.entityData.er1.data.color).toBe("#abcdef");
		expect(data.entityData.er2.data.color).toBeUndefined();
		expect(data.entityData.er1.data.indexes).toEqual([{ name: "ux", fields: "a,b", unique: true }]);
		expect(data.entityData.er1.data.checks).toEqual([{ name: "ck", expression: "a > 0" }]);
		expect(data.areaData[0]).toMatchObject({ width: 50, height: 500, color: "#e8f0fe" });
		expect(data.views[0].query).toBe("select 1");
		expect(data.sequences[0]).toMatchObject({ name: "seq", start: 1, cycle: true });
	});

	it("toColor accepts #rrggbb only", () => {
		expect(toColor("#00ff00")).toBe("#00ff00");
		expect(toColor("#0f0")).toBeUndefined();
		expect(toColor("blue")).toBeUndefined();
	});

	it("reads pages and the page of texts and areas", () => {
		const data = validateERDFile({
			...v1File,
			version: 3,
			textData: [{ x1: 1, y1: 2, data: "memo", page: "pg1" }],
			areaData: [{ id: "ar1", x1: 0, y1: 0, width: 100, height: 100, name: "A", color: "#e8f0fe", page: "pg1" }],
			pages: [{ id: "pg1", name: "Order", entities: { er1: { x: 5, y: 6 } } }, { id: "pg2", name: "Empty" }],
		});
		expect(data.pages).toEqual([{ id: "pg1", name: "Order", entities: { er1: { x: 5, y: 6 } } }, { id: "pg2", name: "Empty", entities: {} }]);
		expect(data.textData[0].page).toBe("pg1");
		expect(data.areaData[0].page).toBe("pg1");
		expect(() => validateERDFile({ ...v1File, pages: [{ id: "pg1", name: "A", entities: { er1: { x: "1" } } }] })).toThrow(/pages/);
	});

	it("reads domains, standard words and terms, and the domain of columns", () => {
		const data = validateERDFile({
			...v1File,
			entityData: { er1: { x1: 0, y1: 0, data: { physicalName: "T1", keys: [{ id: "f1", column: "ID", dataType: "BIGINT", domain: "dm1" }], fields: [] } } },
			domains: [{ id: "dm1", name: "ID", dataType: "BIGINT", notNull: 1, defaultValue: null }],
			words: [{ logical: "고객", physical: "CUST" }],
			terms: [{ logical: "고객번호", physical: "CUST_NO", domain: "dm1" }, { logical: "이름", physical: "NM", domain: null }],
		});
		expect(data.entityData.er1.data.keys[0].domain).toBe("dm1");
		expect(data.domains).toEqual([{ id: "dm1", name: "ID", dataType: "BIGINT", notNull: true, defaultValue: undefined, comment: undefined }]);
		expect(data.words).toEqual([{ logical: "고객", physical: "CUST" }]);
		expect(data.terms).toEqual([{ logical: "고객번호", physical: "CUST_NO", domain: "dm1" }, { logical: "이름", physical: "NM" }]);
		expect(validateERDFile(v1File).entityData.er1.data.keys[0]).not.toHaveProperty("domain");
	});
});
