# MCP Router Tauri Rewrite — Plan 9a: Frontend Bridge (Chinese-only, PlatformAPI translation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get the dormant React renderer mounting in the Tauri shell. Drop i18n multi-language machinery (force Chinese), write a `tauri-platform-api.ts` translation layer implementing the existing `PlatformAPI` interface via `invoke`, restore `_LegacyApp.tsx` as the entry. After Plan 9a: `pnpm tauri dev` opens the real app shell (sidebar + routes), and the pages whose backend commands exist (settings/projects/servers/workflows/hooks/logs) load. Pages without backend support (packages tab, updater UI) error out with clear messages — Plan 9b/c will stub.

**Architecture:** Translation layer at `src/platform-api/tauri-platform-api.ts` — implements every `PlatformAPI` method by calling `invoke("snake_case_name", args)` and reshaping response/args between the renderer's old TS types (`MCPServer`, `MCPTool`, `RequestLogEntry`, etc.) and our backend's Rust-side ts-rs-generated types (`Server`, `Project`, `RequestLog`, etc.). For methods with no backend equivalent (most of `packages.*` and `apps.*`), stub returns sensible empty values OR throw a clear "not implemented in Plan 9a" error.

i18n: keep `i18next` + `react-i18next` (renderer code calls `useTranslation`/`t()`), drop `i18next-browser-languagedetector`, delete `en.json`, force locale `zh`. Renderer unchanged at the call-site level.

**Tech Stack:** Adds `@tauri-apps/plugin-dialog` for `selectFile`. Drops `i18next-browser-languagedetector` from package.json.

**Companion spec:** `docs/superpowers/specs/2026-04-27-mcp-router-tauri-rewrite-design.md` §11 step 9.

**Plan series:** Plan 9a of N. **Plan 9b**: stub packages.* + apps.* + system.* (no-op or "暂未支持" UI banners). **Plan 9c**: page-by-page fixes for whatever crashes once UI loads. **Plan 10**: tray, menu, deep-link, updater, custom title bar.

**Out of scope for Plan 9a:**
- packages tab fully working (resolveVersions / checkUpdates / installManagers — Plan 9b stubs return safe defaults)
- system updater UI (no backend; stubs return "not available")
- "MCP Apps" feature (was a connection-slot abstraction in Electron; backend has no equivalent; stub apps.list → empty)
- Protocol-URL deep-link handling (Plan 10 adds tauri-plugin-deep-link)
- Per-page polish — only goal is "the app loads + you can navigate"
- Re-translating UI text from i18n keys to literal Chinese (we keep `t()` calls, just force locale)

---

## File Structure (state at end of Plan 9a)

```
package.json                            # MODIFIED: drop i18next-browser-languagedetector; add @tauri-apps/plugin-dialog
src/
├── App.tsx                             # REPLACED: import from components/App + provider wrappers
├── main.tsx                            # MODIFIED: i18n init no-detector, force "zh"
├── platform-api/
│   ├── tauri-platform-api.ts           # REPLACED: full PlatformAPI implementation via invoke
│   ├── electron-platform-api.ts        # DELETED
│   ├── platform-api-context.tsx        # unchanged
│   ├── index.ts                        # MODIFIED: export tauri impl
│   └── hooks/use-platform-api.ts       # unchanged
├── components/
│   ├── App.tsx                         # RESTORED from _LegacyApp.tsx (was renamed in Plan 1)
│   └── ... (other components dormant; will surface bugs at runtime)
├── utils/i18n.ts                       # MODIFIED: drop detector
└── locales/
    ├── en.json                         # DELETED
    └── zh.json                         # unchanged (sole locale)
src-tauri/
├── Cargo.toml                          # MODIFIED: add tauri-plugin-dialog
└── src/lib.rs                          # MODIFIED: register dialog plugin
```

No new tests — Plan 9a's verification is "app loads in dev mode without crashing immediately".

---

## PlatformAPI ↔ backend command mapping (the translation table)

Each row: PlatformAPI method → invoke("name") + reshape notes. Methods without a backend command get a stub.

