# Деплой SQL-стека на VPS: Postgres + API + Mini App + SQL-бот

> **Цель:** Mini App и SQL-бот на VPS с Postgres. Запасной fill в чате, если mini-app недоступен.  
> **Правило:** код правим **только на Mac** → деплой rsync. На VPS **не** правим `app.js` в nano.

**VPS:** `194.135.20.35` (RUVDS, Amsterdam)  
**Домен:** **`svodbot.ru`** (reg.ru, ~169 ₽/год). Mini App: **`https://dash.svodbot.ru/mini-app/`** (после DNS + Caddy).  
**Репозиторий:** `/Users/artem/Desktop/life-dashboard`

**Прод-бот (Sheets) на VPS:** **не трогаем**. Может работать параллельно — **другой** токен.

**SQL-бот:** уже есть в `!bot_SQL/.env.sql`, новый в BotFather **не нужен**. Menu Button → SQL-бот.

**Swap:** пока **не делаем**.

---

## Статус (июнь 2026)

| Шаг | Статус |
|-----|--------|
| Домен `svodbot.ru` | ✅ куплен (reg.ru, **без** хостинга Host-0) |
| DNS `dash` → `194.135.20.35` | ⏳ ждём / проверяем `dig +short dash.svodbot.ru` |
| Пароль Postgres для VPS | ✅ придуман (в `docker-compose.vps.yml` + `api/.env`) |
| Локально: API + mini-app + КБЖУ в БД | ✅ |
| VPS: Postgres + API + Caddy | ⏳ после DNS |
| `pg_dump` Mac → VPS | ⏳ после Postgres на VPS |
| SQL-бот + Menu Button | ⏳ |
| Дневник Obsidian | ⏳ отдельно, после закрытого Postgres |

---

## Что будет на сервере

```
/opt/life-dashboard/
├── bot/              # общие модули (flows, keyboards)
├── !bot_SQL/         # SQL-бот + .env.sql
├── api/              # FastAPI :8765 (localhost)
├── mini-app/         # /mini-app/
├── db/
└── docker-compose.yml

systemd:  life-dashboard-api.service, life-dashboard-sql-bot.service
docker:   life_dashboard_pg (127.0.0.1:5432)
Caddy:    :443 → 127.0.0.1:8765
```

Прод-бот остаётся в `/opt/life-dashboard/bot/` + `life-dashboard-bot.service` — как сейчас.

---

## Что нужно заранее

| # | Что | Откуда |
|---|-----|--------|
| 1 | **SQL-бот** (уже есть) | токен в `!bot_SQL/.env.sql` на Mac |
| 2 | **Домен** | ✅ `svodbot.ru` → A `dash` → `194.135.20.35` |
| 3 | Локально работает стек | `docker compose up -d` + `cd api && ./run.sh` |
| 4 | SSH | `ssh root@194.135.20.35` |
| 5 | Сильный пароль Postgres | придумать до выкладки (не `life/life`) |

**Один токен = один процесс.** SQL-бот на Mac **остановить**, когда запустишь его на VPS.

---

## Порядок фаз (актуальный)

```
[0] Локально всё ок                    ✅
[1] DNS dash.svodbot.ru → VPS          ⏳
[2] Postgres (закрыт) + API + HTTPS    ⏳
[3] pg_dump Mac → VPS (вкл. КБЖУ)    ⏳
[4] SQL-бот + Menu Button              ⏳
[5] Дневник Obsidian                   ⏳
[6] Тест iPhone                        ⏳
```

---

## Фаза 0 — Локальная проверка (Mac)

```bash
cd /Users/artem/Desktop/life-dashboard
docker compose up -d
cd api && ./run.sh
```

http://127.0.0.1:8765/mini-app/

```bash
curl -s http://127.0.0.1:8765/health
```

SQL-бот (твой рабочий, тот же что пойдёт на VPS):

```bash
cd '/Users/artem/Desktop/life-dashboard/!bot_SQL'
source ../bot/.venv/bin/activate
python main_sql.py
```

---

## Фаза 1 — Домен `svodbot.ru` (reg.ru)

**Куплено:** только домен, **хостинг reg.ru не брать**.

### DNS (сделать / проверить)

reg.ru → **svodbot.ru** → управление зоной:

| Тип | Имя | IP |
|-----|-----|-----|
| A | `dash` | `194.135.20.35` |

```bash
dig +short dash.svodbot.ru
# ожидаем: 194.135.20.35
```

### reg.ru · паспорт / Госуслуги

С 1.09.2026 для `.ru` нужна подтверждённая учётка на Госуслугах (закон 569-ФЗ). Лучше пройти идентификацию в reg.ru заранее, чтобы продлевать домен.

### HTTPS и BotFather (после фазы 2)

