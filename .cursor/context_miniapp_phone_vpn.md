# Mini App + VPN + VPS — полный контекст (июнь 2026) — ИСТОРИЧЕСКИЙ ЛОГ

> **Актуальная архитектура VPN/API:** **`@.cursor/context_bot_freakingWG.md`** (API+БД только Selectel; dual API на Amsterdam снят).  
> Этот файл — лог инцидентов июня 2026; многие выводы ниже **устарели** (API уже не на том же VPS, что VPN).  
> Связанные: **`@.cursor/context_bot_miniapp.md`** · **`deploy/DEPLOY_SQL_MINIAPP_VPS.md`** (тоже исторический).

**Прод (актуально):** https://dash.svodbot.ru/mini-app/ на Selectel — см. freakingWG / miniapp.  
**Ниже — снимок на 29.06.2026** (Amsterdam ещё держал API): redirect loop починен; WG full tunnel + mini-app лагал.

---

## Инцидент 29.06.2026: redirect loop Cloudflare (починено)

**Симптом:** `https://dash.svodbot.ru` — бесконечные `301` на тот же URL, mini-app/API мертвы через домен.

**Причина:** на VPS стоял Caddy с HTTPS на `:443` + `http://` → `redir https://` permanent, а в DNS запись `dash` **всё ещё proxied** (оранжевое облако, `188.114.x.x`). Cloudflare Flexible шлёт на origin **HTTP :80** → Caddy редиректит на HTTPS → петля.

**Фикс (29.06, без смены DNS):** откат `/etc/caddy/Caddyfile` к **`deploy/Caddyfile.svodbot`** — только HTTP `:80`, `auto_https off`, без редиректа. `systemctl reload caddy`.

**Проверка после фикса:**
- `curl -sI https://dash.svodbot.ru/mini-app/` → `200`
- `curl -s https://dash.svodbot.ru/health` → `{"ok":true}`
- Origin `:80` → `200`, без `301`

**Grey cloud не трогали** — с Flexible + HTTP origin оранжевое облако снова ок. Grey cloud + LE на `:443` — на потом, при переносе на отдельный хост.

---

## Корневая причина (главный вывод)

**Mini-app и VPN живут на одном IP (`194.135.20.35`).**

При **полном туннеле WireGuard** (`AllowedIPs = 0.0.0.0/0`) трафик телефона к `dash.svodbot.ru` идёт так:

```
iPhone → WG-туннель → VPS (NL) → интернет → Cloudflare (188.114.x.x) → снова VPS :80/:443
```

Это **петля (hairpin)** + лишний RTT + MTU/DNS/IPv6-нюансы → в Telegram WebView `fetch` падает → в коде: **«Нет связи с сервером»** (`app.js`, таймаут 15 с).

**На Mac** тот же WG (`10.0.0.2`, порт `51820`) работает отлично, потому что:
- другой клиент / другой маршрут;
- mini-app с Mac часто **без VPN** или с иным DNS;
- на телефоне 100+ открытий mini-app в день при включённом VPN.

**Вывод для продукта:** API + mini-app + Postgres **не должны** сидеть на том же VPS, что и личный/семейный VPN, если VPN всегда включён на телефоне.

---

## Как mini-app ходит в сеть (задумка)

```
iPhone → Telegram WebView → HTTPS dash.svodbot.ru
       → Cloudflare (оранжевое облако, proxied) → 188.114.96/97.x
       → VPS Caddy → 127.0.0.1:8765 FastAPI → Postgres (docker)
```

- Статика: `/opt/life-dashboard/mini-app/` (rsync с Mac).
- API: `uvicorn` один worker, `life-dashboard-api.service`.
- Ошибка в UI: `Нет связи с сервером` = `fetch` failed / timeout (`app.js`).

---

## Что на VPS сейчас (после всех правок 22–28.06)

| Сервис | Порт | Контейнер/юнит | Назначение |
|--------|------|----------------|------------|
| **WireGuard (native)** | UDP `51820` | `wg0` | VPN семьи/личный. Подсеть `10.0.0.0/24`. Mac `10.0.0.2`, iPhone `10.0.0.3` |
| **Caddy** | TCP `80` | `caddy.service` | HTTP `dash.svodbot.ru` → `127.0.0.1:8765` (CF Flexible на edge) |
| **FastAPI** | `127.0.0.1:8765` | `life-dashboard-api` | Mini-app API |
| **Postgres** | `127.0.0.1:5432` | `life_dashboard_pg` | БД |
| **Amnezia Xray** | TCP **`8443`**→443 | `amnezia-xray` | **Было :443**, перенесли 28.06 под Caddy |
| **Amnezia AWG 2.0** | UDP `35820` | `amnezia-awg2` | Семейный AWG (Docker), не трогали в финале |
| **dnsmasq-wg** | UDP `53` на `10.0.0.1` | `dnsmasq-wg.service` | Split-DNS для WG: `dash.svodbot.ru` → `194.135.20.35`, без AAAA |

