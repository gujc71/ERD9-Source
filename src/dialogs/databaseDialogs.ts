/**
 * 데이터베이스 메뉴 (실행 파일에서만 사용)
 *  - Forward engineering: ERD로 DB 서버에 테이블 생성
 *  - Reverse engineering: DB 서버의 테이블로 ERD 생성
 *  - Compare and Merge: ERD와 DB를 비교해서 항목마다 원하는 방향으로 반영
 */
import { select } from "d3-selection";
import { DBMS_TYPE } from "../constants";
import type { DbmsType } from "../constants";
import { DbSession, DEFAULT_PORTS, loadConnectionConfig, saveConnectionConfig, withSession } from "../database/connection";
import type { ConnectionConfig } from "../database/connection";
import { readSchema } from "../database/schemaReader";
import type { DbSchema } from "../database/schemaReader";
import { buildDBTarget, canonicalize, compareForSync, mergeIntoModel, schemaToERDData } from "../database/sync";
import type { SyncDirection, SyncItem } from "../database/sync";
import { Entity9 } from "../diagram/Entity9";
import { getDocumentRef, makeERDData, newDocument, openERDData, setDBMS, setDocumentRef } from "../erdManager";
import { diffERD, isEmptyDiff, makeAlterScript } from "../sql/ERDDiff";
import { sqlMakerManager } from "../sql/SQLMaker";
import { splitStatements } from "../sql/Sql2Json";
import { docObjects, entityMap, relationMap, state } from "../state";
import type { ERDFileData, Sel } from "../types";
import { PopupDialog9 } from "./PopupDialog9";

const DBMS_NAMES: Record<DbmsType, string> = { mariadb: "MariaDB / MySQL", oracle: "Oracle", mssql: "MS-SQL", postgresql: "PostgreSQL" };
const SCHEMA_HINTS: Record<DbmsType, string> = { mariadb: "default: database", oracle: "default: user", mssql: "default: dbo", postgresql: "default: public" };

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

/** DROP 구문 (외래키 삭제 ALTER TABLE ... DROP CONSTRAINT / DROP FOREIGN KEY 포함) */
const isDropStatement = (sql: string) =>
	/^\s*DROP\s/i.test(sql) || /^\s*ALTER\s+TABLE\s+.+?\s+DROP\s+(CONSTRAINT|FOREIGN\s+KEY)\s/is.test(sql);

/* -----------------------------------------------------------------------------------
 * 연결 설정 입력
 */
class ConnectionForm {
	private inputs: Record<string, Sel<HTMLInputElement>> = {};
	private dbmsSelect: Sel<HTMLSelectElement>;
	private databaseLabel: Sel<HTMLLabelElement>;
	private trustCertRow: Sel<HTMLLabelElement>;

	constructor(parent: Sel<HTMLDivElement>) {
		const config = loadConnectionConfig(state.dbmsType);
		const form = parent.append("div").attr("class", "dbConnection");

		form.append("label").text("DBMS");
		this.dbmsSelect = form.append("select");
		for (const dbms of Object.values(DBMS_TYPE)) this.dbmsSelect.append("option").attr("value", dbms).text(DBMS_NAMES[dbms]);
		this.dbmsSelect.property("value", config.dbms).on("change", () => this.onChangeDBMS());

		const input = (name: keyof ConnectionConfig, label: string, type = "text") => {
			const labelElement = form.append("label").text(label);
			this.inputs[name] = form.append("input").attr("type", type).attr("autocomplete", "off").property("value", String(config[name] ?? ""));
			return labelElement;
		};
		input("host", "Host");
		input("port", "Port", "number");
		this.databaseLabel = input("database", "Database");
		input("schema", "Schema");
		input("user", "User");
		input("password", "Password", "password");

		this.trustCertRow = form.append("label").attr("class", "dbConnection-wide")
			.html("<input type='checkbox' name='trustCert'> Trust the server certificate (self-signed)");
		this.trustCertRow.select("input").property("checked", config.trustCert);

		this.updateLabels(config.dbms);
	}

	get dbms(): DbmsType {
		return this.dbmsSelect.property("value") as DbmsType;
	}

	private onChangeDBMS(): void {
		// 포트가 다른 DBMS의 기본값이면 새 DBMS의 기본값으로
		const port = Number(this.inputs.port.property("value"));
		if (!port || Object.values(DEFAULT_PORTS).includes(port)) this.inputs.port.property("value", DEFAULT_PORTS[this.dbms]);
		this.updateLabels(this.dbms);
	}

