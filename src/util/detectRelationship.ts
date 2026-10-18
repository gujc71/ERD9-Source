/**
 * 누락된 관계 찾기 (Evaluate relationships - Missing).
 * 부모 엔터티의 키 컬럼이 모두 같은 이름으로 존재하는 다른 엔터티를 자식 후보로 찾는다.
 */
import type { FieldData } from "../types";

/** 검사에 필요한 엔터티 정보 (Entity9) */
export interface DetectEntity {
	id: string;
	data: { physicalName: string; keys: FieldData[]; allFields?: FieldData[] };
	myChildList: Iterable<{ childEntity: { id: string } }>;
	myParentList: Iterable<{ parentEntity: { id: string } }>;
}

export interface MissingRelation<E extends DetectEntity> {
	parent: E;
	child: E;
	/** 부모 키 순서대로 대응하는 자식 컬럼 */
	childFields: FieldData[];
	/** 부모 키와 자식 컬럼의 데이터 타입이 모두 같은지 */
	sameType: boolean;
	/** 자식 컬럼이 모두 자식의 키 (식별 관계) */
	isPK: boolean;
	/** 자식의 키 전체가 부모 키와 대응 (서로 PK라 부모/자식을 바꿀 수 있음) */
	reversible: boolean;
}

/** Entity9.getMyField와 같은 규칙: 이름이 정확히 같은 컬럼, 없으면 대소문자 무시 */
export function findField(fields: FieldData[], columnName: string): FieldData | null {
	const upper = columnName.toUpperCase();
	return fields.find(field => field.column === columnName) ??
		   fields.find(field => field.column.toUpperCase() === upper) ?? null;
}

export function detectMissingRelations<E extends DetectEntity>(entityList: Iterable<E>): MissingRelation<E>[] {
	const entities = [...entityList];

	// 컬럼명(대문자) → 그 컬럼을 가진 엔터티들 (엔터티 순서 유지). 부모의 첫 키 컬럼을 가진 엔터티만 후보로 검사
	const byColumn = new Map<string, E[]>();
	for (const entity of entities) {
		if (!entity.data.allFields) continue;
		for (const name of new Set(entity.data.allFields.map(field => field.column.toUpperCase()))) {
			let list = byColumn.get(name);
			if (!list) byColumn.set(name, list = []);
			list.push(entity);
		}
	}

	const result: MissingRelation<E>[] = [];
	const reverseSet = new Set<string>();		// 서로가 PK라 반대로도 관계 설정 가능한 관계들. 중복 점검 방지용
	const pairKey = (parentId: string, childId: string) => parentId + "\u0000" + childId;

	for (const parent of entities) {
		if (!parent.data.allFields || parent.data.keys.length === 0) continue;
		// 이미 관계가 있는 엔터티
		const related = new Set<string>();
		for (const relation of parent.myChildList) related.add(relation.childEntity.id);
		for (const relation of parent.myParentList) related.add(relation.parentEntity.id);

		const parentKeys = parent.data.keys;
		for (const child of byColumn.get(parentKeys[0].column.toUpperCase()) ?? []) {
			if (!child.data.allFields || parent.id === child.id || related.has(child.id)) continue;
			if (reverseSet.has(pairKey(child.id, parent.id))) continue;  // 반대 방향으로 이미 찾은 관계

			const childFields: FieldData[] = [];
			const childKeys: FieldData[] = [];
			let sameType = true;
			for (const keyFld of parentKeys) {
				const field = findField(child.data.allFields, keyFld.column);
				if (!field) break;   // 부모키들 중에 하나라도 해당하는 자식 컬럼이 없으면 연관이 없는 것으로
				childFields.push(field);
				if (field.isPK) childKeys.push(field);
				if (sameType && keyFld.dataType !== field.dataType) sameType = false;
			}
			if (childFields.length !== parentKeys.length) continue;

			const reversible = child.data.keys.length > 0 && childKeys.length === child.data.keys.length;
			if (reversible) reverseSet.add(pairKey(parent.id, child.id));
			result.push({
				parent, child, childFields, sameType, reversible,
				isPK: childKeys.length > 0 && childKeys.length === childFields.length,
			});
		}
	}
	return result;
}
