# Промпт: старт SQL-ветки (вставь в новый чат)

Скопируй блок ниже целиком. В Cursor добавь в контекст **только**:

- `@.cursor/context_bot_to_sql.md`
- `@Goal_Move_To_SQL.md` — если нужен полный roadmap; для узкой задачи можно без него

**Не добавляй:** `@.cursor/context_bot_appscript.md`, `@.cursor/context_html_appscript.md`, `@CONTEXT.md`.

---

```
Контекст: @.cursor/context_bot_to_sql.md и @Goal_Move_To_SQL.md.

Ветка для SQL-экспериментов. Прод-бот в bot/ + VPS + Google Sheets не трогаем.
Лаборатория: !bot_SQL/, запуск python main_sql.py, .env.sql с отдельным BOT_TOKEN.

Цель сессии: путь A, фаза 0–1 из Goal_Move_To_SQL —
1) docker-compose.yml с PostgreSQL на Mac
2) db/schema.sql (months, days, routine_values, sport_values, month_goals)
3) начать реализацию PostgresStore в !bot_SQL/postgres_store.py (хотя бы prepare_day + write_routine_batch)

Объясняй простым языком, я только начинаю SQL.
После каждого шага — что проверить в терминале или в клиенте БД (psql / TablePlus).
Минимальный diff, без FastAPI и без правок index.html / apps-script.
```

---

## Варианты узких follow-up (без Goal в контексте)

**Только Docker + схема:**

```
@.cursor/context_bot_to_sql.md
Сделай docker-compose.yml и db/schema.sql по контексту. Прод и !bot_SQL/main_sql.py не ломай.
```

**Только PostgresStore:**

```
@.cursor/context_bot_to_sql.md
Реализуй prepare_day и write_routine_batch в !bot_SQL/postgres_store.py под уже созданную схему.
```
