import { openDB } from "idb";
import type { DBSchema, IDBPDatabase, IDBPTransaction, StoreNames } from "idb";
import type { StackState } from "../core/DiagramStack";
import type { ERDFileData } from "../types";

const DB_NAME = "erd9";
/**
 * 1: storeFile
 * 2: autosave, history 추가
 * 3: 문서 내용(data)을 fileData, historyData로 분리. 목록(파일 열기, 이력)은 요약만 읽는다
 */
const DB_VERSION = 3;

/** 파일별로 보관하는 최대 이력 수 */
export const MAX_HISTORY = 20;

export interface StoredFile {
	fileId: number;
	fileName?: string;
	data?: ERDFileData;
	entityCount?: number;
	relationCount?: number;
	fileSize?: number;
	updateDate?: number;
	createDate?: number;
}

export type StoredFileSummary = Omit<StoredFile, "data" | "createDate">;

/** 저장하지 않은 작업 (자동 저장). 한 건만 보관 */
export interface AutoSaveRecord {
	key: "current";
	savedAt: number;
	fileId: number | null;
	/** 실행 파일: .erd9 파일 경로 */
	filePath?: string | null;
	fileName: string;
	data: ERDFileData;
	undo?: StackState;
}

/** 저장할 때마다 남기는 문서 이력 */
export interface HistoryRecord {
	id?: number;
	fileId: number;
	fileName?: string;
	savedAt: number;
	entityCount: number;
	relationCount: number;
	data?: ERDFileData;
}

/** 저장(Ctrl+S) 한 번에 기록하는 내용 */
export interface SaveDocumentInput {
	fileId: number;
	/** 새 파일일 때만 사용 (기존 파일은 이름 유지) */
	fileName?: string;
	/** 이력에 남기는 파일 이름 */
	historyFileName?: string;
	data: ERDFileData;
	entityCount: number;
	relationCount: number;
	savedAt?: number;
}

interface FileDataRecord { fileId: number; data: ERDFileData }
interface HistoryDataRecord { id?: number; data: ERDFileData }

interface ERD9DB extends DBSchema {
	/** 파일 요약 (data 없음) */
	storeFile: { key: number; value: StoredFile; indexes: { updateDate: number } };
	/** 파일 내용 */
	fileData: { key: number; value: FileDataRecord };
	autosave: { key: "current"; value: AutoSaveRecord };
	/** 이력 요약 (data 없음) */
	history: { key: number; value: HistoryRecord; indexes: { fileId: number } };
	/** 이력 내용. id는 history와 같다 */
	historyData: { key: number; value: HistoryDataRecord };
}

type UpgradeTx = IDBPTransaction<ERD9DB, StoreNames<ERD9DB>[], "versionchange">;

/** 버전 2 이하: 요약 레코드에 들어 있던 data를 별도 저장소로 옮긴다 */
async function migrateToV3(tx: UpgradeTx): Promise<void> {
	const fileData = tx.objectStore("fileData");
	for (let cursor = await tx.objectStore("storeFile").openCursor(); cursor; cursor = await cursor.continue()) {
		const { data, ...summary } = cursor.value;
		if (data === undefined) continue;
		fileData.put({ fileId: summary.fileId, data });
		cursor.update(summary);
	}
	const historyData = tx.objectStore("historyData");
	for (let cursor = await tx.objectStore("history").openCursor(); cursor; cursor = await cursor.continue()) {
		const { data, ...summary } = cursor.value;
		if (data === undefined) continue;
		// 키를 지정해서 넣으면 historyData의 키 생성기도 기존 id 다음부터 시작한다
		historyData.put({ id: summary.id, data });
		cursor.update(summary);
	}
}

export class IndexedDBManager {
  private db: IDBPDatabase<ERD9DB> | null = null;
  /** 연결이 끊겼을 때 (다른 탭의 버전 변경, 브라우저가 닫음) */
  onDisconnect: (() => void) | null = null;

  async open(): Promise<void> {
    try {
      this.db = await openDB<ERD9DB>(DB_NAME, DB_VERSION, {
        async upgrade(db, oldVersion, _newVersion, tx) {
          if (oldVersion < 1) {
            db.createObjectStore("storeFile", { keyPath: "fileId" }).createIndex("updateDate", "updateDate", { unique: false });
          }
          if (oldVersion < 2) {
            db.createObjectStore("autosave", { keyPath: "key" });
            db.createObjectStore("history", { keyPath: "id", autoIncrement: true }).createIndex("fileId", "fileId", { unique: false });
          }
          if (oldVersion < 3) {
            db.createObjectStore("fileData", { keyPath: "fileId" });
            db.createObjectStore("historyData", { keyPath: "id", autoIncrement: true });
            if (oldVersion > 0) {
              // 실패하면 업그레이드를 취소해서 이전 버전 데이터를 그대로 둔다
              try { await migrateToV3(tx); } catch (error) { console.error(error); tx.abort(); }
            }
          }
        },
        // 다른 탭에서 새 버전으로 열려고 하면 연결을 닫아 업그레이드를 막지 않는다
        blocking: () => { this.close(); },
        terminated: () => { this.db = null; this.onDisconnect?.(); },
      });
    } catch {
      throw new Error("An error occurred while opening IndexedDB.");
    }
  }

