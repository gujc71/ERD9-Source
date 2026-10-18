import { select } from "d3-selection";
import { REFERENTIAL_ACTIONS, RELATION_CARDINALITY, RELATION_SELECTION, STATE_TYPE } from "../constants";
import type { ReferentialAction, RelationCardinality, RelationSelection } from "../constants";
import { AREA_COLORS } from "../diagram/Area9";
import type { Area9 } from "../diagram/Area9";
import type { Entity9 } from "../diagram/Entity9";
import type { Relation9 } from "../diagram/Relation9";
import type { Text9 } from "../diagram/Text9";
import { docObjects, state } from "../state";
import { toColor } from "../util/color";
import { setCheckItem, setIndexItem, TableGrid9 } from "../tableGrid9";
import { getTemplateColumns, getTemplates } from "../templates";
import type { CheckData, IndexData, Sel } from "../types";
import { diagramUtil } from "../util/diagramUtil";
import { PopupDialog9 } from "./PopupDialog9";

/** 색상 선택: 기본 색 견본 + 직접 선택. 선택한 값은 input(type=color)에 들어간다 */
function appendColorPicker<E extends HTMLElement>(parent: Sel<E>, value: string, colors: string[]): Sel<HTMLInputElement> {
	const wrap = parent.append("span").attr("class", "colorPicker");
	const input = wrap.append("input").attr("type", "color").property("value", value);
	for (const color of colors) {
		wrap.append("span").attr("class", "colorSwatch").attr("title", color).style("background-color", color)
			.on("click", () => input.property("value", color));
	}
	return input;
}

/* -----------------------------------------------------------------------------------
 * Text Diagram
 */
export class TextDialog9 extends PopupDialog9 {
	private editingDia: Text9;
	private textarea: Sel<HTMLTextAreaElement>;

	constructor(movingDia: Text9) {
		super();
		const dialogContent = this.setDialog("Text");

		this.editingDia = movingDia;

		dialogContent.append("div").html("<p class='erd9Dialog-explain'>Enter any necessary notes or comments, such as table information or underlying code.</p>");

		this.textarea = dialogContent.append("textarea")
			.attr("cols", "75")
			.attr("rows", "10")
			.property("value", this.editingDia.getData() );

		this.textarea.node()!.focus();

		this.setToolbar(dialogContent, "Save");
	}

	override closeWithOK (): void {
		const txt = this.textarea.property("value");

		const backupData = this.editingDia.getData(); // 수정전 데이터. redo를 위한것.
		this.editingDia.setData(txt);
		state.diagramStack.saveState(STATE_TYPE.ENTITY_MODIFY, this.editingDia, backupData);

		this.close ();
	}
}

/* -----------------------------------------------------------------------------------
 * Subject Area
 */
export class AreaDialog9 extends PopupDialog9 {
	private editingDia: Area9;
	private nameInput: Sel<HTMLInputElement>;
	private colorInput: Sel<HTMLInputElement>;

	constructor(movingDia: Area9) {
		super();
		this.editingDia = movingDia;
		const dialogContent = this.setDialog("Subject Area");

		dialogContent.append("p").attr("class", "erd9Dialog-explain")
			.html("Group related entities. Drag the name or border to move the area together with the entities inside it,<br/>and drag the corner to resize it.");

		const row1 = dialogContent.append("div").attr("class", "inputRow");
		row1.append("span").attr("class", "inputLabel").text("Name");
		this.nameInput = row1.append("input").attr("type", "text").attr("maxlength", "50").property("value", movingDia.data.name);

		const row2 = dialogContent.append("div").attr("class", "inputRow");
		row2.append("span").attr("class", "inputLabel").text("Color");
		this.colorInput = appendColorPicker(row2, movingDia.data.color, AREA_COLORS);

		this.setToolbar(dialogContent, "Save");
		this.nameInput.node()!.focus();
	}

	override closeWithOK (): void {
		const backupData = this.editingDia.getData();
		this.editingDia.setData({
			...backupData,
			name: this.nameInput.property("value").trim(),
			color: toColor(this.colorInput.property("value")) ?? backupData.color,
		});
		state.diagramStack.saveState(STATE_TYPE.ENTITY_MODIFY, this.editingDia, backupData);
		this.close ();
	}
}

