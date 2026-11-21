# Промпт: Финансы — План → Обзор → Ввод

Скопируй блок ниже в **новый чат**.

**Контекст (прочитать первым):**
- **`@.cursor/context_visualization_finance.md`** — актуальный UI (метрики, категории, план)
- **`@.cursor/context_bot_finance.md`** — решения и API
- **`@.cursor/context_bot_miniapp.md`** — не ломать KPI 2×2, fill, КБЖУ
- **`finance-mockup.canvas.tsx`** — визуальный эталон

**Запуск:** `docker compose up -d` → `cd api && ./run.sh` → http://127.0.0.1:8765/mini-app/

---

## Блок для агента

```
@.cursor/context_visualization_finance.md
@.cursor/context_bot_finance.md
@.cursor/context_bot_miniapp.md
@.cursor/prompt-mini-app-finance-continue.md

Life Dashboard Mini App — модуль **финансов**. Метрики, Категории (план/факт), План и напоминания готовы — см. context_visualization_finance.md.

Паттерны: vanilla JS, `window.LifeFinance`, `finance.js`, `charts.js`, cache-bust `?v=` в index.html, минимальный diff.

## Шаг A — Вкладка План (мелкая полировка)

Сначала только План. Не ломать:
- открытие на **следующий** месяц;
- при уходе с Плана на другие вкладки → **текущий** месяц;
- «Будущий месяц», итоги Доход|Баланс|Расход, сохранение 0 ₽ по всем категориям.

### Проверить / довести

1. Визуал формы — как мокап экран 4 (`finance-mockup.canvas.tsx`): белые/групповые подложки, отступы, читаемость 25 категорий.
2. Доходы — те же 5 источников, что в sheet; при необходимости выровнять порядок/подписи с мокапом.
3. UX сохранения: обратная связь «Сохранено», префилл из M−1 без автозаписи до Save.
4. Опционально (если быстро): **П1** — мини-бары план/факт **на вкладке План** (сейчас только на Категориях) — только если не раздувает diff.

**Не делать в шаге A:** Обзор, sheet, PATCH, home-виджет.

---

## Шаг B — Вкладка Обзор

После A (или отдельным коммитом). Эталон: мокап **экран 2a**.

1. Карточки **Доходы** / **Расходы** — `var(--card)`, заголовок + сумма справа, мини-бары по источникам/группам.
2. Стрип **Баланс месяца | YTD** — цвет по знаку.
3. **Баланс по месяцам** — 4 бара, `янв`… под столбцами (уже есть `renderFinanceBalanceBars`).
4. «Все категории →» ведёт на вкладку **Категории** (не Метрики).

API: `GET /finance/month?month=YYYY-MM`.

---

## Шаг C — Ввод расходов и доходов

После B. Эталон: мокап **экран 3** (bottom sheet).

1. Полировка `#financeTxnSheet`: сумма, chips, «Ещё», дата, заметка (доход), `Сохр.+ещё` / `Готово`.
2. **PATCH** транзакции в UI (API есть: `PATCH /finance/transactions/{id}`) — редактирование из списка на вкладке Категории (tap → список).
3. Home `− Расход` / `+ Доход` — тот же sheet; после сохранения обновлять виджет.

**Не трогать:** логику месяца на вкладке План, метрики, nutrition, fill.

---

## Проверка

```bash
curl -s "http://127.0.0.1:8765/finance/month?month=2026-06" | python3 -m json.tool | head -40
curl -s "http://127.0.0.1:8765/finance/plan?month=2026-07" | python3 -m json.tool | head -30
curl -s "http://127.0.0.1:8765/finance/ytd?year=2026" | python3 -m json.tool | head -30
```

Браузер: http://127.0.0.1:8765/mini-app/ · detailFinance · Cmd+Shift+R.

## Формат работы

1. Прочитай context_visualization_finance.md + открой finance-mockup.canvas.tsx.
2. Шаг A → краткий отчёт → спроси или переходи к B.
3. Минимальный diff; обнови cache-bust при смене css/js.
```

---

## Быстрый старт

```
@.cursor/context_visualization_finance.md
@.cursor/prompt-mini-app-finance-continue.md

Шаг A: полировка вкладки План под мокап.
```
