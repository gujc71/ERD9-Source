import { describe, expect, it } from "vitest";
import { getERDJsonSchema, parseAIERD } from "../src/ai/erdSchema";

const ERD_JSON_SCHEMA = getERDJsonSchema();

describe("ERD_JSON_SCHEMA", () => {
	it("follows OpenAI strict mode rules", () => {
		const check = (schema: any) => {
			expect(schema.default).toBeUndefined();
			if (schema.type === "object") {
				expect(schema.additionalProperties).toBe(false);
				expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
				Object.values(schema.properties).forEach(check);
			}
			if (schema.items) check(schema.items);
		};
		expect(ERD_JSON_SCHEMA.$schema).toBeUndefined();
		check(ERD_JSON_SCHEMA);
		const field = (ERD_JSON_SCHEMA as any).properties.tables.items.properties.fields.items.properties;
		expect(field.default.type).toEqual(["string", "null"]);
		expect((ERD_JSON_SCHEMA as any).properties.relationData.items.properties.relationType.enum).toEqual(["pk", "fk"]);
	});
});

describe("parseAIERD", () => {
	it("reads a response in a code block and fills missing values", () => {
		const data = parseAIERD('```json\n{"tables":[{"physicalName":"T1","fields":[{"column":"ID","isPK":true,"nullable":false},{"comment":"no column"},{"column":"NAME","dataType":"VARCHAR(10)","default":0}]},{"id":"x"}],"relationData":[{"parent":"t0","child":"t1","relationType":"pk"}, 1]}\n```');
		expect(data.tables).toHaveLength(1);
		expect(data.tables[0]).toMatchObject({ id: "t0", physicalName: "T1", logicalName: "" });
		expect(data.tables[0].fields).toEqual([
			{ column: "ID", comment: "", dataType: "VARCHAR(100)", default: null, isPK: true, nullable: false },
			{ column: "NAME", comment: "", dataType: "VARCHAR(10)", default: "0", isPK: false, nullable: true },
		]);
		expect(data.relationData).toEqual([{ parent: "t0", parentTable: "", parentColumns: "", child: "t1", childTable: "", childColumns: "", relationType: "pk" }]);
	});

	it("throws when there are no tables", () => {
		expect(() => parseAIERD('{"tables":[]}')).toThrow(/no tables/);
		expect(() => parseAIERD('{}')).toThrow(/no tables/);
	});
});
