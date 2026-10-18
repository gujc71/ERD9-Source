// 빌드 결과(dist/assets/*.js)에 난독화를 추가로 적용 (npm run build:obf)
// 외부 라이브러리를 그대로 복사한 파일(ELK Web Worker)은 제외
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import JavaScriptObfuscator from "javascript-obfuscator";

const dir = "dist/assets";
for (const file of readdirSync(dir).filter((f) => f.endsWith(".js") && !f.startsWith("elk-worker"))) {
  const path = join(dir, file);
  const result = JavaScriptObfuscator.obfuscate(readFileSync(path, "utf-8"), {
    compact: true,
    identifierNamesGenerator: "hexadecimal",
    stringArray: true,
    stringArrayThreshold: 0.75,
  });
  writeFileSync(path, "/*! Copyright 2023 Ja-Chul, Gu */\n" + result.getObfuscatedCode());
  console.log("obfuscated:", path);
}
