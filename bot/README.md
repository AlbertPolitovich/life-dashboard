# Telegram Bot

Минимальный бот для проекта life-dashboard.

## Первый запуск

Перейди в папку бота:

```bash
cd /Users/artem/Desktop/life-dashboard/bot
```

Включи виртуальное окружение:

```bash
source .venv/bin/activate
```

Установи зависимости:

```bash
python -m pip install -r requirements.txt
```

Создай файл `.env` из примера:

```bash
cp .env.example .env
```

Открой `.env` и замени значение `BOT_TOKEN` на настоящий токен от BotFather.

Запусти бота:

```bash
python main.py
```

Чтобы остановить бота, нажми `Ctrl + C` в Терминале.

## Команды бота

```text
/start - первое приветствие
/help - список возможностей
/yesterday - начать заполнение (выбор дня)
```

## Интеграция с Google Sheets

1. Скопируй обновлённый `apps-script-doGet.gs` в Extensions → Apps Script таблицы.
2. Deploy → Manage deployments → Edit → **New version** → Deploy.
3. В `.env` добавь `SHEETS_API_URL` — тот же URL `/exec`, что в `index.html`.
4. Опционально: в Script properties задай `BOT_API_SECRET` и тот же ключ в `.env` как `SHEETS_API_SECRET`.

Бот вызывает `POST`:
- `prepareDay` — найти строку с датой в колонке `A` на листе `yyyy-MM`
- `writeRoutine` — записать `0` или `1` в колонку B–I за этот день

Новые строки не создаются.

## Деплой на VPS (Amsterdam, Ubuntu 24.04)

IP: `194.135.20.35`, SSH: `root`. Подробно: **`deploy/DEPLOY_VPS.md`**.

### Первый деплой (один раз)

```bash
cd /Users/artem/Desktop/life-dashboard/bot
chmod +x deploy/*.sh
./deploy/deploy-first-time.sh
```

### Обновление кода после правок

```bash
cd /Users/artem/Desktop/life-dashboard/bot
./deploy/deploy-to-vps.sh
```

Скрипт копирует файлы и делает `systemctl restart` — через несколько секунд бот с новым кодом. Файл `.env` на сервере **не перезаписывается**.

Можно править и по SSH (`nano` на VPS), но удобнее локально + `deploy-to-vps.sh`.

---

## Деплой на свой VPS (24/7)

Бот на Mac отвечает только пока включён Mac и запущен `python main.py`. На VPS процесс крутится постоянно — `/start` и напоминания 🔔 приходят сразу.

**Важно:** одновременно должен работать **только один** экземпляр бота (либо Mac, либо VPS). Иначе два polling-а к одному токену конфликтуют.

### 1. Скопировать проект на сервер

С Mac (подставь свой логин и IP):

```bash
rsync -av --exclude '.venv' --exclude '.env' --exclude 'notification_settings.json' \
  /Users/artem/Desktop/life-dashboard/bot/ \
  USER@YOUR_VPS_IP:/opt/life-dashboard/bot/
```

На VPS создай `.env` (скопируй с Mac вручную, токен не клади в git):

```bash
ssh USER@YOUR_VPS_IP
sudo mkdir -p /opt/life-dashboard
sudo chown -R $USER:$USER /opt/life-dashboard
nano /opt/life-dashboard/bot/.env
```

### 2. Python и зависимости на VPS

```bash
cd /opt/life-dashboard/bot
sudo apt update
sudo apt install -y python3 python3-venv python3-pip
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Проверка вручную:

```bash
source .venv/bin/activate
python main.py
```

В Telegram отправь `/start`. Если ок — `Ctrl+C` и переходи к systemd.

### 3. systemd (автозапуск после перезагрузки)

```bash
sudo useradd --system --home /opt/life-dashboard/bot --shell /usr/sbin/nologin lifebot || true
sudo chown -R lifebot:lifebot /opt/life-dashboard/bot

sudo cp /opt/life-dashboard/bot/deploy/life-dashboard-bot.service /etc/systemd/system/
# Отредактируй TZ= в unit-файле под свой часовой пояс
sudo nano /etc/systemd/system/life-dashboard-bot.service

sudo systemctl daemon-reload
sudo systemctl enable life-dashboard-bot
sudo systemctl start life-dashboard-bot
sudo systemctl status life-dashboard-bot
```

Логи:

```bash
journalctl -u life-dashboard-bot -f
```

### 4. После деплоя

- Останови бота на Mac (`Ctrl+C` в терминале).
- В 🔔 настрой время заново на VPS (или скопируй `notification_settings.json` в `/opt/life-dashboard/bot/`).
- Час напоминания — по `TZ` в service-файле (время сервера = твоё локальное, если TZ выставлен верно).

### Обновление кода

```bash
rsync -av --exclude '.venv' --exclude '.env' ...   # как выше
ssh USER@YOUR_VPS_IP 'sudo systemctl restart life-dashboard-bot'
```
