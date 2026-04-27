import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const sharedAlias = {
  "@": resolve(__dirname, "src"),
  "@mcp_router/shared": resolve(__dirname, "../../packages/shared/src"),
  "@mcp_router/ui": resolve(__dirname, "../../packages/ui/src"),
  "@mcp_router/tailwind-config": resolve(
    __dirname,
    "../../packages/tailwind-config",
  ),
};

export default defineConfig({
  main: {
    resolve: { alias: sharedAlias },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/main.ts") },
      },
    },
  },
  preload: {
    resolve: { alias: sharedAlias },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/preload.ts") },
      },
    },
  },
  renderer: {
    root: "src",
    resolve: {
      alias: sharedAlias,
      // monorepo 下 packages/ui 与 apps/electron 可能各自解析到不同的 react 副本，
      // 触发 "Invalid hook call"。强制复用同一份 react / react-dom 实例。
      dedupe: ["react", "react-dom"],
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/index.html") },
      },
    },
  },
});
