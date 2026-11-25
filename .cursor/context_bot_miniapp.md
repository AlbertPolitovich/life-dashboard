# Telegram Mini App — контекст (актуально)

> **Статус продукта (нояб. 2026):** стабильно в проде, пользуются каждый день. Активной разработки сейчас нет — **не потому что забросили**, а потому что нужды нет. Доработки — **по нужде**, не «добить очередь ради очереди».  
> Дизайн: **`@.cursor/context_visualization_miniapp.md`** · API/БД: **`@.cursor/context_bot_to_sql.md`**  
> **КБЖУ:** **`@.cursor/context_bot_kbju.md`** · **Финансы:** **`@.cursor/context_bot_finance.md`**  
> **Дневник:** **`@.cursor/context_bot_diary.md`** · **Ledger:** **`@.cursor/context_bot_ledger.md`**  
> **VPN:** **`@.cursor/context_bot_freakingWG.md`**  
> **Журнал КБЖУ из 28kcal → LD:** **`@.cursor/context_deploy.md`** (команда «деплой лд»)  
> **Деплой:** **`./deploy/deploy-dual.sh selectel`** (после правок `mini-app/` или `api/`)

---

## Стек · прод

| Слой | Где |
|------|-----|
| UI + API + БД | **только Selectel** `161.104.47.52` → `https://dash.svodbot.ru/mini-app/` |
| Amsterdam `194.135.20.35` | VPN / Xray / WG — **не** API |
| UI | `mini-app/` — `app.js`, `finance.js`, `diary.js`, `ledger.js`, `charts.js`, `styles.css`, `index.html` |
| API | FastAPI `api/server.py` + `*_read.py` / `*_write.py` · порт **8765** · systemd `life-dashboard-api` |
| БД | Postgres `life_dashboard` · контейнер `life_dashboard_pg` · прод-юзер `lifeapp` |
| Локально | `docker compose up -d` (юзер `life`/`life`) → `cd api && ./run.sh` → http://127.0.0.1:8765/mini-app/ |
| Сборка | **нет** `package.json` / npm — статика + Python |
| Env | `api/.env.example` (`DATABASE_URL=…`) · секреты в `api/.env`, `bot/.env`, `!bot_SQL/.env.sql` (**не читать в чат**) |
| GitHub | https://github.com/AlbertPolitovich/life-dashboard · remote `origin` (SSH) · после коммита — `git push` (не MCP) |

```bash
./deploy/deploy-dual.sh selectel   # код
# !bot_SQL/ — отдельный rsync только если правим SQL-бота/auth
```

**Локальный запуск (кратко):**

```bash
docker compose up -d
cd api && ./run.sh          # нужен ../bot/.venv
# открыть http://127.0.0.1:8765/mini-app/
```

**Бренд в UI (хедер / title / login / PWA):** **tim710** (не «Life Dashboard»). Репо/GitHub URL без изменений.

**Cache-bust (актуально по `mini-app/index.html`, проверить перед правкой UI):**  
`styles.css?v=20261125-design-refresh` · `app.js?v=20261125-design-refresh` · `charts.js?v=20261125-design-refresh` · `manifest.webmanifest?v=20261121-tim710` · `finance.js?v=20260821-export-name`  
`ledger.js?v=20261012-tax-years-only` · `diary.js?v=20260817-diary-month-gap`

**Эталон UI финансов:** то, что на проде / в `mini-app/finance.js` (+ `charts.js`). Отдельного canvas-мокапа **нет** (был набросок дизайна, файла нет) — не искать `finance-mockup.canvas.tsx`.

---

## Сделано недавно (нояб. 2026, не откатывать)

### Design refresh · Home (косметика)

