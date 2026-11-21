# Финансы — контекст (UI + бэкенд)

> Mini-app: **`@.cursor/context_bot_miniapp.md`** · Сжатый статус: **`@.cursor/context_bot_finance.md`**  
> Код: `mini-app/finance.js`, `mini-app/charts.js`  
> **Эталон UI = прод / текущий код.** Canvas-мокапа нет (был набросок дизайна, файла `finance-mockup.canvas.tsx` нет) — не искать и не «полировать под мокап».

**Прод не трогать без запроса.** `docker compose up -d` → `cd api && ./run.sh` → http://127.0.0.1:8765/mini-app/  
Cache-bust (актуально): `finance.js?v=20260821-export-name` в `index.html`.

---

## Статус UI (реализовано)

| Область | Состояние |
|---------|-----------|
| Home `#financeZoneBtn` | ✅ баланс YTD/мес, `−`/`+` sheet, баннер плана с 20-го, напоминание |
| detailFinance | ✅ 4 вкладки, переключатель месяца |
| **Метрики** | ✅ в проде (см. ниже) |
| **Категории** | ✅ 25 расходов + план/факт бары |
| **План** | ✅ форма, напоминания, итоги; месяц = `fin.monthKey` |
| **Обзор** | ✅ в проде устраивает; полировка — только по нужде |
| **Bottom sheet** | ✅ POST/delete; **PATCH в UI нет** (API есть) |

**Домохозяйство:** Артём + Дарья · ₽ · ввод поштучный.

---

## Навигация detailFinance

```
[ Апрель ] [ Май ✓ ] [ Июнь ]     ← 3 равные кнопки, активный = синий
tabs: Обзор | Метрики | Категории | План
```

**Логика месяца (не ломать):**
- Обзор / Метрики / Категории / **План** → один `fin.monthKey` (выбранный в навигации).
- Баннер в конце месяца → открывает **следующий** месяц на вкладке План.
- Переключатель месяца работает на всех вкладках, включая План.

**Паттерны:** белые карточки `finance-metric` / `finance-card` (`var(--card)`, radius 12); группы как в Плане — `finance-plan-form__group` + цветная полоска.

---

## Вкладки (актуальный UI)

### Обзор

- Карточки Доходы / Расходы (топ источников / топ-5 групп).
- Стрип баланс месяца | YTD.
- Мини-чарт баланса (4 мес.): бары + подписи `янв`… (`renderFinanceBalanceBars` + `monthShort`).
- «Все категории →» → вкладка Категории.
- **Эталон:** текущий прод-UI в `finance.js` / `charts.js`.

### Метрики — порядок блоков

1. **Доход домохозяйства** — плитки «Среднее» / «Медиана» (целые К); график факта по месяцам (зелёные бары + **линия тренда**); **без** штриха среднего.
2. **Активы 10%** — плитки Цель / Факт **за год** (YTD до выбранного месяца); 3 строки базы (Дарья фото, Артём оклад, Артём бонус) — суммы за год; итог `База за год → цель`; график **помесячного факта** (синие бары + тренд); API `ytd.assetsYtd`, `ytd.monthlyAssets`, `throughMonth`.
3. **Подушка безопасности** — цель = `3 × medianMonthlyIncome` (YTD); накоплено — **ручной ввод** (`localStorage` `financeEmergencyFund`), кнопка «Ввести»; прогресс-бар + %.
4. **Продукты от дохода** — одна строка: `Продукты от дохода — N%` (без диаграмм).

API: `GET /finance/month` + `GET /finance/ytd?year=YYYY`.

### Категории

- **25 категорий** в 8 группах (как План), не свод по группам.
- Строка: название | бар **план (контур/пунктир при 0)** + **факт** | **%** заполнения.
- Перебор плана → красный бар и %.
- Пустой план в форме сохраняется как **0 ₽** (`POST /finance/plan`); API отдаёт нулевые строки если есть запись в `finance_monthly_plan`.
- Tap категории → транзакции + удаление + «+ Добавить».
- Данные: `GET /finance/month` + `GET /finance/plan?month=`.

### План

