// AI 설정, Make ERD with AI, 채팅 (키 확인 요청만 가짜 응답으로 처리)
import { launch, shot, shotDialog, closeDialogs, menu, openShop } from "./lib.mjs";
const { browser, page } = await launch();
await page.route("https://api.anthropic.com/**", route => {
	const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS", "content-type": "application/json" };
	if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
	return route.fulfill({ status: 200, headers, body: JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: "Hello" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }) });
});
await openShop(page);
// AI: 설정과 Make ERD with AI
await menu(page, "addonsDropbtn", "makeERDwithAI");
await page.waitForTimeout(400);
await page.locator("dialog select").first().selectOption({ index: 1 });
await page.waitForTimeout(200);
await page.fill("dialog .inputApiKey", "sk-ant-api03-xxxxxxxxxxxxxxxxxxxx");
await shotDialog(page, "ai-settings");
await page.locator("dialog button.primary").click();
await page.waitForTimeout(400);
await page.fill("dialog textarea.inputQuestion", "온라인 쇼핑몰의 회원, 상품, 주문, 결제 구조");
await shotDialog(page, "ai-make-erd");
await closeDialogs(page);

// 채팅 창
await page.click("#floatingMenu");
await page.waitForTimeout(500);
await page.locator("#chatBox input[name=chatType][value='3']").check();
await page.fill("#chatMessage", "선택한 엔터티로 MyBatis 매퍼 XML을 만들어 줘");
await shot(page, "ai-chat", { clip: { x: 1000, y: 490, width: 400, height: 370 } });

await browser.close();