	private updateLabels(dbms: DbmsType): void {
		this.databaseLabel.text(dbms === "oracle" ? "Service name" : "Database");
		this.inputs.schema.attr("placeholder", SCHEMA_HINTS[dbms]);
		this.trustCertRow.style("display", dbms === "mssql" ? "" : "none");
	}

	/** 입력이 올바르지 않으면 알리고 null */
	getConfig(): ConnectionConfig | null {
		const value = (name: string) => String(this.inputs[name].property("value")).trim();
		const config: ConnectionConfig = {
			dbms: this.dbms,
			host: value("host"),
			port: Number(value("port")),
			user: value("user"),
			password: String(this.inputs.password.property("value")),
			database: value("database"),
			schema: value("schema"),
			trustCert: !!this.trustCertRow.select("input").property("checked"),
		};
		if (!config.host || !config.user) { alert("Enter the host and the user."); return null; }
		if (!Number.isInteger(config.port) || config.port <= 0 || config.port > 65535) { alert("Enter a valid port."); return null; }
		if (config.dbms === "oracle" && !config.database) { alert("Enter the service name."); return null; }
		saveConnectionConfig(config);
		return config;
	}

	async test(): Promise<void> {
		const config = this.getConfig();
		if (!config) return;
		try {
			await withSession(config, session => session.query(config.dbms === "oracle" ? "SELECT 1 FROM DUAL" : "SELECT 1"));
			alert("Connected successfully.");
		} catch (error) {
			alert("Connection failed.\n" + errorMessage(error));
		}
	}
}

/** 연결 설정 + 실행 로그가 있는 다이얼로그 */
abstract class DatabaseDialog9 extends PopupDialog9 {
	protected connection!: ConnectionForm;
	protected logDiv!: HTMLDivElement;
	private busy = false;

	protected setDatabaseDialog(title: string, explain: string): Sel<HTMLDivElement> {
		const dialogContent = this.setDialog(title, "dbDialog");
		dialogContent.append("p").attr("class", "erd9Dialog-explain").html(explain);
		this.connection = new ConnectionForm(dialogContent);
		return dialogContent;
	}

	protected setLog(parent: Sel<HTMLDivElement>): void {
		this.logDiv = parent.append("div").attr("class", "tab-logger dbLog").node()!;
	}

	protected log(message: string, cssClass = ""): void {
		const line = select(this.logDiv).append("span").attr("class", "log-span " + cssClass).text(message);
		line.node()!.scrollIntoView({ block: "nearest" });
	}

	protected clearLog(): void {
		this.logDiv.innerHTML = "";
	}

	/** 작업 중에는 다른 작업을 시작하지 않는다 */
	protected async run(work: () => Promise<void>): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		select(this.dialogContent).classed("dbBusy", true);
		try {
			await work();
		} catch (error) {
			this.log(errorMessage(error), "log-error");
		} finally {
			this.busy = false;
			select(this.dialogContent).classed("dbBusy", false);
		}
	}

	/** 연결 설정의 DBMS가 문서의 DBMS와 다르면 확인 */
	protected confirmDBMS(config: ConnectionConfig): boolean {
		if (config.dbms === state.dbmsType) return true;
		return confirm(`The document is for ${DBMS_NAMES[state.dbmsType]}, but the connection is ${DBMS_NAMES[config.dbms]}.\nData type names may not be valid. Continue?`);
	}

	/** SQL 구문을 하나씩 실행한다. DROP 구문의 오류는 무시. 반환: 오류 수 */
	protected async executeScript(session: DbSession, script: string, stopOnError: boolean): Promise<number> {
		const statements = splitStatements(script);
		let errors = 0, done = 0;
		for (const sql of statements) {
			const summary = sql.replace(/\s+/g, " ").slice(0, 120);
			try {
				await session.execute(sql);
				done++;
				this.log("OK     " + summary, "log-ok");
			} catch (error) {
				if (isDropStatement(sql)) {
					this.log(`SKIP   ${summary}  (${errorMessage(error)})`);
					continue;
				}
				errors++;
				this.log(`ERROR  ${summary}\n       ${errorMessage(error)}`, "log-error");
				if (stopOnError) {
					this.log("Stopped because of the error.", "log-error");
					break;
				}
			}
		}
		this.log(`Executed ${done} of ${statements.length} statements` + (errors ? `, ${errors} error(s).` : "."));
		return errors;
	}

	protected checkbox(parent: Sel<HTMLDivElement>, label: string, checked: boolean): Sel<HTMLInputElement> {
		const element = parent.append("label");
		const input = element.append("input").attr("type", "checkbox").property("checked", checked);
		element.append("span").text(" " + label);
		return input;
	}
}

/* -----------------------------------------------------------------------------------
 * Forward engineering
 */
