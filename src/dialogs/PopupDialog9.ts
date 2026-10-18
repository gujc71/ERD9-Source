import { drag } from "d3-drag";
import type { D3DragEvent } from "d3-drag";
import { select } from "d3-selection";
import { state } from "../state";
import type { Sel } from "../types";

/** 모달 다이얼로그 (<dialog>). Esc를 누르면 close() */
export class PopupDialog9 {
	popupDialog!: Sel<HTMLDialogElement>;
	dialogContent!: HTMLDivElement;
	/** 이 다이얼로그를 연 다이얼로그 (닫으면 다시 현재 다이얼로그가 된다) */
	private opener: PopupDialog9 | null;

	constructor() {
		this.opener = state.popupWindow;
		state.popupWindow = this;
	}

	close (): void {
		if (state.popupWindow === this) {
			state.popupWindow = this.opener?.popupDialog?.node()?.isConnected ? this.opener : null;
		}
		this.popupDialog.remove();
	}

	closeWithOK (): void {
		this.close ();
	}

	setDialog(dialogTitle: string, extraCss?: string): Sel<HTMLDivElement> {
		this.popupDialog = select("body").append("dialog")
			.attr("class", "erd9Dialog")
			.on("cancel", (event: Event) => {		// Esc
				event.preventDefault();
				this.close();
			})
			// 브라우저가 cancel 없이 닫은 경우
			.on("close", () => {
				if (this.popupDialog.node()!.isConnected) this.close();
			});

		const dialogContent = this.popupDialog.append("div").attr("class", "erd9Dialog-content ");
		if (extraCss) dialogContent.classed(extraCss, true);

		if (dialogTitle) {
			// 제목을 끌어서 이동
			dialogContent.append("h4").text(dialogTitle)
				.call(drag<HTMLHeadingElement, unknown>()
					.container(() => document.body)
					.on("drag", (event: D3DragEvent<HTMLHeadingElement, unknown, unknown>) => this.moveBy(event.dx, event.dy)));
		}
		this.dialogContent = dialogContent.node()!;
		this.popupDialog.node()!.showModal();

		return dialogContent;
	}

	setToolbar<E extends HTMLElement>(parent: Sel<E>, okText?: string): Sel<HTMLDivElement> {
		const toolbar = parent.append("div")
			.attr("class", "erd9Dialog-toolbar");

		if (okText)
			toolbar.append("button").attr("class", "primary").text(okText).on("click", () => this.closeWithOK());

		this.setCloseButton(toolbar);

		this.setDialogPosition();

		return toolbar;
	}

	setCloseButton<E extends HTMLElement>(parent: Sel<E>): void {
		parent.append("button")
			.text("Close")
			.on("click", () => this.close());
	}

	setDialogPosition(): void {
	    this.dialogContent.style.left = ((window.innerWidth - this.dialogContent.offsetWidth) / 2) + "px";
	    this.dialogContent.style.top  = ((window.innerHeight - this.dialogContent.offsetHeight) / 2) + "px";
	}

	private moveBy(dx: number, dy: number): void {
		const style = this.dialogContent.style;
		style.left = (parseFloat(style.left) || this.dialogContent.offsetLeft) + dx + "px";
		style.top  = (parseFloat(style.top) || this.dialogContent.offsetTop) + dy + "px";
	}
}

/** 탭 메뉴가 있는 다이얼로그 */
export class TabPopupDialog9 extends PopupDialog9 {
	setTabMenu<E extends HTMLElement> (parent: Sel<E>, menus: string[]): void {
		const tabMenu = parent.append("div").attr("class", "tab-container erd9Dialog-tabMenu");
		for(let i = 0; i<menus.length; i++){
			tabMenu.append("div").attr("id", `tab${i+1}`).attr("class", `tab`).text(menus[i]).on("click", this._switchTab.bind(this));
		}
		tabMenu.select(":first-child").classed("active", true);
	}

	private _switchTab(event: MouseEvent): void {
		this._switchTabByName( (event.target as HTMLElement).id );
	}

	_switchTabByName(tabName: string): void {
		this.dialogContent.querySelectorAll(".tab").forEach(element => element.classList.remove('active'));
		this.dialogContent.querySelector("#" + tabName)?.classList.add("active");
		this.dialogContent.querySelectorAll(".tab-content").forEach(element => element.classList.remove('active'));
		this.dialogContent.querySelector("." + tabName)?.classList.add("active");
		this.onChangeTab(tabName);
	}

	onChangeTab(_tabName: string): void {}
}
