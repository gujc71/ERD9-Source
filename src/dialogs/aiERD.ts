import { DIAGRAM_TYPE } from "../constants";
import { Entity9 } from "../diagram/Entity9";
import { Relation9 } from "../diagram/Relation9";
import { CalcPosition } from "../sql/CalcPosition";
import { state } from "../state";
import type { AnyDiagram } from "../state";
import type { AIERDData, EntityData, FieldData } from "../types";
import { diagramUtil } from "../util/diagramUtil";

/** AI가 생성한 ERD 데이터로 엔터티와 관계 생성. 생성된 엔터티와 관계 반환 (실행취소용) */
export function makeERDFromAI(erdData: AIERDData): AnyDiagram[] {
	const canvas = state.canvas;
	const created: AnyDiagram[] = [];
	const calcPosition = new CalcPosition();
	// 관계는 테이블 id로 연결하되, id가 맞지 않으면 테이블명으로 찾는다
	const byId = new Map<string, Entity9>(), byName = new Map<string, Entity9>();

	for (const tableData of erdData.tables) {
		const fields: FieldData[] = tableData.fields.map(field => ({
			id: "f" + diagramUtil.getUniqueID(),
			column: field.column,
			comment: field.comment ?? undefined,
			dataType: field.dataType,
			defaultValue: field.default ?? undefined,
			notNull: field.isPK || field.nullable === false,
			isPK: field.isPK,
		}));
		const entity: EntityData = {
			keys: fields.filter(item => item.isPK),
			fields: fields.filter(item => !item.isPK),
			physicalName: tableData.physicalName,
			logicalName: tableData.logicalName ?? undefined,
		};

		const e1 = new Entity9(canvas, 10, 10, null, entity, true);	// 크기는 아래에서 한 번에 계산
		created.push(e1);
		byId.set(tableData.id, e1);
		byName.set(tableData.physicalName.toUpperCase(), e1);
	}
	// 모두 그린 다음 크기를 한 번에 계산하고, 크기에 맞춰 배치
	const entities = created as Entity9[];
	Entity9.layoutAll(entities);
	for (const e1 of entities) {
		const ret = calcPosition.getPosition(e1.x2-e1.x1, e1.y2-e1.y1);
		e1.rePosition(ret.x, ret.y);
	}

	const find = (id: string, name: string) => byId.get(id) ?? byName.get(name.toUpperCase());
	const split = (columns: string) => columns.split(",").map(column => column.trim()).filter(Boolean);
	for (const item of erdData.relationData ?? []) {
		const parent = find(item.parent, item.parentTable), child = find(item.child, item.childTable);
		if (!parent || !child) continue;
		const kind = item.relationType === "pk" ? DIAGRAM_TYPE.RELATION_PK : DIAGRAM_TYPE.RELATION_AK;
		const childColumns = split(item.childColumns), parentColumns = split(item.parentColumns);
		// 자식에 연결할 컬럼이 모두 있으면 그 컬럼으로 연결, 없으면 부모의 키를 자식에 추가
		const linkable = childColumns.length > 0 && childColumns.length === parentColumns.length &&
						 childColumns.every(column => child.getMyField(column)) && parentColumns.every(column => parent.getMyField(column));
		const relation = Relation9.create(canvas, parent, child, !linkable, kind);
		if (!relation) continue;
		if (linkable) relation.setRelationFields(childColumns, parentColumns);
		created.push(relation);
	}
	return created;
}

/** AI가 생성한 ERD 데이터를 표로 출력 */
export function showERDFromAI(editor: HTMLElement, erdData: AIERDData): void {
	editor.replaceChildren();
	for (const tableData of erdData.tables) {
		diagramUtil.makeTableDesc(editor, {
			physicalName: tableData.physicalName,
			logicalName: tableData.logicalName ?? undefined,
			fields: tableData.fields.map(field => ({
				id: "", column: field.column, comment: field.comment ?? "", dataType: field.dataType,
				defaultValue: field.default ?? "", isPK: field.isPK, notNull: field.nullable === false,
			})),
		});
	}

	if (!erdData.relationData || erdData.relationData.length === 0) return;

	diagramUtil.createHTMLElement(editor, "h4", "tableName-span", "Relationships" );

	const table = diagramUtil.createHTMLElement(editor, "table");

	diagramUtil.addTableRow(table, "th", ["Parent Table", "Parent Columns", "Child Table", "Child Columns"], ["150px", "150px", "150px", "150px"]);

	for (const relationData of erdData.relationData) {
		diagramUtil.addTableRow(table, "td", [relationData.parentTable, relationData.parentColumns, relationData.childTable, relationData.childColumns]);
	}
}