export class ForwardEngineeringDialog9 extends DatabaseDialog9 {
	private script: Sel<HTMLTextAreaElement>;
	private dropFirst: Sel<HTMLInputElement>;
	private stopOnError: Sel<HTMLInputElement>;

	constructor() {
		super();
		const dialogContent = this.setDatabaseDialog("Forward Engineering",
			"Creates the tables, relationships, indexes, views and sequences of the ERD on the database server.<br/>Generate the script, review or edit it, then execute it.");

		const options = dialogContent.append("div").attr("class", "exportBar");
		options.append("label").html("<input type='radio' name='forwardScope' value='all' checked> All tables");
		options.append("label").html("<input type='radio' name='forwardScope' value='selected'> Selected tables");
		options.selectAll("input[name='forwardScope']").on("change", () => this.generate());
		this.dropFirst = this.checkbox(options, "Drop existing objects first", false);
		this.dropFirst.on("change", () => this.generate());
		this.stopOnError = this.checkbox(options, "Stop on error", true);
		options.append("button").text("Generate script").on("click", () => this.generate());

		this.script = dialogContent.append("textarea").attr("class", "dbScript").attr("spellcheck", "false");
		this.setLog(dialogContent);

		const toolbar = this.setToolbar(dialogContent);
		toolbar.insert("button", ":first-child").text("Execute").on("click", () => this.run(() => this.execute()));
		toolbar.insert("button", ":first-child").text("Test connection").on("click", () => this.connection.test());

		this.generate();
	}

	private generate(): void {
		const maker = sqlMakerManager.getMaker(this.connection.dbms);
		const all = this.dialogContent.querySelector<HTMLInputElement>("input[name='forwardScope']:checked")!.value === "all";
		const selected = state.selectMgr.getSelectList().filter((d): d is Entity9 => d instanceof Entity9);
		if (!all && selected.length === 0) {
			alert("Select the tables to create.");
			return;
		}
		const tables = all ? [...entityMap.values()] : selected;
		const relations = all ? [...relationMap.values()] : sqlMakerManager.getUsedRelationList(selected);
		const objects = all ? docObjects : undefined;

		let script = "";
		if (this.dropFirst.property("checked")) {
			// 없는 객체를 지우는 오류는 무시한다
			const drops: string[] = [];
			for (const view of objects?.views ?? []) drops.push(maker.dropView(view.name));
			for (const relation of relations) drops.push(maker.dropForeignKey(relation.childEntity.data.physicalName, relation.name || relation.id));
			for (const table of tables) drops.push(maker.dropTable(table.data.physicalName));
			for (const seq of objects?.sequences ?? []) drops.push(maker.dropSequence(seq.name));
			script += "-- Drop existing objects (errors are ignored)\n" + drops.join("") + "\n";
		}
		script += maker.getAllSQL(tables, relations, objects);
		this.script.property("value", script);
	}

	private async execute(): Promise<void> {
		const config = this.connection.getConfig();
		const script = String(this.script.property("value"));
		if (!config || !script.trim()) return;
		if (!this.confirmDBMS(config)) return;
		const count = splitStatements(script).length;
		if (!confirm(`Execute ${count} statements on ${config.host}${config.database ? "/" + config.database : ""}?`)) return;

		this.clearLog();
		this.log(`Connecting to ${config.host}:${config.port} ...`);
		await withSession(config, session => this.executeScript(session, script, !!this.stopOnError.property("checked")));
	}
}

/* -----------------------------------------------------------------------------------
 * Reverse engineering
 */
export class ReverseEngineeringDialog9 extends DatabaseDialog9 {
	private schema: DbSchema | null = null;
	private tableList: Sel<HTMLDivElement>;
	private includeObjects: Sel<HTMLInputElement>;

	constructor() {
		super();
		const dialogContent = this.setDatabaseDialog("Reverse Engineering",
			"Reads the tables, relationships, indexes, views and sequences from the database server and builds the ERD.");

		const options = dialogContent.append("div").attr("class", "exportBar");
		options.append("button").text("Read schema").on("click", () => this.run(() => this.readSchema()));
		this.includeObjects = this.checkbox(options, "Include views and sequences", true);
		options.append("label").html("<input type='radio' name='reverseTarget' value='add' checked> Add to the current document");
		options.append("label").html("<input type='radio' name='reverseTarget' value='new'> New document");

		this.tableList = dialogContent.append("div").attr("class", "tab-logger dbTableList");
		this.setLog(dialogContent);

		const toolbar = this.setToolbar(dialogContent);
		toolbar.insert("button", ":first-child").text("Import").on("click", () => this.run(() => this.import()));
		toolbar.insert("button", ":first-child").text("Test connection").on("click", () => this.connection.test());
	}

