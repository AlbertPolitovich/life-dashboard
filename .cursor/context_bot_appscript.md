# Telegram-бот (bot/) + Apps Script (doPost/doGet) — LEGACY

> **Не для ежедневной работы.** Sheets-бот и корневой дашборд давно не нужны — правда дня = Mini App + Postgres (Selectel).  
> Файл оставлен как архив. Дашборд Sheets: `@.cursor/context_html_appscript.md`. Mini App: `@.cursor/context_bot_miniapp.md`.

## База

- Sheets — источник правды; строки по дате в `A` **не создаём**.
- Заполняем вручную (обычно вчера; в UI есть «Сегодня»).
- `/start` → welcome + `Заполнить` | `🔔`. `Заполнить` → `Routine | Sport` → день → опрос → `writeRoutineBatch` / `writeSportBatch`.

## Routine

- 8 сфер B–I, кнопки **0 / 1** (0 = осознанный ответ, не «пропуск»).
- После save: **воскресенье** → картинка `Routine + Radar`; иначе → «Заполнить Sport?».

## Sport — опрос

Порядок: **разминка → растяжка → вело → воркаут → бег**. FSM, один `writeSportBatch`.

**Разминка / растяжка** (сразу после разминки): «Пропустить», «Нет», «Отмена» — ячейка не трогается; минуты — текстом.

**Да/Нет на блок** (вело/воркаут/бег): «Нет» — весь блок не пишется.  
**Пропустить** (или «Нет» на разминке): ячейка **не трогается**.  
**Ввод 0** в поле — пишется 0 (если нужно «пусто» — «Пропустить»).

Пропускаемые поля: разминка, растяжка, `Wt (avr)`, `Workout, min`, `Push ups`, `Pull ups`, `Heart rate running (avr)`.

**Числа:** целые или дробные через **запятую** (`6,7`); парсер — `bot/sport_parse.py`. GAS принимает дроби (`normalizeSportNumber_` в `apps-script-doGet.gs`).

**Pace (Q):** авто = `Run time, min / Run, km` → `ММ:СС:00`; ввод не спрашиваем (`bot/pace_util.py`).

После save:
1. **воскресенье** → картинка `Sport by min + Sport by type`;
2. **КБЖУ** (HTML) по типу дня (`bot/kbju.py`): отдых | воркаут | вело | бег — приоритет нагрузки вело → бег → воркаут → отдых;
3. welcome.

## Колонки спорта (1-based)

| Блок | Col |
|------|-----|
| Разминка | J (10) |
| Str, Pull, Push, Workout min | K–N (11–14) |
| Run km, time, Pace, HR | O–R (15–18) |
| Cycling km, time, Wt, HR | S–V (19–22) |

## API и код

| Слой | Файлы |
|------|--------|
| Store | `bot/data_store.py` — `prepare_day`, `write_routine_batch`, `write_sport_batch`, `get_month_*` |
| Flows | `bot/routine_flow.py`, `bot/sport_flow.py` |
| Sport | `bot/sport_fields.py`, `sport_parse.py`, `pace_util.py`, `kbju.py` |
| GAS | `apps-script-doGet.gs` — doPost/doGet; после правок **New version → Deploy** |
| Charts | `bot/charts.py` + playwright (ленивый импорт; без chromium — без картинок) |

## 🔔 и деплой

- Время: `Время HH:MM`; смена времени включает уведомления. TZ: `REMINDER_TZ` (дефолт `Europe/Moscow`).
- Локально: `cd bot && source .venv/bin/activate && python main.py`.
- VPS: `bot/deploy/deploy-to-vps.sh` → `/opt/life-dashboard/bot`, systemd `life-dashboard-bot`. **Один** процесс с токеном (Mac или VPS).