### `servers.*`
| PlatformAPI | Backend | Notes |
|---|---|---|
| `list()` | `servers_list` | reshape `Server` → `MCPServer` (rename fields, add `status: 'stopped'` default) |
| `listTools(id)` | `servers_list_tools` | passes through Vec<Value> as `MCPTool[]` |
| `get(id)` | `servers_get` | same reshape as list |
| `create(input)` | `servers_create` | unwrap `input.config` → `NewServer` |
| `update(id, updates)` | `servers_update` | reshape `Partial<MCPServerConfig>` → `ServerPatch` |
| `updateToolPermissions(id, permissions)` | `servers_update` with `{toolPermissions: permissions}` | shorthand |
| `delete(id)` | `servers_delete` | returns void (drop bool) |
| `start(id)` | `servers_start` | returns true on Ok |
| `stop(id)` | `servers_stop` | passes through bool |
| `getStatus(id)` | `servers_get_status` | reshape `ServerStatus` enum (`{kind: "Running"}`) → `{type: "running"}` |
| `selectFile(options)` | tauri-plugin-dialog `open()` | call directly via `@tauri-apps/plugin-dialog` |

### `apps.*`
| PlatformAPI | Backend | Notes |
|---|---|---|
| `list()` | (none) | stub: `[]` |
| `create(appName)` | (none) | stub: throw "未实现" |
| `delete(appName)` | (none) | stub: false |
| `updateServerAccess(appName, access)` | (none) | stub: throw "未实现" |
| `tokens.list()` | `tokens_list` | reshape backend `Token` → renderer `Token` (rename `clientId`→`name`, drop `serverAccess`) |
| `tokens.generate(opts)` | `tokens_save` | generate id+timestamp client-side, return id as string |
| `tokens.revoke(id)` | `tokens_delete` | returns void |

### `packages.*` (mostly stubbed)
| PlatformAPI | Backend | Notes |
|---|---|---|
| `resolveVersions(...)` | (none) | stub: `{success: false, error: "未实现 (Plan 9b)"}` |
| `checkUpdates(...)` | (none) | stub: `{success: false, error: "未实现"}` |
| `checkManagers()` | (none) | stub: `{node: true, pnpm: false, uv: false}` (best guess) |
| `installManagers()` | (none) | stub: `{success: false, installed: {...}, errors: {}}` |
| `system.getPlatform()` | (none) | use navigator.platform or call `@tauri-apps/api/os` (defer to literal "win32" for now) |
| `system.checkCommand(cmd)` | (none) | stub: false |
| `system.restartApp()` | tauri-plugin-process / appWindow.close + relaunch | stub: false (Plan 10) |
| `system.checkForUpdates()` | (none) | stub: `{updateAvailable: false, status: "no-update", currentVersion: "1.1.0"}` |
| `system.installUpdate()` | (none) | stub: false |
| `system.onUpdateAvailable(cb)` | (none) | stub: returns unsubscribe noop |
| `system.onProtocolUrl(cb)` | (none) | stub: returns noop (Plan 10 wires deep-link) |

### `settings.*`
| PlatformAPI | Backend | Notes |
|---|---|---|
| `get()` | `settings_get` | direct passthrough (AppSettings shape matches Plan 4) |
| `save(settings)` | `settings_update` | returns true on Ok |
| `incrementOverlayCount()` | `settings_get` + `settings_update` | client-side increment of `packageManagerOverlayDisplayCount` |

### `logs.*`
| PlatformAPI | Backend | Notes |
|---|---|---|
| `query(opts)` | `logs_query` | reshape opts (cursor base64 → typed `RequestLogCursor`); reshape result `RequestLogPage` → `LogQueryResult` (compat field `logs:` aliased) |

