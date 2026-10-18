/**
 * Reverse engineering: DB 서버의 카탈로그를 조회해서 테이블, 관계, 인덱스, 뷰, 시퀀스 정보를 만든다.
 * DBMS마다 조회만 다르고, 결과는 공통 형식(RawSchema)으로 바꾼 뒤 buildSchema()에서 한 번에 정리한다.
 */
import type { DbmsType, ReferentialAction } from "../constants";
import { REFERENTIAL_ACTIONS } from "../constants";
import { normalizeDateTimeDefault } from "../sql/ERDDiff";
import { sqlString } from "../sql/SQLMaker";
import type { ImportRelationData, ImportTableData } from "../sql/Sql2Json";
import type { CheckData, FieldData, IndexData, SequenceObject, ViewObject } from "../types";
import { diagramUtil } from "../util/diagramUtil";
import type { DbRow, DbSession } from "./connection";

export interface DbTable extends ImportTableData {
	/** 기본키 컬럼 (기본키 순서) */
	primaryKey: string[];
}

export interface DbSchema {
	dbms: DbmsType;
	tables: DbTable[];
	relations: ImportRelationData[];
	views: ViewObject[];
	sequences: SequenceObject[];
}

/* -----------------------------------------------------------------------------------
 * 공통 형식
 */
export interface RawColumn {
	table: string;
	column: string;
	dataType: string;
	notNull: boolean;
	defaultValue?: string;
	comment?: string;
	ai: boolean;
	position: number;
}

export interface RawConstraint {
	name: string;
	/** P: 기본키, U: 유니크, F: 외래키 */
	kind: "P" | "U" | "F";
	table: string;
	column: string;
	position: number;
	refTable?: string;
	refColumn?: string;
	onDelete?: ReferentialAction;
	onUpdate?: ReferentialAction;
	/** DBMS가 지은 이름 (유니크: 한 컬럼이면 컬럼의 UNIQUE로 처리) */
	systemNamed?: boolean;
}

export interface RawIndex {
	table: string;
	name: string;
	unique: boolean;
	column: string;
	position: number;
}

export interface RawSchema {
	tables: { name: string; comment?: string }[];
	columns: RawColumn[];
	constraints: RawConstraint[];
	indexes: RawIndex[];
	checks: { table: string; name: string; expression: string }[];
	views: { name: string; definition: string }[];
	sequences: { name: string; start?: number; increment?: number; minValue?: number; maxValue?: number; cycle: boolean }[];
}

const text = (value: unknown): string => value === null || value === undefined ? "" : String(value);
const optText = (value: unknown): string | undefined => text(value).trim() || undefined;
const num = (value: unknown): number => Number(value ?? 0);
const yes = (value: unknown): boolean => value === true || value === 1 || /^(Y|YES|TRUE|1|t)$/i.test(text(value).trim());
const optNum = (value: unknown): number | undefined => {
	const n = Number(text(value).trim() || NaN);
	return Number.isFinite(n) ? n : undefined;
};

/** 바깥의 짝이 맞는 괄호를 모두 벗긴다: ((0)) -> 0 */
export function stripOuterParens(value: string): string {
	let result = value.trim();
	while (result.startsWith("(") && result.endsWith(")")) {
		let depth = 0, wrapsAll = true;
		for (let i = 0; i < result.length; i++) {
			if (result[i] === "(") depth++;
			else if (result[i] === ")" && --depth === 0 && i < result.length - 1) { wrapsAll = false; break; }
		}
		if (!wrapsAll) break;
		result = result.slice(1, -1).trim();
	}
	return result;
}

