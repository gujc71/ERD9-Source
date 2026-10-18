/**
 * 자동 배치 (ELK layered 알고리즘).
 * 관계 방향(부모 -> 자식)에 따라 왼쪽에서 오른쪽으로 계층을 나누어 배치하고, 관계가 없는 엔터티와 글상자는 따로 모아 배치한다.
 * ELK는 용량이 크므로 Web Worker에서 실행한다.
 */
import ELK from "elkjs/lib/elk-api.js";
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import { STATE_TYPE } from "../constants";
import { Text9 } from "../diagram/Text9";
import type { Entity9 } from "../diagram/Entity9";
import { entityMap, relationMap, state, textMap } from "../state";
import { isEntityVisible, isOnCurrentPage } from "./pages";

const LAYOUT_OPTIONS = {
	"elk.algorithm": "layered",
	"elk.direction": "RIGHT",
	"elk.edgeRouting": "ORTHOGONAL",
	"elk.spacing.nodeNode": "40",
	"elk.layered.spacing.nodeNodeBetweenLayers": "80",
	"elk.separateConnectedComponents": "true",
	"elk.spacing.componentComponent": "60",
	"elk.padding": "[top=20,left=20,bottom=20,right=20]",
};

function nodeSize(item: Entity9 | Text9): { width: number; height: number } {
	if (item instanceof Text9) {
		const rect = item.getClientRect();
		return { width: rect.x2 - rect.x1, height: rect.y2 - rect.y1 };
	}
	return { width: item.x2 - item.x1, height: item.y2 - item.y1 };
}

export async function autoLayout(): Promise<void> {
	// 현재 페이지에 보이는 엔터티만
	const items = new Map<string, Entity9 | Text9>([
		...[...entityMap].filter(([, entity]) => isEntityVisible(entity)),
		...[...textMap].filter(([, text]) => isOnCurrentPage(text)),
	]);
	if (items.size === 0) return;

	const children: ElkNode[] = [...items.values()].map(item => ({ id: item.id, ...nodeSize(item) }));
	const edges: ElkExtendedEdge[] = [];
	items.forEach(entity => {
		if (entity instanceof Text9) return;
		entity.myChildList.forEach(relation => {
			if (relation.childEntity === entity || !items.has(relation.childEntity.id)) return;
			edges.push({ id: relation.id, sources: [entity.id], targets: [relation.childEntity.id] });
		});
	});

	// 화면 비율에 맞춰 연결되지 않은 묶음들을 배치
	const aspectRatio = (window.innerWidth / Math.max(1, window.innerHeight)).toFixed(2);
	const elk = new ELK({ workerUrl: elkWorkerUrl });
	let result: ElkNode;
	try {
		result = await elk.layout({ id: "root", layoutOptions: { ...LAYOUT_OPTIONS, "elk.aspectRatio": aspectRatio }, children, edges });
	} finally {
		elk.terminateWorker();
	}

	state.diagramStack.saveState(STATE_TYPE.ENTITY_MOVE, [...items.values()].map(item => ({ id: item.id, x1: item.x1, y1: item.y1 })));
	for (const node of result.children ?? []) {
		items.get(node.id)?.rePosition(Math.round(node.x ?? 0), Math.round(node.y ?? 0));
	}
	// 엔터티마다 다시 계산하는 동안에는 아직 옮기지 않은 엔터티 기준이었으므로 모두 옮긴 뒤 한 번 더
	for (const relation of relationMap.values()) relation.rePosition();
}
