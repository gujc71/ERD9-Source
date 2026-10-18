import { select } from "d3-selection";
import { getAISettings } from "../ai/aiClient";
import { STATE_TYPE, DIAGRAM_TYPE } from "../constants";
import type { DbmsType } from "../constants";
import { scrollIntoView } from "../core/viewport";
import { Entity9 } from "../diagram/Entity9";
import { Relation9 } from "../diagram/Relation9";
import { downloadFile, getDocumentName, getRelationKind, setDBMS } from "../erdManager";
import { toHTML, toMarkdown, toXlsx } from "../export/tableDocs";
import type { RelationDoc, TableDoc, TableDocument } from "../export/tableDocs";
import { toDocColumn, toTableDoc } from "../export/tableDocModel";
import { CalcPosition } from "../sql/CalcPosition";
import { sqlMakerManager } from "../sql/SQLMaker";
import type { DiagramCollection } from "../sql/SQLMaker";
import { highlightSQL, Sql2Json, stripSQLComments } from "../sql/Sql2Json";
import { applyLogicalNames, findLogicalNames, loadDictionary, LOGICAL_DICTIONARIES } from "../standard/logicalNames";
import type { LogicalDictionary, LogicalNameChange, WordMap } from "../standard/logicalNames";
import type { ImportRelationData, ImportTableData } from "../sql/Sql2Json";
import { docObjects, entityMap, relationMap, state } from "../state";
import type { AnyDiagram } from "../state";
import { TableGrid9 } from "../tableGrid9";
import { getTemplates, saveTemplates } from "../templates";
import type { ColumnTemplate } from "../templates";
import type { AIERDData, EntityData, FieldData, SequenceObject, Sel, ViewObject } from "../types";
import { copyToClipboard } from "../util/clipboard";
import { diagramUtil } from "../util/diagramUtil";
import { detectMissingRelations } from "../util/detectRelationship";
import { createYielder } from "../util/sleep";
import { AISettingsDialog9, requestERDFromAI } from "../withAI";
import { PopupDialog9, TabPopupDialog9 } from "./PopupDialog9";
import { makeERDFromAI, showERDFromAI } from "./aiERD";

/** 선택된 엔터티(Entity) 이동 후 선택 */
function scrollToEntity(entity: Entity9 | undefined): void {
	if (!entity) return;
	scrollIntoView(entity);
	state.selectMgr.deselectDiagram(entity, state.diagramMenu);
}

/* -----------------------------------------------------------------------------------
 * Simple Import DDL
 */
const SAMPLE_DDL = `/*Copy the DDL statement you want to import, then press the 'Paste' button to paste it.*/
CREATE TABLE board(
board_id INT NOT NULL,
title VARCHAR(200) NOT NULL,
writer VARCHAR(20) NOT NULL,
regdate DATETIME NOT NULL,
count INT DEFAULT 0,
content LONGTEXT NOT NULL,
CONSTRAINT PRIMARY KEY(board_id)
);

CREATE TABLE board_comment(
comment_id INT NOT NULL,
board_id INT NOT NULL,
writer VARCHAR(20) NOT NULL,
regdate DATETIME NOT NULL,
content LONGTEXT NOT NULL,
CONSTRAINT PRIMARY KEY(comment_id)
);

ALTER TABLE board_comment ADD CONSTRAINT board_comment_fk FOREIGN KEY(board_id)REFERENCES board(board_id) ON DELETE CASCADE;
`;

export class SimpleImportDDLDialog9 extends TabPopupDialog9 {
	private sourceSQL: Sel<HTMLDivElement>;
	private previewDiv: HTMLDivElement;
	private logDiv: HTMLDivElement;
	private sql2json = new Sql2Json();
	/** 가져올 SQL 원문. 화면(sourceSQL)은 강조 표시용이고 분석에는 이 값을 사용 */
	private sqlText = SAMPLE_DDL;
	/** 마지막으로 분석한 SQL(DBMS 포함). 미리보기 후 실행할 때 다시 분석하지 않도록 */
	private parsedKey: string | null = null;

	constructor() {
		super();
		const dialogContent = this.setDialog("Import from DDL (Data Definition Language)",  "wide");

		const explain = dialogContent.append("div").attr("class", "erd9Dialog-explainRow");
		explain.append("div").attr("class", "erd9Dialog-explain4importDDL").html("Extract tables, relationships, indexes, views and sequences from the DDL to generate the ERD.<br/>After copying/pasting the DDL, click the 'Preview' or 'Run' button. MariaDB, PostgreSQL and MS-SQL statements are analyzed by an SQL parser.");

		this.setTabMenu (explain, ["SQL", "Preview", "Log"]);

		const tabContent1 = dialogContent.append("div").attr("class", "tab1 tab-content active");
			const tabContentToolbar1 = tabContent1.append("div").style("display", "inline-block");
				tabContentToolbar1.append("button").attr("id", "pasteButton4DDL").text("Paste").on("click", this._ev_pasteButton4DDL.bind(this));
				tabContentToolbar1.append("button").attr("id", "previewButton4DDL").text("Preview").on("click", this._ev_previewButton4DDL.bind(this));
				tabContentToolbar1.append("button").attr("id", "runButton4DDL").text("Run (Import from DDL)").on("click", this._ev_runButton4ERD.bind(this));
			const tabContentToolbar2 = tabContent1.append("div").style("display", "inline-block");
			tabContentToolbar2.html(" <label><input type='radio' name='dbmsType4DDL' value='mariadb'> MariaDB</label> <label><input type='radio' name='dbmsType4DDL' value='oracle'> Oracle</label> <label><input type='radio' name='dbmsType4DDL' value='mssql'> MS-SQL</label> <label><input type='radio' name='dbmsType4DDL' value='postgresql'> PostgreSQL</label>");
			tabContentToolbar2.select(`input[value='${state.dbmsType}']`).property("checked", true);
			this.sourceSQL = tabContent1.append("div").attr("id", "sourceSQL").attr("class", "tab-logger");
			this.sourceSQL.html(diagramUtil.escapeHTML(SAMPLE_DDL).replace(/\n/g, "<br/>"));

		const tabContent2 = dialogContent.append("div").attr("class", "tab2 tab-content");
			const tabContentToolbar2_1 = tabContent2.append("div").style("display", "inline-block");
			tabContentToolbar2_1.append("button").attr("id", "runButton4DDL").text("Run (Import from Preview result)").on("click", this._ev_runPreviewButton4ERD.bind(this));

			this.previewDiv = tabContent2.append("div").attr("id", "previewDiv").attr("class", "tab-logger").node()!;

		const tabContent3 = dialogContent.append("div").attr("class", "tab3 tab-content");
		this.logDiv = tabContent3.append("div").attr("id", "logDiv").attr("class", "tab-logger").node()!;

		this.setToolbar(dialogContent);
	}
	override close (): void {
		this.sql2json.initResult();
		this.parsedKey = null;
		super.close ();
	}