- Caddy: `dash.svodbot.ru { reverse_proxy 127.0.0.1:8765 }`
- BotFather → SQL-бот → `/setdomain` → `dash.svodbot.ru`
- Menu Button → `https://dash.svodbot.ru/mini-app/`

---

## Фаза 1 (архив) — где купить домен

Telegram Mini App **требует HTTPS** → нужен домен (голый IP с Let's Encrypt обычно не выдают).

### Где купить (на выбор)

| Регистратор | Плюсы | Минусы | Цена порядка |
|-------------|-------|--------|--------------|
| **[reg.ru](https://www.reg.ru)** | оплата РФ, `.ru` / `.рф`, знакомый интерфейс | DNS иногда медленнее | `.ru` ~200–500 ₽/год |
| **[nic.ru](https://www.nic.ru)** | то же | | похоже |
| **[Cloudflare Registrar](https://www.cloudflare.com/products/registrar/)** | дешёвый `.com`, отличный DNS | нужна карта, регистрация CF | `.com` ~$10/год |
| **[Namecheap](https://www.namecheap.com)** | просто, `.com` | оплата зарубежная | ~$10–15/год |

**Рекомендация для старта:** любой **`.ru`** на reg.ru **или** **`.com`** на Cloudflare — оба нормально работают с VPS в Amsterdam.

Имя: короткое, например `artem-dash.ru` или поддомен позже. Можно купить `example.ru` и использовать **`dash.example.ru`** — не обязательно покупать отдельный домен под mini-app.

### Шаг 1 — Купить домен

1. Зарегистрироваться у регистратора.  
2. Проверить свободное имя → купить на 1 год.  
3. В панели домена найти **DNS / Управление зоной**.

### Шаг 2 — DNS-запись на VPS

Добавить **A-запись**:

| Тип | Имя (хост) | Значение | TTL |
|-----|------------|----------|-----|
| A | `dash` | `194.135.20.35` | 300–3600 |

Итог: **`dash.svodbot.ru`** → твой VPS.

Если хочешь корень домена (`svodbot.ru` без `dash`):

| Тип | Имя | Значение |
|-----|-----|----------|
| A | `@` | `194.135.20.35` |

### Шаг 3 — Проверить, что DNS дошёл

На Mac (повторять, пока не покажет IP):

```bash
dig +short dash.svodbot.ru
# ожидаем: 194.135.20.35
```

Или: https://dnschecker.org — вбить `dash.svodbot.ru`.

Обычно **15 минут – 2 часа**, иногда до 24 ч.

### Шаг 4 — (позже, фаза 2) HTTPS

Когда на VPS будет Caddy с блоком `dash.svodbot.ru` — сертификат Let's Encrypt выпустится автоматически. **До этого** DNS должен уже указывать на VPS.

### BotFather — домен (после HTTPS)

Когда `https://dash.svodbot.ru/mini-app/` открывается в браузере:

1. BotFather → `/mybots` → **твой SQL-бот** (тот же, что в `.env.sql`)  
2. `/setdomain` → `dash.svodbot.ru`  
3. Menu Button (фаза 4) → URL mini-app

---

## Фаза 2 — VPS: закрытый Postgres + API + Mini App + HTTPS

Сначала **стыкуем домен с mini-app** (пустая или свежая БД). Данные с Mac перенесём в фазе 3.

### 2.1 `docker-compose` на VPS

Файл в репо: `deploy/docker-compose.vps.yml` — **замени пароль** перед копированием.

```bash
# на Mac — отредактировать POSTGRES_PASSWORD в deploy/docker-compose.vps.yml

rsync -avz -e ssh \
  /Users/artem/Desktop/life-dashboard/db/ \
  root@194.135.20.35:/opt/life-dashboard/db/

rsync -avz -e ssh \
  /Users/artem/Desktop/life-dashboard/deploy/docker-compose.vps.yml \
  root@194.135.20.35:/opt/life-dashboard/docker-compose.yml

ssh root@194.135.20.35 'cd /opt/life-dashboard && docker compose up -d'
```

Postgres слушает **только** `127.0.0.1:5432` — см. `docker-compose.vps.yml`.

### 2.2 Firewall

```bash
ssh root@194.135.20.35 << 'EOF'
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
EOF
```

Проверка с Mac — порт 5432 снаружи **закрыт**:

```bash
nc -zv 194.135.20.35 5432
```

### 2.3 Деплой кода (API + mini-app + зависимости)

```bash
VPS=root@194.135.20.35
ROOT=/Users/artem/Desktop/life-dashboard
REMOTE=/opt/life-dashboard

rsync -avz --delete -e ssh \
  --exclude '.venv' --exclude '__pycache__' --exclude '*.pyc' --exclude '.env' \
  "$ROOT/api/" "$VPS:$REMOTE/api/"

rsync -avz --delete -e ssh \
  "$ROOT/mini-app/" "$VPS:$REMOTE/mini-app/"

rsync -avz -e ssh \
  --exclude '.venv' --exclude '__pycache__' --exclude '.env' \
  "$ROOT/bot/" "$VPS:$REMOTE/bot/"

rsync -avz -e ssh \
  --exclude '.env.sql' \
  "$ROOT/!bot_SQL/" "$VPS:$REMOTE/!bot_SQL/"

rsync -avz -e ssh \
  "$ROOT/index-sql.html" "$VPS:$REMOTE/"
```

### 2.4 `api/.env` на VPS (один раз)

`/opt/life-dashboard/api/.env`:

```env
DATABASE_URL=postgresql://lifeapp:ТВОЙ_ПАРОЛЬ@127.0.0.1:5432/life_dashboard
```

```bash
ssh root@194.135.20.35 'chmod 600 /opt/life-dashboard/api/.env'
```

### 2.5 Python venv (один раз, если ещё нет)

```bash
ssh root@194.135.20.35 << 'EOF'
cd /opt/life-dashboard/bot
test -d .venv || python3 -m venv .venv
./.venv/bin/pip install -q --upgrade pip
./.venv/bin/pip install -q -r requirements.txt
./.venv/bin/pip install -q -r /opt/life-dashboard/api/requirements.txt
id lifebot &>/dev/null || useradd --system --home /opt/life-dashboard --shell /usr/sbin/nologin lifebot
chown -R lifebot:lifebot /opt/life-dashboard
EOF
```

Playwright для SQL-стека **не ставим** (экономия RAM). Прод-бот со своим venv/Playwright не трогаем.

### 2.6 systemd: API

`/etc/systemd/system/life-dashboard-api.service`:

```ini
[Unit]
Description=Life Dashboard API + Mini App
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=simple
User=lifebot
Group=lifebot
WorkingDirectory=/opt/life-dashboard/api
EnvironmentFile=/opt/life-dashboard/api/.env
ExecStart=/opt/life-dashboard/bot/.venv/bin/uvicorn server:app --host 127.0.0.1 --port 8765
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
ssh root@194.135.20.35 'systemctl daemon-reload && systemctl enable life-dashboard-api && systemctl restart life-dashboard-api'
```

### 2.7 Caddy + HTTPS

```bash
ssh root@194.135.20.35 'apt-get update && apt-get install -y caddy'
```

`/etc/caddy/Caddyfile` (подставь свой домен):

```
dash.svodbot.ru {
    reverse_proxy 127.0.0.1:8765
}
```

```bash
ssh root@194.135.20.35 'systemctl reload caddy'
```

### 2.8 Проверка «домен + mini-app»

```bash
curl -s https://dash.svodbot.ru/health
curl -s -o /dev/null -w "%{http_code}\n" https://dash.svodbot.ru/mini-app/
```

В браузере на Mac: `https://dash.svodbot.ru/mini-app/` — UI может быть пустой/без данных до фазы 3.

**Критерий фазы 2:** HTTPS открывается, Postgres снаружи недоступен, API отвечает.

---

## Фаза 3 — Перенос БД с Mac на VPS

Когда домен уже стыкуется с mini-app, заливаем **локальную** Postgres: routine, sport, **КБЖУ** (`products`, `nutrition_log`), финансы и т.д.

**КБЖУ на Mac (июнь 2026):** ~323 продукта, лог за 11–17.06 из Cronometer. После деплоя обновлять порции — см. `.cursor/context_bot_kbju.md` и `api/import_cronometer.py` (только новые продукты + лог).

### 3.1 Дамп на Mac

```bash
docker exec life_dashboard_pg pg_dump -U life life_dashboard > /tmp/life_dashboard.sql
ls -lh /tmp/life_dashboard.sql
```

### 3.2 Копирование и восстановление на VPS

```bash
scp /tmp/life_dashboard.sql root@194.135.20.35:/tmp/

ssh root@194.135.20.35 'docker exec -i life_dashboard_pg psql -U lifeapp -d life_dashboard < /tmp/life_dashboard.sql'
```

Если на VPS уже были пустые таблицы из `schema.sql` — дамп обычно перезапишет/дополнит. При конфликтах: восстановить в чистую БД (`docker compose down -v` **осторожно**, только если данных на VPS ещё нет).

### 3.3 Проверка

```bash
curl -s "https://dash.svodbot.ru/week?date=$(date +%Y-%m-%d)&month=$(date +%Y-%m)" | head
```

В браузере mini-app — KPI и данные как на Mac.

---

## Фаза 4 — SQL-бот на VPS + Menu Button

### 4.1 `.env.sql` на VPS

Скопировать с Mac (тот же бот, тот же токен):

```bash
scp '/Users/artem/Desktop/life-dashboard/!bot_SQL/.env.sql' \
  root@194.135.20.35:/opt/life-dashboard/\!bot_SQL/.env.sql
```

На VPS поправить **только** `DATABASE_URL` на VPS-пароль:

```env
BOT_TOKEN=...          # как на Mac, без изменений
DATABASE_URL=postgresql://lifeapp:ПАРОЛЬ@127.0.0.1:5432/life_dashboard
DATA_STORE=postgres
```

```bash
ssh root@194.135.20.35 'chmod 600 /opt/life-dashboard/\!bot_SQL/.env.sql'
```

**На Mac:** остановить `python main_sql.py` — один токен не может polling в двух местах.

### 4.2 systemd: SQL-бот

`/etc/systemd/system/life-dashboard-sql-bot.service`:

```ini
[Unit]
Description=Life Dashboard SQL Telegram bot
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=lifebot
Group=lifebot
WorkingDirectory=/opt/life-dashboard/!bot_SQL
EnvironmentFile=/opt/life-dashboard/!bot_SQL/.env.sql
Environment=TZ=Europe/Moscow
ExecStart=/opt/life-dashboard/bot/.venv/bin/python main_sql.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
ssh root@194.135.20.35 'systemctl daemon-reload && systemctl enable life-dashboard-sql-bot && systemctl restart life-dashboard-sql-bot'
```

Telegram → SQL-бот → `/start`.

### 4.3 Menu Button (тот же SQL-бот)

BotFather → SQL-бот → **Menu Button** → URL:

```
https://dash.svodbot.ru/mini-app/
```

| Компонент | Роль |
|-----------|------|
| SQL-бот | fill в чате + кнопка Menu |
| Mini App | UI → API → Postgres |
| API упал | fill через чат SQL-бота в ту же БД |

Прод-бот (Sheets) на VPS **может работать** — это другой бот, другие данные.

---

## Фаза 5 — Дневник (Obsidian → Postgres)

**После** закрытого Postgres на VPS. Если дневник уже в локальном дампе — фаза 5 пропускается.

1. Импорт `.md` → `diary_entries` **локально** или сразу на VPS.  
2. Проверка: `GET /diary/month`.  
3. Если импортировал локально — повторить `pg_dump` / `scp` / `psql` (фаза 3).

---

## Фаза 6 — Тест с iPhone

1. SQL-бот только на VPS (не на Mac).  
2. Telegram → SQL-бот → Menu (≡) → Mini App.  
3. home, Заполнить, КБЖУ, финансы, дневник.  
4. Закрыть mini-app полностью → открыть снова.

Старый UI → bump `?v=` в `index.html` на Mac → rsync `mini-app/` → restart API.

---

## Ежедневный цикл правок (Mac → VPS)

```
1. Правка mini-app/ или api/ на Mac
2. http://127.0.0.1:8765/mini-app/
3. Bump ?v= в index.html
4. rsync (фаза 2.3)
5. ssh root@194.135.20.35 'systemctl restart life-dashboard-api'
6. iPhone: переоткрыть Mini App
```

---

## Полезные команды

| Действие | Команда |
|----------|---------|
| Логи API | `journalctl -u life-dashboard-api -f` |
| Логи SQL-бота | `journalctl -u life-dashboard-sql-bot -f` |
| Прод-бот (Sheets) | `journalctl -u life-dashboard-bot -f` |
| Postgres | `docker exec -it life_dashboard_pg psql -U lifeapp -d life_dashboard` |

---

## Безопасность (чеклист)

- [ ] Postgres: `127.0.0.1:5432` only  
- [ ] Сильный пароль БД  
- [ ] ufw: 22, 80, 443  
- [ ] `.env` / `.env.sql`: chmod 600  
- [ ] Бэкап: `pg_dump` по cron  
- [ ] Позже: auth API через Telegram `initData`

---

## Swap

**Пока не делаем.** Если на 1 ГБ RAM начнутся OOM — тогда отдельно (см. `bot/deploy/DEPLOY_VPS.md`).

---

## Отдельный проект (потом)

Multi-user (жена → 20–30 чел), настраиваемые категории финансов, разбивка mini-app — старт с **схемы БД**, не в этом деплое.

---

## Контекст

| Файл | Зачем |
|------|-------|
| `.cursor/context_bot_miniapp.md` | UI, API |
| `.cursor/context_bot_to_sql.md` | Postgres, SQL-бот |
| `deploy/docker-compose.vps.yml` | Postgres только localhost |
| `.cursor/context_bot_kbju.md` | импорт Cronometer, продукты, лог |
| `!bot_SQL/.env.sql` | токен SQL-бота |
| `api/import_cronometer.py` | обновление КБЖУ после деплоя |
