import {
	DIAGRAM_TYPE, ENTITY_LAYOUT, RELATION_CARDINALITY, RELATION_DIRECTION, RELATION_SELECTION, RELATION_TYPE, VIEW_DATA,
} from "../constants";
import type { ReferentialAction, RelationCardinality, RelationDirection, RelationEnd, RelationKind, RelationSelection } from "../constants";
import { entityMap, relationMap, state } from "../state";
import type { Point, Rect, RelationFieldInfo, RelationOption, RelationSnapshot, Sel } from "../types";
import { diagramUtil } from "../util/diagramUtil";
import { isEntityVisible } from "../core/pages";
import { Diagram9 } from "./Diagram9";
import type { Entity9 } from "./Entity9";
import { measureBox } from "./measure";

/** 자기참조 관계 고리가 엔터티 밖으로 나가는 길이 */
const SELF_LOOP_WIDTH = 40;
/** 엔터티 사이 간격이 이보다 크면 그 방향(좌우 / 위아래)으로 연결 */
const DIRECTION_GAP = 30;
/** 꺾이는 곳의 둥글기, 교차 점프 반지름 */
const CORNER_RADIUS = 8;
const JUMP_RADIUS = 4;
/** 경로를 정할 때 다른 엔터티에서 띄우는 거리 */
const OBSTACLE_MARGIN = 10;
/** 꺾이는 위치가 엔터티 변에서 떨어져야 하는 최소 거리 (끝 표시 16 + 모서리 둥글기 8 + 여유) */
const END_SEGMENT_MIN = 28;
/** 사용자가 옮긴 끝이 엔터티 모서리에서 떨어져야 하는 거리 (끝 표시 폭 6 + 여유) */
const END_CORNER_MARGIN = 10;
/** 관계선 끝에서 이 거리 안을 누르면 끝을 옮긴다 */
const END_HANDLE_SIZE = 18;
/** 같은 컬럼에 붙은 관계선 사이 간격 */
const SAME_ROW_GAP = 5;
/** 비식별 관계 점선 */
const NON_IDENTIFYING_DASH = "5 4";
/** 내보낸 이미지에도 남는 기본 선 색 (화면의 다크 모드는 CSS가 덮어쓴다) */
const LINE_COLOR = "#4b5563";

/** 관계 생성 시 지정할 수 있는 값 */
export type RelationProps = Partial<RelationOption> & { name?: string };

const isHorizontal = (direction: RelationDirection) => direction === RELATION_DIRECTION.E || direction === RELATION_DIRECTION.W;

const OPPOSITE: Record<RelationDirection, RelationDirection> = {
	[RELATION_DIRECTION.E]: RELATION_DIRECTION.W,
	[RELATION_DIRECTION.W]: RELATION_DIRECTION.E,
	[RELATION_DIRECTION.S]: RELATION_DIRECTION.N,
	[RELATION_DIRECTION.N]: RELATION_DIRECTION.S,
};

/**
 * 부모 엔터티에서 자식 엔터티로 가는 방향.
 * 좌우로 떨어져 있으면 E/W (컬럼 줄에 연결할 수 있음), 위아래로 떨어져 있으면 S/N, 겹치면 중심 사이 각도로 정한다.
 */
export function chooseDirection(parent: Rect, child: Rect): RelationDirection {
	if (child.x1 - parent.x2 >= DIRECTION_GAP) return RELATION_DIRECTION.E;
	if (parent.x1 - child.x2 >= DIRECTION_GAP) return RELATION_DIRECTION.W;
	if (child.y1 - parent.y2 >= DIRECTION_GAP) return RELATION_DIRECTION.S;
	if (parent.y1 - child.y2 >= DIRECTION_GAP) return RELATION_DIRECTION.N;

	const dx = (child.x1 + child.x2) / 2 - (parent.x1 + parent.x2) / 2;
	const dy = (child.y1 + child.y2) / 2 - (parent.y1 + parent.y2) / 2;
	if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? RELATION_DIRECTION.E : RELATION_DIRECTION.W;
	return dy >= 0 ? RELATION_DIRECTION.S : RELATION_DIRECTION.N;
}

/** 축에 나란한 선분이 사각형 안을 지나는지 */
function segmentHitsRect(p1: Point, p2: Point, rect: Rect): boolean {
	const minX = Math.min(p1.x, p2.x), maxX = Math.max(p1.x, p2.x);
	const minY = Math.min(p1.y, p2.y), maxY = Math.max(p1.y, p2.y);
	return maxX > rect.x1 && minX < rect.x2 && maxY > rect.y1 && minY < rect.y2;
}

/** 교차 점프: 선분 번호 → 선분 시작점에서의 거리 목록 */
type JumpMap = Map<number, number[]>;