### `workflows.workflows.*`
| PlatformAPI | Backend | Notes |
|---|---|---|
| `list()` | `workflows_list` | reshape `Workflow` → `WorkflowDefinition` (camelCase fields already match) |
| `get(id)` | `workflows_get` | same |
| `create(wf)` | `workflows_create` | reshape `Omit<WorkflowDefinition,...>` → `NewWorkflow` |
| `update(id, updates)` | `workflows_update` | reshape `Partial<...>` → `WorkflowPatch` |
| `delete(id)` | `workflows_delete` | returns true |
| `setActive(id)` | (none — but maps semantically to "ensure enabled") | implement as `update(id, {enabled: true})` |
| `disable(id)` | `workflows_update` with `{enabled: false}` | shorthand |
| `execute(id, ctx)` | `workflows_execute` | passes input → result |
| `listEnabled()` | `workflows_list_enabled` | direct |
| `listByType(t)` | `workflows_list_by_type` | direct |

### `workflows.hooks.*`
| PlatformAPI | Backend | Notes |
|---|---|---|
| `list()` | `hooks_list` | direct |
| `get(id)` | `hooks_get` | direct |
| `create(m)` | `hooks_create` | direct |
| `update(id, u)` | `hooks_update` | direct |
| `delete(id)` | `hooks_delete` | returns true |
| `execute(id, ctx)` | `hooks_run` | passes input → result |
| `import(m)` | `hooks_create` | alias |
| `validate(script)` | (none) | stub: try `new Function(script)` client-side, return `{valid: true}` if no parse error |

### `projects.*`
| PlatformAPI | Backend | Notes |
|---|---|---|
| `list()` | `projects_list` | direct (Project shape matches) |
| `create({name})` | `projects_create` | reshape to `NewProject` |
| `update(id, updates)` | `projects_update` | reshape to `ProjectPatch` |
| `delete(id)` | `projects_delete` | returns void (drop bool) |

---

## Plan 1-8c lessons learned (apply preemptively)

1. The renderer uses `@mcp_router/shared` import paths — Plan 1's tsconfig+vite aliases redirect to `src/types/`. Don't break aliases.
2. `_LegacyApp.tsx` was renamed from `App.tsx` in Plan 1 Task 11. Plan 9a renames it back.
3. ts-rs-generated TS types live in `src/types/generated/`. They use `bigint` for i64/u64 — Plan 9a's translation layer needs to JSON-stringify those for safe round-trip OR use Number where in safe range.
4. `tauri-plugin-shell` and `tauri-plugin-opener` are already initialized in lib.rs. Plan 9a adds `tauri-plugin-dialog`.

---

## Prerequisites

- [ ] Plan 8c complete (`tauri-plan-8c-done` tag exists)
- [ ] On branch `tauri-rewrite`, working tree clean
- [ ] `cargo test` reports 120 tests passing

---

## Tasks

### Task 1: i18n simplification — force Chinese

**Files:**
- Modify: `package.json` (drop `i18next-browser-languagedetector`)
- Modify: `src/utils/i18n.ts` (remove detector, hardcode `lng: "zh"`)
- Delete: `src/locales/en.json`

#### Step 1: Read current i18n.ts to understand current init

```bash
cat C:/Projects/WebstormProjects/mcp-router/src/utils/i18n.ts
```

(Inspect what it does — likely imports `i18next-browser-languagedetector` and chains `.use(LanguageDetector)`.)

#### Step 2: Replace src/utils/i18n.ts with this content

```ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import zh from "../locales/zh.json";

void i18n
  .use(initReactI18next)
  .init({
    resources: { zh: { translation: zh } },
    lng: "zh",
    fallbackLng: "zh",
    interpolation: { escapeValue: false },
  });

export default i18n;
```

(No detector. Single locale. Simpler init.)

#### Step 3: Delete src/locales/en.json

```bash
rm C:/Projects/WebstormProjects/mcp-router/src/locales/en.json
```

#### Step 4: Drop the detector from package.json

```bash
cd C:/Projects/WebstormProjects/mcp-router
pnpm remove i18next-browser-languagedetector
```

#### Step 5: Verify

```bash
pnpm install
```

Expected: lockfile updates, no errors.

(We do NOT run `pnpm dev` here — i18n only matters once the legacy App is mounted, which happens in Task 3.)

#### Step 6: Commit

```bash
git add package.json pnpm-lock.yaml src/utils/i18n.ts src/locales/en.json
git commit -m "chore(i18n): 删除多语言机制（去 detector + en.json，强制 zh）"
```