/* -----------------------------------------------------------------------------------
 * Relation Diagram
 */
export class RelationDialog9 extends PopupDialog9 {
	private editingDia: Relation9;
	private nameInput: Sel<HTMLInputElement>;
	private onDelete: Sel<HTMLSelectElement>;
	private onUpdate: Sel<HTMLSelectElement>;
	private labelInput: Sel<HTMLInputElement>;
	private autoRoute: Sel<HTMLInputElement>;

	constructor(movingDia: Relation9) {
		super();

		this.editingDia = movingDia;
		const dialogContent = this.setDialog("Relationship");

		const addRadio = (parent: Sel<HTMLDivElement>, id: string, name: string, value: string, label: string, checked: boolean) => {
			const radio = parent.append("input").attr("type", "radio").attr("id", id).attr("name", name).attr("value", value);
			parent.append("label").attr("for", id).html(label);
			if (checked) radio.attr("checked", "checked");
		};

		const div1 = dialogContent.append("div").attr("class", "relationOption");
		div1.append("b").text("Cardinality");
		div1.append("br");
		addRadio(div1, "checkbox1", "relationCard", RELATION_CARDINALITY.O2O, "One To One",  movingDia.relationCard === RELATION_CARDINALITY.O2O);
		addRadio(div1, "checkbox2", "relationCard", RELATION_CARDINALITY.O2M, "One To Many", movingDia.relationCard === RELATION_CARDINALITY.O2M);
		div1.append("br");
		div1.append("span").attr("class", "erd9Dialog-explain").text("Many To Many: draw it with the M:N tool on the toolbar. An associative (intersection) table is created automatically.");

		const div2 = dialogContent.append("div").attr("class", "relationOption");
		div2.append("b").text("Optionality");
		div2.append("br");
		addRadio(div2, "checkbox11", "relationSelect", RELATION_SELECTION.MM, "Parent Mandatory : Child Mandatory", movingDia.relationSelect === RELATION_SELECTION.MM);
		div2.append("br");
		addRadio(div2, "checkbox12", "relationSelect", RELATION_SELECTION.MO, "Parent Mandatory : Child Optional", movingDia.relationSelect === RELATION_SELECTION.MO);
		div2.append("br");
		addRadio(div2, "checkbox13", "relationSelect", RELATION_SELECTION.OO, "Parent Optional : Child Optional", movingDia.relationSelect === RELATION_SELECTION.OO);
		div2.append("br");
		addRadio(div2, "checkbox14", "relationSelect", RELATION_SELECTION.OM, "Parent Optional : Child Mandatory", movingDia.relationSelect === RELATION_SELECTION.OM);

		// 외래키 제약조건
		const div3 = dialogContent.append("div").attr("class", "relationOption");
		const row1 = div3.append("div").attr("class", "inputRow");
		row1.append("span").attr("class", "inputLabel").text("FK Constraint Name");
		this.nameInput = row1.append("input").attr("type", "text").attr("maxlength", "100")
			.attr("placeholder", movingDia.id).property("value", movingDia.name ?? "");

		const addActionSelect = (label: string, value?: ReferentialAction) => {
			const row = div3.append("div").attr("class", "inputRow");
			row.append("span").attr("class", "inputLabel").text(label);
			const selectBox = row.append("select").attr("class", "width150");
			selectBox.selectAll("option").data(REFERENTIAL_ACTIONS).enter().append("option").attr("value", d => d).text(d => d);
			selectBox.property("value", value ?? "NO ACTION");
			return selectBox;
		};
		this.onDelete = addActionSelect("ON DELETE", movingDia.onDelete);
		this.onUpdate = addActionSelect("ON UPDATE", movingDia.onUpdate);
		div3.append("p").attr("class", "erd9Dialog-explain").text("Options not supported by the selected DBMS are left as comments in the generated DDL.");

		// 표시
		const div4 = dialogContent.append("div").attr("class", "relationOption");
		const row4 = div4.append("div").attr("class", "inputRow");
		row4.append("span").attr("class", "inputLabel").text("Relationship Name");
		this.labelInput = row4.append("input").attr("type", "text").attr("maxlength", "60")
			.attr("placeholder", "e.g. places, has").property("value", movingDia.label ?? "");
		const row5 = div4.append("div").attr("class", "inputRow");
		this.autoRoute = row5.append("input").attr("type", "checkbox").attr("id", "relationAutoRoute")
			.property("checked", movingDia.bend === undefined && movingDia.parentAt === undefined && movingDia.childAt === undefined);
		row5.append("label").attr("for", "relationAutoRoute").text(" Automatic route (avoids other tables)");
		div4.append("p").attr("class", "erd9Dialog-explain").text("Drag the line to move its bend, or drag an end to slide it along the table edge. Turn on Automatic route to reset them.");

		this.setToolbar(dialogContent, "Save");
	}

