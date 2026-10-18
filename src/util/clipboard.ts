import { overlayHost } from "../ui";

/** 클립보드로 복사 */
export function copyToClipboard(text: string): void {
	const textarea = document.createElement("textarea");
	textarea.value = text;

	// 모달 다이얼로그가 열려 있으면 바깥 요소는 선택할 수 없으므로 다이얼로그 안에서 복사
	const host = overlayHost();
	host.appendChild(textarea);
	textarea.select();
	document.execCommand("copy");
	host.removeChild(textarea);
}