/**
 * 꺾은선을 둥근 모서리와 교차 점프가 있는 path로.
 * 점프는 가로 선분에만 그린다 (교차하는 두 선 중 한 선에만 그려지도록)
 */
function buildLinePath(points: Point[], jumps?: JumpMap): string {
	if (points.length < 2) return "";
	const n = points.length;
	// 각 꺾이는 점의 둥글기 (양쪽 선분 길이의 절반을 넘지 않게)
	const radius = points.map((p, i) => {
		if (i === 0 || i === n - 1) return 0;
		const prev = points[i - 1], next = points[i + 1];
		const lenIn = Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
		const lenOut = Math.abs(next.x - p.x) + Math.abs(next.y - p.y);
		return Math.min(CORNER_RADIUS, lenIn / 2, lenOut / 2);
	});

	let d = `M ${points[0].x},${points[0].y}`;
	for (let i = 0; i < n - 1; i++) {
		const p = points[i], q = points[i + 1];
		const length = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
		if (length === 0) continue;
		const ux = Math.sign(q.x - p.x), uy = Math.sign(q.y - p.y);
		const at = (t: number) => `${p.x + ux * t},${p.y + uy * t}`;
		const start = radius[i], end = length - radius[i + 1];

		for (const t of (jumps?.get(i) ?? []).sort((a, b) => a - b)) {
			if (t - JUMP_RADIUS <= start + 1 || t + JUMP_RADIUS >= end - 1) continue;
			// 위로 볼록한 반원 (진행 방향이 +x이면 시계 방향)
			d += ` L ${at(t - JUMP_RADIUS)} A ${JUMP_RADIUS} ${JUMP_RADIUS} 0 0 ${ux > 0 ? 1 : 0} ${at(t + JUMP_RADIUS)}`;
		}
		d += ` L ${at(end)}`;
		const r = radius[i + 1];
		if (i + 1 < n - 1 && r > 0) {
			const next = points[i + 2];
			const vx = Math.sign(next.x - q.x), vy = Math.sign(next.y - q.y);
			d += ` Q ${q.x},${q.y} ${q.x + vx * r},${q.y + vy * r}`;
		}
	}
	return d;
}

/* -----------------------------------------------------------------------------------
 * 교차 점프는 모든 관계선이 그려진 다음 한 번에 계산
 */
let jumpScheduled = false;
function scheduleJumps(): void {
	if (jumpScheduled) return;
	jumpScheduled = true;
	const run = () => {
		jumpScheduled = false;
		Relation9.updateJumps();
	};
	if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
	else setTimeout(run, 0);
}

export class Relation9 extends Diagram9 {
	relationType: RelationKind;
	relationCard: RelationCardinality;
	relationSelect: RelationSelection;
	onDelete?: ReferentialAction;
	onUpdate?: ReferentialAction;
	parentEntity!: Entity9;
	childEntity!: Entity9;
	direction?: RelationDirection;
	/** 관계명 (외래키 제약조건 이름). 없으면 id 사용 */
	name?: string;
	/** 관계선 가운데에 표시하는 설명 */
	label?: string;
	/** 꺾이는 위치 (부모 끝 0 ~ 자식 끝 1). 없으면 다른 엔터티를 피해서 자동 */
	bend?: number;
	/** 부모 / 자식 끝이 붙는 위치 (변의 시작 0 ~ 끝 1). 없으면 자동. 붙는 변은 항상 자동 */
	parentAt?: number;
	childAt?: number;

	private linePath?: Sel<SVGPathElement>;
	private markerPath!: Sel<SVGPathElement>;
	private lineHidden!: Sel<SVGPathElement>;
	private labelGroup!: Sel<SVGGElement>;
	private optionpos: Point[] = [];
	/** 관계선 꺾은선 (부모 끝 → 자식 끝, 캔버스 좌표) */
	route: Point[] = [];

	/**
	 * 관계 생성. 이미 관계가 있거나 엔터티가 없으면 null 반환.
	 * 생성된 관계는 relationMap에 등록된다.
	 * @param isSetKeys 키 컬럼 설정 여부
	 * @param relationType pk / ak
	 */
	static create(parent: Sel<SVGGElement>, e1: Entity9 | undefined, e2: Entity9 | undefined, isSetKeys: boolean,
				  relationType: RelationKind, id?: string | null, props?: RelationProps): Relation9 | null {
		if (!e1 || !e2) {
			console.error("The entity of the relationship is not found.", id);
			return null;
		}
		if (e1.hasChild(e2)) {
			alert("The relationship already exists.");
			return null;
		}
		// 자기참조 관계: PK가 자신의 PK를 포함할 수 없으므로 항상 비식별, 최상위 행이 있으므로 기본값은 양쪽 선택
		if (e1 === e2) {
			relationType = DIAGRAM_TYPE.RELATION_AK;
			props = { relationSelect: RELATION_SELECTION.OO, ...props };
		}
		const relation = new Relation9(parent, e1, e2, isSetKeys, relationType, id, props);
		relationMap.set(relation.id, relation);
		return relation;
	}

