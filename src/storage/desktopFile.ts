/**
 * 실행 파일(Tauri)의 문서 파일: JSON 형식의 .erd9 파일로 저장하고 연다.
 * 웹 버전은 브라우저(IndexedDB)에 저장한다 (erdManager.saveFile, fileDialogs.OpenFileDialog9).
 */
export const ERD9_EXTENSION = "erd9";

async function invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
	const { invoke } = await import("@tauri-apps/api/core");
	try {
		return await invoke<T>(command, args);
	} catch (error) {
		throw new Error(typeof error === "string" ? error : error instanceof Error ? error.message : JSON.stringify(error));
	}
}

/** 저장할 파일 선택. 확장자가 없으면 .erd9를 붙인다. 취소하면 null */
export async function chooseSavePath(defaultName: string): Promise<string | null> {
	const path = await invoke<string | null>("pick_save_path", { defaultName: `${defaultName}.${ERD9_EXTENSION}` });
	if (!path) return null;
	return new RegExp(`\\.${ERD9_EXTENSION}$`, "i").test(path) ? path : `${path}.${ERD9_EXTENSION}`;
}

/** 열 파일 선택. 취소하면 null */
export async function chooseOpenPath(): Promise<string | null> {
	return invoke<string | null>("pick_open_path", {});
}

export function writeERDFile(path: string, contents: string): Promise<void> {
	return invoke<void>("write_erd_file", { path, contents });
}

/** 파일을 읽어 JSON으로. 읽지 못하거나 JSON이 아니면 예외 */
export async function readERDFile(path: string): Promise<unknown> {
	const text = await invoke<string>("read_erd_file", { path });
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`The file is not a valid ERD9 file: ${path}`);
	}
}

/** 경로의 파일 이름 (확장자 제외) */
export function fileTitle(path: string): string {
	return (path.split(/[\\/]/).pop() ?? path).replace(new RegExp(`\\.${ERD9_EXTENSION}$`, "i"), "");
}

/**
 * 파일 경로로 만든 이력(IndexedDB) 키. 웹의 파일 id(Date.now())와 겹치지 않도록 음수.
 * Windows 경로는 대소문자를 구분하지 않으므로 소문자로 (FNV-1a 32비트)
 */
export function pathFileId(path: string): number {
	let hash = 0x811c9dc5;
	for (const ch of path.replace(/\//g, "\\").toLowerCase()) {
		hash ^= ch.codePointAt(0)!;
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return -(hash + 1);
}
