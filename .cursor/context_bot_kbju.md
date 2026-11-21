# КБЖУ / питание (Life Dashboard) — сжатый контекст

> App: **`@.cursor/context_bot_miniapp.md`** · SQL: **`@.cursor/context_bot_to_sql.md`** · эталон UX: **`@.cursor/context_bot_28kcal.md`** (`~/Desktop/28kcal`)  
> Журнал переноса из 28kcal: **`@.cursor/context_deploy.md`** (команда «деплой лд»)  
> Деплой **только** Selectel: **`./deploy/deploy-dual.sh selectel`** · Amsterdam/WG **не трогать**  
> **Не брать из 28kcal:** воронка Pro / paywall / `isPro` · export-token (LD без initData-auth).

**Прод:** https://dash.svodbot.ru/mini-app/ · API `:8765` · БД `life_dashboard` / user `lifeapp` · контейнер `life_dashboard_pg` · VPS `161.104.47.52`  
**Локально:** `docker compose up -d` → `cd api && ./run.sh`

> **Крайнее по коду (сент. 2026):** матрица `COOK_FACTOR_RULES` (`api/cook_factor_rules.py` + зеркало в `app.js`) · сети lenta/lavka (`030`) · замеры A5 индейка fry, B7 фарш fry · cache в `index.html`: `app.js?v=20260926-odometer-url` (общий бандл; КБЖУ внутри).  
> **29.08–23.09:** ВиТ + Швили + Лента/Лавка · suggestedServingGrams · «Недавние» · экспорт CSV (+ читмил) · cook rules.

---

## Статус

| | |
|--|--|
| Cache (из `mini-app/index.html`) | `app.js?v=20260926-odometer-url` · `styles.css?v=20261012-transport-tax` |
| Миграции | `013–020` cook/food · `024` hide · `025` cheatmeal · `026` magnit · `027` perek suffix · `028` vkusnoitochka · `029` shvili · **`030` lenta+lavka** |
| food (ориентир из журнала) | perek ~10.1k · vv ~5.8k · magnit 9230 · vkusnoitochka 237 · shvili 104 · lenta 7820 · lavka 2067 · generic ~767 |
| Backup | `/opt/backups/life_dashboard/` keep 5 · cron пн **03:20 UTC** · `deploy/backup_life_dashboard.sh` |
| Auth | без `tgWebAppData` → API **404** (норма); SQL на прод через ssh |

```bash
./deploy/deploy-dual.sh selectel
# импорт сетей из kcal_28 (тот же PG-контейнер):
ssh root@161.104.47.52 'bash -s' < deploy/import_vkusnoitochka_from_kcal28.sh
ssh root@161.104.47.52 'bash -s' < deploy/import_shvili_from_kcal28.sh
ssh root@161.104.47.52 'bash -s' < deploy/import_lenta_lavka_from_kcal28.sh
# magnit: deploy/import_magnit_from_kcal28.sh
# миграции: docker exec -i life_dashboard_pg psql -U lifeapp -d life_dashboard < db/migrations/030_….sql
```

---

## Читмил (23.08)

Ручная кнопка у экспорта. Флаг **на день** → `nutrition_day_flags`; спорт/`classify_sport_day` **не трогает**.  
`PUT /nutrition/day/cheatmeal` `{ date, enabled }` → полный day payload.  
`cheatMeal` + `sportDayLabel=читмил`; `sportDayKind` = спорт всегда.  
**Экспорт CSV:** `_export_activity_label()` → «читмил» перекрывает спорт (как в UI).

| | target / range |
|--|--|
| Ккал | 2650 · 2600–2700 |
| Белок | 150 |
| Жиры | 65 · 60–70 |
| Углеводы | 360 · 340–380 |

---

## Таргеты (июль 2026 v2) — **не менять**

| kind | Ккал | Б | Ж | У | mid |
|------|------|---|---|---|-----|
| `rest` | 1650–1750 | 145–155 | 75–85 | 120–150 | 1700/150/80/135 |
| `workout` | 2050–2150 | 150–160 | 75–85 | 190–220 | 2100/155/80/205 |
| `cycling` | 2250–2400 | 145–155 | 60–70 | 250–320 | 2325/150/65/285 |
| `cycling_long` | 2500–2700 | 150–160 | 60–70 | 310–380 | 2600/155/65/345 |
| `running` | 1950–2100 | 145–155 | 60–70 | 190–230 | 2025/150/65/210 |
| `cheatmeal` | 2600–2700 | 150 | 60–70 | 340–380 | 2650/150/65/360 |

Приоритет спорта: **вело → бег → воркаут → отдых**; вело ≥90 → `cycling_long`. Читмил только вручную.

---

## Готовка

Каталог = сырое/сухое на 100 г. Sheet «Как взвешиваешь» → `grams`=вес с весов + `cookMode` (+`oilGrams`) → БД `weighed_grams`/`cook_mode`/`oil_grams`; учётные `grams = weighed × factor`.

**Правда кэфов (сент. 2026):** first-match матрица **`COOK_FACTOR_RULES`** в `api/cook_factor_rules.py` (+ зеркало `mini-app/app.js`).  
`nutrition_common.COOK_MODE_FACTORS` / `app.js COOK_MODES` = **только fallback**, если имя не попало в правила.

