/**
 * Compare and Merge: ERD와 DB 스키마를 비교하고, 항목마다 방향(ERD → DB, DB → ERD)을 정해서 반영한다.
 *
 * DB에는 ERD의 id가 없으므로 양쪽 모두 이름으로 만든 id(canonical)로 바꿔서 비교한다.
 *  - 테이블: 대문자 테이블명, 컬럼: 대문자 "테이블.컬럼"
 * 그래서 이름이 바뀐 테이블/컬럼은 삭제 후 추가로 보인다.
 */
import type { DbmsType } from "../constants";
import { diffERD, summarizeDiff } from "../sql/ERDDiff";
import type { ERDDiff } from "../sql/ERDDiff";
import { getAllFields } from "../sql/SQLMaker";
import type { EntityData, ERDFileData, FieldData, RelationFileData } from "../types";
import { diagramUtil } from "../util/diagramUtil";
import type { DbSchema } from "./schemaReader";

const upper = (name: string) => name.trim().toUpperCase();
export const tableKey = upper;
const fieldKey = (table: string, column: string) => `${upper(table)}.${upper(column)}`;
const viewKey = (name: string) => "V:" + upper(name);
const sequenceKey = (name: string) => "S:" + upper(name);

function emptyERD(dbms: DbmsType): ERDFileData {
	return { version: 2, dbms, entityData: {}, relationData: [], textData: [], areaData: [], views: [], sequences: [], pages: [], domains: [], words: [], terms: [] };
}

/**
 * 테이블의 컬럼 찾기 (대소문자 무시). 테이블마다 대문자 컬럼명 -> 컬럼 Map을 한 번만 만든다.
 * 컬럼 목록이 바뀌지 않는 동안(한 함수 안)에서만 쓰도록 함수마다 새로 만든다.
 */
function makeFieldFinder(): (table: EntityData, column: string) => FieldData | undefined {
	const cache = new WeakMap<EntityData, Map<string, FieldData>>();
	return (table, column) => {
		let fields = cache.get(table);
		if (!fields) {
			fields = new Map();
			// find와 같게 같은 이름이 여러 개면 처음 것
			for (const f of getAllFields(table)) {
				const key = upper(f.column);
				if (!fields.has(key)) fields.set(key, f);
			}
			cache.set(table, fields);
		}
		return fields.get(upper(column));
	};
}

/** DB 스키마를 ERD 문서 형식으로 (이름 기반 id) */
export function schemaToERDData(schema: DbSchema): ERDFileData {
	const doc = emptyERD(schema.dbms);
	const findField = makeFieldFinder();
	for (const table of schema.tables) {
		const key = tableKey(table.physicalName);
		if (doc.entityData[key]) continue;
		const columns = table.columns.map(f => ({ ...f, id: fieldKey(table.physicalName, f.column) }));
		const pkOrder = table.primaryKey.map(upper);
		const data: EntityData = {
			physicalName: table.physicalName,
			keys: columns.filter(f => f.isPK).sort((a, b) => pkOrder.indexOf(upper(a.column)) - pkOrder.indexOf(upper(b.column))),
			fields: columns.filter(f => !f.isPK),
		};
		if (table.logicalName) data.logicalName = table.logicalName;
		if (table.indexes?.length) data.indexes = table.indexes;
		if (table.checks?.length) data.checks = table.checks;
		doc.entityData[key] = { x1: 0, y1: 0, x2: 0, y2: 0, data };
	}
	schema.relations.forEach((relation, i) => {
		const child = doc.entityData[tableKey(relation.childTable)], parent = doc.entityData[tableKey(relation.parentTable)];
		if (!child || !parent) return;
		const parentColumns = relation.parentFields.split(",");
		let linked = false, identifying = true;
		relation.childFields.split(",").forEach((column, j) => {
			const field = findField(child.data, column), parentField = findField(parent.data, parentColumns[j] ?? "");
			if (!field || !parentField) return;
			field.parent = parent.data.physicalName;
			field.parentID = parentField.id;
			linked = true;
			if (!field.isPK) identifying = false;
		});
		if (!linked) return;
		doc.relationData.push({
			id: relation.name || `fk${i}`, parent: tableKey(relation.parentTable), child: tableKey(relation.childTable),
			relationType: identifying ? "pk" : "ak", relationCard: "many", relationSelect: "mm",
			name: relation.name, onDelete: relation.onDelete, onUpdate: relation.onUpdate,
		});
	});
	doc.views = schema.views.map(v => ({ ...v, id: viewKey(v.name) }));
	doc.sequences = schema.sequences.map(s => ({ ...s, id: sequenceKey(s.name) }));
	return doc;
}

