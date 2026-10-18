/**
 * 도메인과 표준 사전을 모델(엔터티)에 반영
 */
import type { Entity9 } from "../diagram/Entity9";
import { docObjects, entityMap, state } from "../state";
import type { DomainObject, EntityModel, FieldData } from "../types";
import { diagramUtil } from "../util/diagramUtil";
import { applyDomainValues, checkStandards, ISSUE_KIND, StdConverter } from "./standards";
import type { CheckTable, StdIssue } from "./standards";

export function getConverter(): StdConverter {
	return new StdConverter(docObjects.words, docObjects.terms);
}

export function getDomain(id?: string | null): DomainObject | undefined {
	return id ? docObjects.domains.find(domain => domain.id === id) : undefined;
}

/** 도메인 id -> 사용하는 컬럼 수 */
export function countDomainUsage(): Map<string, number> {
	const counts = new Map<string, number>();
	for (const entity of entityMap.values()) {
		for (const field of entity.data.allFields) {
			if (field.domain) counts.set(field.domain, (counts.get(field.domain) ?? 0) + 1);
		}
	}
	return counts;
}

type ModifyBackup = Parameters<typeof state.diagramStack.saveModifyGroup>[0];

/**
 * 엔터티 데이터를 복사해서 수정하고 반영. 바뀌었으면 true.
 * 실행취소 기록은 backups에 모아서 한 번에 저장한다 (saveModifyGroup)
 */
export function modifyEntity(entity: Entity9, backups: ModifyBackup, modify: (data: EntityModel, fields: FieldData[]) => boolean): boolean {
	const backup = entity.data;
	const data = diagramUtil.deepCopy(backup);
	if (!modify(data, data.keys.concat(data.fields))) return false;
	// setTableData는 entity.data를 새 객체(data)로 바꾸고 이전 객체는 고치지 않으므로 그대로 백업으로 쓴다
	if (entity.setTableData(data) !== "ok") return false;
	backups.push({ diagram: entity, backupData: backup });
	return true;
}

/** 도메인을 적용하면 값이 바뀌는지 (applyDomainValues와 같은 규칙) */
function needsDomainValues(field: FieldData, domain: DomainObject): boolean {
	if (field.domain !== domain.id || field.dataType !== domain.dataType) return true;
	const defaultValue = domain.defaultValue === undefined || domain.defaultValue === "" ? undefined : domain.defaultValue;
	if (field.defaultValue !== defaultValue) return true;
	if (domain.notNull) return field.notNull !== true;
	return !field.isPK && field.notNull !== undefined;
}

/** 도메인 변경을 컬럼에 반영. 삭제된 도메인은 연결만 끊고 값은 그대로 둔다. 바뀐 엔터티 수 반환 */
export function syncDomainFields(): number {
	// 같은 id가 여러 개면 처음 것 (getDomain의 find와 같게)
	const domains = new Map<string, DomainObject>();
	for (const domain of docObjects.domains) if (!domains.has(domain.id)) domains.set(domain.id, domain);
	const needsChange = (field: FieldData) => {
		if (!field.domain) return false;
		const domain = domains.get(field.domain);
		return domain ? needsDomainValues(field, domain) : true;
	};

	const backups: ModifyBackup = [];
	for (const entity of [...entityMap.values()]) {
		// 바뀔 컬럼이 없으면 복사하지 않는다
		if (!entity.data.allFields.some(needsChange)) continue;
		modifyEntity(entity, backups, (_data, fields) => {
			let modified = false;
			for (const field of fields) {
				if (!needsChange(field)) continue;
				const domain = domains.get(field.domain!);
				if (domain) applyDomainValues(field, domain);
				else delete field.domain;
				modified = true;
			}
			return modified;
		});
	}
	state.diagramStack.saveModifyGroup(backups);
	return backups.length;
}

/** 검사, 용어 추출에 쓰는 엔터티 목록 (테이블명 순) */
export function getAllTables(): CheckTable[] {
	return [...entityMap.values()]
		.map(entity => ({ id: entity.id, physicalName: entity.data.physicalName, fields: entity.data.allFields }))
		.sort((a, b) => a.physicalName.localeCompare(b.physicalName));
}

/** 모든 엔터티의 표준 준수 검사 */
export function checkAllEntities(converter = getConverter(), domains = docObjects.domains): StdIssue[] {
	return checkStandards(getAllTables(), converter, domains);
}

/**
 * 검사 결과의 제안(컬럼명, 도메인) 적용. 같은 엔터티에 이미 있는 컬럼명으로는 바꾸지 않는다.
 * 적용한 항목 수와 건너뛴 항목 반환
 */
export function applyIssues(issues: StdIssue[]): { applied: number; skipped: string[] } {
	let applied = 0;
	const skipped: string[] = [];
	const byEntity = new Map<string, StdIssue[]>();
	for (const issue of issues) {
		if (!issue.suggestion || (issue.kind !== ISSUE_KIND.NAME && issue.kind !== ISSUE_KIND.DOMAIN)) continue;
		const list = byEntity.get(issue.entityId);
		if (list) list.push(issue);
		else byEntity.set(issue.entityId, [issue]);
	}

	const backups: ModifyBackup = [];
	for (const [entityId, list] of byEntity) {
		const entity = entityMap.get(entityId);
		if (!entity) continue;
		let count = 0;
		modifyEntity(entity, backups, (data, fields) => {
			const renamed = new Map<string, string>();
			const fieldById = new Map<string, FieldData>();
			for (const field of fields) if (!fieldById.has(field.id)) fieldById.set(field.id, field);
			for (const issue of list) {
				const field = fieldById.get(issue.fieldId);
				if (!field) continue;
				if (issue.kind === ISSUE_KIND.DOMAIN) {
					const domain = getDomain(issue.suggestion);
					if (!domain) continue;
					applyDomainValues(field, domain);
				} else {
					const column = issue.suggestion!;
					if (fields.some(item => item !== field && item.column.toUpperCase() === column.toUpperCase())) {
						skipped.push(`${data.physicalName}.${field.column} → ${column} (already exists)`);
						continue;
					}
					renamed.set(field.column, column);
					field.column = column;
				}
				count++;
			}
			// 인덱스의 컬럼 목록도 변경
			if (renamed.size > 0 && data.indexes) {
				data.indexes = data.indexes.map(index => ({ ...index, fields: index.fields.split(",").map(c => renamed.get(c) ?? c).join(",") }));
			}
			return count > 0;
		});
		applied += count;
	}
	state.diagramStack.saveModifyGroup(backups);
	return { applied, skipped };
}
