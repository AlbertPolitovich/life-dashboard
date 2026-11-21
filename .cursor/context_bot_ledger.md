# Ledger — контекст

> App: **`@.cursor/context_bot_miniapp.md`** · Финансы: **`@.cursor/context_bot_finance.md`**

**Прод:** https://dash.svodbot.ru/mini-app/ · локально: http://127.0.0.1:8765/mini-app/

**Cache-bust (из `mini-app/index.html`):** `ledger.js?v=20261012-tax-years-only` · `styles.css?v=20261012-transport-tax` · `app.js?v=20260926-odometer-url` (общий бандл / odometer PATCH)

**Деплой:** `./deploy/deploy-dual.sh selectel` · bump `?v=` в `index.html`

---

## Сделано недавно (октябрь 2026, не откатывать)

### Audi · транспортный налог

- Sub_bucket **`transport_tax`** (consumables) — отдельно от топлива/`misc`.
- Миграция данных **`031_ledger_transport_tax.sql`**: разнос 11.2024 и 12.2025; **не** создавать `finance_transactions` на эти суммы (уже в Финансах внутри «Разное» — лишние ft ломают carryover / `/finance/month`).
- UI: подпись «Транспортный налог», график по годам (`transportTaxYearly`), эвристика inbox/подсказки по тексту «транспортный налог».
- Код: `api/ledger_common.py`, `ledger_read.py`, `mini-app/ledger.js`.

### Техника · одометр

- `PATCH /ledger/car/tech/odometer?assetId=` · UI «Сейчас на спидометре» · через `apiPatchJson` из `app.js`.

---

## Сделано недавно (июль 2026, не откатывать)

### Home · «Распределить» → Inbox

- Кнопка **`#ledgerAllocateBtn`** и строка **`#ledgerInboxRow`** → `openInbox("inbox")`.
- **Симптом:** вело в **Обзор · Сапроново**, не в Inbox.
- **Причина:** `onScreenChange` → `updateLedgerTabFromScroll()` при scroll=0 сбрасывал вкладку до загрузки.
- **Фикс:** `pendingDetailTab` — целевая вкладка до `refreshDetail()`; scroll-spy не трогает вкладку, пока pending; после загрузки — `scrollToLedgerSection("inbox")`.

### Inbox · скрыть трату

- Крестик **×** у строки inbox → `POST /ledger/inbox/dismiss` `{ financeTransactionId }`.
- Таблица **`ledger_inbox_dismissed`** (миграция **007**); транзакция в Финансах остаётся.
- После dismiss: `renderInboxList` + `loadHome({ fresh })`.

### Графики · ось до текущего месяца

- Помесячные бары (ремонт, кварплата, авто): **`padMonthlyThroughCurrent`** — янв…текущий месяц, нули если нет трат.
- Подсветка текущего месяца: **`ledgerMonthChartOpts`** → `highlightMonth` в `renderFinanceMonthlyBars`.
- **Важно:** график = только **распределённые** `ledger_allocations`; новая трата из Финансов сначала в **Inbox**.

### Финансы → Ledger

- **`LifeLedger.onFinanceChange()`** — после сохранения/удаления txn в `finance.js`: `loadHome` + `refreshDetail` если открыт ledger.
- Inbox-slug: **`ipoteka` · `dom_remont` · `kvartplata` · `avto`** — **`technika` не в inbox** (не ledger).

### Home · период баланса

- Сегмент **`год / мес`** · `balanceMode` → `localStorage`.
- KPI 2 плитки по центру; отступы как у финансов.

---

## Inbox · finance → ledger

| slug | asset | bucket |
|------|-------|--------|
| ipoteka | sapronovo | mortgage (+ тип) |
| dom_remont | sapronovo | repair |
| kvartplata | sapronovo | kvartplata |
| avto | audi | consumables / service |

- Inbox: `manual`, без полного распределения, не в `ledger_inbox_dismissed`.
- Удаление txn в Финансах → CASCADE allocations (**012**).

---

## Данные · объекты

| Объект | buckets |
|--------|---------|
| Сапроново | mortgage · repair · misc · kvartplata |
| Audi | service · consumables (`fuel` · `misc` · **`transport_tax`** · …) · loan |

Правда: `ledger_allocations` (`ledger_import` + `finance_link` + `manual`).

---

## API · UI

| GET | `/ledger/inbox` · `/allocations` · `/apartment/summary` · `/car/tech` · … |
| POST | `/ledger/allocations` · **`/ledger/inbox/dismiss`** |
| PATCH | `/ledger/allocations/{id}` · **`/ledger/car/tech/odometer`** |

Код: `api/ledger_*.py` · `ledger.js`

**detailLedger:** сквозной скролл; авторефresh **выкл**.

---

## Ранее (не откатывать)

Ипотека −20% / досрочка · страховка в inbox · кварплата 2026 manual VPS · ипотека UI без «Сверено с банком».

---

## Очередь (по нужде)

- Сверка ипотеки с банком · UI при платеже > +20%
- Audi: split allocation · loan UI

---

## Новый чат

```
@.cursor/context_bot_ledger.md
@.cursor/context_bot_finance.md
@.cursor/context_bot_miniapp.md
```
