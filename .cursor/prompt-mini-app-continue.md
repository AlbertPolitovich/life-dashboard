# Промпт: продолжить Telegram Mini App (новый чат)

Скопируй блок ниже. В контекст чата добавь:

- **`@.cursor/context_bot_miniapp.md`** — актуальное состояние (обязательно)
- **`@.cursor/context_visualization_miniapp.md`** — если правишь UI
- **`@.cursor/context_bot_to_sql.md`** — если трогаешь API/БД

**Не добавляй:** прод `bot/deploy`, корневой `index.html`, `apps-script-doGet.gs`.

**Перед работой:** `docker compose up -d` → `cd api && ./run.sh` → открыть http://127.0.0.1:8765/mini-app/

---

```
@.cursor/context_bot_miniapp.md
@.cursor/context_visualization_miniapp.md

Продолжаем Telegram Mini App. MVP уже в коде — не пересоздавай с нуля.

Сделано (не ломать без запроса):
- mini-app/: home (KPI 2×2), datePick, dayForm, detailProductivity, detailSport
- charts.js: донаты + radar; week/month только в Продуктивности (неделя по умолчанию)
- api/week_read.py + GET /week; StaticFiles /mini-app/
- Карточка «Сегодня»: 5/8 + сохранено/не заполнено + «Заполнить ›» → datePick
- datePick: Сегодня|Вчера + лента 7 дней (не колесо)
- Sticky: home «Заполнить», dayForm «Сохранить день»
- GET /day для карточки Сегодня; после save → home

Ограничения:
- Прод-бот, Sheets, index.html в корне, VPS — не трогать
- Финансы/КБЖУ — блоки ниже дашборда, не в KPI 2×2
- Минимальный diff, после шага — как проверить (:8765/mini-app, curl)

Типичные следующие задачи (выбери одну или укажи свою):
1) **КБЖУ + клетчатка** — см. `@.cursor/prompt-mini-app-kbju.md` (приоритет)
2) Деплой: HTTPS, BotFather URL
3) Финансы — блок под home
4) Полировка UI (Health Cards)

Начни с: прочитай context_bot_miniapp.md, кратко подтверди текущий UX, спроси что делаем в этой сессии (если я не написал явно).
```

---

## Узкие задачи (одна строка + контекст)

**Только визуал:**
```
@.cursor/context_bot_miniapp.md
Полировка mini-app под Health Style: KPI, strip, донаты 80px. Логику не менять.
```

**4-я KPI + API:**
```
@.cursor/context_bot_miniapp.md
Замени заглушку «Серия» на «Дни месяца» N/30 с записью; добавь агрегат в api (week_read или month).
```

**BotFather:**
```
@.cursor/context_bot_miniapp.md
Чеклист и шаги: HTTPS, URL /mini-app/, Menu Button. Локально уже работает на :8765.
```

**Финансы (заглушка→блок):**
```
@.cursor/context_bot_miniapp.md
Секция «Финансы» под KPI на home (заглушка UI), без прод-бота. API позже.
```
