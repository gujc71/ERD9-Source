/**
 * 테이블 정의서 데이터 모델. 화면 출력(diagramUtil.renderTableDoc)과 파일 내보내기(tableDocs)가 함께 사용한다.
 * 의존성 없는 순수 모듈 (화면 코드에서 불러도 내보내기 라이브러리가 따라오지 않도록)
 */
import type { CheckData, FieldData, IndexData } from "../types";

export interface TableDocColumn {
	column: string;
	comment: string;
	dataType: string;
	defaultValue: string;
	pk: boolean;
	unique: boolean;
	notNull: boolean;
	ai: boolean;
	/** 외래키: 부모테이블.컬럼 */
	fk: string;
}

export interface TableDoc {
	physicalName: string;
	logicalName: string;
	columns: TableDocColumn[];
	indexes: IndexData[];
	checks: CheckData[];
}

export interface RelationDoc {
	name: string;
	childTable: string;
	childFields: string;
	parentTable: string;
	parentFields: string;
	onDelete: string;
	onUpdate: string;
}

export interface TableDocument {
	title: string;
	dbms: string;
	tables: TableDoc[];
	relations: RelationDoc[];
}

/** FieldData → 정의서 컬럼. 기본값 0도 표시 (undefined, null만 빈 값) */
export function toDocColumn(field: Pick<FieldData, "column" | "dataType"> & Partial<Pick<FieldData, "comment" | "defaultValue" | "isPK" | "uniqueKey" | "notNull" | "ai">>,
							options: { pk?: boolean; fk?: string } = {}): TableDocColumn {
	const defaultValue = field.defaultValue as string | number | null | undefined;
	return {
		column: field.column,
		comment: field.comment ?? "",
		dataType: field.dataType,
		defaultValue: defaultValue === undefined || defaultValue === null ? "" : String(defaultValue),
		pk: options.pk ?? !!field.isPK,
		unique: !!field.uniqueKey,
		notNull: !!field.notNull,
		ai: !!field.ai,
		fk: options.fk ?? "",
	};
}

/** 테이블 정보(DDL 가져오기, AI 응답 등) → 정의서 테이블 */
export function toTableDoc(table: { physicalName: string; logicalName?: string | null; columns: FieldData[]; indexes?: IndexData[]; checks?: CheckData[] }): TableDoc {
	return {
		physicalName: table.physicalName,
		logicalName: table.logicalName ?? "",
		columns: table.columns.map(field => toDocColumn(field)),
		indexes: table.indexes ?? [],
		checks: table.checks ?? [],
	};
}

/** 제목: 물리명 - 논리명 (같으면 물리명만) */
export const tableTitle = (table: TableDoc): string =>
	table.logicalName && table.logicalName !== table.physicalName ? `${table.physicalName} - ${table.logicalName}` : table.physicalName;
