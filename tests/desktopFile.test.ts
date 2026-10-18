import { describe, expect, it } from "vitest";
import { fileTitle, pathFileId } from "../src/storage/desktopFile";

describe("desktop file", () => {
	it("shows the file name without the .erd9 extension", () => {
		expect(fileTitle("C:\\work\\shop.erd9")).toBe("shop");
		expect(fileTitle("/home/user/shop.v2.ERD9")).toBe("shop.v2");
	});

	it("makes a history key from the path that does not overlap the web file ids", () => {
		const id = pathFileId("C:\\work\\shop.erd9");
		expect(id).toBeLessThan(0);
		expect(Number.isInteger(id)).toBe(true);
		// Windows 경로: 대소문자와 구분자는 같은 파일
		expect(pathFileId("c:/WORK/Shop.erd9")).toBe(id);
		expect(pathFileId("C:\\work\\other.erd9")).not.toBe(id);
	});
});
