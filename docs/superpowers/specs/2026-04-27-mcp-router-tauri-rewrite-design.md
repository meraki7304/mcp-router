# MCP Router Tauri 重写 — 设计文档

- 创建日期：2026-04-27
- 状态：草稿（待用户审阅）
- 作者：王权 + Claude（brainstorming）

## 1. 背景与目标

### 1.1 当前状态
- `apps/electron`：Electron 41 + electron-vite + electron-builder
- 渲染层：React 19 + react-router 7 + zustand + xyflow + CodeMirror + i18next + shadcn UI
- 主进程：54 个 .ts 文件，含 IPC、better-sqlite3、Express HTTP server (:3282)、`@modelcontextprotocol/sdk` (client+server)、子进程编排、workflow executor、tray/menu/auto-update/protocol handler
- 已有 monorepo：`packages/{shared, ui, tailwind-config}`

### 1.2 重构动机
**核心痛点：包体积与资源占用**
- Electron 当前安装包 ~100MB+、运行时常驻 ~200-400MB
- 目标：安装包 ≤ 30MB、运行时常驻 ≤ 100MB

### 1.3 非目标
- **不**保留与现有 Electron 版本的双栈并行（"一锔到底，老版不管"）
- **不**做用户数据迁移（暂无线上用户）
- **不**为未来抽象做过度设计；只在真有可能换实现的边界上 trait

### 1.4 决策摘要
| 维度 | 决定 | 备选 / 备注 |
|---|---|---|
| 技术栈 | Tauri 2 + React + Rust | 否决纯 Rust UI（重写成本太高）和 sidecar Node（瘦身效果差） |
| MCP SDK | `rmcp`（Rust 官方） | 否决 sidecar Node SDK |
| 项目布局 | 扁平化，沿用 Tauri CLI 模板 | 否决 monorepo |
| 实施路径 | 自顶向下，先铺基础设施再接业务 | 否决端到端切片 / sidecar 渐进 |
| 数据 | 全新设计，不做迁移 | 暂无用户 |
| 发版 | 主分支重构，老版冻结 | — |

---

## 2. 顶层架构

### 2.1 进程模型
- **单进程 Tauri**：Rust 主进程承担原 Electron `main` + `preload` 全部职责
- 前端跑在系统 WebView：Windows 用 WebView2，macOS 用 WKWebView，Linux 用 WebKitGTK
- MCP server 子进程仍由 Rust 主进程通过 `tokio::process` spawn
- 对外 :3282 HTTP 由 Rust 内的 `axum` 提供，**不**另起进程

### 2.2 目录布局（扁平化）
```
mcp-router/
├── src/                          # 前端 React
│   ├── components/
│   │   ├── ui/                   # shadcn 33 个组件（原 packages/ui）
│   │   ├── App.tsx, Home.tsx, Sidebar.tsx, TitleBar.tsx
│   │   ├── common/ layout/ mcp/ setting/ workflow/
│   ├── stores/                   # zustand
│   ├── platform-api/             # invoke 包装层
│   ├── types/                    # 原 packages/shared/src/types（部分由 ts-rs 自动生成）
│   ├── lib/utils.ts              # cn() 等
│   ├── locales/
│   └── main.tsx
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── migrations/               # sqlx migrations
│   │   └── 0001_init.sql
│   ├── .sqlx/                    # sqlx prepare 产物（提交到 git）
│   └── src/
│       ├── main.rs               # 入口
│       ├── lib.rs                # tauri::Builder 装配
│       ├── error.rs              # AppError 定义
│       ├── state.rs              # AppState（全局共享句柄）
│       ├── commands/             # #[tauri::command] handlers，按域拆文件
│       │   ├── mod.rs
│       │   ├── server.rs
│       │   ├── log.rs
│       │   ├── settings.rs
│       │   ├── apps.rs
│       │   ├── system.rs
│       │   ├── package.rs
│       │   ├── workflow.rs
│       │   ├── hook.rs
│       │   └── projects.rs
│       ├── persistence/          # sqlx + repositories
│       │   ├── mod.rs
│       │   ├── pool.rs
│       │   └── {server,log,settings,apps,workflow,hook,projects,workspace}_repository.rs
│       ├── mcp/                  # rmcp 客户端 + 子进程编排
│       │   ├── mod.rs
│       │   ├── server_manager.rs
│       │   ├── aggregator.rs
│       │   ├── tool_catalog.rs
│       │   └── transport.rs
│       ├── http/                 # axum :3282
│       │   ├── mod.rs
│       │   ├── auth.rs
│       │   └── routes.rs
│       ├── workflow/             # workflow executor
│       │   ├── mod.rs
│       │   ├── executor.rs
│       │   └── hook_runtime.rs   # rquickjs JS 执行
│       ├── platform/             # 平台粘合
│       │   ├── mod.rs
│       │   ├── tray.rs
│       │   ├── menu.rs
│       │   ├── deep_link.rs
│       │   └── single_instance.rs
│       └── types/                # 与前端共享的 serde + ts-rs 类型
├── public/
├── package.json                  # 唯一一个
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
├── vite.config.ts
├── components.json               # shadcn config
└── .gitignore
```

