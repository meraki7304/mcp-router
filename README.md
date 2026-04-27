## SQLx prepared queries

When you change SQL inside `sqlx::query!` macros, regenerate offline metadata:

    cd src-tauri
    DATABASE_URL=sqlite::memory: cargo sqlx prepare -- --tests

Commit the resulting `src-tauri/.sqlx/` changes.
