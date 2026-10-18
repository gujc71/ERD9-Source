/**
 * ERD 이미지 내보내기 (SVG / PNG).
 * 화면의 SVG를 복제해 대상 도형만 남기고, 도형들이 차지하는 영역에 맞춰 잘라낸다.
 */
import { isDiagramVisible } from "../core/pages";
import { Relation9 } from "../diagram/Relation9";
import { sqlMakerManager } from "../sql/SQLMaker";
import { areaMap, entityMap, relationMap, state, textMap } from "../state";
import type { AnyDiagram } from "../state";

export interface ImageExportOptions {
	/** 선택된 도형만 */
	selectedOnly: boolean;
	/** 배경 투명 (PNG) */
	transparent: boolean;
}

export interface ExportedSVG {
	svg: SVGSVGElement;
	width: number;
	height: number;
}

const MARGIN = 20;
const SVG_NS = "http://www.w3.org/2000/svg";

/** 내보낼 도형 목록. 선택된 도형만이면 선택된 도형끼리의 관계도 포함 */
function getTargets(selectedOnly: boolean): AnyDiagram[] {
	// 현재 페이지에 보이는 도형만
	if (!selectedOnly) return [...areaMap.values(), ...entityMap.values(), ...textMap.values(), ...relationMap.values()].filter(isDiagramVisible);
	const selected = state.selectMgr.getSelectList().filter(item => !(item instanceof Relation9));
	return [...selected, ...sqlMakerManager.getUsedRelationList(selected).filter(isDiagramVisible)];
}

/**
 * 캔버스 좌표의 영역. getBBox()는 요소 자신의 transform을 반영하지 않으므로
 * 도형 그룹(g)의 transform(translate)을 더한다
 */
function canvasBBox(node: SVGGraphicsElement): { x: number; y: number; width: number; height: number } {
	const box = node.getBBox();
	const matrix = node.transform?.baseVal?.consolidate()?.matrix;
	if (!matrix) return box;
	return { x: box.x + matrix.e, y: box.y + matrix.f, width: box.width, height: box.height };
}

/** 대상 도형만 남긴 SVG. 대상이 없으면 null */
export function buildExportSVG(options: ImageExportOptions): ExportedSVG | null {
	const targets = getTargets(options.selectedOnly);
	if (targets.length === 0) return null;

	// 도형들이 차지하는 영역
	let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
	for (const item of targets) {
		const box = canvasBBox(item.g.node()!);
		x1 = Math.min(x1, box.x);
		y1 = Math.min(y1, box.y);
		x2 = Math.max(x2, box.x + box.width);
		y2 = Math.max(y2, box.y + box.height);
	}
	x1 = Math.floor(x1 - MARGIN);
	y1 = Math.floor(y1 - MARGIN);
	const width = Math.ceil(x2 + MARGIN) - x1;
	const height = Math.ceil(y2 + MARGIN) - y1;

	// 대상 도형만 복사 (선택 사각형, 도형 메뉴, 확대/이동 transform 제외)
	const svg = document.createElementNS(SVG_NS, "svg");
	const ids = new Set(targets.map(item => item.id));
	for (const child of state.canvas.node()!.children) {
		if (child instanceof SVGGElement && ids.has(child.id)) svg.appendChild(child.cloneNode(true));
	}
	svg.querySelectorAll(".selectedEntity").forEach(el => el.classList.remove("selectedEntity"));
	svg.querySelectorAll(".selectedField").forEach(el => el.classList.remove("selectedField", "parentRelation", "childRelation"));

	svg.setAttribute("xmlns", SVG_NS);
	svg.setAttribute("viewBox", `${x1} ${y1} ${width} ${height}`);
	svg.setAttribute("width", String(width));
	svg.setAttribute("height", String(height));
	svg.setAttribute("font-family", getComputedStyle(state.svg.node()!).fontFamily);

	if (!options.transparent) {
		const background = document.createElementNS(SVG_NS, "rect");
		background.setAttribute("x", String(x1));
		background.setAttribute("y", String(y1));
		background.setAttribute("width", String(width));
		background.setAttribute("height", String(height));
		background.setAttribute("fill", "white");
		svg.insertBefore(background, svg.firstChild);
	}
	return { svg, width, height };
}

export function serializeSVG(svg: SVGSVGElement): string {
	return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
}

/** SVG를 지정한 배율의 PNG로 */
export function svgToPNG(exported: ExportedSVG, scale: number): Promise<Blob> {
	const svg = exported.svg.cloneNode(true) as SVGSVGElement;
	const width = Math.round(exported.width * scale), height = Math.round(exported.height * scale);
	svg.setAttribute("width", String(width));
	svg.setAttribute("height", String(height));

	const url = URL.createObjectURL(new Blob([serializeSVG(svg)], { type: "image/svg+xml" }));
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => {
			const canvas = document.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			canvas.getContext("2d")!.drawImage(image, 0, 0, width, height);
			URL.revokeObjectURL(url);
			canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Failed to make the image. Try a smaller scale.")), "image/png");
		};
		image.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error("Failed to make the image."));
		};
		image.src = url;
	});
}
