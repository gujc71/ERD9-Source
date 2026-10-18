/**
 * AI로 ERD를 만들 때 사용하는 프롬프트, 응답 JSON 스키마, 응답 검증.
 * 응답 형식은 zod 스키마 하나로 정의하고, AI에 전달하는 JSON 스키마도 여기서 만든다.
 */
import { z } from "zod";
import type { AIERDData, AIFieldData, AIRelationData, AITableData } from "../types";

const asString = (value: unknown) => typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
/** 문자열. 다른 형식이면 문자열로 변환 */
const text = () => z.preprocess(asString, z.string());

/* 응답 형식. OpenAI strict 모드 규칙에 맞춰 모든 속성을 required로, 생략 가능한 값은 null 허용.
   .catch(), z.preprocess()는 응답 검증(parseAIERD)에서 형식이 조금 다른 값을 받아주기 위한 것 */
const fieldSchema = z.object({
	column: z.string(),
	comment: text(),
	dataType: z.string().catch(""),
	default: z.preprocess(v => v === undefined || v === null ? null : asString(v), z.string().nullable()),
	isPK: z.boolean().catch(false),
	nullable: z.boolean().catch(true),
});

const tableSchema = z.object({
	id: text().describe("unique id of the table"),
	physicalName: z.string().describe("table name"),
	logicalName: text().describe("table description"),
	fields: z.array(fieldSchema),
});

const relationSchema = z.object({
	parent: text().describe("id of the parent table"),
	parentTable: text(),
	parentColumns: text().describe("comma separated"),
	child: text().describe("id of the child table"),
	childTable: text(),
	childColumns: text().describe("comma separated"),
	relationType: text(),
});

const responseSchema = z.object({
	tables: z.array(tableSchema),
	relationData: z.array(relationSchema.extend({ relationType: z.enum(["pk", "fk"]) })),
});

let jsonSchema: Record<string, unknown> | null = null;

/** AI에 전달하는 응답 JSON 스키마 ($schema와 .catch()로 생기는 default는 제외). 처음 쓸 때 만든다 */
export function getERDJsonSchema(): Record<string, unknown> {
	if (!jsonSchema) {
		const { $schema: _, ...schema } = z.toJSONSchema(responseSchema, {
			override: ctx => { delete ctx.jsonSchema.default; },
		});
		jsonSchema = schema;
	}
	return jsonSchema;
}

/** ERD 생성 요청 문구 */
export function buildERDPrompt(userText: string, dbms: string, language: string): string {
	return `${userText}

Design the database tables for the request above as an ERD. The database is ${dbms}; use its data types.
Return JSON only, with no explanation:
- "tables": each table has "id" (a unique id), "physicalName" (table name), "logicalName" (table description) and "fields".
- Each field has "column", "comment", "dataType", "default" (null if none), "isPK" and "nullable".
- "relationData": each relationship has "parent" and "child" (table ids), "parentTable", "parentColumns", "childTable", "childColumns" (comma separated column names; the child columns must exist in the child table)
  and "relationType": "pk" if the parent key is part of the child's primary key, otherwise "fk".
Write only "logicalName" and "comment" in ${language}.`;
}

/** 코드 블록(```json ... ```)으로 감싼 응답도 처리 */
function extractJSON(text: string): string {
	const trimmed = text.trim();
	const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
	return match ? match[1].trim() : trimmed;
}

/** 배열에서 형식이 맞는 항목만 */
function validItems<T extends z.ZodType>(value: unknown, schema: T): z.output<T>[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap(item => {
		const result = schema.safeParse(item);
		return result.success ? [result.data] : [];
	});
}

/** AI 응답을 ERD 데이터로. 형식이 맞지 않으면 예외 */
export function parseAIERD(text: string): AIERDData {
	const data = JSON.parse(extractJSON(text)) as { tables?: unknown; relationData?: unknown };
	if (!data || !Array.isArray(data.tables)) throw new Error("The response has no tables.");

	// 컬럼은 테이블과 따로 검증해 형식이 맞지 않는 컬럼만 제외
	const tables: AITableData[] = validItems(data.tables, tableSchema.extend({ fields: z.unknown() }))
		.map((t, i) => ({
			id: t.id || `t${i}`,
			physicalName: t.physicalName,
			logicalName: t.logicalName,
			fields: validItems(t.fields, fieldSchema).map((f): AIFieldData => ({ ...f, dataType: f.dataType || "VARCHAR(100)" })),
		}));
	if (tables.length === 0) throw new Error("The response has no tables.");

	const relationData: AIRelationData[] = validItems(data.relationData, relationSchema);
	return { tables, relationData };
}