	/** 여러 엔터티가 함께 움직인 뒤: 그 엔터티들과 이웃 엔터티의 관계선을 한 번씩 다시 계산 */
	static recalculateAround(entities: Iterable<Entity9>): void {
		const relations = new Set<Relation9>();
		const add = (entity: Entity9) => {
			entity.myParentList.forEach(relation => relations.add(relation));
			entity.myChildList.forEach(relation => relations.add(relation));
		};
		for (const entity of entities) add(entity);
		for (const relation of [...relations]) {
			add(relation.parentEntity);
			add(relation.childEntity);
		}
		relations.forEach(relation => relation.rePosition());
	}

  private constructor(parent: Sel<SVGGElement>, e1: Entity9, e2: Entity9, isSetKeys: boolean, relationType: RelationKind,
					  id?: string | null, props?: RelationProps) {
	super(parent, id || "r" + diagramUtil.getUniqueID(), 0, 0);
	this.relationType = relationType;
	this.relationCard = props?.relationCard || RELATION_CARDINALITY.O2M;
	this.relationSelect = props?.relationSelect || RELATION_SELECTION.MM;
	this.onDelete = props?.onDelete;
	this.onUpdate = props?.onUpdate;
	this.name = props?.name;
	this.label = props?.label || undefined;
	this.bend = typeof props?.bend === "number" ? props.bend : undefined;
	this.parentAt = typeof props?.parentAt === "number" ? props.parentAt : undefined;
	this.childAt = typeof props?.childAt === "number" ? props.childAt : undefined;

	this.makeRelation(e1, e2, isSetKeys);
  }

	/** 저장, 실행취소에 사용하는 관계 옵션 */
	getOption(): RelationOption & { name?: string } {
		return {
			relationCard: this.relationCard, relationSelect: this.relationSelect, onDelete: this.onDelete, onUpdate: this.onUpdate,
			name: this.name, label: this.label, bend: this.bend, parentAt: this.parentAt, childAt: this.childAt,
		};
	}

	get diagramType() {
		return this.relationType;
	}

	/** 자기참조 관계 */
	get isSelf(): boolean {
		return this.parentEntity === this.childEntity;
	}

	/** 양쪽 엔터티가 현재 페이지에 있는지 */
	private get isVisible(): boolean {
		return !!this.parentEntity && !!this.childEntity && isEntityVisible(this.parentEntity) && isEntityVisible(this.childEntity);
	}

	makeRelation(e1: Entity9, e2: Entity9, isSetKeys?: boolean): void {
		if (isSetKeys && e1.data) {
			if (e1 === e2) e1.addSelfFK();
			else this.relationType = e2.setRelationData(e1.data, this.relationType);
		}

		// modify: entity move
		if (this.linePath) {
			this._update();
			return;
		}
		this.g = this.parent.append("g").attr("id", this.id).attr("class", "erd-relation");
		// 선, 끝 표시, 라벨 어디를 눌러도 선택
		this.g.on("mousedown", this.ev_mousedown.bind(this));

		// 클릭 영역 (투명한 굵은 선). 선 아래에 두어야 hover 강조가 선 위에 그려진다
		this.lineHidden = this.g.append("path").attr("class", "erd-hit")
			.attr("stroke", "black").attr("fill", "none").attr("stroke-width", "10").style("opacity", "0");

		this.linePath = this.g.append("path").attr("class", "erd-line")
			.attr("stroke", LINE_COLOR).attr("fill", "none").attr("stroke-width", "1")
			.attr("stroke-linejoin", "round").attr("stroke-linecap", "round");
		this._applyDash();
		this.markerPath = this.g.append("path").attr("class", "erd-marker")
			.attr("stroke", LINE_COLOR).attr("fill", "none").attr("stroke-width", "1").attr("stroke-linecap", "round");
		this.labelGroup = this.g.append("g").attr("class", "erd-rel-label");

		e1.addChild(this);
		e2.addParent(this);
		this.parentEntity = e1;
		this.childEntity = e2;

		// 다른 페이지에 있는 엔터티와의 관계는 숨김
		if (!isEntityVisible(e1) || !isEntityVisible(e2)) this.g.style("display", "none");

		this._update();
		// 같은 엔터티에 붙은 다른 관계선의 연결 위치가 바뀌므로 다시 계산
		this._recalculateSiblings();
	}

	hasChild(childEntity: Entity9): boolean {
		return this.childEntity === childEntity;
	}
	hasParent(parentEntity: Entity9): boolean {
		return this.parentEntity === parentEntity;
	}

