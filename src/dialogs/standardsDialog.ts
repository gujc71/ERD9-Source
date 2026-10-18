/**
 * 도메인과 데이터 표준(단어/용어 사전) 관리, 표준 준수 검사
 */
import { downloadFile, getDocumentName } from "../erdManager";
import { applyIssues, checkAllEntities, countDomainUsage, getAllTables, syncDomainFields } from "../standard/applyStandards";
import { extractTerms, ISSUE_KIND, logicalKey, parseCSV, StdConverter, toCSV } from "../standard/standards";
import type { StdIssue } from "../standard/standards";
import { docObjects, state } from "../state";
import type { DomainObject, Sel, StdTerm, StdWord } from "../types";
import { dataTypeUtil } from "../util/dataTypeUtil";
import { diagramUtil } from "../util/diagramUtil";
import { TabPopupDialog9 } from "./PopupDialog9";

/** 목록 편집 표의 컬럼 */
interface ListColumn<T> {
	title: string;
	width: string;
	kind?: "text" | "check" | "select" | "label";
	get: (item: T) => string | boolean;
	set?: (item: T, value: string | boolean) => void;
	options?: () => { value: string; label: string }[];
	/** 입력 상자의 datalist id */
	list?: string;
}

interface ListTab<T> {
	tbody: Sel<HTMLTableSectionElement>;
	filter: Sel<HTMLInputElement>;
	items: () => T[];
	remove: (item: T) => void;
	columns: ListColumn<T>[];
	/** 필터에 맞는 항목 (화면에는 앞에서부터 shown개만 그린다) */
	matches: T[];
	shown: number;
	filterTimer?: ReturnType<typeof setTimeout>;
}

/** 목록을 한 번에 그리는 행 수. 나머지는 "Show more"로 */
const PAGE_SIZE = 200;
/** 필터 입력 후 목록을 다시 그릴 때까지 기다리는 시간 (ms) */
const FILTER_DELAY = 200;

const DOMAIN_HEADER = ["Name", "Data Type", "Default", "Not Null", "Comment"];
const WORD_HEADER = ["Logical", "Physical"];
const TERM_HEADER = ["Logical", "Physical", "Domain"];

export class StandardsDialog9 extends TabPopupDialog9 {
	private domains: DomainObject[] = diagramUtil.deepCopy(docObjects.domains);
	private words: StdWord[] = diagramUtil.deepCopy(docObjects.words);
	private terms: StdTerm[] = diagramUtil.deepCopy(docObjects.terms);
	private usage = countDomainUsage();

	private domainTab: ListTab<DomainObject>;
	private wordTab: ListTab<StdWord>;
	private termTab: ListTab<StdTerm>;
	private checkBody!: Sel<HTMLTableSectionElement>;
	private checkSummary!: Sel<HTMLSpanElement>;
	private issues: StdIssue[] = [];

