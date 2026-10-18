/**
 * 엔터티 찾기 (Ctrl + F).
 * 테이블의 물리/논리명과 컬럼명/설명을 입력하는 동안 찾아 목록으로 보여준다.
 *  - Enter, ↓: 다음 / Shift + Enter, ↑: 이전 / Esc: 닫기
 *  - 목록 클릭: 해당 엔터티로 이동. 현재 페이지에 없는 엔터티는 Main 페이지로 바꿔서 보여준다
 *  - 찾은 컬럼은 캔버스에서도 강조한다
 */
import type { Entity9 } from "../diagram/Entity9";
import { entityMap, pageState, state } from "../state";
import type { FieldData } from "../types";
import { isEntityVisible, switchPage } from "./pages";
import { scrollIntoView } from "./viewport";

interface FindHit {
	entity: Entity9;
	/** 없으면 테이블명이 일치 */
	field?: FieldData;
}

interface EntityGroup {
	entity: Entity9;
	nameMatched: boolean;
	fields: FieldData[];
	rank: number;
}

const MAX_GROUPS = 200;

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

/** keyword 부분을 <mark>로 감싼다 (대소문자 무시) */
function highlight(text: string | undefined, keyword: string): string {
	if (!text) return "";
	const lower = text.toLowerCase();
	let html = "", pos = 0, idx: number;
	while (keyword && (idx = lower.indexOf(keyword, pos)) >= 0) {
		html += escapeHtml(text.substring(pos, idx)) + "<mark>" + escapeHtml(text.substr(idx, keyword.length)) + "</mark>";
		pos = idx + keyword.length;
	}
	return html + escapeHtml(text.substring(pos));
}

/** 일치 정도: 0 같음, 1 앞부분, 2 포함, -1 없음 */
function matchRank(text: string | undefined, keyword: string): number {
	if (!text) return -1;
	const lower = text.toLowerCase();
	if (lower === keyword) return 0;
	if (lower.startsWith(keyword)) return 1;
	return lower.includes(keyword) ? 2 : -1;
}

function bestRank(...ranks: number[]): number {
	const found = ranks.filter(rank => rank >= 0);
	return found.length ? Math.min(...found) : -1;
}