	/** 양쪽 엔터티에 붙은 다른 관계선 다시 계산 */
	private _recalculateSiblings(): void {
		const siblings = new Set<Relation9>();
		for (const entity of [this.parentEntity, this.childEntity]) {
			entity.myParentList.forEach(relation => siblings.add(relation));
			entity.myChildList.forEach(relation => siblings.add(relation));
		}
		siblings.delete(this);
		siblings.forEach(relation => relation._update());
	}

	/* -------------------------------------------------------------------------------
	 * 연결 위치
	 */

	/** 이 관계의 FK 컬럼(자식)과 참조하는 키 컬럼(부모) */
	private _fieldIds(): { parentField: string | null; childField: string | null } {
		const keyIds = new Set(this.parentEntity.data.keys.map(key => key.id));
		const field = this.childEntity.data.allFields.find(fld => !!fld.parentID && keyIds.has(fld.parentID));
		return { parentField: field?.parentID ?? null, childField: field?.id ?? null };
	}

	/** 관계의 방향 (양쪽 엔터티의 현재 위치 기준) */
	private _direction(): RelationDirection {
		return chooseDirection(this.parentEntity.getClientRect(), this.childEntity.getClientRect());
	}

	/** 엔터티의 어느 변에 붙는지 */
	private _sideAt(entity: Entity9): RelationDirection {
		const direction = this._direction();
		return entity === this.parentEntity ? direction : OPPOSITE[direction];
	}

	/** 사용자가 정한 엔터티 쪽 끝 위치 (변 위의 비율) */
	private _fixedAt(entity: Entity9): number | undefined {
		if (this.isSelf) return undefined;
		return entity === this.parentEntity ? this.parentAt : this.childAt;
	}

	/** 엔터티 쪽 끝이 컬럼 줄에 연결되는 경우 그 줄의 y (좌우 변만) */
	private _rowAnchorAt(entity: Entity9, side: RelationDirection): { y: number; field: string } | null {
		if (!isHorizontal(side) || state.viewData === VIEW_DATA.ENTITY) return null;
		const ids = this._fieldIds();
		const field = entity === this.parentEntity ? ids.parentField : ids.childField;
		if (!field) return null;
		const y = entity.getFieldAnchorY(field);
		return y === null ? null : { y, field };
	}

	/** 반대편 끝 엔터티의 중심 (같은 변에 붙은 관계선을 정렬할 때 사용) */
	private _otherCenter(entity: Entity9): Point {
		const other = entity === this.parentEntity ? this.childEntity : this.parentEntity;
		return { x: (other.x1 + other.x2) / 2, y: (other.y1 + other.y2) / 2 };
	}

	/**
	 * 엔터티의 변 위에서 이 관계선이 붙는 위치 (변을 따라가는 좌표).
	 * 컬럼 줄에 연결할 수 있으면 그 줄(같은 줄에 여러 선이 붙으면 조금씩 띄움),
	 * 아니면 같은 변에 붙은 선들이 변을 고르게 나눠 쓴다.
	 * 사용자가 끝을 옮긴 선은 그 위치에 붙고, 나눠 쓰는 계산에서 빠진다.
	 */
	private _anchorAt(entity: Entity9, side: RelationDirection): number {
		const horizontal = isHorizontal(side);
		const [start, end] = horizontal ? [entity.y1, entity.y2] : [entity.x1, entity.x2];
		const fixed = this._fixedAt(entity);
		if (fixed !== undefined) {
			const margin = Math.min(END_CORNER_MARGIN, (end - start) / 2);
			return Math.round(Math.min(end - margin, Math.max(start + margin, start + (end - start) * fixed)));
		}

		const axis = (p: Point) => horizontal ? p.y : p.x;
		const siblings = [...entity.myParentList, ...entity.myChildList]
			.filter(relation => !relation.isSelf && relation.isVisible && relation._fixedAt(entity) === undefined && relation._sideAt(entity) === side);
		const byOther = (a: Relation9, b: Relation9) => axis(a._otherCenter(entity)) - axis(b._otherCenter(entity)) || (a.id < b.id ? -1 : 1);

		const row = this._rowAnchorAt(entity, side);
		if (row) {
			const sameRow = siblings.filter(relation => relation._rowAnchorAt(entity, side)?.field === row.field).sort(byOther);
			const index = Math.max(0, sameRow.indexOf(this));
			const offset = (index - (sameRow.length - 1) / 2) * SAME_ROW_GAP;
			const limit = ENTITY_LAYOUT.ROW_HEIGHT / 2 - 2;
			return row.y + Math.max(-limit, Math.min(limit, offset));
		}

		const free = siblings.filter(relation => !relation._rowAnchorAt(entity, side)).sort(byOther);
		const index = Math.max(0, free.indexOf(this));
		const count = Math.max(1, free.length);
		return Math.round(start + (end - start) * (index + 1) / (count + 1));
	}

	/* -------------------------------------------------------------------------------
	 * 경로
	 */