	private _getDBMS(): DbmsType {
		return this.dialogContent.querySelector<HTMLInputElement>('input[name="dbmsType4DDL"]:checked')!.value as DbmsType;
	}

	private _ev_pasteButton4DDL(): void {
		navigator.clipboard.readText()
		.then(text => {
			this.sqlText = text;
			highlightSQL(text, this.sourceSQL.node()!);
		})
		.catch(error => {
			console.error("Failed to paste from clipboard: ", error);
		});
	}

	private async _extract(): Promise<void> {
		const dbms = this._getDBMS();
		const key = dbms + "\n" + this.sqlText;
		if (key === this.parsedKey) return;		// 같은 SQL은 다시 분석하지 않음 (미리보기 후 실행)
		this.parsedKey = null;

		// 주석은 따옴표 밖의 것만 제거 ('http://...' 같은 문자열은 유지)
		await this.sql2json.extract(stripSQLComments(this.sqlText, true), this.logDiv, dbms);
		this.sql2json.logInfo("---------------------------------------------") ;
		this.sql2json.logInfo("Import Entity: " + this.sql2json.tableList.length) ;
		this.sql2json.logInfo("Import Relationship: " + this.sql2json.relationList.length) ;
		if (this.sql2json.views.length) this.sql2json.logInfo("Import View: " + this.sql2json.views.length) ;
		if (this.sql2json.sequences.length) this.sql2json.logInfo("Import Sequence: " + this.sql2json.sequences.length) ;
		this.sql2json.flushLog();
		this.parsedKey = key;
	}

	private async _ev_previewButton4DDL(): Promise<void> {
		this._switchTabByName("tab3");

		await this._extract();
		this._switchTabByName("tab2");
		this.generatePreview(this.previewDiv, this.sql2json.tableList, this.sql2json.relationList);
	}

	private _ev_runPreviewButton4ERD(): void {
		this._switchTabByName("tab3");

		setDBMS( this._getDBMS() );
		this.sql2json.flushLog();
		this.generateERD(this.logDiv, this.sql2json.tableList, this.sql2json.relationList);
	}
	private async _ev_runButton4ERD(): Promise<void> {
		this._switchTabByName("tab3");

		setDBMS( this._getDBMS() );

		await this._extract();
		this.sql2json.logInfo("---------------------------------------------") ;
		this.sql2json.flushLog();

		this.generateERD(this.logDiv, this.sql2json.tableList, this.sql2json.relationList);
	}

	async generatePreview(parentNode: HTMLElement, tableList: ImportTableData[], relationList: ImportRelationData[]): Promise<void> {
		parentNode.innerText = "";
		const yieldToUI = createYielder(16, () => { parentNode.scrollTop = parentNode.scrollHeight; });

		for (const tableData of tableList) {
			diagramUtil.renderTableDoc(parentNode, toTableDoc(tableData));
			await yieldToUI();
		}
		parentNode.scrollTop = parentNode.scrollHeight;

		diagramUtil.renderRelationDocs(parentNode, relationList.map(relation => ({ ...relation, onDelete: relation.onDelete ?? "", onUpdate: relation.onUpdate ?? "" })));

		const objects = [...this.sql2json.views.map(v => ["View", v.name]), ...this.sql2json.sequences.map(s => ["Sequence", s.name])];
		if (objects.length > 0) {
			diagramUtil.createHTMLElement(parentNode, "h4", "tableName-span", "Views & Sequences" );
			const table = diagramUtil.createHTMLElement(parentNode, "table");
			diagramUtil.addTableRow(table, "th", ["Type", "Name"]);
			objects.forEach(row => diagramUtil.addTableRow(table, "td", row));
		}
	}

	generateERD(parentNode: HTMLElement, tableList: ImportTableData[], relationList: ImportRelationData[]): Promise<void> {
		return importTablesToERD(parentNode, tableList, relationList, this.sql2json.views, this.sql2json.sequences);
	}
}

/** 가져온 테이블과 관계로 엔터티를 만든다 (DDL 가져오기, Reverse engineering). 뷰와 시퀀스는 같은 이름이 없으면 추가 */
export async function importTablesToERD(parentNode: HTMLElement, tableList: ImportTableData[], relationList: ImportRelationData[],
										 views: ViewObject[] = [], sequences: SequenceObject[] = []): Promise<void> {
	const canvas = state.canvas;
	const list: AnyDiagram[] = [];
	const enMap = new Map<string, Entity9>();

	const calcPosition = new CalcPosition();
	const yieldToUI = createYielder();

	for (const tableData of tableList) {
		await yieldToUI();

		// 가져온 결과는 다시 사용할 수 있으므로(미리보기 후 실행 등) 복사해서 엔터티끼리 데이터를 공유하지 않도록
		const columns = diagramUtil.deepCopy(tableData.columns);
		const data: EntityData = {
			physicalName: tableData.physicalName,
			logicalName: tableData.logicalName,
			keys: columns.filter(item => item.isPK),
			fields: columns.filter(item => !item.isPK)
		};
		// 인덱스, CHECK 제약
		if (tableData.indexes) data.indexes = diagramUtil.deepCopy(tableData.indexes);
		if (tableData.checks) data.checks = diagramUtil.deepCopy(tableData.checks);

		const e1 = new Entity9(canvas, 0, 0, null, data, true);	// 크기는 아래에서 한 번에 계산
		enMap.set(tableData.physicalName.toUpperCase(), e1);
		list.push(e1);
	}
	// 모두 그린 다음 크기를 한 번에 계산하고, 크기에 맞춰 배치
	const entities = list as Entity9[];
	Entity9.layoutAll(entities);
	for (const e1 of entities) {
		const ret = calcPosition.getPosition(e1.x2-e1.x1, e1.y2-e1.y1);
		e1.rePosition(ret.x, ret.y);
	}

	for (const relationData of relationList) {
		const er1 = enMap.get(relationData.childTable.toUpperCase());
		const er2 = enMap.get(relationData.parentTable.toUpperCase());
		if (!er1 || !er2) {
			diagramUtil.createHTMLElement(parentNode, "span", "log-span", `The relationship cannot be created because the table is not found. ${relationData.childTable} - ${relationData.parentTable}`);
			continue;
		}
		const childFields = relationData.childFields.split(",");
		const parentFields = relationData.parentFields.split(",");
		if (childFields.length !== parentFields.length) {
			diagramUtil.createHTMLElement(parentNode, "span", "log-span", `The relationship cannot be created because the columns linking the two tables do not match. ${relationData.childTable} - ${relationData.parentTable}`);
			continue;
		}

		const r = Relation9.create(canvas, er2, er1, false, getRelationKind(), null,
								   { name: relationData.name, onDelete: relationData.onDelete, onUpdate: relationData.onUpdate });
		if (r) {
			r.setRelationFields(childFields, parentFields);
			list.push(r);
		}
	}

	// 뷰, 시퀀스: 같은 이름이 없으면 추가
	const addObjects = <T extends { name: string }>(target: T[], items: T[]) => {
		for (const item of items) {
			if (!target.some(t => t.name.toUpperCase() === item.name.toUpperCase())) target.push(item);
		}
	};
	addObjects(docObjects.views, views);
	addObjects(docObjects.sequences, sequences);

	state.diagramStack.saveState(STATE_TYPE.MULTY_CREATE, list);
}

