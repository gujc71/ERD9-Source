/**
 * 데이터 표준화: 표준 단어/용어 사전으로 논리명 <-> 물리명 변환, 표준 준수 검사, CSV 변환.
 * 화면(DOM)이나 엔터티(Entity9)에 의존하지 않는다.
 *
 * - 단어: 고객 -> CUST, 번호 -> NO
 * - 용어: 고객번호 -> CUST_NO (+ 도메인). 용어가 있으면 단어 조합보다 먼저 사용
 * - 논리명은 공백, '_'로 나누고, 붙어 있으면(고객주문번호) 사전에 있는 가장 긴 단어부터 찾아 나눈다
 */
import type { DomainObject, FieldData, StdTerm, StdWord } from "../types";

/** 논리명 비교용: 공백 제거, 소문자 */
export function logicalKey(value: string): string {
	return value.replace(/\s+/g, "").toLowerCase();
}

const isAscii = (value: string) => /^[\x20-\x7e]*$/.test(value);

export interface PhysicalResult {
	physical: string;
	/** 사전에 없는 부분 */
	unknown: string[];
	/** 용어 사전에서 찾은 경우 */
	term?: StdTerm;
}

export interface LogicalResult {
	logical: string;
	unknown: string[];
	term?: StdTerm;
}

export class StdConverter {
	private words = new Map<string, StdWord>();
	private wordsByPhysical = new Map<string, StdWord>();
	private terms = new Map<string, StdTerm>();
	private termsByPhysical = new Map<string, StdTerm>();
	private maxWordLength = 0;

	constructor(words: StdWord[], terms: StdTerm[]) {
		for (const word of words) {
			const key = logicalKey(word.logical);
			if (!key || !word.physical.trim()) continue;
			this.words.set(key, word);
			this.wordsByPhysical.set(word.physical.trim().toUpperCase(), word);
			this.maxWordLength = Math.max(this.maxWordLength, key.length);
		}
		for (const term of terms) {
			const key = logicalKey(term.logical);
			if (!key || !term.physical.trim()) continue;
			this.terms.set(key, term);
			this.termsByPhysical.set(term.physical.trim().toUpperCase(), term);
		}
	}

	get isEmpty(): boolean {
		return this.words.size === 0 && this.terms.size === 0;
	}

	findTerm(logical: string): StdTerm | undefined {
		return this.terms.get(logicalKey(logical));
	}

	hasWordPhysical(physical: string): boolean {
		return this.wordsByPhysical.has(physical.toUpperCase());
	}

	/** 논리명 -> 물리명 */
	toPhysical(logical: string): PhysicalResult {
		const text = logical.trim();
		if (!text) return { physical: "", unknown: [] };

		const term = this.findTerm(text);
		if (term) return { physical: term.physical.trim(), unknown: [], term };

		const parts: string[] = [];
		const unknown: string[] = [];
		for (const token of text.split(/[\s_]+/).filter(Boolean)) {
			// 토큰 전체가 용어인 경우
			const tokenTerm = this.findTerm(token);
			if (tokenTerm) {
				parts.push(tokenTerm.physical.trim());
				continue;
			}
			this._segment(token, parts, unknown);
		}
		return { physical: parts.join("_"), unknown };
	}

	/** 사전에 있는 가장 긴 단어부터 찾아 나눈다. 찾지 못한 부분은 그대로 */
	private _segment(token: string, parts: string[], unknown: string[]): void {
		let rest = "";
		const flush = () => {
			if (!rest) return;
			parts.push(rest);
			unknown.push(rest);
			rest = "";
		};
		let i = 0;
		while (i < token.length) {
			let found: StdWord | undefined;
			let end = i;
			for (let j = Math.min(token.length, i + this.maxWordLength); j > i; j--) {
				found = this.words.get(token.slice(i, j).toLowerCase());
				if (found) {
					end = j;
					break;
				}
			}
			if (found) {
				flush();
				parts.push(found.physical.trim());
				i = end;
			} else {
				rest += token[i++];
			}
		}
		flush();
	}

	/** 물리명 -> 논리명 */
	toLogical(physical: string): LogicalResult {
		const text = physical.trim();
		if (!text) return { logical: "", unknown: [] };

		const term = this.termsByPhysical.get(text.toUpperCase());
		if (term) return { logical: term.logical.trim(), unknown: [], term };

		const parts: string[] = [];
		const unknown: string[] = [];
		for (const part of text.split("_").filter(Boolean)) {
			const word = this.wordsByPhysical.get(part.toUpperCase());
			if (word) parts.push(word.logical.trim());
			else {
				parts.push(part);
				unknown.push(part);
			}
		}
		// 영문 단어는 띄어 쓰고, 한글 등은 붙여 쓴다
		return { logical: parts.join(parts.every(isAscii) ? " " : ""), unknown };
	}
}

/* -----------------------------------------------------------------------------------
 * 표준 준수 검사
 */
export const ISSUE_KIND = {
	/** 컬럼명이 표준과 다름 (제안 있음) */
	NAME: "name",
	/** 용어의 도메인과 다름 (제안 있음) */
	DOMAIN: "domain",
	/** 사전에 없는 단어 */
	WORD: "word",
	/** 논리명(코멘트) 없음 */
	NO_LOGICAL: "nological",
} as const;
export type IssueKind = typeof ISSUE_KIND[keyof typeof ISSUE_KIND];