/** ERD 문서의 id를 이름 기반으로 바꾼다 (같은 이름의 테이블이 여러 개면 처음 것만) */
export function canonicalize(model: ERDFileData): ERDFileData {
	const doc = { ...emptyERD(model.dbms), domains: model.domains };
	const entityIds = new Map<string, string>(), fieldIds = new Map<string, string>();
	const usedKeys = new Set<string>();
	for (const [id, entity] of Object.entries(model.entityData)) {
		const key = tableKey(entity.data.physicalName);
		if (usedKeys.has(key)) continue;
		usedKeys.add(key);
		entityIds.set(id, key);
		for (const f of getAllFields(entity.data)) fieldIds.set(f.id, fieldKey(entity.data.physicalName, f.column));
	}
	for (const [id, key] of entityIds) {
		const entity = model.entityData[id];
		const convert = (f: FieldData): FieldData => ({ ...f, id: fieldIds.get(f.id)!, parentID: f.parentID ? fieldIds.get(f.parentID) ?? null : f.parentID });
		doc.entityData[key] = { ...entity, data: { ...entity.data, keys: entity.data.keys.map(convert), fields: entity.data.fields.map(convert), allFields: undefined } };
	}
	for (const relation of model.relationData) {
		const parent = entityIds.get(relation.parent), child = entityIds.get(relation.child);
		if (parent && child) doc.relationData.push({ ...relation, parent, child });
	}
	doc.views = model.views.map(v => ({ ...v, id: viewKey(v.name) }));
	doc.sequences = model.sequences.map(s => ({ ...s, id: sequenceKey(s.name) }));
	return doc;
}

/**
 * 대소문자만 다른 테이블, 컬럼, 뷰, 시퀀스 이름을 DB의 이름으로 바꾼 ERD 문서 (db, model: canonicalize()한 문서).
 * DB가 이름을 소문자로 돌려주는 경우(Windows의 MariaDB 등) 대소문자 차이를 이름 변경으로 보지 않고,
 * ALTER 스크립트에는 DB의 실제 이름을 쓴다.
 */
export function alignNameCase(model: ERDFileData, db: ERDFileData): ERDFileData {
	const doc = { ...model, entityData: { ...model.entityData } };
	const tableNames = new Map<string, string>();
	for (const [key, entity] of Object.entries(db.entityData)) tableNames.set(key, entity.data.physicalName);
	for (const [key, entity] of Object.entries(model.entityData)) {
		const dbEntity = db.entityData[key];
		const dbColumns = new Map(dbEntity ? getAllFields(dbEntity.data).map(f => [f.id, f.column]) : []);
		const align = (f: FieldData): FieldData => {
			const column = dbColumns.get(f.id), parent = f.parent ? tableNames.get(tableKey(f.parent)) : undefined;
			return (column === undefined || column === f.column) && (parent === undefined || parent === f.parent)
				? f : { ...f, column: column ?? f.column, parent: parent ?? f.parent };
		};
		doc.entityData[key] = {
			...entity,
			data: { ...entity.data, physicalName: dbEntity?.data.physicalName ?? entity.data.physicalName, keys: entity.data.keys.map(align), fields: entity.data.fields.map(align) },
		};
	}
	const alignObjects = <T extends { id: string; name: string }>(list: T[], dbList: T[]): T[] => {
		const dbNames = new Map(dbList.map(o => [o.id, o.name]));
		return list.map(o => { const name = dbNames.get(o.id); return name === undefined || name === o.name ? o : { ...o, name }; });
	};
	doc.views = alignObjects(model.views, db.views);
	doc.sequences = alignObjects(model.sequences, db.sequences);
	return doc;
}

