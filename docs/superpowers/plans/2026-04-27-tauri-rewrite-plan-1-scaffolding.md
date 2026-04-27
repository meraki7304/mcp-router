# MCP Router Tauri Rewrite — Plan 1: Scaffolding & Skeleton

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing Electron monorepo with a flat Tauri 2 + React + Rust scaffold; wire one end-to-end ping command; lay the basic Rust infrastructure (`AppError`, `AppState`, tracing, sqlx pool with empty schema). On completion: `pnpm tauri dev` opens a window, a button click reaches Rust and returns a response.

**Architecture:** Burn down the monorepo. Cherry-pick scaffold files from a fresh `pnpm create tauri-app --template react-ts`. `git mv` existing React/UI/types code into the flat `src/` layout, deferring per-file refactors to later plans. Add tsconfig path aliases so existing `@mcp_router/shared` imports continue to resolve into `src/types`.

**Tech Stack:** Tauri 2.x, React 19, TypeScript 5, Vite 7, Tailwind 3, Rust 1.75+, tokio, sqlx (sqlite + runtime-tokio-rustls), tracing, ts-rs 10, thiserror, anyhow

**Companion spec:** `docs/superpowers/specs/2026-04-27-mcp-router-tauri-rewrite-design.md`

**Plan series:** Plan 1 of N. Subsequent plans (persistence, MCP, HTTP, workflow, commands, frontend integration, platform glue, build) will be written after Plan 1 lands and we've validated the scaffold patterns.

**Out of scope for Plan 1:** Repository implementations, MCP modules, HTTP server, workflow executor, real IPC commands beyond ping, fixing existing renderer code that depends on `window.electronAPI`. Those files will sit in `src/components/` but are not entry points until later plans wire them up.

---

## Prerequisites

Before starting, verify on a host machine:

- [ ] Rust toolchain ≥ 1.75: `rustup show`
- [ ] Tauri 2 system prereqs (Windows: WebView2 runtime — pre-installed on Win 11)
- [ ] Tauri CLI: `cargo install tauri-cli --version "^2"`
- [ ] sqlx CLI: `cargo install sqlx-cli --no-default-features --features sqlite,rustls`
- [ ] pnpm ≥ 10.22 (project already uses it)
- [ ] Working tree clean: `git status` returns empty

---

## File Structure (state at end of Plan 1)

```
mcp-router/
├── docs/superpowers/{specs,plans}/    # unchanged
├── src/                               # NEW (flat React frontend)
│   ├── main.tsx                       # Vite entry (NEW)
│   ├── App.tsx                        # minimal stub calling ping (NEW)
│   ├── platform-api/
│   │   └── tauri-platform-api.ts      # ping wrapper only (NEW)
│   ├── components/
│   │   ├── ui/                        # MOVED from packages/ui/src/components
│   │   ├── App.tsx, Home.tsx, ...     # MOVED from apps/electron/src/renderer/components (sit dormant)
│   │   ├── common/ layout/ mcp/ setting/ workflow/   # MOVED, dormant
│   ├── stores/                        # MOVED from apps/electron/src/renderer/stores (dormant)
│   ├── types/                         # MOVED from packages/shared/src/types
│   ├── lib/utils.ts                   # MOVED from packages/ui/src/lib/utils.ts
│   ├── locales/                       # MOVED from apps/electron/src/locales
│   └── styles/                        # MOVED from packages/ui/src/styles
├── src-tauri/
│   ├── Cargo.toml                     # NEW
│   ├── tauri.conf.json                # NEW (configured)
│   ├── build.rs                       # NEW
│   ├── migrations/0001_init.sql       # NEW (empty placeholder)
│   ├── .sqlx/                         # NEW (committed query metadata, empty for now)
│   └── src/
│       ├── main.rs                    # NEW
│       ├── lib.rs                     # NEW (tauri::Builder装配)
│       ├── error.rs                   # NEW (AppError enum)
│       ├── state.rs                   # NEW (AppState)
│       ├── persistence/
│       │   ├── mod.rs                 # NEW
│       │   └── pool.rs                # NEW (sqlx pool init + migrate)
│       └── commands/
│           ├── mod.rs                 # NEW
│           └── ping.rs                # NEW (smoke test command)
├── public/                            # MOVED from apps/electron/public
├── index.html                         # NEW (Vite entry HTML)
├── package.json                       # NEW (flat, single)
├── pnpm-lock.yaml                     # regenerated
├── tsconfig.json                      # NEW
├── tsconfig.node.json                 # NEW
├── vite.config.ts                     # NEW
├── tailwind.config.js                 # NEW
├── postcss.config.js                  # NEW
├── components.json                    # NEW (shadcn config)
├── .gitignore                         # MERGED
└── README.md                          # NEW
```

Files **deleted**: `apps/`, `packages/`, `pnpm-workspace.yaml`, `turbo.json`, `knip.json`, `eslint.config.mjs` (root), `tsconfig.json` (old root), `package.json` (old root), `tools/` (if present).

---

## Tasks

### Task 1: Create work branch and tag the Electron baseline

**Files:** none (git only)

- [ ] **Step 1: Confirm clean state and current branch**

```bash
git status
git rev-parse --abbrev-ref HEAD
```

