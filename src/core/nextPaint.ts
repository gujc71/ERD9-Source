/**
 * 화면이 한 번 그려진 다음에 이어서 실행.
 * 로딩 화면을 띄운 직후 무거운 작업을 동기로 실행하면 로딩 화면이 그려지지 않으므로,
 * requestAnimationFrame(그리기 직전) 안에서 setTimeout으로 그린 다음으로 넘긴다.
 */
export function nextPaint(): Promise<void> {
	return new Promise(resolve => {
		if (typeof requestAnimationFrame !== "function") {
			setTimeout(resolve, 0);
			return;
		}
		requestAnimationFrame(() => setTimeout(resolve, 0));
	});
}
