// 웹 버전 화면을 차례로 캡처한다. 먼저 프로젝트 폴더에서 npm run build && npm run preview 를 실행해 둔다.
import { execFileSync } from "node:child_process";
import { here } from "./lib.mjs";

for (const script of ["01_base", "02_diagram", "03_relation", "04_view", "05_files", "06_addons", "07_ai"]) {
	console.log(`== ${script}`);
	execFileSync(process.execPath, [here(`./${script}.mjs`)], { stdio: "inherit" });
}
