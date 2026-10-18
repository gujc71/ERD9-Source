// 화면 구성, 엔터티, 관계, 글상자, 주제 영역
import { launch, shot, shotDialog, closeDialogs, menu, openShop } from "./lib.mjs";

const { browser, page } = await launch();
await openShop(page);

const ent = name => page.locator("g.erd-entity", { has: page.locator("text.erd-title", { hasText: new RegExp(`^${name}$`) }) }).first();
const box = async name => await ent(name).boundingBox();
const title = async name => { const b = await page.locator("g.erd-entity text.erd-title", { hasText: new RegExp(`^${name}$`) }).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const tool = async id => { await page.locator("#" + id).dispatchEvent("mousedown"); await page.waitForTimeout(100); };

await page.mouse.click(1000, 800);
await shot(page, "main-screen");
await shot(page, "toolbar", { clip: { x: 0, y: 0, width: 1400, height: 68 } });
await shot(page, "toolbar-tools", { locator: ".btn-group" });

// 엔터티 선택: 도형 메뉴(ⓧ ⓔ)
let t = await title("CUSTOMER");
await page.mouse.click(t.x, t.y);
let b = await box("CUSTOMER");
await shot(page, "entity-selected", { clip: { x: b.x - 20, y: b.y - 20, width: b.width + 60, height: b.height + 40 } });

// 엔터티 다이얼로그
await page.mouse.dblclick(t.x, t.y);
await page.waitForTimeout(500);
await shotDialog(page, "entity-dialog");
// 데이터 타입 자동완성
await page.locator("dialog .tablegrid-tbody tr").nth(2).locator("td").nth(2).click();
await page.waitForTimeout(300);
await page.keyboard.press("Control+A");
await page.keyboard.type("D");
await page.waitForTimeout(400);
await shotDialog(page, "entity-datatype");
await page.keyboard.press("Escape").catch(() => {});
await closeDialogs(page);
await openShop(page);

// Index / Check
t = await title("PRODUCT");
await page.mouse.dblclick(t.x, t.y);
await page.waitForTimeout(500);
await page.click("#editIndexBtn");
await page.waitForTimeout(300);
await page.locator("dialog .tableindexList li").first().click();
await page.waitForTimeout(300);
await shotDialog(page, "entity-index");
await closeDialogs(page);

// 새 엔터티
await page.mouse.click(1000, 800);
await tool("entityBtn");
await page.mouse.click(1000, 120);
await page.waitForTimeout(400);
await tool("arrowBtn");
b = await page.locator("g.erd-entity").last().boundingBox();
await shot(page, "entity-new", { clip: { x: b.x - 30, y: b.y - 30, width: b.width + 80, height: b.height + 60 } });
// 컬럼 입력은 03_relation.mjs (entity-new-dialog)

await browser.close();