Expected: `working tree clean`, branch is `main`.

- [ ] **Step 2: Tag the last Electron commit for traceability**

```bash
git tag -a electron-final -m "Last Electron-based version before Tauri rewrite"
```

- [ ] **Step 3: Create rewrite branch**

```bash
git checkout -b tauri-rewrite
```

Expected: `Switched to a new branch 'tauri-rewrite'`.

- [ ] **Step 4: Push tag (optional, only if remote configured)**

```bash
git push origin electron-final 2>/dev/null || echo "no remote, skipping"
```

---

### Task 2: Generate a fresh Tauri scaffold in a temp directory

We can't run `pnpm create tauri-app` in the repo root (non-empty). Generate it elsewhere and cherry-pick.

**Files:** none in repo (operates on `/tmp/mcp-router-scaffold`)

- [ ] **Step 1: Generate scaffold**

```bash
cd /tmp
rm -rf mcp-router-scaffold
pnpm create tauri-app mcp-router-scaffold --template react-ts --manager pnpm --identifier com.mcprouter.app
cd mcp-router-scaffold
```

Expected: directory created with `src/`, `src-tauri/`, `package.json`, `vite.config.ts`, `index.html`, `tsconfig.json`, `tsconfig.node.json`.

- [ ] **Step 2: Install scaffold deps**

```bash
pnpm install
```

- [ ] **Step 3: Smoke-test the scaffold runs**

```bash
pnpm tauri dev
```

Wait for window to open showing default Tauri+React demo, then `Ctrl+C` to stop. This proves Tauri toolchain is working before we cherry-pick.

- [ ] **Step 4: Inspect scaffold layout**

```bash
find . -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/target/*' -not -path '*/.git/*' | sort
```

Note the file list — Plan 1 uses these as the source of truth for what the new repo should look like.

---

### Task 3: Stage existing renderer/UI/types/locales code outside repo

Before the burn-down we copy code we want to preserve (with git history preserved by `git mv` later).

**Files:** none in repo (copies to `/tmp/mcp-router-keep/`)

- [ ] **Step 1: Stage renderer + UI + types + locales + public**

```bash
cd C:/Projects/WebstormProjects/mcp-router
mkdir -p /tmp/mcp-router-keep
cp -r apps/electron/src/renderer /tmp/mcp-router-keep/renderer
cp -r packages/ui/src /tmp/mcp-router-keep/ui-src
cp -r packages/shared/src /tmp/mcp-router-keep/shared-src
cp -r apps/electron/src/locales /tmp/mcp-router-keep/locales
cp -r apps/electron/public /tmp/mcp-router-keep/public
cp apps/electron/components.json /tmp/mcp-router-keep/components.json
cp apps/electron/postcss.config.js /tmp/mcp-router-keep/postcss.config.js
cp apps/electron/tailwind.config.js /tmp/mcp-router-keep/tailwind.config.js
```

- [ ] **Step 2: Verify staging is intact**

```bash
ls /tmp/mcp-router-keep/
ls /tmp/mcp-router-keep/renderer/
```

Expected: see `renderer/`, `ui-src/`, `shared-src/`, `locales/`, `public/`, plus the three config files.

---

### Task 4: Burn down the monorepo

**Files:**
- Delete: `apps/`, `packages/`, `pnpm-workspace.yaml`, `turbo.json`, `knip.json`, `eslint.config.mjs`, `tsconfig.json`, `package.json`, `public/`, `tools/`

- [ ] **Step 1: Remove monorepo top-level dirs and configs (tracked by git)**

```bash
cd C:/Projects/WebstormProjects/mcp-router
git rm -r apps packages
git rm pnpm-workspace.yaml turbo.json knip.json eslint.config.mjs tsconfig.json package.json
git rm -r public tools 2>/dev/null || true
```

- [ ] **Step 2: Remove generated dirs (not tracked)**

```bash
rm -rf node_modules
```

- [ ] **Step 3: Inspect remaining tree**

```bash
ls
```

Expected: only `docs/`, `pnpm-lock.yaml`, plus dotfiles like `.git/`, `.gitignore`. Maybe `pnpm-lock.yaml` remains; that's fine — Step 4 deletes it.

- [ ] **Step 4: Remove stale lockfile**

```bash
git rm pnpm-lock.yaml
```

- [ ] **Step 5: Commit burn-down**

```bash
git commit -m "chore(rewrite): 移除 Electron monorepo 结构"
```

---

### Task 5: Cherry-pick scaffold core files into repo

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `index.html`
- Create: `src-tauri/` (entire directory from scaffold)

- [ ] **Step 1: Copy top-level scaffold files**

```bash
cd C:/Projects/WebstormProjects/mcp-router
cp /tmp/mcp-router-scaffold/package.json .
cp /tmp/mcp-router-scaffold/tsconfig.json .
cp /tmp/mcp-router-scaffold/tsconfig.node.json .
cp /tmp/mcp-router-scaffold/vite.config.ts .
cp /tmp/mcp-router-scaffold/index.html .
```

- [ ] **Step 2: Copy src-tauri directory**

```bash
cp -r /tmp/mcp-router-scaffold/src-tauri .
```

- [ ] **Step 3: Verify**