	constructor() {
		super();
		const dialogContent = this.setDialog("Domains & Standards", "wide standardsDialog");

		const header = dialogContent.append("div").attr("class", "erd9Dialog-explainRow");
		header.append("p").attr("class", "erd9Dialog-explain4importDDL")
			.html("<b>Domain</b>: shared data type, default and not null for columns. Changing a domain updates every column that uses it.<br/>" +
				  "<b>Words / Terms</b>: the standard dictionary. In the Entity dialog, terms are suggested as you type a column name or logical name,<br/>and a logical name that is not a term is made into a column name from the words (고객주문번호 → CUST_ORD_NO).<br/>" +
				  "All are saved with the document. Use CSV to share them between documents or edit them in Excel.");
		this.setTabMenu(header, ["Domains", "Words", "Terms", "Check"]);

		// 데이터 타입 입력 도우미
		const typeList = dialogContent.append("datalist").attr("id", "stdDataTypes");
		for (const [type, needSize] of Object.entries(dataTypeUtil.getDataTypes(state.dbmsType))) {
			typeList.append("option").attr("value", needSize === "Y" ? type + "()" : type);
		}

		this.domainTab = this.makeListTab(dialogContent.append("div").attr("class", "tab1 tab-content active"), {
			items: () => this.domains,
			remove: item => { this.domains = this.domains.filter(d => d !== item); },
			add: () => {
				const domain: DomainObject = { id: "dm" + diagramUtil.getUniqueID(), name: "", dataType: "" };
				this.domains.push(domain);
				return domain;
			},
			columns: [
				{ title: "Name", width: "120px", get: d => d.name, set: (d, v) => { d.name = String(v); } },
				{ title: "Data Type", width: "120px", list: "stdDataTypes", get: d => d.dataType, set: (d, v) => { d.dataType = String(v); } },
				{ title: "Default", width: "90px", get: d => d.defaultValue === undefined ? "" : String(d.defaultValue),
				  set: (d, v) => { d.defaultValue = String(v) === "" ? undefined : String(v); } },
				{ title: "NN", width: "30px", kind: "check", get: d => !!d.notNull, set: (d, v) => { d.notNull = !!v || undefined; } },
				{ title: "Comment", width: "auto", get: d => d.comment ?? "", set: (d, v) => { d.comment = String(v) || undefined; } },
				{ title: "Used", width: "40px", kind: "label", get: d => String(this.usage.get(d.id) ?? 0) },
			],
			exportCSV: () => this.exportCSV("domains", DOMAIN_HEADER, this.domains.map(d => [d.name, d.dataType, d.defaultValue, d.notNull ? "Y" : "", d.comment])),
			importCSV: rows => this.importDomains(rows),
		});

		this.wordTab = this.makeListTab(dialogContent.append("div").attr("class", "tab2 tab-content"), {
			items: () => this.words,
			remove: item => { this.words = this.words.filter(w => w !== item); },
			add: () => {
				const word: StdWord = { logical: "", physical: "" };
				this.words.push(word);
				return word;
			},
			columns: [
				{ title: "Logical", width: "250px", get: w => w.logical, set: (w, v) => { w.logical = String(v); } },
				{ title: "Physical", width: "auto", get: w => w.physical, set: (w, v) => { w.physical = String(v); } },
			],
			exportCSV: () => this.exportCSV("words", WORD_HEADER, this.words.map(w => [w.logical, w.physical])),
			importCSV: rows => this.importWords(rows),
		});

		const termContent = dialogContent.append("div").attr("class", "tab3 tab-content");
		this.termTab = this.makeListTab(termContent, {
			items: () => this.terms,
			remove: item => { this.terms = this.terms.filter(t => t !== item); },
			add: () => {
				const term: StdTerm = { logical: "", physical: "" };
				this.terms.push(term);
				return term;
			},
			columns: [
				{ title: "Logical", width: "200px", get: t => t.logical, set: (t, v) => { t.logical = String(v); } },
				{ title: "Physical", width: "200px", get: t => t.physical, set: (t, v) => { t.physical = String(v); } },
				{ title: "Domain", width: "auto", kind: "select", get: t => t.domain ?? "", set: (t, v) => { t.domain = String(v) || undefined; },
				  options: () => [{ value: "", label: "" }, ...this.domains.filter(d => d.name).map(d => ({ value: d.id, label: d.name }))] },
			],
			exportCSV: () => {
				const domainName = new Map<string, string>();
				for (const d of this.domains) if (!domainName.has(d.id)) domainName.set(d.id, d.name);
				this.exportCSV("terms", TERM_HEADER, this.terms.map(t => [t.logical, t.physical, t.domain === undefined ? undefined : domainName.get(t.domain)]));
			},
			importCSV: rows => this.importTerms(rows),
		});
		termContent.select(".std-toolbar").append("button").text("Fill Physical")
			.attr("title", "Make the physical names of terms that have none from the words")
			.on("click", () => this.fillTermPhysical());
		termContent.select(".std-toolbar").append("button").text("Extract from ERD")
			.attr("title", "Add the columns used in this ERD (logical name → column name) as terms")
			.on("click", () => this.extractFromERD());

		this.makeCheckTab(dialogContent.append("div").attr("class", "tab4 tab-content"));

		const toolbar = this.setToolbar(dialogContent, "Save");
		toolbar.select("button").attr("title", "Save the domains and dictionaries to the document");
		this.renderList(this.domainTab);
	}

	override onChangeTab(tabName: string): void {
		// 다른 탭에서 바뀐 도메인 이름을 반영
		if (tabName === "tab1") this.renderList(this.domainTab);
		else if (tabName === "tab2") this.renderList(this.wordTab);
		else if (tabName === "tab3") this.renderList(this.termTab);
	}

