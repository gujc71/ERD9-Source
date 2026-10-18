import { select } from "d3-selection";
import { AI_PROVIDERS, getAISettings, requestAI, setAISettings } from "./ai/aiClient";
import type { AIProvider, AISettings } from "./ai/aiClient";
import { PopupDialog9 } from "./dialogs/PopupDialog9";
import { sqlMakerManager } from "./sql/SQLMaker";
import { docObjects, entityMap, relationMap, state } from "./state";
import type { AIERDData, Sel } from "./types";
import { hideLoadingScreen, showLoadingScreen } from "./ui";

interface AIResult {
	resultCode: "ok" | "error";
	resultValue: string;
}

const FREE_MESSAGE = ".\n Based on the following DDL statement written for %dbms%. \n";
const EVA_MESSAGE = "The following SQL describes an entity-relationship model for %dbms%. Explain in %language% the evaluation and possible improvements for it. Present the results in Markdown. \n";

export async function sendMessage2AI(settings: AISettings, userMessage: string, jsonSchema?: Record<string, unknown>): Promise<AIResult> {
	showLoadingScreen();

	let botResponse: string, resultCode: AIResult["resultCode"] = "ok";

	try {
		botResponse = await requestAI(settings, userMessage, { jsonSchema });
	} catch (error){
        botResponse = error instanceof Error ? error.message : String(error);
		resultCode = "error";
	}

	hideLoadingScreen();

    return {resultCode:resultCode, resultValue: botResponse};
}

/** AI로 ERD 생성 요청. 실패하면 예외 */
export async function requestERDFromAI(settings: AISettings, userText: string): Promise<AIERDData> {
	// 응답 스키마/검증(zod)은 필요할 때만 불러온다 (코드 분할)
	const { buildERDPrompt, getERDJsonSchema, parseAIERD } = await import("./ai/erdSchema");
	const result = await sendMessage2AI(settings, buildERDPrompt(userText, state.dbmsType, settings.language), getERDJsonSchema());
	if (result.resultCode !== "ok") throw new Error(result.resultValue);
	try {
		return parseAIERD(result.resultValue);
	} catch {
		throw new Error("The AI response is not a valid ERD.\n\n" + result.resultValue);
	}
}

/** 오른쪽 아래 채팅 버튼과 채팅 입력창 */
export class WithAI9 {
	private chatBox: Sel<HTMLDivElement>;

    constructor() {
        const body = select("body");
        body.append("div").attr("class", "floatingMenu").attr("id", "floatingMenu").text("💬").attr("title", "chat with AI").on("click", this.ev_showChatingMenu.bind(this));

        this.chatBox = body.append("div").attr("class", "chatBox").attr("id", "chatBox");

		// optionGroup2
        this.chatBox.append("div").attr("class", "optionGroup").attr("id", "optionGroup2").style("display","none")
            .html("<label><input type='radio' name='entityType' value='all'> All entities</label>" +
                  "<label><input type='radio' name='entityType' value='selected' checked> Selected entities </label>");

        const optionGroup1 = this.chatBox.append("div").attr("class", "optionGroup")
             .html("<label><input type='radio' name='chatType' value='1' checked> Create Entity</label> <br>" +
                   "<label><input type='radio' name='chatType' value='2'> ERD review and feedback</label> <br>" +
                   "<label><input type='radio' name='chatType' value='3'> Free Talk (ex: Generate mybatis jave code)</label>");
        optionGroup1.selectAll('input[name="chatType"]')
                   .on('change', function(event: Event) {
                     const target = event.target as HTMLInputElement;
                     document.getElementById("optionGroup2")!.style.display = target.checked && target.value ==="1" ? "none" : "";
					 (document.getElementById("chatMessage") as HTMLTextAreaElement).disabled = target.value ==="2";
                   });

        const optionGroup3 = this.chatBox.append("div").attr("class", "chatInput");
            optionGroup3.append("textarea").attr("id", "chatMessage").attr("class", "chatMessage");
            optionGroup3.append("button").text("Send").on('click', this.ev_sendMessage.bind(this));
        this.chatBox.append("a").attr("class", "chatSettings").text("AI settings").on("click", () => new AISettingsDialog9(() => {}));
    }

