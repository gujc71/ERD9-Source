/**
 * 사전으로 물리명(컬럼명, 테이블명)을 논리명으로 변환 (Add-ons > Generate Logical Names)
 */
import type { Entity9 } from "../diagram/Entity9";
import { entityMap, state } from "../state";
import { modifyEntity } from "./applyStandards";

/** 논리명 생성에 쓰는 사전. 사전을 추가하려면 이 목록에 넣는다 */
export interface LogicalDictionary {
	id: string;
	name: string;
	/** 서버 경로 (CSV: 물리 단어,논리 단어) */
	url: string;
}

export const LOGICAL_DICTIONARIES: LogicalDictionary[] = [
	{ id: "en2ko",     name: "English → Korean (영어 사전에서 한국어 조회)",                url: "dictionay/EN_TO_KO.csv" },
	{ id: "enAbbr2ko", name: "English abbreviation → Korean (영어 약어 사전에서 한국어 조회)", url: "dictionay/EN_Abbreviation_TO_KO.csv" },
];

/** 대문자 단어(여러 단어면 공백으로 구분) -> 논리 단어 */
export type WordMap = Map<string, string>;

/** "WORD,논리 단어" 형식의 CSV. 처음 나온 값을 사용한다 */
export function parseDictionaryCSV(text: string): WordMap {
	const map: WordMap = new Map();
	for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
		const inx = line.indexOf(",");
		if (inx < 0) continue;
		const key = normalizeWord(line.substring(0, inx));
		const value = line.substring(inx + 1).trim().replace(/^"(.*)"$/, "$1");
		if (key && value && !map.has(key)) map.set(key, value);
	}
	return map;
}

function normalizeWord(word: string): string {
	return word.trim().replace(/\s+/g, " ").toUpperCase();
}

/** 사전을 서버에서 가져온다. 보관하지 않으므로 쓰는 쪽(다이얼로그)이 들고 있다가 버린다 */
export async function loadDictionary(dictionary: LogicalDictionary): Promise<WordMap> {
	const response = await fetch(dictionary.url);
	if (!response.ok) throw new Error(`Failed to load ${dictionary.url} (${response.status})`);
	return parseDictionaryCSV(await response.text());
}

/** 물리명을 단어로 구분. 주로 _ 로 구분하고, 공백, -, 카멜 표기도 나눈다 */
export function splitPhysicalName(name: string): string[] {
	return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").split(/[_\s\-.]+/).filter(Boolean);
}

/** 여러 단어로 된 사전 항목(ABNORMAL FINDING 등)을 찾을 때 묶어 보는 최대 단어 수 */
const MAX_PHRASE_WORDS = 4;

/**
 * 사전(앞에 있는 것 우선)으로 물리명을 논리명으로 변환. 이어진 단어는 긴 항목부터 찾는다.
 * 찾은 단어가 하나도 없으면 null, 찾지 못한 단어는 원래 단어를 그대로 둔다.
 */
export function toLogicalName(physicalName: string, dictionaries: WordMap[]): string | null {
	const words = splitPhysicalName(physicalName);
	const result: string[] = [];
	let found = false;
	for (let i = 0; i < words.length;) {
		let matched: { value: string; count: number } | null = null;
		for (let count = Math.min(MAX_PHRASE_WORDS, words.length - i); count > 0 && !matched; count--) {
			const key = normalizeWord(words.slice(i, i + count).join(" "));
			for (const dictionary of dictionaries) {
				const value = dictionary.get(key);
				if (value) {
					matched = { value, count };
					break;
				}
			}
		}
		if (matched) {
			result.push(matched.value);
			i += matched.count;
			found = true;
		} else {
			result.push(words[i]);
			i++;
		}
	}
	return found ? result.join(" ") : null;
}

export interface LogicalNameOptions {
	/** 이미 논리명이 있어도 덮어쓴다 */
	overwrite: boolean;
	/** 테이블 논리명도 생성 */
	includeTables: boolean;
}

export interface LogicalNameChange {
	entityId: string;
	/** 테이블 논리명이면 "" */
	fieldId: string;
	table: string;
	/** 테이블 논리명이면 "" */
	column: string;
	before: string;
	after: string;
}

/** 엔터티의 논리명 생성 결과 (미리보기). 엔터티는 바꾸지 않는다 */
export function findLogicalNames(entities: Entity9[], dictionaries: WordMap[], options: LogicalNameOptions): LogicalNameChange[] {
	const changes: LogicalNameChange[] = [];
	for (const entity of entities) {
		const data = entity.data;
		const table = data.physicalName;
		// 엔터티를 만들면 논리명이 물리명과 같으므로 없는 것으로 본다
		const tableLogical = data.logicalName && data.logicalName !== table ? data.logicalName : "";
		if (options.includeTables && (options.overwrite || !tableLogical)) {
			const name = toLogicalName(table, dictionaries);
			if (name && name !== data.logicalName) changes.push({ entityId: entity.id, fieldId: "", table, column: "", before: tableLogical, after: name });
		}
		const seen = new Set<string>();
		for (const field of data.allFields) {
			if (seen.has(field.id)) continue;
			seen.add(field.id);
			if (!field.column || (field.comment && !options.overwrite)) continue;
			const name = toLogicalName(field.column, dictionaries);
			if (name && name !== field.comment) changes.push({ entityId: entity.id, fieldId: field.id, table, column: field.column, before: field.comment ?? "", after: name });
		}
	}
	return changes;
}

/** 논리명 생성 결과를 엔터티에 적용. 적용한 항목 수 반환. 실행취소는 한 번으로 모두 되돌린다 */
export function applyLogicalNames(changes: LogicalNameChange[]): number {
	const byEntity = new Map<string, LogicalNameChange[]>();
	for (const change of changes) {
		const list = byEntity.get(change.entityId);
		if (list) list.push(change);
		else byEntity.set(change.entityId, [change]);
	}

	let applied = 0;
	const backups: Parameters<typeof state.diagramStack.saveModifyGroup>[0] = [];
	for (const [entityId, list] of byEntity) {
		const entity = entityMap.get(entityId);
		if (!entity) continue;
		let count = 0;
		const modified = modifyEntity(entity, backups, (data, fields) => {
			for (const change of list) {
				if (!change.fieldId) {
					data.logicalName = change.after;
					count++;
					continue;
				}
				const targets = fields.filter(field => field.id === change.fieldId);
				targets.forEach(field => field.comment = change.after);
				if (targets.length > 0) count++;
			}
			return count > 0;
		});
		if (modified) applied += count;
	}
	state.diagramStack.saveModifyGroup(backups);
	return applied;
}
