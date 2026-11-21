# 28kcal / FitBite — сжатый контекст

> `~/Desktop/28kcal` · TG Mini App · FastAPI + Postgres + mini-app JS  
> VPN/Selectel: `context_bot_freakingWG.md` (**не ломать** Amsterdam)  
> Методика КБЖУ: `Методика расчета КБЖУ.rtf` · матрица rest/workout/cycling/running

> **Крайнее: 16.08** — cookKind по названию (филе куриное) · `?v=20260816-cook-name1`.  
> **Прод:** rsync 16.08 · `kcal28-api` · `018`…`020` · cache `?v=20260816-cook-name1`  
> **Лок. cache:** JS/CSS `?v=20260816-cook-name1`  
> Миграции прод `001`…`020`.

## Быстрый статус (16.08.2026)

### Прод (Selectel)

| Что | Значение |
|-----|----------|
| Домен | `https://fitbite28.ru/` · mini-app `/mini-app/` · health `/health` |
| Бот | `@fitbite28bot` |
| VPS | `161.104.47.52` (`meadow`) · код `/opt/28kcal` |
| API | `:8766` · systemd `kcal28-api` · env `/opt/28kcal/api/.env` |
| Caddy | `fitbite28.ru` → `:8766` (рядом `dash.svodbot.ru` → `:8765`) |
| БД | `life_dashboard_pg` · `kcal_28` / user `kcal` |
| Auth | `ALLOW_DEV_AUTH=0` + `TELEGRAM_BOT_TOKEN` |
| Миграции | `001`…`020` |
| Cache | JS/CSS `?v=20260816-cook-name1` |

### Локально

- UI `http://127.0.0.1:8765/mini-app/?v=20260816-cook-name1` · API `:8765` (`api/run.sh`)
- БД `127.0.0.1:5433` · `ALLOW_DEV_AUTH=1`, `DEV_USER_ID=1`
- После JS/CSS — bump `?v=` в `mini-app/index.html`
- `run.sh`: uvicorn `--reload` + exclude `node_modules` / `.venv` / `__pycache__`
- Если `:8765` мёртвый — часто чужой `python -m http.server`; `lsof -i :8765`
- Cache: `?v=20260816-cook-name1` · `018`…`020` на `kcal_28_pg`

### Каталог `food`

perekrestok **10141** · vkusvill **5846** · generic **767** · Σ **16754** · categories **25**.  
SKU нет в БД = не было в scrape (не «вырезали»). Пример: Перек `52888` филе куриное.

**Дельта мясо 09.08:** +111 SKU, `food.id` **36704–36814**, ключ `(source='perekrestok', external_id)`. Манифест `etl/perekrestok/fixtures/meat_delta_added.jsonl` · скрипт `import_meat_delta.py`. Пример: `external_id=3095298` → `food_id=36715`.

## Auth

- `users.id` SERIAL ≥1 (не telegram_id); прод: initData → upsert по `telegram_id`
- Лок без TG: только `DEV_USER_ID` при `ALLOW_DEV_AUTH=1`
- CSV: `?tgWebAppData=` · `apiUrl()` дописывает initData

## Данные

- Каталог `food`+`food_categories` · кастомы `products` (`food_id IS NULL`)
- Лог `nutrition_log` XOR product/food (`013`) · prefs порций · meta избранное/заметки (`014`)
- Цели: `user_daily_targets` + кастом `user_activity_targets` · дельты `nutrition_targets` (`015`)
- Типы дня: `rest` `office` `workout` `cycling` `running` `walk` + physio `pregnancy`/`lactation`
- `fiber` — в API/БД/28score; **в UI ввода нет** (create → 0, edit сохраняет старое)
- Блюда: `products.is_dish` + `dish_items` (`018`); stub `recipes` удалён (`019`)

## Норма КБЖУ

База = **отдых**, не full TDEE `very_active`.

- Mifflin × `REST_NEAT` (~1.15–1.25) × цель (`lose` **0.90** / maintain / gain 1.10)
- Белок г/кг (lose 2.2) · жир 1.15 г/кг · угли добивка · floor углей отдыха **≥120**
- Тренировки = дельты `nutrition_targets` · ккал = `4Б+9Ж+4У`
- Кастомы дней **не** чистятся при `PUT /me/profile` (только онбординг / явный сброс)

## Свежие (14.08) · воронка Базовая норма → 28 Pro

**Смысл:** базовая норма = обычный день без тренировки. Свои БЖУ по залу/бегу/вело — 28 Pro.

**Карточка профиля:** подзаголовок «Обычный день без тренировки» · тап → шит нормы · «Изменить норму» тоже.

