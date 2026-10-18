/**
 * 엔터티 편집 그리드의 컬럼명/주석 셀 편집기.
 * 입력하는 동안 표준 용어 사전에서 찾아 제안한다 (주석 셀: 논리명, 컬럼명 셀: 물리명).
 */
import { docObjects } from "../state";
import type { DomainObject, StdTerm } from "../types";
import { overlayHost } from "../ui";
import { diagramUtil } from "../util/diagramUtil";
import { logicalKey } from "./standards";

/** 한 번에 보여줄 최대 제안 수 */
const MAX_RESULTS = 50;
/** 입력이 잠시 멈추면 찾는다 (ms) */
const SEARCH_DELAY = 120;

/** 용어별 비교용 키 (논리명: logicalKey, 물리명: 대문자). 용어가 바뀌면 다시 만든다 */
interface TermKeys { logical: string; physical: string; logicalKey: string; physicalKey: string }
const termKeyCache = new WeakMap<StdTerm, TermKeys>();

function getTermKeys(term: StdTerm): TermKeys {
	let keys = termKeyCache.get(term);
	if (!keys || keys.logical !== term.logical || keys.physical !== term.physical) {
		keys = { logical: term.logical, physical: term.physical, logicalKey: logicalKey(term.logical), physicalKey: term.physical.toUpperCase() };
		termKeyCache.set(term, keys);
	}
	return keys;
}

export class NameCellEditor {
	private inputBox: HTMLInputElement;
	private resultBox: HTMLDivElement;
	private selectedCell: HTMLTableCellElement | null = null;
	private results: StdTerm[] = [];
	private searchTimer: ReturnType<typeof setTimeout> | undefined;
	/** 셀 편집이 끝났을 때 (사전에 없는 이름의 자동 변환, tableGrid9) */
	onCellEdit: ((cell: HTMLTableCellElement) => void) | null = null;
	/** 제안된 용어를 골랐을 때 (도메인 적용, tableGrid9) */
	onTermSelect: ((tr: HTMLTableRowElement, term: StdTerm) => void) | null = null;

	constructor() {
		this.inputBox = diagramUtil.createHTMLElement(document.body, "input", "column_InputBox");
		this.inputBox.setAttribute("type", "text");
		this.inputBox.setAttribute("autocomplete", "off");
		this.resultBox = diagramUtil.createHTMLElement(document.body, "div", "column_search_result");

		this.inputBox.addEventListener("input", () => {
			clearTimeout(this.searchTimer);
			this.searchTimer = setTimeout(() => this.search(), SEARCH_DELAY);
		});
		this.inputBox.addEventListener("keydown", this.ev_keydown.bind(this));
		document.addEventListener("click", this.ev_documentClick.bind(this));
		this.hideResult();
	}

	setWorkTable(table: HTMLElement): void {
		table.addEventListener("click", (event) => this.setSelectedCell(event.target as HTMLElement));
	}

	private hideResult(): void {
		clearTimeout(this.searchTimer);
		this.searchTimer = undefined;
		this.resultBox.style.display = "none";
		this.results = [];
	}

	/** 주석 셀은 논리명, 컬럼명 셀은 물리명으로 찾는다 (최소 2자) */
	private search(): void {
		clearTimeout(this.searchTimer);
		this.searchTimer = undefined;
		this.resultBox.replaceChildren();
		const query = this.inputBox.value.trim();
		if (query.length < 2 || !this.selectedCell) {
			this.hideResult();
			return;
		}
		const byLogical = this.selectedCell.cellIndex === 1;
		const key = byLogical ? logicalKey(query) : query.toUpperCase();
		// 비교용 키는 용어마다 한 번만 만들고, 정렬 기준(앞에서부터 일치)도 미리 계산
		const matches: { term: StdTerm; starts: number }[] = [];
		for (const term of docObjects.terms) {
			const keys = getTermKeys(term);
			const target = byLogical ? keys.logicalKey : keys.physicalKey;
			if (target.includes(key)) matches.push({ term, starts: target.startsWith(key) ? 0 : 1 });
		}
		// 앞에서부터 일치하는 것을 먼저
		matches.sort((a, b) => a.starts - b.starts || a.term.logical.localeCompare(b.term.logical));
		this.results = matches.slice(0, MAX_RESULTS).map(match => match.term);
		const domains = new Map<string, DomainObject>();
		for (const d of docObjects.domains) if (!domains.has(d.id)) domains.set(d.id, d);
		if (this.results.length === 0) {
			this.hideResult();
			return;
		}
		this.results.forEach((term, inx) => {
			const domain = term.domain === undefined ? undefined : domains.get(term.domain);
			const div = diagramUtil.createHTMLElement(this.resultBox, "div", "column_search_result_item",
				`${term.logical}  ${term.physical}` + (domain ? `  [${domain.name}]` : ""));
			div.dataset.index = String(inx);
			div.addEventListener("click", () => this.selectResult(inx));
		});
		this.resultBox.style.display = "block";
	}