/* -----------------------------------------------------------------------------------
 * 선택 범위(전체 / 선택된 엔터티)를 고르는 다이얼로그
 */
abstract class EntityScopeDialog9 extends PopupDialog9 {
	protected editor!: Sel<HTMLDivElement>;
	protected toolbar!: Sel<HTMLDivElement>;

	protected setScopeToolbar(dialogContent: Sel<HTMLDivElement>, buttonText: string, onClick: () => void): void {
		this.toolbar = dialogContent.append("div");

		this.toolbar.append("div").attr("class", "erd9Dialog-explain4importDDL")
				.html("<label><input type='radio' name='entityType' value='all' checked> All entities</label>" +
					"<label><input type='radio' name='entityType' value='selected'> Selected entities </label>");
		this.toolbar.append("button").text(buttonText).on("click", onClick);

		this.editor = dialogContent.append("div").attr("id", "editorDDL").attr("class", "tab-logger");
	}

	protected isAllScope(): boolean {
		return this.popupDialog.select('input[name="entityType"]:checked').property('value') === "all";
	}

	/** 선택된 범위의 엔터티와 관계. 선택된 엔터티가 없으면 null */
	protected getScope(clearEditor = true): { tables: DiagramCollection<AnyDiagram>; relations: DiagramCollection<Relation9> } | null {
		const selectList = state.selectMgr.getSelectList();
		if (!this.isAllScope() && selectList.length===0) {
			alert("Select the entities you worked with!");
			return null;
		}

		if (clearEditor) this.editor.node()!.innerHTML = "";
		if (this.isAllScope()) return { tables: entityMap, relations: relationMap };

		return { tables: selectList, relations: sqlMakerManager.getUsedRelationList(selectList) };
	}
}

/* -----------------------------------------------------------------------------------
 * Generate DDL
 */
export class GenerateDDLDialog9 extends EntityScopeDialog9 {
	constructor() {
		super();
		const dialogContent = this.setDialog("Data Definition Language (DDL)",  "wide");
		this.setScopeToolbar(dialogContent, "Generate DDL", this.makeDDL.bind(this));
		this.setToolbar(dialogContent, "Copy code");
	}

	override closeWithOK (): void {	// Copy Data
		copyToClipboard(this.editor.text());
		alert("The DDL has been copied to the clipboard.");
	}

	private makeDDL (): void {
		const scope = this.getScope();
		if (!scope) return;
		// 뷰, 시퀀스는 전체를 선택한 경우만
		sqlMakerManager.makeSQL(this.editor.node()!, scope.tables, scope.relations, this.isAllScope() ? docObjects : undefined);
	}
}

/* -----------------------------------------------------------------------------------
 * Generate Table Description
 */
/** 엔터티 목록으로 테이블 정의서 데이터 생성 */
function buildTableDocument(tables: Iterable<AnyDiagram>, relations: Iterable<Relation9>): TableDocument {
	const entities = [...tables].filter((item): item is Entity9 => item instanceof Entity9);
	const byName = new Map([...entityMap.values()].map(entity => [entity.data.physicalName, entity]));
	const fkName = (field: FieldData) => {
		if (!field.parent) return "";
		const parentField = byName.get(field.parent)?.data.allFields.find(f => f.id === field.parentID);
		return parentField ? `${field.parent}.${parentField.column}` : field.parent;
	};
	const docs: TableDoc[] = entities.map(entity => ({
		physicalName: entity.data.physicalName,
		logicalName: entity.data.logicalName ?? "",
		columns: entity.data.allFields.map(field => toDocColumn(field, { pk: !!field.isPK || entity.data.keys.includes(field), fk: fkName(field) })),
		indexes: entity.data.indexes ?? [],
		checks: entity.data.checks ?? [],
	}));
	const relationDocs: RelationDoc[] = [...relations].map(relation => ({
		name: relation.name || relation.id,
		...relation.getRelationData(),
		onDelete: relation.onDelete ?? "",
		onUpdate: relation.onUpdate ?? "",
	}));
	return { title: getDocumentName(), dbms: state.dbmsType, tables: docs, relations: relationDocs };
}

export class GenerateTableDescriptionDialog9 extends EntityScopeDialog9 {
	constructor() {
		super();
		const dialogContent = this.setDialog("Table Description",  "wide");
		this.setScopeToolbar(dialogContent, "Generate Table Description", this.makeTableDesc.bind(this));
		const download = this.toolbar.append("span").attr("class", "downloadButtons");
		download.append("span").text("Download: ");
		download.append("button").text("Markdown").on("click", () => this.download("md"));
		download.append("button").text("HTML").on("click", () => this.download("html"));
		download.append("button").text("Excel").on("click", () => this.download("xlsx"));
		this.setToolbar(dialogContent, "Copy Data");
	}

