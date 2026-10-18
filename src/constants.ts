export const VIEW_MODE = {
	PHYSICAL: "physical",
	LOGICAL: "logical",
	MIXED: "mixed"
} as const;
export type ViewMode = typeof VIEW_MODE[keyof typeof VIEW_MODE];

export const VIEW_DATA = {
	ALL: "all",
	ENTITY: "entity",
	KEYS: "keys"
} as const;
export type ViewData = typeof VIEW_DATA[keyof typeof VIEW_DATA];

export const RELATION_DIRECTION = {
	E: "east",
	W: "west",
	S: "south",
	N: "north"
} as const;
export type RelationDirection = typeof RELATION_DIRECTION[keyof typeof RELATION_DIRECTION];

export const RELATION_TYPE = {
	PARENT: "parent",
	CHILD: "child"
} as const;
export type RelationEnd = typeof RELATION_TYPE[keyof typeof RELATION_TYPE];

export const RELATION_CARDINALITY = {
	O2O: "one",
	O2M: "many",
} as const;
export type RelationCardinality = typeof RELATION_CARDINALITY[keyof typeof RELATION_CARDINALITY];

export const RELATION_SELECTION = {
	MM: "mm",		// Mandatory To Mandatory
	MO: "mo",		// Mandatory To Optional
	OO: "oo",		// Optional  To Optional
	OM: "om",		// Optional  To Mandatory
} as const;
export type RelationSelection = typeof RELATION_SELECTION[keyof typeof RELATION_SELECTION];

export const DIAGRAM_TYPE = {
	NONE: "",
	ENTITY: "entity",
	RELATION_PK: "pk",
	RELATION_AK: "ak",
	/** 다대다 관계 도구: 교차 테이블을 만들고 식별 관계 2개로 연결 (생성 도구로만 사용) */
	RELATION_MN: "mn",
	TEXT: "text",
	/** 주제 영역 */
	AREA: "area"
} as const;
export type DiagramType = typeof DIAGRAM_TYPE[keyof typeof DIAGRAM_TYPE];
/** 관계선 종류 (식별 / 비식별) */
export type RelationKind = typeof DIAGRAM_TYPE.RELATION_PK | typeof DIAGRAM_TYPE.RELATION_AK;

export const DBMS_TYPE = {
	MARIADB: "mariadb",
	ORACLE: "oracle",
	MSSQL: "mssql",
	POSTGRESQL: "postgresql"
} as const;
export type DbmsType = typeof DBMS_TYPE[keyof typeof DBMS_TYPE];

export const MOUSE_ACTION_TYPE = {
	NONE: "",
	SELECT: "s",
	FUNCTION: "func",
	ENTITY_MOVE: "m",
	ENTITY_MOVING: "move",
	ENTITY_RELATION: "relation",
	AREA_RESIZE: "resize",
	/** 관계선의 꺾이는 위치 조정 */
	RELATION_BEND: "bend",
	/** 엔터티 안에서 컬럼 순서 변경 */
	FIELD_MOVE: "field",
} as const;
export type MouseActionType = typeof MOUSE_ACTION_TYPE[keyof typeof MOUSE_ACTION_TYPE];

export const STATE_TYPE = {
	ENTITY_CREATE: "ec",
	ENTITY_REMOVE: "er",
	ENTITY_MODIFY: "em",
	ENTITY_MOVE:   "m",
	RELATION_CREATE: "rc",
	RELATION_REMOVE: "rr",
	RELATION_MODIFY: "rm",
	MULTY_CREATE: "mc",
	MULTY_REMOVE: "mr",
} as const;
export type StateType = typeof STATE_TYPE[keyof typeof STATE_TYPE];

/** 외래키 참조 동작 (ON DELETE / ON UPDATE) */
export const REFERENTIAL_ACTIONS = ["NO ACTION", "CASCADE", "SET NULL", "SET DEFAULT", "RESTRICT"] as const;
export type ReferentialAction = typeof REFERENTIAL_ACTIONS[number];

/** 파일(JSON) 저장 형식 버전. 형식이 바뀌면 올리고 validateERDFile에 변환을 추가 */
export const ERD_FILE_VERSION = 3;

/** 엔터티(테이블) 그리기 치수 (그룹 기준 좌표, 원점은 엔터티의 왼쪽 위) */
export const ENTITY_LAYOUT = {
	/** 테이블 이름이 들어가는 머리글 높이 */
	HEADER_HEIGHT: 26,
	/** 컬럼 한 줄 높이 */
	ROW_HEIGHT: 20,
	/** 키 / 일반 컬럼 영역의 위아래 여백 */
	SECTION_PADDING: 3,
	/** 컬럼이 없는 영역의 높이 */
	EMPTY_SECTION_HEIGHT: 10,
	/** 왼쪽 여백, PK/FK 표시 열 폭, 열 사이 간격, 오른쪽 여백 */
	PADDING_X: 8,
	BADGE_WIDTH: 18,
	COLUMN_GAP: 14,
	MIN_WIDTH: 120,
	CORNER_RADIUS: 5,
} as const;

/** 엔터티 머리글 기본 색 (엔터티 색을 지정하지 않은 경우) */
export const ENTITY_HEADER_COLOR = "#eef2f7";