```bash
ls
ls src-tauri/
```

Expected: top-level shows `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `index.html`, `src-tauri/`, plus existing `docs/`. `src-tauri/` shows `Cargo.toml`, `tauri.conf.json`, `src/main.rs`, `build.rs`, etc.

- [ ] **Step 4: Verify .gitignore covers Rust + node**

```bash
cat .gitignore
```

If `target/` and `node_modules/` are not present, append:

```bash
cat >> .gitignore <<'EOF'

# Rust
src-tauri/target/

# Node
node_modules/
dist/

# sqlx prepared queries are committed, but cache isn't
src-tauri/.sqlx-cache/
EOF
```

- [ ] **Step 5: Stage everything**

```bash
git add .
```

- [ ] **Step 6: Commit**

```bash
git commit -m "chore(rewrite): 引入 Tauri 2 + React 脚手架"
```

---

### Task 6: Adjust package.json identity and scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Replace `package.json` with project-aligned values**

Open `package.json`, set top-level fields. The scaffold provides dependencies — keep them, only edit identity and scripts. Final shape:

```json
{
  "name": "mcp-router",
  "private": true,
  "version": "1.1.0",
  "description": "Effortlessly manage your MCP servers with the MCP Router.",
  "type": "module",
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=10.0.0"
  },
  "packageManager": "pnpm@10.22.0",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  },
  "dependencies": {
    "@tauri-apps/api": "^2",
    "react": "^19.2.5",
    "react-dom": "^19.2.5"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^5.2.0",
    "typescript": "^5.9.3",
    "vite": "^7.3.2"
  }
}
```

- [ ] **Step 2: Install**

```bash
pnpm install
```

Expected: success, `pnpm-lock.yaml` regenerated, `node_modules/` populated.

- [ ] **Step 3: Verify dev works**

```bash
pnpm tauri dev
```

Wait for window with default Tauri+React UI, then `Ctrl+C`. (We have not added our renderer code yet — this confirms scaffold works in our repo location.)

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: 调整 package.json identity 与脚本"
```

---

### Task 7: Move existing React renderer into src/

We replace the scaffold's demo `src/` with our renderer code. The scaffold's `src/main.tsx` and `src/App.tsx` will be **rewritten** in Task 11 — for now, delete them and pull existing code in.

**Files:**
- Delete: `src/App.tsx`, `src/App.css`, `src/main.tsx`, `src/index.css`, `src/assets/` (all scaffold demo files)
- Create: `src/components/`, `src/stores/`, `src/platform-api/`, `src/lib/`, `src/locales/`, `src/styles/`, `src/types/` from staged copies

- [ ] **Step 1: Wipe scaffold demo files inside src/**

```bash
cd C:/Projects/WebstormProjects/mcp-router
git rm -r src 2>/dev/null || rm -rf src
mkdir src
```

- [ ] **Step 2: Copy renderer subtree**

```bash
cp -r /tmp/mcp-router-keep/renderer/components src/components
cp -r /tmp/mcp-router-keep/renderer/stores src/stores
cp -r /tmp/mcp-router-keep/renderer/platform-api src/platform-api
cp -r /tmp/mcp-router-keep/renderer/utils src/lib
```

- [ ] **Step 3: Copy shadcn UI components into `src/components/ui/`**

```bash
mkdir -p src/components/ui
cp -r /tmp/mcp-router-keep/ui-src/components/* src/components/ui/
cp /tmp/mcp-router-keep/ui-src/lib/utils.ts src/lib/utils.ts
```

- [ ] **Step 4: Copy shared types**

```bash
mkdir -p src/types
cp -r /tmp/mcp-router-keep/shared-src/types/* src/types/
cp /tmp/mcp-router-keep/shared-src/index.ts src/types/index.ts
```

- [ ] **Step 5: Copy locales and styles**

```bash
cp -r /tmp/mcp-router-keep/locales src/locales
cp -r /tmp/mcp-router-keep/ui-src/styles src/styles 2>/dev/null || true
```

- [ ] **Step 6: Copy public assets**

```bash
rm -rf public
cp -r /tmp/mcp-router-keep/public public
```

- [ ] **Step 7: Verify layout**

```bash
ls src/
ls src/components/
ls src/components/ui/ | head -10
ls src/types/
```

Expected: `src/` contains `components/`, `stores/`, `platform-api/`, `lib/`, `locales/`, `styles/`, `types/`. `src/components/ui/` shows `button.tsx`, `dialog.tsx`, etc. `src/types/` shows `index.ts` and `types/` files.

- [ ] **Step 8: Stage and commit**

```bash
git add src/ public/
git commit -m "chore(rewrite): 把现有 renderer/ui/types/locales 搬入扁平 src/"
```

---

### Task 8: Configure Vite + TypeScript path aliases

Existing renderer code imports from `@mcp_router/shared` and `@mcp_router/ui`. Add aliases so those paths resolve into the new flat layout. Avoids a giant find-replace this round.

**Files:**
- Modify: `tsconfig.json`
- Modify: `vite.config.ts`

- [ ] **Step 1: Replace tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@mcp_router/shared": ["src/types"],
      "@mcp_router/shared/*": ["src/types/*"],
      "@mcp_router/ui": ["src/components/ui"],
      "@mcp_router/ui/*": ["src/components/ui/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 2: Update vite.config.ts to mirror the aliases**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@mcp_router/shared": path.resolve(__dirname, "src/types"),
      "@mcp_router/ui": path.resolve(__dirname, "src/components/ui"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
```

- [ ] **Step 3: Commit**

```bash
git add tsconfig.json vite.config.ts
git commit -m "chore: 配置 vite + tsconfig 路径别名兼容旧 import 形态"
```

---

### Task 9: Set up Tailwind 3 + shadcn config

**Files:**
- Create: `tailwind.config.js`, `postcss.config.js`, `components.json`
- Modify: `package.json` (add tailwind devDeps)

- [ ] **Step 1: Install Tailwind + PostCSS**

```bash
pnpm add -D tailwindcss@^3 postcss autoprefixer @tailwindcss/typography tailwindcss-animate clsx tailwind-merge class-variance-authority
```

- [ ] **Step 2: Bring in existing Tailwind config**

```bash
cp /tmp/mcp-router-keep/tailwind.config.js tailwind.config.js
cp /tmp/mcp-router-keep/postcss.config.js postcss.config.js
cp /tmp/mcp-router-keep/components.json components.json
```

- [ ] **Step 3: Adjust tailwind.config.js content paths**

Open `tailwind.config.js` and ensure the `content` field points at the new flat layout. Replace the array with:

```js
content: [
  "./index.html",
  "./src/**/*.{ts,tsx}",
],
```

(Remove any `apps/electron/...` or `packages/ui/...` paths.)

- [ ] **Step 4: Adjust components.json paths**

Open `components.json` and ensure aliases point inside the flat src:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.js",
    "css": "src/styles/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui"
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add tailwind.config.js postcss.config.js components.json package.json pnpm-lock.yaml
git commit -m "chore: Tailwind 3 + shadcn 配置回归扁平布局"
```