	override closeWithOK (): void {	// Copy Data
		copyToClipboard(this.editor.html());
		alert("The Table Description has been copied to the clipboard.\nPaste it into an editor like Excel to use it.");
	}

	private download(format: "md" | "html" | "xlsx"): void {
		const scope = this.getScope(false);
		if (!scope) return;
		const doc = buildTableDocument(scope.tables.values(), scope.relations.values());
		if (doc.tables.length === 0) {
			alert("There is no entity to export.");
			return;
		}
		const filename = getDocumentName() + "_tables";
		if (format === "md") downloadFile(filename + ".md", toMarkdown(doc), "text/markdown");
		else if (format === "html") downloadFile(filename + ".html", toHTML(doc), "text/html");
		else downloadFile(filename + ".xlsx", toXlsx(doc) as Uint8Array<ArrayBuffer>, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
	}

	private makeTableDesc(): void {
		const scope = this.getScope();
		if (!scope) return;
		this.generateTableDesc(this.editor.node()!, scope.tables, scope.relations);
	}

	private async generateTableDesc(logPrinter: HTMLElement, tableList: DiagramCollection<AnyDiagram>, relationList: DiagramCollection<Relation9>): Promise<void> {
		logPrinter.innerText = "";
		const doc = buildTableDocument(tableList.values(), relationList.values());
		const yieldToUI = createYielder(16, () => { logPrinter.scrollTop = logPrinter.scrollHeight; });

		for (const table of doc.tables) {
			diagramUtil.renderTableDoc(logPrinter, table);
			await yieldToUI();
		}
		logPrinter.scrollTop = logPrinter.scrollHeight;
		if (doc.relations.length === 0) return;

		diagramUtil.renderRelationDocs(logPrinter, doc.relations, ["120px", "70px", "150px", "70px", "150px", "80px", "80px"]);
		const p = diagramUtil.createHTMLElement(logPrinter, "p");
		p.innerHTML = "&nbsp;";
		logPrinter.scrollTop = logPrinter.scrollHeight;
	}
}

/* -----------------------------------------------------------------------------------
 * Generate Logical Names
 */
export class GenerateLogicalNamesDialog9 extends EntityScopeDialog9 {
	private dictionaryBody: Sel<HTMLTableSectionElement>;
	private overwrite: Sel<HTMLInputElement>;
	private includeTables: Sel<HTMLInputElement>;
	/** 생성 결과 (미리보기). 적용 버튼을 누르면 체크한 항목을 엔터티에 반영 */
	private resultBody: Sel<HTMLTableSectionElement> | null = null;
	/** 생성 버튼을 누른 적이 있는지. 있으면 옵션을 바꿀 때 다시 생성 */
	private generated = false;
	/** 가져온 사전 (사전 id -> 단어). 선택한 사전만 가져오고, 창을 닫으면 버린다 */
	private wordMaps = new Map<string, WordMap>();

	constructor() {
		super();
		const dialogContent = this.setDialog("Generate Logical Names", "wide");
		dialogContent.append("p").attr("class", "erd9Dialog-explain")
			.html("Splits each physical name into words (by _) and looks them up in the checked dictionaries.<br/>If at least one word is found, the words are joined with spaces and used as the logical name. Press 'Apply' to update the entities.");

		const table = dialogContent.append("div").attr("class", "tab-logger logicalDictionaries").append("table");
		const head = table.append("thead").append("tr");
		[["", "24px"], ["Dictionary", "auto"]].forEach(([title, width]) => head.append("th").style("width", width).text(title));
		this.dictionaryBody = table.append("tbody");
		for (const dictionary of LOGICAL_DICTIONARIES) {
			const tr = this.dictionaryBody.append("tr").datum(dictionary);
			tr.append("td").attr("class", "alignCenter").append("input").attr("type", "checkbox");
			tr.append("td").text(dictionary.name).attr("title", dictionary.url);
		}

		const options = dialogContent.append("div").attr("class", "erd9Dialog-explain4importDDL");
		this.overwrite = options.append("label").append("input").attr("type", "checkbox");
		this.overwrite.node()!.after(" Overwrite existing logical names ");
		this.includeTables = options.append("label").append("input").attr("type", "checkbox").property("checked", true);
		this.includeTables.node()!.after(" Include table names ");
		// 옵션이나 사전을 바꾸면 이미 보이는 미리보기가 맞지 않으므로 다시 생성
		const regenerate = () => { if (this.generated) this.generate(); };
		this.overwrite.on("change", regenerate);
		this.includeTables.on("change", regenerate);
		this.dictionaryBody.selectAll("input").on("change", regenerate);

		this.setScopeToolbar(dialogContent, "Generate Logical Names", () => { this.generate(); });
		this.setToolbar(dialogContent, "Apply");
	}

	private async generate(): Promise<void> {
		this.resultBody = null;
		const dictionaries: LogicalDictionary[] = [];
		this.dictionaryBody.selectAll<HTMLTableRowElement, LogicalDictionary>("tr").each(function(dictionary) {
			if (this.querySelector<HTMLInputElement>("input")!.checked) dictionaries.push(dictionary);
		});
		if (dictionaries.length === 0) {
			alert("Check at least one dictionary.");
			return;
		}
		const scope = this.getScope();
		if (!scope) return;
		const entities = [...scope.tables.values()].filter((item): item is Entity9 => item instanceof Entity9);
		this.generated = true;

		const logger = this.editor.node()!;
		let wordMaps: WordMap[];
		try {
			const missing = dictionaries.filter(dictionary => !this.wordMaps.has(dictionary.id));
			if (missing.length > 0) logger.innerText = "Loading dictionaries...";
			const loaded = await Promise.all(missing.map(loadDictionary));
			if (!this.popupDialog.node()!.isConnected) return;	// 가져오는 중에 창을 닫은 경우
			missing.forEach((dictionary, inx) => this.wordMaps.set(dictionary.id, loaded[inx]));
			wordMaps = dictionaries.map(dictionary => this.wordMaps.get(dictionary.id)!);
		} catch (error) {
			logger.innerText = error instanceof Error ? error.message : String(error);
			return;
		}

		const changes = findLogicalNames(entities, wordMaps, {
			overwrite: this.overwrite.property("checked"),
			includeTables: this.includeTables.property("checked"),
		});
		logger.innerText = "";
		diagramUtil.createHTMLElement(logger, "p").textContent = changes.length === 0 ? "No logical name to generate." :
			`${changes.length} logical name(s) generated. Check the items and press 'Apply'.`;
		if (changes.length === 0) return;
		const result = select(logger).append("table");
		const head = result.append("thead").append("tr");
		const allCheck = head.append("th").style("width", "24px").append("input").attr("type", "checkbox").property("checked", true)
			.on("change", () => this.resultBody?.selectAll("input").property("checked", allCheck.property("checked")));
		["Table", "Column", "Before", "After"].forEach(title => head.append("th").text(title));
		this.resultBody = result.append("tbody");
		for (const change of changes) {
			const tr = this.resultBody.append("tr").datum(change);
			tr.append("td").attr("class", "alignCenter").append("input").attr("type", "checkbox").property("checked", true);
			[change.table, change.column, change.before, change.after].forEach(text => tr.append("td").text(text).attr("title", text));
		}
	}