**Шит базовой нормы:**
- шапка: «Базовая норма» + круглая SVG-кнопка пересчёта (две стрелки) → параметры (бывш. «Рассчитать автоматически»)
- слайдеры rest
- внизу (если не Pro): синяя `cta-btn` **«Кастомные таргеты»**, `i` **внутри** кнопки (как Беременность)
- `i` текст: «Свои значения белков, жиров и углеводов для зала, бега, вело и других дней.»
- тап по кнопке → шит 28 Pro; тап по `i` → info sheet

**Плашка под карточкой (бесплатные):** «Подключить 28 Pro» + тезисы:
- Кастомные БЖУ под зал, бег, вело и другие дни
- Беременность и лактация по ВОЗ
- Создание и подсчет собственных блюд
- Экспорт дневника: 7, 30, 365 дней

**Шит 28 Pro:** короткий lead (Ильяхов) + mock «Как это выглядит» (подпись: «Тап по строке — свои значения белков, жиров и углеводов») + те же 4 тезиса + «Подключить 28 Pro» / «Не сейчас». Длинный абзац убран.

**Stub:** `state.isPro` только в памяти (без localStorage). Unlock (dev: кнопка / double-tap physio) → аккордеон дней + CSV + physio.

## Свежие (16.08) · Жарка в дневнике (мясо/рыба)

**Статус:** на прод · cache `?v=20260816-pro-dishes1` · миграция `020`.  
Для `cookKind=meat_fish` в «Как взвешиваешь» добавлен чип **Жареный** (`fry_meat`, фактор **1.275**) — как у блюда.  
Жарка → поле масла (`oilGrams`); ккал/жир += масло×9 / масло г.  
БД: `nutrition_log.oil_grams` + `cook_mode` допускает `fry_meat` (`020_nutrition_log_fry_oil.sql`).  
API: `POST`/`PATCH /nutrition/log` принимают `oilGrams`; день/строки учитывают масло (`apply_fry_oil_macros`).  
UI: масло на шите добавления/правки и на карточке записи дневника (`#productDishOilBlock`).

## Свежие (16.08) · Заметка в блюде

**Статус:** на прод · cache `?v=20260816-pro-dishes1` (было `dish-note1`).  
В конструкторе (create/edit) поле **Заметка** под preview КБЖУ (`N ккал · Б … / 100 г`) и **над** кнопкой сохранить.  
Placeholder: «Здесь вы можете записать состав и количество ингредиентов вашего блюда» (не «пряник»).  
`note` уходит в `POST`/`PUT /nutrition/dishes` → `user_item_meta` (`_save_dish_note`); `GET`/`create`/`update` отдают `note` в `product`.  
На карточке сохранённого блюда тот же placeholder; у обычных продуктов — «Например: 1 пряник…».

## Свежие (14–15.08, прод) · Блюда

**Статус:** на прод · cache `?v=20260816-pro-dishes1`.  
Миграции `018_dishes` / `019_drop_recipes` / `020_nutrition_log_fry_oil` на прод.

### Суть модели

Блюдо = смешать ингредиенты (сырой/сухой вес) + способ готовки **всего блюда**. Готовка меняет **выход** (готовый вес), не белок. КБЖУ — от сырого (+ масло при жарке). Снимок КБЖУ в `products` (`is_dish`, вкладка «Мои», бейдж «блюдо», `cook_kind` NULL). Состав — `dish_items`: XOR `food_id` / `ingredient_product_id`, `grams` = сырой, `cook_mode`, `oil_grams`. Блюдо как ингредиент нельзя. В дневник блюдо логится `cook_mode=plain` (КБЖУ уже в снимке /100 г готового). Stub `recipes` удалён (`019`).

### Дневник vs блюдо (не смешивать)

| | Дневник | Конструктор блюда |
|---|---|---|
| Меню | «Как взвешиваешь» | **«Как готовишь блюдо»** (segmented на шите сборки) |
| Граммы | что на весах (сырое **или** уже готовое) | **всегда** сырой/сухой в кастрюлю |
| Фактор | `weighed × factor` → учётные → КБЖУ | КБЖУ от сырого; выход = `сырой / factor` |
| Жарка | **Жареный** у мяса/рыбы + масло (`oil_grams`, `020`) | на шите блюда; масло одно поле |
| Хинты | «вес уже сваренных / пожаренного» | нет (лейблы способов) |

### Где в UI

Продукты → чипы **Недавние · Избранные · Мои** → поиск → синяя «Добавить продукт» · зелёная «Создать блюдо». Create без Pro → paywall (double-tap physio = unlock). Карточка блюда без «Изменить КБЖУ».

### Сборка (create / edit)

