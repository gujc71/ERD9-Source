/**
 * 두 ERD 문서(파일 형식) 비교와 ALTER 스크립트 생성.
 * 테이블과 컬럼은 id가 같으면 같은 객체로 보고(이름이 바뀌면 RENAME), id가 다르면 이름으로 맞춘다.
 */
import type { ReferentialAction } from "../constants";
import type { CheckData, EntityData, ERDFileData, FieldData, IndexData, RelationFieldInfo, SequenceObject, ViewObject } from "../types";
import { getAllFields } from "./SQLMaker";
import type { SQLMaker } from "./SQLMaker";

export interface ColumnChange {
	oldField: FieldData;
	newField: FieldData;
	renamed: boolean;
	/** 타입, NOT NULL, 기본값, 자동 증가 */
	definitionChanged: boolean;
	commentChanged: boolean;
	uniqueAdded: boolean;
	uniqueRemoved: boolean;
}

export interface TableDiff {
	status: "added" | "removed" | "modified";
	oldTable?: EntityData;
	newTable?: EntityData;
	renamed: boolean;
	commentChanged: boolean;
	addedColumns: FieldData[];
	removedColumns: FieldData[];
	changedColumns: ColumnChange[];
	pkChanged: boolean;
	addedIndexes: IndexData[];
	removedIndexes: IndexData[];
	addedChecks: CheckData[];
	removedChecks: CheckData[];
}

export interface ForeignKeyInfo {
	name: string;
	info: RelationFieldInfo;
	onDelete?: ReferentialAction;
	onUpdate?: ReferentialAction;
	childId: string;
	parentId: string;
	childFieldIds: string[];
	parentFieldIds: string[];
}

interface ObjectDiff<T> {
	added: T[];
	removed: T[];
	changed: { oldObject: T; newObject: T }[];
}

export interface ERDDiff {
	tables: TableDiff[];
	addedForeignKeys: ForeignKeyInfo[];
	removedForeignKeys: ForeignKeyInfo[];
	views: ObjectDiff<ViewObject>;
	sequences: ObjectDiff<SequenceObject>;
}

const upper = (value: string) => value.trim().toUpperCase();

/** id로 먼저 맞추고, 남은 것은 이름으로 맞춘다. 반환: 이전 key -> 새 key */
function matchByIdThenName<T>(oldItems: Map<string, T>, newItems: Map<string, T>, getName: (item: T) => string): Map<string, string> {
	const matched = new Map<string, string>();
	const usedNew = new Set<string>();
	for (const id of oldItems.keys()) {
		if (newItems.has(id)) {
			matched.set(id, id);
			usedNew.add(id);
		}
	}
	const newByName = new Map<string, string>();
	for (const [id, item] of newItems) {
		if (!usedNew.has(id) && !newByName.has(upper(getName(item)))) newByName.set(upper(getName(item)), id);
	}
	for (const [id, item] of oldItems) {
		if (matched.has(id)) continue;
		const newId = newByName.get(upper(getName(item)));
		if (newId === undefined) continue;
		matched.set(id, newId);
		newByName.delete(upper(getName(item)));
	}
	return matched;
}

const sameValue = (a: unknown, b: unknown) => String(a ?? "") === String(b ?? "");

/** 같은 타입의 다른 이름 (DB 카탈로그에서 읽은 이름과 ERD에 입력한 이름 비교) */
const TYPE_ALIASES: Record<string, string> = {
	INTEGER: "INT", INT4: "INT", INT8: "BIGINT", INT2: "SMALLINT", BOOL: "BOOLEAN", NUMERIC: "DECIMAL", DEC: "DECIMAL",
	"CHARACTER VARYING": "VARCHAR", CHARACTER: "CHAR", FLOAT8: "DOUBLE PRECISION", FLOAT4: "REAL",
	"TIMESTAMP WITHOUT TIME ZONE": "TIMESTAMP", "TIMESTAMP WITH TIME ZONE": "TIMESTAMPTZ",
};
function normalizeDataType(dataType: string): string {
	const type = upper(dataType).replace(/\s+/g, " ").replace(/\s*([(),])\s*/g, "$1")
		.replace(/^(TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT)\(\d+\)/, "$1");		// 정수의 표시 너비(MariaDB INT(11))는 무시
	const [, name = type, args = ""] = type.match(/^([A-Z][A-Z0-9_ ]*?)(\(.*\))?$/) ?? [];
	return (TYPE_ALIASES[name] ?? name) + args;
}
export function sameDataType(a: string, b: string): boolean {
	return normalizeDataType(a) === normalizeDataType(b);
}