	/* ---------------------------------------------------------------------------------
	 * 목록 편집 (도메인, 단어, 용어)
	 */
	private makeListTab<T>(content: Sel<HTMLDivElement>, options: {
		items: () => T[];
		remove: (item: T) => void;
		add: () => T;
		columns: ListColumn<T>[];
		exportCSV: () => void;
		importCSV: (rows: string[][]) => void;
	}): ListTab<T> {
		const bar = content.append("div").attr("class", "std-toolbar");
		const filter = bar.append("input").attr("type", "text").attr("placeholder", "Filter");
		bar.append("span").attr("class", "std-count");
		const grid = content.append("div").attr("class", "std-grid");
		const table = grid.append("table");
		const head = table.append("thead").append("tr");
		for (const column of options.columns) head.append("th").style("width", column.width).text(column.title);
		head.append("th").style("width", "24px");
		const tab: ListTab<T> = { tbody: table.append("tbody"), filter, items: options.items, remove: options.remove, columns: options.columns, matches: [], shown: 0 };

		// 입력할 때마다 다시 그리지 않고 잠시 멈추면 그린다
		filter.on("input", () => {
			clearTimeout(tab.filterTimer);
			tab.filterTimer = setTimeout(() => this.renderList(tab), FILTER_DELAY);
		});
		bar.append("button").text("Add").on("click", () => {
			const item = options.add();
			clearTimeout(tab.filterTimer);
			filter.property("value", "");
			this.renderList(tab, item);
			const rows = tab.tbody.selectAll<HTMLTableRowElement, T>("tr").filter(d => d === item);
			rows.node()?.scrollIntoView({ block: "nearest" });
			rows.select<HTMLInputElement>("input").node()?.focus();
		});
		bar.append("button").text("Import CSV").on("click", () => this.openCSV(rows => {
			options.importCSV(rows);
			this.renderList(tab);
		}));
		bar.append("button").text("Export CSV").on("click", options.exportCSV);
		return tab;
	}

	/** 필터에 맞는 항목을 다시 찾아 처음 PAGE_SIZE개를 그린다. reveal: 이 항목이 보일 때까지 그린다 */
	private renderList<T>(tab: ListTab<T>, reveal?: T): void {
		const keyword = tab.filter.property("value").trim().toLowerCase();
		const items = tab.items();
		const textColumns = tab.columns.filter(column => !column.kind || column.kind === "text");
		// 입력 상자(텍스트 컬럼)의 값으로 찾는다
		tab.matches = keyword
			? items.filter(item => textColumns.map(column => String(column.get(item))).join(" ").toLowerCase().includes(keyword))
			: items.slice();
		tab.shown = 0;
		tab.tbody.node()!.replaceChildren();
		// 보여야 하는 항목(새로 추가한 항목)이 첫 페이지 밖이면 맨 위에 보여 준다 (목록 순서는 그대로)
		const revealAt = reveal === undefined ? -1 : tab.matches.indexOf(reveal);
		if (revealAt >= PAGE_SIZE) {
			tab.matches.splice(revealAt, 1);
			tab.matches.unshift(reveal!);
		}
		this.renderMore(tab, PAGE_SIZE);
		this.updateCount(tab);
	}

	/** 다음 count개 행을 그리고, 남은 항목이 있으면 "Show more" 행 추가 */
	private renderMore<T>(tab: ListTab<T>, count: number): void {
		const tbody = tab.tbody.node()!;
		tbody.querySelector(":scope > tr.std-more")?.remove();
		// 선택 상자의 목록은 한 번만 만들고, 각 행에는 포커스를 받을 때 넣는다
		const options = new Map(tab.columns.filter(column => column.kind === "select").map(column => [column, column.options?.() ?? []] as const));

		const end = Math.min(tab.matches.length, tab.shown + count);
		for (let i = tab.shown; i < end; i++) this.appendRow(tab, tab.matches[i], options);
		tab.shown = end;

		const remaining = tab.matches.length - tab.shown;
		if (remaining > 0) {
			const td = tab.tbody.append("tr").attr("class", "std-more").append("td").attr("colspan", tab.columns.length + 1).attr("class", "alignCenter");
			td.append("button").text("Show more (" + remaining + " remaining)").on("click", () => this.renderMore(tab, PAGE_SIZE));
		}
	}