- Шапка графит `#111317` + мини-герб слева от **tim710** на Home; `theme-color` / status-bar под бесшовный верх Safari/PWA.
- Фон `#F2F4F7`, карточки `#fff`, треки прогресса `#E5E9F0`; подписи 10–11px, tabular nums.
- На Home одна синяя «Заполнить»; «Заполнить дневник» / «Распределить» — вторичные.
- «Не заполнен» в дневнике — нейтральный hint (не красный); макро-бары КБЖУ чуть спокойнее.
- **Не** делали: герб на login Safari, сводку ккал в шапке КБЖУ на Home.
- Палитра поверхностей зафиксирована (TG dark theme не перекрашивает фон/шапку).
- Cache: `styles.css` / `app.js` / `charts.js` `?v=20261125-design-refresh`.

### Бренд UI · tim710

- Хедер home, `<title>`, экран логина, `apple-mobile-web-app-title`, `manifest` name/short_name → **tim710**.
- Имя репо / GitHub URL не трогали.

### Safari / PWA · вход без Telegram

- Вторая дверь: `LD_ACCESS_TOKEN` → POST `/auth/login` или GET `/auth/login?k=` → cookie `ld_session` (год, HttpOnly).
- TG-вход не трогали. Симметрия: один API/БД; без service worker кэша данных.
- UI: экран `#webLoginGate` если нет TG и нет сессии. Manifest + `mini-app/icons/*`.
- Скрипт `telegram.org` **только** в TG; Safari без него. `/` → редирект на `/mini-app/` (не stealth 404). Данные API по-прежнему 404 без TG/cookie.

---

## Сделано недавно (август 2026, не откатывать)

### Fill · «Другой день» сразу вчера

Кнопка **Другой день** (хедер + бейдж у «Итог вчера») открывает историю на **вчера**, не на сегодня. Сегодняшний спорт и так на «Заполнить». Подпись полоски: **Вчера** (не weekday). Стрелки ‹ › дальше по календарю, сегодня доступен вручную. `openHistoryFill(yesterdayIso())`. Cache `app.js?v=20260817-fill-hist-yesterday` (в `index.html` сейчас более новый `app.js?v=20260926-odometer-url`).

### Дневник · home: Заполнен / дыра в месяце

Статус **Заполнен** / **Не заполнен** — не «Вчера заполнено». CTA открывает первый незаполненный день текущего месяца (1-е…вчера); если дыр нет — вчера. Cache `diary.js?v=20260817-diary-month-gap`.

---

## Сделано недавно (июль 2026, не откатывать)

### Приватность · две двери, одна БД

- API: middleware `TelegramGateMiddleware` — **TG initData** (username `tim710` / `ALLOWED_TELEGRAM_ID`) **или** cookie `ld_session` после ключа `LD_ACCESS_TOKEN`.
- Без auth → **404** на API (`/month`, `/health`, …). Эндпоинты `/auth/login|logout|status` открыты.
- `/mini-app/` статика **открыта** (TG WebView + Safari / PWA); данные закрыты API.
- Клиент TG: `X-Telegram-Init-Data` + `tgWebAppData` — как раньше.
- Safari / «На экран Домой»: один раз ключ (поле или `?k=` / `/auth/login?k=`) → HttpOnly cookie на год. PWA: `manifest.webmanifest` + иконки; **без** SW-кэша API/HTML.
- Env: `ALLOWED_TELEGRAM_USERNAME=tim710`, опц. `ALLOWED_TELEGRAM_ID`, **`LD_ACCESS_TOKEN`** (секрет только в `api/.env`, см. `api/.env.example`).
- SQL-бот: middleware только `@tim710` (без cookie-пути — ок).

### КБЖУ · день «Сегодня» + матрица v2

- `#nutritionDayStrip`: сегодня → **Сегодня**; иначе `Пн, 22 июня` (`formatNutritionDayLabel`).
- `nutrition_targets` · миграции **013** + **014** + **025**:
  - `rest` / `workout` / `cycling` / **`cycling_long`** / `running` / **`cheatmeal`** (ручной)
  - вело ≥90 мин (col 20) → `cycling_long`
  - читмил: кнопка в дневнике, флаг на день в `nutrition_day_flags`
  - v2: жиры 60–70 у вело/бега; углеводы 250–320 / 310–380 / 190–230
