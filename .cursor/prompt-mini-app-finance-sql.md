# Промпт: Финансы — SQL + API (новый чат)

Скопируй блок ниже в новый чат. Обязательные файлы:

- **`@.cursor/context_bot_to_sql.md`** — Postgres, API-паттерны, схема days/routine/sport
- **`@.cursor/context_bot_miniapp.md`** — как устроен mini-app
- **`@.cursor/context_bot_kbju.md`** — эталон готового модуля (products + log + read/write split)
- **`@.cursor/prompt-mini-app-finance-ui.md`** — UI-концепт (после согласования с пользователем)
- **`/Users/artem/Downloads/Finance.xlsx`** — источник категорий и логики

**Не трогать:** прод, Sheets, `index.html`, `apps-script-doGet.gs`.

**Запуск:** `docker compose up -d` → `cd api && ./run.sh` → http://127.0.0.1:8765/mini-app/

---

## Блок для агента (копировать)

```
@.cursor/context_bot_to_sql.md
@.cursor/context_bot_miniapp.md
@.cursor/context_bot_kbju.md
@.cursor/prompt-mini-app-finance-sql.md

Следующий этап Life Dashboard: **бэкенд финансов** в той же архитектуре, что питание и дни.

## Твоя роль

Backend/SQL инженер. Сначала **план схемы + API** (согласовать с пользователем), потом миграции и код малыми шагами — по образцу `api/nutrition_*.py`.

## Архитектурные ориентиры (как сейчас)

- Postgres в Docker, `db/migrations/00N_*.sql` + дубль в `db/schema.sql`
- FastAPI `api/server.py`, отдельные `finance_read.py` / `finance_write.py` / `finance_common.py`
- JSON `{ ok, ... }`, ошибки 400/404/503
- Mini-app: `GET` для чтения, `POST`/`PATCH`/`DELETE` для записи
- **Нет user_id** (один инстанс); заложить `person`/`source` в данных где нужно
- Импорт из Excel — одноразовый скрипт `api/import_finance.py` (опционально v1)

## Исходные данные: Finance.xlsx

Путь: `/Users/artem/Downloads/Finance.xlsx` (₽, 2026, факт + план FUTURE TOTAL).

**Доходы:** Дарья фото, Дарья оклад, Артем оклад, Артем бонус, Прочее, Остаток.  
**Расходы:** Активы 10% (инвестиции), Кварплата, Еда, Кафе и рестораны, Проезд, Такси и каршеринг, Связь, Интернет подписки, Автомобиль, Красота и стрижки, Развлечения, Спорт, Налоги, Продвижение и бизнес, Ребенок, Одежда, Здоровье, Для дома (ремонт), Техника, Подарки, Отпуск, Обучение, Разное, Ипотека, Накопления Даша.

Строки **Total**, **Balance** — вычисляемые, не хранить как транзакции.

## Бизнес-правила (заложить в API/агрегаты)

1. **Баланс месяца** = сумма доходов − сумма расходов (по `transaction_date` в границах месяца)
2. **% еды от дохода** = (Еда + Кафе и рестораны) / total_income × 100
3. **Средний / медианный доход за год** — по месяцам с ненулевым total_income
4. **Целевые активы 10%** = 0.10 × (Дарья фото + Артем оклад + Артем bonus) за месяц; факт = категория «Активы 10% (инвестиции)»; отклонение в ₽ и %
5. **План vs факт** — опционально `amount_planned` на месяц×категорию (из FUTURE TOTAL)

## Предложи схему БД (черновик — уточни в ответе)

Минимум (ориентир, можно улучшить):

```text
finance_categories   — id, name, kind (income|expense), sort_order, is_system
finance_transactions — id, txn_date, category_id, amount (>0), note?, created_at
finance_reminders    — id, category_id?, title, day_of_month, amount?, active
finance_month_plan   — year_month, category_id, amount_planned  (опционально v1)
```

Индексы по `txn_date`, `category_id`. CHECK на kind/amount.

## Предложи API (черновик)

| Метод | Путь | Назначение |
|-------|------|------------|
| GET | `/finance/month?month=YYYY-MM` | баланс, incomes, expenses, by category, план, метрики (% еда, активы 10%, avg/median income YTD) |
| GET | `/finance/day?date=` | операции за день |
| POST | `/finance/transactions` | `{ date, categoryId, amount, note? }` |
| PATCH/DELETE | `/finance/transactions/{id}` | |
| GET | `/finance/categories` | справочник |
| GET/POST/PATCH | `/finance/reminders` | напоминания |
| GET | `/finance/export.csv?period=7d\|30d\|all` | как nutrition |

## Deliverable в первом ответе (до кода)

1. **ER-диаграмма текстом** + обоснование таблиц
2. **Список эндпоинтов** с примерами JSON
3. **Как считаются** Balance, % еда, активы 10%, avg/median income
4. **План миграции** `003_finance.sql` + сиды категорий из Excel
5. **План импорта** Finance.xlsx → transactions (янв–июнь 2026 факт)
6. **Итерация 1 MVP** (минимальный diff): схема + `GET /finance/month` + `POST` транзакция
7. Вопросы пользователю (≤5)

## Стиль кода

- Как `nutrition_read.py` / `nutrition_write.py`: `psycopg`, `dict_row`, без ORM
- Деньги: `NUMERIC(12,2)`, в API `float` или строка с 2 знаками — единообразно
- Тесты: `curl` примеры в ответе

## Вне scope v1

Мульти-валюта, банковские API, split-транзакции, бюджеты на все категории, user_id, прод-деплой.

После согласования схемы — реализуй **итерацию 1** и проверь через curl + TablePlus.
```