	private async readSchema(): Promise<void> {
		const config = this.connection.getConfig();
		if (!config) return;
		this.clearLog();
		this.tableList.html("");
		this.log(`Reading the schema from ${config.host}:${config.port} ...`);
		const schema = this.schema = await withSession(config, session => readSchema(session, message => this.log(message)));
		this.log(`Tables: ${schema.tables.length}, relationships: ${schema.relations.length}, views: ${schema.views.length}, sequences: ${schema.sequences.length}`);

		const existing = new Set([...entityMap.values()].map(e => e.data.physicalName.toUpperCase()));
		const table = this.tableList.append("table");
		const header = table.append("tr");
		header.append("th").append("input").attr("type", "checkbox").property("checked", true)
			.on("change", function() { table.selectAll<HTMLInputElement, unknown>("td input").property("checked", this.checked); });
		for (const title of ["Table", "Entity Name", "Columns", ""]) header.append("th").text(title);
		for (const t of schema.tables) {
			const exists = existing.has(t.physicalName.toUpperCase());
			const row = table.append("tr");
			row.append("td").append("input").attr("type", "checkbox").attr("value", t.physicalName).property("checked", !exists);
			row.append("td").text(t.physicalName);
			row.append("td").text(t.logicalName ?? "");
			row.append("td").text(t.columns.length);
			row.append("td").text(exists ? "already in the ERD" : "");
		}
	}

	private async import(): Promise<void> {
		const schema = this.schema;
		if (!schema) { alert("Read the schema first."); return; }
		const selected = new Set([...this.tableList.node()!.querySelectorAll<HTMLInputElement>("td input:checked")].map(input => input.value));
		const tables = schema.tables.filter(t => selected.has(t.physicalName));
		if (tables.length === 0) { alert("Select the tables to import."); return; }

		const newDoc = this.dialogContent.querySelector<HTMLInputElement>("input[name='reverseTarget']:checked")!.value === "new";
		if (newDoc && !newDocument()) return;
		setDBMS(schema.dbms);

		const relations = schema.relations.filter(r => selected.has(r.childTable) && selected.has(r.parentTable));
		const include = !!this.includeObjects.property("checked");
		const { importTablesToERD } = await import("./addonDialogs");
		await importTablesToERD(this.logDiv, tables, relations, include ? schema.views : [], include ? schema.sequences : []);
		this.log(`Imported ${tables.length} tables and ${relations.length} relationships.`, "log-ok");
		alert(`Imported ${tables.length} tables and ${relations.length} relationships.`);
		this.close();
	}
}

/* -----------------------------------------------------------------------------------
 * Compare and Merge
 */
const STATUS_TEXT: Record<SyncItem["status"], string> = { erdOnly: "ERD only", dbOnly: "DB only", different: "Different" };
const DIRECTION_TEXT: Record<SyncItem["status"], Record<Exclude<SyncDirection, "skip">, string>> = {
	erdOnly:   { toDB: "Create in DB", toERD: "Delete from ERD" },
	dbOnly:    { toDB: "Drop from DB", toERD: "Add to ERD" },
	different: { toDB: "ERD → DB", toERD: "DB → ERD" },
};

export class SyncDialog9 extends DatabaseDialog9 {
	private config: ConnectionConfig | null = null;
	private dbData: ERDFileData | null = null;
	private items: SyncItem[] = [];
	private itemTable: Sel<HTMLDivElement>;
	private script: Sel<HTMLTextAreaElement>;
	private stopOnError: Sel<HTMLInputElement>;

	constructor() {
		super();
		const dialogContent = this.setDatabaseDialog("Compare and Merge",
			"Compares the ERD with the database and applies each difference in the direction you choose.<br/>" +
			"ERD → DB runs an ALTER script on the database. DB → ERD updates the ERD. Tables and columns are matched by name.");

		const options = dialogContent.append("div").attr("class", "exportBar");
		options.append("button").text("Compare").on("click", () => this.run(() => this.compare()));
		options.append("button").text("All ERD → DB").on("click", () => this.setAll("toDB"));
		options.append("button").text("All DB → ERD").on("click", () => this.setAll("toERD"));
		options.append("button").text("Skip all").on("click", () => this.setAll("skip"));
		this.stopOnError = this.checkbox(options, "Stop on error", true);

		this.itemTable = dialogContent.append("div").attr("class", "tab-logger dbSyncItems");
		dialogContent.append("h4").attr("class", "dbSubTitle").text("Script to run on the database (ERD → DB)");
		this.script = dialogContent.append("textarea").attr("class", "dbScript small").attr("spellcheck", "false").attr("readonly", true);
		this.setLog(dialogContent);

		const toolbar = this.setToolbar(dialogContent);
		toolbar.insert("button", ":first-child").text("Apply").on("click", () => this.run(() => this.apply()));
		toolbar.insert("button", ":first-child").text("Test connection").on("click", () => this.connection.test());
	}

