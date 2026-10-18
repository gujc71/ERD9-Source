import { downloadFile, getDocumentName, getDocumentRef, getFileName, openERDData, setDocumentRef, setFileName } from "../erdManager";
import { buildExportSVG, serializeSVG, svgToPNG } from "../export/imageExport";
import { state } from "../state";
import { restoreAutoSave } from "../storage/autoSave";
import { MAX_HISTORY, withDB } from "../storage/IndexedDBManager";
import type { AutoSaveRecord } from "../storage/IndexedDBManager";
import { MAX_FILE_SIZE } from "../storage/fileLimits";
import type { Sel } from "../types";
import { getDateText, hideDropdown, hideLoadingScreen, showLoadingScreen } from "../ui";
import { diagramUtil } from "../util/diagramUtil";
import { PopupDialog9 } from "./PopupDialog9";

/** 테이블 행 선택 표시 */
function selectRow(dialog: { selectedRow: HTMLTableRowElement | null }, row: HTMLTableRowElement): void {
	dialog.selectedRow?.classList.remove("selectRow");
	dialog.selectedRow = row;
	row.classList.add("selectRow");
}

/* -----------------------------------------------------------------------------------
 * Samples
 */
const samplelist = [
	{name:"Sakila", count: "16 / 20", dbms: "MySQL (MariaDB)", filename:"mysql_Sakila.json"},
	{name:"Employee", count: "6 / 6", dbms: "MySQL (MariaDB)", filename:"mysql_employee.json"},
	//{name:"Northwind", count: "8 / 7", dbms: "MS-SQL", filename:"mssql_Northwind.json"},
	{name:"BikeStores", count: "9 / 10", dbms: "MS-SQL", filename:"mssql_BikeStores.json"},
	{name:"Global fictitious company", count: "12 / 11", dbms: "ORACLE", filename:"oracle_OT.json"}
];

export class SamplesDialog9 extends PopupDialog9 {
	selectedRow: HTMLTableRowElement | null = null;

	constructor() {
		super();
		const dialogContent = this.setDialog("ERD Samples");

		dialogContent.append("div").html("<p class='erd9Dialog-explain'>ERD9 is a specialized tool for database modeling.<br/>You can explore various features of ERD9 using the following example.<br/>All examples are created based on samples provided by each DBMS vendor. </p><p style='text-align: center; line-height: 0.6;'><a href='https://github.com/gujc71/erd9' target='_blank'>View Documentation</a></p>");

		const grid = dialogContent.append("div").attr("class", "erd9Dialog-grid");
		const table = grid.append("table");
		const thead = table.append("thead").append("tr");
		thead.append("th").style("width", "50px").text("No.");
		thead.append("th").style("width", "400px").text("Sample Description");
		thead.append("th").style("width", "150px").text("Entities / Relationships");
		thead.append("th").style("width", "150px").text("DBMS");

		const this_ = this;
		const tbody = table.append("tbody").attr("class", "sampleTableBody");
		tbody.on('dblclick', () => this.closeWithOK());

		samplelist.forEach((item, inx) => {
			const row = tbody.append("tr");
			row.attr("id", inx);
			row.attr("filename", item.filename);
			row.append("td").text(inx+1);
			row.append("td").text(item.name);
			row.append("td").text(item.count);
			row.append("td").text(item.dbms);
			row.on('click', function() {
				selectRow(this_, this);
			});
		});

		const toolbar = dialogContent.append("div") .attr("class", "erd9Dialog_toolbar1");
		const toolbar_left = toolbar.append("div") .attr("class", "erd9Dialog_toolbar_left");
		const chk = toolbar_left.append("input").attr("type", "checkbox").attr("id", "checkbox1")
			.on("change", function() {
				localStorage.setItem("dontShow", String(this.checked));
			});
		toolbar_left.append("label").attr("for", "checkbox1").html("Don't Show");
		if (localStorage.getItem("dontShow")==="true") chk.attr("checked", "checked");

		const toolbar_right = toolbar.append("div").attr("class", "erd9Dialog_toolbar_right");
		toolbar_right.append("button").attr("class", "primary").text("Open").on("click", () => this.closeWithOK());
		this.setCloseButton(toolbar_right) ;

		this.setDialogPosition();
	}

