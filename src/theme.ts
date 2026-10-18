/**
 * 화면 테마 (라이트 / 다크 / 시스템 설정 따름).
 * <html data-theme="light|dark">로 적용하고 선택은 localStorage에 저장한다.
 * 첫 화면이 깜빡이지 않도록 index.html의 인라인 스크립트가 먼저 같은 규칙으로 적용한다.
 * 이미지 내보내기와 인쇄는 테마와 상관없이 언제나 밝은 색으로 만든다 (export/imageExport).
 */
import { hideDropdown } from "./ui";

export type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "erd9.theme";
const darkQuery = window.matchMedia?.("(prefers-color-scheme: dark)");

export function getThemeChoice(): ThemeChoice {
	try {
		const value = localStorage.getItem(STORAGE_KEY);
		if (value === "light" || value === "dark" || value === "system") return value;
	} catch { /* 저장소를 쓸 수 없으면 기본값 */ }
	return "system";
}

function resolveTheme(choice: ThemeChoice): "light" | "dark" {
	if (choice === "system") return darkQuery?.matches ? "dark" : "light";
	return choice;
}

function applyTheme(choice: ThemeChoice): void {
	document.documentElement.dataset.theme = resolveTheme(choice);
	document.querySelectorAll<HTMLElement>("[data-theme-choice]").forEach(item => {
		item.classList.toggle("checked", item.dataset.themeChoice === choice);
	});
	const button = document.getElementById("themeDropbtn");
	if (button) {
		button.dataset.choice = choice;
		button.title = `Theme: ${choice[0].toUpperCase()}${choice.slice(1)}`;
	}
}

export function setThemeChoice(choice: ThemeChoice): void {
	try {
		localStorage.setItem(STORAGE_KEY, choice);
	} catch { /* 저장하지 못해도 현재 화면에는 적용 */ }
	applyTheme(choice);
}

export function initTheme(): void {
	applyTheme(getThemeChoice());

	// 시스템 설정을 따르는 중이면 OS 테마가 바뀔 때 함께 바꾼다
	darkQuery?.addEventListener("change", () => {
		if (getThemeChoice() === "system") applyTheme("system");
	});

	const dropdown = document.getElementById("themeDropdown");
	const content = dropdown?.querySelector<HTMLElement>(".dropdown-content");
	if (!dropdown || !content) return;
	dropdown.querySelector("button")?.addEventListener("mouseover", () => { content.style.display = "block"; });
	dropdown.addEventListener("mouseleave", hideDropdown);
	content.querySelectorAll<HTMLElement>("[data-theme-choice]").forEach(item => {
		item.addEventListener("click", () => {
			setThemeChoice(item.dataset.themeChoice as ThemeChoice);
			hideDropdown();
		});
	});
}
