// 새 엔터티 입력, 관계, 다대다, 자기참조, 글상자, 주제 영역
import { launch, shot, shotDialog, closeDialogs, openShop, entBox, entTitle, tool, relMid } from "./lib.mjs";

const { browser, page } = await launch();
await openShop(page);
const pad = (b, l = 30, t = 30, r = 30, btm = 30) => ({ x: b.x - l, y: b.y - t, width: b.width + l + r, height: b.height + t + btm });
const union = (...bs) => { const x = Math.min(...bs.map(b => b.x)), y = Math.min(...bs.map(b => b.y)); return { x, y, width: Math.max(...bs.map(b => b.x + b.width)) - x, height: Math.max(...bs.map(b => b.y + b.height)) - y }; };

// 새 엔터티를 만들고 컬럼 입력
await tool(page, "entityBtn");
await page.mouse.click(1000, 110);
await page.waitForTimeout(400);
await tool(page, "arrowBtn");
let b = await page.locator("g.erd-entity").last().boundingBox();
await page.mouse.dblclick(b.x + 30, b.y + 10);
await page.waitForTimeout(500);
await page.fill("dialog #tableName", "COUPON");
await page.fill("dialog #tableComments", "쿠폰");
const rows = page.locator("dialog .tablegrid-tbody tr");
const cell = async (r, c, text) => {
	await rows.nth(r).locator("td").nth(c).click();
	await page.waitForTimeout(150);
	await page.keyboard.press("Control+A");
	await page.keyboard.type(text);
	await page.waitForTimeout(150);
	await page.keyboard.press("Tab");
	await page.waitForTimeout(100);
};
await cell(0, 0, "COUPON_NO"); await cell(0, 1, "쿠폰번호"); await cell(0, 2, "INT");
await rows.nth(0).locator("td").nth(4).locator("input").check();
await page.click("dialog button[title='Add Column']");
await cell(1, 0, "COUPON_NM"); await cell(1, 1, "쿠폰명"); await cell(1, 2, "VARCHAR(50)");
await page.click("dialog button[title='Add Column']");
await cell(2, 0, "DISCOUNT_RATE"); await cell(2, 1, "할인율"); await cell(2, 2, "DECIMAL(5,2)");
await rows.nth(2).locator("td").nth(0).click();
await shotDialog(page, "entity-new-dialog");
await page.locator("dialog button.primary").click();
await page.waitForTimeout(500);

// 비식별 관계 그리기: CUSTOMER -> COUPON
await tool(page, "relationAKBtn");
let p = await entTitle(page, "CUSTOMER");
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(200);
p = await entTitle(page, "COUPON");
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(500);
await tool(page, "arrowBtn");
await page.mouse.click(1000, 800);
await shot(page, "relation-new", { clip: pad(union(await entBox(page, "CUSTOMER"), await entBox(page, "COUPON")), 20, 20, 20, 20) });

// 관계 다이얼로그
let m = await relMid(page, "CUSTOMER", "ORDERS");
await page.mouse.click(m.x, m.y);
await page.waitForTimeout(300);
await shot(page, "relation-selected", { clip: pad(union(await entBox(page, "CUSTOMER"), await entBox(page, "ORDERS")), 10, 10, 10, 10) });
await page.mouse.dblclick(m.x, m.y);
await page.waitForTimeout(500);
await shotDialog(page, "relation-dialog");
await closeDialogs(page);

// 자기참조 관계
await page.mouse.click(1000, 800);
await shot(page, "relation-self", { clip: pad(await entBox(page, "CATEGORY"), 10, 15, 90, 15) });

// 다대다: CUSTOMER - PRODUCT
await tool(page, "relationMNBtn");
p = await entTitle(page, "CUSTOMER");
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(200);
p = await entTitle(page, "PRODUCT");
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(800);
await tool(page, "arrowBtn");
await page.mouse.click(1000, 800);
await shot(page, "relation-mn", { clip: pad(union(await entBox(page, "CUSTOMER"), await entBox(page, "PRODUCT"), await entBox(page, "CATEGORY")), 10, 10, 10, 10) });

await browser.close();