	/** 위치와 경로를 다시 계산해서 그림 */
	private _update(): void {
		if (!this.linePath) return;
		this.route = this.isSelf ? this._selfRoute() : this._directedRoute();
		this._draw();
		scheduleJumps();
	}

	/** 자기참조 관계: 엔터티 오른쪽에서 나가서 바로 아래로 돌아오는 고리 (부모 끝이 위, 자식 끝이 아래) */
	private _selfRoute(): Point[] {
		const rt = this.parentEntity.getClientRect();
		const entityView = state.viewData === VIEW_DATA.ENTITY;
		const y1 = entityView ? rt.y1 + 7 : rt.y1 + ENTITY_LAYOUT.HEADER_HEIGHT / 2;
		const y2 = entityView ? rt.y1 + 19 : rt.y1 + ENTITY_LAYOUT.HEADER_HEIGHT + 14;
		this.direction = RELATION_DIRECTION.E;
		this.x1 = rt.x2; this.y1 = y1;
		this.x2 = rt.x2; this.y2 = y2;
		const loopX = rt.x2 + SELF_LOOP_WIDTH;
		return [{ x: rt.x2, y: y1 }, { x: loopX, y: y1 }, { x: loopX, y: y2 }, { x: rt.x2, y: y2 }];
	}

	/** 엔터티 사이 관계선: 양쪽 끝을 정하고 가운데에서 한 번 꺾는다 */
	private _directedRoute(): Point[] {
		const direction = this._direction();
		const parent = this.parentEntity, child = this.childEntity;
		const p = parent.getClientRect(), c = child.getClientRect();
		const pa = this._anchorAt(parent, direction);
		const ca = this._anchorAt(child, OPPOSITE[direction]);

		let start: Point, end: Point;
		switch (direction) {
			case RELATION_DIRECTION.E: start = { x: p.x2, y: pa }; end = { x: c.x1, y: ca }; break;
			case RELATION_DIRECTION.W: start = { x: p.x1, y: pa }; end = { x: c.x2, y: ca }; break;
			case RELATION_DIRECTION.S: start = { x: pa, y: p.y2 }; end = { x: ca, y: c.y1 }; break;
			default:                   start = { x: pa, y: p.y1 }; end = { x: ca, y: c.y2 }; break;
		}
		const horizontal = isHorizontal(direction);
		// 1px 미만 차이는 곧은 선으로 맞춤 (조금이라도 어긋나면 대각선으로 그려진다)
		const straight = horizontal ? Math.abs(start.y - end.y) < 1 : Math.abs(start.x - end.x) < 1;
		if (straight) {
			if (horizontal) end.y = start.y;
			else end.x = start.x;
		}
		this.direction = direction;
		this.x1 = start.x; this.y1 = start.y;
		this.x2 = end.x;   this.y2 = end.y;
		if (straight) return [start, end];

		const [a1, c1, a2, c2] = horizontal ? [start.x, start.y, end.x, end.y] : [start.y, start.x, end.y, end.x];

		const m = this._middle(a1, c1, a2, c2, horizontal);
		const pt = (a: number, cc: number): Point => horizontal ? { x: a, y: cc } : { x: cc, y: a };
		return [start, pt(m, c1), pt(m, c2), end];
	}

	/**
	 * 가운데 꺾이는 위치 (진행 방향 좌표).
	 * 사용자가 정한 위치(bend)가 있으면 그 위치, 없으면 다른 엔터티를 가장 적게 지나는 위치 중 가운데에 가까운 곳
	 */
	private _middle(a1: number, c1: number, a2: number, c2: number, horizontal: boolean): number {
		const mid = Math.round((a1 + a2) / 2);
		const lo = Math.min(a1, a2), hi = Math.max(a1, a2);
		// 양 끝 선분이 끝 표시보다 짧아지지 않게 (공간이 모자라면 가운데)
		if (hi - lo < END_SEGMENT_MIN * 2) return mid;
		const clamp = (m: number) => Math.min(hi - END_SEGMENT_MIN, Math.max(lo + END_SEGMENT_MIN, m));

		if (this.bend !== undefined) return Math.round(clamp(a1 + (a2 - a1) * this.bend));

		const obstacles: Rect[] = [];
		for (const entity of entityMap.values()) {
			if (entity === this.parentEntity || entity === this.childEntity || !isEntityVisible(entity)) continue;
			const r = entity.getClientRect();
			obstacles.push({ x1: r.x1 - OBSTACLE_MARGIN, y1: r.y1 - OBSTACLE_MARGIN, x2: r.x2 + OBSTACLE_MARGIN, y2: r.y2 + OBSTACLE_MARGIN });
		}
		if (obstacles.length === 0) return mid;

		const pt = (a: number, cc: number): Point => horizontal ? { x: a, y: cc } : { x: cc, y: a };
		const hits = (m: number) => {
			const points = [pt(a1, c1), pt(m, c1), pt(m, c2), pt(a2, c2)];
			let count = 0;
			for (const rect of obstacles) {
				for (let i = 0; i < 3; i++) if (segmentHitsRect(points[i], points[i + 1], rect)) count++;
			}
			return count;
		};

		// 후보: 가운데, 진행 방향으로 겹치는 엔터티들의 앞뒤
		const candidates = [mid];
		for (const rect of obstacles) {
			const [r1, r2] = horizontal ? [rect.x1, rect.x2] : [rect.y1, rect.y2];
			if (r2 > lo && r1 < hi) candidates.push(r1, r2);
		}
		let best = mid, bestHits = hits(mid);
		for (const m of candidates) {
			if (m < lo + END_SEGMENT_MIN || m > hi - END_SEGMENT_MIN) continue;
			const count = hits(m);
			if (count < bestHits || (count === bestHits && Math.abs(m - mid) < Math.abs(best - mid))) {
				best = m;
				bestHits = count;
			}
			if (bestHits === 0 && best === mid) break;
		}
		return Math.round(best);
	}

