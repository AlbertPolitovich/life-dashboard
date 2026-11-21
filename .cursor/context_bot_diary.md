# Дневник (Mini App) — сжатый контекст

> **Крайнее: 17.08** — home: **Заполнен** / **Не заполнен**; CTA → первая дыра месяца (1-е…вчера), иначе вчера · `?v=20260817-diary-month-gap`.

**Прод:** https://dash.svodbot.ru/mini-app/  
**Локально:** `docker compose up -d` → `cd api && ./run.sh`  
**Деплой:** `./deploy/deploy-dual.sh selectel`  
**Cache-bust:** `diary.js?v=20260817-diary-month-gap`

## Главное (июль–август 2026)

- Редактор — plain text, Obsidian-совместимый.
- `[` → `[[|]]`, история wiki: `lifeDashboard.diaryWikiLinks`.
- `#` → история тегов: `lifeDashboard.diaryHashtags`.
- **Предложка `#` / `[[`:** только то, что встречалось в дневнике **за последние 40 дней**. Источник правды — `GET /diary/suggest-tokens?days=40` (скан `diary_entries`). Отдельной таблицы архива нет: старше 40 дней **удаляется** из localStorage предложки.
- Формат localStorage: `[{t, u}]` (`text` + `lastUsed` yyyy-MM-dd); старый массив строк мигрируется на лету.
- Автопары без памяти: `()`, `""`, `****` (обертка `**...**` при выделении).
- Для автопар работает удаление пары целиком на `Backspace/Delete`.
- `Tab` / `Shift+Tab` в редакторе:
  - отступ/снятие отступа для абзаца (между пустыми строками),
  - текст хранится обычными табами/пробелами, без спец-символов.
- CTA с home: если в **текущем месяце** (1-е … вчера) есть дыра — открывает **первый незаполненный** день; иначе вчера. Статус: **Заполнен** / **Не заполнен** (не «Вчера заполнено»).
- Placeholder редактора: `Что было важным в четверг…` — день недели **даты записи** (не «сегодня»). С home это вчера; из календаря — выбранный день. `в/во` + вин. п. (`во вторник`, `в среду`, `в пятницу`…).

## API и данные

- Таблица: `diary_entries(entry_date PK, body, created_at, updated_at)`.
- API:
  - `GET /diary/month?month=`
  - `GET /diary/day?date=`
  - `GET /diary/suggest-tokens?days=40` — `#` и `[[wiki]]` за окно дней
  - `POST /diary/day` (upsert, пустой body = delete)
  - `DELETE /diary/day?date=`

## Статус

- Home/Calendar/Editor: ✅
- Импорт Obsidian → Postgres: ✅ (история 2024–2026)
- Экспорт mini-app → Obsidian: **по запросу вручную через агента** (уже делали успешно; не продуктовая очередь)

## Новый чат

```
@.cursor/context_bot_diary.md
@.cursor/context_bot_miniapp.md
```