---

### Task 2: tauri-platform-api.ts — write the translation layer

**Files:**
- Replace: `src/platform-api/tauri-platform-api.ts` (currently a tiny ping wrapper from Plan 1)
- Delete: `src/platform-api/electron-platform-api.ts`
- Modify: `src/platform-api/index.ts` (export tauri impl as default)
- Add to package.json: `@tauri-apps/plugin-dialog`
- Add to Cargo.toml: `tauri-plugin-dialog`
- Modify: `src-tauri/src/lib.rs` (register dialog plugin)

#### Step 1: Add @tauri-apps/plugin-dialog

```bash
cd C:/Projects/WebstormProjects/mcp-router
pnpm add @tauri-apps/plugin-dialog
```

#### Step 2: Add tauri-plugin-dialog to Cargo.toml

In `src-tauri/Cargo.toml` `[dependencies]`:

```toml
tauri-plugin-dialog = "2"
```

#### Step 3: Register plugin in lib.rs

In `src-tauri/src/lib.rs`, find the plugin registration block:

```rust
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
```

Append:

```rust
        .plugin(tauri_plugin_dialog::init())
```

#### Step 4: Replace tauri-platform-api.ts

Delete `src/platform-api/electron-platform-api.ts` first:

```bash
rm C:/Projects/WebstormProjects/mcp-router/src/platform-api/electron-platform-api.ts
```

Then write `src/platform-api/tauri-platform-api.ts` as a complete `PlatformAPI` implementation. The file is ~400 lines. **Use the mapping table above as the spec.** Read each domain file under `src/types/platform-api/domains/` and implement each method.

Key patterns:

```ts
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import type { PlatformAPI } from "@mcp_router/shared";
// ... import all domain interfaces, MCPServer, MCPTool, etc.

// Reshape helpers — backend Server → renderer MCPServer
function backendServerToRenderer(s: BackendServer): MCPServer {
  return {
    id: s.id,
    name: s.name,
    serverType: s.server_type,
    // ... copy fields, default missing ones
    status: { type: "stopped" }, // status comes separately via getStatus
  };
}

function rendererStatusFromBackend(s: BackendServerStatus): ServerStatus {
  // backend: { kind: "Running" } | { kind: "Stopped" } | { kind: "Failed", message }
  switch (s.kind) {
    case "Stopped": return { type: "stopped" };
    case "Starting": return { type: "starting" };
    case "Running": return { type: "running" };
    case "Failed": return { type: "error", error: s.message };
  }
}

// ... etc for each entity
```

Then implement each domain:

