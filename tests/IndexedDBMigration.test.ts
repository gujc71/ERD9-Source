import "fake-indexeddb/auto";
import { openDB } from "idb";
import { describe, expect, it } from "vitest";
import { IndexedDBManager, MAX_HISTORY } from "../src/storage/IndexedDBManager";
import type { ERDFileData } from "../src/types";

const data = (name: string) => ({ version: 3, dbms: "mariadb", entityData: { er1: { x1: 0, y1: 0, x2: 1, y2: 1, data: { physicalName: name, keys: [], fields: [] } } },
	relationData: [], textData: [], areaData: [], views: [], sequences: [], pages: [], domains: [], words: [], terms: [] }) as unknown as ERDFileData;

/** 버전 2 형식(요약과 내용이 한 레코드)으로 DB를 만든다 */
async function createV2Database(): Promise<number[]> {
	const db = await openDB("erd9", 2, {
		upgrade(db) {
			db.createObjectStore("storeFile", { keyPath: "fileId" }).createIndex("updateDate", "updateDate", { unique: false });
			db.createObjectStore("autosave", { keyPath: "key" });
			db.createObjectStore("history", { keyPath: "id", autoIncrement: true }).createIndex("fileId", "fileId", { unique: false });
		},
	});
	await db.put("storeFile", { fileId: 1, fileName: "first", data: data("A"), entityCount: 1, relationCount: 0, createDate: 10, updateDate: 20 });
	await db.put("storeFile", { fileId: 2, fileName: "second", data: data("B"), entityCount: 1, relationCount: 0, createDate: 11, updateDate: 30 });
	const ids: number[] = [];
	for (let i = 0; i < 3; i++) ids.push(await db.add("history", { fileId: 1, fileName: "first", savedAt: 100 + i, entityCount: i, relationCount: 0, data: data("H" + i) }) as number);
	await db.put("autosave", { key: "current", savedAt: 5, fileId: 1, fileName: "first", data: data("AUTO") });
	db.close();
	return ids;
}

describe("IndexedDBManager migration (v2 -> v3)", () => {
	it("moves document bodies to separate stores without losing data", async () => {
		const oldIds = await createV2Database();

		const db = new IndexedDBManager();
		await db.open();
		try {
			// 요약 목록은 그대로, 내용은 get으로
			const list = await db.getAllSortedByUpdateDate();
			expect(list.map(f => f.fileName)).toEqual(["first", "second"]);
			expect(list[0]).not.toHaveProperty("data");
			expect(await db.get(1)).toMatchObject({ fileId: 1, fileName: "first", createDate: 10, updateDate: 20, data: data("A") });
			expect((await db.get(2))!.data).toEqual(data("B"));

			const history = await db.getHistory(1);
			expect(history.map(h => h.id)).toEqual([...oldIds].reverse());
			expect(history[0]).not.toHaveProperty("data");
			expect((await db.getHistoryItem(oldIds[1]))!.data).toEqual(data("H1"));
			expect((await db.getAutoSave())!.data).toEqual(data("AUTO"));

			// 저장된 요약 레코드에는 data가 없다
			const raw = await openDB("erd9");
			expect(await raw.get("storeFile", 1)).not.toHaveProperty("data");
			expect(await raw.get("history", oldIds[0])).not.toHaveProperty("data");
			raw.close();

			// 이후 저장: 새 이력 id는 기존 id와 겹치지 않는다
			await db.saveDocument({ fileId: 1, historyFileName: "first", data: data("A2"), entityCount: 1, relationCount: 0, savedAt: 200 });
			const after = await db.getHistory(1);
			expect(after).toHaveLength(4);
			expect(after[0].id).toBeGreaterThan(Math.max(...oldIds));
			expect((await db.getHistoryItem(after[0].id!))!.data).toEqual(data("A2"));
			expect((await db.get(1))!).toMatchObject({ fileName: "first", createDate: 10, data: data("A2") });
			expect(await db.getAutoSave()).toBeUndefined();
		} finally {
			db.close();
		}
	});

	it("saveDocument keeps MAX_HISTORY versions and removes their bodies", async () => {
		const db = new IndexedDBManager();
		await db.open();
		try {
			for (let i = 0; i < MAX_HISTORY + 5; i++) {
				await db.saveDocument({ fileId: 9, fileName: "nine", historyFileName: "nine", data: data("N" + i), entityCount: i, relationCount: 0, savedAt: 1000 + i });
			}
			const list = await db.getHistory(9);
			expect(list).toHaveLength(MAX_HISTORY);
			expect(list[0].savedAt).toBe(1000 + MAX_HISTORY + 4);
			const raw = await openDB("erd9");
			const bodies = await raw.getAllKeys("historyData");
			const summaries = await raw.getAllKeys("history");
			raw.close();
			expect(new Set(bodies)).toEqual(new Set(summaries));

			await db.remove(9);
			expect(await db.get(9)).toBeUndefined();
			expect(await db.getHistory(9)).toEqual([]);
		} finally {
			db.close();
		}
	});
});
