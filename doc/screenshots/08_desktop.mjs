// 데스크톱 앱(Tauri): Database 메뉴 캡처.
// erd9.exe를 원격 디버깅 포트(WebView2)로 실행해서 연결하고, MariaDB의 캡처용 데이터베이스를 지우고 다시 만든다.
//   DB_PASSWORD (필수), DB_USER (root), DB_NAME (erd9_manual), MYSQL (mysql.exe 경로), ERD9_EXE (실행 파일 경로)
import { chromium } from "playwright-core";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { answers, closeDialogs, entTitle, here, menu, OUT, openShop, shot, shotDialog } from "./lib.mjs";

const PASSWORD = process.env.DB_PASSWORD;
if (!PASSWORD) throw new Error("Set DB_PASSWORD.");
const USER = process.env.DB_USER ?? "root";
const DB_NAME = process.env.DB_NAME ?? "erd9_manual";
const MYSQL = process.env.MYSQL ?? "C:/Program Files/MariaDB 10.6/bin/mysql.exe";
const EXE = process.env.ERD9_EXE ?? here("../../src-tauri/target/release/erd9.exe");
const PORT = 9222;

/** .erd9 파일을 저장할 폴더 (실행할 때마다 비운다) */
const FILE_DIR = path.join(os.tmpdir(), "erd9-manual");
fs.rmSync(FILE_DIR, { recursive: true, force: true });
fs.mkdirSync(FILE_DIR, { recursive: true });
/** 파일 대화상자(Windows)에 경로를 넣고 확인. out: 대화상자 캡처 */
const fileDialog = (file, out = "") => {
	execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", here("./filedialog.ps1"), "-Path", file, "-Out", out ? path.join(OUT, out + ".png") : ""]);
	if (out) console.log("saved", out);
};

const mysql = (sql, database = DB_NAME) => execFileSync(MYSQL, ["-u" + USER, "-p" + PASSWORD, ...(database ? [database] : []), "-e", sql]).toString();

// 캡처용 데이터베이스를 새로 만든다
mysql(`DROP DATABASE IF EXISTS ${DB_NAME}; CREATE DATABASE ${DB_NAME} CHARACTER SET utf8mb4;`, "");

const app = spawn(EXE, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` }, stdio: "ignore" });
let browser;
for (let i = 0; i < 30 && !browser; i++) {
	await new Promise(resolve => setTimeout(resolve, 1000));
	browser = await chromium.connectOverCDP(`http://localhost:${PORT}`).catch(() => undefined);
}
if (!browser) throw new Error("Cannot connect to the desktop app.");