---

### Task 10: Configure tauri.conf.json for our app identity

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Write the configured tauri.conf.json**

Replace the file content with:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "MCP Router",
  "version": "1.1.0",
  "identifier": "com.mcprouter.app",
  "build": {
    "beforeDevCommand": "pnpm dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "pnpm build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "MCP Router",
        "width": 1200,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600,
        "decorations": true,
        "resizable": true,
        "fullscreen": false,
        "center": true
      }
    ],
    "security": {
      "csp": "default-src 'self' 'unsafe-inline' ipc: http://ipc.localhost; connect-src 'self' ipc: http://ipc.localhost http://localhost:* https://github.com https://api.github.com https://objects.githubusercontent.com; img-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

> Note: `decorations: true` keeps the OS title bar for Plan 1. Custom title bar (Win `decorations: false` + transparent overlay, macOS `Overlay`) is deferred to a later "Platform glue" plan.

- [ ] **Step 2: Verify icons exist**

```bash
ls src-tauri/icons/
```

Expected: scaffold provides default icons. Replacement with project icons happens in a later plan.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "chore(tauri): 配置 productName / identifier / window 尺寸 / CSP"
```

---

### Task 11: Establish minimal Vite entry and stub App.tsx

The existing renderer's `src/components/App.tsx` won't compile yet (depends on `window.electronAPI`). We create a **new** entry that only renders a small smoke-test UI. Existing components stay on disk for later plans.

**Files:**
- Create: `src/main.tsx`
- Create: `src/App.tsx` (overwrite if existing)
- Create: `src/styles/globals.css` (if missing)
- Modify: `index.html`

- [ ] **Step 1: Create src/main.tsx**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 2: Move existing src/components/App.tsx aside, create new top-level src/App.tsx**

```bash
git mv src/components/App.tsx src/components/_LegacyApp.tsx
```

- [ ] **Step 3: Create src/App.tsx (smoke-test UI)**

```tsx
import { useState } from "react";

import { ping } from "./platform-api/tauri-platform-api";

export default function App() {
  const [name, setName] = useState("World");
  const [reply, setReply] = useState<string>("");

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>MCP Router (Tauri Skeleton)</h1>
      <p>End-to-end smoke test. Type a name and click Ping.</p>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: 6 }}
        />
        <button
          onClick={async () => {
            try {
              const out = await ping(name);
              setReply(out);
            } catch (err) {
              setReply(`error: ${String(err)}`);
            }
          }}
          style={{ padding: 6 }}
        >
          Ping
        </button>
      </div>
      <pre style={{ marginTop: 16 }}>{reply}</pre>
    </main>
  );
}
```

- [ ] **Step 4: Ensure styles/globals.css exists**

```bash
mkdir -p src/styles
test -f src/styles/globals.css || cat > src/styles/globals.css <<'EOF'
@tailwind base;
@tailwind components;
@tailwind utilities;
EOF
```

- [ ] **Step 5: Update index.html to load /src/main.tsx**

Open `index.html` and ensure the script tag points to `/src/main.tsx`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MCP Router</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Commit (the platform-api file referenced doesn't exist yet — we add it in Task 12; that's why we don't try to run dev here)**

```bash
git add src/main.tsx src/App.tsx src/styles/globals.css index.html src/components/_LegacyApp.tsx
git commit -m "feat(frontend): 加最小 main.tsx + 烟测 App.tsx (ping UI)"
```

---

### Task 12: Add tauri-platform-api stub (frontend ping wrapper)

**Files:**
- Create: `src/platform-api/tauri-platform-api.ts`

> The existing `src/platform-api/electron-platform-api.ts` and `index.ts` and `platform-api-context.tsx` stay on disk but are not imported by the new App.tsx. Plan 8 (frontend integration) will replace them.

- [ ] **Step 1: Create the stub**

```ts
import { invoke } from "@tauri-apps/api/core";