    private ev_showChatingMenu(): void {
		if (getAISettings())
			 this.showChatingMenu();
		else new AISettingsDialog9(() => this.showChatingMenu());
    }
    showChatingMenu(): void {
        const chatBox = this.chatBox.node()!;
        chatBox.style.display = (chatBox.style.display === 'none' || chatBox.style.display === '') ? 'flex' : 'none';
    }

    private async ev_sendMessage(): Promise<void> {
		const settings = getAISettings();
		if (!settings) {
			new AISettingsDialog9(() => {});
			return;
		}

		const chatType: string = this.chatBox.select('input[name="chatType"]:checked').property('value');
        const entityType: string = this.chatBox.select('input[name="entityType"]:checked').property('value');
		const userText: string = this.chatBox.select("textarea").property('value');
		const selectList = state.selectMgr.getSelectList();

		if (chatType!=="1" && entityType!=="all" && selectList.length===0) {
			alert("Select the entities you worked with!");
			return;
		}
		if (chatType!=="2" && userText.trim().length===0) {
			alert("Enter your message!");
			return;
		}

		if (chatType==="1") {
			try {
				const { CreateERDwithAIDialog9 } = await import("./ai/aiERDDialog");
				new CreateERDwithAIDialog9().showResult(await requestERDFromAI(settings, userText));
			} catch (error) {
				alert(error instanceof Error ? error.message : String(error));
			}
			return;
		}

		const getSQL = () => entityType==="all" ? sqlMakerManager.getAllSQL(entityMap, relationMap, docObjects) : sqlMakerManager.getSQL(selectList);
		const userMessage = chatType==="2"
			? EVA_MESSAGE.replace("%language%", settings.language).replace("%dbms%", state.dbmsType) + getSQL()
			: userText + FREE_MESSAGE.replace("%dbms%", state.dbmsType) + "\n" + getSQL();

		const result = await sendMessage2AI(settings, userMessage) ;
        if (result.resultCode!=="ok") {
			alert(result.resultValue);
			return;
		}
		await new ShowResultAIDialog9(chatType==="2" ? "ERD review and feedback" : "Free Talk").showResult(result.resultValue);
    }
}

/* -----------------------------------------------------------------------------------
 * AI 설정: 공급자, 모델, API Key, 언어 (현재 창에서만 유지)
 */
export class AISettingsDialog9 extends PopupDialog9 {
	private onReady: () => void;
	private provider: Sel<HTMLSelectElement>;
	private apikey: Sel<HTMLInputElement>;
	private model: Sel<HTMLInputElement>;
	private modelList: Sel<HTMLDataListElement>;
	private language: Sel<HTMLInputElement>;