try {
	const page = browser.contexts()[0].pages()[0];
	page.on("dialog", d => { console.log("[dialog]", d.type(), d.message().slice(0, 200).replace(/\n/g, " | ")); d.type() === "prompt" ? d.accept(answers.prompt) : d.accept(); });
	page.on("pageerror", e => console.log("[pageerror]", e.message));
	await page.waitForTimeout(1500);
	await page.evaluate(() => { localStorage.setItem("erd9.theme", "light"); localStorage.setItem("dontShow", "true"); document.documentElement.setAttribute("data-theme", "light"); });
	await closeDialogs(page);

	const fillConnection = async () => {
		const form = page.locator("dialog .dbConnection");
		await form.locator("select").selectOption("mariadb");
		const inputs = form.locator("input:not([type=checkbox])");		// Host, Port, Database, Schema, User, Password
		for (const [i, value] of ["localhost", "3306", DB_NAME, "", USER, PASSWORD].entries()) await inputs.nth(i).fill(value);
	};
	const clickBlank = async () => { await page.waitForTimeout(300); await page.mouse.click(1200, 780); };

	// 메뉴와 창 전체
	await openShop(page);
	await clickBlank();
	execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", here("./capwin.ps1"), "-Out", OUT + "/tauri-window.png"]);
	console.log("saved tauri-window");
	await menu(page, "databaseDropbtn");
	const b = await page.locator("#databaseDropbtn").boundingBox();
	const box = await page.locator("#databaseDropbtn + .dropdown-content").boundingBox();
	await shot(page, "menu-database", { clip: { x: b.x - 10, y: 0, width: Math.max(box.width, b.width) + 20, height: box.y + box.height + 10 } });
	await page.mouse.move(700, 600);

	// .erd9 파일: 저장(대화상자), 열기(대화상자), Files 메뉴, Compare ERD
	await page.keyboard.press("Control+s");
	fileDialog(path.join(FILE_DIR, "shop"), "file-save-desktop");
	await page.waitForTimeout(800);
	await shot(page, "filename-desktop", { clip: { x: 140, y: 0, width: 420, height: 68 } });
	await menu(page, "filesDropbtn", "newDocument");
	await menu(page, "filesDropbtn", "openFile");
	fileDialog(path.join(FILE_DIR, "shop.erd9"), "file-open-desktop");
	await page.waitForTimeout(1500);
	await clickBlank();
	await menu(page, "filesDropbtn");
	const fb = await page.locator("#filesDropbtn").boundingBox();
	const fbox = await page.locator("#filesDropbtn + .dropdown-content").boundingBox();
	await shot(page, "menu-files-desktop", { clip: { x: Math.max(0, fb.x - 10), y: 0, width: Math.max(fbox.width, fb.width) + 20, height: fbox.y + fbox.height + 10 } });
	await page.mouse.move(700, 600);
	// 저장한 뒤 수정한 내용을 저장한 파일과 비교
	const review = await entTitle(page, "REVIEW");
	await page.mouse.click(review.x, review.y);
	await page.waitForTimeout(300);
	await page.keyboard.press("Delete");
	await menu(page, "addonsDropbtn", "compareERD");
	await page.locator("dialog .exportBar button", { hasText: "Compare" }).click();
	await page.waitForTimeout(800);
	await shotDialog(page, "addon-compare-desktop");
	await closeDialogs(page);

	// Forward Engineering
	await openShop(page);
	await menu(page, "databaseDropbtn", "forwardEngineering");
	await page.waitForTimeout(500);
	await fillConnection();
	await shotDialog(page, "db-forward");
	await page.locator("dialog label", { hasText: "Drop existing objects first" }).locator("input").check();
	await page.waitForTimeout(300);
	await page.locator("dialog button", { hasText: "Execute" }).click();
	await page.waitForTimeout(4000);
	await shotDialog(page, "db-forward-done");
	await closeDialogs(page);

	// Reverse Engineering (새 문서)
	await menu(page, "filesDropbtn", "newDocument");
	await page.waitForTimeout(500);
	await menu(page, "databaseDropbtn", "reverseEngineering");
	await page.waitForTimeout(500);
	await fillConnection();
	await page.locator("dialog input[name=reverseTarget][value=new]").check();
	await page.locator("dialog button", { hasText: "Read schema" }).click();
	await page.waitForTimeout(3000);
	await shotDialog(page, "db-reverse");
	await page.locator("dialog .erd9Dialog-toolbar button", { hasText: "Import" }).click();
	await page.waitForTimeout(3000);
	await clickBlank();
	await shot(page, "db-reverse-result");
	await menu(page, "addonsDropbtn", "autoLayout");
	await page.waitForTimeout(1500);
	await clickBlank();
	await shot(page, "db-reverse-layout");

	// Compare and Merge: Forward Engineering에 사용한 쇼핑몰 ERD에서 CUSTOMER에 BIRTH_DT 추가
	await openShop(page);
	const t = await entTitle(page, "CUSTOMER");
	await page.mouse.dblclick(t.x, t.y);
	await page.waitForTimeout(400);
	await page.locator("dialog .tablegrid-tbody tr").last().locator("td").first().click();
	await page.click("dialog button[title='Add Column']");
	const row = page.locator("dialog .tablegrid-tbody tr").last();
	const cell = async (c, text) => { await row.locator("td").nth(c).click(); await page.waitForTimeout(150); await page.keyboard.press("Control+A"); await page.keyboard.type(text); await page.waitForTimeout(150); await page.keyboard.press("Tab"); await page.waitForTimeout(100); };
	await cell(0, "BIRTH_DT"); await cell(1, "생년월일"); await cell(2, "DATE");
	await page.locator("dialog button.primary").click();
	await page.waitForTimeout(400);
	// 그 사이 다른 사람이 DB에 직접 반영한 변경
	mysql("ALTER TABLE product ADD COLUMN ORIGIN_NM VARCHAR(50) NULL COMMENT '원산지'; " +
		  "CREATE TABLE faq (FAQ_ID INT NOT NULL AUTO_INCREMENT COMMENT 'FAQ ID', QUESTION VARCHAR(500) NOT NULL COMMENT '질문', ANSWER TEXT NULL COMMENT '답변', PRIMARY KEY (FAQ_ID)) COMMENT='자주 묻는 질문';");

	await menu(page, "databaseDropbtn", "syncDatabase");
	await page.waitForTimeout(500);
	await fillConnection();
	await page.locator("dialog .exportBar button", { hasText: "Compare" }).click();
	await page.waitForTimeout(3000);
	await shotDialog(page, "db-sync");
	// faq(DB에만 있음)와 product.ORIGIN_NM은 ERD로 가져온다
	const rows = page.locator("dialog .dbSyncItems tr");
	const n = await rows.count();
	for (let i = 1; i < n; i++) {
		if (/faq|product/i.test(await rows.nth(i).innerText())) await rows.nth(i).locator("select").selectOption("toERD");
	}
	await page.waitForTimeout(400);
	await shotDialog(page, "db-sync-direction");
	await page.locator("dialog .erd9Dialog-toolbar button", { hasText: "Apply" }).click();
	await page.waitForTimeout(5000);
	await shotDialog(page, "db-sync-done");
	await closeDialogs(page);
	await clickBlank();
	await page.keyboard.press("Control+-");
	await page.waitForTimeout(600);
	await shot(page, "db-sync-result");
} finally {
	await browser.close().catch(() => {});
	app.kill();
}