	override closeWithOK(): void {	// Apply
		const selected: LogicalNameChange[] = [];
		this.resultBody?.selectAll<HTMLTableRowElement, LogicalNameChange>("tr").each(function(change) {
			if (this.querySelector<HTMLInputElement>("input")!.checked) selected.push(change);
		});
		if (selected.length === 0) {
			alert("Press 'Generate Logical Names' and check the items to apply.");
			return;
		}
		const applied = applyLogicalNames(selected);
		alert(`${applied} logical name(s) applied.`);
		this.close();
	}

	/** 사전과 미리보기가 쓰던 메모리 해제 */
	override close(): void {
		this.wordMaps.clear();
		this.resultBody = null;
		this.generated = false;
		super.close();
	}
}

/* -----------------------------------------------------------------------------------
 * Detect Relationship
 */
export class DetectRelationshipDialog9 extends TabPopupDialog9 {
	private matchDataType: Sel<HTMLInputElement>;
	private makeRelation: Sel<HTMLButtonElement>;
	private tableTbody1!: HTMLTableSectionElement;
	private tableTbody2!: HTMLTableSectionElement;

	constructor() {
		super();
		const dialogContent = this.setDialog("Evaluate relationships", "wide");

		const topToolbar = dialogContent.append("div");
		topToolbar.append("div").attr("class", "erd9Dialog-explain4importDDL").html("Two ways to evaluate relationships between tables.<br/><b>Missing</b>: Search for missing relationships.<br/><b>Not Match</b>: Verifies that the two tables with the relationship have the same column names and data types.");

		this.setTabMenu (topToolbar, ["Missing", "Not Match"]);

		const tabContent1 = dialogContent.append("div").attr("class", "tab1 tab-content active");

		const explain = tabContent1.append("div").append("p").attr("class", "erd9Dialog-explain").html("Searches for the same column names between tables.</br>For a more stringent search, select ");
				this.matchDataType = explain.append("input").attr("type", "checkbox").attr("id", "matchDataType").on("click", this._matchDataTypeClick.bind(this));
				explain.append("label").attr("for", "matchDataType").text("Match data type");

		const tabContent2 = dialogContent.append("div").attr("class", "tab2 tab-content");

		this.detectMissingRelationship(tabContent1);
		this.detectWrongRelationship(tabContent2);

		const toolbar = this.setToolbar(dialogContent);
		this.makeRelation = toolbar.insert("button", ":first-child").text("Make Relationship for selected rows").on("click", this.ev_makeRelation.bind(this));
	}

	private ev_makeRelation (): void {
		const checkedCheckboxes = this.tableTbody1.querySelectorAll<HTMLInputElement>("input[type='checkbox']:checked");
		if (checkedCheckboxes.length===0) {
			alert("Select the checkboxes of the rows you want to make a relationship");
		}

		checkedCheckboxes.forEach(function(checkbox) {
			const row = checkbox.parentNode!.parentNode as HTMLTableRowElement;
			const e1 = entityMap.get(row.dataset.pid ?? "");
			const e2 = entityMap.get(row.dataset.cid ?? "");

			const r = Relation9.create(state.canvas, e1, e2, true, row.dataset.isPK==="true" ? DIAGRAM_TYPE.RELATION_PK : DIAGRAM_TYPE.RELATION_AK);
			if (r) state.diagramStack.saveState(STATE_TYPE.RELATION_CREATE, r);
		});
	}

	override onChangeTab (tabName: string): void {
		this.makeRelation.style("display", tabName==="tab1" ? "" : "none");
	}

	private async detectMissingRelationship(tabContent1: Sel<HTMLDivElement>): Promise<void> {
		const tabView1 = tabContent1.append("div").attr("id", "editorDDL").attr("class", "tab-logger").node()!;
		const table1 = diagramUtil.createHTMLElement(tabView1, "table");
		diagramUtil.addTableRow(table1, "th", ["Parent Table", "Parent Columns", "", "Child Table", "Child Columns", ""], ["200px", "200px", "30px", "200px", "200px", "30px"]);
		this.tableTbody1 = diagramUtil.createHTMLElement(table1, "tbody");

		const yieldToUI = createYielder(16, () => { tabView1.scrollTop = tabView1.scrollHeight; });
		for (const found of detectMissingRelations(entityMap.values())) {
			await yieldToUI();
			const { parent: valueP, child: valueC } = found;

			// 두 테이블의 관계가 존재
			const checkbox = document.createElement("input");
			checkbox.type = "checkbox";
			const row = diagramUtil.addTableRow(this.tableTbody1, "td", [valueP.data.physicalName, this._getFieldNames(valueP.data.keys), null, valueC.data.physicalName, this._getFieldNames(found.childFields), checkbox], null, [null, null, null, null, null, "changePK"]);
			row.dataset.pid = valueP.id;
			row.dataset.cid = valueC.id;
			row.dataset.dataType = found.sameType ? "s" : "d";
			row.dataset.isPK = String(found.isPK);
			row.cells[0].addEventListener('click', () => scrollToEntity(entityMap.get(row.dataset.pid ?? "")));
			row.cells[3].addEventListener('click', () => scrollToEntity(entityMap.get(row.dataset.cid ?? "")));
			row.cells[0].classList.add("mousePointer");
			row.cells[3].classList.add("mousePointer");

			// 서로 PK
			if (found.reversible) {
				row.cells[2].textContent = "⇔";
				row.cells[2].classList.add("changePK");
				row.cells[2].title = "Change parent and child";
				row.cells[2].addEventListener('click', () => this._reverseKeyField(row));
			}
		}

		const p = diagramUtil.createHTMLElement(tabView1, "p");
		p.innerHTML = "&nbsp;";
		tabView1.scrollTop = tabView1.scrollHeight;
	}

