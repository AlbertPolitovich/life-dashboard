# context_deploy — журнал КБЖУ из 28kcal для LD-агента

> Пишет агент **28kcal** после правок КБЖУ.  
> Читает агент **LifeDashboard**: переносит изменения в код LD и сам деплоит дашборд.  
> Деплой 28kcal делает 28kcal-агент; **сюда не пишем** команды `deploy-dual` / rsync LD.

## Шаблон главы

```markdown
## YYYY-MM-DD

### Краткий заголовок правки
- **Что:** файл / константа: было → стало
- **Зачем:** …
- **LD повторить:** …
- **28kcal прод:** да (`?v=…`) / нет
```

Один календарный день — один `## YYYY-MM-DD`. Повторные правки в тот же день — новые `###` под тем же днём.

---

<!-- Главы ниже. Пока пусто — первая запись появится после следующей КБЖУ-правки в 28kcal. -->

## 2026-08-29

### Вкусно и точка — меню из PDF → food
- **Что:** source=`vkusnoitochka` · миграция `027_food_source_vkusnoitochka.sql` · `etl/vkusnoitochka/parse_sostav_pdf.py` + `import_food.py` · **237** позиций. PDF = КБЖУ **на порцию** → в БД **на 100 г**. Имена: `Двойной Фиш Бургер, 196г, Вкусно и точка` (вес порции обязателен).
- **Зачем:** сеть в поиске каталога 28kcal.
- **LD повторить:** при желании тот же source/label + меню в LD `food` (миграция source CHECK + импорт); не блочит 28kcal.
- **28kcal прод:** да (миграция `027` + 237 rows) · UI cache без bump (только каталог БД)
- **LD:** сделано

## 2026-09-01

### Швили — меню из Excel → food
- **Что:** source=`shvili` · миграция `028_food_source_shvili.sql` · `etl/shvili/parse_xlsx.py` + `import_food.py` · **104** позиций. Excel = КБЖУ **на порцию** → в БД **на 100 г**. Имена: `Жареная картошка с вешенками, 220г, Швили` (вес порции обязателен).
- **Зачем:** сеть в поиске каталога 28kcal.
- **LD повторить:** при желании тот же source/label + меню в LD `food` (миграция source CHECK + импорт); не блочит 28kcal.
- **28kcal прод:** да (миграция `028` + 104 rows) · UI cache без bump (только каталог БД)
- **LD:** сделано

### Порция из названия → suggestedServingGrams
- **Что:** `api/nutrition_common.py` → `suggested_serving_grams()` + `parse_weight_g_from_name()` · `catalog_row_to_api` / `product_row_to_api` → поле `suggestedServingGrams` · `nutrition_read.list_recent_logged_products` — source/category в recent · `mini-app/app.js` → `lastDiaryGramsForProduct()` после `lastServingGrams`, до `dishYieldGrams` · bump `app.js?v=20260901-recent`
- **Зачем:** автодефолт граммов при добавлении: рестораны (ВиТ/Швили), снеки ≤150 г, детское ≤150 г, мини-сладости 20–100 г, напитки 200–500 мл, готовая еда Перек/Магнит 100–350 г, dairy-порции 100–200 г; >300 г retail и граммы в скобках — нет; prefs пользователя важнее
- **LD повторить:** `api/nutrition_common.py` → те же функции/правила · `catalog_read.py` / `nutrition_read.py` · `mini-app/app.js` → `lastDiaryGramsForProduct` · bump `?v=`
- **28kcal прод:** да (`?v=20260901-recent`)
- **LD:** сделано

### Недавние и граммы после удаления из дневника
- **Что:** `nutrition_read.list_recent_logged_products` → prefs (`user_food_preferences` / `user_product_preferences`) + fallback из лога · `item_meta.list_favorites` → сортировка: `prefs.updated_at`, затем `meta.updated_at` · `list_products` scope=mine → `upp.updated_at`, затем `p.updated_at` · `mini-app/app.js` → reload после delete на экране продуктов; `lastServingGrams` из ответа `POST /nutrition/log` · `api/test_recent_prefs.py` · bump `app.js?v=20260901-recent`
- **Зачем:** после удаления записи продукт остаётся в «Недавние», граммы сохраняются; избранное/мои — по дате использования в дневнике; поиск не трогали
- **LD повторить:** те же пути в `nutrition_read.py`, `item_meta.py`, `mini-app/app.js` · bump `?v=`
- **28kcal прод:** да (`?v=20260901-recent`)
- **LD:** сделано