**DNS публичный:** `dig dash.svodbot.ru` → всё ещё **Cloudflare** (`188.114.96/97.x`) — оранжевое облако **не отключали**.

**Файлы на VPS:**
- `/etc/caddy/Caddyfile` — HTTP-only для dash (как `deploy/Caddyfile.svodbot`; бэкап HTTPS-версии: `Caddyfile.bak.*`)
- `/etc/wireguard/wg0.conf` — native WG (+ PostUp запускает `dnsmasq-wg`)
- `/etc/dnsmasq-wg.conf` — split DNS
- `/root/wg-phone.conf` — клиентский шаблон для iPhone (может быть устаревшим)
- `/opt/life-dashboard/` — код бота, api, mini-app

---

## Хронология попыток (что делали)

### 1. Amnezia (до этой ветки)
- На VPS уже были Docker: `amnezia-xray` (:443), `amnezia-awg2` (:35820).
- На телефоне основной протокол — **Xray**; на Yota не работало; на Wi‑Fi — ок.
- AWG 2.0 с параметрами `Jc=4, Jmin=10, Jmax=50`, без I1 — не mobile preset.

### 2. AWG mobile preset (22.06)
- На сервере в Docker AWG: `Jc=3, Jmin=40, Jmax=70`, `I1=<r 48>`, новый peer `10.8.1.7`.
- Конфиг: `/root/awg-admin-ios-mobile.conf`, копия на Mac Desktop.
- **Xray не трогали** — семья на Xray не пострадала.
- **Итог:** на Yota/Wi‑Fi у пользователя всё равно плохо; семья на старых AWG-конфигах рассинхронилась.

### 3. Переход на native WireGuard (23.06)
- Рабочий туннель как на Mac: `wg0`, порт `51820`, iPhone `10.0.0.3`.
- Конфиг: `wg-phone.conf` на Desktop.
- **VPN заработал** на телефоне (сайты, Yota).
- **Mini-app** — лаги / «Нет связи» (hairpin через Cloudflare).

### 4. Split AllowedIPs (сломанный конфиг — Cloudflare CIDR)
- Идея: исключить Cloudflare из туннеля длинным списком CIDR.
- `wg-phone-split.conf` — **сломал весь интернет на iPhone** (iOS не переварил список / неполное покрытие).
- **Удалён.** Вернули `AllowedIPs = 0.0.0.0/0`.

### 7. Split AllowedIPs — mini-app bypass Selectel (29.06) — **не работает на iOS**
- Идея: `AllowedIPs` без `161.104.47.52/32` (32 маршрута) — **на iPhone «ничего не работает»** (как старый Cloudflare split).
- **Не использовать** `wg-phone-selectel-bypass.conf`.

### 8. TCP proxy dash на VPN-сервере (29.06) — **актуальный фикс**
- `dash-selectel-proxy.service` на Amsterdam: `10.0.0.1:443` → `161.104.47.52:443` (TLS passthrough).
- `dnsmasq-wg`: `address=/dash.svodbot.ru/10.0.0.1`
- iPhone: **`~/Desktop/wg-phone.conf`** — `AllowedIPs = 0.0.0.0/0`, `DNS = 10.0.0.1`, **без** `::/0`.
- Трафик mini-app: телефон → туннель → Amsterdam → короткий hop на Selectel (без обхода туннеля на iOS).