	override closeWithOK (): void {
		const backupData = this.editingDia.getOption();
		const relationCard = this.dialogContent.querySelector<HTMLInputElement>('input[name="relationCard"]:checked')!.value as RelationCardinality;
		const relationSelect = this.dialogContent.querySelector<HTMLInputElement>('input[name="relationSelect"]:checked')!.value as RelationSelection;
		const action = (selectBox: Sel<HTMLSelectElement>) => {
			const value = selectBox.property("value") as ReferentialAction;
			return value === "NO ACTION" ? undefined : value;
		};

		this.editingDia.changeRelation({
			relationCard, relationSelect,
			onDelete: action(this.onDelete),
			onUpdate: action(this.onUpdate),
			name: this.nameInput.property("value").trim() || undefined,
			label: this.labelInput.property("value").trim() || undefined,
			...(this.autoRoute.property("checked")
				? { bend: undefined, parentAt: undefined, childAt: undefined }
				: { bend: this.editingDia.bend, parentAt: this.editingDia.parentAt, childAt: this.editingDia.childAt }),
		});
		state.diagramStack.saveState(STATE_TYPE.RELATION_MODIFY, this.editingDia, backupData);

		this.close ();
	}
}

/* -----------------------------------------------------------------------------------
 * Entity Diagram
 */
const ENTITY_COLORS = ["#ffffff", "#e8f0fe", "#e6f4ea", "#fef7e0", "#fce8e6", "#f3e8fd", "#e4f7fb"];

export class EntityDiagramDialog9 extends PopupDialog9 {
	private editingDia: Entity9;
	private dialogContent3ds: Sel<HTMLDivElement>;
	private tableGrid9: TableGrid9;
	private toolbar_left: Sel<HTMLDivElement>;
	private colorInput: Sel<HTMLInputElement>;
	/** "table": 인덱스 편집 중 */
	private editorMode = "";