### fry_meat: замер жарки курицы 420→350 г
- **Что:** `COOK_MODE_FACTORS['fry_meat']` **1.275 → 420/350 ≈ 1.2** · `fry_stew_meat` пересчитан · `mini-app/app.js` `COOK_MODES` · bump `?v=20260901-frymeat`
- **Зачем:** замер 01.09 — грудка жарка на бумаге без масла, 420 г сырого → 350 г на выходе
- **LD повторить:** `api/nutrition_common.py` → `COOK_MODE_FACTORS` · `mini-app/app.js` → `COOK_MODES` · bump `?v=`
- **28kcal прод:** да (`?v=20260901-frymeat`)
- **LD:** сделано

### Fix: «Недавние» — 14 placeholders / 15 params
- **Что:** `nutrition_read.list_recent_logged_products` — убран лишний `user_id` в params · `api/test_recent_prefs.py` — assert `sql.count("%s") == len(params)` · bump `app.js?v=20260901-recentfix`
- **Зачем:** при открытии вкладки «Недавние» — `База недоступна: the query has 14 placeholders but 15 parameters were passed`
- **LD повторить:** `nutrition_read.py` → `list_recent_logged_products` params
- **28kcal прод:** да (`?v=20260901-recentfix`)
- **LD:** сделано

### Экспорт дневника: колонка «Тип активности»
- **Что:** `nutrition_read.build_nutrition_export_csv` / `list_daily_nutrition_totals` → колонка «Тип активности» между «День» и «Ккал» · `resolve_day_kind` + `DAY_KIND_LABELS` · `api/test_nutrition_export.py`
- **Зачем:** в CSV видно тип дня (отдых, воркаут, бег…) как в приложении
- **LD повторить:** `nutrition_read.py` → экспорт CSV
- **28kcal прод:** нет
- **LD:** сделано (+ читмил через `_export_activity_label`)
- **Что:** `mini-app/app.js` → `kbju-{period}-{YYYY-MM-DD}.csv` · `server.py` Content-Disposition — то же · bump `app.js?v=20260901-exportname`
- **Зачем:** Telegram/ОС добавляли `(N)` к одному и тому же имени при повторных скачиваниях
- **LD повторить:** `app.js` → `downloadNutritionCsv` · `server.py` → export filename
- **28kcal прод:** да (`?v=20260901-exportauth`)
- **LD:** сделано (фикс. `kbju-{period}.csv`)
- **Что:** `auth_common.py` → `make_export_download_token` / `verify_export_download_token` · `GET /nutrition/export-token` · `export.csv?token=…` · `downloadApiFile` — в TG: token + `downloadFile`, в браузере: fetch+blob · bump `app.js?v=20260901-exporttoken`
- **Зачем:** blob: URL не открывается в TG WebView; длинный initData в URL обрезался
- **LD повторить:** `auth_common.py`, `server.py`, `app.js` → `downloadApiFile`
- **28kcal прод:** да (`?v=20260901-exporttoken`)
- **LD:** не переносили (LD без initData-auth; `downloadFile` с прямым URL работает)
- **Что:** `nutrition_read.py` → `_period_bounds` (all=365д), все дни периода с нулями · даты `ДД.ММ.ГГГГ` · `export_csv_filename` с timestamp · `export-token` → `{token, filename}` · token embeds stamp · bump `app.js?v=20260902-exportcsv`
- **Зачем:** только дни с едой; Excel парсил ISO; `(31)` в имени файла
- **LD повторить:** `nutrition_read.py`, `auth_common.py`, `server.py`, `app.js` → export
- **28kcal прод:** да (`?v=20260902-exportcsv`)
- **LD:** сделано (все дни + ДД.ММ.ГГГГ; имя без timestamp)