export async function ping(name: string): Promise<string> {
  return invoke<string>("ping", { name });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/platform-api/tauri-platform-api.ts
git commit -m "feat(frontend): tauri-platform-api ping 封装"
```

---

### Task 13: Set up Cargo.toml with target dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Replace Cargo.toml**

The scaffold provides a minimal Cargo.toml. Expand to include the dependencies we need across Plan 1+ (only core ones used in Plan 1; later plans add MCP/HTTP/etc.):

```toml
[package]
name = "mcp-router"
version = "1.1.0"
description = "Effortlessly manage your MCP servers with the MCP Router."
authors = ["王权 <meraki7304@foxmail.com>"]
edition = "2021"
rust-version = "1.75"

[lib]
name = "mcp_router_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "1"
anyhow = "1"
tokio = { version = "1", features = ["full"] }
sqlx = { version = "0.8", default-features = false, features = ["runtime-tokio-rustls", "sqlite", "macros", "migrate", "chrono", "uuid"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }
ts-rs = { version = "10", features = ["serde-compat", "chrono-impl", "uuid-impl"] }
chrono = { version = "0.4", features = ["serde"] }
uuid = { version = "1", features = ["v4", "v7", "serde"] }

[dev-dependencies]
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }

[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
```

- [ ] **Step 2: Run cargo check to confirm deps resolve**

```bash
cd src-tauri
cargo check
cd ..
```

Expected: long compile + success. If it fails on a version, bump to latest stable (e.g., `cargo search sqlx --limit 1`).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(rust): Cargo.toml 加上 tokio/sqlx/tracing/ts-rs/serde 等基础依赖"
```

---

### Task 14: Implement AppError (TDD)

**Files:**
- Create: `src-tauri/src/error.rs`
- Create: `src-tauri/tests/error_test.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod error;`)

- [ ] **Step 1: Write failing test**

Create `src-tauri/tests/error_test.rs`:

```rust
use mcp_router_lib::error::AppError;
use serde_json::json;

#[test]
fn app_error_serializes_with_kind_and_message() {
    let err = AppError::NotFound("server abc".into());
    let v = serde_json::to_value(&err).expect("serialize");
    assert_eq!(v, json!({ "kind": "NotFound", "message": "server abc" }));
}

#[test]
fn app_error_invalid_input_serialization() {
    let err = AppError::InvalidInput("bad".into());
    let v = serde_json::to_value(&err).expect("serialize");
    assert_eq!(v, json!({ "kind": "InvalidInput", "message": "bad" }));
}

#[test]
fn app_error_from_sqlx_maps_to_internal() {
    // sqlx::Error::RowNotFound -> AppError::NotFound (special-case)
    let sqlx_err = sqlx::Error::RowNotFound;
    let app_err: AppError = sqlx_err.into();
    matches!(app_err, AppError::NotFound(_));
}
```

- [ ] **Step 2: Run the test to verify it fails (compile error)**

```bash
cd src-tauri
cargo test --test error_test
cd ..
```

Expected: FAIL with "unresolved import `mcp_router_lib::error`".

- [ ] **Step 3: Write minimal implementation in src-tauri/src/error.rs**

```rust
use serde::{Serialize, Serializer};
use thiserror::Error;
use ts_rs::TS;

#[derive(Debug, Error, TS)]
#[ts(export, export_to = "../src/types/generated/")]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
    #[error("not found: {0}")]
    NotFound(String),

    #[error("invalid input: {0}")]
    InvalidInput(String),

    #[error("upstream: {0}")]
    Upstream(String),

    #[error("internal: {0}")]
    Internal(String),
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        struct Body<'a> {
            kind: &'a str,
            message: String,
        }
        let body = match self {
            AppError::NotFound(m) => Body { kind: "NotFound", message: m.clone() },
            AppError::InvalidInput(m) => Body { kind: "InvalidInput", message: m.clone() },
            AppError::Upstream(m) => Body { kind: "Upstream", message: m.clone() },
            AppError::Internal(m) => Body { kind: "Internal", message: m.clone() },
        };
        body.serialize(serializer)
    }
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        match err {
            sqlx::Error::RowNotFound => AppError::NotFound("row not found".into()),
            other => AppError::Internal(other.to_string()),
        }
    }
}

impl From<anyhow::Error> for AppError {
    fn from(err: anyhow::Error) -> Self {
        AppError::Internal(err.to_string())
    }
}

pub type AppResult<T> = std::result::Result<T, AppError>;
```

- [ ] **Step 4: Wire mod in src-tauri/src/lib.rs**

Open `src-tauri/src/lib.rs` (scaffold version exists). For now add at the top:

```rust
pub mod error;
```

(Other `pub mod` lines come in later tasks.)

- [ ] **Step 5: Re-run tests**

```bash
cd src-tauri
cargo test --test error_test
cd ..
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/error.rs src-tauri/src/lib.rs src-tauri/tests/error_test.rs
git commit -m "feat(rust): AppError + serde tag/content + sqlx From"
```

---

### Task 15: Implement AppState skeleton

**Files:**
- Create: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod state;`)

The AppState today only wraps the sqlx pool; later plans add `Arc<ServerManager>`, `Arc<AggregatorServer>`, etc.

- [ ] **Step 1: Create src-tauri/src/state.rs**

```rust
use std::sync::Arc;

use sqlx::SqlitePool;

#[derive(Clone)]
pub struct AppState {
    pub pool: Arc<SqlitePool>,
}

impl AppState {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            pool: Arc::new(pool),
        }
    }
}
```

- [ ] **Step 2: Wire mod in lib.rs**

Append after `pub mod error;`:

```rust
pub mod state;
```

- [ ] **Step 3: Verify compile**

```bash
cd src-tauri
cargo check
cd ..
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/lib.rs
git commit -m "feat(rust): AppState 骨架（仅持有 sqlx pool）"
```

---

### Task 16: Set up sqlx pool init and migrations

**Files:**
- Create: `src-tauri/src/persistence/mod.rs`
- Create: `src-tauri/src/persistence/pool.rs`
- Create: `src-tauri/migrations/0001_init.sql`
- Create: `src-tauri/tests/pool_test.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create empty placeholder migration**

