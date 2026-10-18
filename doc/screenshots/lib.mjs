import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 이 폴더의 파일 경로 */
export const here = file => fileURLToPath(new URL(file, import.meta.url));
export const OUT = here("../images");
export const APP_URL = process.env.APP_URL ?? "http://localhost:4173/";
export const SHOP_SQL = fs.readFileSync(new URL("./shop.sql", import.meta.url), "utf8");
export const SHOP_JSON = here("./shop.json");
fs.mkdirSync(OUT, { recursive: true });

export const answers = { prompt: "" };
export async function launch({ url = APP_URL, width = 1400, height = 860 } = {}) {
	const browser = await chromium.launch({ channel: "msedge", headless: true });
	const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: "ko-KR", acceptDownloads: true });
	await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(url).origin });
	const page = await context.newPage();
	page.on("dialog", d => { console.log("[dialog]", d.type(), d.message().slice(0, 120)); d.type() === "prompt" ? d.accept(answers.prompt) : d.accept(); });
	page.on("pageerror", e => console.log("[pageerror]", e.message));
	await page.addInitScript(() => { try { localStorage.setItem("erd9.theme", "light"); } catch {} });
	await page.goto(url);
	await page.waitForTimeout(800);
	return { browser, context, page };
}

/** 전체 화면 */
export async function shot(page, name, opts = {}) {
	await page.waitForTimeout(opts.wait ?? 300);
	const file = path.join(OUT, name + ".png");
	if (opts.locator) await page.locator(opts.locator).first().screenshot({ path: file });
	else if (opts.clip) await page.screenshot({ path: file, clip: opts.clip });
	else await page.screenshot({ path: file });
	console.log("saved", name);
}

/** 맨 위 다이얼로그 내용 */
export async function shotDialog(page, name, opts = {}) {
	await page.waitForTimeout(opts.wait ?? 400);
	const file = path.join(OUT, name + ".png");
	await page.locator("dialog.erd9Dialog .erd9Dialog-content").last().screenshot({ path: file });
	console.log("saved", name);
}

export async function closeDialogs(page) {
	await page.evaluate(() => {
		document.querySelectorAll("dialog.erd9Dialog").forEach(d => d.dispatchEvent(new Event("cancel", { cancelable: true })));
	});
	await page.waitForTimeout(200);
}

export async function menu(page, button, item) {
	await page.hover("#" + button);
	await page.waitForTimeout(150);
	if (item) await page.click("#" + item);
	await page.waitForTimeout(400);
}

/** 쇼핑몰 문서 열기 (Import from Json) */
export async function openShop(page) {
	await closeDialogs(page);
	await menu(page, "filesDropbtn", "importFile");
	await page.locator("dialog.erd9Dialog input[type=file]").setInputFiles(SHOP_JSON);
	await page.locator("dialog.erd9Dialog button.primary").click();
	await page.waitForTimeout(800);
}

export const ent = (page, name) => page.locator("g.erd-entity", { has: page.locator("text.erd-title", { hasText: new RegExp(`^${name}$`) }) }).first();
export const entBox = (page, name) => ent(page, name).boundingBox();
export async function entTitle(page, name) {
	const b = await page.locator("g.erd-entity text.erd-title", { hasText: new RegExp(`^${name}$`) }).first().boundingBox();
	return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
export async function tool(page, id) { await page.locator("#" + id).dispatchEvent("mousedown"); await page.waitForTimeout(100); }

/** 두 엔터티 사이 관계선의 중간 지점 (화면 좌표) */
export async function relMid(page, parent, child) {
	return page.evaluate(([parent, child]) => {
		const title = g => g.querySelector("text.erd-title")?.textContent;
		const ents = [...document.querySelectorAll("g.erd-entity")];
		const pb = ents.find(g => title(g) === parent).getBoundingClientRect();
		const cb = ents.find(g => title(g) === child).getBoundingClientRect();
		let best = null;
		for (const g of document.querySelectorAll("g.erd-relation")) {
			const path = g.querySelector("path.erd-line");
			const len = path.getTotalLength();
			const s = path.getPointAtLength(0), e = path.getPointAtLength(len), m = path.getPointAtLength(len / 2);
			const ctm = path.getScreenCTM();
			const tr = p => ({ x: p.x * ctm.a + p.y * ctm.c + ctm.e, y: p.x * ctm.b + p.y * ctm.d + ctm.f });
			const S = tr(s), E = tr(e), M = tr(m);
			const near = (p, b) => p.x >= b.left - 30 && p.x <= b.right + 30 && p.y >= b.top - 30 && p.y <= b.bottom + 30;
			if ((near(S, pb) && near(E, cb)) || (near(S, cb) && near(E, pb))) best = M;
		}
		return best;
	}, [parent, child]);
}