### Экспорт: простое имя файла kbju-{period}.csv
- **Что:** `export_csv_filename` → `kbju-7d.csv` / `kbju-30d.csv` / `kbju-365d.csv` (без timestamp) · bump `app.js?v=20260902-exportname`
- **Зачем:** пользователь хочет фиксированное имя, не `kbju-30d-20260902-084752.csv (31)`
- **LD повторить:** `nutrition_read.py` → `export_csv_filename` · `server.py` export-token/export.csv
- **28kcal прод:** да (`?v=20260902-exportname`)
- **LD:** сделано

### boil_grain: замер гречки 55→175 г
- **Что:** `COOK_MODE_FACTORS['boil_grain']` **1/2.7 → 55/175 ≈ 0.314** · `mini-app/app.js` `COOK_MODES` · bump `?v=20260902-grechka`
- **Зачем:** замер 02.09 — гречка сухая 55 г → готовая 175 г
- **LD повторить:** `api/nutrition_common.py` → `COOK_MODE_FACTORS` · `mini-app/app.js` → `COOK_MODES` · bump `?v=`
- **28kcal прод:** да (`?v=20260902-grechka`)
- **LD:** сделано

### steam_meat: минтай пар 150→108 г
- **Что:** `COOK_MODE_FACTORS['steam_meat']` / `boil_meat` **812/538 → 150/108** · `mini-app/app.js` `COOK_MODES` · bump `?v=20260902-mintai`
- **Зачем:** замер 02.09 минтай пар; треска 190→120 — C1 без повтора, тот же режим `steam_meat`
- **LD повторить:** `api/nutrition_common.py` → `COOK_MODE_FACTORS` · `mini-app/app.js` → `COOK_MODES` · bump `?v=`
- **28kcal прод:** да (`?v=20260902-mintai`)
- **LD:** сделано
- **Осталось замерить (Excel не трогали):** A2–A5 курица/индейка (жарка, жарка+тушение, бедро пар) · B1–B7 мясо/фарш · C1–C5 рыба (C1 треска пар — повтор желателен) · рис/овсянка/другие крупы отдельно от гречки · бобовые `boil_legume` · овощи (низкий приоритет)

## 2026-09-02

### Кэфы готовки: матрица по имени (`COOK_FACTOR_RULES`)
- **Что:** новый `api/cook_factor_rules.py` — id матрицы × матч имени × `cook_mode` → factor (first-match) · `nutrition_common.resolve_cook_factor()` · `COOK_MODE_FACTORS` = **только fallback** (steam 1.25, fry 1.275, grain 1/2.7…) · **замеры в правилах:** A1 грудка пар 812→538 · A2 жарка 420→350 · A3 жар+туш (расчёт A2×stew) · C1 треска пар 190→120 · C3 минтай пар 150→108 · D_grechka 55→175 · D_pasta 101→274 · **остальное по имени с fallback:** A4/A5/A0 птица · B1–B7 мясо/фарш · C2/C4/C0 рыба · D_rice/D_oats/D_grain · L_legume · V овощи · `nutrition_write.py` (`_log_item_name`) · `dishes.py` (имя ингредиента) · `mini-app/app.js` → `resolveCookFactor` + зеркало правил · `api/test_cook_factor_rules.py` · bump `app.js?v=20260902-cookrules`
- **Зачем:** глобальный `steam_meat=150/108` на всю рыбу/птицу — ошибка; замер = строка матрицы, не перезапись режима
- **LD повторить:** `cook_factor_rules.py` (новый файл) · `nutrition_common.py` · `nutrition_write.py` · `dishes.py` · `mini-app/app.js` · `test_cook_factor_rules.py` · bump `?v=20260902-cookrules` · **откатить** глобальные `steam_meat`/`boil_meat`/`boil_grain`/`fry_meat` на fallback, если LD ещё на `mintai`/`grechka`/`frymeat` глобально
- **28kcal прод:** да (`?v=20260902-cookrules`)
- **LD:** сделано

## 2026-09-03

### A5 индейка: жарка 554→463
- **Что:** `api/cook_factor_rules.py` → правило A5 `fry_meat` **fallback 1.275 → 554/463 ≈ 1.197** · `mini-app/app.js` → `COOK_FACTOR_RULES` зеркало · `api/test_cook_factor_rules.py` · bump `app.js?v=20260903-turkeyfry` · пар/варка индейки без изменений (`_FB_STEAM` 1.25)
- **Зачем:** замер 03.09 — индейка сырая 554 г → жареная 463 г
- **LD повторить:** `api/cook_factor_rules.py` (или зеркало в `nutrition_common`) → A5 `fry_meat` = `554/463` · `mini-app/app.js` → `COOK_FACTOR_RULES` · bump `?v=`
- **28kcal прод:** да (`?v=20260903-turkeyfry`)
- **LD:** сделано