export const findDiagram = {
	hits: [] as FindHit[],
	currentIndex: -1,
	keyword: "",
	/** 캔버스에서 컬럼을 강조한 엔터티 */
	markedEntity: null as Entity9 | null,

	panel: null as HTMLElement | null,
	input: null as HTMLInputElement | null,
	countLabel: null as HTMLElement | null,
	resultList: null as HTMLElement | null,

	init(): void {
		this.panel = document.getElementById("findEntityDiv");
		this.input = document.getElementById("findKeyword") as HTMLInputElement;
		this.countLabel = document.getElementById("findCount");
		this.resultList = document.getElementById("findResults");
		const input = this.input;

		let timer = 0;
		input.addEventListener("input", () => {
			clearTimeout(timer);
			timer = window.setTimeout(() => this.search(input.value), 120);
		});
		input.addEventListener("focus", () => {
			this.open();
			this.search(input.value, true);	// 그 사이 모델이 바뀌었을 수 있으므로 다시 찾음
		});
		input.addEventListener("keydown", (event: KeyboardEvent) => {
			switch (event.key) {
				case "Enter":
					clearTimeout(timer);
					this.search(input.value);
					this.move(event.shiftKey ? -1 : 1);
					break;
				case "ArrowDown": this.move(1); break;
				case "ArrowUp": this.move(-1); break;
				case "Escape": this.close(); break;
				default: return;
			}
			event.preventDefault();
		});

		document.getElementById("findNext")!.addEventListener("click", () => this.move(1));
		document.getElementById("findPrevious")!.addEventListener("click", () => this.move(-1));
		document.getElementById("closeFind")!.addEventListener("click", () => this.close());
		// 버튼과 목록을 눌러도 입력 상자의 포커스를 유지 (목록이 닫히지 않도록)
		this.panel!.addEventListener("mousedown", (event) => {
			if (event.target === input) return;
			event.preventDefault();
			if (!this.panel!.classList.contains("expanded")) this.open();	// 접힌 상태에서 돋보기 클릭
		});
		this.resultList!.addEventListener("click", (event) => {
			const item = (event.target as HTMLElement).closest<HTMLElement>("[data-hit]");
			if (item) this.goTo(Number(item.dataset.hit));
		});
	},

	/** Ctrl + F */
	open(): void {
		this.panel!.classList.add("expanded");
		if (document.activeElement !== this.input) {
			this.input!.focus();
			this.input!.select();
		}
	},

	close(): void {
		this.panel!.classList.remove("expanded");
		this.unmarkFields();
		this.input!.blur();
	},

	search(value: string, force = false): void {
		const keyword = value.trim().toLowerCase();
		if (!force && keyword === this.keyword) return;
		this.keyword = keyword;
		this.hits = [];
		this.currentIndex = -1;
		this.unmarkFields();

		if (!keyword) {
			this.renderList([]);
			return;
		}

		const groups: EntityGroup[] = [];
		for (const entity of entityMap.values()) {
			const data = entity.data;
			const nameRank = bestRank(matchRank(data.physicalName, keyword), matchRank(data.logicalName, keyword));
			const fields = data.allFields.filter(fld => matchRank(fld.column, keyword) >= 0 || matchRank(fld.comment, keyword) >= 0);
			if (nameRank < 0 && fields.length === 0) continue;
			// 테이블명 일치를 먼저, 현재 페이지의 엔터티를 먼저
			const rank = (nameRank < 0 ? 3 : nameRank) + (isEntityVisible(entity) ? 0 : 10);
			groups.push({ entity, nameMatched: nameRank >= 0, fields, rank });
		}
		groups.sort((a, b) => a.rank - b.rank || a.entity.data.physicalName.localeCompare(b.entity.data.physicalName));

		for (const group of groups) {
			if (group.nameMatched) this.hits.push({ entity: group.entity });
			for (const field of group.fields) this.hits.push({ entity: group.entity, field });
		}
		this.renderList(groups);
	},

	renderList(groups: EntityGroup[]): void {
		const list = this.resultList!;
		const keyword = this.keyword;
		if (!keyword) {
			list.innerHTML = "";
			this.updateCount();
			return;
		}
		if (groups.length === 0) {
			list.innerHTML = `<div class="findEmpty">No tables or columns match "<b>${escapeHtml(this.input!.value.trim())}</b>"</div>`;
			this.updateCount();
			return;
		}

		let html = "", hitIndex = 0;
		for (const group of groups.slice(0, MAX_GROUPS)) {
			const data = group.entity.data;
			const pageBadge = isEntityVisible(group.entity) ? "" : `<span class="findBadge" title="Not on the current page">Main</span>`;
			const logical = data.logicalName && data.logicalName !== data.physicalName
				? `<span class="findSub">${highlight(data.logicalName, keyword)}</span>` : "";
			const tableAttr = group.nameMatched ? ` data-hit="${hitIndex++}"` : "";
			html += `<div class="findTable${group.nameMatched ? "" : " findTable--parent"}"${tableAttr}>`
				+ `<span class="findIcon">▦</span><span class="findName">${highlight(data.physicalName, keyword)}</span>${logical}${pageBadge}</div>`;
			for (const field of group.fields) {
				html += `<div class="findColumn" data-hit="${hitIndex++}">`
					+ `<span class="findName">${highlight(field.column, keyword)}</span>`
					+ (field.comment ? `<span class="findSub">${highlight(field.comment, keyword)}</span>` : "")
					+ `<span class="findType">${escapeHtml(field.dataType ?? "")}</span></div>`;
			}
		}
		if (groups.length > MAX_GROUPS) {
			html += `<div class="findEmpty">${groups.length - MAX_GROUPS} more tables… refine your search</div>`;
			// 보이지 않는 결과는 이동 대상에서도 뺀다
			this.hits.length = hitIndex;
		}
		list.innerHTML = html;
		list.scrollTop = 0;
		this.updateCount();
	},

	updateCount(): void {
		const label = this.countLabel!;
		this.panel!.classList.toggle("noResult", !!this.keyword && this.hits.length === 0);
		if (!this.keyword) label.textContent = "";
		else if (this.hits.length === 0) label.textContent = "0";
		else label.textContent = this.currentIndex < 0 ? `${this.hits.length}` : `${this.currentIndex + 1} / ${this.hits.length}`;
	},

	move(step: number): void {
		if (this.hits.length === 0) return;
		const count = this.hits.length;
		const next = this.currentIndex < 0 ? (step > 0 ? 0 : count - 1) : (this.currentIndex + step + count) % count;
		this.goTo(next);
	},

	goTo(index: number): void {
		const hit = this.hits[index];
		if (!hit) return;
		if (!entityMap.has(hit.entity.id)) {	// 삭제된 엔터티
			this.search(this.input!.value, true);
			return;
		}
		this.currentIndex = index;
		if (!isEntityVisible(hit.entity) && pageState.current) switchPage(null);

		this.unmarkFields();
		state.selectMgr.deselectDiagram(hit.entity, state.diagramMenu);
		if (hit.field) this.markField(hit.entity, hit.field);
		scrollIntoView(hit.entity);

		const items = this.resultList!.querySelectorAll<HTMLElement>("[data-hit]");
		items.forEach(item => item.classList.toggle("active", Number(item.dataset.hit) === index));
		items[index]?.scrollIntoView({ block: "nearest" });
		this.updateCount();
	},

	markField(entity: Entity9, field: FieldData): void {
		entity.g.selectAll<SVGTSpanElement, FieldData | undefined>("tspan")
			.filter(d => d?.id === field.id)
			.classed("searchMatch", true);
		this.markedEntity = entity;
	},

	unmarkFields(): void {
		this.markedEntity?.g.selectAll("tspan.searchMatch").classed("searchMatch", false);
		this.markedEntity = null;
	},
};