	constructor(movingDia: Entity9) {
		super();
		this.editingDia = movingDia;
		this.dialogContent3ds = this.setDialog("Entity",  "wide entityDialog");

		const div = this.dialogContent3ds.append("div").html("<span>Table Name (Physical):</span><input type='text' id='tableName' maxlength='50' /><span style='margin-left: 16px;'>Entity Name (Logical):</span><input type='text' id='tableComments' maxlength='50' />").attr("class", "tablename");
		const colorRow = div.append("div").attr("class", "entityColorRow");
		colorRow.append("span").text("Color:");
		this.colorInput = appendColorPicker(colorRow, movingDia.data.color ?? "#ffffff", ENTITY_COLORS);
		colorRow.append("button").attr("id", "editIndexBtn").text("Index / Check").on("click", this.changeTableEditorMode.bind(this));

		const grid1 = this.dialogContent3ds.append("div").attr("class", "erd9Dialog-grid1 erd9Dialog-grid");
		const tablegrid = diagramUtil.createTable(grid1.node()!, "tablegrid-tbody", true);

		// index tab
		const grid = this.dialogContent3ds.append("div").attr("class", "erd9Dialog-grid2 erd9Dialog-grid").style("display", "none");
		const indexGrid1 = grid.append("div").attr("class", "tableIndexGrid");
		const indexGrid2 = grid.append("div").attr("class", "tableIndexGrid").style("margin-left", "5px");
		const checkGrid = grid.append("div").attr("class", "tableIndexGrid").style("margin-left", "5px");
		const table = indexGrid1.append("table");
		const thead = table.append("thead").append("tr");
		thead.append("th").style("width", "150px").text("Column Name");
		thead.append("th").style("width", "100px").text("Attribute Name");
		const tbody = table.append("tbody").attr("class", "tableIndexGrid-tbody");
		tbody.node()!.addEventListener('click', this.handleIndexCellClick.bind(this));

		indexGrid2.html("<p>Index Name: <input type='text' id='indexeName' maxlength='50' /></p><p><label><input type='checkbox' id='indexUnique'/> Unique</label></p>");
		const indexcolumnul = indexGrid2.append("ul").attr("class", "indexcolumnul").node()!;
		indexGrid2.append("button").text("add").on("click", this.handleIndexAdd.bind(this));
		indexGrid2.append("ul").attr("class", "tableindexList");

		// check constraints
		checkGrid.html("<p><b>Check Constraints</b></p><p>Name: <input type='text' id='checkName' maxlength='50' /></p><p>Expression:</p>");
		checkGrid.append("textarea").attr("id", "checkExpression").attr("rows", "3").attr("placeholder", "price >= 0");
		checkGrid.append("br");
		checkGrid.append("button").text("add").on("click", this.handleCheckAdd.bind(this));
		checkGrid.append("ul").attr("class", "tablecheckList").on("click", this.handleCheckSelect.bind(this));

		// index column
		let draggedItem: HTMLElement | null = null;
		indexcolumnul.addEventListener("dragstart", (e) => {
			draggedItem = e.target as HTMLElement;
		});

		indexcolumnul.addEventListener("dragover", (e) => {
			e.preventDefault();
			const targetItem = e.target as HTMLElement;
			if (draggedItem && targetItem !== draggedItem && targetItem.nodeName === "LI") {
				targetItem.parentNode!.insertBefore(draggedItem, targetItem);
			}
		});

		indexcolumnul.addEventListener("dragend", () => {
			draggedItem = null;
		});

		// set Data
		this.tableGrid9 = new TableGrid9(select(tablegrid), null, state.dbmsType, true);
		this.tableGrid9.setTableData(movingDia.data, state.dbmsType);

		this.dialogContent3ds.select("#tableName").property("value", movingDia.data.physicalName);
		this.dialogContent3ds.select("#tableComments").property("value", movingDia.data.logicalName);

		this.dialogContent3ds.selectAll(".tableindexList > li").on("click", this.handleIndexSelect.bind(this));

		// set Toolbar in bottom of dialog
		const toolbar = this.dialogContent3ds.append("div") .attr("class", "erd9Dialog_toolbar1");
		this.toolbar_left = toolbar.append("div") .attr("class", "erd9Dialog_toolbar_left");

		const MENU_BUTTONS = [{text:"↑", hint:"Move Up"}, {text:"↓", hint:"Move Down"}, {text:"+", hint:"Add Column"}, {text:"-", hint:"Remove Column"}];
		this.toolbar_left.selectAll("button")
			.data(MENU_BUTTONS)
			.enter()
			.append("button")
			.text(function(d) { return d.text; })
			.attr("title", function(d) { return d.hint; })
			.on("click", this.tableGrid9.rowActionHandle.bind(this.tableGrid9));

		// 공통 컬럼 템플릿
		const templates = getTemplates();
		if (templates.length > 0) {
			const templateSelect = this.toolbar_left.append("select").attr("class", "templateSelect").attr("title", "Add common columns");
			templateSelect.append("option").attr("value", "").text("+ Template columns");
			templates.forEach((template, inx) => templateSelect.append("option").attr("value", inx).text(template.name));
			templateSelect.on("change", () => {
				const template = templates[Number(templateSelect.property("value"))];
				templateSelect.property("value", "");
				if (!template) return;
				if (this.tableGrid9.appendFields(getTemplateColumns(template, state.dbmsType)) === 0) alert("All columns of the template already exist.");
			});
		}

		// 표준 사전으로 컬럼명 변경
		if (docObjects.words.length > 0 || docObjects.terms.length > 0) {
			this.toolbar_left.append("button").text("Standardize")
				.attr("title", "Set column names (and domains) from the logical names using the standard words and terms")
				.on("click", () => {
					state.nameEditor.endEditMode();
					const result = this.tableGrid9.applyStandardNames();
					let message = `${result.changed} column(s) changed.`;
					if (result.unknown.length > 0) message += "\n\nNot in the standard dictionary (columns unchanged):\n" + result.unknown.join(", ");
					alert(message);
				});
		}

		const toolbar_right = toolbar.append("div").attr("class", "erd9Dialog_toolbar_right");
		toolbar_right.append("button").attr("class", "primary").text("Save").on("click", () => this.closeWithOK());
		this.setCloseButton(toolbar_right) ;
		this.setDialogPosition();
	}

