# Контекст для Cursor

В новом чате цепляй **один** главный файл под задачу — не всю папку `.cursor/`.

| Задача | Файл |
|--------|------|
| **Telegram Mini App (ежедневно)** | `@.cursor/context_bot_miniapp.md` |
| КБЖУ | `@.cursor/context_bot_kbju.md` (+ при переносе: `context_deploy.md`) |
| Финансы | `@.cursor/context_bot_finance.md` |
| Дневник | `@.cursor/context_bot_diary.md` |
| Ledger | `@.cursor/context_bot_ledger.md` |
| VPN | `@.cursor/context_bot_freakingWG.md` |
| Postgres / API / SQL-бот | `@.cursor/context_bot_to_sql.md` |
| Sheets-бот / корневой `index.html` | **legacy** — `context_bot_appscript.md` / `context_html_appscript.md` (не для ежедневной работы) |

Правило alwaysApply: `.cursor/rules/life-dashboard.mdc` (сверяйся с miniapp).

Старт Mini App (старый промпт): `@.cursor/prompt-mini-app-start.md` — сверяй с актуальным `context_bot_miniapp.md`.

## Как не раздувать контекст

1. Один `@context_…` под задачу.  
2. Не кидать `@.cursor/` целиком в User Rules.  
3. Узкий промпт + один модульный файл.
