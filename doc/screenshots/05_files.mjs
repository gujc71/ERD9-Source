// 파일: 샘플, 저장, 열기, 이력, 비교, 이미지 내보내기, JSON 가져오기, 복구
import { answers, launch, shot, shotDialog, closeDialogs, menu, openShop, entTitle } from "./lib.mjs";

const { browser, page } = await launch();

// 샘플 열기
await page.locator("dialog .sampleTableBody tr").nth(1).click();
await page.locator("dialog button.primary").click();
await page.waitForTimeout(2500);
await shot(page, "sample-employee");
answers.prompt = "Employee";
await page.keyboard.press("Control+s");
await page.waitForTimeout(800);

// 쇼핑몰 저장
await openShop(page);
answers.prompt = "쇼핑몰";
await page.keyboard.press("Control+s");
await page.waitForTimeout(800);
await shot(page, "filename", { clip: { x: 260, y: 0, width: 420, height: 68 } });

// 수정 후 다시 저장 (이력)
let t = await entTitle(page, "CUSTOMER");
await page.mouse.dblclick(t.x, t.y);
await page.waitForTimeout(400);
await page.locator("dialog .tablegrid-tbody tr").last().locator("td").first().click();
await page.click("dialog button[title='Add Column']");
const row = page.locator("dialog .tablegrid-tbody tr").last();
const cell = async (c, text) => { await row.locator("td").nth(c).click(); await page.waitForTimeout(150); await page.keyboard.press("Control+A"); await page.keyboard.type(text); await page.waitForTimeout(150); await page.keyboard.press("Tab"); await page.waitForTimeout(100); };
await cell(0, "BIRTH_DT"); await cell(1, "생년월일"); await cell(2, "DATE");
await page.locator("dialog button.primary").click();
await page.waitForTimeout(400);
// PAYMENT 컬럼 이름 변경
t = await entTitle(page, "PAYMENT");
await page.mouse.dblclick(t.x, t.y);
await page.waitForTimeout(400);
await page.locator("dialog .tablegrid-tbody tr").nth(2).locator("td").first().click();
await page.keyboard.press("Control+A"); await page.keyboard.type("PAY_METHOD_CD"); await page.keyboard.press("Tab");
await page.locator("dialog button.primary").click();
await page.waitForTimeout(400);
await page.keyboard.press("Control+s");
await page.waitForTimeout(800);

// 열기
await menu(page, "filesDropbtn", "openFile");
await page.waitForTimeout(600);
await shotDialog(page, "file-open");
await closeDialogs(page);

// 이력
await menu(page, "filesDropbtn", "fileHistory");
await page.waitForTimeout(600);
await shotDialog(page, "file-history");
await page.locator("dialog .historyActions button", { hasText: "Compare" }).last().click();
await page.waitForTimeout(1000);
await shotDialog(page, "file-history-compare");
await closeDialogs(page);

// Compare ERD (Add-ons)
await menu(page, "addonsDropbtn", "compareERD");
await page.waitForTimeout(600);
await shotDialog(page, "addon-compare-empty");
await closeDialogs(page);

// 이미지 내보내기 & 인쇄
await page.mouse.click(1300, 800);
await menu(page, "filesDropbtn", "printFile");
await page.waitForTimeout(1500);
await shotDialog(page, "file-print");
await closeDialogs(page);

// JSON 가져오기
await menu(page, "filesDropbtn", "importFile");
await shotDialog(page, "file-import");
await closeDialogs(page);

// 복구: 저장하지 않은 변경 후 자동 저장, 다시 열기
t = await entTitle(page, "REVIEW");
await page.mouse.click(t.x, t.y);
await page.waitForTimeout(300);
await page.keyboard.press("Delete");
await page.waitForTimeout(300);
await page.evaluate(() => {
	Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
	document.dispatchEvent(new Event("visibilitychange"));
});
await page.waitForTimeout(1000);
await page.reload();
await page.waitForTimeout(1500);
await shotDialog(page, "file-recovery");

await browser.close();
