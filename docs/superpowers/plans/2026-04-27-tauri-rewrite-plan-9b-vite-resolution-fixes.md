# MCP Router Tauri Rewrite — Plan 9b: Vite Resolution Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every module-resolution error blocking `pnpm tauri dev` from compiling the dormant renderer code. After Plan 9b: vite serves the legacy app shell (whether or not individual pages crash at runtime). Plan 9c handles per-page runtime errors.

**Architecture:** Six narrowly-scoped fixes:
1. Restore `src/types/index.ts` barrel (correct re-exports from each sibling file)
2. Create `src/components/ui/index.ts` barrel (re-export all 32 shadcn components)
3. Add `@/renderer/*` aliases in vite.config.ts + tsconfig.json mapping to flat `src/`
4. Install 8 missing npm packages
5. Fix 3 stranded `electron-platform-api` imports → use new `platform-api` index
6. Provide placeholder icon asset for `Sidebar.tsx` import

Single task; six steps.

**Tech Stack:** Adds 8 npm packages (react-router-dom, zustand, @tabler/icons-react, lucide-react, sonner, @xyflow/react, @uiw/react-codemirror, @codemirror/lang-javascript) — these were dependencies of the dormant Electron renderer that Plan 1 didn't carry over.

**Companion spec:** `docs/superpowers/specs/2026-04-27-mcp-router-tauri-rewrite-design.md` §11 step 9.

**Plan series:** Plan 9b of N. **Plan 9c**: page-by-page runtime fixes once vite compiles. **Plan 10**: tray/menu/deep-link/updater.

**Out of scope for Plan 9b:**
- Page-level runtime crashes (Plan 9c)
- New backend commands (Plan 9b is purely frontend-side)
- Replacing dormant renderer logic (only fix imports; logic stays as-is)

---

## File Structure (state at end of Plan 9b)

```
package.json                            # MODIFIED: +8 deps
src/
├── types/index.ts                      # REPLACED with proper barrel
├── components/
│   └── ui/index.ts                     # NEW barrel
├── stores/
│   ├── index.ts                        # MODIFIED (drop electron-platform-api ref)
│   └── project-store.ts                # MODIFIED (drop electron-platform-api ref)
├── components/setting/Settings.tsx     # MODIFIED (drop electron-platform-api ref)
tsconfig.json                           # MODIFIED: add @/renderer/* paths
vite.config.ts                          # MODIFIED: add @/renderer/* aliases
public/images/icon/icon.png             # NEW (placeholder)
```

---

## Tasks

### Task 1: Six fixes + smoke + tag

**Files:** see file structure above.

#### Step 1: Install 8 missing npm packages

```bash
cd C:/Projects/WebstormProjects/mcp-router
pnpm add react-router-dom zustand @tabler/icons-react lucide-react sonner @xyflow/react @uiw/react-codemirror @codemirror/lang-javascript
```

Expected: lockfile updates, ~30-60s install time. If any package version conflicts, accept whatever pnpm resolves.

#### Step 2: Replace src/types/index.ts with proper barrel