  close(): void {
    this.db?.close();
    if (this.db) {
      this.db = null;
      this.onDisconnect?.();
    }
  }

  get isOpen(): boolean {
    return this.db !== null;
  }

  private get _db(): IDBPDatabase<ERD9DB> {
    if (!this.db) throw new Error("IndexedDB is not opened.");
    return this.db;
  }

  /* ---------------------------------------------------------------- 파일 */
  /** 파일 추가/변경. data가 없으면 내용은 그대로 두고 요약만 변경 */
  async addOrUpdate(input: StoredFile): Promise<void> {
    const { data, ...summary } = input;
    const tx = this._db.transaction(["storeFile", "fileData"], "readwrite");
    // put은 호출할 때 값을 복사하므로 먼저 넣는다
    if (data !== undefined) tx.objectStore("fileData").put({ fileId: input.fileId, data });
    const files = tx.objectStore("storeFile");
    files.put(mergeFileSummary(await files.get(input.fileId), summary, Date.now()));
    await tx.done;
  }

  /**
   * 저장(Ctrl+S): 파일 내용, 요약, 이력 추가(오래된 이력 정리), 자동 저장 삭제를 한 트랜잭션으로.
   * data는 호출 즉시 복사(structured clone)되므로 호출 뒤에 문서가 바뀌어도 영향이 없다.
   */
  async saveDocument(input: SaveDocumentInput): Promise<void> {
    const now = input.savedAt ?? Date.now();
    const tx = this._db.transaction(["storeFile", "fileData", "history", "historyData", "autosave"] as StoreNames<ERD9DB>[], "readwrite");
    // 값 복사가 일어나는 put/add를 await 전에 모두 호출
    tx.objectStore("fileData").put({ fileId: input.fileId, data: input.data });
    const historyKey = tx.objectStore("historyData").add({ data: input.data });
    tx.objectStore("autosave").delete("current");

    const files = tx.objectStore("storeFile");
    const summary = { fileId: input.fileId, fileName: input.fileName, entityCount: input.entityCount, relationCount: input.relationCount };
    files.put(mergeFileSummary(await files.get(input.fileId), summary, now));

    const history = tx.objectStore("history");
    history.put({ id: await historyKey, fileId: input.fileId, fileName: input.historyFileName, savedAt: now,
                  entityCount: input.entityCount, relationCount: input.relationCount });
    await pruneHistory(tx, input.fileId);
    await tx.done;
  }

  async remove(key: number): Promise<void> {
    const tx = this._db.transaction(["storeFile", "fileData", "history", "historyData"], "readwrite");
    tx.objectStore("storeFile").delete(key);
    tx.objectStore("fileData").delete(key);
    const ids = await tx.objectStore("history").index("fileId").getAllKeys(key);
    for (const id of ids) {
      tx.objectStore("history").delete(id);
      tx.objectStore("historyData").delete(id);
    }
    await tx.done;
  }

  /** 파일 요약과 내용 */
  async get(key: number): Promise<StoredFile | undefined> {
    const tx = this._db.transaction(["storeFile", "fileData"], "readonly");
    const [summary, body] = await Promise.all([tx.objectStore("storeFile").get(key), tx.objectStore("fileData").get(key)]);
    if (!summary) return undefined;
    return body ? { ...summary, data: body.data } : summary;
  }

  /** 수정일 순 (오래된 것부터). 요약만 읽는다 */
  async getAllSortedByUpdateDate(): Promise<StoredFileSummary[]> {
    const results = await this._db.getAllFromIndex("storeFile", "updateDate");
    return results.map(({ fileId, fileName, fileSize, updateDate, entityCount, relationCount }) => ({ fileId, fileName, fileSize, updateDate, entityCount, relationCount }));
  }