	/** recheck: 반영한 뒤 다시 비교 (로그를 지우지 않음) */
	private async compare(recheck = false): Promise<void> {
		const config = recheck ? this.config : this.connection.getConfig();
		if (!config) return;
		if (!recheck && !this.confirmDBMS(config)) return;
		this.config = config;
		if (!recheck) this.clearLog();
		this.log(`Reading the schema from ${config.host}:${config.port} ...`);
		const schema = await withSession(config, session => readSchema(session, message => this.log(message)));
		this.dbData = schemaToERDData(schema);
		this.items = compareForSync(this.dbData, canonicalize(makeERDData()));
		this.log(this.items.length ? `${this.items.length} difference(s) found.` : "The ERD and the database are the same.", "log-ok");
		this.renderItems();
	}

	private renderItems(): void {
		this.itemTable.html("");
		if (this.items.length === 0) {
			this.itemTable.append("p").text(this.dbData ? "No differences." : "Press 'Compare' to read the database.");
			this.updateScript();
			return;
		}
		const table = this.itemTable.append("table");
		const header = table.append("tr");
		for (const title of ["Type", "Name", "Status", "Differences (+ ERD only, - DB only, ~ different)", "Apply"]) header.append("th").text(title);
		for (const item of this.items) {
			const row = table.append("tr");
			row.append("td").text(item.kind);
			row.append("td").text(item.name);
			row.append("td").text(STATUS_TEXT[item.status]);
			row.append("td").append("pre").text(item.details.join("\n"));
			const directionSelect = row.append("td").append("select").on("change", (event: Event) => {
				item.direction = (event.target as HTMLSelectElement).value as SyncDirection;
				this.updateScript();
			});
			const labels = DIRECTION_TEXT[item.status];
			directionSelect.append("option").attr("value", "toDB").text(labels.toDB);
			directionSelect.append("option").attr("value", "toERD").text(labels.toERD);
			directionSelect.append("option").attr("value", "skip").text("Skip");
			directionSelect.property("value", item.direction);
		}
		this.updateScript();
	}

	private setAll(direction: SyncDirection): void {
		for (const item of this.items) item.direction = direction;
		this.renderItems();
	}

	/** ERD → DB 항목의 ALTER 스크립트 */
	private makeScript(): string {
		if (!this.dbData || !this.config) return "";
		const target = buildDBTarget(this.dbData, canonicalize(makeERDData()), this.items);
		const diff = diffERD(this.dbData, target);
		return isEmptyDiff(diff) ? "" : makeAlterScript(diff, sqlMakerManager.getMaker(this.config.dbms));
	}

	private updateScript(): void {
		this.script.property("value", this.makeScript());
	}

	private async apply(): Promise<void> {
		const config = this.config;
		if (!this.dbData || !config) { alert("Compare first."); return; }
		const script = this.makeScript();
		const toERD = this.items.filter(i => i.direction === "toERD");
		if (!script.trim() && toERD.length === 0) { alert("There is nothing to apply."); return; }

		const lines: string[] = [];
		if (script.trim()) lines.push(`- Run ${splitStatements(script).length} statements on the database.`);
		if (toERD.length) lines.push(`- Update ${toERD.length} item(s) in the ERD. (The undo history is cleared.)`);
		if (!confirm("Apply the changes?\n\n" + lines.join("\n"))) return;

		this.clearLog();
		if (script.trim()) {
			this.log("Applying the changes to the database ...");
			const errors = await withSession(config, session => this.executeScript(session, script, !!this.stopOnError.property("checked")));
			if (errors > 0 && toERD.length > 0) {
				this.log("The ERD was not changed because the database script failed.", "log-error");
				return;
			}
		}
		if (toERD.length) {
			await this.applyToERD();
		}
		// 남은 차이를 다시 보여준다
		await this.compare(true);
	}

	private async applyToERD(): Promise<void> {
		const { data, warnings } = mergeIntoModel(makeERDData(), this.dbData!, this.items);
		const ref = getDocumentRef();
		if (!await openERDData(data, false)) return;
		setDocumentRef(ref);
		state.diagramStack.markModified();
		for (const warning of warnings) this.log(warning, "log-error");
		this.log("The ERD has been updated.", "log-ok");
	}
}