### 2.3 Workspace / monorepo 取舍
- 删除 `apps/`、`packages/`、`pnpm-workspace.yaml`、`turbo.json`、`knip.json`
- `packages/shared/types` 内容内联到 `src/types/`
- `packages/ui` 33 个 shadcn 组件直接搬到 `src/components/ui/`
- `packages/tailwind-config` 配置合并到根 `tailwind.config.js`

---

## 3. 模块边界与可替换性

**原则：只在真正可能换实现的地方上 trait。**

| 模块 | trait 边界 | 实现 | 理由 |
|---|---|---|---|
| 数据库 repository | ✅ | `sqlx` + sqlite | 未来若想换 store 不动业务 |
| 子进程管理 | ✅ | `tokio::process` | 单测 mock |
| MCP client/server | ❌ | `rmcp` 直接用 | rmcp 自身已是抽象 |
| HTTP server | ❌ | `axum` 直接用 | 路由层薄 |
| Updater | ❌ | `tauri-plugin-updater` | 无需自封 |
| 日志/追踪 | ❌ | `tracing` | 标准做法 |

### 3.1 核心库选型
| 用途 | crate |
|---|---|
| 异步运行时 | `tokio` (full features) |
| 错误（库） | `thiserror` |
| 错误（应用边界） | `anyhow` |
| 序列化 | `serde` + `serde_json` |
| 类型同步前端 | `ts-rs` |
| 日志/追踪 | `tracing` + `tracing-subscriber` |
| ID | `uuid` v1 |
| 时间 | `chrono` |
| 数据库 | `sqlx` (sqlite, runtime-tokio) |
| HTTP server | `axum` + `tower-http` (cors) |
| MCP | `rmcp` |
| JS 执行（hook） | `rquickjs`（待最终决定，见 §10） |
| Tauri | `tauri 2.x` |
| Tauri 插件 | `tauri-plugin-updater`、`tauri-plugin-single-instance`、`tauri-plugin-deep-link`、`tauri-plugin-shell`、`tauri-plugin-os`、`tauri-plugin-dialog` |

### 3.2 前端最小改动
唯一硬改动：`platform-api/electron-platform-api.ts` → 重命名 `tauri-platform-api.ts`，内部 `window.ipcRenderer.invoke(channel, args)` → `import { invoke } from '@tauri-apps/api/core'; invoke(camelCaseToSnakeCase(channel), args)`。

事件订阅 `window.ipcRenderer.on(channel, cb)` → `import { listen } from '@tauri-apps/api/event'; listen(channel, cb)`。

其它 React 代码（stores、xyflow、CodeMirror、shadcn）零改动。

### 3.3 类型同步
Rust 一侧用 `ts-rs`：
```rust
#[derive(Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/types/generated/")]
pub struct McpServer { /* ... */ }
```
构建时跑 `cargo test --features ts-rs/export` 触发生成；CI 检查生成的 `.d.ts` 与 git 一致。

---

## 4. Tauri 壳层与平台粘合

| 现 Electron 能力 | Tauri 实现 |
|---|---|
| `app.requestSingleInstanceLock()` + `second-instance` 事件 | `tauri-plugin-single-instance` |
| `setApplicationMenu()` | `tauri::menu::Menu`（Rust 端） |
| `createTray()` + 5s 轮询刷新 context menu | `tauri::tray::TrayIconBuilder` + `tokio::time::interval` |
| `nativeTheme` + Win `titleBarOverlay` | Tauri 2 自定义标题栏：Win `decorations: false` + 前端绘 + `data-tauri-drag-region`；macOS `titleBarStyle: "Overlay"` |
| `electron-updater` + 静默跳过未签名/dev | `tauri-plugin-updater`，`updater.json` 走 GitHub Releases；dev profile 跳过 |
| `setAsDefaultProtocolClient("mcpr")` + `open-url` | `tauri-plugin-deep-link` |
| `app.dock.show/hide`（macOS） | `tauri::App::set_activation_policy(ActivationPolicy::{Accessory,Regular})` |
| 默认隐藏 vs 轻量模式销毁 | 默认 `WebviewWindow::hide()`；轻量 `close()` + 下次 `WebviewWindowBuilder::new()` 重建 |
| dev DevTools | `WebviewWindow::open_devtools()` 仅 dev profile |
| CSP `onHeadersReceived` 注入 | `tauri.conf.json` 的 `security.csp` 字段 |
| 窗口外链 `setWindowOpenHandler` → shell.openExternal | `tauri-plugin-shell` 的 `open()` |