/**
 * 날짜/시간 함수 기본값을 같은 표기로: current_timestamp() -> CURRENT_TIMESTAMP, now() -> CURRENT_TIMESTAMP.
 * (MariaDB는 CURRENT_TIMESTAMP를 current_timestamp()로 돌려준다)
 */
export function normalizeDateTimeDefault(value: string): string {
	return value.trim()
		.replace(/^now\s*\(\s*\)$/i, "CURRENT_TIMESTAMP")
		.replace(/^(current_timestamp|current_date|current_time|localtimestamp|localtime)\s*(?:\(\s*\))?$/i, (_, name: string) => name.toUpperCase());
}

/** 기본값: 바깥 괄호와 따옴표는 무시 ('A' = A, ((0)) = 0) */
function normalizeDefault(value: unknown): string {
	let text = String(value ?? "").trim();
	while (/^\(.*\)$/.test(text)) text = text.slice(1, -1).trim();
	return normalizeDateTimeDefault(text).replace(/^N?'((?:[^']|'')*)'$/, "$1");
}
export function sameDefault(a: unknown, b: unknown): boolean {
	return normalizeDefault(a) === normalizeDefault(b);
}

/** CHECK 조건식: DB가 돌려주는 식별자 따옴표(`a`, "a", [a]), 공백, 바깥 괄호는 무시 */
function normalizeExpression(expression: string): string {
	let text = expression.replace(/[`"[\]]/g, "").replace(/\s+/g, "").toUpperCase();
	while (/^\(.*\)$/.test(text)) text = text.slice(1, -1);
	return text;
}
function sameExpression(a: string, b: string): boolean {
	return normalizeExpression(a) === normalizeExpression(b);
}

/**
 * 뷰 쿼리: DB가 다시 써서 돌려주는 표기 차이는 무시한다.
 * 식별자 따옴표, 같은 이름의 별칭(o.ID AS ID), AS, INNER, 괄호, 공백, 대소문자
 * (MariaDB: select `o`.`ID` AS `ID` from (`orders` `o` join ...), PostgreSQL: 괄호와 소문자)
 */
function normalizeQuery(query: string): string {
	return query.replace(/[`"[\]]/g, "").replace(/;+\s*$/, "")
		.replace(/\b(\w+\.)?(\w+)\s+AS\s+\2\b/gi, "$1$2")
		.replace(/\s+AS\s+/gi, " ").replace(/\bINNER\s+JOIN\b/gi, "JOIN")
		.replace(/[()\s]/g, "").toUpperCase();
}
export function sameQuery(a: string, b: string): boolean {
	return normalizeQuery(a) === normalizeQuery(b);
}

function compareColumns(oldTable: EntityData, newTable: EntityData, fieldMatch: Map<string, FieldData>): Pick<TableDiff, "addedColumns" | "removedColumns" | "changedColumns" | "pkChanged"> {
	const oldFields = new Map(getAllFields(oldTable).map(f => [f.id, f]));
	const newFields = new Map(getAllFields(newTable).map(f => [f.id, f]));
	const matched = matchByIdThenName(oldFields, newFields, f => f.column);

	const changedColumns: ColumnChange[] = [];
	for (const [oldId, newId] of matched) {
		const oldField = oldFields.get(oldId)!, newField = newFields.get(newId)!;
		fieldMatch.set(oldId, newField);
		const change: ColumnChange = {
			oldField, newField,
			renamed: oldField.column !== newField.column,
			definitionChanged: !sameDataType(oldField.dataType, newField.dataType) || !!oldField.notNull !== !!newField.notNull ||
							   !sameDefault(oldField.defaultValue, newField.defaultValue) || !!oldField.ai !== !!newField.ai,
			commentChanged: !sameValue(oldField.comment, newField.comment),
			uniqueAdded: !oldField.uniqueKey && !!newField.uniqueKey,
			uniqueRemoved: !!oldField.uniqueKey && !newField.uniqueKey,
		};
		if (change.renamed || change.definitionChanged || change.commentChanged || change.uniqueAdded || change.uniqueRemoved) changedColumns.push(change);
	}
	const matchedNew = new Set(matched.values());

	// 기본키: 이전 키 컬럼을 새 이름으로 바꿔서 비교
	const oldPK = oldTable.keys.map(f => fieldMatch.get(f.id)?.column ?? "\u0000" + f.column);
	const newPK = newTable.keys.map(f => f.column);
	const pkChanged = oldPK.length !== newPK.length || oldPK.some((name, i) => name !== newPK[i]);

	return {
		addedColumns: getAllFields(newTable).filter(f => !matchedNew.has(f.id)),
		removedColumns: getAllFields(oldTable).filter(f => !matched.has(f.id)),
		changedColumns,
		pkChanged,
	};
}

/** 이름으로 비교. 같은 이름인데 내용이 다르면 삭제 후 추가 */
function compareNamed<T extends { name: string }>(oldList: T[] = [], newList: T[] = [], same: (a: T, b: T) => boolean): { added: T[]; removed: T[] } {
	const newByName = new Map(newList.map(item => [upper(item.name), item]));
	const oldByName = new Map(oldList.map(item => [upper(item.name), item]));
	return {
		removed: oldList.filter(item => { const n = newByName.get(upper(item.name)); return !n || !same(item, n); }),
		added: newList.filter(item => { const o = oldByName.get(upper(item.name)); return !o || !same(o, item); }),
	};
}

/** 컬럼명이 바뀐 경우 이전 인덱스의 컬럼 목록을 새 이름으로 */
function renameIndexFields(index: IndexData, oldTable: EntityData, fieldMatch: Map<string, FieldData>): IndexData {
	const byName = new Map(getAllFields(oldTable).map(f => [upper(f.column), f.id]));
	const fields = index.fields.split(",").map(name => {
		const id = byName.get(upper(name));
		return (id && fieldMatch.get(id)?.column) || name.trim();
	}).join(",");
	return { ...index, fields };
}

/** 문서의 관계를 외래키 정보로 */
export function collectForeignKeys(data: ERDFileData): ForeignKeyInfo[] {
	const list: ForeignKeyInfo[] = [];
	for (const relation of data.relationData) {
		const parent = data.entityData[relation.parent]?.data, child = data.entityData[relation.child]?.data;
		if (!parent || !child) continue;
		const parentFields = new Map(getAllFields(parent).map(f => [f.id, f]));
		const pairs = getAllFields(child)
			.filter(f => f.parentID && parentFields.has(f.parentID))
			.map(f => ({ childField: f, parentField: parentFields.get(f.parentID!)! }));
		if (pairs.length === 0) continue;
		list.push({
			name: relation.name || relation.id,
			info: {
				childTable: child.physicalName,
				childFields: pairs.map(p => p.childField.column).join(","),
				parentTable: parent.physicalName,
				parentFields: pairs.map(p => p.parentField.column).join(","),
			},
			onDelete: relation.onDelete,
			onUpdate: relation.onUpdate,
			childId: relation.child,
			parentId: relation.parent,
			childFieldIds: pairs.map(p => p.childField.id),
			parentFieldIds: pairs.map(p => p.parentField.id),
		});
	}
	return list;
}

function compareObjects<T extends { id: string; name: string }>(oldList: T[], newList: T[], same: (a: T, b: T) => boolean): ObjectDiff<T> {
	const oldMap = new Map(oldList.map(item => [item.id, item]));
	const newMap = new Map(newList.map(item => [item.id, item]));
	const matched = matchByIdThenName(oldMap, newMap, item => item.name);
	const matchedNew = new Set(matched.values());
	const changed: ObjectDiff<T>["changed"] = [];
	for (const [oldId, newId] of matched) {
		const oldObject = oldMap.get(oldId)!, newObject = newMap.get(newId)!;
		if (!same(oldObject, newObject)) changed.push({ oldObject, newObject });
	}
	return {
		added: newList.filter(item => !matchedNew.has(item.id)),
		removed: oldList.filter(item => !matched.has(item.id)),
		changed,
	};
}

export function diffERD(oldData: ERDFileData, newData: ERDFileData): ERDDiff {
	const oldTables = new Map(Object.entries(oldData.entityData).map(([id, e]) => [id, e.data]));
	const newTables = new Map(Object.entries(newData.entityData).map(([id, e]) => [id, e.data]));
	const tableMatch = matchByIdThenName(oldTables, newTables, t => t.physicalName);
	const fieldMatch = new Map<string, FieldData>();		// 이전 컬럼 id -> 새 컬럼

	const tables: TableDiff[] = [];
	const emptyDiff = { renamed: false, commentChanged: false, addedColumns: [], removedColumns: [], changedColumns: [], pkChanged: false,
						addedIndexes: [], removedIndexes: [], addedChecks: [], removedChecks: [] };

	for (const [oldId, oldTable] of oldTables) {
		const newId = tableMatch.get(oldId);
		if (newId === undefined) {
			tables.push({ ...emptyDiff, status: "removed", oldTable });
			continue;
		}
		const newTable = newTables.get(newId)!;
		const columns = compareColumns(oldTable, newTable, fieldMatch);
		const oldIndexes = (oldTable.indexes ?? []).map(index => renameIndexFields(index, oldTable, fieldMatch));
		const indexes = compareNamed(oldIndexes, newTable.indexes, (a, b) => upper(a.fields.replace(/\s/g, "")) === upper(b.fields.replace(/\s/g, "")) && !!a.unique === !!b.unique);
		const checks = compareNamed(oldTable.checks, newTable.checks, (a, b) => sameExpression(a.expression, b.expression));
		const diff: TableDiff = {
			status: "modified", oldTable, newTable,
			renamed: oldTable.physicalName !== newTable.physicalName,
			commentChanged: !sameValue(oldTable.logicalName, newTable.logicalName),
			...columns,
			addedIndexes: indexes.added,
			removedIndexes: indexes.removed.map(index => (oldTable.indexes ?? []).find(o => upper(o.name) === upper(index.name)) ?? index),
			addedChecks: checks.added,
			removedChecks: checks.removed,
		};
		if (diff.renamed || diff.commentChanged || diff.addedColumns.length || diff.removedColumns.length || diff.changedColumns.length ||
			diff.pkChanged || diff.addedIndexes.length || diff.removedIndexes.length || diff.addedChecks.length || diff.removedChecks.length) {
			tables.push(diff);
		}
	}
	const matchedNew = new Set(tableMatch.values());
	for (const [newId, newTable] of newTables) {
		if (!matchedNew.has(newId)) tables.push({ ...emptyDiff, status: "added", newTable });
	}

	// 외래키: 연결된 테이블과 컬럼이 대응되고 이름, 참조 동작이 같으면 그대로
	const oldFKs = collectForeignKeys(oldData), newFKs = collectForeignKeys(newData);
	const remainingNew = new Set(newFKs);
	// 자식, 부모 테이블과 컬럼 수가 같은 것끼리 모아 둔다 (같은 묶음 안에서만 아래 조건을 확인. 순서 유지)
	const fkGroupKey = (childId: string | undefined, parentId: string | undefined, count: number) => JSON.stringify([childId ?? null, parentId ?? null, count]);
	const newFKGroups = new Map<string, ForeignKeyInfo[]>();
	for (const newFK of newFKs) {
		const key = fkGroupKey(newFK.childId, newFK.parentId, newFK.childFieldIds.length);
		const group = newFKGroups.get(key);
		if (group) group.push(newFK);
		else newFKGroups.set(key, [newFK]);
	}
	const removedForeignKeys: ForeignKeyInfo[] = [];
	for (const oldFK of oldFKs) {
		const childId = tableMatch.get(oldFK.childId), parentId = tableMatch.get(oldFK.parentId);
		const group = childId === undefined || parentId === undefined ? undefined : newFKGroups.get(fkGroupKey(childId, parentId, oldFK.childFieldIds.length));
		const inx = group ? group.findIndex(newFK =>
			newFK.name === oldFK.name && (newFK.onDelete ?? "") === (oldFK.onDelete ?? "") && (newFK.onUpdate ?? "") === (oldFK.onUpdate ?? "") &&
			oldFK.childFieldIds.every((id, i) => fieldMatch.get(id)?.id === newFK.childFieldIds[i]) &&
			oldFK.parentFieldIds.every((id, i) => fieldMatch.get(id)?.id === newFK.parentFieldIds[i])) : -1;
		if (group && inx >= 0) {
			remainingNew.delete(group[inx]);
			group.splice(inx, 1);
		}
		else removedForeignKeys.push(oldFK);
	}

	return {
		tables,
		addedForeignKeys: [...remainingNew],
		removedForeignKeys,
		views: compareObjects(oldData.views, newData.views, (a, b) => a.name === b.name && sameQuery(a.query, b.query) && sameValue(a.comment, b.comment)),
		sequences: compareObjects(oldData.sequences, newData.sequences, (a, b) => JSON.stringify({ ...a, id: "" }) === JSON.stringify({ ...b, id: "" })),
	};
}

export function isEmptyDiff(diff: ERDDiff): boolean {
	const emptyObjects = (d: ObjectDiff<unknown>) => d.added.length + d.removed.length + d.changed.length === 0;
	return diff.tables.length === 0 && diff.addedForeignKeys.length === 0 && diff.removedForeignKeys.length === 0 &&
		   emptyObjects(diff.views) && emptyObjects(diff.sequences);
}

/** 변경 내용 요약 (화면 표시용) */
export function summarizeDiff(diff: ERDDiff): string[] {
	const lines: string[] = [];
	for (const table of diff.tables) {
		if (table.status === "added") { lines.push(`+ Table ${table.newTable!.physicalName}`); continue; }
		if (table.status === "removed") { lines.push(`- Table ${table.oldTable!.physicalName}`); continue; }
		const oldTable = table.oldTable!, newTable = table.newTable!;
		lines.push(table.renamed ? `~ Table ${oldTable.physicalName} → ${newTable.physicalName}` : `~ Table ${newTable.physicalName}`);
		if (table.commentChanged) lines.push(`    ~ comment: ${oldTable.logicalName ?? ""} → ${newTable.logicalName ?? ""}`);
		for (const f of table.addedColumns) lines.push(`    + column ${f.column} ${f.dataType}`);
		for (const f of table.removedColumns) lines.push(`    - column ${f.column}`);
		for (const c of table.changedColumns) {
			const details: string[] = [];
			if (c.renamed) details.push(`name ${c.oldField.column} → ${c.newField.column}`);
			if (!sameDataType(c.oldField.dataType, c.newField.dataType)) details.push(`type ${c.oldField.dataType} → ${c.newField.dataType}`);
			if (!!c.oldField.notNull !== !!c.newField.notNull) details.push(c.newField.notNull ? "NOT NULL" : "NULL");
			if (!sameDefault(c.oldField.defaultValue, c.newField.defaultValue)) details.push(`default ${c.oldField.defaultValue ?? ""} → ${c.newField.defaultValue ?? ""}`);
			if (!!c.oldField.ai !== !!c.newField.ai) details.push(c.newField.ai ? "auto increment" : "no auto increment");
			if (c.commentChanged) details.push("comment");
			if (c.uniqueAdded) details.push("unique");
			if (c.uniqueRemoved) details.push("not unique");
			lines.push(`    ~ column ${c.newField.column}: ${details.join(", ")}`);
		}
		if (table.pkChanged) lines.push(`    ~ primary key (${newTable.keys.map(f => f.column).join(", ")})`);
		for (const i of table.removedIndexes) lines.push(`    - index ${i.name}`);
		for (const i of table.addedIndexes) lines.push(`    + index ${i.name} (${i.fields})${i.unique ? " UNIQUE" : ""}`);
		for (const c of table.removedChecks) lines.push(`    - check ${c.name}`);
		for (const c of table.addedChecks) lines.push(`    + check ${c.name}`);
	}
	for (const fk of diff.removedForeignKeys) lines.push(`- Foreign key ${fk.name} (${fk.info.childTable} → ${fk.info.parentTable})`);
	for (const fk of diff.addedForeignKeys) lines.push(`+ Foreign key ${fk.name} (${fk.info.childTable} → ${fk.info.parentTable})`);
	for (const v of diff.views.removed) lines.push(`- View ${v.name}`);
	for (const v of diff.views.added) lines.push(`+ View ${v.name}`);
	for (const v of diff.views.changed) lines.push(`~ View ${v.newObject.name}`);
	for (const s of diff.sequences.removed) lines.push(`- Sequence ${s.name}`);
	for (const s of diff.sequences.added) lines.push(`+ Sequence ${s.name}`);
	for (const s of diff.sequences.changed) lines.push(`~ Sequence ${s.newObject.name}`);
	return lines;
}

/** 변경 내용을 반영하는 ALTER 스크립트. 의존 관계를 고려해 삭제 -> 이름 변경 -> 생성/수정 -> 제약조건 순서로 만든다 */
export function makeAlterScript(diff: ERDDiff, maker: SQLMaker): string {
	const sections: [string, string[]][] = [];
	const section = (title: string) => {
		const list: string[] = [];
		sections.push([title, list]);
		return list;
	};
	const modified = diff.tables.filter(t => t.status === "modified");
	const removedTables = new Set(diff.tables.filter(t => t.status === "removed").map(t => upper(t.oldTable!.physicalName)));

	const dropViews = section("Drop views");
	for (const v of diff.views.removed) dropViews.push(maker.dropView(v.name));
	const renamedView = (v: { oldObject: ViewObject; newObject: ViewObject }) => upper(v.oldObject.name) !== upper(v.newObject.name);
	for (const v of diff.views.changed) if (renamedView(v)) dropViews.push(maker.dropView(v.oldObject.name));

	const dropFKs = section("Drop foreign keys");
	for (const fk of diff.removedForeignKeys) {
		if (!removedTables.has(upper(fk.info.childTable))) dropFKs.push(maker.dropForeignKey(fk.info.childTable, fk.name));
	}

	const dropConstraints = section("Drop indexes and constraints");
	for (const t of modified) {
		const tableName = t.oldTable!.physicalName;
		for (const i of t.removedIndexes) dropConstraints.push(maker.dropIndex(tableName, i.name));
		for (const c of t.removedChecks) dropConstraints.push(maker.dropConstraint(tableName, c.name));
		if (t.pkChanged && t.oldTable!.keys.length > 0) dropConstraints.push(maker.dropPrimaryKey(tableName, tableName));
	}

	const dropTables = section("Drop tables (WARNING: the data will be lost)");
	for (const t of diff.tables) if (t.status === "removed") dropTables.push(maker.dropTable(t.oldTable!.physicalName));

	const sequences = section("Sequences");
	for (const s of diff.sequences.removed) sequences.push(maker.dropSequence(s.name));
	for (const s of diff.sequences.changed) sequences.push(maker.dropSequence(s.oldObject.name), maker.makeSequence(s.newObject));
	for (const s of diff.sequences.added) sequences.push(maker.makeSequence(s));

	const renames = section("Rename tables");
	for (const t of modified) if (t.renamed) renames.push(maker.renameTable(t.oldTable!.physicalName, t.newTable!.physicalName));

	const creates = section("Create tables");
	for (const t of diff.tables) if (t.status === "added") creates.push(maker.makeTable(t.newTable));

	const columns = section("Alter columns");
	for (const t of modified) {
		const tableName = t.newTable!.physicalName;
		for (const c of t.changedColumns) if (c.renamed) columns.push(maker.renameColumn(tableName, c.oldField.column, c.newField.column));
		if (t.removedColumns.length) columns.push("-- WARNING: the data of the dropped columns will be lost\n");
		for (const f of t.removedColumns) columns.push(maker.dropColumn(tableName, f.column));
		for (const f of t.addedColumns) {
			columns.push(maker.addColumn(tableName, f));
			if (f.comment) columns.push(maker.makeColumnComment(tableName, f));
		}
		for (const c of t.changedColumns) {
			// MariaDB는 컬럼 정의 전체를 다시 지정하므로 주석만 바뀌어도 MODIFY
			const modify = c.definitionChanged || (c.commentChanged && maker.changeColumnComment(tableName, c.oldField, c.newField) === "");
			if (modify) columns.push(maker.modifyColumn(tableName, c.oldField, c.newField));
			if (c.commentChanged) columns.push(maker.changeColumnComment(tableName, c.oldField, c.newField));
			if (c.uniqueAdded) columns.push(maker.addUnique(tableName, c.newField.column));
			if (c.uniqueRemoved) columns.push(`-- ${tableName}.${c.newField.column}: drop the unique constraint manually\n`);
		}
		if (t.commentChanged) columns.push(maker.changeTableComment(t.newTable!, t.oldTable!.logicalName));
	}

	const constraints = section("Add primary keys, check constraints and indexes");
	for (const t of modified) {
		const tableName = t.newTable!.physicalName;
		if (t.pkChanged && t.newTable!.keys.length > 0) constraints.push(maker.addPrimaryKey(tableName, t.newTable!.keys.map(f => f.column)));
		for (const c of t.addedChecks) constraints.push(maker.addCheck(tableName, c));
		for (const i of t.addedIndexes) constraints.push(maker.makeIndexSQL(tableName, i));
	}

	const addFKs = section("Add foreign keys");
	for (const fk of diff.addedForeignKeys) addFKs.push(maker.makeForeignKey(fk.name, fk.info, fk.onDelete, fk.onUpdate));

	const views = section("Views");
	for (const v of diff.views.changed) views.push(maker.makeView(v.newObject, !renamedView(v)));
	for (const v of diff.views.added) views.push(maker.makeView(v));

	return sections
		.map(([title, list]) => [title, list.filter(Boolean)] as const)
		.filter(([, list]) => list.length > 0)
		.map(([title, list]) => `-- ${title}\n${list.join("")}`)
		.join("\n");
}
