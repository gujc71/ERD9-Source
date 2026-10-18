import { describe, expect, it } from "vitest";
import type { DbmsType } from "../src/constants";
import { sqlDataType } from "../src/sql/SQLMaker";
import { dataTypeUtil } from "../src/util/dataTypeUtil";

const convert = (type: string, from: DbmsType, to: DbmsType) => dataTypeUtil.convertDataType(type, from, to);

describe("dataTypeUtil.convertDataType", () => {
	it("keeps or adjusts the size by the rules of the target type", () => {
		expect(convert("varchar(10)", "mariadb", "oracle")).toBe("VARCHAR2(10)");
		expect(convert("INT(11)", "mariadb", "oracle")).toBe("NUMBER(10)");
		expect(convert("INT(11)", "mariadb", "postgresql")).toBe("INTEGER");
		expect(convert("INT(11)", "mariadb", "mssql")).toBe("INT");
		expect(convert("DOUBLE(10,2)", "mariadb", "postgresql")).toBe("DOUBLE PRECISION");
		expect(convert("FLOAT(126)", "oracle", "postgresql")).toBe("DOUBLE PRECISION");
		expect(convert("FLOAT(126)", "oracle", "mariadb")).toBe("DOUBLE");
		expect(convert("FLOAT(24)", "mssql", "oracle")).toBe("BINARY_FLOAT");
		expect(convert("TIMESTAMP(6)", "oracle", "mssql")).toBe("DATETIME2(6)");
		expect(convert("DATETIME2(7)", "mssql", "postgresql")).toBe("TIMESTAMP(6)");
		expect(convert("DECIMAL(10,2)", "mariadb", "oracle")).toBe("NUMBER(10,2)");
		expect(convert("NUMERIC(1000,500)", "postgresql", "mariadb")).toBe("DECIMAL(65,30)");
	});

	it("converts MAX and lengths over the limit to a large type", () => {
		expect(convert("VARCHAR(MAX)", "mssql", "postgresql")).toBe("TEXT");
		expect(convert("NVARCHAR(MAX)", "mssql", "oracle")).toBe("NCLOB");
		expect(convert("VARCHAR(MAX)", "mssql", "mariadb")).toBe("LONGTEXT");
		expect(convert("VARBINARY(MAX)", "mssql", "postgresql")).toBe("BYTEA");
		expect(convert("VARCHAR(5000)", "mariadb", "mssql")).toBe("NVARCHAR(MAX)");
		expect(convert("VARCHAR(5000)", "mariadb", "oracle")).toBe("CLOB");
		expect(convert("VARCHAR(3000)", "mariadb", "mssql")).toBe("NVARCHAR(3000)");
		expect(convert("CHAR(5000)", "mssql", "mariadb")).toBe("VARCHAR(5000)");
		expect(convert("VARCHAR", "postgresql", "mssql")).toBe("NVARCHAR(MAX)");
		expect(convert("VARCHAR", "postgresql", "mariadb")).toBe("LONGTEXT");
	});

	it("does not lose decimals of an unbounded NUMBER", () => {
		expect(convert("NUMBER", "oracle", "mariadb")).toBe("DECIMAL(38,10)");
		expect(convert("NUMBER", "oracle", "mssql")).toBe("DECIMAL(38,10)");
		expect(convert("NUMERIC", "postgresql", "mariadb")).toBe("DECIMAL(38,10)");
		expect(convert("NUMBER", "oracle", "postgresql")).toBe("NUMERIC");
		expect(convert("DECIMAL", "mssql", "mariadb")).toBe("DECIMAL");
	});

	it("handles modifiers and multi-word types", () => {
		expect(convert("TIMESTAMP(6) WITH TIME ZONE", "oracle", "postgresql")).toBe("TIMESTAMPTZ(6)");
		expect(convert("TIMESTAMPTZ(3)", "postgresql", "oracle")).toBe("TIMESTAMP(3) WITH TIME ZONE");
		expect(convert("DATETIMEOFFSET", "mssql", "oracle")).toBe("TIMESTAMP WITH TIME ZONE");
		expect(convert("VARCHAR2(10 CHAR)", "oracle", "postgresql")).toBe("VARCHAR(10)");
		expect(convert("INT UNSIGNED", "mariadb", "postgresql")).toBe("BIGINT");
		expect(convert("int(10) unsigned", "mariadb", "mssql")).toBe("BIGINT");
		expect(convert("TINYINT UNSIGNED", "mariadb", "mssql")).toBe("TINYINT");
		expect(convert("character varying(20)", "postgresql", "oracle")).toBe("VARCHAR2(20)");
		expect(convert("ENUM('A','BBB')", "mariadb", "postgresql")).toBe("VARCHAR(3)");
		expect(convert("BOOLEAN", "mariadb", "postgresql")).toBe("BOOLEAN");
	});

	it("round trips the common types", () => {
		const pairs: [DbmsType, DbmsType][] = [["mariadb", "oracle"], ["mariadb", "mssql"], ["mariadb", "postgresql"], ["mssql", "oracle"], ["postgresql", "oracle"]];
		const types: Record<string, string[]> = {
			mariadb: ["INT", "BIGINT", "VARCHAR(100)", "DECIMAL(10,2)", "DATE", "TINYINT(1)"],
			mssql: ["INT", "BIGINT", "NVARCHAR(100)", "DECIMAL(10,2)", "DATE", "BIT"],
			postgresql: ["INTEGER", "BIGINT", "VARCHAR(100)", "NUMERIC(10,2)", "DATE", "BOOLEAN"],
		};
		for (const [a, b] of pairs) {
			// Oracle DATE에는 시간이 있으므로 DATE는 돌아올 때 DATETIME/TIMESTAMP가 됨
			for (const type of types[a].filter(t => !(b === "oracle" && t === "DATE"))) expect(convert(convert(type, a, b), b, a), `${a}->${b}: ${type}`).toBe(type);
		}
	});

	it("fixes the wrong matches", () => {
		expect(convert("FLOAT", "mariadb", "oracle")).toBe("BINARY_FLOAT");
		expect(convert("DOUBLE", "mariadb", "oracle")).toBe("BINARY_DOUBLE");
		expect(convert("VARBINARY(100)", "mariadb", "oracle")).toBe("RAW(100)");
		expect(convert("TEXT", "mariadb", "mssql")).toBe("NVARCHAR(MAX)");
		expect(convert("BLOB", "mariadb", "mssql")).toBe("VARBINARY(MAX)");
		expect(convert("TIMESTAMP", "mariadb", "mssql")).toBe("DATETIME2");
		expect(convert("TINYINT", "mariadb", "mssql")).toBe("SMALLINT");
		expect(convert("MONEY", "mssql", "mariadb")).toBe("DECIMAL(19,4)");
		expect(convert("SMALLMONEY", "mssql", "mariadb")).toBe("DECIMAL(10,4)");
		expect(convert("FLOAT", "mssql", "mariadb")).toBe("DOUBLE");
		expect(convert("REAL", "mssql", "mariadb")).toBe("FLOAT");
		expect(convert("TEXT", "mssql", "mariadb")).toBe("LONGTEXT");
		expect(convert("TINYINT", "mssql", "mariadb")).toBe("TINYINT UNSIGNED");
		expect(convert("NTEXT", "mssql", "oracle")).toBe("NCLOB");
		expect(convert("BINARY_FLOAT", "oracle", "mssql")).toBe("REAL");
		expect(convert("TIMESTAMP", "postgresql", "oracle")).toBe("TIMESTAMP");
		expect(convert("TIMESTAMPTZ", "postgresql", "oracle")).toBe("TIMESTAMP WITH TIME ZONE");
		expect(convert("LONGBLOB", "mariadb", "oracle")).toBe("BLOB");
	});

	it("adds the missing types", () => {
		expect(convert("BIT", "mssql", "oracle")).toBe("NUMBER(1)");
		expect(convert("UNIQUEIDENTIFIER", "mssql", "mariadb")).toBe("CHAR(36)");
		expect(convert("RAW(16)", "oracle", "mssql")).toBe("VARBINARY(16)");
		expect(convert("XML", "mssql", "oracle")).toBe("XMLTYPE");
		expect(convert("JSON", "mariadb", "postgresql")).toBe("JSONB");
		expect(convert("UUID", "postgresql", "mssql")).toBe("UNIQUEIDENTIFIER");
		expect(convert("BIT(8)", "mariadb", "oracle")).toBe("VARCHAR2(8)");
	});

	it("leaves an unknown type as it is and reports it", () => {
		const unmapped = new Set<string>();
		expect(dataTypeUtil.convertDataType("GEOMETRY", "mariadb", "oracle", unmapped)).toBe("GEOMETRY");
		expect(dataTypeUtil.convertDataType("", "mariadb", "oracle", unmapped)).toBe("");
		expect([...unmapped]).toEqual(["GEOMETRY"]);
	});

	it("lists types for the input helper", () => {
		expect(dataTypeUtil.getDataTypes("mariadb")).toMatchObject({ VARBINARY: "Y", LONGBLOB: "N", INT: "N" });
		expect(dataTypeUtil.getDataTypes("mssql")).toMatchObject({ BIT: "N", UNIQUEIDENTIFIER: "N", NVARCHAR: "Y" });
	});
});

describe("sqlDataType", () => {
	it("keeps modifiers after the size", () => {
		expect(sqlDataType("TIMESTAMP(6) WITH TIME ZONE")).toBe("TIMESTAMP(6) WITH TIME ZONE");
		expect(sqlDataType("INT(10) UNSIGNED")).toBe("INT(10) UNSIGNED");
		expect(sqlDataType("VARCHAR2(10 CHAR)")).toBe("VARCHAR2(10 CHAR)");
		expect(sqlDataType("ENUM('A','B')")).toBe("ENUM('A','B')");
		expect(sqlDataType("INTEGER[]")).toBe("INTEGER[]");
		expect(sqlDataType("VARCHAR(10); DROP TABLE x")).toBe("VARCHAR(10)");
	});
});
