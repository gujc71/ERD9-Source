/**
 * SVG 요소 크기 측정.
 * getBBox()는 요소 자신의 사용자 좌표(확대/축소, 이동과 무관)로 크기를 돌려준다.
 * 화면에 그려지지 않은 요소(display:none)나 getBBox가 없는 환경(jsdom)에서는 0.
 */
export function measureBox(node: SVGGraphicsElement | null | undefined): { width: number; height: number } {
	if (!node || typeof node.getBBox !== "function") return { width: 0, height: 0 };
	try {
		const box = node.getBBox();
		return { width: box.width, height: box.height };
	} catch {
		return { width: 0, height: 0 };		// Firefox: 그려지지 않은 요소는 예외
	}
}

export function measureWidth(node: SVGGraphicsElement | null | undefined): number {
	return measureBox(node).width;
}
