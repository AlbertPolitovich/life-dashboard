# TG Mini App — визуал (актуально, июнь 2026)

> Поведение, API, навигация: **`@.cursor/context_bot_miniapp.md`**  
> Финансы (эталон второго модуля под home): **`@.cursor/context_visualization_finance.md`**  
> КБЖУ: **`@.cursor/context_bot_kbju.md`** · SQL: **`@.cursor/context_bot_to_sql.md`**  
> Дневник (очередь): **`@.cursor/context_visualization_diary.md`** · промпт UI: **`@.cursor/prompt-mini-app-diary-ui.md`**

Код: `mini-app/index.html`, `styles.css`, `app.js`, `finance.js`, `charts.js`, `diary.js`  
Cache-bust: смотри актуальные `?v=` в `mini-app/index.html` и `context_bot_miniapp.md`.

---

## Статус UI (реализовано)

| Область | Состояние |
|---------|-----------|
| Home `#dashboardZone` | ✅ KPI 2×2, «Заполнить», КБЖУ, финансы |
| KPI Продуктивность / Спорт | ✅ `›` → детали, данные `/week` |
| KPI Рутина / Спорт-метрика | ✅ свайп ←→, 3 точки, localStorage |
| fill утро | ✅ вчера (routine) + сегодня (sport), онбординг 3 шага |
| fill история | ✅ свайп дня, вкладки Продуктивность \| Спорт |
| detailProductivity | ✅ полоска, radar, 8 сфер (plain bars) |
| detailSport | ✅ полоска, 4 цветных блока метрик |
| detailNutrition | ✅ свайп дня, приёмы, экспорт CSV |
| detailFinance | ✅ см. `context_visualization_finance.md` |
| **Дневник** | ✅ см. `context_visualization_diary.md` |

---

## Дизайн-токены (`styles.css` :root) · refresh 2026-11-25

| Токен | Значение |
|-------|----------|
| `--bg` / `--chrome` | `#F2F4F7` (светлая палитра зафиксирована) |
| `--text` | `#1a1a1a` |
| `--hint` | `#6B7280` |
| `--link` / `--btn` | `#3685bf` |
| `--card` | `#FFFFFF` |
| `--border` | `rgba(17,19,23,0.1)` |
| `--track` | `#E5E9F0` — треки KPI/КБЖУ |
| `--header-bg` | `#111317` графитовая шапка |
| `--green` / `--yellow` / `--red` | `#1f8a65` / `#d4a017` / `#cf2d56` |
| `--header-bar-h` | `50px` (+ safe-area; TG fullscreen — динамика) |
| `--cta-h` | `48px` (главная «Заполнить») |
| `--pad-x` | 16px |

**Шапка Home:** мини-герб + `tim710`. **CTA:** одна синяя на Home; дневник/ledger — `cta-btn--secondary`.

**Прогресс KPI:** зелёный ≥50%, жёлтый ≥25%, красный <25%.

**Общие паттерны:** tap ≥44px · section label 10–11px uppercase · карточки radius 12 · tabular-nums · safe-area + `theme-color #111317`.

---

## Home — wireframe (как в коде)

```
[‹]  Life Dashboard                    Июнь     ← app-header, bg --link
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 progress-zone (chrome #F8F8F8, full-bleed)
  ИЮНЬ 2026                                    ← progress-zone__label 10px

  ┌──────────────┐  ┌──────────────┐
  │ 42%      ›   │  │ 180      ›   │           ← kpi-card, value 19px bold
  │ Продуктивн.  │  │ Спорт        │           ← title 11px
  │ 12/28 · 8–14 │  │ 180/420 мин  │           ← sub 10px
  │ ████░░ 4px   │  │ ████░░       │           ← mini-bar
  └──────────────┘  └──────────────┘
  ┌──────────────┐  ┌──────────────┐
  │ 6/8      ‹›  │  │ 45 км    ‹›  │           ← swipe cards, 3 dots
  │ Рутина       │  │ Cycling      │
  │ Вчера        │  │ Июнь 2026    │
  │ ████░░       │  │ ██░░░░       │
  │  ━ ━ ━       │  │  ━ ━ ━       │
  └──────────────┘  └──────────────┘

  [        Заполнить        ]                  ← cta-btn home-fill-btn

  ┌─ КБЖУ · СЕГОДНЯ ─────────────────────┐   ← nutrition-zone
  │ [К][Б][Ж][У] 4px bars + 8px labels    │
  └───────────────────────────────────────┘

  [ баннер плана финансов — с 20-го числа ]    ← finance-plan-banner

  ┌─ ФИНАНСЫ                          › ─┐   ← finance-zone__card
  │ Баланс с начала года                   │
  │ 125 400 ₽                    [год]     │   ← toggle год/мес
  │ ─────────────────────────────────────  │
  │ ● Ипотека через 5 дн. · 64 000 ₽      │   ← reminder (опц.)
  │ ─────────────────────────────────────  │
  │ [ − Расход ]    [ + Доход ]            │
  └────────────────────────────────────────┘

  ┌─ ДНЕВНИК … ───────────────────────────┐   ← diary-zone (см. diary docs)
  └────────────────────────────────────────┘
  ┌─ LEDGER … ────────────────────────────┐
  └────────────────────────────────────────┘

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Порядок блоков на home (сверху вниз):** месяц-label → KPI 2×2 → «Заполнить» → КБЖУ → финансы → дневник → ledger.

**Отступы между зонами:** `margin-top: 8px` у КБЖУ, finance-zone, будущего diary-zone.

---

## KPI-карточки

| # | Карточка | Интеракция | Цикл свайпа |
|---|----------|-----------|-------------|
| 1 | Продуктивность | tap → `detailProductivity` | — |
| 2 | Спорт | tap → `detailSport` | — |
| 3 | Рутина | свайп | Вчера → Неделя → Месяц |
| 4 | Спорт-метрика | свайп | Cycling км → Run км → Workout мин |

- Классы: `.kpi-card`, `.kpi-card--swipe`, `.kpi-card__swipe-dots` (12×3px, active 16px `--link`).
- Chevron `›` только на карточках 1–2.

---

## Fill — wireframe

### Утро (`#fillMorning`, default)