	private selectResult(inx: number): void {
		const term = this.results[inx];
		const cell = this.selectedCell;
		this.hideResult();
		if (!term || !cell) return;

		const tr = cell.parentNode as HTMLTableRowElement;
		if (cell.cellIndex === 1) {
			this.inputBox.value = term.logical;
			tr.cells[0].textContent = term.physical;
		} else {
			this.inputBox.value = term.physical;
			tr.cells[1].textContent = term.logical;
		}
		this.onTermSelect?.(tr, term);
		this.inputBox.focus();
	}

	private ev_keydown(event: KeyboardEvent): void {
		const cell = this.selectedCell;
		if (!cell) return;
		// 대기 중인 검색이 있으면 먼저 실행해서 제안 목록을 최신으로
		if (this.searchTimer !== undefined && ["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) this.search();

		// 제안 목록이 없으면 방향키로 셀 이동
		if (this.resultBox.style.display === "none") {
			const tr = cell.parentNode as HTMLTableRowElement;
			const input = this.inputBox;
			if (event.key === "ArrowDown") {
				const next = tr.nextElementSibling as HTMLTableRowElement | null;
				if (next) this.setSelectedCell(next.cells[cell.cellIndex]);
			} else if (event.key === "ArrowUp") {
				const prev = tr.previousElementSibling as HTMLTableRowElement | null;
				if (prev) this.setSelectedCell(prev.cells[cell.cellIndex]);
			} else if (event.key === "ArrowLeft" && input.selectionStart === 0 && cell.cellIndex > 0) {
				this.setSelectedCell(tr.cells[cell.cellIndex - 1]);
			} else if (event.key === "ArrowRight" && input.selectionStart === input.value.length && cell.cellIndex < 1) {
				this.setSelectedCell(tr.cells[cell.cellIndex + 1]);
			}
			return;
		}

		if (!["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) return;
		event.preventDefault();
		const items = [...this.resultBox.children] as HTMLElement[];
		const current = items.findIndex(item => item.classList.contains("selected"));
		const move = (inx: number) => {
			items[current]?.classList.remove("selected");
			items[inx]?.classList.add("selected");
			items[inx]?.scrollIntoView({ block: "nearest" });
		};
		if (event.key === "ArrowDown") move(current < 0 ? 0 : Math.min(items.length - 1, current + 1));
		else if (event.key === "ArrowUp") move(current < 0 ? items.length - 1 : Math.max(0, current - 1));
		else if (event.key === "Enter") {
			if (current >= 0) this.selectResult(current);
		} else this.hideResult();
	}

	private ev_documentClick(event: MouseEvent): void {
		const target = event.target as HTMLElement;
		if (!this.inputBox.contains(target) && !this.resultBox.contains(target) && target.tagName !== "TD") {
			this.endEditMode();
		}
	}

	endEditMode(): void {
		this.hideResult();
		if (!this.selectedCell) return;
		const cell = this.selectedCell;
		cell.textContent = this.inputBox.value;
		this.selectedCell = null;
		this.onCellEdit?.(cell);
	}

	private setSelectedCell(cell: HTMLElement | undefined): void {
		this.endEditMode();

		if (!(cell instanceof HTMLTableCellElement) || cell.cellIndex > 1 || this.selectedCell === cell ||
			(cell.parentNode as HTMLElement).getAttribute("data-parent")) return;

		this.selectedCell = cell;
		const currentValue = cell.textContent ?? "";
		cell.textContent = "";
		cell.appendChild(this.inputBox);
		this.inputBox.style.display = "inline-block";
		this.inputBox.value = currentValue;
		this.inputBox.focus();
		// position: fixed. 모달 다이얼로그 위에 보이도록 다이얼로그 안으로 옮긴다
		const rect = cell.getBoundingClientRect();
		overlayHost().appendChild(this.resultBox);
		this.resultBox.style.top = `${rect.bottom - 5}px`;
		this.resultBox.style.left = `${rect.left}px`;
	}
}