	private appendRow<T>(tab: ListTab<T>, item: T, options: Map<ListColumn<T>, { value: string; label: string }[]>): void {
		const tr = tab.tbody.append("tr").datum(item);
		for (const column of tab.columns) {
			const td = tr.append("td");
			const value = column.get(item);
			if (column.kind === "label") {
				td.attr("class", "alignCenter").text(String(value));
			} else if (column.kind === "check") {
				td.attr("class", "alignCenter").append("input").attr("type", "checkbox").property("checked", !!value)
					.on("change", function() { column.set?.(item, this.checked); });
			} else if (column.kind === "select") {
				const list = options.get(column) ?? [];
				const current = list.find(option => option.value === String(value));
				// 처음에는 현재 값만 넣어 둔다 (행이 많을 때 option 수를 줄이기 위해). 목록은 포커스를 받을 때 채운다
				const selectBox = td.append("select").on("change", function() { column.set?.(item, this.value); });
				if (current) selectBox.append("option").attr("value", current.value).text(current.label);
				let filled = false;
				const fill = () => {
					if (filled) return;
					filled = true;
					const node = selectBox.node()!;
					const selected = node.value;
					node.replaceChildren();
					for (const option of list) selectBox.append("option").attr("value", option.value).text(option.label);
					// 목록에 없는 값이면 선택 없음 (이전과 같게)
					if (current) node.value = selected;
					else node.selectedIndex = -1;
				};
				selectBox.on("focus", fill).on("mousedown", fill);
				if (!current) selectBox.property("selectedIndex", -1);
			} else {
				td.append("input").attr("type", "text").attr("list", column.list ?? null).property("value", String(value))
					.on("input", function() { column.set?.(item, this.value); });
			}
		}
		tr.append("td").attr("class", "alignCenter").append("a").text("X").attr("title", "delete").on("click", () => {
			tab.remove(item);
			const inx = tab.matches.indexOf(item);
			if (inx >= 0) {
				tab.matches.splice(inx, 1);
				if (inx < tab.shown) tab.shown--;
			}
			tr.remove();
			this.updateCount(tab);
		});
	}

	private updateCount<T>(tab: ListTab<T>): void {
		const bar = tab.filter.node()!.parentElement!;
		const filtered = tab.filter.property("value").trim() ? ` (${tab.matches.length} matched)` : "";
		bar.querySelector(".std-count")!.textContent = `${tab.items().length} items${filtered}`;
	}

	/* ---------------------------------------------------------------------------------
	 * CSV
	 */
	private exportCSV(kind: string, header: string[], rows: (string | number | undefined)[][]): void {
		downloadFile(`${getDocumentName()}_${kind}.csv`, toCSV([header, ...rows]), "text/csv;charset=utf-8");
	}

	private openCSV(onLoad: (rows: string[][]) => void): void {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".csv,text/csv";
		input.addEventListener("change", async () => {
			const file = input.files?.[0];
			if (!file) return;
			const rows = parseCSV(await file.text());
			// 첫 줄이 제목이면 건너뜀
			const first = rows[0]?.[0]?.toLowerCase();
			if (first && ["name", "logical", "논리명", "도메인명", "단어명", "용어명"].includes(first)) rows.shift();
			onLoad(rows);
		});
		input.click();
	}

	/** 같은 키가 있으면 바꾸고 없으면 추가. [추가, 변경] 수 */
	private merge<T>(list: T[], items: T[], key: (item: T) => string): [number, number] {
		let added = 0, updated = 0;
		// 키 -> 처음 위치 (findIndex와 같게 같은 키가 여러 개면 처음 것)
		const index = new Map<string, number>();
		list.forEach((existing, inx) => {
			const k = key(existing);
			if (!index.has(k)) index.set(k, inx);
		});
		for (const item of items) {
			const k = key(item);
			const inx = index.get(k);
			if (inx === undefined) {
				index.set(k, list.length);
				list.push(item);
				added++;
			} else {
				list[inx] = Object.assign(list[inx] as object, item) as T;
				updated++;
			}
		}
		return [added, updated];
	}

