import { DIAGRAM_TYPE, STATE_TYPE } from "../constants";
import { Entity9 } from "../diagram/Entity9";
import { Relation9 } from "../diagram/Relation9";
import { entityMap, state } from "../state";
import type { AnyDiagram } from "../state";
import type { FieldData } from "../types";
import { diagramUtil } from "../util/diagramUtil";

/** 기존 테이블명과 겹치지 않는 이름 */
function uniqueTableName(name: string): string {
	const names = new Set([...entityMap.values()].map(entity => entity.data.physicalName.toUpperCase()));
	let result = name;
	while (names.has(result.toUpperCase())) result = diagramUtil.getUniqueValue(result);
	return result;
}

/**
 * 다대다 관계: 두 엔터티의 기본키를 합친 교차 테이블을 만들고, 각 엔터티와 식별 관계로 연결한다.
 * 컬럼명이 겹치면 두 번째 엔터티의 컬럼에 테이블명을 붙인다.
 */
export function createManyToMany(entity1: Entity9, entity2: Entity9): Entity9 | null {
	if (entity1 === entity2) return null;
	if (entity1.data.keys.length === 0 || entity2.data.keys.length === 0) {
		alert("Both entities need a primary key to make a many-to-many relationship.");
		return null;
	}

	const used = new Set<string>();
	const keys: FieldData[] = [];
	for (const parent of [entity1, entity2]) {
		for (const key of parent.data.keys) {
			const fk: FieldData = { ...diagramUtil.copyNewFK(key, parent.data.physicalName), isPK: true, notNull: true, ai: false, uniqueKey: false };
			if (used.has(fk.column.toUpperCase())) fk.column = `${parent.data.physicalName}_${key.column}`;
			used.add(fk.column.toUpperCase());
			keys.push(fk);
		}
	}

	const name1 = entity1.data.physicalName, name2 = entity2.data.physicalName;
	const canvas = state.canvas;
	const mapping = new Entity9(canvas, 0, 0, null, {
		physicalName: uniqueTableName(`${name1}_${name2}`),
		logicalName: `${entity1.data.logicalName || name1} - ${entity2.data.logicalName || name2}`,
		keys,
		fields: [],
	});
	// 두 엔터티의 가운데
	const centerX = (entity1.x1 + entity1.x2 + entity2.x1 + entity2.x2) / 4;
	const centerY = (entity1.y1 + entity1.y2 + entity2.y1 + entity2.y2) / 4;
	mapping.rePosition(Math.round(centerX - (mapping.x2 - mapping.x1) / 2), Math.round(centerY - (mapping.y2 - mapping.y1) / 2));

	const created: AnyDiagram[] = [mapping];
	for (const parent of [entity1, entity2]) {
		const relation = Relation9.create(canvas, parent, mapping, false, DIAGRAM_TYPE.RELATION_PK);
		if (relation) created.push(relation);
	}
	state.diagramStack.saveState(STATE_TYPE.MULTY_CREATE, created);
	return mapping;
}
