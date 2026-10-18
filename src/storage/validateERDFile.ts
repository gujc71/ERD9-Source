/**
 * 외부에서 들어온 ERD 파일(JSON 가져오기, 샘플, IndexedDB) 검증 (zod 스키마).
 * 알려진 속성만 골라 새 객체로 만들고, 형식이 맞지 않으면 예외를 던진다.
 * 이전 버전에서 저장된 파일과 호환되도록 생략 가능한 값은 기본값으로 채운다.
 *
 * 파일 형식 버전
 *  1: version 속성 없음
 *  2: version, areaData, views, sequences, 엔터티 색상, CHECK 제약, UNIQUE 인덱스, 관계 이름과 ON DELETE/UPDATE 추가
 *     (추가된 값은 모두 생략 가능하므로 버전 1 파일은 변환 없이 읽힌다)
 *  3: 다이어그램 페이지(pages), 글상자/영역의 page, 도메인(domains), 표준 단어/용어 사전(words, terms), 컬럼의 domain 추가 (생략 가능)
 */
import { z } from "zod";
import { DBMS_TYPE, DIAGRAM_TYPE, ERD_FILE_VERSION, REFERENTIAL_ACTIONS, RELATION_CARDINALITY, RELATION_SELECTION } from "../constants";
import type { AreaFileData, EntityData, EntityFileData, ERDFileData, FieldData, IndexData, PageData, RelationFileData, StdTerm, TextFileData } from "../types";

import { toColor } from "../util/color";

// 이 모듈은 zod를 쓰므로 필요할 때만 불러온다(동적 import). 화면 코드는 util/color, storage/fileLimits를 직접 쓴다
export { toColor } from "../util/color";
export { MAX_FILE_SIZE } from "./fileLimits";

class ERDFileError extends Error {}

/* -----------------------------------------------------------------------------------
 * 공통 스키마
 */
/** 생략 가능(null 포함) */
const optStr = z.string().nullish().transform(v => v ?? undefined);
const optNum = z.number().nullish().transform(v => v ?? undefined);
/** 생략 가능. 값이 있으면 boolean으로 변환 */
const optBool = z.unknown().optional().transform(v => v === undefined || v === null ? undefined : Boolean(v));
/** 생략(null)하면 빈 배열 */
const list = <T extends z.ZodType>(item: T) => z.array(item).nullish().transform(v => v ?? []);
/** 목록에 없는 값이면 기본값 */
const oneOf = <const T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) => z.enum(values).catch(fallback);
/** 목록에 없는 값이면 생략 */
const optOneOf = <const T extends readonly [string, ...string[]]>(values: T) => z.enum(values).optional().catch(undefined);
const color = z.unknown().optional().transform(toColor);

/* -----------------------------------------------------------------------------------
 * 파일 스키마
 */
const fieldSchema = z.object({
	id: z.string(),
	column: z.string(),
	comment: optStr,
	dataType: z.string(),
	defaultValue: z.union([z.number(), z.string()]).nullish().transform(v => v ?? undefined),
	notNull: optBool,
	isPK: optBool,
	uniqueKey: optBool,
	ai: optBool,
	parent: z.string().nullish().transform(v => v ?? null),
	parentID: z.string().nullish().transform(v => v ?? null),
	domain: optStr,
}).transform(({ domain, ...rest }): FieldData => domain ? { ...rest, domain } : rest);

const indexSchema = z.object({ name: z.string(), fields: z.string(), unique: z.unknown().optional() })
	.transform(({ name, fields, unique }): IndexData => unique ? { name, fields, unique: true } : { name, fields });

const checkSchema = z.object({ name: z.string(), expression: z.string() });

const entityDataSchema = z.object({
	physicalName: z.string(),
	logicalName: optStr,
	keys: list(fieldSchema),
	fields: list(fieldSchema),
	indexes: z.array(indexSchema).nullish(),
	checks: z.array(checkSchema).nullish(),
	color,
}).transform(({ indexes, checks, color, ...rest }): EntityData => ({
	...rest,
	...(indexes ? { indexes } : {}),
	...(checks ? { checks } : {}),
	...(color ? { color } : {}),
}));

const entitySchema = z.object({
	x1: z.number(),
	y1: z.number(),
	x2: z.unknown().optional(),
	y2: z.unknown().optional(),
	data: entityDataSchema,
}).transform(({ x1, y1, x2, y2, data }): EntityFileData => ({
	x1, y1,
	x2: typeof x2 === "number" ? x2 : x1,
	y2: typeof y2 === "number" ? y2 : y1,
	data,
}));

/** 관계선 끝 위치 (0 ~ 1). 잘못된 값이면 자동 */
const endRatio = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined;

