// 글상자, 주제 영역, 보기 모드, DBMS, 테마, 찾기, 확대/축소, 페이지
import { answers, launch, shot, shotDialog, closeDialogs, menu, openShop, entBox, entTitle, tool } from "./lib.mjs";

const { browser, page } = await launch();
await openShop(page);
const pad = (b, l = 30, t = 30, r = 30, btm = 30) => ({ x: b.x - l, y: b.y - t, width: b.width + l + r, height: b.height + t + btm });
const union = (...bs) => { const x = Math.min(...bs.map(b => b.x)), y = Math.min(...bs.map(b => b.y)); return { x, y, width: Math.max(...bs.map(b => b.x + b.width)) - x, height: Math.max(...bs.map(b => b.y + b.height)) - y }; };

// 글상자
await tool(page, "textBtn");
await page.mouse.click(960, 560);
await page.waitForTimeout(400);
await tool(page, "arrowBtn");
const text = page.locator("g.canvas > g:not(.erd-entity):not(.erd-relation)").last();
let tb = await page.evaluate(() => {
	const g = [...document.querySelectorAll("g.canvas > g")].filter(g => g.id.startsWith("t") || g.querySelector("foreignObject, text") && !g.classList.contains("erd-entity") && !g.classList.contains("erd-relation")).pop();
	const b = g.getBoundingClientRect(); return { id: g.id, x: b.x, y: b.y, width: b.width, height: b.height };
});
await page.mouse.dblclick(tb.x + 10, tb.y + 8);
await page.waitForTimeout(400);
await page.fill("dialog textarea", "주문 처리 흐름\n1. 고객이 주문(ORDERS)을 생성\n2. 결제(PAYMENT) 완료 후 배송(DELIVERY) 시작\n3. 배송 완료 후 리뷰(REVIEW) 작성 가능");
await shotDialog(page, "text-dialog");
await page.locator("dialog button.primary").click();
await page.waitForTimeout(400);
tb = await page.evaluate(id => { const b = document.getElementById(id).getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }, tb.id);
await page.mouse.click(1300, 800);
await shot(page, "text-box", { clip: pad(tb, 20, 20, 20, 20) });

// 주제 영역: ORDERS 주변
const o = await entBox(page, "ORDERS");
await tool(page, "areaBtn");
await page.mouse.click(o.x - 15, o.y - 30);
await page.waitForTimeout(400);
await tool(page, "arrowBtn");
const area = await page.evaluate(() => { const g = [...document.querySelectorAll("g.canvas > g")].find(g => g.id.startsWith("ar")); const b = g.getBoundingClientRect(); return { id: g.id, x: b.x, y: b.y, width: b.width, height: b.height }; });
// 크기 조절 핸들 끌기
await page.mouse.move(area.x + area.width - 5, area.y + area.height - 5);
await page.mouse.down();
await page.mouse.move(o.x + o.width + 20, o.y + o.height + 20, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
// 이름 더블 클릭
await page.mouse.dblclick(area.x + 30, area.y + 14);
await page.waitForTimeout(400);
await page.fill("dialog input[type=text]", "주문 영역");
await page.locator("dialog .colorSwatch").nth(2).click();
await shotDialog(page, "area-dialog");
await page.locator("dialog button.primary").click();
await page.waitForTimeout(300);
await page.mouse.click(1300, 800);
await shot(page, "area", { clip: pad(o, 40, 50, 40, 40) });
await shot(page, "main-with-text-area");

// 엔터티 색상
let t = await entTitle(page, "CUSTOMER");
await page.mouse.dblclick(t.x, t.y);
await page.waitForTimeout(400);
await page.locator("dialog .colorSwatch").nth(1).click();
await page.locator("dialog button.primary").click();
t = await entTitle(page, "PRODUCT");
await page.mouse.dblclick(t.x, t.y);
await page.waitForTimeout(400);
await page.locator("dialog .colorSwatch").nth(3).click();
await page.locator("dialog button.primary").click();
await page.waitForTimeout(300);
await page.mouse.click(1300, 800);
await shot(page, "entity-color", { clip: pad(union(await entBox(page, "CUSTOMER"), await entBox(page, "PRODUCT")), 10, 10, 10, 10) });

// 보기 모드
await page.locator("#logicalBtn").dispatchEvent("mousedown");
await page.waitForTimeout(500);
await shot(page, "view-both");
await page.locator("#physicalBtn").dispatchEvent("mousedown");
await page.waitForTimeout(500);
await shot(page, "view-logical");
await page.locator("#physicalBtn").dispatchEvent("mousedown");
await page.waitForTimeout(600);
await page.locator("#logicalBtn").dispatchEvent("mousedown");
await page.waitForTimeout(600);
await menu(page, "view_DataDropbtn", "view_data_entity");
await page.waitForTimeout(500);
await shot(page, "view-entity");
await menu(page, "view_DataDropbtn", "view_data_keys");
await page.waitForTimeout(500);
await shot(page, "view-keys");
await menu(page, "view_DataDropbtn", "view_data_all");

// 테마
await page.hover("#themeDropbtn");
await page.waitForTimeout(300);
await shot(page, "theme-menu", { clip: { x: 1180, y: 0, width: 220, height: 170 } });
await page.click("[data-theme-choice=dark]");
await page.waitForTimeout(500);
await page.mouse.move(700, 820);
await shot(page, "theme-dark");
await page.hover("#themeDropbtn");
await page.click("[data-theme-choice=light]");
await page.mouse.move(700, 820);

// DBMS 변경
await menu(page, "dbmsDropbtn", "dbms4oracle");
await page.waitForTimeout(500);
await shot(page, "dbms-oracle", { clip: pad(union(await entBox(page, "CUSTOMER"), await entBox(page, "ORDERS")), 10, 10, 10, 10) });
await menu(page, "dbmsDropbtn", "dbms4mariadb");
await page.waitForTimeout(500);
// 되돌리면 원래 타입 (TINYINT, TEXT)
console.log("REVIEW after round trip:", await page.locator("g.erd-entity", { hasText: "REVIEW" }).first().locator("text.erd-col-type").allTextContents());

// 찾기
await openShop(page);
await page.keyboard.press("Control+f");
await page.waitForTimeout(300);
await page.keyboard.type("CUST");
await page.waitForTimeout(500);
await shot(page, "find");
await page.keyboard.press("Escape");


// 페이지: ORDERS 관련 엔터티 선택 후 +
await page.mouse.click(1300, 800);
await page.waitForTimeout(400);
await page.mouse.move(335, 78);
await page.mouse.down();
await page.mouse.move(900, 600, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(300);
await shot(page, "page-select");
answers.prompt = "주문";
await page.locator(".pageTabs .pageAdd, [title^='New page']").first().click();
await page.waitForTimeout(500);
if (await page.locator("dialog").count()) {
	await page.fill("dialog input[type=text]", "주문");
	await shotDialog(page, "page-dialog");
	await page.locator("dialog button.primary").click();
	await page.waitForTimeout(500);
}
await page.mouse.click(1300, 800);
await shot(page, "page-tab");
const tab = page.locator("text=주문").last();
await page.locator("[title*='Double-click to edit']").first().dblclick();
await page.waitForTimeout(500);
await shotDialog(page, "page-dialog");
await closeDialogs(page);

await page.locator("[title='All entities']").first().click();
await page.waitForTimeout(500);
// 확대/축소
await page.keyboard.press("Control+-");
await page.keyboard.press("Control+-");
await page.waitForTimeout(400);
await shot(page, "zoom-out");
await page.keyboard.press("Control+0");

await browser.close();
