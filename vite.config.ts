import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@mcp_router/shared", replacement: path.resolve(__dirname, "src/types") },
      { find: "@mcp_router/ui", replacement: path.resolve(__dirname, "src/components/ui") },
      // @/renderer/utils → src/lib (Plan 1 renamed utils to lib)
      { find: /^@\/renderer\/utils($|\/)/, replacement: path.resolve(__dirname, "src/lib") + "$1" },
      { find: /^@\/renderer\/components($|\/)/, replacement: path.resolve(__dirname, "src/components") + "$1" },
      { find: /^@\/renderer\/stores($|\/)/, replacement: path.resolve(__dirname, "src/stores") + "$1" },
      { find: /^@\/renderer\/platform-api($|\/)/, replacement: path.resolve(__dirname, "src/platform-api") + "$1" },
      // @/* fallback (must be after the more-specific @mcp_router/* and @/renderer/*)
      { find: "@", replacement: path.resolve(__dirname, "src") },
    ],
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5174,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