	override closeWithOK (): void {
		if (!this.selectedRow) {alert("Select the sample to open"); return;}

		const filename = this.selectedRow.getAttribute("filename");
		this.selectedRow.classList.remove("selectRow");

		fetch('https://gujc71.github.io/erd9/samples/' + filename)
		.then(response => {
		  if (!response.ok) {
			throw new Error('Network response was not ok');
		  }
		  return response.json() as Promise<unknown>;
		})
		.then(async data => {
			showLoadingScreen();
			try {
				await openERDData(data);
			} finally {
				hideLoadingScreen();
			}
		})
		.catch(error => {
		  console.error('Fetch error:', error);
		});

		this.close ();
	}
}

/* -----------------------------------------------------------------------------------
 * File Open
 */
export class OpenFileDialog9 extends PopupDialog9 {
	selectedRow: HTMLTableRowElement | null = null;

	constructor() {
		super();
		const dialogContent = this.setDialog("File Open");

		dialogContent.append("div").html("<p class='erd9Dialog-explain'>These files are stored in the current web browser using IndexedDB.<br/>Save locally on your PC, preferably using the expert feature.</p>");

		const grid = dialogContent.append("div").attr("class", "erd9Dialog-grid");
		const table = grid.append("table");
		const thead = table.append("thead").append("tr");
		thead.append("th").style("width", "50px").text("No.");
		thead.append("th").style("width", "400px").text("File Name");
		thead.append("th").style("width", "150px").text("Entities / Relationships");
		thead.append("th").style("width", "150px").text("Last Update");
		thead.append("th").style("width", "50px");

		const tbody = table.append("tbody").attr("class", "fileTableBody");
		tbody.on('dblclick', () => this.closeWithOK());

		this.setToolbar(dialogContent, "Open");

		const this_ = this;
		const today = new Date();
		withDB(db => db.getAllSortedByUpdateDate()).then(results => {
			(results ?? []).forEach((item, inx) => {
				const row = tbody.select(":first-child").node()
					? tbody.insert("tr", ":first-child")
					: tbody.append("tr");
				row.attr("id", item.fileId);
				row.append("td").text(inx+1);
				row.append("td").text(item.fileName ?? "");
				row.append("td").text(`${item.entityCount} / ${item.relationCount}`);
				row.append("td").text(getDateText(today, item.updateDate));
				row.append("td").append("a").text("X").attr("title", "delete File")
					.on("click", function() {
						if (! confirm("Do you really want to delete this file?\nThe saved history of the file is also deleted.") ) return;
						withDB(db => db.remove(item.fileId));
						row.remove();
					});
				row.on('click', function() {
					selectRow(this_, this);
				});
			});
		});
	}

	override async closeWithOK (): Promise<void> {
		if (!this.selectedRow) {alert("Select the file to open"); return;}

		const fileId = parseInt(this.selectedRow.id);
		this.close ();

		const result = await withDB(db => db.get(fileId));
		if (!result?.data) return;

		showLoadingScreen();
		try {
			if (await openERDData(result.data)) {
				state.savedFileID = result.fileId;
				setFileName(result.fileName ?? "");
			}
		} finally {
			hideLoadingScreen();
		}
	}
}

/* -----------------------------------------------------------------------------------
 * Export Image & Print
 */
export class PrintFileDialog9 extends PopupDialog9 {
	private printWidth: Sel<HTMLInputElement>;
	private printHeight: Sel<HTMLInputElement>;
	private previewDiv: Sel<HTMLDivElement>;
	private scale: Sel<HTMLSelectElement>;
	private selectedOnly: boolean;
	/** 미리보기 이미지(blob) URL. 다시 만들거나 닫을 때 해제 */
	private previewURLs: string[] = [];
	/** 미리보기를 다시 만들면 이전 작업의 결과는 버린다 */
	private previewVersion = 0;

