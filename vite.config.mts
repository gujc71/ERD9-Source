import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { cpSync } from "node:fs";

const COPYRIGHT = "/*! Copyright 2023 Ja-Chul, Gu */";

/**
 * 콘텐츠 보안 정책. GitHub Pages처럼 응답 헤더를 지정할 수 없는 곳에서도 적용되도록 빌드 결과의 <meta>로 넣는다.
 * (index.js 서버는 같은 정책을 헤더로도 보냄)
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",          // style 속성 사용
  "img-src 'self' data: blob:",                // 툴바 아이콘, 인쇄 미리보기
  "connect-src 'self' ipc: http://ipc.localhost https://gujc71.github.io https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com",   // 샘플 파일, AI API, 실행 파일(Tauri)의 IPC
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

function contentSecurityPolicy(): Plugin {
  return {
    name: "erd9-csp",
    apply: "build",   // 개발 서버는 HMR(인라인 스크립트, websocket)을 쓰므로 제외
    transformIndexHtml() {
      return [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" }];
    },
  };
}

/** 논리명 생성 사전(dictionay/*.csv)을 빌드 결과에 복사. 개발 서버는 프로젝트 폴더를 그대로 서비스 */
function copyDictionaries(): Plugin {
  return {
    name: "erd9-dictionaries",
    apply: "build",
    closeBundle() {
      cpSync("dictionay", "dist/dictionay", { recursive: true });
    },
  };
}

export default defineConfig({
  // 상대 경로로 빌드하여 GitHub Pages 같은 하위 경로에서도 동작하도록 함
  base: "./",
  plugins: [contentSecurityPolicy(), copyDictionaries()],
  build: {
    target: "es2022",
    minify: "terser",
    terserOptions: {
      mangle: { toplevel: true },
      compress: { passes: 2 },
      format: { comments: /Copyright/ },
    },
    rollupOptions: {
      output: { banner: COPYRIGHT },
    },
  },
});