- Полоски UI = середина диапазона. Детали: **`context_bot_kbju.md`**.

### Финансы · план = выбранный месяц навигации

- Форма План: `planMonthKey() = fin.monthKey || currentMonthKey()` — **тот же месяц**, что Категории/факт (не `M+1`).
- Баннер «веди план на …» открывает **следующий** месяц на вкладке План.
- Сохранение только в целевой месяц; прошлые месяцы не перезаписывать без запроса.
- Напоминания: сохранять `due_date` (не только `day_of_month`) — иначе 11.09 → 11.08. См. **`context_bot_finance.md`**.

### Ledger · «Распределить» → Inbox

- `#ledgerAllocateBtn` / inbox-строка → `openInbox("inbox")`.
- Фикс гонки: `pendingDetailTab` + scroll-spy не сбрасывает вкладку до `refreshDetail`. См. **`context_bot_ledger.md`**.

### Ранее (не откатывать)

- Неделя продуктивности на границе месяца: факт по датам пн–вс, не `month_id`.
- Дневник: `monthCaches` Map для точек home.
- Ledger inbox dismiss · графики до текущего месяца · `onFinanceChange`.
- `month_ensure.py` · fullscreen TG · silentRefresh.

---

## Сделано после августа 2026 (код есть)

### КБЖУ · сентябрь (детали в `context_bot_kbju.md` + `context_deploy.md`)

- Cook factors по имени: `api/cook_factor_rules.py` + зеркало в `app.js` (`COOK_FACTOR_RULES`).
- Каталог сетей: magnit · vkusnoitochka · shvili · **lenta** · **lavka** (миграции `026`–`030`).
- `suggestedServingGrams`, «Недавние» из prefs, экспорт CSV с типом активности (+ читмил).

### Ledger · октябрь · транспортный налог

- Миграция **`031_ledger_transport_tax.sql`**: sub_bucket `transport_tax` у Audi (не создавать лишние `finance_transactions` — ломает carryover).
- UI: `ledger.js?v=20261012-tax-years-only`, `styles.css?v=20261012-transport-tax`.
- PATCH одометра: `PATCH /ledger/car/tech/odometer` (`app.js?v=20260926-odometer-url`).

### Финансы · импорты выписок (операционка)

- Процесс «К3» / выписки → матрица в чате → INSERT на Selectel (не через HTTP без TG). См. **`context_bot_finance.md`**.

---

## Home · навигация

```
KPI 2×2 → Заполнить → КБЖУ → Финансы → Дневник → Ledger
```

---

## Модули · статус (сводка)

| Модуль | Статус | Где правда |
|--------|--------|------------|
| Home / Fill / KPI / спорт | ✅ стабильно в проде | этот файл + viz miniapp |
| КБЖУ | ✅ стабильно в проде | `context_bot_kbju.md` |
| Финансы | ✅; PATCH txn в UI нет; Обзор/sheet — полировка по нужде | `context_bot_finance.md` |
| Дневник | ✅; экспорт → Obsidian — **вручную агентом по запросу** | `context_bot_diary.md` |
| Ledger | ✅; сверка ипотеки / Audi split — по нужде | `context_bot_ledger.md` |
| VPN | ✅ Xray + RU gateway; dual-API NL снят | `context_bot_freakingWG.md` |
| Sheets-бот `bot/` + корневой `index.html` + Apps Script | **legacy — не для ежедневной работы** | `context_bot_appscript.md` / `context_html_appscript.md` |
| SQL-бот `!bot_SQL/` | запасной fill / лаборатория | `context_bot_to_sql.md` |

---

## API (сводка)

| Область | Эндпоинты |
|---------|-----------|
| Routine / sport | `GET /month`, `/week`, `/day` · `POST /write` |
| КБЖУ | `/nutrition/*` · `/catalog/*` · `PUT …/cheatmeal` · `GET …/export.csv` |
| Финансы | `/finance/*` (в т.ч. `PATCH /finance/transactions/{id}` — **API есть, UI нет**) |
| Дневник | `/diary/*` · `GET /diary/suggest-tokens` |
| Ledger | `/ledger/*` incl. `POST /ledger/inbox/dismiss` · `PATCH /ledger/car/tech/odometer` |

