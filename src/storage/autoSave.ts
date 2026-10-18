/**
 * 자동 저장: 수정된 문서를 주기적으로 IndexedDB에 보관하고, 다음에 열 때 복구할지 묻는다.
 * 실행취소 기록도 함께 보관하므로 복구 후에도 이어서 실행취소할 수 있다.
 */
import { getFileName, makeERDData, openERDData, preloadERDValidator, setDocumentRef } from "../erdManager";
import { state } from "../state";
import { hideLoadingScreen, showLoadingScreen } from "../ui";
import { withDB } from "./IndexedDBManager";
import type { AutoSaveRecord } from "./IndexedDBManager";

const AUTOSAVE_INTERVAL = 30_000;
/** 브라우저가 바쁘면 이 시간까지만 기다린다 */
const IDLE_TIMEOUT = 10_000;

let savedChangeCount = -1;
let saving = false;

async function autoSave(): Promise<void> {
	const stack = state.diagramStack;
	if (saving || !stack.isModified || stack.changeCount === savedChangeCount) return;

	saving = true;
	try {
		let changeCount = stack.changeCount;
		// 문서와 실행취소 기록은 복사하지 않고 넘긴다. putAutoSave(IndexedDB put)가 호출 즉시 복사(structured clone)하므로
		// DB를 연(await) 뒤, 같은 동기 구간에서 만들어 넣어야 한다
		const ok = await withDB(async db => {
			changeCount = stack.changeCount;
			await db.putAutoSave({
				key: "current",
				savedAt: Date.now(),
				fileId: state.savedFileID,
				filePath: state.savedFilePath,
				fileName: getFileName(),
				data: makeERDData(false),
				undo: stack.exportState(),
			});
			return true;
		}, true);
		if (ok) savedChangeCount = changeCount;
	} finally {
		saving = false;
	}
}

/** 브라우저가 쉬고 있을 때 자동 저장 */
function autoSaveWhenIdle(): void {
	if (typeof requestIdleCallback === "function") requestIdleCallback(() => { autoSave(); }, { timeout: IDLE_TIMEOUT });
	else autoSave();
}

export function startAutoSave(): void {
	setInterval(autoSaveWhenIdle, AUTOSAVE_INTERVAL);
	// 탭을 닫거나 다른 탭으로 이동할 때 (숨겨진 탭에서는 idle 콜백이 늦어지므로 바로)
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") autoSave();
	});
	// 파일 검증기(zod)를 미리 불러온다
	preloadERDValidator();
}

/** 저장하지 않은 작업이 있으면 반환 */
export function getAutoSave(): Promise<AutoSaveRecord | undefined> {
	return withDB(db => db.getAutoSave(), true);
}

/** 자동 저장된 문서 복구 */
export async function restoreAutoSave(record: AutoSaveRecord): Promise<void> {
	showLoadingScreen();
	try {
		if (await openERDData(record.data, false)) {
			setDocumentRef({ fileId: record.fileId, filePath: record.filePath ?? null, fileName: record.fileName });
			state.diagramStack.importState(record.undo);
			state.diagramStack.markModified();
		}
	} finally {
		hideLoadingScreen();
	}
}
