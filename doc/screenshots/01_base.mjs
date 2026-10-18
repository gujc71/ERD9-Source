// 쇼핑몰 DDL을 가져와서 기본 문서(shop.json)를 만들고, 시작 화면과 DDL 가져오기를 캡처
import fs from "node:fs";
import { launch, shot, shotDialog, closeDialogs, menu, SHOP_SQL, SHOP_JSON } from "./lib.mjs";

const { browser, page } = await launch();

// 처음 실행: 샘플 다이얼로그
await shot(page, "start-samples");
await closeDialogs(page);
await shot(page, "main-empty");

// 메뉴 펼침 캡처
for (const [btn, name] of [["filesDropbtn", "menu-files"], ["addonsDropbtn", "menu-addons"], ["dbmsDropbtn", "menu-dbms"], ["view_DataDropbtn", "menu-viewdata"]]) {
	await menu(page, btn);
	const box = await page.locator(`#${btn} + .dropdown-content`).boundingBox();
	const b = await page.locator("#" + btn).boundingBox();
	await shot(page, name, { clip: { x: Math.max(0, b.x - 10), y: 0, width: Math.max(box.width, b.width) + 20, height: box.y + box.height + 10 } });
	await page.mouse.move(700, 600);
	await page.waitForTimeout(200);
}

// DDL 가져오기
await page.evaluate(t => navigator.clipboard.writeText(t), SHOP_SQL);
await menu(page, "addonsDropbtn", "simpleImportDDL");
await page.click("#pasteButton4DDL");
await page.waitForTimeout(500);
await shotDialog(page, "addon-importddl-sql");
await page.click("#previewButton4DDL");
await page.waitForTimeout(800);
await page.evaluate(() => { const e = document.querySelector("dialog #previewDiv"); if (e) e.scrollTop = 0; });
await shotDialog(page, "addon-importddl-preview");
await page.locator("dialog .tab-content.tab2 #runButton4DDL").click();
await page.waitForTimeout(1500);
await shotDialog(page, "addon-importddl-log");
await closeDialogs(page);

await menu(page, "addonsDropbtn", "autoLayout");
await page.waitForTimeout(1500);
await shot(page, "after-import");

const [download] = await Promise.all([page.waitForEvent("download"), menu(page, "filesDropbtn", "exportFile")]);
await download.saveAs(SHOP_JSON);
console.log("exported", fs.statSync(SHOP_JSON).size);

await browser.close();