	/** onReady: 설정을 확인(테스트 호출 성공)한 뒤 실행 */
	constructor(onReady: () => void) {
		super();
		this.onReady = onReady;
		const saved = getAISettings();

		const dialogContent = this.setDialog("AI Settings", "wide");
		dialogContent.append("span").html("Choose the AI service, enter your API Key, and then click the 'Start' button.<br/>");

		const row0 = dialogContent.append("div").attr("class", "inputRow");
		row0.append("span").attr("class", "inputLabel").text("AI Service");
		this.provider = row0.append("select").attr("class", "width150");
		this.provider.selectAll("option")
			.data(Object.entries(AI_PROVIDERS))
			.enter()
			.append("option")
			.attr("value", d => d[0])
			.text(d => d[1].label);
		this.provider.on("change", () => this.setModels(true));

		const row1 = dialogContent.append("div").attr("class", "inputRow");
		row1.append("span").attr("class", "inputLabel").text("API Key");
		this.apikey = row1.append("input").attr("type", "password").attr("autocomplete", "off").attr("class", "inputApiKey");

		const row2 = dialogContent.append("div").attr("class", "inputRow");
		row2.append("span").attr("class", "inputLabel").text("Model");
		this.model = row2.append("input").attr("type", "text").attr("list", "aiModelList").attr("class", "width150");
		this.modelList = row2.append("datalist").attr("id", "aiModelList");
		row2.append("span").attr("class", "erd9Dialog-explain").text(" Select a suggestion or type any model name.");

		const row3 = dialogContent.append("div").attr("class", "inputRow");
		row3.append("span").attr("class", "inputLabel").text("Comment Language");
		this.language = row3.append("input").attr("type", "text").attr("value", "korean");

		if (saved) {
			this.provider.property("value", saved.provider);
			this.apikey.property("value", saved.apiKey);
			this.language.property("value", saved.language);
		}
		this.setModels(!saved);
		if (saved) this.model.property("value", saved.model);

		dialogContent.append("p").html("<b>Notes on use:</b> <br/>" +
									"1. The entered API Key is only used within the current window, and it will disappear once the window is closed.<br/>" +
									"&nbsp;&nbsp;&nbsp;&nbsp;The key is sent directly from this browser to the selected AI service. Do not use it on a shared computer.<br/>" +
									"2. The AI cannot remember previous messages. Write the full request every time, as shown below.<br/>" +
									"Chat 1: Shopping mall structure.<br/>" +
									"Chat 2: The inventory management structure of the mall.<br/>" +
									"Chat 3: The inventory and customer management structure of the mall.<br/>"
		);

		this.setToolbar(dialogContent, "Start");
	}

	/** 공급자에 맞는 모델 추천 목록. resetValue: 첫 번째 모델로 바꿈 */
	private setModels(resetValue: boolean): void {
		const models = AI_PROVIDERS[this.provider.property("value") as AIProvider].models;
		this.modelList.selectAll("option").remove();
		this.modelList.selectAll("option").data(models).enter().append("option").attr("value", d => d);
		if (resetValue) this.model.property("value", models[0]);
	}

	override async closeWithOK (): Promise<void> {
		const settings: AISettings = {
			provider: this.provider.property("value") as AIProvider,
			apiKey: this.apikey.property("value").trim(),
			model: this.model.property("value").trim(),
			language: this.language.property("value").trim() || "english",
		};
		if (!settings.apiKey) {
			alert ("Enter the API Key");
			return;
		}
		if (!settings.model) {
			alert ("Enter the model");
			return;
		}

		const result = await sendMessage2AI(settings, "hello");
		if (result.resultCode!=="ok") {
			alert(result.resultValue);
			return;
		}
		setAISettings(settings);
		this.close();
		this.onReady();
	}
}

/* AI - Create Entity 결과 다이얼로그는 ai/aiERDDialog (필요할 때 불러온다) */

/* -----------------------------------------------------------------------------------
 * AI - Show Result
 */
class ShowResultAIDialog9 extends PopupDialog9 {
	private editor: Sel<HTMLDivElement>;

	constructor(title: string) {
		super();
		const dialogContent = this.setDialog(title, "wide");

		this.editor = dialogContent.append("div").attr("id", "editorDDL").attr("class", "chatGPT-logger tab-logger");

		this.setToolbar(dialogContent);
	}

	async showResult(botResponse: string): Promise<void> {
		// 마크다운 변환기는 필요할 때만 불러온다 (코드 분할). AI 응답은 신뢰할 수 없으므로 DOMPurify로 정리 후 출력
		const [{ marked }, { default: DOMPurify }] = await Promise.all([import("marked"), import("dompurify")]);
		const html = await marked.parse(botResponse);
		this.editor.html(DOMPurify.sanitize(html));
	}
}