## 2026-09-15

### Лента + Яндекс Лавка → food
- **Что:** source=`lenta` (**7820**) + source=`lavka` (**2067**) · миграция `029_food_source_lenta_lavka.sql` · cleanup по аналитике Magnit-style (`etl/retail_cleanup.py`, `_analytics_*.jsonl`) · `etl/lenta/{cleanup,import_food}.py` · `etl/lavka/{cleanup,import_food}.py` · `STORE_LABELS`: `Лента` / `Лавка` · имена `{title} Лента|Лавка` · `READY_MEAL_RETAIL_SOURCES` += `lenta`,`lavka` (suggestedServingGrams для готовой)
- **Зачем:** ритейл-дампы PC/Mac в поиске каталога 28kcal
- **LD повторить:** миграция source CHECK (+`lenta`,`lavka`) · импорт тех же cleaned dumps или синк из `kcal_28.food` · `STORE_LABELS` / display names · при наличии — `READY_MEAL_RETAIL_SOURCES`
- **28kcal прод:** да (миграция `029` + 7820+2067 rows) · UI cache без bump (каталог БД + мелкий API)
- **LD:** сделано

### food: Atwater-fix + VV carbs≈kcal
- **Что:** миграция `030_food_macro_atwater_fix.sql` на `kcal_28.food`: (1) ВВ орехи/снеки — сдвиг полей P←F, F←C, C←kcal → восстановить БЖУ из ккал (**9** строк, напр. Пекан Семушка 740/9.1/72/13.9); (2) «ккал»≈Atwater×4.184 → заменить kcal на Atwater (**~57**); (3) `needs_review=true` где |kcal−Atwater|>200 или сумма БЖУ>110 (**~200** строк)
- **Зачем:** кривые макросы после ритейл-импортов (кДж как ккал; парсер ВВ клал ккал в carbs)
- **LD повторить:** синк **только изменённых** строк в LD `food` (не полный каталог):
  1. Патч в репо 28kcal: `db/patches/030_food_macro_fix/`
  2. Dump: `food_macro_030.jsonl` (**264** строки: КБЖУ + `needs_review`)
  3. Apply на **локальную и прод БД LD**:
     ```bash
     DATABASE_URL=<LD> python ~/Desktop/28kcal/db/patches/030_food_macro_fix/apply.py --dry-run
     DATABASE_URL=<LD> python ~/Desktop/28kcal/db/patches/030_food_macro_fix/apply.py
     ```
  4. Ключ `(source, external_id, variant_key)` · только `UPDATE` · без INSERT · missing в лог ок (если SKU ещё нет в LD)
  5. Код/API LD не менять · UI bump не нужен · EAN не трогаем
- **28kcal прод:** да (`030` уже на Selectel `kcal_28`: review≈200, Пекан 9.1/72/13.9) · UI cache без bump
- **LD:** сделано (прод Selectel: 264/264 UPDATE; Пекан 9.1/72/13.9; needs_review≈199 · локальная БД — docker up, apply отдельно при необходимости)

## 2026-09-23

### B7 фарш: жарка 500→385
- **Что:** `api/cook_factor_rules.py` → B7 `fry_meat` **fallback 1.275 → 500/385 ≈ 1.299** · `fry_stew_meat` = `(500/385)×(1/0.85)` · `mini-app/app.js` → `COOK_FACTOR_RULES` · `api/test_cook_factor_rules.py` · bump `app.js?v=20260923-farshfry` · пар/тушение фарша без изменений
- **Зачем:** замер 23.09 — фарш сырой 500 г → жареный 385 г
- **LD повторить:** `api/cook_factor_rules.py` → B7 `fry_meat` = `500/385`, `fry_stew_meat` = `(500/385)×(1/0.85)` · `mini-app/app.js` → `COOK_FACTOR_RULES` · bump `?v=`
- **28kcal прод:** да (`?v=20260923-farshfry`)
- **LD:** сделано