	/*
	 * 1. 부모의 키가 자식에게 없는 경우 (컬럼명 / id 불일치)
	 * 2. 부모의 키 컬럼 데이터 타입과 일치하지 않는 경우
	 * 3. 부모의 키 컬럼이 다수일 때, 자식에게서 일부는 키, 일부는 일반 컬럼일 경우
	 */
	private async detectWrongRelationship( tabContent2: Sel<HTMLDivElement>): Promise<void> {
		const tabView2 = tabContent2.append("div").attr("id", "editorDDL").attr("class", "tab-logger").node()!;
		const table2 = diagramUtil.createHTMLElement(tabView2, "table");
		diagramUtil.addTableRow(table2, "th", ["Parent Table", "Parent Columns", "Child Table", "Description"], ["200px", "200px", "200px", "300px"]);
		this.tableTbody2 = diagramUtil.createHTMLElement(table2, "tbody");

		const yieldToUI = createYielder();
		for (const valueP of entityMap.values()) {  // 전체 테이블
			if (!valueP.data.allFields || valueP.data.keys.length===0 || valueP.myChildList.size===0) continue;
			await yieldToUI();

			for (const relationData of valueP.myChildList) {  						// 한 부모 테이블의 자식들
				const childEntity = relationData.childEntity;
				const addRow = (description: string) => diagramUtil.addTableRow(this.tableTbody2, "td",
					[valueP.data.physicalName, this._getFieldNames(valueP.data.keys), childEntity.data.physicalName, description]);

				for (const keyFld of valueP.data.keys) {  							// 한 부모 테이블의 pk 컬럼 리스트
					// 관계 생성에 사용되는 컬럼
					let childField = childEntity.data.allFields.find(field => field.parentID === keyFld.id);
					if (!childField) { 								// 1. 부모의 키가 자식에게 없는 경우 (컬럼명 / id 불일치)
						// 이름으로 한번더 검사
						childField = childEntity.data.allFields.find(field => field.column === keyFld.column);
						addRow(childField ? "The column is not linked to the parent key." : "No child column");
						break;
					} else
					if (childField.dataType !== keyFld.dataType) { 	// 2. 부모의 키 컬럼 데이터 타입과 일치하지 않는 경우
						addRow("No Match data type");
						break;
					}
				}
			}
		}
	}

	/** "컬럼 : 타입"을 한 줄씩 표시 */
	private _getFieldNames(val: FieldData[]): DocumentFragment {
		const fragment = document.createDocumentFragment();
		val.forEach(fld => {
			fragment.append(`${fld.column} : ${fld.dataType}`, document.createElement("br"));
		});
		return fragment;
	}

	private _matchDataTypeClick (): void {
		const display = this.matchDataType.property("checked") ? "none" : "";
		this.tableTbody1.querySelectorAll<HTMLElement>('tr[data-data-type="d"]').forEach(function(row) {
			  row.style.display = display;
	  	});
	}
	private _reverseKeyField(row: HTMLTableRowElement): void {
		const value = row.dataset.pid;
		row.dataset.pid = row.dataset.cid;
		row.dataset.cid = value;
		diagramUtil.changeValue(row.cells[0], row.cells[3]);
		diagramUtil.changeValue(row.cells[1], row.cells[4]);
	}
}

/* -----------------------------------------------------------------------------------
 * Make ERD with AI
 */
export function openMakeERDwithAI(): void {
	if (getAISettings()) new MakeERDwithAIDialog9();
	else new AISettingsDialog9(() => new MakeERDwithAIDialog9());
}

class MakeERDwithAIDialog9 extends PopupDialog9 {
	private userMsg: Sel<HTMLTextAreaElement>;
	private editor: Sel<HTMLDivElement>;
	private erdData: AIERDData | null = null;

	constructor() {
		super();
		const settings = getAISettings()!;
		const dialogContent = this.setDialog("Make ERD with AI", "wide");
		dialogContent.append("p").attr("class", "erd9Dialog-explain")
			.text(`Enter the business or domain you want to create an ERD for, then click the 'Send' button. (${settings.model})`);
		this.userMsg = dialogContent.append("textarea").attr("placeholder", "Type your message...").attr("class", "inputQuestion");
		dialogContent.append("button").text("Send").attr("title", "Send Message").attr("class", "sendMessage").on("click", this.ev_sendMessage.bind(this));

		this.editor = dialogContent.append("div").attr("id", "editorDDL").attr("class", "chatGPT-logger tab-logger");

		this.setToolbar(dialogContent, "Make ERD");
	}

	private async ev_sendMessage(): Promise<void> {
		const userInput: string = this.userMsg.property('value');
		if (! userInput.trim()) {
			alert("Enter your message.");
			return;
		}
		this.erdData = null;
		this.editor.html("");
		try {
			this.erdData = await requestERDFromAI(getAISettings()!, userInput);
			showERDFromAI(this.editor.node()!, this.erdData);
		} catch (error) {
			this.editor.text(error instanceof Error ? error.message : String(error));
		}
	}

	override closeWithOK (): void {	// make ERD
		if (!this.erdData) return;
		state.diagramStack.saveState(STATE_TYPE.MULTY_CREATE, makeERDFromAI(this.erdData));
		this.close();
	}
}

/* -----------------------------------------------------------------------------------
 * Views & Sequences
 */
export class ViewsSequencesDialog9 extends TabPopupDialog9 {
	private views: ViewObject[] = diagramUtil.deepCopy(docObjects.views);
	private sequences: SequenceObject[] = diagramUtil.deepCopy(docObjects.sequences);
	private selectedView: string | null = null;
	private selectedSequence: string | null = null;