```ts
class TauriPlatformAPI implements PlatformAPI {
  servers: ServerAPI = {
    list: async () => {
      const rows: BackendServer[] = await invoke("servers_list");
      return rows.map(backendServerToRenderer);
    },
    listTools: async (id) => {
      return invoke("servers_list_tools", { id });
    },
    // ... 9 more
    selectFile: async (options) => {
      try {
        const path = await openDialog({
          title: options?.title,
          directory: options?.mode === "directory",
          filters: options?.filters,
        });
        if (path === null) return { success: false, canceled: true };
        return { success: true, path: String(path) };
      } catch (e: any) {
        return { success: false, error: String(e) };
      }
    },
  };

  apps: AppAPI = {
    list: async () => [],
    create: async () => { throw new Error("apps.create 未实现 (Plan 9b)"); },
    delete: async () => false,
    updateServerAccess: async () => { throw new Error("apps.updateServerAccess 未实现"); },
    tokens: {
      list: async () => {
        const rows: BackendToken[] = await invoke("tokens_list");
        return rows.map((t) => ({
          id: t.id,
          name: t.clientId, // alias
          createdAt: new Date(Number(t.issuedAt)),
        }));
      },
      generate: async (opts) => {
        const id = crypto.randomUUID();
        await invoke("tokens_save", {
          token: {
            id,
            clientId: opts.name,
            issuedAt: Date.now(),
            serverAccess: {},
          },
        });
        return id;
      },
      revoke: async (tokenId) => {
        await invoke("tokens_delete", { id: tokenId });
      },
    },
  };

  packages: PackageAPI = {
    resolveVersions: async () => ({ success: false, error: "未实现 (Plan 9b)" }),
    checkUpdates: async () => ({ success: false, error: "未实现" }),
    checkManagers: async () => ({ node: true, pnpm: false, uv: false }),
    installManagers: async () => ({ success: false, installed: { node: false, pnpm: false, uv: false }, errors: {} }),
    system: {
      getPlatform: async () => "win32" as const,
      checkCommand: async () => false,
      restartApp: async () => false,
      checkForUpdates: async () => ({
        updateAvailable: false,
        status: "no-update" as const,
        currentVersion: "1.1.0",
      }),
      installUpdate: async () => false,
      onUpdateAvailable: () => () => {},
      onProtocolUrl: () => () => {},
    },
  };

  settings: SettingsAPI = {
    get: async () => invoke<AppSettings>("settings_get"),
    save: async (settings) => {
      await invoke("settings_update", { settings });
      return true;
    },
    incrementOverlayCount: async () => {
      const current = await invoke<AppSettings>("settings_get");
      const newCount = (current.packageManagerOverlayDisplayCount ?? 0) + 1;
      await invoke("settings_update", {
        settings: { ...current, packageManagerOverlayDisplayCount: newCount },
      });
      return { success: true, count: newCount };
    },
  };

  logs: LogAPI = {
    query: async (opts) => {
      // Translate cursor: PlatformAPI uses opaque base64 string; backend uses {timestamp, id} struct.
      let before: { timestamp: string; id: string } | undefined;
      if (opts?.cursor) {
        try {
          const decoded = JSON.parse(atob(opts.cursor));
          before = { timestamp: decoded.timestamp, id: decoded.id };
        } catch { /* ignore malformed */ }
      }
      const page = await invoke<BackendRequestLogPage>("logs_query", {
        query: {
          before,
          limit: opts?.limit ?? 50,
          serverId: opts?.serverId,
          clientId: opts?.clientId,
          requestType: opts?.requestType,
          responseStatus: opts?.responseStatus,
        },
      });
      return {
        items: page.items, // shape compat — RequestLog matches RequestLogEntry close enough
        logs: page.items, // back-compat alias
        hasMore: page.has_more,
        cursor: page.next_cursor
          ? btoa(JSON.stringify(page.next_cursor))
          : undefined,
      };
    },
  };

  workflows: WorkflowAPI = {
    workflows: {
      list: () => invoke("workflows_list"),
      get: (id) => invoke("workflows_get", { id }),
      create: (wf) => invoke("workflows_create", { input: wf }),
      update: (id, updates) => invoke("workflows_update", { id, patch: updates }),
      delete: async (id) => {
        const ok = await invoke<boolean>("workflows_delete", { id });
        return ok;
      },
      setActive: async (id) => {
        await invoke("workflows_update", { id, patch: { enabled: true } });
        return true;
      },
      disable: async (id) => {
        await invoke("workflows_update", { id, patch: { enabled: false } });
        return true;
      },
      execute: (id, context) => invoke("workflows_execute", { id, input: context ?? null }),
      listEnabled: () => invoke("workflows_list_enabled"),
      listByType: (workflowType) => invoke("workflows_list_by_type", { workflowType }),
    },
    hooks: {
      list: () => invoke("hooks_list"),
      get: (id) => invoke("hooks_get", { id }),
      create: (m) => invoke("hooks_create", { input: m }),
      update: (id, updates) => invoke("hooks_update", { id, patch: updates }),
      delete: async (id) => {
        const ok = await invoke<boolean>("hooks_delete", { id });
        return ok;
      },
      execute: (id, context) => invoke("hooks_run", { id, input: context ?? null }),
      import: (m) => invoke("hooks_create", { input: m }),
      validate: async (script) => {
        try {
          // eslint-disable-next-line no-new-func
          new Function(script);
          return { valid: true };
        } catch (e: any) {
          return { valid: false, error: String(e?.message ?? e) };
        }
      },
    },
  };

  projects: ProjectsAPI = {
    list: () => invoke("projects_list"),
    create: ({ name }) => invoke("projects_create", { input: { name } }),
    update: (id, updates) => invoke("projects_update", { id, patch: updates }),
    delete: async (id) => {
      await invoke("projects_delete", { id });
    },
  };
}

export const tauriPlatformAPI = new TauriPlatformAPI();

// Keep the simple `ping` wrapper from Plan 1 for the smoke screen (App.tsx may still reference it during dev)
export async function ping(name: string): Promise<string> {
  return invoke<string>("ping", { name });
}
```