  /* ---------------------------------------------------------------- 자동 저장 */
  /** record는 호출 즉시 복사된다 */
  async putAutoSave(record: AutoSaveRecord): Promise<void> {
    await this._db.put("autosave", record);
  }
  getAutoSave(): Promise<AutoSaveRecord | undefined> {
    return this._db.get("autosave", "current");
  }
  async clearAutoSave(): Promise<void> {
    await this._db.delete("autosave", "current");
  }

  /* ---------------------------------------------------------------- 이력 */
  /** 이력 추가. 파일별로 오래된 것부터 MAX_HISTORY개를 넘으면 삭제 */
  async addHistory(record: HistoryRecord): Promise<void> {
    const { data, id: _id, ...summary } = record;
    const tx = this._db.transaction(["history", "historyData"] as StoreNames<ERD9DB>[], "readwrite");
    const key = tx.objectStore("historyData").add({ data: data! });
    tx.objectStore("history").put({ ...summary, id: await key });
    await pruneHistory(tx, record.fileId);
    await tx.done;
  }
  /** 최신 순. 문서 내용(data)은 제외 */
  async getHistory(fileId: number): Promise<HistoryRecord[]> {
    const list = await this._db.getAllFromIndex("history", "fileId", fileId);
    return list.map(({ data: _data, ...summary }) => summary).sort((a, b) => b.savedAt - a.savedAt);
  }
  /** 이력 요약과 내용 */
  async getHistoryItem(id: number): Promise<HistoryRecord | undefined> {
    const tx = this._db.transaction(["history", "historyData"], "readonly");
    const [summary, body] = await Promise.all([tx.objectStore("history").get(id), tx.objectStore("historyData").get(id)]);
    if (!summary) return undefined;
    return body ? { ...summary, data: body.data } : summary;
  }
  async removeHistory(id: number): Promise<void> {
    const tx = this._db.transaction(["history", "historyData"], "readwrite");
    tx.objectStore("history").delete(id);
    tx.objectStore("historyData").delete(id);
    await tx.done;
  }
  async removeHistoryOfFile(fileId: number): Promise<void> {
    const tx = this._db.transaction(["history", "historyData"], "readwrite");
    const ids = await tx.objectStore("history").index("fileId").getAllKeys(fileId);
    for (const id of ids) {
      tx.objectStore("history").delete(id);
      tx.objectStore("historyData").delete(id);
    }
    await tx.done;
  }
}

function mergeFileSummary(existing: StoredFile | undefined, summary: Omit<StoredFile, "data">, now: number): StoredFile {
  return existing
    ? { ...existing, entityCount: summary.entityCount, relationCount: summary.relationCount, updateDate: now }
    : { ...summary, createDate: now, updateDate: now };
}

/** 파일의 이력이 MAX_HISTORY개를 넘으면 오래된 것(savedAt 순)부터 삭제. 요약만 읽는다 */
async function pruneHistory(tx: IDBPTransaction<ERD9DB, StoreNames<ERD9DB>[], "readwrite">, fileId: number): Promise<void> {
  const history = tx.objectStore("history");
  const list = await history.index("fileId").getAll(fileId);
  if (list.length <= MAX_HISTORY) return;
  list.sort((a, b) => b.savedAt - a.savedAt);
  for (const item of list.slice(MAX_HISTORY)) {
    history.delete(item.id!);
    tx.objectStore("historyData").delete(item.id!);
  }
}

/* -------------------------------------------------------------------------------------
 * 연결 재사용: 열 때마다 열고 닫지 않고 한 연결을 계속 쓴다.
 * 다른 탭이 새 버전으로 열려고 하면(blocking) 닫고, 다음 호출에서 다시 연다.
 */
let shared: Promise<IndexedDBManager> | null = null;

function getShared(): Promise<IndexedDBManager> {
	if (!shared) {
		const manager = new IndexedDBManager();
		const opening: Promise<IndexedDBManager> = manager.open().then(() => manager);
		manager.onDisconnect = () => { if (shared === opening) shared = null; };
		opening.catch(() => { if (shared === opening) shared = null; });
		shared = opening;
	}
	return shared;
}

/** DB 작업. 실패하면 알림을 띄우고 undefined 반환 (quiet이면 알림 없음) */
export async function withDB<T>(work: (db: IndexedDBManager) => Promise<T>, quiet = false): Promise<T | undefined> {
	try {
		let manager = await getShared();
		if (!manager.isOpen) {
			shared = null;
			manager = await getShared();
		}
		return await work(manager);
	} catch (error) {
		// 연결이 닫히는 중이었으면 다음 호출에서 다시 연다
		if (error instanceof DOMException && error.name === "InvalidStateError") shared = null;
		if (quiet) console.error(error);
		else alert(error instanceof Error ? error.message : error);
		return undefined;
	}
}