	/** 선, 끝 표시, 라벨 그리기 (점프 없이. 점프는 updateJumps) */
	private _draw(jumps?: JumpMap): void {
		const route = this.route;
		const d = buildLinePath(route, jumps);
		this.linePath!.attr("d", d);
		this.lineHidden.attr("d", buildLinePath(route));
		if (jumps) return;

		this.markerPath.attr("d", this._markers());
		this.g.selectAll<SVGCircleElement, Point>("circle.erd-rel-circle")
			.data(this.optionpos)
			.join(enter => enter.insert("circle", ".erd-rel-label").attr("class", "erd-rel-circle")
				.attr("r", 4).attr("fill", "white").attr("stroke", LINE_COLOR).attr("stroke-width", 1))
			.attr("cx", d => d.x)
			.attr("cy", d => d.y);
		this._drawLabel();
	}

	/**
	 * 끝 표시 (IE 표기). 부모 끝: 하나(세로선) + 필수(세로선) / 선택(원),
	 * 자식 끝: 여럿(까마귀발) 또는 하나(세로선) + 필수 / 선택
	 */
	private _markers(): string {
		const route = this.route;
		this.optionpos = [];
		if (route.length < 2) return "";
		const unit = (from: Point, to: Point): Point => ({ x: Math.sign(to.x - from.x), y: Math.sign(to.y - from.y) });
		// u: 엔터티에서 멀어지는 방향, v: 수직 방향
		const ends = [
			{ p: route[0], u: unit(route[0], route[1]), optional: this.relationSelect.charAt(0) === "o", many: false },
			{ p: route[route.length - 1], u: unit(route[route.length - 1], route[route.length - 2]),
			  optional: this.relationSelect.charAt(1) === "o", many: this.relationCard === RELATION_CARDINALITY.O2M },
		];
		let d = "";
		for (const { p, u, optional, many } of ends) {
			const v = { x: -u.y, y: u.x };
			const at = (t: number, s = 0): string => `${p.x + u.x * t + v.x * s},${p.y + u.y * t + v.y * s}`;
			const bar = (t: number) => { d += ` M ${at(t, -6)} L ${at(t, 6)}`; };
			let next: number;
			if (many) {
				// 까마귀발: 선 위의 한 점에서 엔터티 변으로 세 갈래
				d += ` M ${at(12)} L ${at(0, -6)} M ${at(12)} L ${at(0)} M ${at(12)} L ${at(0, 6)}`;
				next = 16;
			} else {
				bar(7);
				next = 12;
			}
			if (optional) this.optionpos.push({ x: p.x + u.x * (next + 4), y: p.y + u.y * (next + 4) });
			else bar(next);
		}
		return d.trim();
	}

	/** 선 가운데 위치 (라벨, 도형 메뉴) */
	private _middlePoint(): Point {
		const route = this.route;
		if (route.length === 0) return { x: this.x1, y: this.y1 };
		const i = route.length >= 4 ? 1 : 0;
		const p = route[i], q = route[Math.min(i + 1, route.length - 1)];
		return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
	}

