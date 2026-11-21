# VPN / WG / mini-app — сжатый контекст (июнь–июль 2026)

> Связано: **`@.cursor/context_bot_miniapp.md`** · **`@.cursor/context_miniapp_phone_vpn.md`** (детальный лог инцидентов)

**Вывод:** лаги mini-app с VPN были из‑за **протокола/маршрута VPN**, не из‑за Selectel, кода или БД. Рабочее решение — **Xray VLESS Reality** (Amnezia). WG-костыли на NL **сняты**.

---

## Симптом

| Сценарий | Результат |
|----------|-----------|
| Mac / телефон **без VPN** + TG mini-app | ✅ идеально |
| Телефон **WG full tunnel** (`0.0.0.0/0`) + TG | ❌ лаги, таймауты |
| **Xray VLESS** (Yota LTE) + TG | ✅ стабильно 2+ дня |

Причина WG: `iPhone → NL (Amsterdam) → RU (Selectel) → NL` на каждый `fetch`. Не hairpin через Cloudflare — **лишний cross-border RTT** при full tunnel.

---

## Что пробовали (и зачем отказались)

| Попытка | Итог |
|---------|------|
| Перенос API+БД на Selectel (РФ) | Без VPN ок; с WG всё равно NL↔RU |
| Cloudflare redirect loop → grey cloud + LE | Починили DNS/HTTPS, на WG-лаг не влияло |
| `dnsmasq`: dash → `10.0.0.1` + **socat** на Selectel | DNS ок, трафик всё равно NL→RU |
| **Dual API** на Amsterdam (локальный API для WG) | Работало теоретически; **выключено** — лишняя сложность после Xray |
| `AllowedIPs` bypass Selectel (32 маршрута) | **Ломает интернет на iOS** |
| Amnezia Xray `:8443` + googletagmanager SNI | **Заблокировано** на Yota (июнь 2026) |
| Amnezia split routing для dash | Не делали; Xray решил проблему |

---

## Что сработало

### 1. Xray VLESS Reality (основной VPN)

- **Сервер:** Amsterdam `194.135.20.35:44337`
- **SNI:** `www.booking.com` (было `googletagmanager.com`, порт `8443`)
- **Импорт:** `deploy/amsterdam-xray-import.json` · `deploy/amsterdam-xray.vless`
- **Пересборка ключей:** `python3 deploy/build-amnezia-import.py`
- **Переустановка на VPS:** `deploy/reconfigure-amnezia-xray.sh`

### 2. Mac WireGuard toggle (Raycast)

Старый скрипт кликал menu bar WireGuard → **Assistive Access denied**.  
Исправлено: `~/toggle_vpn.sh` через `scutil --nc start/stop "mac_client"`.  
Raycast: `~/Documents/script.sh`.

---

## Текущая архитектура (июль 2026)

```
ТЕЛЕФОН (WireGuard)
        │
        ▼
SELECTEL 161.104.47.52 (РФ) — RU gateway
├─ wg-clients :51830 (10.10.0.0/24)
├─ sing-box split: RU → direct, остальное → wg-nl
├─ dnsmasq 10.10.0.1 (dash.svodbot.ru → 161.104.47.52)
├─ Postgres, API, mini-app, Caddy
└─ wg-nl → AMSTERDAM 194.135.20.35:51822

AMSTERDAM 194.135.20.35 (NL) — exit-node
├─ wg-nl (MASQUERADE 10.10.0.0/24 → eth0)
├─ Xray VLESS :44337  ← запасной VPN (Wi‑Fi / семья)
├─ WireGuard :51820   ← Mac
└─ Amnezia AWG :35820
```

| Компонент | Где |
|-----------|-----|
| БД | только Selectel |
| API + mini-app | только Selectel |
| VPN телефон (новый) | **WG → Selectel** (`~/Desktop/wg-ru-gateway.conf`) |
| VPN телефон (запасной) | Xray VLESS Reality |
| VPN Mac | WG `mac_client` (10.0.0.2) или Xray |

**Деплой split VPN:** `deploy/setup-ru-nl-split-vpn.sh` · `deploy/enable-geoip-split.sh`  
**Конфиги:** `deploy/ru-nl-vpn/sing-box.json`, `wg-postup.sh`, `wg-postdown.sh`  
**Split:** sing-box tproxy + remote rule-sets `geoip-ru`, `geosite-category-ru` (auto-update)

**Деплой кода:** `./deploy/deploy-dual.sh` (только Selectel).  
**Снять NL-костыли снова:** уже сделано — `deploy/teardown-amsterdam-api.sh`.

---

## Будущее (идеи)

1. **Коммерческий КБЖУ-mini-app** — БД в РФ уже есть.
2. **VLESS Reality вход на Selectel** — если Yota начнёт резать WG до RU.
3. **xHTTP inbound на Amsterdam** — если Xray TCP Reality окончательно умрёт на мобилке.

---

## Файлы

| Файл | Назначение |
|------|------------|
| `deploy/deploy-dual.sh` | деплой API+UI на Selectel |
| `deploy/teardown-amsterdam-api.sh` | убрать NL API/БД |
| `deploy/amsterdam-xray-import.json` | импорт Xray в Amnezia |
| `deploy/reconfigure-amnezia-xray.sh` | Xray на VPS |
| `~/toggle_vpn.sh` | Raycast WG toggle Mac |
| `deploy/setup-ru-nl-split-vpn.sh` | RU gateway: WG + sing-box split |
| `~/Desktop/wg-ru-gateway.conf` | WG телефон → Selectel (основной тест) |
| `~/Desktop/wg-phone.conf` | WG телефон → Amsterdam (legacy) |

---

## Не откатывать / не повторять

- Dual API на Amsterdam для WG-mini-app
- `wg-phone-selectel-bypass.conf` на iOS
- Amnezia `:8443` + дефолтный SNI
- Деплой API на оба VPS «на всякий случай»