```bash
mkdir -p src-tauri/migrations
cat > src-tauri/migrations/0001_init.sql <<'EOF'
-- Plan 1 placeholder: real schema arrives in Plan 2 (persistence).
-- This migration ensures the sqlx migrator runs cleanly with at least one file.

CREATE TABLE IF NOT EXISTS _meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR REPLACE INTO _meta(key, value) VALUES ('schema_introduced_at', strftime('%Y-%m-%d', 'now'));
EOF
```

- [ ] **Step 2: Create persistence/mod.rs**

```rust
pub mod pool;
```

- [ ] **Step 3: Write failing pool test**

Create `src-tauri/tests/pool_test.rs`:

```rust
use std::path::PathBuf;

use mcp_router_lib::persistence::pool::init_pool;

#[tokio::test]
async fn init_pool_creates_db_and_runs_migrations() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let db_path: PathBuf = tmp.path().join("test.sqlite");

    let pool = init_pool(&db_path).await.expect("pool");

    let row: (String,) = sqlx::query_as("SELECT value FROM _meta WHERE key = 'schema_introduced_at'")
        .fetch_one(&pool)
        .await
        .expect("query meta row");

    assert!(!row.0.is_empty());
}
```

Add `tempfile = "3"` to `[dev-dependencies]` in Cargo.toml:

```toml
[dev-dependencies]
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
tempfile = "3"
```

- [ ] **Step 4: Run test, expect failure**

```bash
cd src-tauri
cargo test --test pool_test
cd ..
```

Expected: FAIL — "unresolved import `mcp_router_lib::persistence::pool::init_pool`".

- [ ] **Step 5: Implement persistence/pool.rs**

```rust
use std::path::Path;

use sqlx::{
    migrate::Migrator,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};
use tracing::info;

use crate::error::AppResult;

static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

pub async fn init_pool(db_path: &Path) -> AppResult<SqlitePool> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            crate::error::AppError::Internal(format!("create db dir: {e}"))
        })?;
    }

    let opts = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(opts)
        .await?;

    info!(path = %db_path.display(), "running sqlx migrations");
    MIGRATOR.run(&pool).await.map_err(|e| {
        crate::error::AppError::Internal(format!("migrate: {e}"))
    })?;

    Ok(pool)
}
```

- [ ] **Step 6: Wire mod in lib.rs**

Append after `pub mod state;`:

```rust
pub mod persistence;
```

- [ ] **Step 7: Re-run test**

```bash
cd src-tauri
cargo test --test pool_test
cd ..
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/persistence src-tauri/migrations src-tauri/tests/pool_test.rs src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs
git commit -m "feat(persistence): sqlx 池初始化 + 0001_init 占位迁移 + 集成测试"
```

---

### Task 17: Generate sqlx prepared queries (offline mode)

`sqlx::query!` macros validate SQL at compile time. For CI / clean clones we run `cargo sqlx prepare` and commit `.sqlx/`. Plan 1 has no `query!` macro yet (only string queries in tests), but we set up the workflow so Plan 2 can use it.

**Files:**
- Create: `src-tauri/.sqlx/.gitkeep`
- Modify: `.gitignore` (ensure .sqlx is committed)

- [ ] **Step 1: Initialize .sqlx directory**

```bash
mkdir -p src-tauri/.sqlx
touch src-tauri/.sqlx/.gitkeep
```

- [ ] **Step 2: Confirm .gitignore does NOT exclude .sqlx**

```bash
grep -n "\.sqlx" .gitignore || echo "good — .sqlx is tracked"
```

If `.sqlx` is excluded, remove that line.