### 5. Caddy на :443 + Xray на :8443 (28.06)
- Освободили `443` под mini-app (Let's Encrypt на origin).
- `amnezia-xray`: внешний порт **8443** (внутри контейнера 443).
- **Семье на Xray:** обновить endpoint port **443 → 8443** в Amnezia, если пользуются.
- Origin HTTPS проверен: `curl --resolve dash.svodbot.ru:443:127.0.0.1` → 200.

### 6. dnsmasq-wg split DNS (28.06)
- На `10.0.0.1` (wg0): `dash.svodbot.ru` → `194.135.20.35`, AAAA подавлен (`local=/dash.svodbot.ru/`).
- В клиентском WG нужно: **`DNS = 10.0.0.1`**, без `::/0` (IPv6 мимо туннеля).
- Актуальный шаблон на Mac: `/Users/artem/Desktop/wg-phone.conf`
- **Итог:** пользователь сообщил «стало хуже», mini-app всё ещё «Нет связи». В логах API **были** успешные запросы с `10.0.0.3` (значит часть трафика доходила) — проблема **нестабильная / гонка / IPv6 / DNS на телефоне не применился**.

---

## Симптомы mini-app (телефон + Telegram)

| Симптом | Примечание |
|---------|------------|
| «Нет связи с сервером» | `fetch` fail, 15 s timeout |
| Лаги в КБЖУ, Load failed | WebView + параллельные запросы home |
| На Mac / без VPN — норм | Сервер не узкое место (CPU ~3%) |
| С VPN на телефоне — плохо | Hairpin + 875 MB RAM (был OOM xray 23.06) |

---

## Правки в коде mini-app (отдельно от VPN)

| Версия | Что |
|--------|-----|
| `20260628-api-queue` | Очередь запросов — **стало хуже на телефоне** |
| `20260628-api-queue2` | **Прод-база после Selectel:** очередь убрана; lock POST КБЖУ, abort поиска, кэш finance/ledger, timeout 15 s |

**Cache-bust (прод):** `app.js?v=20260629-api-queue2` · `finance.js` / `ledger.js` — тот же суффикс. **Не откатывать** на `api-queue`.

---

## Рекомендуемое решение для следующего агента

### Вариант A (предпочтительный): **отдельный хостинг для бота + API + mini-app**

- Новый VPS / PaaS **без VPN** (или VPN на другом IP).
- Домен `dash.svodbot.ru` → новый IP (grey cloud или CF как сейчас).
- На `194.135.20.35` оставить **только VPN** (wg0 + по желанию Amnezia).
- Плюсы: hairpin исчезает навсегда; телефон с VPN всегда включён — mini-app работает.

### Вариант B: Cloudflare grey cloud + только WG

- В CF: `dash` → DNS only → `194.135.20.35`.
- При VPN + `DNS=10.0.0.1`: трафик `dash` → напрямую на origin `:443` Caddy.
- Минусы: уже пробовали частично, нестабильно; CF и LE на одном IP с VPN — хрупко.

### Вариант C: второй поддомен на другом хосте

- Например `app.svodbot.ru` на отдельном сервере; BotFather Menu Button → новый URL.

### Не рекомендуется продолжать

- Дальше крутить split AllowedIPs / I1 / Xray на том же IP.
- Держать API и VPN на 875 MB RAM без разделения.

---

## Откат инфраструктуры VPN-VPS (если нужно)

```bash
ssh root@194.135.20.35

# 1. Вернуть Xray на :443 (остановит Caddy HTTPS на 443)
docker stop amnezia-xray && docker rm amnezia-xray
docker run -d --name amnezia-xray --privileged --cap-add NET_ADMIN \
  --restart always --network amnezia-dns-net -p 443:443/tcp amnezia-xray
docker network connect bridge amnezia-xray
# восстановить server.json из /root/xray-backup-* если пусто

# 2. Caddy только HTTP :80
cp /etc/caddy/Caddyfile.bak.* /etc/caddy/Caddyfile  # или вручную auto_https off + :80
systemctl reload caddy

# 3. Отключить split DNS
systemctl stop dnsmasq-wg && systemctl disable dnsmasq-wg
# убрать dnsmasq-wg из PostUp в /etc/wireguard/wg0.conf
```

---

## Клиентские конфиги (Mac Desktop)

| Файл | Назначение | Статус |
|------|------------|--------|
| `wg-phone.conf` | iPhone native WG, `10.0.0.3`, `DNS=10.0.0.1`, без `::/0` | **актуальный шаблон** |
| `awg-admin-ios-mobile.conf` | Amnezia AWG peer `10.8.1.7` | устарел для текущей стратегии |
| `wg-phone-split.conf` | сломанный split | **удалён** |

**Private keys в git/MD не класть.** Ключи только в `.conf` на Desktop / у клиента.

---

## Мониторинг

```bash
ssh root@194.135.20.35
free -h
docker stats --no-stream
journalctl -u life-dashboard-api --since "1 hour ago" | tail -30
journalctl -u caddy --since "1 hour ago" | tail -15
wg show wg0
dig +short dash.svodbot.ru A
dig @10.0.0.1 dash.svodbot.ru A +short    # с VPS, для WG-клиентов
```

Успешные запросы с телефона в API-логах: `10.0.0.3` — значит split DNS иногда работает.

---

## Чеклист для агента «смена места выгрузки бота»

- [ ] Выбрать новый хост (не `194.135.20.35` или отдельный IP)
- [ ] Перенести `/opt/life-dashboard/` (api, mini-app, bot, docker postgres)
- [ ] DNS `dash.svodbot.ru` → новый IP
- [ ] Caddy/HTTPS на новом хосте
- [ ] `pg_dump` со старого VPS → новый
- [ ] BotFather: `/setdomain`, Menu Button URL
- [ ] На старом VPS: остановить `life-dashboard-api`, sql-бота, postgres **или** оставить как staging
- [ ] Xray семьи: порт **8443** на старом VPS (если Xray остаётся там)
- [ ] Проверка: mini-app с **включённым VPN** на iPhone — главный критерий

---

## Подключение в новом чате

```
@.cursor/context_miniapp_phone_vpn.md
@.cursor/context_bot_miniapp.md
@deploy/DEPLOY_SQL_MINIAPP_VPS.md
```

**Задача следующей ветки:** перенести выгрузку бота/mini-app/API **off VPN VPS** `194.135.20.35`.
