# Дашборд (index.html) + Apps Script doGet — LEGACY

> **Не для ежедневной работы.** Корневой `index.html` + Google Sheets — архив. Актуальный UI: Mini App `@.cursor/context_bot_miniapp.md`.  
> Бот Sheets (тоже legacy): `@.cursor/context_bot_appscript.md`.

## Проект

— Дашборд «сферы жизни» + спорт (минуты), MVP.  
— **Стек:** `index.html` + Chart.js (CDN), JSON с **Google Apps Script** Web App (`…/exec`), источник — **Google Sheets**. Без своего бэкенда.

## Таблица и листы

— Вкладка = **`yyyy-MM`**.  
— **Сферы:** `B1:I1`; дневные строки — дата в `A`, 0/1 в `B:I`; итоги — строки `факт` / `цель` в `A` (номера строк не фиксированы). Несколько `цель` → для сфер строка с **макс. суммой B:I**.  
— **Спорт (минуты):** колонки **J, K, N, P, T** (1-based: 10, 11, 14, 16, 20). Факт = сумма по строкам с датой в `A`. Цели — `цель` с макс. **J+K+N+P+T**, иначе fallback `цель` по B:I.  
— **Спорт (тип):** O, S; плашки R33, V33 и др. — см. `apps-script-doGet.gs`.  
— **Итог спорта в UI:** `SPORT_ITOG_MINUTES_GOAL[yyyy-MM]` (напр. 1417), иначе сумма целей из строки.

## Что сделано на фронте

— Графики сфер, спорт по категориям, radar, PNG, выбор месяца, автообновление **30 с**, localStorage (время обновления + лог ошибок).  
— Пороги цветов: &lt;50 / 50–99 / ≥100 %.  
— `streaks` удалены из API.

## Файлы

— `index.html` — UI, `API_URL` (база `/exec`, месяц в query).  
— `apps-script-doGet.gs` — **`doGet`** для дашборда; в том же файле **`doPost`** для бота (не трогать без задачи на бот).

## Apps Script doGet

— `?month=yyyy-MM` → лист с тем же именем.  
— Ответ: сферы (`rows`), `sport`, `sportByType`.  
— После правок **doGet:** Save → Deploy → **New version** → Deploy.

## Принципы

— Один URL Web App; фронт не парсит таблицу — только JSON.  
— Не смешивать дневные B:I и спорт J–T в одной логике итогов.  
— `goalSumSportTargets`, `sportGoalRow1Based` — отладка целей спорта.

## Не в скоупе (дашборд)

— Telegram-бот, VPS, FSM — см. `context_bot_appscript.md`.  
— GitHub Pages — по желанию; `MONTH_OPTIONS` / цели новых месяцев — дополнять в GAS.