### 4.1 标题栏细节
- **Windows**：`decorations: false`，前端 `TitleBar.tsx` 自绘高度 50；最小化/最大化/关闭按钮调 `getCurrentWindow().{minimize, toggleMaximize, close}()`；可拖拽区用 `data-tauri-drag-region`
- **macOS**：`titleBarStyle: "Overlay"`，原生交通灯保留；前端在 `App.tsx` 顶部留 80px 空间避开
- **Linux**：默认 `decorations: true`，不自定义

### 4.2 主题跟随系统
监听 `tauri::Window::on_window_event` 的 `ThemeChanged`，再通过 `emit("theme-changed", theme)` 通知前端；前端 `theme-store.ts` 已经在响应主题事件，改 channel 名即可。

---

## 5. 持久化层

### 5.1 选型
- **驱动**：`sqlx` + `sqlite` + `runtime-tokio-rustls`
- **不用** `rusqlite`：理由是 sqlx 自带 migration、编译期 SQL 校验（`sqlx::query!` 宏）、与 axum/tokio 一栈到底
- **Offline 模式**：用 `cargo sqlx prepare` 把 query 元数据生成 `.sqlx/` 目录并提交 git，CI/构建机不用连库

### 5.2 数据库文件位置
通过 `tauri::path::PathResolver::app_data_dir()` 取平台标准目录，等价于现 `app.getPath('userData')`：
- macOS: `~/Library/Application Support/com.mcp-router/`
- Windows: `%APPDATA%\mcp-router\`
- Linux: `~/.local/share/mcp-router/`

### 5.3 Repository 模式
所有业务模块统一套路：
```rust
#[async_trait]
pub trait ServerRepository: Send + Sync {
    async fn list(&self) -> Result<Vec<McpServer>>;
    async fn get(&self, id: &str) -> Result<Option<McpServer>>;
    async fn upsert(&self, server: &McpServer) -> Result<()>;
    async fn delete(&self, id: &str) -> Result<()>;
}

pub struct SqliteServerRepository { pool: SqlitePool }

#[async_trait]
impl ServerRepository for SqliteServerRepository { /* ... */ }
```
业务侧只依赖 `Arc<dyn ServerRepository>`；`lib.rs` 启动时注入 sqlite 实现。

### 5.4 多工作区数据库
现有 `workspace.service.ts` + `platform-api-manager.ts` 实现"切 workspace = 切 DB pool"。Rust 端复用：`AppState` 持 `Arc<RwLock<HashMap<WorkspaceId, SqlitePool>>>`，切换时关旧 pool、开新 pool（含跑迁移）。

### 5.5 Schema 重设计
借机收敛规范（具体字段在实施 plan 阶段细化）：
- 时间戳统一 `TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`
- bool 统一 `INTEGER NOT NULL CHECK (col IN (0,1))`
- JSON 字段命名 `*_json TEXT`，schema 注释里写明形状
- 主键统一 `id TEXT PRIMARY KEY`（uuid v7 字符串）
- 外键全开 `FOREIGN KEY ... ON DELETE CASCADE`，启动时 `PRAGMA foreign_keys = ON`

---

## 6. MCP 模块（rmcp）

### 6.1 客户端：连 MCP server
- 用 `rmcp::service::ServiceExt` + `rmcp::transport::*`
- 三种 transport 对应：
  - **stdio**：`rmcp::transport::child_process::TokioChildProcess` + `tokio::process::Command`
  - **SSE**：`rmcp::transport::sse_client::SseClientTransport`
  - **streamable HTTP**：`rmcp::transport::streamable_http_client::StreamableHttpClientTransport`

### 6.2 ServerManager
等价于现 `MCPServerManager`（`apps/electron/src/main/modules/mcp-server-manager/mcp-server-manager.ts`）。Rust 端：
```rust
pub struct ServerManager {
    repository: Arc<dyn ServerRepository>,
    log_service: Arc<LogService>,
    clients: Arc<RwLock<HashMap<ServerId, RmcpClient>>>,
    last_used_at: Arc<RwLock<HashMap<ServerId, Instant>>>,
    idle_stop_minutes: AtomicU64,
    event_tx: broadcast::Sender<ServerEvent>,  // 替代 Node EventEmitter
}
```
- `start(id)` / `stop(id)` / `restart(id)`：管理 client 与子进程生命周期
- 启动时根据 server 配置的 `auto_start` 自动拉起
- 闲置自动停止：`tokio::spawn` 一个每分钟跑一次的任务，扫描 `last_used_at`，超时未活动的 stdio server 自动 stop

### 6.3 AggregatorServer
对外（聚合多个 client 的能力）作为一个 MCP server，实现 `rmcp::service::Service` trait。把所有 client 的 tools/resources/prompts 收集起来，按 client 名作前缀路由。

### 6.4 ToolCatalog（BM25 搜索）
现 `bm25-search-provider.ts` 用纯 TS 实现 BM25。Rust 端：
- 候选 crate：`tantivy`（重）/ `bm25`（轻）/ 自实现（与现版对齐最容易）
- **决定**：自实现 BM25，~150 行 Rust，与现 TS 算法对齐；未来需要全文索引再换 tantivy

---

## 7. HTTP 模块（axum）

### 7.1 路由
对应现 `mcp-http-server.ts`，在 :3282 暴露 streamable HTTP：
```rust
Router::new()
    .route("/mcp", post(mcp_request_handler).get(mcp_sse_handler))
    .layer(CorsLayer::permissive())
    .layer(middleware::from_fn(auth))
    .layer(TraceLayer::new_for_http())
    .with_state(app_state)
