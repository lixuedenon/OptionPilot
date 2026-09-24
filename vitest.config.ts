// vitest.config.ts
// 独立于vite.config.ts的测试专用配置——只是给`@`路径别名和测试环境做
// 声明，故意不去动vite.config.ts本身（那个文件驱动生产构建，不想让测试
// 工具的配置跟生产构建配置耦合在一起，改测试配置不该有任何机会影响到
// `npm run build`）。
import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});