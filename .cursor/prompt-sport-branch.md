# Промпт для новой ветки: спорт в Telegram-боте

Скопируй блок ниже в **новый чат Cursor** на ветке `feature/telegram-bot-sport` (или аналог).  
Обязательно приложи контекст: **`@.cursor/context_bot_appscript.md`**

---

## Текст промпта (копировать отсюда)

```
Работаю в репозитории life-dashboard, ветка для спорта в Telegram-боте.

Прочитай @.cursor/context_bot_appscript.md — там зафиксировано всё, что уже сделано в боте (папка bot/).

Кратко что есть сейчас:
- Python + aiogram 3, bot/ с FSM
- Заполнение routine: 8 сфер (B–I), 0/1, batch-запись в Google Sheets через Apps Script doPost (prepareDay + writeRoutineBatch)
- UX: Заполнить → 4 даты + ввод даты → опрос сфер → итог списком → приветствие; уведомления 🔔
- Google Sheets — источник правды; новые строки в таблице не создаём

Задача этой ветки: добавить ввод СПОРТА после routine за выбранный день.

Справка по таблице (см. также CONTEXT.md и apps-script-doGet.gs):
- Минуты спорта: колонки J, K, N, P, T (1-based: 10, 11, 14, 16, 20) — подписи в шапке «…, min»
- Позже (не в первом шаге): типы O (бег), S (велоспорт)
- Дневная строка — та же, что для routine (дата в A), значения пишем в ячейки этой строки

Требования:
1. Маленькими шагами — сначала предложи план из 3–5 шагов, потом делай шаг 1
2. Не ломать существующий flow routine
3. Расширить DataStore / Apps Script doPost (например writeSportBatch) по аналогии с writeRoutineBatch
4. UX в стиле бота: понятные вопросы, кнопки где уместно, без лишних технических сообщений (листы/номера строк)
5. После деплоя Apps Script напомни: New version → Deploy

Начни с: изучи bot/spheres.py, routine_flow.py, data_store.py, apps-script-doGet.gs (doPost) и предложи минимальный первый шаг — например опрос минут по одной категории или ввод всех пяти категорий за день.
```

---

## Перед чатом

```bash
cd /Users/artem/Desktop/life-dashboard
git checkout -b feature/telegram-bot-sport   # если ветки ещё нет
cd bot
source .venv/bin/activate
python main.py   # для ручной проверки
```