	/**
	 * 라벨 위치: 가장 긴 가로 선분의 가운데 위 (선을 가리지 않게).
	 * 가로 선분이 없으면 가장 긴 세로 선분의 오른쪽
	 */
	private _labelAnchor(): { x: number; y: number; beside: boolean } {
		const route = this.route;
		let horizontal: { x: number; y: number; length: number } | null = null;
		let vertical: { x: number; y: number; length: number } | null = null;
		for (let i = 0; i < route.length - 1; i++) {
			const p = route[i], q = route[i + 1];
			const length = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
			const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, length };
			if (p.y === q.y) { if (!horizontal || length > horizontal.length) horizontal = mid; }
			else if (!vertical || length > vertical.length) vertical = mid;
		}
		if (horizontal && (!vertical || horizontal.length >= 40 || horizontal.length >= vertical.length / 2)) {
			return { x: horizontal.x, y: horizontal.y - 9, beside: false };
		}
		const v = vertical ?? { x: this.x1, y: this.y1 };
		return { x: v.x + 6, y: v.y, beside: true };
	}

	private _drawLabel(): void {
		this.labelGroup.selectAll("*").remove();
		if (!this.label) return;
		const { x, y, beside } = this._labelAnchor();
		const background = this.labelGroup.append("rect").attr("class", "erd-rel-label-bg").attr("rx", 3).attr("fill", "white");
		const text = this.labelGroup.append("text").attr("class", "erd-rel-label-text")
			.attr("x", x).attr("y", y + 3.5).attr("text-anchor", beside ? "start" : "middle")
			.attr("font-size", "10px").attr("fill", LINE_COLOR)
			.text(this.label);
		const box = measureBox(text.node());
		const width = box.width + 8, height = Math.max(box.height, 12) + 2;
		background.attr("x", beside ? x - 4 : x - width / 2).attr("y", y - height / 2).attr("width", width).attr("height", height);
	}

	private _applyDash(): void {
		this.linePath?.attr("stroke-dasharray", this.relationType === DIAGRAM_TYPE.RELATION_AK ? NON_IDENTIFYING_DASH : null);
	}

	/**
	 * 관계선이 교차하는 곳에 점프(작은 반원) 표시.
	 * 가로 선분이 다른 관계선의 세로 선분과 만나는 곳에만 그린다
	 */
	static updateJumps(): void {
		const relations = [...relationMap.values()].filter(relation => relation.linePath && relation.isVisible && relation.route.length > 1);
		const verticals: { relation: Relation9; x: number; y1: number; y2: number }[] = [];
		for (const relation of relations) {
			const route = relation.route;
			for (let i = 0; i < route.length - 1; i++) {
				const p = route[i], q = route[i + 1];
				if (p.x === q.x && p.y !== q.y) verticals.push({ relation, x: p.x, y1: Math.min(p.y, q.y), y2: Math.max(p.y, q.y) });
			}
		}
		for (const relation of relations) {
			const route = relation.route;
			const jumps: JumpMap = new Map();
			for (let i = 0; i < route.length - 1; i++) {
				const p = route[i], q = route[i + 1];
				if (p.y !== q.y || p.x === q.x) continue;
				const x1 = Math.min(p.x, q.x), x2 = Math.max(p.x, q.x);
				for (const v of verticals) {
					if (v.relation === relation) continue;
					if (v.x <= x1 + 1 || v.x >= x2 - 1 || p.y <= v.y1 + 1 || p.y >= v.y2 - 1) continue;
					const list = jumps.get(i) ?? [];
					list.push(Math.abs(v.x - p.x));
					jumps.set(i, list);
				}
			}
			relation._draw(jumps.size > 0 ? jumps : new Map());
		}
	}

	/* -------------------------------------------------------------------------------
	 * 꺾이는 위치 조정 (가운데 선분 끌기)
	 */

	/** 끌어서 꺾이는 위치를 바꿀 수 있는지 (자기참조, 곧은 선 제외) */
	canBend(): boolean {
		return !this.isSelf && this.route.length === 4;
	}

	/** 마우스 위치(캔버스 좌표)로 꺾이는 위치 지정 */
	setBendAt(x: number, y: number): void {
		if (!this.canBend() || !this.direction) return;
		const horizontal = isHorizontal(this.direction);
		const [a1, a2, a] = horizontal ? [this.x1, this.x2, x] : [this.y1, this.y2, y];
		if (Math.abs(a2 - a1) < 1) return;
		this.bend = Math.min(0.95, Math.max(0.05, (a - a1) / (a2 - a1)));
		this._update();
	}

	/* -------------------------------------------------------------------------------
	 * 끝 위치 조정 (양 끝 끌기, 붙은 변 안에서만)
	 */

	/** 마우스 위치(캔버스 좌표)가 관계선의 어느 끝 근처인지. 끝을 옮길 수 없거나 끝이 아니면 null */
	endAt(x: number, y: number): RelationEnd | null {
		if (this.isSelf || this.route.length < 2) return null;
		const distance = (p: Point) => Math.abs(p.x - x) + Math.abs(p.y - y);
		const toParent = distance(this.route[0]), toChild = distance(this.route[this.route.length - 1]);
		if (Math.min(toParent, toChild) > END_HANDLE_SIZE) return null;
		return toParent <= toChild ? RELATION_TYPE.PARENT : RELATION_TYPE.CHILD;
	}

	/** 마우스 위치(캔버스 좌표)로 끝 위치 지정. 붙는 변은 그대로 두고 변을 따라서만 움직인다 */
	setEndAt(end: RelationEnd, x: number, y: number): void {
		if (this.isSelf) return;
		const entity = end === RELATION_TYPE.PARENT ? this.parentEntity : this.childEntity;
		const horizontal = isHorizontal(this._sideAt(entity));
		const [start, stop, a] = horizontal ? [entity.y1, entity.y2, y] : [entity.x1, entity.x2, x];
		if (stop - start < 1) return;
		const ratio = Math.min(1, Math.max(0, (a - start) / (stop - start)));
		if (end === RELATION_TYPE.PARENT) this.parentAt = ratio;
		else this.childAt = ratio;
		this._update();
		// 이 선이 변을 나눠 쓰는 계산에서 빠지므로 같은 변의 다른 선도 다시 계산
		this._recalculateSiblings();
	}

	rePosition(): void {
		this.makeRelation(this.parentEntity, this.childEntity);
	}

	/** 엔터티가 움직이면 다시 계산 (같은 변의 연결 위치, 피해 갈 엔터티가 바뀔 수 있음) */
	modifyRelationPos(_relationType: RelationEnd, _incX: number, _incY: number): void {
		this._update();
	}

	changeRelation(option: RelationOption & { name?: string }): void {
		this.onDelete = option.onDelete;
		this.onUpdate = option.onUpdate;
		this.name = option.name;
		this.label = option.label || undefined;
		this.bend = typeof option.bend === "number" ? option.bend : undefined;
		this.parentAt = typeof option.parentAt === "number" ? option.parentAt : undefined;
		this.childAt = typeof option.childAt === "number" ? option.childAt : undefined;
		this.relationCard = option.relationCard;
		this.relationSelect = option.relationSelect;
		this._update();
		// 끝 고정 여부가 바뀌면 같은 변의 다른 선 위치도 바뀐다
		this._recalculateSiblings();
	}

	removeDiagram(): void {
		this.deselectDiagram();
		this.g.remove();
		relationMap.delete(this.id);

		this.parentEntity.removeChildEntity(this);
		this.childEntity.removeParentEntity(this);
		this.parentEntity.recalculateRelation();
		scheduleJumps();
	}

	/**
	 * @param role 선택된 엔터티 기준으로 이 관계가 부모 관계선(parent)인지 자식 관계선(child)인지 구분해 표시
	 */
	override selectDiagram(diagramMenu?: Sel<SVGTextElement> | null, role?: "parent" | "child"): void {
		this.g.raise();
		const cls = role ? `selectedEntity ${role}Relation` : "selectedEntity";
		this.linePath!.classed(cls, true);
		this.markerPath.classed(cls, true);
		this.g.selectAll("circle.erd-rel-circle").classed(cls, true);
		this.childEntity.selectChildField(this.parentEntity.data.keys, role);

		if (diagramMenu) this.diagramMenu = diagramMenu;
		if (!this.diagramMenu) return;

		const { x, y } = this._middlePoint();
		this.diagramMenu.raise();
		this.diagramMenu.attr("x", x + 6)
					  .attr("y", y - 20)
					  .attr("visibility", "visible");
	    this.diagramMenu.selectAll("tspan")
			.attr("x", x + 6)
			.attr("visibility", "visible");
	}

	override deselectDiagram(): void {
		super.deselectDiagram();
		const cls = "selectedEntity parentRelation childRelation";
		this.linePath!.classed(cls, false);
		this.markerPath.classed(cls, false);
		this.g.selectAll("circle.erd-rel-circle").classed(cls, false);
		this.childEntity.deselectChildField ();
	}

	getRelationData(): RelationFieldInfo {
		const fields = this.childEntity.getRelationFields(this.parentEntity);
		return {
			childTable: this.childEntity.data.physicalName,
			childFields: fields.childFields,
			parentTable: this.parentEntity.data.physicalName,
			parentFields: fields.parentFields
		};
	}
	setRelationFields(childFields: string[], parentFields: string[]): void {
		let isPK = false;
		for (let i = 0; i < childFields.length; i++) {
			const parentField = this.parentEntity.getMyField(parentFields[i]);
			if (!parentField) continue;
			const childField  = this.childEntity.setMyField(childFields[i], this.parentEntity.data.physicalName, parentField.id);
			isPK = !!childField?.isPK;
		}

		this.relationType = isPK ? DIAGRAM_TYPE.RELATION_PK : DIAGRAM_TYPE.RELATION_AK;
		this._applyDash();
	}

	duplicateData(): RelationSnapshot {
		return {
			id: this.id,
			pid: this.parentEntity.id,
			cid: this.childEntity.id,
			relationType: this.relationType,
			diagramType: this.relationType,
			...this.getOption(),
		};
	}
}