| Замер в правилах (из кода) | Factor |
|----------------------------|--------|
| A1 грудка пар | 812/538 |
| A2 жарка курицы | 420/350 |
| A5 индейка fry | 554/463 |
| B7 фарш fry | 500/385 · fry_stew = ×(1/0.85) |
| C1 треска пар | 190/120 |
| C3 минтай пар | 150/108 |
| D гречка | 55/175 |
| D pasta | 101/274 |

Fallback-режимы (если нет match): steam ≈1.25 · fry ≈1.275 · grain 1/2.7 · legume 1/2.3 · veg steam/boil/fry 1.1 / 1.05 / 1.2.

Дневник: учёт = `weighed×factor`. Блюдо: выход = `сырой/factor`. Масло: +г×9.  
Infer kind по имени; яйца/хлеб/авокадо/no-cook → без чипов; `пшен(?!и)`. Блюда (`is_dish`) — infer выкл.

**Осталось замерить (по журналу):** рис/овсянка и др. крупы · `boil_legume` · курица/индейка (пар, жар+туш частично) · мясо · рыба (треска — повтор желателен) · овощи (низкий приоритет).

---

## Каталог · adopt · сети

- `food` + свои `products`; XOR в логе. **Не** TRUNCATE/CASCADE food↔products.
- Adopt (`024`): правка food → свой product + hide в `user_hidden_food` (user_id=**1**). `POST …/adopt-catalog`.
- Магнит (`026`): `source=magnit`, «… Магнит», `deploy/import_magnit_from_kcal28.sh`.
- Перекресток (`027`): суффикс « Перекресток» в `name`.
- **Вкусно и точка (`028`):** `source=vkusnoitochka`, **237** поз., PDF→на 100 г, имена `…, 196г, Вкусно и точка`.
- **Швили (`029`):** `source=shvili`, **104** поз., Excel→на 100 г, имена `…, 220г, Швили`.
- **Лента + Лавка (`030`):** `source=lenta|lavka`, `deploy/import_lenta_lavka_from_kcal28.sh` · `READY_MEAL_RETAIL_SOURCES` += lenta, lavka.
- Дневник strip (`diaryDisplayName`): `ВкусВилл|Перекресток|Перекрёсток|Перек|Магнит|Лента|Лавка|5ка` + суффиксы «Вкусно и точка» / «Швили».

---

## Порция · «Недавние» · prefs (01.09)

**suggestedServingGrams** — `nutrition_common.suggested_serving_grams()` + `parse_weight_g_from_name()`; в API `catalog_row_to_api` / `product_row_to_api`.  
UI `lastDiaryGramsForProduct()`: prefs → `lastServingGrams` → **suggestedServingGrams** → `dishYieldGrams` → 100.

Правила: рестораны (ВиТ/Швили) — граммы из названия; снеки ≤150 г; baby ≤150 г; mini-sweets 20–100 г; drinks 200–500 мл; ready_meals Перек/Магнит/Лента/Лавка 100–350 г; dairy 100–200 г; retail >300 г и граммы в скобках — нет.

**«Недавние»** (single-user LD): `food_preferences` + `products.last_serving_grams` (переживает delete лога); fallback из `nutrition_log`. Избранное / «Мои» — по дате использования (`food_preferences.updated_at` / `products.updated_at`).  
Delete из дневника на экране «База» → reload списка. `POST /nutrition/log` → `lastServingGrams` в ответе → кэш UI.

Тесты: `api/test_suggested_serving.py` · `api/test_recent_prefs.py` · `api/test_cook_factor_rules.py`.

---

## Экспорт CSV (01–02.09)

`GET /nutrition/export.csv?period=7d|30d|all` · кнопки 7 / 30 / 365 в toolbar питания.

| Колонка | Содержимое |
|---------|------------|
| День | `ДД.ММ.ГГГГ` |
| Тип активности | отдых / воркаут / вело… / **читмил** |
| Ккал, Б, У, Ж, Клетчатка | факт; дни без еды — нули |

- Период **all** = 365 дней назад · все дни диапазона (не только с логом).
- Имя файла: `kbju-7d.csv` / `kbju-30d.csv` / `kbju-365d.csv` (`export_csv_filename`).
- LD: прямой URL + `downloadApiFile` → TG `downloadFile` (без export-token).
- Тест: `api/test_nutrition_export.py`.

---

## UI / продукты / блюда

Чипы: Недавние · Избранные · Мои · Блюда. `scope=mine|dishes`. Day-nav ‹ › · **База** · DnD long-press ~380 ms.  
Блюда: конструктор сырых + готовка блюда; в лог `cook_mode=plain`; первое добавление = `dishYieldGrams`.  
Заметка: localStorage `kcal28_note_height` · resize desktop/phone.

---

## API (кратко)

`GET/PUT` day · cheatmeal · products · adopt · meta · favorites · **export.csv** · dishes · log PATCH (`grams`+`cookMode`+`oilGrams` / `mealGroup`).  
Файлы: `api/nutrition_*.py` · `cook_factor_rules.py` · `dishes.py` · `catalog_read.py` · `item_meta.py` · `mini-app/{app.js,styles.css,index.html}`.

---

## Не трогать

28kcal Pro/воронка · office/walk · Mifflin · multi-user · Amsterdam · цифры таргетов (кроме явной правки) · Amsterdam/WG.

---

## Новый чат

```
@.cursor/context_bot_kbju.md
@.cursor/context_bot_28kcal.md
@.cursor/context_bot_miniapp.md
@.cursor/context_deploy.md
```