- Шит 2 шага: имя → сборка. Карандаш на шаге 2 правит имя **без wipe** ингредиентов; Back шага 2 → имя без wipe; wipe только при закрытии шита.
- Поиск ингредиентов = как в Продуктах (мои → каталог магазинов → готовые + избранные ★).
- Список: имя без магазина/ООО (`diaryDisplayName`), `N г · ккал`, ×.
- **«Как готовишь блюдо»** — segmented как «Как взвешиваешь» (`segmented--cook`): **Сырой · Запечённый/на пару · Варёный · Тушёный · Жареный**. Жарка → поле масла. Режим → всем ингредиентам; масло один раз (`oil_grams` на первом item при save).
- Тап / добавление ингредиента → карточка продукта: **только граммы** («Вес сырого/сухого»). **«Как готовишь» на карточке ингредиента нет.** Кнопка **«Добавить · {название блюда}»** → назад в конструктор. Второго шита граммов нет.
- Yield readonly = сумма выходов (+ масло при жарке). Preview КБЖУ /100 г готового.
- **Заметка** (`#dishCreateNote`) между preview и save; сохраняется вместе с блюдом в meta.

### Правка уже сохранённого

- На карточке блюда: янтарная **«Изменить состав»** (`.cta-btn--dish-edit`, над удалением) → шит сборки с составом.
- Delete: **«Удалить блюдо»** / confirm «Удалить блюдо из базы?» (у продукта — «Удалить продукт»).
- Закрытие без save = откат черновика. Save → `PUT /nutrition/dishes/{id}`.
- Pro-гейт **только** на «Создать блюдо»; на edit состава — нет.

### API

- `POST /nutrition/dishes` · `GET /nutrition/dishes/{id}` · `PUT /nutrition/dishes/{id}` (опц. `note`)
- `dishes.py`: `create_dish` / `get_dish` / `update_dish` · `_resolve_dish_body` · `_replace_dish_items` · `_save_dish_note`

### Расчёт

- Ввод = сырой/сухой; `dish_item_macros` = сырой×база/100; масло 9 ккал/г + жир только при `fry_meat`.
- Выход = `сырой / COOK_MODE_FACTORS` (+ масло в массу при жарке); снимок = totals/yield×100.
- Фактор жарки **1.275**; дневник `normalize_diary_cook_mode` режет `fry_meat` → `plain`.
- `is_dish` → infer `cook_kind` выкл., «Как взвешиваешь» скрыт.

### UX-мелочи

- Бейдж `.product-dish-tag` «блюдо»; `[hidden] { display:none !important }`.
- 28score на карточке ингредиента: проброс `bjuScore`/`bjuTier`; `.product-bju-line[hidden] { display:none !important }`.
- Ккал шапки: режим 100 г → «N ккал на 100 г».
- Bottom-nav скрыт на `detailNutritionProduct` (+ sheet-open / `[hidden]`).

### Файлы / тесты

- `api/dishes.py` · `server.py` · `nutrition_common.py` (`cooked_grams_from_raw`) · `018_dishes.sql` · `019_drop_recipes.sql`
- UI: `mini-app/app.js` · `styles.css` · `index.html` · cache **`?v=20260816-pro-dishes1`**
- Тесты: `api/test_dishes.py`

## Профиль · physio (12.08, прод)

**Параметры · Цель:** Похудеть/Держать/Набрать · ряд **Беременность | Лактация** (тег `28 Pro`, `i` внутри). Тап → триместр I/II/III или 0–6 / 6+. Бесплатным: тап → шит Pro; **double-tap** = unlock + меню.

**БД `017`:** `physio_mode` / `pregnancy_trimester` / `lactation_phase`; kinds `pregnancy`/`lactation`.

**Таргеты FAO/WHO** к базе отдыха: бер. +85/+285/+475 ккал (+1/+10/+31 г белка); ГВ +505/+20 (0–6) или +400/+15 (6+).

**Активность:** 🤰/🍼 только если physio выбран. Sticky: нет записи сегодня → последний `day_activity` (не сброс в Отдых).

## Продукты

Порядок UI: чипы **Недавние · Избранные · Мои** → строка поиска → ряд кнопок: синяя «Добавить продукт» · зелёная «Создать блюдо». Поиск: ILIKE + транслит → `food_synonyms` → AND. Строка поиска живёт при смене чипов (11.08).

**Свои → готовка (12.08 / фикс 16.08):** `infer_cook_kind_from_name` — мясо/рыба/крупа/паста/бобовые. JS: `\b` не видит кириллицу → границы `(?<![а-яёa-z0-9])`; `курин` ловит «куриное». Порядок: pasta → meat_fish → legume → grain. Каталог без `cook_kind` категории тоже через имя (`catalog_row_to_api`). Tip `i` у «Название»; авто 3 раза → пауза 7д. **Блюда (`is_dish`) — infer выключен.**