- [ ] **Step 3: Add a project README note for sqlx prepare workflow**

Create or append to `README.md`:

```markdown
## SQLx prepared queries

When you change SQL inside `sqlx::query!` macros, regenerate offline metadata:

```bash
cd src-tauri
DATABASE_URL=sqlite::memory: cargo sqlx prepare -- --tests
```

Commit the resulting `src-tauri/.sqlx/` changes.
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/.sqlx README.md .gitignore
git commit -m "chore(sqlx): 预留 .sqlx 目录与 prepare 工作流文档"
```

---

### Task 18: Implement ping command (TDD)

**Files:**
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/ping.rs`
- Create: `src-tauri/tests/ping_test.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing test**

Create `src-tauri/tests/ping_test.rs`:

```rust
use mcp_router_lib::commands::ping::ping_impl;

#[test]
fn ping_returns_hello_with_name() {
    let out = ping_impl("Tauri");
    assert_eq!(out, "Hello, Tauri! (from Rust)");
}

#[test]
fn ping_handles_empty_name() {
    let out = ping_impl("");
    assert_eq!(out, "Hello, world! (from Rust)");
}
```

- [ ] **Step 2: Run test, expect failure**

```bash
cd src-tauri
cargo test --test ping_test
cd ..
```

Expected: FAIL — unresolved imports.

- [ ] **Step 3: Implement commands/ping.rs**

```rust
use crate::error::AppResult;

pub fn ping_impl(name: &str) -> String {
    let display = if name.trim().is_empty() { "world" } else { name };
    format!("Hello, {display}! (from Rust)")
}

#[tauri::command]
pub async fn ping(name: String) -> AppResult<String> {
    Ok(ping_impl(&name))
}
```

- [ ] **Step 4: Create commands/mod.rs**

```rust
pub mod ping;
```

- [ ] **Step 5: Wire mod in lib.rs**

Append after `pub mod persistence;`:

```rust
pub mod commands;
```

- [ ] **Step 6: Re-run test**

```bash
cd src-tauri
cargo test --test ping_test
cd ..
```

Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands src-tauri/tests/ping_test.rs src-tauri/src/lib.rs
git commit -m "feat(commands): ping 烟测命令（pure fn + #[tauri::command] 包装）"
```

---

### Task 19: Wire tauri::Builder in lib.rs and main.rs

This is where everything comes together: tracing init, DB pool init, AppState construction, command registration.

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Replace src-tauri/src/lib.rs with full builder**

```rust
pub mod commands;
pub mod error;
pub mod persistence;
pub mod state;

use std::sync::Arc;

use tauri::{Manager, RunEvent};
use tracing::{error, info};
use tracing_subscriber::{fmt, EnvFilter};

use crate::{
    commands::ping::ping,
    persistence::pool::init_pool,
    state::AppState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("resolve app data dir");
            let db_path = app_data_dir.join("mcp-router.sqlite");

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match init_pool(&db_path).await {
                    Ok(pool) => {
                        let state = AppState::new(pool);
                        handle.manage(state);
                        info!("AppState initialized");
                    }
                    Err(err) => {
                        error!(?err, "failed to init AppState");
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ping])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                info!("exit requested");
            }
        });
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,mcp_router_lib=debug"));
    let _ = fmt().with_env_filter(filter).try_init();
}
```

- [ ] **Step 2: Update src-tauri/src/main.rs**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mcp_router_lib::run();
}
```

- [ ] **Step 3: cargo check**

```bash
cd src-tauri
cargo check
cd ..
```

Expected: success. If `tauri_plugin_shell` is not in Cargo.toml, add `tauri-plugin-shell = "2"`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/main.rs
git commit -m "feat(rust): tauri::Builder 装配 tracing + AppState + ping handler"
```

---

### Task 20: End-to-end smoke run

**Files:** none (run only)

- [ ] **Step 1: Start Tauri dev**

```bash
pnpm tauri dev
```

Wait until window opens. Expected: window titled "MCP Router" shows the smoke test UI ("Type a name and click Ping").

- [ ] **Step 2: Click Ping**

Type a name (e.g., "Tauri"), click `Ping`. Expected: `<pre>` shows `Hello, Tauri! (from Rust)`.

- [ ] **Step 3: Inspect Rust logs**

In the terminal running `tauri dev`, expect lines like:

```
INFO running sqlx migrations path=...mcp-router.sqlite
INFO AppState initialized
```

- [ ] **Step 4: Verify DB file was created**

```bash
ls "$APPDATA/com.mcprouter.app/" 2>/dev/null || ls ~/Library/Application\ Support/com.mcprouter.app/ 2>/dev/null
```

Expected: see `mcp-router.sqlite`. (Path varies by OS — Windows: `%APPDATA%\com.mcprouter.app\`; macOS: `~/Library/Application Support/com.mcprouter.app/`; Linux: `~/.local/share/com.mcprouter.app/`.)

- [ ] **Step 5: Stop dev server (`Ctrl+C`)**

- [ ] **Step 6: If anything failed: fix root cause, re-run from Step 1. Do not proceed to Task 21 until smoke test is green.**

---

### Task 21: Generate ts-rs types and verify export path

ts-rs writes generated `.d.ts` when tests with `#[ts(export)]` types run. Wire it in.

