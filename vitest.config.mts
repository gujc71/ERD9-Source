import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // 화면(DOM)이 필요한 테스트는 파일 첫 줄에 // @vitest-environment jsdom
    environment: "node",
  },
});
