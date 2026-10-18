/**
 * ERD 비교: 기준 문서(이전 버전)와 현재 문서를 비교해 변경 내용과 ALTER 스크립트를 보여준다.
 */
import { isDesktopApp } from "../database/connection";
import { downloadFile, getDocumentName, makeERDData } from "../erdManager";
import { diffERD, isEmptyDiff, makeAlterScript, summarizeDiff } from "../sql/ERDDiff";
import { sqlMakerManager } from "../sql/SQLMaker";
import { state } from "../state";
import { chooseOpenPath, fileTitle, readERDFile } from "../storage/desktopFile";
import { withDB } from "../storage/IndexedDBManager";
import { validateERDFile } from "../storage/validateERDFile";
import type { ERDFileData, Sel } from "../types";
import { getDateText } from "../ui";
import { copyToClipboard } from "../util/clipboard";
import { readJSONFile } from "./fileDialogs";
import { PopupDialog9 } from "./PopupDialog9";

export interface CompareBase {
	data: unknown;
	label: string;
}

export class CompareERDDialog9 extends PopupDialog9 {
	private sourceBar: Sel<HTMLDivElement>;
	private fileSelect: Sel<HTMLSelectElement>;
	private fileInput: Sel<HTMLInputElement>;
	/** 실행 파일: 비교할 .erd9 파일 (기본: 현재 문서의 파일) */
	private erd9Path: string | null = state.savedFilePath;
	private baseLabel: Sel<HTMLParagraphElement>;
	private summary: Sel<HTMLPreElement>;
	private script: Sel<HTMLPreElement>;

	constructor(base?: CompareBase) {
		super();
		const dialogContent = this.setDialog("Compare ERD / ALTER Script", "wide");

		dialogContent.append("p").attr("class", "erd9Dialog-explain")
			.html("Compares a base version with the current document.<br/>The ALTER script changes a database built from the base version into the current document. Review it before running.");

		// 기준 문서 선택
		this.sourceBar = dialogContent.append("div").attr("class", "exportBar");
		const desktop = isDesktopApp();
		// 실행 파일은 브라우저에 저장한 파일 대신 .erd9 파일
		this.sourceBar.append("label").html(`<input type='radio' name='compareSource' value='saved' checked> ${desktop ? "ERD9 file" : "Saved file"}</label>`);
		this.fileSelect = this.sourceBar.append("select").attr("class", "width150");
		if (desktop) this.fileSelect.style("display", "none");
		if (desktop) {
			const fileName = this.sourceBar.append("span").attr("class", "compareFileName").text(this.erd9Path ? fileTitle(this.erd9Path) : "(none)").attr("title", this.erd9Path);
			this.sourceBar.append("button").text("Choose...").on("click", async () => {
				const path = await chooseOpenPath();
				if (!path) return;
				this.erd9Path = path;
				fileName.text(fileTitle(path)).attr("title", path);
				this.dialogContent.querySelector<HTMLInputElement>("input[name='compareSource'][value='saved']")!.checked = true;
			});
		}
		this.sourceBar.append("label").html("<input type='radio' name='compareSource' value='json'> JSON file</label>");
		this.fileInput = this.sourceBar.append("input").attr("type", "file").attr("accept", ".json,.erd9,application/json");
		this.sourceBar.append("button").text("Compare").on("click", () => this.compareWithSource());
		if (base) this.sourceBar.style("display", "none");

		this.baseLabel = dialogContent.append("p").attr("class", "compareBase");

		const result = dialogContent.append("div").attr("class", "compareResult");
		const left = result.append("div");
		left.append("h4").text("Changes");
		this.summary = left.append("pre").attr("class", "tab-logger compareSummary");
		const right = result.append("div");
		right.append("h4").text(`ALTER script (${state.dbmsType})`);
		this.script = right.append("pre").attr("class", "tab-logger compareScript");

		const toolbar = this.setToolbar(dialogContent);
		toolbar.insert("button", ":first-child").text("Download .sql").on("click", () => {
			if (this.script.text()) downloadFile(getDocumentName() + "_alter.sql", this.script.text(), "text/plain");
		});
		toolbar.insert("button", ":first-child").text("Copy script").on("click", () => {
			if (!this.script.text()) return;
			copyToClipboard(this.script.text());
			alert("The ALTER script has been copied to the clipboard.");
		});

		if (base) {
			this.compare(base.data, base.label);
		} else if (!desktop) {
			this.loadSavedFiles();
		}
	}

	private async loadSavedFiles(): Promise<void> {
		const today = new Date();
		const files = await withDB(db => db.getAllSortedByUpdateDate());
		this.fileSelect.selectAll("option")
			.data((files ?? []).reverse())
			.enter()
			.append("option")
			.attr("value", d => d.fileId)
			.text(d => `${d.fileName ?? ""} (${getDateText(today, d.updateDate)})`);
		// 현재 문서가 저장된 파일이면 그 파일을 기본으로 (저장 후 수정한 내용 비교)
		if (state.savedFileID) this.fileSelect.property("value", String(state.savedFileID));
	}

	private async compareWithSource(): Promise<void> {
		const source = this.dialogContent.querySelector<HTMLInputElement>("input[name='compareSource']:checked")!.value;
		if (source === "json") {
			const file = this.fileInput.node()!.files?.[0];
			if (!file) { alert("Select the JSON file to compare."); return; }
			const data = await readJSONFile(file);
			if (data !== undefined) this.compare(data, `JSON file: ${file.name}`);
			return;
		}
		if (isDesktopApp()) {
			if (!this.erd9Path) { alert("Choose the .erd9 file to compare."); return; }
			try {
				this.compare(await readERDFile(this.erd9Path), `ERD9 file: ${this.erd9Path}`);
			} catch (error) {
				alert(error instanceof Error ? error.message : String(error));
			}
			return;
		}
		const fileId = Number(this.fileSelect.property("value"));
		if (!fileId) { alert("There is no saved file to compare."); return; }
		const stored = await withDB(db => db.get(fileId));
		if (stored?.data) this.compare(stored.data, `Saved file: ${stored.fileName ?? ""}`);
	}

	private compare(baseData: unknown, label: string): void {
		let base: ERDFileData;
		try {
			base = validateERDFile(baseData);
		} catch (error) {
			alert(error instanceof Error ? error.message : String(error));
			return;
		}
		this.baseLabel.text(`Base: ${label}` + (base.dbms !== state.dbmsType ? `  (the base was made for ${base.dbms}; data type names may differ)` : ""));

		const diff = diffERD(base, makeERDData());
		if (isEmptyDiff(diff)) {
			this.summary.text("No differences.");
			this.script.text("");
			return;
		}
		this.summary.text(summarizeDiff(diff).join("\n"));
		this.script.text(makeAlterScript(diff, sqlMakerManager.getMaker()));
	}
}
