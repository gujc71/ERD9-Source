import { select } from "d3-selection";

/** 열린 모달 다이얼로그는 화면 맨 위(top layer)에 그려지므로, 그 위에 띄울 요소는 다이얼로그 안에 넣어야 보인다 */
export function overlayHost(): HTMLElement {
	const dialogs = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
	return dialogs[dialogs.length - 1] ?? document.body;
}

/** 작업 중 표시. 모달 다이얼로그로 띄워 열린 다이얼로그 위에 보이고 입력을 막는다 */
export function showLoadingScreen(): void {
	const loadingScreen = select("body").append("dialog")
		.attr("id", "loadingScreen")
		.attr("class", "loading-screen")
		.on("cancel", (event: Event) => event.preventDefault());

	loadingScreen.append("div")
		.attr("class", "loader");
	loadingScreen.node()!.showModal();
}

export function hideLoadingScreen(): void {
	select("#loadingScreen").remove();
}

export function showDropdown(event: MouseEvent): void {
	const dropdownContent = (event.target as HTMLElement).parentElement?.querySelector<HTMLElement>('.dropdown-content');
	if (dropdownContent) dropdownContent.style.display = 'block';
}

export function hideDropdown(): void {
	document.querySelectorAll<HTMLElement>('.dropdown-content').forEach(content => {
		content.style.display = 'none';
	});
}

/** 오늘이면 시간, 아니면 날짜 */
export function getDateText(today: Date, updateDate?: number): string {
	const date = new Date(updateDate ?? 0);
	if (today.toLocaleDateString() === date.toLocaleDateString() )
		 return date.getHours() + ":" + date.getMinutes() + ":" + date.getSeconds();
	return date.toLocaleDateString();
}