/** 참조 동작. NO ACTION은 기본값이므로 생략 */
export function toReferentialAction(value: unknown, dbms: DbmsType): ReferentialAction | undefined {
	const pgCodes: Record<string, string> = { a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT" };
	let action = text(value).trim();
	if (dbms === "postgresql" && action.length === 1) action = pgCodes[action] ?? "";
	action = action.toUpperCase().replace(/_/g, " ");
	if (action === "NO ACTION") return undefined;
	if (dbms === "mariadb" && action === "RESTRICT") return undefined;		// InnoDB 기본값 (NO ACTION과 같음)
	return REFERENTIAL_ACTIONS.includes(action as ReferentialAction) ? action as ReferentialAction : undefined;
}

const DEFAULT_EXPRESSION = /^(CURRENT_\w+|LOCALTIME\w*|NOW|SYSDATE|SYSTIMESTAMP|GETDATE|UUID|NULL|TRUE|FALSE)\b|\(/i;

/** 기본값을 ERD 형식으로: 문자열은 따옴표로 감싸고, 숫자와 함수는 그대로 */
export function normalizeDefault(value: string | undefined, dbms: DbmsType): string | undefined {
	if (value === undefined) return undefined;
	let result = value.trim();
	if (dbms === "mssql") result = stripOuterParens(result);
	if (dbms === "postgresql") result = result.replace(/^('(?:[^']|'')*')::[\w\s."]+(\[\])?$/, "$1").replace(/^\((-?[\d.]+)\)::[\w\s."]+$/, "$1");
	if (!result || /^NULL$/i.test(result)) return undefined;
	result = normalizeDateTimeDefault(result);
	if (/^N?'(?:[^']|'')*'$/.test(result) || /^[+-]?\d+(\.\d+)?$/.test(result) || DEFAULT_EXPRESSION.test(result)) return result;
	// MySQL은 문자열 기본값을 따옴표 없이 돌려준다
	return `'${sqlString(result)}'`;
}

/** CHECK (조건) -> 조건 */
function checkExpression(definition: string): string {
	return stripOuterParens(definition.trim().replace(/^CHECK\s*/i, "").replace(/\s+NOT\s+VALID$/i, ""));
}

/** 공통 형식을 ERD 데이터로 */
export function buildSchema(raw: RawSchema, dbms: DbmsType): DbSchema {
	const tables = new Map<string, DbTable>();
	for (const t of raw.tables) {
		tables.set(t.name, { physicalName: t.name, logicalName: optText(t.comment), columns: [], primaryKey: [] });
	}
	const fieldOf = (table: string, column: string) => tables.get(table)?.columns.find(f => f.column === column);

	for (const c of [...raw.columns].sort((a, b) => a.position - b.position)) {
		const table = tables.get(c.table);
		if (!table) continue;
		const field: FieldData = { id: "f" + diagramUtil.getUniqueID(), column: c.column, dataType: c.dataType };
		if (c.comment?.trim()) field.comment = c.comment.trim();
		if (c.notNull) field.notNull = true;
		if (c.ai) field.ai = true;
		const defaultValue = c.ai ? undefined : normalizeDefault(c.defaultValue, dbms);
		if (defaultValue !== undefined) field.defaultValue = defaultValue;
		table.columns.push(field);
	}

	// 제약조건: 이름별로 모은다
	const groups = new Map<string, RawConstraint[]>();
	for (const c of raw.constraints) {
		const key = `${c.kind}\u0000${c.table}\u0000${c.name}`;
		const list = groups.get(key);
		if (list) list.push(c);
		else groups.set(key, [c]);
	}
	const relations: ImportRelationData[] = [];
	const foreignKeyNames = new Set<string>();
	for (const list of groups.values()) {
		list.sort((a, b) => a.position - b.position);
		const { kind, table: tableName, name } = list[0];
		const table = tables.get(tableName);
		if (!table) continue;
		if (kind === "P") {
			table.primaryKey = list.map(c => c.column);
			for (const c of list) {
				const field = fieldOf(tableName, c.column);
				if (field) { field.isPK = true; field.notNull = true; }
			}
		} else if (kind === "U") {
			const field = list.length === 1 && list[0].systemNamed ? fieldOf(tableName, list[0].column) : undefined;
			if (field) field.uniqueKey = true;
			else (table.indexes ??= []).push({ name, fields: list.map(c => c.column).join(","), unique: true });
		} else {
			foreignKeyNames.add(`${tableName}\u0000${name}`.toUpperCase());
			if (!list[0].refTable || list.some(c => !c.refColumn)) continue;
			relations.push({
				name,
				childTable: tableName,
				childFields: list.map(c => c.column).join(","),
				parentTable: list[0].refTable,
				parentFields: list.map(c => c.refColumn).join(","),
				onDelete: list[0].onDelete,
				onUpdate: list[0].onUpdate,
			});
		}
	}

	const indexes = new Map<string, RawIndex[]>();
	for (const i of raw.indexes) {
		const key = `${i.table}\u0000${i.name}`;
		const list = indexes.get(key);
		if (list) list.push(i);
		else indexes.set(key, [i]);
	}
	for (const list of indexes.values()) {
		list.sort((a, b) => a.position - b.position);
		const { table: tableName, name, unique } = list[0];
		const table = tables.get(tableName);
		const columns = list.map(i => i.column).filter(column => !/^SYS_NC/i.test(column));		// Oracle 함수 기반 인덱스
		if (!table || columns.length === 0) continue;
		// MariaDB가 외래키에 자동으로 만든 인덱스
		if (!unique && foreignKeyNames.has(`${tableName}\u0000${name}`.toUpperCase())) continue;
		const index: IndexData = { name, fields: columns.join(",") };
		if (unique) index.unique = true;
		(table.indexes ??= []).push(index);
	}

	for (const c of raw.checks) {
		const table = tables.get(c.table);
		const expression = checkExpression(c.expression);
		// Oracle은 NOT NULL도 CHECK 제약조건으로 보여준다
		if (!table || !expression || /^"?[\w$#]+"?\s+IS\s+NOT\s+NULL$/i.test(expression)) continue;
		const check: CheckData = { name: c.name, expression };
		(table.checks ??= []).push(check);
	}

	const views: ViewObject[] = raw.views.map(v => ({
		id: "v" + diagramUtil.getUniqueID(),
		name: v.name,
		query: v.definition.trim().replace(/;+\s*$/, ""),
	}));
	const sequences: SequenceObject[] = raw.sequences.map(s => {
		const seq: SequenceObject = { id: "s" + diagramUtil.getUniqueID(), name: s.name };
		if (s.start !== undefined) seq.start = s.start;
		if (s.increment !== undefined) seq.increment = s.increment;
		// 기본 범위는 생략
		if (s.minValue !== undefined && s.minValue !== 1 && Math.abs(s.minValue) < 2147483647) seq.minValue = s.minValue;
		if (s.maxValue !== undefined && Math.abs(s.maxValue) < 2147483647) seq.maxValue = s.maxValue;
		if (s.cycle) seq.cycle = true;
		return seq;
	});

	return { dbms, tables: [...tables.values()], relations, views, sequences };
}

/* -----------------------------------------------------------------------------------
 * DBMS별 조회
 */
type Log = (message: string) => void;

/** 버전에 따라 없을 수 있는 정보(CHECK, 뷰, 시퀀스)는 실패해도 계속 */
async function optional(log: Log, label: string, ...queries: (() => Promise<DbRow[]>)[]): Promise<DbRow[]> {
	let lastError: unknown;
	for (const query of queries) {
		try {
			return await query();
		} catch (error) {
			lastError = error;
		}
	}
	log(`Skipped ${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
	return [];
}

function constraintRows(rows: DbRow[], dbms: DbmsType): RawConstraint[] {
	return rows.map(r => ({
		name: text(r.constraint_name),
		kind: (({ p: "P", u: "U", f: "F", r: "F", P: "P", U: "U", F: "F", R: "F" } as Record<string, "P" | "U" | "F">)[text(r.kind)] ?? "U"),
		table: text(r.table_name),
		column: text(r.column_name),
		position: num(r.position),
		refTable: optText(r.ref_table),
		refColumn: optText(r.ref_column),
		onDelete: toReferentialAction(r.delete_rule, dbms),
		onUpdate: toReferentialAction(r.update_rule, dbms),
		systemNamed: yes(r.system_named),
	}));
}

function indexRows(rows: DbRow[]): RawIndex[] {
	return rows.map(r => ({ table: text(r.table_name), name: text(r.index_name), unique: yes(r.is_unique), column: text(r.column_name), position: num(r.position) }));
}

function checkRows(rows: DbRow[]): RawSchema["checks"] {
	return rows.map(r => ({ table: text(r.table_name), name: text(r.constraint_name), expression: text(r.expression) }));
}

function sequenceRows(rows: DbRow[]): RawSchema["sequences"] {
	return rows.map(r => ({
		name: text(r.name), start: optNum(r.start_value), increment: optNum(r.increment),
		minValue: optNum(r.min_value), maxValue: optNum(r.max_value), cycle: yes(r.is_cycle),
	}));
}

async function readMariaDB(session: DbSession, schema: string, log: Log): Promise<RawSchema> {
	const s = schema ? `'${sqlString(schema, true)}'` : "DATABASE()";
	const tables = await session.query(`SELECT TABLE_NAME AS table_name, TABLE_COMMENT AS table_comment FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${s} AND TABLE_TYPE = 'BASE TABLE'`);
	const columns = await session.query(`SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, COLUMN_TYPE AS data_type, IS_NULLABLE AS nullable,
		COLUMN_DEFAULT AS default_value, COLUMN_COMMENT AS column_comment, EXTRA AS extra, ORDINAL_POSITION AS position
		FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ${s}`);
	const statistics = await session.query(`SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name, NON_UNIQUE AS non_unique, COLUMN_NAME AS column_name, SEQ_IN_INDEX AS position
		FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ${s}`);
	const foreignKeys = await session.query(`SELECT k.CONSTRAINT_NAME AS constraint_name, 'F' AS kind, k.TABLE_NAME AS table_name, k.COLUMN_NAME AS column_name,
		k.REFERENCED_TABLE_NAME AS ref_table, k.REFERENCED_COLUMN_NAME AS ref_column, k.ORDINAL_POSITION AS position, r.DELETE_RULE AS delete_rule, r.UPDATE_RULE AS update_rule
		FROM information_schema.KEY_COLUMN_USAGE k
		JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
		WHERE k.TABLE_SCHEMA = ${s} AND k.REFERENCED_TABLE_NAME IS NOT NULL`);
	const checkSQL = (join: string) => `SELECT tc.TABLE_NAME AS table_name, cc.CONSTRAINT_NAME AS constraint_name, cc.CHECK_CLAUSE AS expression
		FROM information_schema.TABLE_CONSTRAINTS tc
		JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME ${join}
		WHERE tc.TABLE_SCHEMA = ${s} AND tc.CONSTRAINT_TYPE = 'CHECK'`;
	const checks = await optional(log, "check constraints",
		() => session.query(checkSQL("AND cc.TABLE_NAME = tc.TABLE_NAME")),		// MariaDB
		() => session.query(checkSQL("")));										// MySQL
	const views = await optional(log, "views", () => session.query(`SELECT TABLE_NAME AS view_name, VIEW_DEFINITION AS definition FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ${s}`));

	const constraints: RawConstraint[] = constraintRows(foreignKeys, "mariadb");
	const indexes: RawIndex[] = [];
	for (const r of statistics) {
		const name = text(r.index_name), unique = num(r.non_unique) === 0;
		if (name === "PRIMARY") constraints.push({ name, kind: "P", table: text(r.table_name), column: text(r.column_name), position: num(r.position) });
		// 컬럼에 UNIQUE를 지정하면 인덱스 이름이 컬럼명
		else if (unique) constraints.push({ name, kind: "U", table: text(r.table_name), column: text(r.column_name), position: num(r.position), systemNamed: name === text(r.column_name) });
		else indexes.push({ table: text(r.table_name), name, unique, column: text(r.column_name), position: num(r.position) });
	}

	return {
		tables: tables.map(r => ({ name: text(r.table_name), comment: optText(r.table_comment) })),
		columns: columns.map(r => ({
			table: text(r.table_name), column: text(r.column_name),
			// 정수의 표시 너비는 의미가 없으므로 제거 (TINYINT(1)은 BOOLEAN으로 쓰므로 유지)
			dataType: text(r.data_type).toUpperCase().replace(/^(SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT)\(\d+\)/, "$1").replace(/^TINYINT\((?!1\))\d+\)/, "TINYINT"),
			notNull: text(r.nullable) === "NO",
			defaultValue: r.default_value === null ? undefined : text(r.default_value),
			comment: optText(r.column_comment),
			ai: /auto_increment/i.test(text(r.extra)),
			position: num(r.position),
		})),
		constraints, indexes,
		checks: checkRows(checks),
		// 뷰 정의의 테이블 이름 앞에 붙는 스키마(`db`.)는 제거
		views: views.map(r => ({ name: text(r.view_name), definition: schema ? text(r.definition).split("`" + schema + "`.").join("") : text(r.definition) })),
		sequences: [],
	};
}

/** PostgreSQL 타입 이름을 짧은 형식으로 */
export function pgDataType(type: string): string {
	return type
		.replace(/^character varying/, "varchar")
		.replace(/^character\b/, "char")
		.replace(/^bit varying/, "varbit")
		.replace(/^(timestamp|time)(\(\d+\))? with time zone/, (_m, t: string, p = "") => (t === "timestamp" ? "timestamptz" : "timetz") + p)
		.replace(/^(timestamp|time)(\(\d+\))? without time zone/, "$1$2")
		.toUpperCase();
}

async function readPostgreSQL(session: DbSession, schema: string, log: Log): Promise<RawSchema> {
	const s = `'${sqlString(schema || "public")}'`;
	const from = `FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace`;
	const tables = await session.query(`SELECT c.relname::text AS table_name, obj_description(c.oid, 'pg_class')::text AS table_comment
		${from} WHERE n.nspname = ${s} AND c.relkind IN ('r', 'p') AND NOT c.relispartition`);
	const columns = await session.query(`SELECT c.relname::text AS table_name, a.attname::text AS column_name, format_type(a.atttypid, a.atttypmod)::text AS data_type,
		CASE WHEN a.attnotnull THEN 'Y' ELSE 'N' END AS not_null, pg_get_expr(d.adbin, d.adrelid)::text AS default_value,
		col_description(c.oid, a.attnum)::text AS column_comment, a.attidentity::text AS identity, a.attnum::int AS position
		FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
		LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
		WHERE n.nspname = ${s} AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped`);
	const constraints = await session.query(`SELECT con.conname::text AS constraint_name, con.contype::text AS kind, c.relname::text AS table_name,
		a.attname::text AS column_name, k.ord::int AS position, fc.relname::text AS ref_table, fa.attname::text AS ref_column,
		con.confdeltype::text AS delete_rule, con.confupdtype::text AS update_rule,
		CASE WHEN con.conname = c.relname || '_' || a.attname || '_key' THEN 'Y' ELSE 'N' END AS system_named
		FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
		CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
		JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
		LEFT JOIN pg_class fc ON fc.oid = con.confrelid
		LEFT JOIN pg_attribute fa ON fa.attrelid = con.confrelid AND fa.attnum = con.confkey[k.ord::int]
		WHERE n.nspname = ${s} AND con.contype IN ('p', 'u', 'f')`);
	const indexes = await session.query(`SELECT t.relname::text AS table_name, i.relname::text AS index_name, CASE WHEN ix.indisunique THEN 'Y' ELSE 'N' END AS is_unique,
		a.attname::text AS column_name, k.ord::int AS position
		FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid JOIN pg_class t ON t.oid = ix.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace
		CROSS JOIN LATERAL unnest(ix.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
		JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
		WHERE n.nspname = ${s} AND k.ord <= ix.indnkeyatts
		  AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = ix.indexrelid AND con.contype IN ('p', 'u', 'x'))`);
	const checks = await optional(log, "check constraints", () => session.query(`SELECT c.relname::text AS table_name, con.conname::text AS constraint_name,
		pg_get_constraintdef(con.oid)::text AS expression
		FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = ${s} AND con.contype = 'c'`));
	const views = await optional(log, "views", () => session.query(`SELECT viewname::text AS view_name, definition::text AS definition FROM pg_views WHERE schemaname = ${s}`));
	// 컬럼(serial, identity)에 딸린 시퀀스는 제외
	const sequences = await optional(log, "sequences", () => session.query(`SELECT s.sequencename::text AS name, s.start_value::text AS start_value,
		s.increment_by::text AS increment, s.min_value::text AS min_value, s.max_value::text AS max_value, CASE WHEN s.cycle THEN 'Y' ELSE 'N' END AS is_cycle
		FROM pg_sequences s JOIN pg_namespace n ON n.nspname = s.schemaname JOIN pg_class c ON c.relname = s.sequencename AND c.relnamespace = n.oid
		WHERE s.schemaname = ${s}
		  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype IN ('a', 'i'))`));

	return {
		tables: tables.map(r => ({ name: text(r.table_name), comment: optText(r.table_comment) })),
		columns: columns.map(r => {
			const defaultValue = r.default_value === null ? undefined : text(r.default_value);
			const ai = /^[ad]$/.test(text(r.identity)) || /^nextval\(/i.test(defaultValue ?? "");
			return {
				table: text(r.table_name), column: text(r.column_name), dataType: pgDataType(text(r.data_type)),
				notNull: yes(r.not_null), defaultValue, comment: optText(r.column_comment), ai, position: num(r.position),
			};
		}),
		constraints: constraintRows(constraints, "postgresql"),
		indexes: indexRows(indexes),
		checks: checkRows(checks),
		views: views.map(r => ({ name: text(r.view_name), definition: text(r.definition) })),
		sequences: sequenceRows(sequences),
	};
}

/** MS-SQL 타입 이름 + 길이 */
export function mssqlDataType(type: string, maxLength: number, precision: number, scale: number): string {
	const name = type.toLowerCase();
	if (["varchar", "char", "varbinary", "binary"].includes(name)) return `${name}(${maxLength === -1 ? "MAX" : maxLength})`.toUpperCase();
	if (["nvarchar", "nchar"].includes(name)) return `${name}(${maxLength === -1 ? "MAX" : maxLength / 2})`.toUpperCase();
	if (["decimal", "numeric"].includes(name)) return `${name}(${precision},${scale})`.toUpperCase();
	if (["datetime2", "time", "datetimeoffset"].includes(name) && scale !== 7) return `${name}(${scale})`.toUpperCase();
	return name.toUpperCase();
}

async function readMsSql(session: DbSession, schema: string, log: Log): Promise<RawSchema> {
	const s = `N'${sqlString(schema || "dbo")}'`;
	const description = (major: string, minor: string) =>
		`LEFT JOIN sys.extended_properties ep ON ep.class = 1 AND ep.major_id = ${major} AND ep.minor_id = ${minor} AND ep.name = 'MS_Description'`;
	const tables = await session.query(`SELECT t.name AS table_name, CAST(ep.value AS NVARCHAR(4000)) AS table_comment
		FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id ${description("t.object_id", "0")}
		WHERE s.name = ${s} AND t.is_ms_shipped = 0`);
	const columns = await session.query(`SELECT t.name AS table_name, c.name AS column_name, ty.name AS type_name,
		CAST(c.max_length AS INT) AS max_length, CAST(c.precision AS INT) AS num_precision, CAST(c.scale AS INT) AS num_scale,
		CASE WHEN c.is_nullable = 1 THEN 'N' ELSE 'Y' END AS not_null, CASE WHEN c.is_identity = 1 THEN 'Y' ELSE 'N' END AS ai,
		dc.definition AS default_value, CAST(ep.value AS NVARCHAR(4000)) AS column_comment, CAST(c.column_id AS INT) AS position
		FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id JOIN sys.schemas s ON s.schema_id = t.schema_id
		JOIN sys.types ty ON ty.user_type_id = c.user_type_id
		LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id ${description("c.object_id", "c.column_id")}
		WHERE s.name = ${s}`);
	const indexes = await session.query(`SELECT t.name AS table_name, i.name AS index_name,
		CASE WHEN i.is_primary_key = 1 THEN 'P' WHEN i.is_unique_constraint = 1 THEN 'U' ELSE 'I' END AS kind,
		CASE WHEN i.is_unique = 1 THEN 'Y' ELSE 'N' END AS is_unique, CASE WHEN i.name LIKE 'UQ[_][_]%' THEN 'Y' ELSE 'N' END AS system_named,
		c.name AS column_name, CAST(ic.key_ordinal AS INT) AS position
		FROM sys.indexes i JOIN sys.tables t ON t.object_id = i.object_id JOIN sys.schemas s ON s.schema_id = t.schema_id
		JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
		JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
		WHERE s.name = ${s} AND i.type > 0 AND ic.key_ordinal > 0 AND i.is_hypothetical = 0`);
	const foreignKeys = await session.query(`SELECT fk.name AS constraint_name, 'F' AS kind, pt.name AS table_name, pc.name AS column_name,
		rt.name AS ref_table, rc.name AS ref_column, CAST(fkc.constraint_column_id AS INT) AS position,
		fk.delete_referential_action_desc AS delete_rule, fk.update_referential_action_desc AS update_rule
		FROM sys.foreign_keys fk JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
		JOIN sys.tables pt ON pt.object_id = fkc.parent_object_id JOIN sys.schemas s ON s.schema_id = pt.schema_id
		JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
		JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id
		JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
		WHERE s.name = ${s}`);
	const checks = await optional(log, "check constraints", () => session.query(`SELECT t.name AS table_name, cc.name AS constraint_name, cc.definition AS expression
		FROM sys.check_constraints cc JOIN sys.tables t ON t.object_id = cc.parent_object_id JOIN sys.schemas s ON s.schema_id = t.schema_id
		WHERE s.name = ${s}`));
	const views = await optional(log, "views", () => session.query(`SELECT v.name AS view_name, OBJECT_DEFINITION(v.object_id) AS definition
		FROM sys.views v JOIN sys.schemas s ON s.schema_id = v.schema_id WHERE s.name = ${s} AND v.is_ms_shipped = 0`));
	const sequences = await optional(log, "sequences", () => session.query(`SELECT sq.name AS name, CAST(sq.start_value AS VARCHAR(40)) AS start_value,
		CAST(sq.increment AS VARCHAR(40)) AS increment, CAST(sq.minimum_value AS VARCHAR(40)) AS min_value, CAST(sq.maximum_value AS VARCHAR(40)) AS max_value,
		CASE WHEN sq.is_cycling = 1 THEN 'Y' ELSE 'N' END AS is_cycle
		FROM sys.sequences sq JOIN sys.schemas s ON s.schema_id = sq.schema_id WHERE s.name = ${s}`));

	const constraints = constraintRows(foreignKeys, "mssql");
	const indexList: RawIndex[] = [];
	for (const r of indexes) {
		const kind = text(r.kind);
		if (kind === "P" || kind === "U") constraints.push(...constraintRows([r], "mssql").map(c => ({ ...c, name: text(r.index_name) })));
		else indexList.push(...indexRows([r]));
	}

	return {
		tables: tables.map(r => ({ name: text(r.table_name), comment: optText(r.table_comment) })),
		columns: columns.map(r => ({
			table: text(r.table_name), column: text(r.column_name),
			dataType: mssqlDataType(text(r.type_name), num(r.max_length), num(r.num_precision), num(r.num_scale)),
			notNull: yes(r.not_null), defaultValue: r.default_value === null ? undefined : text(r.default_value),
			comment: optText(r.column_comment), ai: yes(r.ai), position: num(r.position),
		})),
		constraints,
		indexes: indexList,
		checks: checkRows(checks),
		// OBJECT_DEFINITION은 CREATE VIEW 구문 전체
		views: views.map(r => ({ name: text(r.view_name), definition: text(r.definition).replace(/^\s*CREATE\s+VIEW\s+[\s\S]+?\s+AS\s+/i, "") })),
		sequences: sequenceRows(sequences),
	};
}

/** Oracle 타입 이름 + 길이 */
export function oracleDataType(type: string, length: number, charLength: number, precision: string, scale: string): string {
	if (/^(N?VARCHAR2|N?CHAR)$/.test(type)) return `${type}(${charLength || length})`;
	if (type === "RAW") return `RAW(${length})`;
	if (type === "NUMBER") {
		if (!precision && !scale) return "NUMBER";
		if (!precision) return scale === "0" ? "INTEGER" : "NUMBER";
		return !scale || scale === "0" ? `NUMBER(${precision})` : `NUMBER(${precision},${scale})`;
	}
	if (type === "FLOAT" && precision) return `FLOAT(${precision})`;
	return type;
}

async function readOracle(session: DbSession, schema: string, log: Log): Promise<RawSchema> {
	const o = schema ? `'${sqlString(schema.toUpperCase())}'` : "USER";
	const tables = await session.query(`SELECT t.table_name, c.comments AS table_comment FROM all_tables t
		LEFT JOIN all_tab_comments c ON c.owner = t.owner AND c.table_name = t.table_name
		WHERE t.owner = ${o} AND t.nested = 'NO' AND t.secondary = 'N' AND t.table_name NOT LIKE 'BIN$%' AND (t.iot_type IS NULL OR t.iot_type = 'IOT')`);
	const columnSQL = (identity: string) => `SELECT c.table_name, c.column_name, c.data_type, c.data_length, c.char_length, c.data_precision AS num_precision,
		c.data_scale AS num_scale, c.nullable, c.data_default AS default_value, cc.comments AS column_comment, c.column_id AS position, ${identity} AS ai
		FROM all_tab_columns c LEFT JOIN all_col_comments cc ON cc.owner = c.owner AND cc.table_name = c.table_name AND cc.column_name = c.column_name
		WHERE c.owner = ${o}`;
	let columns: DbRow[];
	try {
		columns = await session.query(columnSQL("c.identity_column"));
	} catch {
		columns = await session.query(columnSQL("'NO'"));		// 12c 이전
	}
	const constraints = await session.query(`SELECT c.constraint_name, c.constraint_type AS kind, c.table_name, cc.column_name, cc.position,
		r.table_name AS ref_table, rc.column_name AS ref_column, c.delete_rule, CASE WHEN c.generated = 'GENERATED NAME' THEN 'Y' ELSE 'N' END AS system_named
		FROM all_constraints c JOIN all_cons_columns cc ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name
		LEFT JOIN all_constraints r ON r.owner = c.r_owner AND r.constraint_name = c.r_constraint_name
		LEFT JOIN all_cons_columns rc ON rc.owner = c.r_owner AND rc.constraint_name = c.r_constraint_name AND rc.position = cc.position
		WHERE c.owner = ${o} AND c.constraint_type IN ('P', 'U', 'R') AND c.table_name NOT LIKE 'BIN$%'`);
	const indexes = await session.query(`SELECT i.table_name, i.index_name, CASE WHEN i.uniqueness = 'UNIQUE' THEN 'Y' ELSE 'N' END AS is_unique,
		ic.column_name, ic.column_position AS position
		FROM all_indexes i JOIN all_ind_columns ic ON ic.index_owner = i.owner AND ic.index_name = i.index_name
		WHERE i.owner = ${o} AND i.table_owner = ${o} AND i.index_type <> 'LOB'
		  AND NOT EXISTS (SELECT 1 FROM all_constraints c WHERE c.owner = i.table_owner AND c.index_name = i.index_name AND c.constraint_type IN ('P', 'U'))`);
	const checks = await optional(log, "check constraints", () => session.query(`SELECT table_name, constraint_name, search_condition AS expression
		FROM all_constraints WHERE owner = ${o} AND constraint_type = 'C' AND table_name NOT LIKE 'BIN$%'`));
	const views = await optional(log, "views", () => session.query(`SELECT view_name, text AS definition FROM all_views WHERE owner = ${o}`));
	const sequences = await optional(log, "sequences", () => session.query(`SELECT sequence_name AS name, TO_CHAR(last_number) AS start_value,
		TO_CHAR(increment_by) AS increment, TO_CHAR(min_value) AS min_value, TO_CHAR(max_value) AS max_value, cycle_flag AS is_cycle
		FROM all_sequences WHERE sequence_owner = ${o} AND sequence_name NOT LIKE 'ISEQ$$%'`));

	return {
		tables: tables.map(r => ({ name: text(r.table_name), comment: optText(r.table_comment) })),
		columns: columns.map(r => ({
			table: text(r.table_name), column: text(r.column_name),
			dataType: oracleDataType(text(r.data_type), num(r.data_length), num(r.char_length), text(r.num_precision), text(r.num_scale)),
			notNull: text(r.nullable) === "N", defaultValue: r.default_value === null ? undefined : text(r.default_value),
			comment: optText(r.column_comment), ai: yes(r.ai), position: num(r.position),
		})),
		constraints: constraintRows(constraints, "oracle"),
		indexes: indexRows(indexes),
		checks: checkRows(checks),
		views: views.map(r => ({ name: text(r.view_name), definition: text(r.definition) })),
		sequences: sequenceRows(sequences),
	};
}

export async function readSchema(session: DbSession, log: Log = () => {}): Promise<DbSchema> {
	const { dbms, schema, database } = session.config;
	let raw: RawSchema;
	switch (dbms) {
		case "postgresql": raw = await readPostgreSQL(session, schema, log); break;
		case "mssql":      raw = await readMsSql(session, schema, log); break;
		case "oracle":     raw = await readOracle(session, schema, log); break;
		default:           raw = await readMariaDB(session, schema || database, log);
	}
	return buildSchema(raw, dbms);
}