**Files:**
- Create: `src/types/generated/.gitkeep`
- Modify: `tsconfig.json` (already includes src/, ok)

- [ ] **Step 1: Ensure target dir exists**

```bash
mkdir -p src/types/generated
touch src/types/generated/.gitkeep
```

- [ ] **Step 2: Run cargo test (which triggers ts-rs export)**

```bash
cd src-tauri
cargo test
cd ..
```

Expected: tests pass and `src/types/generated/AppError.ts` is created.

- [ ] **Step 3: Inspect generated file**

```bash
cat src/types/generated/AppError.ts
```

Expected: a TS type definition matching the AppError variants.

- [ ] **Step 4: Commit**

```bash
git add src/types/generated
git commit -m "chore(ts-rs): 生成 AppError.ts 并提交（后续类型同走此路径）"
```

---

### Task 22: Document the workflow in README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace/append README content**

```markdown
# MCP Router

Tauri 2 + React + Rust 实现的 MCP 服务管理工具。

## Tech stack

- 前端：React 19 + Vite + TypeScript + Tailwind 3 + shadcn/ui
- 后端：Rust + Tauri 2 + tokio + sqlx (sqlite) + tracing
- IPC：Tauri commands；类型由 ts-rs 自动生成到 `src/types/generated/`

## Develop

```bash
pnpm install
pnpm tauri dev
```

## Build

```bash
pnpm tauri build
```

## Tests

```bash
cd src-tauri
cargo test
```

## SQLx prepared queries

When you change SQL inside `sqlx::query!` macros, regenerate offline metadata:

```bash
cd src-tauri
DATABASE_URL=sqlite::memory: cargo sqlx prepare -- --tests
```

Commit the resulting `src-tauri/.sqlx/` changes.

## Project structure

See `docs/superpowers/specs/2026-04-27-mcp-router-tauri-rewrite-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README 简介 + dev/build/test/sqlx 工作流"
```

---

### Task 23: Final clean-up and tag

**Files:** none (git only)

- [ ] **Step 1: Verify tree is sane**

```bash
git status
```

Expected: clean.

- [ ] **Step 2: Verify build still works**

```bash
pnpm tauri dev
```

Click Ping again, confirm. `Ctrl+C`.

- [ ] **Step 3: Run all Rust tests**

```bash
cd src-tauri
cargo test
cd ..
```

Expected: all pass (error_test 3, pool_test 1, ping_test 2 = 6 tests).

- [ ] **Step 4: Tag the scaffold completion**

```bash
git tag -a tauri-plan-1-done -m "Plan 1 (scaffolding) complete"
```

- [ ] **Step 5: Show summary**

```bash
git log --oneline electron-final..HEAD
```

Expected: ~15-20 commits documenting the rewrite scaffolding.

---

## Plan 1 Validation Checklist

Before declaring Plan 1 complete:

- [ ] `pnpm tauri dev` opens an MCP Router window
- [ ] Smoke-test UI renders ("Type a name and click Ping")
- [ ] Clicking Ping returns `Hello, <name>! (from Rust)`
- [ ] SQLite file created at platform-standard app data dir
- [ ] Tracing logs show pool init + AppState init
- [ ] `cd src-tauri && cargo test` passes 6 tests (error: 3, pool: 1, ping: 2)
- [ ] `src/types/generated/AppError.ts` exists and matches Rust enum
- [ ] No remaining `apps/`, `packages/`, `pnpm-workspace.yaml`, `turbo.json` references
- [ ] tag `tauri-plan-1-done` exists

---

## What Plan 2 Will Cover (preview, not part of this plan)

**Plan 2: Persistence Layer.** Full schema in `0002_*.sql` migrations covering servers, apps, settings, logs, projects, workflows, hooks, workspaces, tokens. All 9 repository traits + `Sqlite*Repository` implementations under `src-tauri/src/persistence/`. Per-repository unit tests against in-memory sqlite. ts-rs types for the domain models exported to `src/types/generated/`. Multi-workspace pool registry (`Arc<RwLock<HashMap<WorkspaceId, SqlitePool>>>`). No commands wired yet — that's Plan 3+.

---

## Notes for the Engineer Executing This Plan

- **Rust newcomer-friendly**: every Rust task has TDD steps with literal expected output. Trust the test-first flow.
- **Don't fix the dormant renderer code** in `src/components/`, `src/stores/`, etc. They're moved in but not yet wired — that's Plan 8. They will not compile if you `tsc` them; we deliberately don't run tsc as part of `pnpm tauri dev`.
- **Cross-platform paths**: commands use forward slashes; on Windows git-bash they work. If you switch to PowerShell mid-plan, mind backslashes.
- **Versions**: Cargo deps pin only major versions (`"2"`, `"0.8"`). If `cargo check` complains about a missing feature, bump to latest minor — note the version in your commit message.
- **If a test reports a different number of failures than the expected**: stop and read the error. Don't paper over with `#[ignore]`.
- **If `pnpm tauri dev` won't start**: check that WebView2 runtime exists (Win), Xcode Command Line Tools (mac), webkit2gtk (Linux). The Tauri docs `https://tauri.app/start/prerequisites/` covers this.