- Заголовок `План на …` (= выбранный месяц навигации).
- 5 доходов + 25 расходов по группам; поля `65 000 ₽`; пустое = `0 ₽`.
- Итоги в ряд: **Доход** (слева) · **Баланс** (центр) · **Расход** (справа).
- Алерт перерасхода; Save → `POST /finance/plan` на тот же месяц.
- Напоминания: список, wheel-дата, создание/удаление.
- **Не сделано:** П1 бары план/факт на самой вкладке План (есть на Категориях); П3 светофоры.

### Home + ввод (каркас)

- Sheet: сумма, chips категорий, дата, заметка (доход); `Сохр.+ещё` / `Готово`; confirm удаления.
- **По нужде:** **PATCH** транзакции в UI (API уже есть).

---

## Формулы

```python
# Доход YTD
avg_monthly_income   # месяцы с income > 0
median_monthly_income

# Активы 10% (YTD до выбранного месяца)
assets_base_ytd = sum(darya_photo + artem_salary + artem_bonus) за год
assets_target_ytd = assets_base_ytd * 0.10
assets_actual_ytd = sum(категория "Активы 10%") за год
# График: monthlyAssets[].actual — факт по каждому месяцу

# Подушка (UI)
cushion_target = median_monthly_income * 3
cushion_saved  # localStorage financeEmergencyFund
cushion_pct = saved / target * 100

# Продукты от дохода (месяц)
food_pct = (eda + kafe) / income_real * 100

# Баланс
balance_month = income_real - expenses
balance_ytd = carryover + income_ytd - expenses_ytd
```

`carryover` — в балансе YTD, **не** в avg/median/базе 10%.

---

## API (ключевое)

| GET | Назначение |
|-----|------------|
| `/finance/month?month=` | income, expenses, metrics, monthlyBalance (4) |
| `/finance/ytd?year=&throughMonth=` | avg/median income, `assetsYtd`, monthlyIncome, monthlyAssets, foodPctHistory |
| `/finance/plan?month=` | items: categoryId, amountPlanned, amountFact |
| `/finance/transactions?month=` | список |
| `/finance/categories` · `/finance/reminders` | справочник / напоминания |

**metrics (month):** `foodPct`, `assetsBase`, `assetsTarget`, `assetsActual`, `assetsBaseSources[]`.

**ytd:** `throughMonth`, `assetsYtd` (`assetsBase`, `assetsTarget`, `assetsActual`, `assetsBaseSources[]`), `monthlyAssets[]` (`actual` на графике), `medianMonthlyIncome`.

**plan POST:** `{ month, items: [{ categoryId, amountPlanned }] }` — все категории, в т.ч. 0.

Файлы: `api/finance_read.py`, `api/finance_common.py`, `api/finance_write.py`, `mini-app/finance.js`, `mini-app/charts.js` (`LifeCharts.renderFinanceIncomeBars`, `renderFinanceAssetsBars`, `renderFinanceBalanceBars`).

---

## Справочник категорий

**Доходы:** `darya_photo`, `darya_salary`, `artem_salary`, `artem_bonus`, `other`, `carryover`.

**8 групп расходов:** Обязательные (blue), Питание (green), Транспорт (orange), Дом (purple), Семья (pink), Здоровье/спорт (yellow), Развитие (teal), Активы (gray).

**25 расходов:** Активы 10%, Кварплата, Еда, Кафе и рестораны, Проезд, Такси, Связь, Интернет подписки, Автомобиль, Красота, Развлечения, Спорт, Налоги, Продвижение и бизнес, Ребёнок, Одежда, Здоровье, Для дома, Техника, Подарки, Отпуск, Обучение, Разное, Ипотека, Накопления Даша.

БД: `db/migrations/003_finance.sql`, `004_finance_reminder_due_date.sql`.

---

## UX (кратко)

- Section label: 9px uppercase · tap ≥ 44px · sheet как КБЖУ.
- Цвета еды: green ≤25%, yellow ≤35%, red >35%.
- Не трогать: KPI 2×2, fill, nutrition, `user_id`, мульти-валюту.

---

## Очередь (по нужде)

| # | Задача |
|---|--------|
| **A** | PATCH транзакции в UI |
| B | Мелкая полировка Плана / sheet — только если попросят |
| C | PATCH напоминаний — по запросу |
