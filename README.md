# MCP Router

Tauri 2 + React + Rust 实现的 MCP 服务管理工具。

## Tech stack

- 前端：React 19 + Vite + TypeScript + Tailwind 3 + shadcn/ui
- 后端：Rust + Tauri 2 + tokio + sqlx (sqlite) + tracing
- IPC：Tauri commands；类型由 ts-rs 自动生成到 `src/types/generated/`

## Develop

    pnpm install
    pnpm tauri dev

Vite 走 5173 端口（避开 Windows WinNAT 排除范围），Tauri dev 透传到 webview。

## Build

    pnpm tauri build

## Tests

    cd src-tauri
    cargo test

当前共 7 个测试：error (3) + ping (2) + pool (1) + ts-rs auto export (1)。

## SQLx prepared queries

修改 `sqlx::query!` 宏内的 SQL 后，重新生成 offline 元数据：

    cd src-tauri
    DATABASE_URL=sqlite::memory: cargo sqlx prepare -- --tests

把生成的 `src-tauri/.sqlx/` 一起提交。

## Project structure

详见 `docs/superpowers/specs/2026-04-27-mcp-router-tauri-rewrite-design.md`。

实施计划与进度追踪在 `docs/superpowers/plans/`。
