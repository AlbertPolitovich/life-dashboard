#!/usr/bin/env bash
# Первичная настройка VPS (запускается НА СЕРВЕРЕ или через deploy-first-time.sh).
set -euo pipefail

BOT_DIR="/opt/life-dashboard/bot"
TZ="${TZ:-Europe/Moscow}"

if [[ ! -f "${BOT_DIR}/.env" ]]; then
  echo "Сначала создай ${BOT_DIR}/.env (BOT_TOKEN, SHEETS_API_URL)"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y \
  python3 python3-venv python3-pip rsync \
  libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libgbm1 libasound2t64

id lifebot &>/dev/null || useradd --system --home "${BOT_DIR}" --shell /usr/sbin/nologin lifebot

cd "${BOT_DIR}"
python3 -m venv .venv
./.venv/bin/pip install --upgrade pip
./.venv/bin/pip install -r requirements.txt

# Графики по воскресеньям (Playwright + Chromium). На 1 ГБ RAM — тяжело, но обычно хватает.
./.venv/bin/python -m playwright install-deps chromium || true
./.venv/bin/python -m playwright install chromium

chown -R lifebot:lifebot "${BOT_DIR}"

sed "s|Environment=TZ=.*|Environment=TZ=${TZ}|" "${BOT_DIR}/deploy/life-dashboard-bot.service" \
  > /etc/systemd/system/life-dashboard-bot.service

systemctl daemon-reload
systemctl enable life-dashboard-bot
systemctl restart life-dashboard-bot

echo "Статус:"
systemctl status life-dashboard-bot --no-pager || true