> Notes:
> - The agent MUST read each domain interface file under `src/types/platform-api/domains/` to verify exact method signatures match. Adjust names/types to whatever the interface declares.
> - The shape of `MCPServer` (renderer) vs `Server` (backend) is mostly the same fields with snake_case ↔ camelCase. Use a per-domain reshape helper.
> - For methods returning `Promise<MCPServer>` after `update`, do `update` then `get` to return the fresh row (or just trust the return shape from backend command).
> - `crypto.randomUUID()` works in modern browsers; webview supports it.
> - Backend's `Token.issuedAt` is `bigint` (i64) per ts-rs. Convert via `Number(t.issuedAt)` — safe for unix-ms timestamps within next 285,000 years.

#### Step 5: Update src/platform-api/index.ts

Read the current file first to understand the export style. Replace exports to point at `tauriPlatformAPI`:

```ts
export { tauriPlatformAPI as platformAPI } from "./tauri-platform-api";
export { PlatformAPIProvider, usePlatformAPI } from "./platform-api-context";
```

(If the existing index.ts re-exports the electron-platform-api singleton, swap to tauri.)

#### Step 6: cargo build (verify dialog plugin compiles)

```bash
cd src-tauri
cargo check
cd ..
```

Expected: clean.

#### Step 7: Commit

```bash
git add package.json pnpm-lock.yaml src/platform-api src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs
git commit -m "feat(frontend): tauri-platform-api 翻译层 (PlatformAPI 实装；apps/packages 暂存根)"
```

---

### Task 3: Restore legacy App.tsx + smoke

**Files:**
- Modify: `src/components/_LegacyApp.tsx` → rename back to `App.tsx`
- Replace: `src/App.tsx` (root) — wrap legacy with PlatformAPIProvider
- Verify: `src/main.tsx` — import root App correctly

#### Step 1: Rename _LegacyApp.tsx back

```bash
cd C:/Projects/WebstormProjects/mcp-router
git mv src/components/_LegacyApp.tsx src/components/App.tsx
```

#### Step 2: Read the restored components/App.tsx to understand its provider needs

```bash
cat src/components/App.tsx | head -60
```

(Look for what it expects — likely `react-router-dom`, possibly `BrowserRouter`, plus expects `PlatformAPIProvider` to wrap.)

#### Step 3: Replace src/App.tsx (root) with provider wrapping

```tsx
import "./utils/i18n"; // initialize i18n early
import LegacyApp from "./components/App";
import { PlatformAPIProvider } from "./platform-api/platform-api-context";
import { platformAPI } from "./platform-api";

export default function App() {
  return (
    <PlatformAPIProvider api={platformAPI}>
      <LegacyApp />
    </PlatformAPIProvider>
  );
}
```

> Note: The `PlatformAPIProvider`'s prop name (`api`, `value`, `platformAPI`, etc.) depends on `src/platform-api/platform-api-context.tsx`'s implementation — read it first and match. If the provider takes no props (uses module-level singleton), drop the prop.

#### Step 4: Verify src/main.tsx imports root App

```bash
cat src/main.tsx
```

It should already do `import App from "./App"` from Plan 1. No change needed.

#### Step 5: Run pnpm tauri dev — first visual smoke