```

### 7.2 鉴权
对应现 `TokenValidator`：
- 中间件读 `Authorization: Bearer <token>` 与 `mcp-router-project-id` header
- token → server 映射查 `apps_repository`
- project header 命中 `projects_repository`（兼容 `UNASSIGNED_PROJECT_ID`）

### 7.3 与 ServerManager 共享状态
`AppState { server_manager: Arc<ServerManager>, aggregator: Arc<AggregatorServer>, ... }` 同时被 axum router 和 tauri command 持有。

---

## 8. Workflow 模块

### 8.1 节点类型
保持与前端一致（`renderer/components/workflow/nodes/*`）：
- `StartNode`、`EndNode`、`HookNode`、`MCPCallNode`

### 8.2 Executor
状态机驱动，按节点拓扑顺序执行：
```rust
pub enum NodeOutcome {
    Continue(serde_json::Value),
    Branch(String, serde_json::Value),
    Terminate,
}

pub trait NodeRunner: Send + Sync {
    async fn run(&self, ctx: &ExecutionContext, input: Value) -> Result<NodeOutcome>;
}
```

### 8.3 Hook JS 运行时（**风险点，见 §10**）
现 hook 是用户写的 JS，TS 端直接 eval。Rust 没有原生 JS 引擎，候选：
- `rquickjs`（QuickJS 绑定，~600KB，主流，**默认采用**）
- `boa`（纯 Rust，慢）
- 改 `Rhai`（破坏现有 hook 用法，否决）

设计假设 rquickjs；若实际跑分 / API 兼容性不达标，单独做 spike。

### 8.4 与 MCP 调用集成
`MCPCallNode` 的 runner 持 `Arc<ServerManager>`，调用 `server_manager.call_tool(server_id, tool_name, args)`。

---

## 9. Tauri Commands 与前端 IPC 契约

### 9.1 命名规约
现 IPC channel 命名为 `domain:action`（如 `mcp:listServers`），Tauri command 函数名用 snake_case：
- `mcp:listServers` → `mcp_list_servers`
- `settings:get` → `settings_get`

前端 `platform-api` 包装层做 channel 名映射，业务代码不变。

### 9.2 命令签名
```rust
#[tauri::command]
pub async fn mcp_list_servers(
    state: State<'_, AppState>,
) -> Result<Vec<McpServer>, AppError> {
    state.server_manager.list().await
}
```

### 9.3 错误模型
```rust
#[derive(thiserror::Error, Debug, Serialize, TS)]
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
```
前端 `error-utils.ts` 已处理结构化错误，对接此 enum 即可。

### 9.4 事件
- 主进程 → 前端：`app_handle.emit("event-name", payload)`
- 前端订阅：`listen("event-name", cb)`
- 替换现有 `mainWindow.webContents.send("protocol:url", url)` 等

### 9.5 IPC 域清单（与现一致）
`server` / `log` / `settings` / `apps` / `system` / `package` / `workflow` / `hook` / `projects`，每域一个 `commands/*.rs`。

---

## 10. 风险与未决项

| # | 风险/未决 | 影响 | 应对 |
|---|---|---|---|
| 1 | `rmcp` 成熟度：streamable HTTP transport / 鉴权扩展 / 错误模型可能不完整 | MCP 服务端实现可能要补 / fork rmcp | 启动后第一周做 spike，跑通最简 stdio + http 双通道；不通过则评估贡献上游或局部 fork |
| 2 | Hook JS 运行时：`rquickjs` 与现 TS eval 的 API 表面差异（如 `console`、`fetch`、Promise） | 用户已有 hook 可能不直接兼容 | 准备 hook 兼容层（在 JS 全局暴露 `console.log`/`fetch` 假实现）；最坏情况限制 hook API 形状 |
| 3 | Tauri 2 自定义标题栏的 Win/macOS 行为差异（最大化按钮、双击标题栏、resize 边缘） | 标题栏体验不如 Electron 自然 | 接受少量打磨，必要时调研社区方案（如 `@tauri-apps/api/window` 的 `setTitleBarStyle`） |
| 4 | `tauri-plugin-deep-link` 在 macOS 的 `open-url` 时机（启动前 vs 启动后）与 Electron 略有不同 | 协议唤起冷启动场景需测试 | 实施 plan 中专项验证，准备好启动队列把早到的 url 排队等 webview ready |
| 5 | `sqlx` offline mode 维护：每次 schema 改动都要重跑 `cargo sqlx prepare` 并提交 `.sqlx/` | 团队习惯 | 在仓库 README 写明 + 加 pre-commit hook（可选） |
| 6 | `ts-rs` 与 `serde` flatten/tag/rename_all 的兼容性边界 | 复杂类型可能要手工调 | 先全用简单 struct，遇到再处理 |
| 7 | `tauri-plugin-updater` 的 `latest.json` 格式与现 electron-updater 不同 | 老 update server 要换 | 主分支重构，无历史包袱 |
| 8 | `tauri-plugin-updater` 默认强制对 `latest.json` 做 minisign 签名校验，与"mac dmg 不强制 codesign"策略不冲突但仍需配 minisign 公私钥 | 更新流程要生成 minisign 密钥对、私钥进 CI secrets、公钥写 `tauri.conf.json` | plan 阶段加一步密钥生成与文档化 |
| 9 | Rust 新手的学习曲线：lifetime、async trait、Send + Sync 边界 | 实施周期不可预测 | plan 阶段任务粒度按"半天-一天"拆，多给参考代码片段 |

---

## 11. 实施路径概要（自顶向下，骨架优先）

按 §1.4 决策，使用 Option A —— 先铺基础设施，后接业务。详细步骤交由 writing-plans 阶段拆出，但大致顺序：

1. **脚手架**：`pnpm create tauri-app --template react-ts` 出新结构 → 把现 `apps/electron/src/renderer/`、`packages/ui/src/`、`packages/shared/src/types/` 内容搬入新 `src/` → 删掉 `apps/`、`packages/`、`pnpm-workspace.yaml`、`turbo.json`、`knip.json` → 跑通空 invoke
2. **基础设施 Rust 端**：`AppState` / `error.rs` / `tracing` / `sqlx pool` / migrations 框架
3. **persistence**：所有 repository trait + sqlite 实现 + migration 0001（含 schema 收敛）
4. **mcp**：`ServerManager` + `AggregatorServer` + 三种 transport
5. **http**：axum 路由 + auth + cors
6. **workflow**：executor + hook runtime（rquickjs spike）
7. **commands**：9 个域全部接通
8. **platform**：tray、menu、deep-link、single-instance、updater
9. **前端切换**：`platform-api` 改 invoke、事件订阅改 listen、构建配置切 vite
10. **打包**：tauri.conf.json bundler + targets + 产物校验
11. **删除旧代码**：`apps/`、`packages/`、`turbo.json` 等

---

## 12. 验收标准

- 应用能从托盘启动、能新增/启动/停止 MCP server
- :3282 HTTP 端点可被外部 MCP 客户端连上、聚合调用 tool 成功
- 至少一个 workflow（含 hook + mcp call）端到端跑通
- 主题跟随系统、deep link `mcpr://` 唤起、自动更新流程在 dev 环境能走通
- macOS Universal + Windows x64 安装包均产出
- 安装包体积 ≤ 30MB；冷启动后空载常驻 ≤ 100MB

---

## 13. 不在本 spec 范围内的事项

- 老 Electron 版本的最后一次发版 / 归档
- 数据迁移（暂无用户）
- CI/CD 平台切换（GitHub Actions 流程在 plan 阶段细化）
- 国际化文案补全（沿用现 `locales/`）
- 端到端测试框架（现用 Playwright Electron，新版需替换为 `tauri-driver` + `webdriverio`，列入 plan）
