/**
 * 화면(뷰포트) 확대/축소와 이동 (d3-zoom).
 * 모든 도형은 state.canvas(<g>)에 그리고, 확대/이동은 canvas의 transform으로 처리한다.
 *
 *  - Ctrl(⌘) + 휠, 트랙패드 핀치: 마우스 위치 기준 확대/축소
 *  - 휠: 위아래 이동, Shift + 휠: 좌우 이동
 *  - 가운데 버튼 드래그, Space + 드래그: 이동
 *  - 터치: 한 손가락 이동, 두 손가락 확대/축소
 *  - 오른쪽/아래 스크롤바: 막대 드래그, 빈 곳 클릭은 한 화면씩 이동
 */
import { zoom, zoomIdentity, zoomTransform } from "d3-zoom";
import type { D3ZoomEvent, ZoomBehavior } from "d3-zoom";
import { state } from "../state";
import type { Rect } from "../types";

const MIN_SCALE = 0.2;
const MAX_SCALE = 3;
/** 키보드(Ctrl + +/-)로 한 번에 확대/축소하는 비율 */
const SCALE_STEP = 1.2;

let behavior: ZoomBehavior<SVGSVGElement, unknown>;
let spacePressed = false;

type Direction = "h" | "v";
interface Scrollbar { dir: Direction; track: HTMLDivElement; thumb: HTMLDivElement }
let scrollbars: Scrollbar[] = [];
/** svg 크기. 확대/이동할 때마다 clientWidth를 읽지 않도록 저장하고 창 크기가 바뀌면 갱신 */
let svgSize: { width: number; height: number } | null = null;
let scrollbarFrame = 0;

/** Space를 누르고 있는 동안은 드래그로 화면 이동 */
export function isPanKeyPressed(): boolean {
	return spacePressed;
}