Миграции: `db/migrations/001`…`031` (нет `021`–`023` в репо — норма). Базовая схема: `db/schema.sql`.

---

## Ключевые запреты

- Amsterdam / WG / dual deploy API «на всякий» — **не трогать**.
- `fitbite28` / порт `8766` / Pro-воронка 28kcal — **не тащить в LD**.
- Цифры КБЖУ-таргетов — только по явной просьбе.
- TRUNCATE/CASCADE `food`↔`products` — запрещено.
- Git push на remote и миграции БД — только по явной просьбе.
- Секреты (`.env`, токены) в чат не выводить — только путь к файлу.
- Не поднимать legacy Sheets-бот / корневой `index.html` в ежедневных задачах Mini App.

---

## Очередь (по нужде, не «добить ради галочки»)

1. **PATCH транзакций в UI** (финансы) — API уже есть; в sheet сейчас create/delete.  
2. **Полировка финансов:** Обзор / bottom sheet — эталон = **прод-код**, не canvas.  
3. **Action-кнопки хедера в fullscreen TG.**  
4. **Ledger:** сверка ипотеки с банком · UI при платеже > +20% · Audi split / loan UI.

**Позже / по запросу:** экспорт дневника mini-app → Obsidian (**вручную через агента**; уже делали успешно) · `ALLOWED_TELEGRAM_ID` вместо username · коммерческий КБЖУ · VLESS Reality на Selectel · xHTTP inbound Amsterdam.

---

## Карта ссылок (файлы контекста)

| Файл | Зачем |
|------|--------|
| `.cursor/context_bot_miniapp.md` | Главный вход Mini App |
| `.cursor/context_visualization_miniapp.md` | UX/токены home·fill·KPI |
| `.cursor/context_visualization_finance.md` | UX финансов (эталон = прод) |
| `.cursor/context_visualization_diary.md` | UX дневника |
| `.cursor/context_bot_to_sql.md` | Postgres / API / SQL-бот |
| `.cursor/context_bot_kbju.md` | КБЖУ LD |
| `.cursor/context_bot_finance.md` | Финансы + импорт выписок |
| `.cursor/context_bot_diary.md` | Дневник поведение/API |
| `.cursor/context_bot_ledger.md` | Ledger / Inbox / объекты |
| `.cursor/context_bot_freakingWG.md` | VPN актуальный |
| `.cursor/context_miniapp_phone_vpn.md` | Исторический лог VPN-инцидентов |
| `.cursor/context_deploy.md` | Журнал переноса КБЖУ 28kcal→LD |
| `.cursor/context_bot_28kcal.md` | Эталон 28kcal (не путать с LD) |
| `.cursor/context_bot_appscript.md` | **Legacy** Sheets-бот |
| `.cursor/context_html_appscript.md` | **Legacy** дашборд Sheets |
| `.cursor/rules/life-dashboard.mdc` | alwaysApply: сверяйся с miniapp |
| `.cursor/rules/deploy-selectel.mdc` | Команда «деплой» |
| `.cursor/rules/deploy-ld-kbju.mdc` | Команда «деплой лд» |
| `.cursor/README.md` | Какой context цеплять в чат |
| `Goal_Move_To_SQL.md` | Старый roadmap SQL (исторический) |
| `api/README.md` | Запуск API |
| `deploy/DEPLOY_SQL_MINIAPP_VPS.md` | Старый деплой на Amsterdam (не прод Mini App) |

---

## Новый чат

```
@.cursor/context_bot_miniapp.md
@.cursor/context_bot_finance.md
@.cursor/context_bot_ledger.md
@.cursor/context_bot_kbju.md
@.cursor/context_bot_freakingWG.md
```

При КБЖУ-переносе из 28kcal дополнительно: `@.cursor/context_deploy.md`.