const relationSchema = z.object({
	id: z.string(),
	parent: z.string(),
	child: z.string(),
	relationType: oneOf([DIAGRAM_TYPE.RELATION_PK, DIAGRAM_TYPE.RELATION_AK], DIAGRAM_TYPE.RELATION_AK),
	relationCard: oneOf([RELATION_CARDINALITY.O2O, RELATION_CARDINALITY.O2M], RELATION_CARDINALITY.O2M),
	relationSelect: oneOf([RELATION_SELECTION.MM, RELATION_SELECTION.MO, RELATION_SELECTION.OO, RELATION_SELECTION.OM], RELATION_SELECTION.MM),
	name: optStr,
	onDelete: optOneOf(REFERENTIAL_ACTIONS),
	onUpdate: optOneOf(REFERENTIAL_ACTIONS),
	label: optStr,
	// 화면 표시용 값이므로 잘못된 값이면 파일을 거부하지 않고 자동 경로로
	bend: z.unknown().optional().transform(v => typeof v === "number" && Number.isFinite(v) ? Math.min(0.95, Math.max(0.05, v)) : undefined),
	parentAt: z.unknown().optional().transform(endRatio),
	childAt: z.unknown().optional().transform(endRatio),
}) satisfies z.ZodType<RelationFileData, unknown>;

const textSchema = z.object({ x1: z.number(), y1: z.number(), data: z.string(), page: optStr })
	.transform(({ page, ...rest }): TextFileData => page ? { ...rest, page } : rest);

const areaSchema = z.object({
	id: z.string(),
	x1: z.number(),
	y1: z.number(),
	width: z.number().transform(v => Math.max(50, v)),
	height: z.number().transform(v => Math.max(50, v)),
	name: z.string().nullish().transform(v => v ?? ""),
	color: z.unknown().optional().transform(v => toColor(v) ?? "#e8f0fe"),
	page: optStr,
}).transform(({ page, ...rest }): AreaFileData => page ? { ...rest, page } : rest);

const pageSchema = z.object({
	id: z.string(),
	name: z.string(),
	entities: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).nullish().transform(v => v ?? {}),
}) satisfies z.ZodType<PageData, unknown>;

const viewSchema = z.object({ id: z.string(), name: z.string(), comment: optStr, query: z.string() });

const sequenceSchema = z.object({
	id: z.string(),
	name: z.string(),
	start: optNum,
	increment: optNum,
	minValue: optNum,
	maxValue: optNum,
	cycle: optBool,
});

const domainSchema = z.object({
	id: z.string(),
	name: z.string(),
	dataType: z.string(),
	defaultValue: z.union([z.number(), z.string()]).nullish().transform(v => v ?? undefined),
	notNull: optBool,
	comment: optStr,
});

const wordSchema = z.object({ logical: z.string(), physical: z.string() });
const termSchema = z.object({ logical: z.string(), physical: z.string(), domain: optStr })
	.transform(({ domain, ...rest }): StdTerm => domain ? { ...rest, domain } : rest);

const fileSchema = z.object({
	dbms: z.enum([DBMS_TYPE.MARIADB, DBMS_TYPE.ORACLE, DBMS_TYPE.MSSQL, DBMS_TYPE.POSTGRESQL]),
	entityData: z.record(z.string(), entitySchema),
	relationData: list(relationSchema),
	textData: list(textSchema),
	areaData: list(areaSchema),
	views: list(viewSchema),
	sequences: list(sequenceSchema),
	pages: list(pageSchema),
	domains: list(domainSchema),
	words: list(wordSchema),
	terms: list(termSchema),
});

/** 첫 번째 오류를 "entityData.er1.data.keys[0].id" 형식의 위치와 함께 */
function toError(error: z.ZodError): ERDFileError {
	const issue = error.issues[0];
	const path = issue.path.reduce<string>((acc, key) => typeof key === "number" ? `${acc}[${key}]` : acc ? `${acc}.${String(key)}` : String(key), "");
	return new ERDFileError(`Invalid ERD file: ${path || "file"} - ${issue.message}`);
}

export function validateERDFile(value: unknown): ERDFileData {
	const version = z.object({ version: z.number().optional() }).safeParse(value);
	if (!version.success) throw toError(version.error);
	if ((version.data.version ?? 1) > ERD_FILE_VERSION) {
		throw new ERDFileError(`This file was saved by a newer version of ERD9 (file format ${version.data.version}). Please use the latest version.`);
	}

	const file = fileSchema.safeParse(value);
	if (!file.success) throw toError(file.error);
	return { version: ERD_FILE_VERSION, ...file.data };
}
