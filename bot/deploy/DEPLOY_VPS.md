# Деплой бота на VPS (194.135.20.35)

Сервер: Ubuntu 24.04, Amsterdam, 1 ГБ RAM.  
Бот крутится через **systemd** (`life-dashboard-bot`), перезапуск после перезагрузки VPS.

---

## Перед деплоем

1. **Один бот = один процесс.** Останови бота на Mac (`Ctrl+C` в терминале с `python main.py`).
2. Файл **`bot/.env`** на Mac заполнен: `BOT_TOKEN`, `SHEETS_API_URL`, при необходимости `SHEETS_API_SECRET`, `REMINDER_TZ`.
3. **SSH** на сервер с Mac работает (см. ниже).

---

## 1. SSH с Mac на VPS

**Вариант A — пароль (как сейчас):** скрипты `deploy-*.sh` спросят пароль **один раз** на весь деплой. Ручная проверка:

```bash
ssh root@194.135.20.35 "echo OK"
```

**Вариант B — ключ (удобнее, без пароля при каждом деплое):**

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Вставь ключ в панель VPS → SSH keys. Проверка снова `ssh root@194.135.20.35 "echo OK"` — без запроса пароля.

> Ошибка `Permission denied` в скрипте при рабочем `ssh` вручную была из‑за режима «только ключ» в старой версии скрипта — в актуальных `deploy-*.sh` это исправлено.

---

## 2. Первый деплой (один раз)

```bash
cd /Users/artem/Desktop/life-dashboard/bot
chmod +x deploy/*.sh
./deploy/deploy-first-time.sh
```

Скрипт: заливает код, копирует `.env`, ставит Python, venv, Playwright, включает systemd.

В Telegram: `/start` — бот должен ответить.

Логи на сервере:

```bash
ssh root@194.135.20.35 'journalctl -u life-dashboard-bot -f'
```

---

## 3. Обновления после правок в коде

```bash
cd /Users/artem/Desktop/life-dashboard/bot
./deploy/deploy-to-vps.sh
```

`.env` на сервере **не перезаписывается** (только код + restart).

Чтобы обновить секреты на VPS:

```bash
scp .env root@194.135.20.35:/opt/life-dashboard/bot/.env
ssh root@194.135.20.35 'sudo systemctl restart life-dashboard-bot'
```

---

## 4. Полезные команды

| Действие | Команда |
|----------|---------|
| Статус | `ssh root@194.135.20.35 'systemctl status life-dashboard-bot'` |
| Перезапуск | `ssh root@194.135.20.35 'sudo systemctl restart life-dashboard-bot'` |
| Логи | `ssh root@194.135.20.35 'journalctl -u life-dashboard-bot -f'` |
| Стоп | `ssh root@194.135.20.35 'sudo systemctl stop life-dashboard-bot'` |

Часовой пояс напоминаний 🔔: в unit-файле `TZ=Europe/Moscow` (меняется в `deploy/life-dashboard-bot.service` + повторный `vps-first-setup` или правка `/etc/systemd/system/life-dashboard-bot.service`).

---

## 5. Если мало памяти (1 ГБ)

При падении на воскресных картинках (Playwright) в логах будет ошибка chromium. Варианты:

- добавить swap 1 ГБ на VPS;
- временно не рендерить графики (бот всё равно пишет в таблицу).

---

## 6. Настройки уведомлений

Файл `notification_settings.json` на сервере не затирается при rsync.  
После первого деплоя заново настрой 🔔 в боте или скопируй файл с Mac:

```bash
scp notification_settings.json root@194.135.20.35:/opt/life-dashboard/bot/
ssh root@194.135.20.35 'chown lifebot:lifebot /opt/life-dashboard/bot/notification_settings.json && sudo systemctl restart life-dashboard-bot'
```