	constructor() {
		super();
		const dialogContent = this.setDialog("Views & Sequences", "wide");
		// 탭 메뉴가 오른쪽 위에 표시되므로 설명은 왼쪽에만
		dialogContent.append("p").attr("class", "erd9Dialog-explain").style("max-width", "520px")
			.html("Views and sequences are not drawn in the diagram.<br/>They are saved with the document and included in the generated DDL (All entities) and the ALTER script.");
		this.setTabMenu(dialogContent, ["Views", "Sequences"]);

		// views
		const tab1 = dialogContent.append("div").attr("class", "tab1 tab-content active objectEditor");
		tab1.append("ul").attr("class", "objectList viewList").on("click", (event: MouseEvent) => this.selectView(event));
		const viewForm = tab1.append("div").attr("class", "objectForm");
		viewForm.html("<div class='inputRow'><span class='inputLabel'>Name</span><input type='text' id='viewName' maxlength='100'/></div>" +
					  "<div class='inputRow'><span class='inputLabel'>Comment</span><input type='text' id='viewComment' maxlength='200'/></div>" +
					  "<div>Query (SELECT ...)</div><textarea id='viewQuery' rows='12'></textarea>");
		this.addFormButtons(viewForm, () => this.newView(), () => this.applyView(), () => this.deleteView());

		// sequences
		const tab2 = dialogContent.append("div").attr("class", "tab2 tab-content objectEditor");
		tab2.append("ul").attr("class", "objectList sequenceList").on("click", (event: MouseEvent) => this.selectSequence(event));
		const sequenceForm = tab2.append("div").attr("class", "objectForm");
		sequenceForm.html("<div class='inputRow'><span class='inputLabel'>Name</span><input type='text' id='seqName' maxlength='100'/></div>" +
						  "<div class='inputRow'><span class='inputLabel'>Start with</span><input type='number' id='seqStart'/></div>" +
						  "<div class='inputRow'><span class='inputLabel'>Increment by</span><input type='number' id='seqIncrement'/></div>" +
						  "<div class='inputRow'><span class='inputLabel'>Min value</span><input type='number' id='seqMin'/></div>" +
						  "<div class='inputRow'><span class='inputLabel'>Max value</span><input type='number' id='seqMax'/></div>" +
						  "<div class='inputRow'><label><input type='checkbox' id='seqCycle'/> Cycle</label></div>");
		this.addFormButtons(sequenceForm, () => this.newSequence(), () => this.applySequence(), () => this.deleteSequence());

		this.setToolbar(dialogContent, "Save");
		this.renderLists();
	}

	private addFormButtons(form: Sel<HTMLDivElement>, onNew: () => void, onApply: () => void, onDelete: () => void): void {
		const bar = form.append("div").attr("class", "objectButtons");
		bar.append("button").text("New").on("click", onNew);
		bar.append("button").text("Apply").on("click", onApply);
		bar.append("button").text("Delete").on("click", onDelete);
	}

	private input(id: string): HTMLInputElement {
		return this.dialogContent.querySelector<HTMLInputElement>("#" + id)!;
	}

	private renderLists(): void {
		const render = <T extends { id: string; name: string }>(selector: string, list: T[], selected: string | null) => {
			const ul = select(this.dialogContent).select(selector);
			ul.selectAll("li").remove();
			for (const item of [...list].sort((a, b) => a.name.localeCompare(b.name))) {
				ul.append("li").attr("data-id", item.id).classed("selected", item.id === selected).text(item.name);
			}
		};
		render(".viewList", this.views, this.selectedView);
		render(".sequenceList", this.sequences, this.selectedSequence);
	}

	/* views */
	private selectView(event: MouseEvent): void {
		const id = (event.target as HTMLElement).closest("li")?.getAttribute("data-id");
		const view = this.views.find(v => v.id === id);
		if (!view) return;
		this.selectedView = view.id;
		this.input("viewName").value = view.name;
		this.input("viewComment").value = view.comment ?? "";
		this.dialogContent.querySelector<HTMLTextAreaElement>("#viewQuery")!.value = view.query;
		this.renderLists();
	}
	private newView(): void {
		this.selectedView = null;
		this.input("viewName").value = "";
		this.input("viewComment").value = "";
		this.dialogContent.querySelector<HTMLTextAreaElement>("#viewQuery")!.value = "";
		this.renderLists();
		this.input("viewName").focus();
	}
	private applyView(): void {
		const name = this.input("viewName").value.trim();
		const query = this.dialogContent.querySelector<HTMLTextAreaElement>("#viewQuery")!.value.trim();
		if (!name || !query) {
			alert("Enter the name and the query of the view.");
			return;
		}
		if (this.views.some(v => v.id !== this.selectedView && v.name.toUpperCase() === name.toUpperCase())) {
			alert("There is a view with the same name: " + name);
			return;
		}
		const view: ViewObject = { id: this.selectedView ?? "v" + diagramUtil.getUniqueID(), name, comment: this.input("viewComment").value.trim() || undefined, query };
		this.views = this.views.filter(v => v.id !== view.id).concat(view);
		this.selectedView = view.id;
		this.renderLists();
	}
	private deleteView(): void {
		if (!this.selectedView || !confirm("Do you want to delete the selected view?")) return;
		this.views = this.views.filter(v => v.id !== this.selectedView);
		this.newView();
	}