	override closeWithOK (): void {
		state.nameEditor.endEditMode();
		const tableInfo = this.tableGrid9.getTableData();
		tableInfo.physicalName = this.dialogContent3ds.select("#tableName").property("value");
		tableInfo.logicalName = this.dialogContent3ds.select("#tableComments").property("value");
		const color = toColor(this.colorInput.property("value"));
		if (color && color !== "#ffffff") tableInfo.color = color;

		// 컬럼명을 바꾸면 인덱스의 컬럼 목록도 변경
		const newFields = new Map(tableInfo.keys.concat(tableInfo.fields).map(f => [f.id, f.column]));
		const renamed = new Map<string, string>();
		for (const field of this.editingDia.data.allFields) {
			const column = newFields.get(field.id);
			if (column && column !== field.column) renamed.set(field.column, column);
		}
		if (renamed.size > 0) {
			tableInfo.indexes = tableInfo.indexes?.map(index => ({ ...index, fields: index.fields.split(",").map(c => renamed.get(c) ?? c).join(",") }));
		}

		const backupData = diagramUtil.deepCopy(this.editingDia.data); // 수정전 데이터. redo를 위한것.

		const result = this.editingDia.setTableData(tableInfo);

		if (result === "error") return;
		if (result === "ok") state.diagramStack.saveState(STATE_TYPE.ENTITY_MODIFY, this.editingDia, backupData);

		this.close ();
	}

	private changeTableEditorMode(): void {
		if (this.editorMode==="table") {
			this.editorMode="index";
			this.dialogContent3ds.select(".erd9Dialog-grid1").style("display", "");
			this.dialogContent3ds.select(".erd9Dialog-grid2").style("display", "none");
			this.toolbar_left.style("display", "");
			return;
		}
		this.toolbar_left.style("display", "none");

		this.editorMode="table";
		this.dialogContent3ds.select(".erd9Dialog-grid1").style("display", "none");
		this.dialogContent3ds.select(".erd9Dialog-grid2").style("display", "");

		// 기존 작업 초기화
		this._indexNameInput().value="";
		this._indexUniqueInput().checked = false;
		this.dialogContent3ds.select(".tableIndexGrid-tbody").selectAll("tr.selectRow").classed("selectRow", false);
		this.dialogContent3ds.select(".indexcolumnul").selectAll("li").remove();

		const indexbody = this.dialogContent3ds.select(".tableIndexGrid-tbody");
		indexbody.selectAll("tr").remove();

		// 인덱스용 컬럼 추가
		this.dialogContent3ds.select(".tablegrid-tbody").selectAll<HTMLTableRowElement, unknown>("tr")
			.each(function ()  {
				const cells = this.cells;
				const column = cells[0].innerText.trim();
				if (column==="") return;
				const row = indexbody.append("tr");
				row.append("td").text(column);
				row.append("td").text(cells[1].innerText.trim());
			});
	}

	private _indexNameInput(): HTMLInputElement {
		return this.dialogContent.querySelector<HTMLInputElement>("#indexeName")!;
	}
	private _indexUniqueInput(): HTMLInputElement {
		return this.dialogContent.querySelector<HTMLInputElement>("#indexUnique")!;
	}

	private handleIndexCellClick(event: MouseEvent): void {
		const cell = event.target as HTMLElement;
		if (cell.nodeName !== "TD") return;

		const row = cell.parentNode as HTMLTableRowElement;
		const rowText = select(row).select("td").text();

		if (row.classList.contains("selectRow")) {
			row.classList.remove("selectRow");
			this.dialogContent3ds.select(".indexcolumnul #" + CSS.escape("col"+rowText)).remove();
		} else {
			row.classList.add("selectRow");
			this.dialogContent3ds.select(".indexcolumnul").append("li").attr("id", "col"+rowText).text(rowText).attr("draggable", "true");
		}
	}

