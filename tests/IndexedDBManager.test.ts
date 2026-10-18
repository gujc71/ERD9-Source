import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { IndexedDBManager, MAX_HISTORY } from "../src/storage/IndexedDBManager";
import type { ERDFileData } from "../src/types";

/** withDB는 오류를 alert로 처리하므로 테스트에서는 직접 열고 닫는다 */
async function withDB(work: (db: IndexedDBManager) => Promise<void>): Promise<void> {
	const db = new IndexedDBManager();
	await db.open();
	try { await work(db); } finally { db.close(); }
}

const data = { version: 2, dbms: "mariadb", entityData: {}, relationData: [], textData: [], areaData: [], views: [], sequences: [], pages: [], domains: [], words: [], terms: [] } as ERDFileData;

describe("IndexedDBManager", () => {
	it("adds, updates, lists and removes files", async () => {
		await withDB(async db => {
			await db.addOrUpdate({ fileId: 1, fileName: "a", data, entityCount: 1, relationCount: 0 });
			const created = (await db.get(1))!;
			await db.addOrUpdate({ fileId: 1, entityCount: 3, relationCount: 2 });
			const updated = (await db.get(1))!;
			expect(updated).toMatchObject({ fileName: "a", entityCount: 3, relationCount: 2, data, createDate: created.createDate });

			await db.addOrUpdate({ fileId: 2, fileName: "b", data, entityCount: 0, relationCount: 0 });
			const list = await db.getAllSortedByUpdateDate();
			expect(list.map(f => f.fileId).sort()).toEqual([1, 2]);
			expect(list[0]).not.toHaveProperty("data");

			await db.addHistory({ fileId: 1, savedAt: 1, entityCount: 0, relationCount: 0, data });
			await db.remove(1);
			expect(await db.get(1)).toBeUndefined();
			expect(await db.getHistory(1)).toEqual([]);
		});
	});

	it("keeps the latest MAX_HISTORY history records per file", async () => {
		await withDB(async db => {
			for (let i = 0; i < MAX_HISTORY + 3; i++) {
				await db.addHistory({ fileId: 7, savedAt: i, entityCount: i, relationCount: 0, data });
			}
			await db.addHistory({ fileId: 8, savedAt: 0, entityCount: 0, relationCount: 0, data });
			const list = await db.getHistory(7);
			expect(list).toHaveLength(MAX_HISTORY);
			expect(list[0].savedAt).toBe(MAX_HISTORY + 2);
			expect(list[0]).not.toHaveProperty("data");
			expect((await db.getHistoryItem(list[0].id!))!.data).toEqual(data);
			expect(await db.getHistory(8)).toHaveLength(1);
		});
	});

	it("stores a single auto save record", async () => {
		await withDB(async db => {
			await db.putAutoSave({ key: "current", savedAt: 1, fileId: null, fileName: "x", data });
			await db.putAutoSave({ key: "current", savedAt: 2, fileId: null, fileName: "y", data });
			expect((await db.getAutoSave())!.fileName).toBe("y");
			await db.clearAutoSave();
			expect(await db.getAutoSave()).toBeUndefined();
		});
	});
});