	constructor() {
		super();
		// 선택된 도형이 있으면 '선택된 도형만'을 기본으로
		this.selectedOnly = state.selectMgr.getSelectList().length > 0;

		const dialogContent = this.setDialog("Export Image & Prints");

		// 이미지 파일
		dialogContent.append("p").attr("class", "erd9Dialog-explain").html("<b>Export image</b>: the image is cropped to the area the entities occupy.");
		const exportBar = dialogContent.append("div").attr("class", "exportBar");
		exportBar.append("label").html(`<input type='radio' name='imageScope' value='all' ${this.selectedOnly ? "" : "checked"}> All</label>`);
		const selectedLabel = exportBar.append("label").html(`<input type='radio' name='imageScope' value='selected' ${this.selectedOnly ? "checked" : ""}> Selected entities</label>`);
		if (!this.selectedOnly) selectedLabel.select("input").attr("disabled", "disabled");
		exportBar.append("span").text("Scale");
		this.scale = exportBar.append("select");
		this.scale.selectAll("option").data([1, 2, 3, 4]).enter().append("option").attr("value", d => d).text(d => d + "x");
		this.scale.property("value", "2");
		exportBar.append("label").html("<input type='checkbox' name='imageTransparent'> Transparent background</label>");
		exportBar.append("button").text("Download PNG").on("click", () => this._downloadImage("png"));
		exportBar.append("button").text("Download SVG").on("click", () => this._downloadImage("svg"));

		// 인쇄
		dialogContent.append("div").html("<p class='erd9Dialog-explain'><b>Print</b>: specify the size of the paper you want to print on.<br/>The following values are for A4 size (21 cm * 29.7 cm) converted to pixels.</p>");
		const settingbar = dialogContent.append("div").style("margin", "5px");
		settingbar.append("span").text("Width");
		this.printWidth = settingbar.append("input").attr("id", "printWidth").attr("type", "number").attr("value", "794").attr("min", "300").attr("max", "2000").attr("class", "print-size");  // A4 width = 794px = 21cm
		settingbar.append("span").text("Height");
		this.printHeight = settingbar.append("input").attr("id", "printHeight").attr("type", "number").attr("value", "1124").attr("min", "300").attr("max", "2000").attr("class", "print-size"); // A4 Height = 1124px = 29.7cm
		settingbar.append("button").text("Apply").on("click", this._makeImage.bind(this));

		this.previewDiv = dialogContent.append("div").attr("class", "erd9Dialog-300").attr("id", "previewDiv");

		this.setToolbar(dialogContent);
		this._makeImage();
	}

	private _exportOptions() {
		return {
			selectedOnly: this.dialogContent.querySelector<HTMLInputElement>("input[name='imageScope']:checked")?.value === "selected",
			transparent: this.dialogContent.querySelector<HTMLInputElement>("input[name='imageTransparent']")!.checked,
		};
	}

	private async _downloadImage(format: "png" | "svg"): Promise<void> {
		const options = this._exportOptions();
		// 선택 표시(파란색)가 이미지에 나오지 않도록 잠시 해제했다가 복원
		const selected = [...state.selectMgr.getSelectList()];
		selected.forEach(item => item.deselectDiagram());
		const exported = buildExportSVG(options);
		selected.forEach(item => item.selectDiagram());
		if (!exported) {
			alert("There is nothing to export.");
			return;
		}

		const filename = getDocumentName();
		if (format === "svg") {
			downloadFile(filename + ".svg", serializeSVG(exported.svg), "image/svg+xml");
			return;
		}
		try {
			downloadFile(filename + ".png", await svgToPNG(exported, Number(this.scale.property("value"))), "image/png");
		} catch (error) {
			alert(error instanceof Error ? error.message : String(error));
		}
	}

	override close(): void {
		this._revokePreviewURLs();
		super.close();
	}

	private _revokePreviewURLs(): void {
		this.previewVersion++;
		this.previewURLs.forEach(url => URL.revokeObjectURL(url));
		this.previewURLs = [];
	}