	private handleIndexAdd(): void {
		const indexNameEle = this._indexNameInput();
		const indexName = indexNameEle.value.trim();
		if (indexName.length < 5) {
			alert("Enter an index name of at least 5 characters");
			indexNameEle.focus();
			return;
		}
		// 인덱스 컬럼 추출
		const indexFld = this.dialogContent3ds.select(".indexcolumnul").selectAll<HTMLLIElement, unknown>("li").nodes()
							.map(li => li.innerText).join(",");

		if (!indexFld) {
			alert("Select the columns to use for the index.");
			return;
		}

		const data: IndexData = {name: indexName, fields:indexFld};
		if (this._indexUniqueInput().checked) data.unique = true;
		const inx = this.dialogContent3ds.select(".tableindexList").select<HTMLLIElement>("#" + CSS.escape("inx" + indexName));
		if (!inx.empty()) {
			inx.data([data]).each(function(d) { setIndexItem(this, d); });
			return;
		}

		this.dialogContent3ds.select(".tableindexList").append("li")
		.attr("id", "inx"+data.name)
		.data([data])
		.each(function(d) { setIndexItem(this, d); })
		.on("click", this.handleIndexSelect.bind(this));
	}

	// initial selected index info - selected columns in TABLE tag & UL (indexcolumnul)
	private initSelectIndex<E extends HTMLElement>(indexcolumnul: Sel<E>): void {
		this.dialogContent3ds.select(".tableIndexGrid-tbody").selectAll("tr.selectRow").classed("selectRow", false);
		indexcolumnul.selectAll("li").remove();
	}

	private handleIndexSelect(event: MouseEvent): void {
		const target = event.target as HTMLElement;
		if (target.nodeName === "SPAN") {
			if (! confirm("Do you want to delete the selected index?") ) return;
			this.initSelectIndex( this.dialogContent3ds.select<HTMLElement>(".indexcolumnul") );
			target.parentNode!.parentNode!.removeChild(target.parentNode!);
			return;
		}
		this._indexNameInput().value=target.id.substring(3, target.id.length);

		const indexcolumnul = this.dialogContent3ds.select<HTMLElement>(".indexcolumnul");
		this.initSelectIndex(indexcolumnul);

		// set index column
		const data = select<HTMLElement, IndexData>(target).datum();
		this._indexUniqueInput().checked = !!data.unique;
		const fields = data.fields.split(',');
		fields.forEach((fld) => {
			indexcolumnul.append("li").attr("id", "col"+fld).text(fld).attr("draggable", "true");
			this.dialogContent3ds.select(".tableIndexGrid-tbody").selectAll<HTMLTableRowElement, unknown>("tr").each(function() {
				if (select(this).select("td").text()===fld)
				this.classList.add("selectRow");
			});
		});
	}

	private _checkInputs(): { name: HTMLInputElement; expression: HTMLTextAreaElement } {
		return {
			name: this.dialogContent.querySelector<HTMLInputElement>("#checkName")!,
			expression: this.dialogContent.querySelector<HTMLTextAreaElement>("#checkExpression")!,
		};
	}

	private handleCheckAdd(): void {
		const inputs = this._checkInputs();
		const data: CheckData = { name: inputs.name.value.trim(), expression: inputs.expression.value.trim() };
		if (!data.name) {
			alert("Enter the name of the check constraint.");
			inputs.name.focus();
			return;
		}
		if (!data.expression) {
			alert("Enter the expression of the check constraint.");
			inputs.expression.focus();
			return;
		}
		const list = this.dialogContent3ds.select<HTMLUListElement>(".tablecheckList");
		const same = list.selectAll<HTMLLIElement, CheckData>("li").nodes().find(li => select<HTMLLIElement, CheckData>(li).datum().name === data.name);
		const li = same ?? list.append("li").node()!;
		select(li).datum(data);
		setCheckItem(li, data);
		inputs.name.value = "";
		inputs.expression.value = "";
	}

	/** 항목 클릭: 편집, x 클릭: 삭제 */
	private handleCheckSelect(event: MouseEvent): void {
		const target = event.target as HTMLElement;
		const li = target.closest("li");
		if (!li) return;
		if (target.nodeName === "SPAN") {
			if (confirm("Do you want to delete the selected check constraint?")) li.remove();
			return;
		}
		const data = select<HTMLLIElement, CheckData>(li).datum();
		const inputs = this._checkInputs();
		inputs.name.value = data.name;
		inputs.expression.value = data.expression;
	}
}