	/* sequences */
	private selectSequence(event: MouseEvent): void {
		const id = (event.target as HTMLElement).closest("li")?.getAttribute("data-id");
		const seq = this.sequences.find(s => s.id === id);
		if (!seq) return;
		this.selectedSequence = seq.id;
		this.input("seqName").value = seq.name;
		this.input("seqStart").value = seq.start?.toString() ?? "";
		this.input("seqIncrement").value = seq.increment?.toString() ?? "";
		this.input("seqMin").value = seq.minValue?.toString() ?? "";
		this.input("seqMax").value = seq.maxValue?.toString() ?? "";
		this.input("seqCycle").checked = !!seq.cycle;
		this.renderLists();
	}
	private newSequence(): void {
		this.selectedSequence = null;
		for (const id of ["seqName", "seqStart", "seqIncrement", "seqMin", "seqMax"]) this.input(id).value = "";
		this.input("seqStart").value = "1";
		this.input("seqIncrement").value = "1";
		this.input("seqCycle").checked = false;
		this.renderLists();
		this.input("seqName").focus();
	}
	private applySequence(): void {
		const name = this.input("seqName").value.trim();
		if (!name) {
			alert("Enter the name of the sequence.");
			return;
		}
		if (this.sequences.some(s => s.id !== this.selectedSequence && s.name.toUpperCase() === name.toUpperCase())) {
			alert("There is a sequence with the same name: " + name);
			return;
		}
		const num = (id: string) => {
			const value = this.input(id).value.trim();
			return value === "" || !Number.isFinite(Number(value)) ? undefined : Math.trunc(Number(value));
		};
		const seq: SequenceObject = {
			id: this.selectedSequence ?? "s" + diagramUtil.getUniqueID(),
			name,
			start: num("seqStart"),
			increment: num("seqIncrement"),
			minValue: num("seqMin"),
			maxValue: num("seqMax"),
			cycle: this.input("seqCycle").checked || undefined,
		};
		this.sequences = this.sequences.filter(s => s.id !== seq.id).concat(seq);
		this.selectedSequence = seq.id;
		this.renderLists();
	}
	private deleteSequence(): void {
		if (!this.selectedSequence || !confirm("Do you want to delete the selected sequence?")) return;
		this.sequences = this.sequences.filter(s => s.id !== this.selectedSequence);
		this.newSequence();
	}

	override closeWithOK (): void {
		const changed = JSON.stringify(docObjects.views) !== JSON.stringify(this.views) || JSON.stringify(docObjects.sequences) !== JSON.stringify(this.sequences);
		docObjects.views = this.views;
		docObjects.sequences = this.sequences;
		if (changed) state.diagramStack.markModified();
		this.close();
	}
}

/* -----------------------------------------------------------------------------------
 * Column Templates
 */
export class ColumnTemplatesDialog9 extends PopupDialog9 {
	private templates: ColumnTemplate[] = getTemplates();
	private current = -1;
	private templateSelect: Sel<HTMLSelectElement>;
	private nameInput: Sel<HTMLInputElement>;
	private tableGrid9: TableGrid9;

	constructor() {
		super();
		const dialogContent = this.setDialog("Column Templates", "wide");
		dialogContent.append("p").attr("class", "erd9Dialog-explain")
			.html("Groups of common columns (created at, created by, ...) that you can add to an entity at once.<br/>Use them with '+ Template columns' in the Entity dialog. Templates are stored in this web browser.");

		const bar = dialogContent.append("div").attr("class", "inputRow");
		bar.append("span").attr("class", "inputLabel").text("Template");
		this.templateSelect = bar.append("select").attr("class", "width150").on("change", () => this.switchTemplate(Number(this.templateSelect.property("value"))));
		bar.append("button").text("New").on("click", () => this.newTemplate());
		bar.append("button").text("Delete").on("click", () => this.deleteTemplate());

		const nameRow = dialogContent.append("div").attr("class", "inputRow");
		nameRow.append("span").attr("class", "inputLabel").text("Name");
		this.nameInput = nameRow.append("input").attr("type", "text").attr("maxlength", "50");

		const grid = dialogContent.append("div").attr("class", "erd9Dialog-grid1 erd9Dialog-grid");
		const tbody = diagramUtil.createTable(grid.node()!, "tablegrid-tbody");
		this.tableGrid9 = new TableGrid9(select(tbody), null, state.dbmsType);

		const toolbar = dialogContent.append("div").attr("class", "erd9Dialog_toolbar1");
		const left = toolbar.append("div").attr("class", "erd9Dialog_toolbar_left");
		const MENU_BUTTONS = [{text:"↑", hint:"Move Up"}, {text:"↓", hint:"Move Down"}, {text:"+", hint:"Add Column"}, {text:"-", hint:"Remove Column"}];
		left.selectAll("button").data(MENU_BUTTONS).enter().append("button")
			.text(d => d.text).attr("title", d => d.hint)
			.on("click", this.tableGrid9.rowActionHandle.bind(this.tableGrid9));
		const right = toolbar.append("div").attr("class", "erd9Dialog_toolbar_right");
		right.append("button").text("Save").on("click", () => this.closeWithOK());
		this.setCloseButton(right);

		this.renderSelect();
		this.switchTemplate(this.templates.length > 0 ? 0 : -1);
		this.setDialogPosition();
	}

	private renderSelect(): void {
		this.templateSelect.selectAll("option").remove();
		this.templates.forEach((template, inx) => this.templateSelect.append("option").attr("value", inx).text(template.name));
		this.templateSelect.property("value", String(this.current));
	}

	/** 편집 중인 내용을 목록에 반영 */
	private storeCurrent(): void {
		const template = this.templates[this.current];
		if (!template) return;
		state.nameEditor.endEditMode();
		const data = this.tableGrid9.getTableData();
		template.name = this.nameInput.property("value").trim() || template.name;
		template.dbms = state.dbmsType;
		template.columns = data.keys.concat(data.fields).map(({ column, comment, dataType, defaultValue, notNull, uniqueKey, ai }) =>
			({ column, comment: comment || undefined, dataType, defaultValue: defaultValue === "" ? undefined : defaultValue, notNull, uniqueKey, ai }));
	}

	private switchTemplate(inx: number): void {
		this.storeCurrent();
		this.current = inx;
		const template = this.templates[inx];
		this.nameInput.property("value", template?.name ?? "");
		const columns: FieldData[] = (template?.columns ?? []).map(column => ({ ...column, id: "f" + diagramUtil.getUniqueID() }));
		this.tableGrid9.setTableData({ physicalName: "", keys: [], fields: columns }, state.dbmsType);
		this.renderSelect();
	}

	private newTemplate(): void {
		this.storeCurrent();
		this.templates.push({ name: "New template", dbms: state.dbmsType, columns: [] });
		this.current = -1;
		this.switchTemplate(this.templates.length - 1);
		this.nameInput.node()!.select();
	}

	private deleteTemplate(): void {
		if (this.current < 0 || !confirm("Do you want to delete the selected template?")) return;
		this.templates.splice(this.current, 1);
		this.current = -1;
		this.switchTemplate(this.templates.length > 0 ? 0 : -1);
	}

	override closeWithOK (): void {
		this.storeCurrent();
		saveTemplates(this.templates.filter(t => t.name && t.columns.length > 0));
		this.close();
	}
}
