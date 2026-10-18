/**
 * AI 채팅 - Create Entity 결과 다이얼로그 (withAI에서 필요할 때 불러온다)
 */
import { STATE_TYPE } from "../constants";
import { makeERDFromAI, showERDFromAI } from "../dialogs/aiERD";
import { PopupDialog9 } from "../dialogs/PopupDialog9";
import { state } from "../state";
import type { AIERDData, Sel } from "../types";

export class CreateERDwithAIDialog9 extends PopupDialog9 {
	private editor: Sel<HTMLDivElement>;
	private erdData: AIERDData | null = null;

	constructor() {
		super();
		const dialogContent = this.setDialog("Create ERD with AI", "wide");
		dialogContent.append("span").html("Check the result, then click the 'Make ERD' button.");

		this.editor = dialogContent.append("div").attr("id", "editorDDL").attr("class", "chatGPT-logger tab-logger");

		this.setToolbar(dialogContent, "Make ERD");
	}

	showResult(erdData: AIERDData): void {
		this.erdData = erdData;
		showERDFromAI(this.editor.node()!, erdData);
	}

	override closeWithOK (): void {	// make ERD
		if (!this.erdData) return;

		state.diagramStack.saveState(STATE_TYPE.MULTY_CREATE, makeERDFromAI(this.erdData));
		this.close();
	}
}