```bash
cd C:/Projects/WebstormProjects/mcp-router && pnpm tauri dev > /tmp/plan9a-smoke.log 2>&1 &
DEV_PID=$!
echo "PID=$DEV_PID"

for i in $(seq 1 90); do
  sleep 5
  if grep -q "AppState initialized" /tmp/plan9a-smoke.log 2>/dev/null; then
    echo "BACKEND READY at ~$((i*5))s"
    break
  fi
  if grep -q -E "panicked|could not compile" /tmp/plan9a-smoke.log 2>/dev/null; then
    echo "FAIL"
    break
  fi
done

# Look for vite frontend errors after backend ready
sleep 10
echo "--- vite errors (if any) ---"
grep -E "error|Error|Cannot" /tmp/plan9a-smoke.log | head -30 || echo "(no obvious frontend errors logged to backend stdout)"

kill -9 $DEV_PID 2>/dev/null
sleep 3
ps -ef 2>/dev/null | grep -iE "tauri|cargo|mcp-router|vite" | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true
```

This is a **best-effort headless smoke**. The agent can't visually verify the UI rendered. Look for:
- backend logs `AppState initialized` ✓
- no vite compile errors in stdout
- no `panicked` from Rust
- (page-level runtime errors are in browser DevTools, not stdout — user verifies manually)

#### Step 6: Commit + tag

```bash
git add src/components/App.tsx src/App.tsx
git commit -m "feat(frontend): 启用 legacy App + 包 PlatformAPIProvider；hello/ping 烟测壳退役"
git tag -a tauri-plan-9a-done -m "Plan 9a (frontend bridge: i18n simplify + platform-api translation + restore App) complete"
```

#### Step 7: Show summary

```bash
git log --oneline tauri-plan-8c-done..HEAD
```

Expected: ~4 commits since Plan 8c (1 plan doc + 1 i18n + 1 platform-api + 1 App restore).

---

## Plan 9a Validation Checklist

- [ ] `cargo build` clean
- [ ] `cargo test` reports 120 tests passing (no backend changes broke tests)
- [ ] `pnpm tauri dev` starts; backend logs `AppState initialized`
- [ ] No vite compile errors in stdout during dev startup
- [ ] tag `tauri-plan-9a-done` exists
- [ ] (Manual, user-verified post-Plan-9a) the app window shows the legacy UI shell, not the hello/ping smoke

---

## Manual smoke (REQUIRED, user-verified post-Plan-9a)

After agent reports DONE:
1. `pnpm tauri dev` (close any running Electron MCP Router first to free 3282)
2. App opens → expect to see the **real** UI (sidebar, server list, settings, etc.) — not the "MCP Router (Tauri Skeleton)" with the Ping button
3. Open DevTools (Ctrl+Shift+I): note any console errors. These are Plan 9c fix candidates.
4. Try clicking around:
   - Settings page should load (loads via `settings.get()`)
   - Servers tab should show empty list (no servers configured) without crashing
   - Workflows / Hooks pages similarly
   - Packages tab will probably error (most methods stubbed)
5. Report which pages crash for Plan 9c targeted fixes

---

## Notes for the Engineer Executing This Plan

- **Read every domain interface file** under `src/types/platform-api/domains/` before writing the matching method in `tauri-platform-api.ts`. Field names and return types must match the renderer's expectations.
- **The mapping table above is a SPEC, not source code**. Adjust to actual interface signatures. If a return type doesn't quite fit, add a small reshape function.
- **`bigint` from ts-rs**: backend's `i64` (Token.issuedAt) and `u64` (settings.maxRequestLogRows) come back as `bigint`. Convert with `Number(x)` for timestamps in safe-integer range. For larger values, keep as bigint and let renderer handle.
- **Don't try to fix individual page-level bugs** in Plan 9a — just get the shell loading. Plan 9c is the page-by-page debugging plan.
- **`PlatformAPIProvider`'s exact prop shape** depends on the provider file — read it before writing the wrapper.
- **If an electron-specific window.electronAPI reference still exists in the renderer code**, defer the fix to Plan 9c. Plan 9a only fixes the shell mount.
- **Don't add new ts-rs types** — Plan 9a is purely frontend.
- **Don't touch src-tauri tests** — Plan 9a is purely frontend except for the dialog plugin registration.
