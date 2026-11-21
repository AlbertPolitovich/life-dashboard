# Промпт: копия HTML для SQL (вставь в новый чат)

Скопируй блок ниже целиком. В Cursor добавь в контекст:

- **`@.cursor/context_bot_to_sql.md`** — обязательно
- `@Goal_Move_To_SQL.md` — только если нужны детали пути B / API

**Не добавляй:** `@.cursor/context_bot_appscript.md`, `@.cursor/context_html_appscript.md`, прод `bot/deploy`.

---

```
Контекст: @.cursor/context_bot_to_sql.md

Этап: копия дашборда для SQL (index-sql), прод не трогаем.

Уже есть:
- Postgres на Mac (docker-compose), таблицы months / days / routine_values / sport_values / month_goals
- SQL-бот (!bot_SQL/): запись routine/sport, цели месяца (routine 28/30/31 + sport шаблон 2026)
- Прод: bot/ + Google Sheets + index.html + Apps Script — НЕ МЕНЯТЬ

Цель сессии:
1) Сделать index-sql.html — копия index.html с другим источником данных (не Google Sheets URL).
2) Минимальный read-only бэкенд (допустим маленький FastAPI в репо), который отдаёт JSON в том же формате, что doGet сейчас (rows, sport, sportByType, month — как ждёт index.html).
3) Данные считать из Postgres: факт routine = SUM по сферам за месяц, цели из month_goals; sport — агрегаты по полям 10,11,14,15,16,19,20 за месяц + цели из month_goals.

Ограничения:
- Не править боевой index.html и apps-script-doGet.gs
- Не трогать VPS и прод-бота
- Воскресные картинки в SQL-боте не нужны
- Минимальный diff, объясняй простым языком
- После каждого шага: как проверить (браузер + TablePlus или curl на API)

Старт: предложи структуру файлов (куда положить index-sql.html, api/, какой URL в HTML), затем реализуй по шагам.
```

---

## Узкие follow-up

**Только HTML-копия (без API):**

```
@.cursor/context_bot_to_sql.md
Скопируй index.html → index-sql.html, поменяй только заголовок и заготовку API_URL (localhost). API пока заглушка.
```

**Только read API:**

```
@.cursor/context_bot_to_sql.md
Сделай GET /month?month=YYYY-MM из Postgres, JSON как doGet (rows + sport). Без правок index.html.
```

**Сверка с TablePlus:**

```
@.cursor/context_bot_to_sql.md
Дай SQL-запросы, которыми проверить fact/goal за месяц перед подключением к index-sql.
```
