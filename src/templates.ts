/**
 * 공통 컬럼 템플릿 (등록일시, 등록자 등 여러 테이블에 반복되는 컬럼 묶음).
 * 문서와 관계없이 재사용하므로 브라우저(localStorage)에 보관한다.
 */
import type { DbmsType } from "./constants";
import type { FieldData } from "./types";
import { dataTypeUtil } from "./util/dataTypeUtil";

export type TemplateColumn = Pick<FieldData, "column" | "comment" | "dataType" | "defaultValue" | "notNull" | "uniqueKey" | "ai">;

export interface ColumnTemplate {
	name: string;
	/** 컬럼 데이터 타입의 기준 DBMS. 다른 DBMS 문서에 넣을 때 타입을 변환 */
	dbms: DbmsType;
	columns: TemplateColumn[];
}

const STORAGE_KEY = "erd9.columnTemplates";

const DEFAULT_TEMPLATES: ColumnTemplate[] = [
	{
		name: "Audit columns",
		dbms: "mariadb",
		columns: [
			{ column: "REG_DT", comment: "Created at", dataType: "DATETIME", defaultValue: "CURRENT_TIMESTAMP", notNull: true },
			{ column: "REG_USER", comment: "Created by", dataType: "VARCHAR(50)" },
			{ column: "UPD_DT", comment: "Updated at", dataType: "DATETIME" },
			{ column: "UPD_USER", comment: "Updated by", dataType: "VARCHAR(50)" },
		],
	},
	{
		name: "Soft delete",
		dbms: "mariadb",
		columns: [
			{ column: "DEL_YN", comment: "Deleted", dataType: "CHAR(1)", defaultValue: "'N'", notNull: true },
			{ column: "DEL_DT", comment: "Deleted at", dataType: "DATETIME" },
		],
	},
];

function isTemplate(value: unknown): value is ColumnTemplate {
	const t = value as ColumnTemplate;
	return !!t && typeof t.name === "string" && typeof t.dbms === "string" && Array.isArray(t.columns) &&
		t.columns.every(c => c && typeof c.column === "string" && typeof c.dataType === "string");
}

export function getTemplates(): ColumnTemplate[] {
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved === null) return structuredClone(DEFAULT_TEMPLATES);
		const list: unknown = JSON.parse(saved);
		return Array.isArray(list) ? list.filter(isTemplate) : [];
	} catch {
		return structuredClone(DEFAULT_TEMPLATES);
	}
}

export function saveTemplates(list: ColumnTemplate[]): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
	} catch (error) {
		alert("Failed to save the templates in this browser. " + error);
	}
}

/** 템플릿 컬럼을 지정한 DBMS의 타입으로 변환 */
export function getTemplateColumns(template: ColumnTemplate, dbms: DbmsType): TemplateColumn[] {
	return template.columns.map(column => ({ ...column, dataType: dataTypeUtil.convertDataType(column.dataType, template.dbms, dbms) }));
}
