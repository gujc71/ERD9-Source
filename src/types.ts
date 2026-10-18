import type { BaseType, Selection } from "d3-selection";
import type { DbmsType, DiagramType, ReferentialAction, RelationCardinality, RelationKind, RelationSelection } from "./constants";

/** d3 selection 단축 타입 */
export type Sel<E extends BaseType = BaseType, D = any> = Selection<E, D, any, any>;

export interface FieldData {
	id: string;
	column: string;
	comment?: string;
	dataType: string;
	defaultValue?: string | number;
	notNull?: boolean;
	isPK?: boolean;
	uniqueKey?: boolean;
	ai?: boolean;
	/** FK인 경우 부모 테이블명 */
	parent?: string | null;
	/** FK인 경우 부모 컬럼 id */
	parentID?: string | null;
	/** 도메인 id. 데이터 타입, 기본값, NOT NULL을 도메인에서 가져온다 */
	domain?: string;
}

export interface IndexData {
	name: string;
	/** 콤마로 구분된 컬럼 목록 */
	fields: string;
	/** UNIQUE 인덱스 (여러 컬럼이면 복합 유니크) */
	unique?: boolean;
}

/** CHECK 제약조건 */
export interface CheckData {
	name: string;
	/** 괄호 안에 들어갈 조건식. 예: price >= 0 */
	expression: string;
}

export interface EntityData {
	physicalName: string;
	logicalName?: string;
	keys: FieldData[];
	fields: FieldData[];
	indexes?: IndexData[];
	checks?: CheckData[];
	/** 엔터티 배경색 (#rrggbb) */
	color?: string;
	/** keys + fields 참조 (저장되지 않는 값) */
	allFields?: FieldData[];
}

/** Entity9 내부에서 사용하는 데이터 - allFields가 항상 존재 */
export interface EntityModel extends EntityData {
	allFields: FieldData[];
}

/** 주제 영역 */
export interface AreaData {
	name: string;
	/** #rrggbb */
	color: string;
	width: number;
	height: number;
}

/** 뷰 (문서 단위 객체) */
export interface ViewObject {
	id: string;
	name: string;
	comment?: string;
	/** AS 뒤에 오는 SELECT 문 */
	query: string;
}

/** 도메인: 여러 컬럼이 같이 쓰는 데이터 타입 정의 (문서 단위 객체) */
export interface DomainObject {
	id: string;
	name: string;
	dataType: string;
	defaultValue?: string | number;
	notNull?: boolean;
	comment?: string;
}

/** 표준 단어: 논리명(고객) -> 물리 약어(CUST) */
export interface StdWord {
	logical: string;
	physical: string;
}

/** 표준 용어: 단어를 조합한 컬럼 이름(고객번호 -> CUST_NO)과 도메인 */
export interface StdTerm {
	logical: string;
	physical: string;
	/** 도메인 id */
	domain?: string;
}

/** 시퀀스 (문서 단위 객체) */
export interface SequenceObject {
	id: string;
	name: string;
	start?: number;
	increment?: number;
	minValue?: number;
	maxValue?: number;
	cycle?: boolean;
}

/**
 * 다이어그램 페이지 (ERwin의 Subject Area).
 * 모델의 일부 엔터티만 보여주며, 한 엔터티가 여러 페이지에 들어갈 수 있고 페이지마다 위치가 다르다.
 * 글상자와 영역은 만든 페이지에만 보인다.
 */
export interface PageData {
	id: string;
	name: string;
	/** 엔터티 id -> 이 페이지에서의 위치 */
	entities: Record<string, Point>;
}

export interface Point {
	x: number;
	y: number;
}

export interface Rect {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

/** 관계(외래키) 옵션 */
export interface RelationOption {
	relationCard: RelationCardinality;
	relationSelect: RelationSelection;
	onDelete?: ReferentialAction;
	onUpdate?: ReferentialAction;
	/** 관계선 가운데에 표시하는 설명 (예: places) */
	label?: string;
	/** 꺾이는 위치. 부모 끝(0)에서 자식 끝(1) 사이 비율. 없으면 자동 */
	bend?: number;
	/** 부모 / 자식 끝이 붙는 위치. 붙은 변의 시작(왼쪽, 위 0)에서 끝(1) 사이 비율. 없으면 자동 */
	parentAt?: number;
	childAt?: number;
}

/* -----------------------------------------------------------------------------------
 * 파일(JSON) 저장 형식
 */
export interface EntityFileData extends Rect {
	data: EntityData;
}

export interface RelationFileData extends RelationOption {
	id: string;
	parent: string;
	child: string;
	relationType: RelationKind;
	/** 제약조건 이름 (DDL에서 가져온 경우) */
	name?: string;
}

export interface TextFileData {
	x1: number;
	y1: number;
	data: string;
	/** 글상자가 있는 페이지 id. 없으면 Main */
	page?: string;
}

export interface AreaFileData extends AreaData {
	id: string;
	x1: number;
	y1: number;
	/** 영역이 있는 페이지 id. 없으면 Main */
	page?: string;
}

export interface ERDFileData {
	/** 파일 형식 버전 (ERD_FILE_VERSION). 버전 1 파일에는 없음 */
	version: number;
	dbms: DbmsType;
	entityData: Record<string, EntityFileData>;
	relationData: RelationFileData[];
	textData: TextFileData[];
	areaData: AreaFileData[];
	views: ViewObject[];
	sequences: SequenceObject[];
	/** 다이어그램 페이지. entityData의 위치는 Main 페이지 위치 */
	pages: PageData[];
	domains: DomainObject[];
	/** 표준 단어 사전 */
	words: StdWord[];
	/** 표준 용어 사전 */
	terms: StdTerm[];
}

/* -----------------------------------------------------------------------------------
 * undo / redo 용 데이터
 */
export interface DiagramSnapshot {
	id: string;
	x1: number;
	y1: number;
	data: EntityModel | AreaData | string;
	diagramType: DiagramType;
}

export interface RelationSnapshot extends RelationOption {
	id: string;
	pid: string;
	cid: string;
	relationType: RelationKind;
	diagramType: DiagramType;
	name?: string;
}

export type RelationLink = Omit<RelationSnapshot, "diagramType">;

export interface PositionState {
	id: string;
	x1: number;
	y1: number;
	x2?: number;
	backupX?: number;
	backupY?: number;
}

/** 관계에 사용되는 컬럼 (DDL 생성 등) */
export interface RelationFieldInfo {
	childTable: string;
	childFields: string;
	parentTable: string;
	parentFields: string;
}

/* -----------------------------------------------------------------------------------
 * AI가 생성한 ERD 형식
 */
export interface AIFieldData {
	column: string;
	comment?: string | null;
	dataType: string;
	default?: string | null;
	isPK?: boolean;
	nullable?: boolean;
}

export interface AITableData {
	id: string;
	physicalName: string;
	logicalName?: string | null;
	fields: AIFieldData[];
}

export interface AIRelationData {
	parent: string;
	parentTable: string;
	parentColumns: string;
	child: string;
	childTable: string;
	childColumns: string;
	/** "pk" | "fk" */
	relationType: string;
}

export interface AIERDData {
	tables: AITableData[];
	relationData?: AIRelationData[];
}