	private importDomains(rows: string[][]): void {
		const items = rows.filter(r => r[0] && r[1]).map(([name, dataType, defaultValue, notNull, comment]): DomainObject => ({
			id: "dm" + diagramUtil.getUniqueID(),
			name, dataType,
			...(defaultValue ? { defaultValue } : {}),
			...(/^(y|yes|true|1|o)$/i.test(notNull ?? "") ? { notNull: true } : {}),
			...(comment ? { comment } : {}),
		}));
		// 같은 이름이면 id는 그대로 두고 값만 변경
		const byName = this.domainsByName();
		const [added, updated] = this.merge(this.domains, items.map(item => {
			const existing = byName.get(item.name.toUpperCase());
			return existing ? { ...item, id: existing.id } : item;
		}), d => d.name.toUpperCase());
		alert(`Domains: ${added} added, ${updated} updated.`);
	}

	/** 대문자 도메인 이름 -> 도메인 (같은 이름이 여러 개면 처음 것) */
	private domainsByName(): Map<string, DomainObject> {
		const map = new Map<string, DomainObject>();
		for (const d of this.domains) {
			const key = d.name.toUpperCase();
			if (!map.has(key)) map.set(key, d);
		}
		return map;
	}

	private importWords(rows: string[][]): void {
		const items = rows.filter(r => r[0] && r[1]).map(([logical, physical]) => ({ logical, physical }));
		const [added, updated] = this.merge(this.words, items, w => logicalKey(w.logical));
		alert(`Words: ${added} added, ${updated} updated.`);
	}

	private importTerms(rows: string[][]): void {
		const missing = new Set<string>();
		const byName = this.domainsByName();
		const items = rows.filter(r => r[0]).map(([logical, physical, domainName]): StdTerm => {
			const domain = domainName ? byName.get(domainName.toUpperCase()) : undefined;
			if (domainName && !domain) missing.add(domainName);
			return { logical, physical: physical ?? "", ...(domain ? { domain: domain.id } : {}) };
		});
		const [added, updated] = this.merge(this.terms, items, t => logicalKey(t.logical));
		let message = `Terms: ${added} added, ${updated} updated.`;
		if (missing.size > 0) message += "\nUnknown domains (import the domains first): " + [...missing].join(", ");
		alert(message);
	}

	/** ERD에 쓰인 컬럼을 용어로 추가 */
	private extractFromERD(): void {
		const { terms, conflicts } = extractTerms(getAllTables(), this.terms);
		if (terms.length === 0) {
			alert("No new terms. Columns need a logical name to become a term.");
			return;
		}
		// 다이얼로그에서 지운 도메인은 연결하지 않음
		const ids = new Set(this.domains.map(d => d.id));
		this.terms.push(...terms.map(term => term.domain && !ids.has(term.domain) ? { logical: term.logical, physical: term.physical } : term));
		this.renderList(this.termTab);
		let message = `${terms.length} term(s) added from the columns of this ERD.`;
		if (conflicts.length > 0) {
			const shown = conflicts.slice(0, 20).join("\n") + (conflicts.length > 20 ? `\n... and ${conflicts.length - 20} more` : "");
			message += `\n\nThe same logical name has different column names. The most used one was taken:\n${shown}`;
		}
		alert(message);
	}

	/** 물리명이 없는 용어를 단어로 만든다 */
	private fillTermPhysical(): void {
		const converter = new StdConverter(this.words, []);
		const unknown = new Set<string>();
		let count = 0;
		for (const term of this.terms) {
			if (term.physical.trim() || !term.logical.trim()) continue;
			const result = converter.toPhysical(term.logical);
			if (result.unknown.length > 0) {
				result.unknown.forEach(word => unknown.add(word));
				continue;
			}
			term.physical = result.physical;
			count++;
		}
		this.renderList(this.termTab);
		alert(`${count} term(s) filled.` + (unknown.size > 0 ? "\nNot in the words: " + [...unknown].join(", ") : ""));
	}

	/* ---------------------------------------------------------------------------------
	 * 표준 준수 검사
	 */
	private makeCheckTab(content: Sel<HTMLDivElement>): void {
		const bar = content.append("div").attr("class", "std-toolbar");
		bar.append("button").text("Check").attr("title", "Check every column with the domains and dictionaries in this dialog").on("click", () => this.runCheck());
		bar.append("button").text("Apply Selected").attr("title", "Save the dictionaries and apply the suggested column names and domains").on("click", () => this.applySelected());
		bar.append("label").html("<input type='checkbox'/> select all").select("input").on("change", (event: Event) => {
			const checked = (event.target as HTMLInputElement).checked;
			this.checkBody.selectAll<HTMLInputElement, unknown>("input:not([disabled])").property("checked", checked);
		});
		this.checkSummary = bar.append("span").attr("class", "std-count");

		const grid = content.append("div").attr("class", "std-grid");
		const table = grid.append("table");
		const head = table.append("thead").append("tr");
		[["", "24px"], ["Table", "120px"], ["Column", "120px"], ["Attribute Name", "120px"], ["Issue", "auto"]]
			.forEach(([title, width]) => head.append("th").style("width", width).text(title));
		this.checkBody = table.append("tbody");
	}