/* -----------------------------------------------------------------------------------
 * 비교
 */
export type SyncDirection = "toDB" | "toERD" | "skip";

export interface SyncItem {
	/** 테이블: 대문자 테이블명, 뷰: V:이름, 시퀀스: S:이름 */
	key: string;
	kind: "table" | "view" | "sequence";
	name: string;
	/** erdOnly: ERD에만 있음, dbOnly: DB에만 있음, different: 양쪽에 있지만 다름 */
	status: "erdOnly" | "dbOnly" | "different";
	/** 차이점 (+ ERD에만 있음, - DB에만 있음, ~ 다름) */
	details: string[];
	direction: SyncDirection;
}

const DEFAULT_DIRECTION: Record<SyncItem["status"], SyncDirection> = { erdOnly: "toDB", dbOnly: "toERD", different: "toDB" };

/** db, model: canonicalize()한 문서 */
export function compareForSync(db: ERDFileData, model: ERDFileData): SyncItem[] {
	const diff = diffERD(db, alignNameCase(model, db));		// old = DB, new = ERD
	const items = new Map<string, SyncItem>();
	const add = (kind: SyncItem["kind"], key: string, name: string, status: SyncItem["status"], details: string[] = []) => {
		const item = items.get(key);
		if (item) item.details.push(...details);
		else items.set(key, { key, kind, name, status, details, direction: DEFAULT_DIRECTION[status] });
	};
	const noObjects = { added: [], removed: [], changed: [] };
	const tableDiff = (partial: Partial<ERDDiff>): ERDDiff => ({ tables: [], addedForeignKeys: [], removedForeignKeys: [], views: noObjects, sequences: noObjects, ...partial });
	// 자식 테이블별 외래키 (원래 순서 유지)
	const groupByChild = (list: ERDDiff["addedForeignKeys"]) => {
		const map = new Map<string, ERDDiff["addedForeignKeys"]>();
		for (const fk of list) {
			const key = tableKey(fk.info.childTable);
			const group = map.get(key);
			if (group) group.push(fk);
			else map.set(key, [fk]);
		}
		return map;
	};
	const addedByChild = groupByChild(diff.addedForeignKeys), removedByChild = groupByChild(diff.removedForeignKeys);
	const fkOf = (key: string) => ({
		addedForeignKeys: addedByChild.get(key) ?? [],
		removedForeignKeys: removedByChild.get(key) ?? [],
	});

	for (const table of diff.tables) {
		const name = (table.newTable ?? table.oldTable)!.physicalName, key = tableKey(name);
		const status = table.status === "added" ? "erdOnly" : table.status === "removed" ? "dbOnly" : "different";
		add("table", key, name, status, summarizeDiff(tableDiff({ tables: [table], ...fkOf(key) })).slice(1));
	}
	// 외래키만 다른 테이블
	for (const fk of [...diff.addedForeignKeys, ...diff.removedForeignKeys]) {
		const key = tableKey(fk.info.childTable);
		if (!items.has(key)) add("table", key, fk.info.childTable, "different", summarizeDiff(tableDiff(fkOf(key))));
	}
	for (const [kind, objects, keyOf] of [["view", diff.views, viewKey], ["sequence", diff.sequences, sequenceKey]] as const) {
		for (const o of objects.added) add(kind, keyOf(o.name), o.name, "erdOnly");
		for (const o of objects.removed) add(kind, keyOf(o.name), o.name, "dbOnly");
		for (const o of objects.changed) add(kind, keyOf(o.newObject.name), o.newObject.name, "different", kind === "view" ? ["~ query"] : ["~ options"]);
	}
	const order = { table: 0, view: 1, sequence: 2 };
	return [...items.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
}

function chosen(items: SyncItem[], direction: SyncDirection, kind: SyncItem["kind"]): Set<string> {
	return new Set(items.filter(i => i.direction === direction && i.kind === kind).map(i => i.key));
}

/** ERD → DB 항목을 반영한 DB의 목표 상태 (db, model: canonicalize()한 문서). diffERD(db, 목표)로 ALTER 스크립트를 만든다 */
export function buildDBTarget(db: ERDFileData, erd: ERDFileData, items: SyncItem[]): ERDFileData {
	const model = alignNameCase(erd, db);
	const target = diagramUtil.deepCopy(db);
	const tables = chosen(items, "toDB", "table");
	for (const key of tables) {
		if (model.entityData[key]) target.entityData[key] = diagramUtil.deepCopy(model.entityData[key]);
		else delete target.entityData[key];
	}
	target.relationData = [
		...db.relationData.filter(r => !tables.has(r.child)),
		...diagramUtil.deepCopy(model.relationData.filter(r => tables.has(r.child))),
	];
	const replaceObjects = <T extends { id: string }>(dbList: T[], modelList: T[], keys: Set<string>): T[] => [
		...dbList.filter(o => !keys.has(o.id)),
		...modelList.filter(o => keys.has(o.id)),
	];
	target.views = replaceObjects(db.views, model.views, chosen(items, "toDB", "view"));
	target.sequences = replaceObjects(db.sequences, model.sequences, chosen(items, "toDB", "sequence"));
	return target;
}

/**
 * DB → ERD 항목을 현재 문서에 반영한 새 문서.
 * model: 현재 문서(원래 id), db: canonicalize()한 DB 문서.
 * 같은 이름의 컬럼은 id를 유지해서 다른 관계와 도메인이 그대로 연결되도록 한다.
 */
export function mergeIntoModel(model: ERDFileData, db: ERDFileData, items: SyncItem[],
							   newId: (prefix: string) => string = prefix => prefix + diagramUtil.getUniqueID()): { data: ERDFileData; warnings: string[] } {
	const doc = diagramUtil.deepCopy(model);
	const warnings: string[] = [];
	const findField = makeFieldFinder();
	const tables = chosen(items, "toERD", "table");

	const idOf = new Map<string, string>();
	for (const [id, entity] of Object.entries(doc.entityData)) {
		const key = tableKey(entity.data.physicalName);
		if (!idOf.has(key)) idOf.set(key, id);
	}

	// 새 테이블은 기존 엔터티 아래에 놓는다
	const bottom = Math.max(0, ...Object.values(doc.entityData).map(e => e.y2));
	let added = 0;
	const removedIds = new Set<string>();

	for (const key of tables) {
		const dbEntity = db.entityData[key], id = idOf.get(key);
		if (!dbEntity) {
			if (id) {
				delete doc.entityData[id];
				removedIds.add(id);
				idOf.delete(key);
			}
			continue;
		}
		const old = id ? doc.entityData[id] : undefined;
		const oldFields = new Map(old ? getAllFields(old.data).map(f => [upper(f.column), f]) : []);
		const convert = (f: FieldData): FieldData => {
			const previous = oldFields.get(upper(f.column));
			const { parent: _parent, parentID: _parentID, ...field } = { ...f, id: previous?.id ?? newId("f"), column: previous?.column ?? f.column };		// 대소문자만 다르면 ERD의 이름 유지		// 관계는 아래에서 다시 연결
			if (previous?.domain && upper(previous.dataType) === upper(f.dataType)) field.domain = previous.domain;
			return field;
		};
		const data: EntityData = { ...diagramUtil.deepCopy(dbEntity.data), keys: dbEntity.data.keys.map(convert), fields: dbEntity.data.fields.map(convert) };
		if (old?.data.color) data.color = old.data.color;
		if (old) data.physicalName = old.data.physicalName;		// 같은 키 = 대소문자만 다른 이름
		if (old) {
			old.data = data;
		} else {
			const x1 = 20 + (added % 5) * 280, y1 = bottom + 60 + Math.floor(added / 5) * 300;
			const entityId = newId("er");
			doc.entityData[entityId] = { x1, y1, x2: x1 + 200, y2: y1 + 100, data };
			idOf.set(key, entityId);
			added++;
		}
	}

	// 관계: 반영한 테이블이 자식인 관계는 DB의 외래키로 다시 만든다 (같은 부모와의 관계는 id와 모양을 유지)
	const childIds = new Set([...tables].map(key => idOf.get(key)).filter((id): id is string => !!id));
	const oldRelations = doc.relationData;
	doc.relationData = oldRelations.filter(r => !removedIds.has(r.parent) && !removedIds.has(r.child) && !childIds.has(r.child));
	// 자식|부모 -> 관계 (some/find 대신). linked: 지금 문서에 있는 쌍, previous: 원래 문서의 처음 관계
	const pairKey = (child: string, parent: string) => child + "\u0000" + parent;
	const linkedPairs = new Set(doc.relationData.map(r => pairKey(r.child, r.parent)));
	const previousByPair = new Map<string, RelationFileData>();
	for (const r of oldRelations) {
		const key = pairKey(r.child, r.parent);
		if (!previousByPair.has(key)) previousByPair.set(key, r);
	}
	for (const relation of db.relationData) {
		if (!tables.has(relation.child)) continue;
		const childId = idOf.get(relation.child), parentId = idOf.get(relation.parent);
		if (!childId || !parentId) {
			warnings.push(`Relationship ${relation.name ?? ""} was skipped: the parent table ${relation.parent} is not in the ERD.`);
			continue;
		}
		if (linkedPairs.has(pairKey(childId, parentId))) continue;		// 한 쌍에 관계는 하나
		const dbParentFields = new Map(getAllFields(db.entityData[relation.parent].data).map(f => [f.id, f]));
		const child = doc.entityData[childId].data, parent = doc.entityData[parentId].data;
		let linked = false, identifying = true;
		for (const f of getAllFields(db.entityData[relation.child].data)) {
			const dbParentField = f.parentID ? dbParentFields.get(f.parentID) : undefined;
			const childField = dbParentField && findField(child, f.column), parentField = dbParentField && findField(parent, dbParentField.column);
			if (!childField || !parentField) continue;
			childField.parent = parent.physicalName;
			childField.parentID = parentField.id;
			linked = true;
			if (!childField.isPK) identifying = false;
		}
		if (!linked) continue;
		const previous = previousByPair.get(pairKey(childId, parentId));
		const next: RelationFileData = {
			relationCard: "many", relationSelect: "mm", ...previous,
			id: previous?.id ?? newId("r"), parent: parentId, child: childId, relationType: identifying ? "pk" : "ak",
			name: relation.name, onDelete: relation.onDelete, onUpdate: relation.onUpdate,
		};
		doc.relationData.push(next);
		linkedPairs.add(pairKey(childId, parentId));
	}

	// 없어진 컬럼을 가리키는 외래키 연결 정리
	const fieldIds = new Set(Object.values(doc.entityData).flatMap(e => getAllFields(e.data).map(f => f.id)));
	for (const entity of Object.values(doc.entityData)) {
		for (const f of getAllFields(entity.data)) {
			if (f.parentID && !fieldIds.has(f.parentID)) { f.parentID = null; f.parent = null; }
		}
	}
	doc.relationData = doc.relationData.filter(r => doc.entityData[r.parent] && doc.entityData[r.child]);
	for (const page of doc.pages) {
		for (const id of removedIds) delete page.entities[id];
	}

	const replaceObjects = <T extends { id: string; name: string }>(modelList: T[], dbList: T[], keys: Set<string>, keyOf: (name: string) => string, prefix: string): T[] => {
		// 대소문자만 다르면 ERD의 이름 유지
		const modelNames = new Map(modelList.map(o => [keyOf(o.name), o.name]));
		return [
			...modelList.filter(o => !keys.has(keyOf(o.name))),
			...dbList.filter(o => keys.has(o.id)).map(o => ({ ...diagramUtil.deepCopy(o), id: newId(prefix), name: modelNames.get(o.id) ?? o.name })),
		];
	};
	doc.views = replaceObjects(doc.views, db.views, chosen(items, "toERD", "view"), viewKey, "v");
	doc.sequences = replaceObjects(doc.sequences, db.sequences, chosen(items, "toERD", "sequence"), sequenceKey, "s");

	return { data: doc, warnings };
}
