# Промпт: старт Telegram Mini App (исторический)

> **MVP уже реализован.** Для нового чата используй **`@.cursor/prompt-mini-app-continue.md`** + **`@.cursor/context_bot_miniapp.md`**.

# Промпт: старт Telegram Mini App (вставь в новый чат)

Скопируй блок ниже целиком. В Cursor добавь в контекст:

- **`@.cursor/context_bot_miniapp.md`** — обязательно
- **`@.cursor/context_visualization_miniapp.md`** — wireframe, карточки, microcopy, CTA
- `@.cursor/context_bot_to_sql.md` — только если нужны детали API/Postgres/SQL-бота

**Не добавляй:** `@.cursor/context_bot_appscript.md`, `@.cursor/context_html_appscript.md`, прод `bot/deploy`, `index.html`, `apps-script-doGet.gs`.

**Перед стартом на Mac:** Postgres (`docker compose up -d`) + API (`cd api && ./run.sh`).

---

```
Контекст: @.cursor/context_bot_miniapp.md
Дизайн: @.cursor/context_visualization_miniapp.md

Этап: MVP Telegram Mini App (1 экран), прод не трогаем.

Уже есть:
- Postgres + SQL-бот (!bot_SQL/)
- FastAPI на http://127.0.0.1:8765:
  - GET /month?month=YYYY-MM — прогресс месяца (rows, sport, sportByType)
  - GET /day?date=YYYY-MM-DD — что заполнено за день (routine[], sport[], row1Based)
  - POST /write — prepareDay, writeRoutineBatch, writeSportBatch
- index-sql.html — референс fetch к API (Chart.js), не копировать целиком

Цель сессии:
1) Создать mini-app/index.html + mini-app/app.js (HTML + JavaScript в WebView Telegram).
2) Верх экрана: прогресс месяца из GET /month (MVP: компактные KPI-карточки 2×2 или упрощённые бары; позже донаты — заложить место).
3) Низ: форма дня из GET /day — 8 тумблеров routine (col 2–9) + sport (минимум: разминка 10, run km 15, run time 16; остальное под «Ещё поля»).
4) Sticky кнопка внизу всегда видна: «Сохранить день» → prepareDay (если needs) → writeRoutineBatch → writeSportBatch.
5) После успешного сохранения — скрыть блок формы, обновить /month; кнопка кратко «День сохранён ✓».
6) Подключить Telegram WebApp SDK (expand, theme, safe area). API_BASE = тот же origin или http://127.0.0.1:8765 для локальной отладки в браузере.
7) По желанию: отдавать mini-app/ через FastAPI (StaticFiles на /mini-app) — один origin с API, без CORS.

Ограничения:
- Не менять прод-бота, Sheets, index.html, apps-script-doGet.gs, VPS
- Не делать week/month переключатель, финансы, КБЖУ — только заглушка/место под будущее
- Минимальный diff, простые объяснения
- После каждого шага: как проверить (браузер file:// или :8765/mini-app, curl, TablePlus)

Старт:
1) Предложи структуру mini-app/ и как тестировать без Telegram (браузер) и с Telegram (BotFather Web App URL позже).
2) Сверстай каркас (progress + form + sticky CTA), затем подключи API.
3) В конце — чеклист «готово к привязке в BotFather».
```

---

## Узкие follow-up

**Только каркас UI (без API):**

```
@.cursor/context_bot_miniapp.md
@.cursor/context_visualization_miniapp.md
Сделай mini-app/index.html + styles: верх 2×2 карточки-заглушки, вкладки Рутина/Спорт, sticky CTA. Данные моковые.
```

**Только подключение API:**

```
@.cursor/context_bot_miniapp.md
В mini-app/app.js подключи GET /month, GET /day, POST /write. Форма уже есть.
```

**Отдача с FastAPI:**

```
@.cursor/context_bot_miniapp.md
Добавь в api/server.py раздачу mini-app/ (StaticFiles), чтобы открывать http://127.0.0.1:8765/mini-app/
```

**Локальная отладка без Telegram:**

```
@.cursor/context_bot_miniapp.md
Как открыть Mini App в Chrome/Safari на Mac с API на :8765? Дай точные URL и что проверить в Network.
```