The file currently has a broken `export * from "./types"` (the directory doesn't exist). Replace with the same shape the original `packages/shared/src/types/index.ts` had:

```ts
// Re-export all domain types
export * from "./mcp-types";
export * from "./log-types";
export * from "./mcp-app-types";
export * from "./pagination";
export * from "./settings-types";
export * from "./token-types";
export * from "./workspace";
export * from "./project-types";
export * from "./tool-catalog-types";
export * from "./activity-types";

// Re-export organized domain types
export * from "./ui";
export * from "./database";

// Export platform-api types except LogEntry (avoids name conflict with log-types).
export type {
  Unsubscribe,
  ServerAPI,
  ServerStatus,
  CreateServerInput,
  AppAPI,
  PackageAPI,
  SettingsAPI,
  LogAPI,
  LogQueryOptions,
  LogQueryResult,
  ProjectsAPI,
  WorkflowAPI,
  PlatformAPI,
} from "./platform-api";
export type { LogEntry as PlatformLogEntry } from "./platform-api";

export * from "./mcp-apps";
export * from "./utils";
export * from "./workflow-types";
export * from "./shared-config";
```

If `cargo check` / `pnpm install` complain about a missing file (e.g., `./tool-catalog-types`), check `ls src/types/`. If the file is missing, drop that re-export line. The agent may also need to drop `./ui` or `./database` if the directory wasn't present after Plan 1's flatten.

#### Step 3: Create src/components/ui/index.ts barrel

The dir has 32 .tsx files (accordion, alert, alert-dialog, avatar, badge, breadcrumb, button, card, checkbox, collapsible, command, dialog, dropdown-menu, input, label, pagination, popover, progress, radio-group, resizable, scroll-area, select, separator, sheet, sidebar, skeleton, sonner, switch, table, tabs, textarea, tooltip). Create:

```ts
export * from "./accordion";
export * from "./alert";
export * from "./alert-dialog";
export * from "./avatar";
export * from "./badge";
export * from "./breadcrumb";
export * from "./button";
export * from "./card";
export * from "./checkbox";
export * from "./collapsible";
export * from "./command";
export * from "./dialog";
export * from "./dropdown-menu";
export * from "./input";
export * from "./label";
export * from "./pagination";
export * from "./popover";
export * from "./progress";
export * from "./radio-group";
export * from "./resizable";
export * from "./scroll-area";
export * from "./select";
export * from "./separator";
export * from "./sheet";
export * from "./sidebar";
export * from "./skeleton";
export * from "./sonner";
export * from "./switch";
export * from "./table";
export * from "./tabs";
export * from "./textarea";
export * from "./tooltip";
```

Verify by `ls src/components/ui/` — adjust the list if any file is missing.

#### Step 4: Add @/renderer/* aliases (tsconfig + vite)

The renderer code uses paths like `@/renderer/utils/tailwind-utils`, `@/renderer/components/...`, `@/renderer/stores`, `@/renderer/platform-api`. These were the old paths under `apps/electron/src/renderer/`. Map them to the new flat layout.

**Important**: `renderer/utils/*` maps to `src/lib/*` (Plan 1 renamed `utils` → `lib`).

**Open `tsconfig.json`** and update `paths`. Current paths from Plan 1 Task 8:
```json
"paths": {
  "@/*": ["src/*"],
  "@mcp_router/shared": ["src/types"],
  "@mcp_router/shared/*": ["src/types/*"],
  "@mcp_router/ui": ["src/components/ui"],
  "@mcp_router/ui/*": ["src/components/ui/*"]
}
```

**Append** these entries (order matters for resolution — most specific first):
```json
"@/renderer/utils/*": ["src/lib/*"],
"@/renderer/components/*": ["src/components/*"],
"@/renderer/components": ["src/components"],
"@/renderer/stores/*": ["src/stores/*"],
"@/renderer/stores": ["src/stores"],
"@/renderer/platform-api/*": ["src/platform-api/*"],
"@/renderer/platform-api": ["src/platform-api"],
"@/renderer/utils": ["src/lib"]
```

Final `paths` block should look like:
```json
"paths": {
  "@/*": ["src/*"],
  "@/renderer/utils/*": ["src/lib/*"],
  "@/renderer/utils": ["src/lib"],
  "@/renderer/components/*": ["src/components/*"],
  "@/renderer/components": ["src/components"],
  "@/renderer/stores/*": ["src/stores/*"],
  "@/renderer/stores": ["src/stores"],
  "@/renderer/platform-api/*": ["src/platform-api/*"],
  "@/renderer/platform-api": ["src/platform-api"],
  "@mcp_router/shared": ["src/types"],
  "@mcp_router/shared/*": ["src/types/*"],
  "@mcp_router/ui": ["src/components/ui"],
  "@mcp_router/ui/*": ["src/components/ui/*"]
}
```

**Open `vite.config.ts`** and mirror the aliases. Current aliases:
```ts
alias: {
  "@": path.resolve(__dirname, "src"),
  "@mcp_router/shared": path.resolve(__dirname, "src/types"),
  "@mcp_router/ui": path.resolve(__dirname, "src/components/ui"),
}
```

**Vite alias notes**: vite resolves longest-prefix-first AUTOMATICALLY only if you list literal aliases. For wildcard mapping like `@/renderer/utils/*` → `src/lib/*`, vite needs the literal prefix without `*` (vite handles the suffix). Use:

```ts
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
```

(The regex form lets vite handle both `@/renderer/utils` (no suffix) and `@/renderer/utils/foo` (with suffix). The `$1` in replacement captures the trailing `/...` or empty.)

**Note**: vite alias array order matters — most specific first.

#### Step 5: Fix 3 stranded electron-platform-api imports

Use Grep + Edit to fix each. Files identified by Plan 9a:
- `src/stores/index.ts`
- `src/stores/project-store.ts`
- `src/components/setting/Settings.tsx`

For each file: replace any `import { electronPlatformAPI } from "..../electron-platform-api"` (or `.platform-api/electron-platform-api"` etc.) with a clean import from the new tauri layer:

```ts
import { platformAPI } from "@/platform-api";
// or whatever the file used the old singleton as — `electronPlatformAPI` becomes `platformAPI`
```

Then rename usages in the file from `electronPlatformAPI` → `platformAPI` (or whatever the local binding was named).

For each file:
1. Read the full file with Grep `electron-platform-api` and surrounding context
2. Edit the import line + any references

Don't rewrite logic — just swap the dependency.

#### Step 6: Provide placeholder icon asset

`src/components/Sidebar.tsx` imports `../../../public/images/icon/icon.png` (per Plan 9a's report).

Verify what the dir contains:
```bash
ls C:/Projects/WebstormProjects/mcp-router/public/images/icon/ 2>/dev/null || echo "dir missing"
```

If `icon.png` is missing, copy a placeholder from src-tauri's icons:
```bash
mkdir -p C:/Projects/WebstormProjects/mcp-router/public/images/icon/
cp C:/Projects/WebstormProjects/mcp-router/src-tauri/icons/128x128.png \
   C:/Projects/WebstormProjects/mcp-router/public/images/icon/icon.png
```

If `src-tauri/icons/128x128.png` doesn't exist, use `icon.png` or any other PNG present.

#### Step 7: Smoke run

```bash
cd C:/Projects/WebstormProjects/mcp-router && pnpm tauri dev > /tmp/plan9b-smoke.log 2>&1 &
DEV_PID=$!

for i in $(seq 1 90); do
  sleep 5
  if grep -q "AppState initialized" /tmp/plan9b-smoke.log 2>/dev/null; then
    echo "BACKEND READY at ~$((i*5))s"
    # Wait a bit more for vite to fully process the entry
    sleep 15
    break
  fi
  if grep -q -E "panicked|could not compile" /tmp/plan9b-smoke.log 2>/dev/null; then
    echo "FAIL"
    break
  fi
done

echo "--- vite errors (if any) ---"
grep -iE "(failed to resolve|cannot resolve|failed to load|module not found|cannot find module|enoent.*\.(png|tsx?|svg|css))" /tmp/plan9b-smoke.log | head -30 || echo "(no module-resolution errors)"

echo "--- backend status ---"
grep -E "AppState initialized|MCP HTTP server" /tmp/plan9b-smoke.log

kill -9 $DEV_PID 2>/dev/null
sleep 3
ps -ef 2>/dev/null | grep -iE "tauri|cargo|mcp-router|vite" | grep -v grep | grep -v claude | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true
```

Expected: backend init line + NO module-resolution errors. Runtime errors in the page code (e.g., `TypeError: cannot read property X of undefined`) are NOT module-resolution errors and are OK for Plan 9b — Plan 9c will fix.

If module-resolution errors persist:
- They'll mention specific paths the agent missed
- Iterate by adding the right alias / barrel / dep / file

#### Step 8: Commit + tag

```bash
git add package.json pnpm-lock.yaml src/types/index.ts src/components/ui/index.ts tsconfig.json vite.config.ts src/stores/ src/components/setting/Settings.tsx public/
git commit -m "feat(frontend): vite 模块解析修复 (types/ui barrel + @/renderer 别名 + 8 个缺失依赖 + 3 处 electron-platform-api 残留)"
git tag -a tauri-plan-9b-done -m "Plan 9b (vite resolution fixes) complete: legacy renderer compiles in vite"
```

#### Step 9: Show summary

```bash
git log --oneline tauri-plan-9a-done..HEAD
```

Expected: ~2 commits since Plan 9a (1 plan doc + 1 fixes batch).

---

## Plan 9b Validation Checklist

- [ ] `pnpm install` clean
- [ ] `cargo test` reports 120 tests passing (no backend changes)
- [ ] `pnpm tauri dev` smoke shows `AppState initialized` AND no module-resolution errors in log
- [ ] tag `tauri-plan-9b-done` exists

---

## Manual smoke (REQUIRED, user-verified)

After agent reports DONE:
1. `pnpm tauri dev` — close any running Electron MCP Router first to free port 3282
2. Window opens, vite serves the bundle without "Failed to resolve" errors
3. The renderer attempts to mount — you should see the legacy UI shell (sidebar + initial route) OR a clear error from a runtime issue
4. Open DevTools and report any **runtime** errors (not module-resolution); these are Plan 9c fix candidates

---

## Notes for the Engineer Executing This Plan

- **The `@/renderer/utils/*` → `src/lib/*` mapping is the trickiest** — Plan 1 renamed the dir. Get this right or Sidebar/Home/etc. will fail to find tailwind-utils.
- **Vite alias order**: most-specific first. The bare `@` (without `/renderer/...`) must be LAST, otherwise `@/renderer/utils/foo` matches `@` first and lands at `src/renderer/utils/foo` (which doesn't exist).
- **If a re-export in `src/types/index.ts` references a missing file** (e.g., `./tool-catalog-types` doesn't exist), drop that line. We can add types back if a renderer page actually uses them.
- **Don't replace `import { Button } from "@mcp_router/ui"` with `from "@mcp_router/ui/button"`** in renderer files — the new barrel handles the bare import.
- **Stranded electron-platform-api fixes are mechanical** — if the file used `electronPlatformAPI.servers.list()`, change to `platformAPI.servers.list()`. The PlatformAPI shape is identical (Plan 9a's translation layer).
- **Page-level runtime errors are EXPECTED** post-Plan-9b — don't try to fix them. That's Plan 9c.
- **Don't add new backend commands** — Plan 9b is purely a vite resolution fix.