	private runCheck(): void {
		const converter = new StdConverter(this.words, this.terms);
		if (converter.isEmpty) {
			alert("Add standard words or terms first.");
			return;
		}
		this.issues = checkAllEntities(converter, this.domains);
		this.checkBody.selectAll("tr").remove();
		for (const issue of this.issues) {
			const tr = this.checkBody.append("tr").datum(issue);
			const fixable = !!issue.suggestion;
			tr.append("td").attr("class", "alignCenter").append("input").attr("type", "checkbox").property("checked", fixable).property("disabled", !fixable);
			tr.append("td").text(issue.table);
			tr.append("td").text(issue.column);
			tr.append("td").text(issue.comment);
			tr.append("td").text(issue.message).attr("title", issue.message);
		}
		const byKind = (kind: string) => this.issues.filter(issue => issue.kind === kind).length;
		this.checkSummary.text(this.issues.length === 0 ? "All columns follow the standard." :
			`${this.issues.length} issues - name ${byKind(ISSUE_KIND.NAME)}, domain ${byKind(ISSUE_KIND.DOMAIN)}, unknown word ${byKind(ISSUE_KIND.WORD)}, no logical name ${byKind(ISSUE_KIND.NO_LOGICAL)}`);
	}

	private applySelected(): void {
		const selected: StdIssue[] = [];
		this.checkBody.selectAll<HTMLTableRowElement, StdIssue>("tr").each(function(issue) {
			if (this.querySelector<HTMLInputElement>("input")!.checked) selected.push(issue);
		});
		if (selected.length === 0) return;
		if (!this.commit()) return;
		const result = applyIssues(selected);
		let message = `${result.applied} change(s) applied.`;
		if (result.skipped.length > 0) message += "\n\nSkipped:\n" + result.skipped.join("\n");
		alert(message);
		this.usage = countDomainUsage();
		this.runCheck();
	}

	/* ---------------------------------------------------------------------------------
	 * 저장
	 */
	/** 입력값 확인 후 문서에 반영. 오류가 있으면 false */
	private commit(): boolean {
		const domains = this.domains.filter(d => d.name.trim() || d.dataType.trim());
		for (const domain of domains) {
			domain.name = domain.name.trim();
			domain.dataType = domain.dataType.trim();
			if (!domain.name || !domain.dataType) {
				alert("Enter the name and data type of every domain.");
				this._switchTabByName("tab1");
				return false;
			}
		}
		const names = domains.map(d => d.name.toUpperCase());
		const duplicate = names.find((name, inx) => names.indexOf(name) !== inx);
		if (duplicate) {
			alert("Duplicate domain name: " + duplicate);
			this._switchTabByName("tab1");
			return false;
		}
		const ids = new Set(domains.map(d => d.id));
		const clean = <T extends { logical: string; physical: string }>(list: T[]) =>
			list.map(item => ({ ...item, logical: item.logical.trim(), physical: item.physical.trim() })).filter(item => item.logical && item.physical);

		this.domains = domains;
		this.words = clean(this.words);
		this.terms = clean(this.terms).map(term => term.domain && !ids.has(term.domain) ? { logical: term.logical, physical: term.physical } : term);

		const changed = JSON.stringify(docObjects.domains) !== JSON.stringify(this.domains) ||
						JSON.stringify(docObjects.words) !== JSON.stringify(this.words) ||
						JSON.stringify(docObjects.terms) !== JSON.stringify(this.terms);
		docObjects.domains = diagramUtil.deepCopy(this.domains);
		docObjects.words = diagramUtil.deepCopy(this.words);
		docObjects.terms = diagramUtil.deepCopy(this.terms);
		if (changed) {
			syncDomainFields();
			state.diagramStack.markModified();
		}
		return true;
	}

	override closeWithOK(): void {
		if (this.commit()) this.close();
	}
}
