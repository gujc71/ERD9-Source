// Add-ons
import { answers, here, launch, shot, shotDialog, closeDialogs, menu, openShop, entTitle, SHOP_SQL } from "./lib.mjs";

const { browser, page } = await launch();
await closeDialogs(page);

// 자동 배치: DDL을 가져온 직후 / 자동 배치 후
await page.evaluate(t => navigator.clipboard.writeText(t), SHOP_SQL);
await menu(page, "addonsDropbtn", "simpleImportDDL");
await page.click("#pasteButton4DDL");
await page.waitForTimeout(400);
await page.click("dialog .tab-content.tab1 #runButton4DDL");
await page.waitForTimeout(1500);
await closeDialogs(page);
await page.mouse.move(700, 820);
await shot(page, "autolayout-before");
await menu(page, "addonsDropbtn", "autoLayout");
await page.waitForTimeout(1500);
await page.mouse.move(700, 820);
await shot(page, "autolayout-after");

await openShop(page);

// Generate DDL
await menu(page, "addonsDropbtn", "generateDDL");
await page.locator("dialog button", { hasText: "Generate DDL" }).click();
await page.waitForTimeout(600);
await shotDialog(page, "addon-ddl");
await closeDialogs(page);

// Table Description
await menu(page, "addonsDropbtn", "tableDescription");
await page.waitForTimeout(300);
const genBtn = page.locator("dialog .erd9Dialog-content > div > button").first();
await genBtn.click();
await page.waitForTimeout(800);
await page.evaluate(() => { const e = document.querySelector("dialog #editorDDL"); if (e) e.scrollTop = 0; });
await shotDialog(page, "addon-tabledesc");
await closeDialogs(page);

// Detect Missing Relationship
await menu(page, "addonsDropbtn", "detectRelationship");
await page.waitForTimeout(800);
await shotDialog(page, "addon-detect-missing");
await page.locator("dialog .tab", { hasText: "Not Match" }).click();
await page.waitForTimeout(400);
await shotDialog(page, "addon-detect-notmatch");
await closeDialogs(page);

// Views & Sequences
await menu(page, "addonsDropbtn", "viewsSequences");
await page.locator("dialog .viewList li").first().click();
await page.waitForTimeout(300);
await shotDialog(page, "addon-views");
await page.locator("dialog .tab", { hasText: "Sequences" }).click();
await page.locator("dialog .tab2 button", { hasText: "New" }).click();
await page.fill("dialog #seqName", "SEQ_ORDER_NO");
await page.fill("dialog #seqStart", "1000");
await page.fill("dialog #seqIncrement", "1");
await page.locator("dialog .tab2 button", { hasText: "Apply" }).click();
await page.waitForTimeout(300);
await shotDialog(page, "addon-sequences");
await page.locator("dialog button.primary").click();
await page.waitForTimeout(300);

// Column Templates
await menu(page, "addonsDropbtn", "columnTemplates");
await page.waitForTimeout(400);
await shotDialog(page, "addon-templates");
await closeDialogs(page);
// 엔터티 다이얼로그에서 템플릿 사용
let t = await entTitle(page, "COUPON").catch(() => null);
t = await entTitle(page, "DELIVERY");
await page.mouse.dblclick(t.x, t.y);
await page.waitForTimeout(400);
await page.locator("dialog select.templateSelect").selectOption({ label: "Audit columns" });
await page.waitForTimeout(400);
await shotDialog(page, "entity-template");
await closeDialogs(page);

// Domains & Standards
await menu(page, "addonsDropbtn", "standards");
await page.waitForTimeout(400);
const importCSV = async (tab, file) => {
	const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.locator(`dialog .${tab} .std-toolbar button`, { hasText: "Import CSV" }).click()]);
	await chooser.setFiles(here(file));
	await page.waitForTimeout(500);
};
await importCSV("tab1", "domains.csv");
await shotDialog(page, "std-domains");
await page.locator("dialog .tab", { hasText: "Words" }).click();
await importCSV("tab2", "words.csv");
await shotDialog(page, "std-words");
await page.locator("dialog .tab", { hasText: "Check" }).click();
await page.locator("dialog .tab4 .std-toolbar button", { hasText: /^Check$/ }).click();
await page.waitForTimeout(600);
await shotDialog(page, "std-check");
await page.locator("dialog .tab", { hasText: "Terms" }).click();
await page.locator("dialog .tab3 .std-toolbar button", { hasText: "Extract from ERD" }).click();
await page.waitForTimeout(600);
await shotDialog(page, "std-terms");
await page.locator("dialog button.primary").click();
await page.waitForTimeout(400);

// 엔터티 다이얼로그: 용어 추천, 도메인, Standardize
t = await entTitle(page, "PAYMENT");
await page.mouse.dblclick(t.x, t.y);
await page.waitForTimeout(400);
await page.locator("dialog .tablegrid-tbody tr").last().locator("td").first().click();
await page.click("dialog button[title='Add Column']");
const row = page.locator("dialog .tablegrid-tbody tr").last();
await row.locator("td").nth(1).click();
await page.waitForTimeout(200);
await page.keyboard.type("결제");
await page.waitForTimeout(600);
await shotDialog(page, "entity-term-suggest");
await page.keyboard.type("상태");
await page.waitForTimeout(300);
await page.keyboard.press("Tab");
await page.waitForTimeout(300);
await shotDialog(page, "entity-term-convert");
await row.locator("td").last().click();
await page.waitForTimeout(300);
await row.locator("td").last().locator("select").selectOption({ label: "상태 (VARCHAR(10))" });
await page.waitForTimeout(300);
await row.locator("td").first().click();
await page.waitForTimeout(200);
await shotDialog(page, "entity-domain");
await page.locator("dialog button", { hasText: "Standardize" }).click();
await page.waitForTimeout(500);
await shotDialog(page, "entity-standardize");
await closeDialogs(page);

// Generate Logical Names: 논리명이 없는 Employee 샘플
answers.prompt = "";
await menu(page, "filesDropbtn", "openSamples");
await page.locator("dialog .sampleTableBody tr").nth(1).click();
await page.locator("dialog button.primary").click();
await page.waitForTimeout(2500);
await menu(page, "addonsDropbtn", "generateLogicalNames");
await page.waitForTimeout(400);
await page.locator("dialog .logicalDictionaries input").first().check();
await page.locator("dialog .logicalDictionaries input").nth(1).check();
await page.locator("dialog button", { hasText: "Generate Logical Names" }).click();
await page.waitForTimeout(1500);
await shotDialog(page, "addon-logicalnames");
await closeDialogs(page);

await browser.close();