function isEditable(target: EventTarget | null): boolean {
	return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

export function initViewport(): void {
	const svg = state.svg;

	behavior = zoom<SVGSVGElement, unknown>()
		.scaleExtent([MIN_SCALE, MAX_SCALE])
		.filter((event: MouseEvent | WheelEvent | TouchEvent) => {
			if (state.popupWindow) return false;
			if (event.type === "wheel") return event.ctrlKey || event.metaKey;
			if (event.type === "mousedown") return (event as MouseEvent).button === 1 || ((event as MouseEvent).button === 0 && spacePressed);
			return event.type.startsWith("touch");
		})
		// 마우스 휠 한 칸에 약 15%. 트랙패드 핀치는 값이 작으므로 크게
		.wheelDelta((event: WheelEvent) => -event.deltaY * (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002) * (Math.abs(event.deltaY) < 50 ? 10 : 1))
		.on("zoom", (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
			state.canvas.attr("transform", event.transform.toString());
			state.svgRate = event.transform.k;
			scheduleScrollbars();
		});
	setCanvasSize(state.canvasSize.width, state.canvasSize.height);

	svg.call(behavior)
		.on("dblclick.zoom", null);		// 더블 클릭은 도형 수정

	scrollbars = [createScrollbar("h"), createScrollbar("v")];
	// svg 크기가 바뀌면(창 크기, 옆 패널 등) 저장된 크기를 버림
	const onResize = () => {
		svgSize = null;
		scheduleScrollbars();
	};
	window.addEventListener("resize", onResize);
	if (typeof ResizeObserver === "function") new ResizeObserver(onResize).observe(svg.node()!);
	updateScrollbars();

	// Ctrl 없는 휠은 이동
	svg.on("wheel.pan", (event: WheelEvent) => {
		if (event.ctrlKey || event.metaKey || state.popupWindow) return;
		event.preventDefault();
		const k = state.svgRate;
		const horizontal = event.shiftKey && !event.deltaX;
		const unit = event.deltaMode === 1 ? 20 : event.deltaMode ? svg.node()!.clientHeight : 1;
		behavior.translateBy(svg, -(horizontal ? event.deltaY : event.deltaX) * unit / k, -(horizontal ? 0 : event.deltaY) * unit / k);
	}, { passive: false });

	window.addEventListener("keydown", event => {
		if (event.code !== "Space" || isEditable(event.target) || state.popupWindow) return;
		event.preventDefault();		// 포커스된 버튼이 눌리거나 화면이 스크롤되지 않도록
		spacePressed = true;
		svg.classed("panning", true);
	});
	window.addEventListener("keyup", event => {
		if (event.code !== "Space") return;
		spacePressed = false;
		svg.classed("panning", false);
	});
	window.addEventListener("blur", () => {
		spacePressed = false;
		svg.classed("panning", false);
	});
}

/** 이동할 수 있는 영역(캔버스) 크기 */
export function setCanvasSize(width: number, height: number): void {
	state.canvasSize = { width, height };
	behavior.translateExtent([[0, 0], [width, height]]);
	scheduleScrollbars();
}

/** direction: 1 확대, -1 축소, 0 원래 크기(100%). 화면 가운데 기준 */
export function zoomStep(direction: number): void {
	if (direction === 0) behavior.scaleTo(state.svg, 1);
	else behavior.scaleBy(state.svg, direction > 0 ? SCALE_STEP : 1 / SCALE_STEP);
}

/** 원래 크기로, 왼쪽 위로 이동 */
export function resetViewport(): void {
	behavior.transform(state.svg, zoomIdentity);
}

/** 캔버스의 (x, y)가 화면 왼쪽 위에 오도록 이동. 생략한 값은 현재 위치 유지 */
export function panTo(x?: number, y?: number): void {
	const [left, top] = zoomTransform(state.svg.node()!).invert([0, 0]);
	behavior.translateTo(state.svg, x ?? left, y ?? top, [0, 0]);
}

/** 영역이 화면에 보이지 않으면 보이도록 이동 */
export function scrollIntoView(rect: Rect, margin = 20): void {
	const node = state.svg.node()!;
	const transform = zoomTransform(node);
	const [left, top] = transform.invert([0, 0]);
	const [right, bottom] = transform.invert([node.clientWidth, node.clientHeight]);
	const outX = rect.x1 < left || rect.x2 > right, outY = rect.y1 < top || rect.y2 > bottom;
	if (outX || outY) panTo(outX ? rect.x1 - margin : left, outY ? rect.y1 - margin : top);
}

/** 화면에 보이는 영역의 크기 (캔버스 좌표, 100% 기준) */
export function getViewportSize(): { width: number; height: number } {
	const node = state.svg.node()!;
	return { width: node.clientWidth, height: node.clientHeight };
}

/** 저장된 svg 크기 (창 크기가 바뀌면 다시 읽음) */
function getSvgSize(): { width: number; height: number } {
	if (!svgSize) svgSize = getViewportSize();
	return svgSize;
}

/** 화면에 보이는 영역 (캔버스 좌표) */
function visibleRange(dir: Direction): { start: number; end: number; total: number } {
	const transform = zoomTransform(state.svg.node()!);
	const { width, height } = getSvgSize();
	const [left, top] = transform.invert([0, 0]);
	const [right, bottom] = transform.invert([width, height]);
	return dir === "h"
		? { start: left, end: right, total: state.canvasSize.width }
		: { start: top, end: bottom, total: state.canvasSize.height };
}

function panAxis(dir: Direction, value: number): void {
	if (dir === "h") panTo(value, undefined);
	else panTo(undefined, value);
}

function createScrollbar(dir: Direction): Scrollbar {
	const track = document.createElement("div");
	track.className = `viewport-scrollbar ${dir}`;
	const thumb = document.createElement("div");
	thumb.className = "thumb";
	track.append(thumb);
	document.body.append(track);

	const pos = (event: PointerEvent) => dir === "h" ? event.clientX : event.clientY;
	const trackLength = () => dir === "h" ? track.clientWidth : track.clientHeight;

	thumb.addEventListener("pointerdown", event => {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		thumb.setPointerCapture(event.pointerId);
		const startPointer = pos(event);
		const startValue = visibleRange(dir).start;
		const ratio = visibleRange(dir).total / trackLength();
		const onMove = (ev: PointerEvent) => panAxis(dir, startValue + (pos(ev) - startPointer) * ratio);
		const onUp = () => {
			thumb.removeEventListener("pointermove", onMove);
			thumb.removeEventListener("pointerup", onUp);
			thumb.removeEventListener("pointercancel", onUp);
		};
		thumb.addEventListener("pointermove", onMove);
		thumb.addEventListener("pointerup", onUp);
		thumb.addEventListener("pointercancel", onUp);
	});

	// 빈 곳 클릭: 클릭한 쪽으로 한 화면씩
	track.addEventListener("pointerdown", event => {
		if (event.target !== track || event.button !== 0) return;
		event.preventDefault();
		const { start, end } = visibleRange(dir);
		const rect = thumb.getBoundingClientRect();
		const before = pos(event) < (dir === "h" ? rect.left : rect.top);
		panAxis(dir, start + (before ? -1 : 1) * (end - start) * 0.9);
	});

	return { dir, track, thumb };
}

/** 스크롤바 갱신은 프레임당 한 번 (확대/이동 이벤트가 한 프레임에 여러 번 와도) */
function scheduleScrollbars(): void {
	if (scrollbarFrame) return;
	if (typeof requestAnimationFrame !== "function") {
		updateScrollbars();
		return;
	}
	scrollbarFrame = requestAnimationFrame(() => {
		scrollbarFrame = 0;
		updateScrollbars();
	});
}

function updateScrollbars(): void {
	// 모두 계산(읽기)한 다음 스타일을 바꿈(쓰기)
	const values = scrollbars.map(({ dir }) => {
		const { start, end, total } = visibleRange(dir);
		const size = Math.min(1, (end - start) / total);
		return { size, offset: Math.max(0, Math.min(1 - size, start / total)) };
	});
	scrollbars.forEach(({ dir, track, thumb }, i) => {
		const { size, offset } = values[i];
		track.classList.toggle("hidden", size >= 1);
		if (dir === "h") {
			thumb.style.left = `${offset * 100}%`;
			thumb.style.width = `${size * 100}%`;
		} else {
			thumb.style.top = `${offset * 100}%`;
			thumb.style.height = `${size * 100}%`;
		}
	});
}