```
[‹ Заполнить]              [Другой день]      ← header action

(онбординг ①→② — только первый визит)

┌ ИТОГ ВЧЕРА ─────────────── [Вчера] ─┐
│ ПРОДУКТИВНОСТЬ · 5/8                 │
│  сетка 2×4 чипов-сфер (toggle)       │   ← routine-grid, не B..I порядок
└──────────────────────────────────────┘
──────── divider ────────
┌ ТРЕНИРОВКА ────────────── [Сегодня] ─┐
│ разминка → растяжка → вело → …       │   ← sport-fields блоки
└──────────────────────────────────────┘

[ Сохранить ]  sticky                         ← saveMorningFill
```

### История (`#fillHistory`)

```
[‹ Другой день]

┌ Вчера ─── ‹ › ─── ┐  ← fillHistoryDayStrip (старт = вчера, не сегодня)
└────────────────────────────────────────────┘
[ Продуктивность | Спорт ]                    ← segmented
… форма одного дня …
[ Сохранить день ]
```

**CTA состояния:** default синий · saving серый · success зелёный «Сохранено ✓» · error оранжевый.

---

## Детали — общие паттерны

| Экран | Верх | Контент |
|-------|------|---------|
| Продуктивность | `[Неделя \| Месяц]` + `#productivityStrip` (свайп ±7д / ±1мес) | radar + 8 plain bars `--link` |
| Спорт | `[Неделя \| Месяц]` + `#sportStrip` | 4 блока `sport-metric` с цветным акцентом |
| КБЖУ | `#nutritionDayStrip` (свайп дня) | bars + meal-list + export |
| Финансы | 3 кнопки месяца + 4 вкладки | см. finance doc |

**Полоска периода:** `.progress-strip`, padding 12×14, radius 12, свайп = `.progress-strip--swipe` + 3 точки.

---

## Модули под home (эталоны для новых зон)

### КБЖУ — компактная строка-карточка

- Вся зона — одна кнопка `.nutrition-zone`.
- Label: `КБЖУ · СЕГОДНЯ` (9px uppercase).
- Превью: 4 горизонтальных бара в ряд (4px), подписи К/Б/Ж/У 8px.
- Tap → `detailNutrition`.

### Финансы — развёрнутая карточка

- Обёртка `.finance-zone`, внутри `.finance-zone__card`.
- Head: label + chevron → detail.
- Крупное число 24px + вторичные действия внизу.
- Отдельный баннер над карточкой (план).

**Для дневника:** выбрать между этими двумя паттернами — см. `context_visualization_diary.md` (2 варианта home).

---

## Microcopy (актуально)

| Элемент | Текст |
|---------|-------|
| Home CTA | `Заполнить` |
| Fill утро CTA | `Сохранить` / `Сохранено ✓` |
| Fill история CTA | `Сохранить день` |
| Fill header history | `Другой день` |
| Routine counter | `ПРОДУКТИВНОСТЬ · N/8` |
| Error badge | `Ошибка — Повторить` |
| Nutrition label | `КБЖУ · Сегодня` |
| Finance label | `Финансы` |

---

## Исторические концепты (не код)

Ранние canvas `tg-mini-app-concept`, `tg-mini-app-health-style` — Donut Rings, Timeline Strip, 4×2 routine grid.  
**В проде:** Health Cards 2×2 + отдельный fill (не tabs на home). Не возвращать без запроса.

---

## Очередь визуала (по нужде)

| # | Задача |
|---|--------|
| 1 | Финансы — PATCH txn в UI / мелкая полировка sheet (эталон = прод) |
| 2 | Action-кнопки хедера в fullscreen TG |

Дневник на home/calendar/editor — **уже в проде** (см. `context_bot_diary.md`).