export interface StdIssue {
	entityId: string;
	fieldId: string;
	table: string;
	column: string;
	comment: string;
	kind: IssueKind;
	message: string;
	/** NAME: 바꿀 컬럼명, DOMAIN: 도메인 id */
	suggestion?: string;
}

export interface CheckTable {
	id: string;
	physicalName: string;
	fields: FieldData[];
}

/** FK 컬럼은 부모를 따르므로 검사하지 않는다 */
export function checkStandards(tables: CheckTable[], converter: StdConverter, domains: DomainObject[]): StdIssue[] {
	const issues: StdIssue[] = [];
	const domainName = (id?: string) => domains.find(domain => domain.id === id)?.name ?? "(none)";

	for (const table of tables) {
		for (const field of table.fields) {
			if (field.parentID) continue;
			const base = { entityId: table.id, fieldId: field.id, table: table.physicalName, column: field.column, comment: field.comment ?? "" };
			const comment = field.comment?.trim();
			if (!comment) {
				issues.push({ ...base, kind: ISSUE_KIND.NO_LOGICAL, message: "No logical name" });
				continue;
			}
			const result = converter.toPhysical(comment);
			if (result.unknown.length > 0) {
				issues.push({ ...base, kind: ISSUE_KIND.WORD, message: "Not standard words: " + result.unknown.join(", ") });
			} else
			if (result.physical.toUpperCase() !== field.column.toUpperCase()) {
				issues.push({ ...base, kind: ISSUE_KIND.NAME, message: (result.term ? "Term" : "Words") + " → " + result.physical, suggestion: result.physical });
			}
			const termDomain = result.term?.domain;
			if (termDomain && domains.some(domain => domain.id === termDomain) && field.domain !== termDomain) {
				issues.push({ ...base, kind: ISSUE_KIND.DOMAIN, message: `Domain ${domainName(field.domain)} → ${domainName(termDomain)}`, suggestion: termDomain });
			}
		}
	}
	return issues;
}

/**
 * ERD에 쓰인 컬럼(주석 -> 컬럼명)으로 용어 만들기. 이미 있는 용어는 건너뛴다.
 * 같은 논리명에 컬럼명이 여러 개면 가장 많이 쓴 것을 고르고 conflicts에 알린다.
 * 그 컬럼들이 모두 같은 도메인을 쓰면 도메인도 연결한다.
 */
export function extractTerms(tables: CheckTable[], existing: StdTerm[]): { terms: StdTerm[]; conflicts: string[] } {
	const known = new Set(existing.map(term => logicalKey(term.logical)));
	const groups = new Map<string, { logical: string; fields: FieldData[] }>();
	for (const table of tables) {
		for (const field of table.fields) {
			const comment = field.comment?.trim();
			if (field.parentID || !comment || !field.column.trim()) continue;
			const key = logicalKey(comment);
			if (known.has(key)) continue;
			const group = groups.get(key) ?? { logical: comment, fields: [] };
			group.fields.push(field);
			groups.set(key, group);
		}
	}

	const terms: StdTerm[] = [];
	const conflicts: string[] = [];
	for (const { logical, fields } of groups.values()) {
		const counts = new Map<string, FieldData[]>();
		for (const field of fields) {
			const physical = field.column.trim().toUpperCase();
			const list = counts.get(physical);
			if (list) list.push(field);
			else counts.set(physical, [field]);
		}
		const ranked = [...counts.entries()].sort((a, b) => b[1].length - a[1].length);
		const [, chosen] = ranked[0];
		if (ranked.length > 1) conflicts.push(`${logical}: ` + ranked.map(([name, list]) => `${name}(${list.length})`).join(", "));
		const domains = new Set(chosen.map(field => field.domain));
		const domain = domains.size === 1 ? chosen[0].domain : undefined;
		terms.push({ logical, physical: chosen[0].column.trim(), ...(domain ? { domain } : {}) });
	}
	terms.sort((a, b) => a.logical.localeCompare(b.logical));
	return { terms, conflicts };
}

/** 컬럼에 도메인 값 적용 */
export function applyDomainValues(field: FieldData, domain: DomainObject): void {
	field.domain = domain.id;
	field.dataType = domain.dataType;
	if (domain.defaultValue === undefined || domain.defaultValue === "") delete field.defaultValue;
	else field.defaultValue = domain.defaultValue;
	if (domain.notNull) field.notNull = true;
	else if (!field.isPK) delete field.notNull;
}

/* -----------------------------------------------------------------------------------
 * CSV (엑셀에서 열고 저장할 수 있도록 UTF-8 BOM 포함)
 */
export function toCSV(rows: (string | number | boolean | undefined | null)[][]): string {
	const cell = (value: string | number | boolean | undefined | null) => {
		const text = value === undefined || value === null ? "" : String(value);
		return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
	};
	return "﻿" + rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function parseCSV(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	const source = text.replace(/^﻿/, "");
	for (let i = 0; i < source.length; i++) {
		const ch = source[i];
		if (quoted) {
			if (ch === '"' && source[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (ch === '"') quoted = false;
			else cell += ch;
		} else if (ch === '"') {
			quoted = true;
		} else if (ch === ",") {
			row.push(cell);
			cell = "";
		} else if (ch === "\n" || ch === "\r") {
			if (ch === "\r" && source[i + 1] === "\n") i++;
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
		} else {
			cell += ch;
		}
	}
	if (cell || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}
	return rows.map(r => r.map(c => c.trim())).filter(r => r.some(Boolean));
}
