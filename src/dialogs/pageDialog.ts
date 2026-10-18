/**
 * 다이어그램 페이지 다이얼로그 (core/pages)
 */
import { deletePage, removeFromCurrentPage, updatePage } from "../core/pages";
import { DIAGRAM_TYPE } from "../constants";
import { entityMap, state } from "../state";
import type { PageData, Sel } from "../types";
import { PopupDialog9 } from "./PopupDialog9";

/** 페이지 이름과 들어갈 엔터티 선택 */
export class PageDialog9 extends PopupDialog9 {
	private page: PageData;
	private nameInput: Sel<HTMLInputElement>;
	private list: Sel<HTMLDivElement>;

	constructor(page: PageData) {
		super();
		this.page = page;
		const dialogContent = this.setDialog("Page");

		dialogContent.append("p").attr("class", "erd9Dialog-explain")
			.html("A page shows only the entities you choose, each at its own position on the page.<br/>Entities stay in the model when they are removed from a page. Main always shows every entity.");

		const row1 = dialogContent.append("div").attr("class", "page-dialog-row");
		row1.append("span").text("Name");
		this.nameInput = row1.append("input").attr("type", "text").attr("maxlength", "50").property("value", page.name);

		const row2 = dialogContent.append("div").attr("class", "page-dialog-row");
		row2.append("span").text("Filter");
		const filter = row2.append("input").attr("type", "text").attr("placeholder", "table name");
		row2.append("button").text("All").on("click", () => this.checkVisible(true));
		row2.append("button").text("None").on("click", () => this.checkVisible(false));

		this.list = dialogContent.append("div").attr("class", "page-dialog-list");
		const entities = [...entityMap.values()].sort((a, b) => a.data.physicalName.localeCompare(b.data.physicalName));
		for (const entity of entities) {
			const label = this.list.append("label").attr("data-name", (entity.data.physicalName + " " + (entity.data.logicalName ?? "")).toLowerCase());
			label.append("input").attr("type", "checkbox").attr("value", entity.id).property("checked", entity.id in page.entities);
			label.append("span").text(entity.data.physicalName + (entity.data.logicalName && entity.data.logicalName !== entity.data.physicalName ? ` (${entity.data.logicalName})` : ""));
		}
		filter.on("input", () => {
			const keyword = filter.property("value").trim().toLowerCase();
			this.list.selectAll<HTMLLabelElement, unknown>("label").style("display", function() {
				return !keyword || this.dataset.name!.includes(keyword) ? null : "none";
			});
		});

		const toolbar = this.setToolbar(dialogContent, "Save");
		toolbar.insert("button", ":first-child").text("Delete Page").on("click", () => {
			if (!confirm(`Delete the page "${page.name}"?\nThe entities stay in the model, but texts and areas on this page are deleted.`)) return;
			this.close();
			deletePage(page);
		});
		this.nameInput.node()!.focus();
	}

	/** 필터로 보이는 항목만 선택 / 해제 */
	private checkVisible(checked: boolean): void {
		this.list.selectAll<HTMLLabelElement, unknown>("label").each(function() {
			if (this.style.display !== "none") this.querySelector("input")!.checked = checked;
		});
	}

	override closeWithOK(): void {
		const name = this.nameInput.property("value").trim();
		if (!name) {
			alert("Enter the page name.");
			return;
		}
		const ids = new Set<string>();
		this.list.selectAll<HTMLInputElement, unknown>("input:checked").each(function() { ids.add(this.value); });
		updatePage(this.page, name, ids);
		this.close();
	}
}

/** 페이지에서 엔터티를 지울 때: 페이지에서만 뺄지, 모델에서 삭제할지 */
export class DeleteFromPageDialog9 extends PopupDialog9 {
	constructor(removeFromModel: () => void) {
		super();
		const dialogContent = this.setDialog("Remove");
		dialogContent.append("p").attr("class", "erd9Dialog-explain")
			.html("Remove the selected entities from this page only,<br/>or delete them from the model (and every page)?");

		const toolbar = dialogContent.append("div").attr("class", "erd9Dialog-toolbar");
		toolbar.append("button").text("Remove from Page").on("click", () => {
			this.close();
			const selected = state.selectMgr.getSelectList();
			removeFromCurrentPage(selected.filter(item => item.diagramType === DIAGRAM_TYPE.ENTITY).map(item => item.id));
		});
		toolbar.append("button").text("Delete from Model").on("click", () => {
			this.close();
			removeFromModel();
		});
		this.setCloseButton(toolbar);
		this.setDialogPosition();
	}
}