	private _makeImage(): void {
		this._revokePreviewURLs();
		const version = this.previewVersion;
		this.previewDiv.text("");
		const previewDiv = this.previewDiv.node()!;
		// 도형이 있는 영역만 페이지로 나눈다
		const exported = buildExportSVG({ selectedOnly: false, transparent: false });
		if (!exported) return;

		const printWidth  = parseInt(this.printWidth.property("value"));  // 21cm
		const printHeight = parseInt(this.printHeight.property("value")); // 29.7cm

		const svgWidth = exported.width;
		const svgHeight = exported.height;

		const maxCnt = {x: Math.ceil(svgWidth / printWidth), y: Math.ceil(svgHeight / printHeight)};
		const aa = (previewDiv.clientWidth-20) / maxCnt.x-7;
		const previewImgSize = {x: aa, y: printHeight * aa / printWidth};

		// SVG 일부를 Canvas에 그림
		const svgData = serializeSVG(exported.svg);
		const svgBlob = new Blob([svgData], { type: "image/svg+xml" });
		const url = URL.createObjectURL(svgBlob);
		const svgImg = new Image();

		const canvas = document.createElement("canvas");
		const context = canvas.getContext("2d")!;
		canvas.width = printWidth;
		canvas.height = printHeight;

		const getImageURL = (button: HTMLElement) => {
			const parent = (button.parentNode as HTMLElement).parentNode as HTMLElement;
			return parent.dataset.url ?? "";
		};
		const previewURLs = this.previewURLs;
		const isCurrent = () => version === this.previewVersion;

		svgImg.onload = function () {
			URL.revokeObjectURL(url);
			if (!isCurrent()) return;
			let top = 0;
			for (let i = 0; i < maxCnt.y; i++) {
				let left = 0;
				for (let j = 0; j < maxCnt.x; j++) {
					context.clearRect(0, 0, canvas.width, canvas.height);
					context.drawImage(svgImg, left * -1,  top * -1);

					const previewImg = diagramUtil.createHTMLElement(previewDiv, "div", "previewImg");
					previewImg.style.width = `${previewImgSize.x}px`;
					previewImg.style.height = `${previewImgSize.y}px`;

					// toDataURL(동기, base64)은 페이지가 많으면 화면이 멈추므로 toBlob(비동기)으로.
					// toBlob은 호출할 때의 캔버스 내용을 쓰므로 같은 캔버스에 다음 페이지를 그려도 된다
					canvas.toBlob(blob => {
						if (!blob) return;
						const imageURL = URL.createObjectURL(blob);
						if (!isCurrent()) {
							URL.revokeObjectURL(imageURL);
							return;
						}
						previewURLs.push(imageURL);
						previewImg.dataset.url = imageURL;
						previewImg.style.backgroundImage = `url('${imageURL}')`;
					}, "image/png");

					const printMenuDiv = diagramUtil.createHTMLElement(previewImg, "div", "printMenuDiv");
					const printButton = diagramUtil.createHTMLElement(printMenuDiv, "div", "printImgButton");
					printButton.title = "Print Image";
					printButton.addEventListener("click", function(){
						const imageURL = getImageURL(this);
						if (!imageURL) return;		// 아직 이미지를 만드는 중
						const newWindow = window.open("", "_blank");
						if (!newWindow) return;
						newWindow.document.write('<img id="printImg" alt="Image">');
						newWindow.document.title = state.savedFileID ? getFileName() : "ERD9";

						const printImg = newWindow.document.getElementById("printImg") as HTMLImageElement;
						// 이미지가 로드된 뒤 인쇄
						printImg.onload = () => newWindow.print();
						printImg.src = imageURL;
					});
					const downloadButton = diagramUtil.createHTMLElement(printMenuDiv, "div", "downloadImgButton");
					downloadButton.title = "Download Image";
					downloadButton.addEventListener("click", function(){
						const imageURL = getImageURL(this);
						if (!imageURL) return;
						const link = document.createElement("a");
						link.href = imageURL;
						link.download = "erd9.png";
						link.click();
					});
					left += printWidth;
				}
				top += printHeight;
			}
		};

		svgImg.src = url;
	}
}

/* -----------------------------------------------------------------------------------
 * import file from json
 */
export class ImportFileDialog9 extends PopupDialog9 {
	private fileInput: Sel<HTMLInputElement>;

	constructor() {
		super();
		const dialogContent = this.setDialog("Select the files you want to import.");

		this.fileInput = dialogContent.append("input").attr("type", "file").attr("accept", ".json,.erd9,application/json");

		this.setToolbar(dialogContent, "Open");
	}

	override closeWithOK (): void {
		const files = this.fileInput.node()!.files;
		if (!files || files.length===0) {
			alert("No file selected.");
			return;
		}
		readJSONFile(files[0]).then(data => {
			if (data !== undefined) openERDData(data);
		});
		this.close ();
	}
}

