/**
 * 데이터베이스 연결. 실행 파일(Tauri)로 실행했을 때만 사용할 수 있다 (웹 브라우저에서는 DB 서버에 직접 연결할 수 없음).
 */
import type { DbmsType } from "../constants";

/** 실행 파일(Tauri)로 실행 중인지 */
export function isDesktopApp(): boolean {
	return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface ConnectionConfig {
	dbms: DbmsType;
	host: string;
	port: number;
	user: string;
	password: string;
	/** MariaDB/PostgreSQL/MS-SQL: 데이터베이스, Oracle: 서비스 이름 */
	database: string;
	/** PostgreSQL(public), MS-SQL(dbo), Oracle(사용자). MariaDB는 database */
	schema: string;
	/** MS-SQL: 서버 인증서를 확인하지 않음 */
	trustCert: boolean;
}

export const DEFAULT_PORTS: Record<DbmsType, number> = { mariadb: 3306, oracle: 1521, mssql: 1433, postgresql: 5432 };

/** 조회 결과 한 행. 컬럼명은 소문자 (Oracle은 별칭을 대문자로 돌려주므로) */
export type DbRow = Record<string, string | number | boolean | null>;

interface QueryResult {
	columns: string[];
	rows: (string | number | boolean | null)[][];
}

async function invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
	if (!isDesktopApp()) throw new Error("Database connections are available only in the desktop app.");
	const { invoke } = await import("@tauri-apps/api/core");
	try {
		return await invoke<T>(command, args);
	} catch (error) {
		throw new Error(typeof error === "string" ? error : error instanceof Error ? error.message : JSON.stringify(error));
	}
}

export class DbSession {
	private constructor(readonly config: ConnectionConfig, private id: number) {}

	static async connect(config: ConnectionConfig): Promise<DbSession> {
		const { schema: _schema, ...connectConfig } = config;
		const id = await invoke<number>("db_connect", { config: connectConfig });
		return new DbSession(config, id);
	}

	async query(sql: string): Promise<DbRow[]> {
		const result = await invoke<QueryResult>("db_query", { session: this.id, sql });
		const columns = result.columns.map(name => name.toLowerCase());
		return result.rows.map(row => Object.fromEntries(columns.map((name, i) => [name, row[i]])));
	}

	execute(sql: string): Promise<number> {
		return invoke<number>("db_execute", { session: this.id, sql });
	}

	close(): Promise<void> {
		return invoke<void>("db_close", { session: this.id });
	}
}

/** 연결해서 작업한 뒤 연결을 닫는다 */
export async function withSession<T>(config: ConnectionConfig, work: (session: DbSession) => Promise<T>): Promise<T> {
	const session = await DbSession.connect(config);
	try {
		return await work(session);
	} finally {
		session.close().catch(() => {});
	}
}

/* -----------------------------------------------------------------------------------
 * 연결 설정은 비밀번호를 제외하고 저장한다. 비밀번호는 앱을 닫을 때까지만 기억
 */
const STORAGE_KEY = "erd9.dbConnection";
let sessionPassword = "";

export function loadConnectionConfig(dbms: DbmsType): ConnectionConfig {
	let saved: Partial<ConnectionConfig> = {};
	try {
		saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
	} catch {
		// 저장된 값이 없거나 잘못됨
	}
	const config: ConnectionConfig = {
		dbms, host: "localhost", port: DEFAULT_PORTS[dbms], user: "", password: "", database: "", schema: "", trustCert: true,
		...saved,
	};
	config.password = sessionPassword;
	return config;
}

export function saveConnectionConfig(config: ConnectionConfig): void {
	sessionPassword = config.password;
	const { password: _password, ...saved } = config;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
	} catch {
		// 저장하지 못해도 동작에는 문제 없음
	}
}