## Дневник

КБЖУ каталога = сырое/сухое на 100 г. Sheet: **«Как взвешиваешь»** по `cookKind` (`COOK_UI_BY_KIND` — «вес с весов, сырой или уже готовый»). API `grams` = weighed + `cookMode` (+ `oilGrams` при `fry_meat`); БД `weighed_grams` + `cook_mode` + `oil_grams` (`016`/`020`), `grams` = учётные (`weighed × factor`). Строка: `N г · M ккал`, тап по всей строке. **Мясо/рыба:** Сырой · Запечённый/на пару · Варёный · Тушёный · **Жареный** (+ масло). **Не путать с блюдом** (глава выше).

Карточка: кол-во × размер порции · тогл «на 100 г / на N г» · **Сохранить** → PATCH. Из базы — «Добавить».

Навигация дней: тап-зоны ‹ › (свайп дня убран). DnD между приёмами: long-press ~380 ms → `PATCH mealGroup`. TG: `disableVerticalSwipes()`.

## Деплой (только Selectel)

```bash
cd ~/Desktop/28kcal
rsync -avz --delete \
  --exclude '.venv' --exclude '__pycache__' --exclude '*.pyc' --exclude '.env' \
  --exclude 'node_modules' --exclude 'etl' --exclude '.cursor' --exclude '.git' \
  ./ root@161.104.47.52:/opt/28kcal/
ssh root@161.104.47.52 'systemctl restart kcal28-api && sleep 1 && curl -sS http://127.0.0.1:8766/health'
# миграции БД (контейнер life_dashboard_pg):
# docker exec -i life_dashboard_pg psql -U kcal -d kcal_28 < db/migrations/018_dishes.sql
# docker exec -i life_dashboard_pg psql -U kcal -d kcal_28 < db/migrations/019_drop_recipes.sql
# docker exec -i life_dashboard_pg psql -U kcal -d kcal_28 < db/migrations/020_nutrition_log_fry_oil.sql
```

Ловушки: Amsterdam не трогать · bump `?v=` · переоткрыть миниап в TG · пол → BMR · cook=`016` · physio=`017` · блюда=`018`/`019` · жарка дневник=`020`

## Остаток

- [x] cutover · поиск · избранное · Мои · create 2-step · NEAT/`015` · DnD · cook/`016` · physio/`017`
- [x] воронка «Базовая норма → 28 Pro» · **прод 14.08** `?v=20260814-base-pro9`
- [x] Блюда 14–15.08: create/edit · готовка на шите · карточка ингредиента без cook · `GET`/`PUT`/`POST` dishes · **прод** `?v=20260814-dishes31`
- [x] Заметка в конструкторе блюда (под КБЖУ / над save) · **прод 16.08** `?v=20260816-dish-note1`
- [x] Жарка в дневнике (мясо/рыба + масло) · **прод 16.08** `?v=20260816-diary-fry1` · `020`
- [x] Тезис 28 Pro «Создание и подсчет собственных блюд» · **прод 16.08** `?v=20260816-pro-dishes1`
- [x] cookKind по названию (филе куриное / кириллица `\b`) · **прод 16.08** `?v=20260816-cook-name1`
- [ ] Stars · кнопка **«Попробовать 28 Pro»** · **7 дней бесплатно** → потом оплата · Menu Button → fitbite28.ru/mini-app/
- [ ] revoke токена/пароль БД · UI клетчатки
- [ ] чипы «Как взвешиваешь» по роду в `name` (Сухие/Варёные…) — факторы `cookMode` не трогать

## Файлы

- API: `auth_common.py` `server.py` `user_write.py` `user_read.py` `targets_calc.py` `activity_targets.py` `day_resolve.py`
- Nutrition: `nutrition_write.py` `nutrition_read.py` `nutrition_common.py` `catalog_read.py` `dishes.py` `test_dishes.py`
- Day kinds: `lib/day_kind.py`
- UI: `mini-app/app.js` · `styles.css` · `index.html` (лок./прод `?v=20260816-cook-name1`)
- Миграции: `016` cook · `017` physio · `018` dishes · `019` drop recipes stub · `020` diary fry/oil

## На будущее · 28 Pro trial (14.08)

«Подключить 28 Pro» → **«Попробовать 28 Pro»**. 7 дней весь Pro (кастомные таргеты, physio, CSV), потом просьба оплатить (Stars). Хранить `pro_trial_started_at` / `pro_until` в БД; проверка на API; paywall вместо stub `state.isPro` в памяти.