/** JSON 파일 읽기. 실패하면 알림을 띄우고 undefined */
export async function readJSONFile(file: File): Promise<unknown> {
	if (file.size > MAX_FILE_SIZE) {
		alert(`The file is too large. (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
		return undefined;
	}
	let text: string;
	try {
		text = await file.text();
	} catch {
		alert("Failed to read the file.");
		return undefined;
	}
	try {
		return JSON.parse(text);
	} catch {
		alert("The file is not a valid JSON file.");
		return undefined;
	}
}

/* -----------------------------------------------------------------------------------
 * 저장하지 않은 작업 복구
 */
export class RecoveryDialog9 extends PopupDialog9 {
	private record: AutoSaveRecord;

	constructor(record: AutoSaveRecord) {
		super();
		this.record = record;
		const dialogContent = this.setDialog("Recover unsaved work");

		const entityCount = Object.keys(record.data.entityData).length;
		dialogContent.append("p").attr("class", "erd9Dialog-explain")
			.text(`ERD9 was closed with unsaved work. Do you want to recover it?`);
		const info = dialogContent.append("ul");
		info.append("li").text(`File name: ${record.fileName || "no name"}`);
		info.append("li").text(`Entities: ${entityCount}, Relationships: ${record.data.relationData.length}`);
		info.append("li").text(`Last changed: ${new Date(record.savedAt).toLocaleString()}`);

		const toolbar = dialogContent.append("div").attr("class", "erd9Dialog-toolbar");
		toolbar.append("button").text("Recover").on("click", () => this.closeWithOK());
		toolbar.append("button").text("Discard").on("click", () => this.discard());
		this.setDialogPosition();
	}

	override closeWithOK (): void {
		this.close();
		restoreAutoSave(this.record);
	}

	private discard(): void {
		if (!confirm("The unsaved work will be deleted. Continue?")) return;
		withDB(db => db.clearAutoSave(), true);
		this.close();
	}
}

/* -----------------------------------------------------------------------------------
 * 문서 이력 (저장할 때마다 남긴 버전)
 */
export function openHistoryDialog(): void {
	hideDropdown();
	if (!state.savedFileID) {
		alert("Save the document first (Ctrl+S).\nA version is kept in the history each time you save it.");
		return;
	}
	new HistoryDialog9(state.savedFileID);
}

class HistoryDialog9 extends PopupDialog9 {
	constructor(fileId: number) {
		super();
		const dialogContent = this.setDialog("File History");
		dialogContent.append("p").attr("class", "erd9Dialog-explain")
			.html(`A version is kept each time you save the document (up to ${MAX_HISTORY} versions).<br/>Compare a version with the current document to get the ALTER script, or restore it.`);

		const grid = dialogContent.append("div").attr("class", "erd9Dialog-grid");
		const table = grid.append("table");
		const thead = table.append("thead").append("tr");
		thead.append("th").style("width", "50px").text("No.");
		thead.append("th").style("width", "220px").text("Saved at");
		thead.append("th").style("width", "130px").text("Entities / Relationships");
		thead.append("th").style("width", "200px");
		const tbody = table.append("tbody");

		this.setToolbar(dialogContent);

		withDB(db => db.getHistory(fileId)).then(list => {
			if (!list || list.length === 0) {
				tbody.append("tr").append("td").attr("colspan", 4).text("No saved versions.");
				return;
			}
			list.forEach((item, inx) => {
				const row = tbody.append("tr");
				row.append("td").attr("class", "alignCenter").text(inx + 1);
				row.append("td").text(new Date(item.savedAt).toLocaleString());
				row.append("td").attr("class", "alignCenter").text(`${item.entityCount} / ${item.relationCount}`);
				const actions = row.append("td").attr("class", "historyActions");
				actions.append("button").text("Compare").attr("title", "Compare with the current document").on("click", () => this.compare(item.id!, item.savedAt));
				actions.append("button").text("Restore").on("click", () => this.restore(item.id!));
				actions.append("a").text("X").attr("title", "delete").on("click", () => {
					if (!confirm("Do you really want to delete this version?")) return;
					withDB(db => db.removeHistory(item.id!));
					row.remove();
				});
			});
		});
	}

	private async compare(id: number, savedAt: number): Promise<void> {
		const item = await withDB(db => db.getHistoryItem(id));
		if (!item?.data) return;
		this.close();
		const { CompareERDDialog9 } = await import("./compareDialog");
		new CompareERDDialog9({ data: item.data, label: `Version saved at ${new Date(savedAt).toLocaleString()}` });
	}

	private async restore(id: number): Promise<void> {
		const item = await withDB(db => db.getHistoryItem(id));
		if (!item?.data) return;
		const ref = getDocumentRef();
		this.close();
		showLoadingScreen();
		try {
			if (await openERDData(item.data)) {
				// 같은 파일로 계속 작업. 저장하기 전까지는 수정된 상태
				setDocumentRef(ref);
				state.diagramStack.markModified();
			}
		} finally {
			hideLoadingScreen();
		}
	}
}
