#!/usr/bin/env bash
# Одноразовая настройка Amsterdam: API + Caddy на 10.0.0.1:443 (VPN-путь).
# После: deploy-dual.sh amsterdam для обновлений кода.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AMSTERDAM_HOST="${AMSTERDAM_HOST:-194.135.20.35}"
SELECTEL_HOST="${SELECTEL_HOST:-161.104.47.52}"
REMOTE="/opt/life-dashboard"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE="${ROOT}/deploy/docker-compose.vps.yml"

# shellcheck source=../bot/deploy/ssh-common.sh
source "${SCRIPT_DIR}/../bot/deploy/ssh-common.sh"

POSTGRES_PASSWORD="$(grep 'POSTGRES_PASSWORD:' "${COMPOSE}" | head -1 | sed 's/.*POSTGRES_PASSWORD:[[:space:]]*//')"
AMSTERDAM_DB_URL="postgresql://lifeapp:${POSTGRES_PASSWORD}@${SELECTEL_HOST}:5432/life_dashboard"

life_dashboard_ssh_init
VPS_USER=root
VPS_HOST="${AMSTERDAM_HOST}"
VPS="root@${AMSTERDAM_HOST}"

echo "→ Код api + mini-app"
"${SCRIPT_DIR}/deploy-dual.sh" amsterdam

echo "→ venv + systemd (если ещё нет)"
life_dashboard_ssh "$VPS" bash -s <<'REMOTE'
set -euo pipefail
apt-get update -qq
apt-get install -y -qq python3-venv python3-pip
cd /opt/life-dashboard/bot
test -d .venv || python3 -m venv .venv
./.venv/bin/pip install -q --upgrade pip
./.venv/bin/pip install -q -r requirements.txt
./.venv/bin/pip install -q -r /opt/life-dashboard/api/requirements.txt
id lifebot &>/dev/null || useradd --system --home /opt/life-dashboard --shell /usr/sbin/nologin lifebot
chown -R lifebot:lifebot /opt/life-dashboard
REMOTE

life_dashboard_scp "${SCRIPT_DIR}/life-dashboard-api.service" \
  "${VPS}:/etc/systemd/system/life-dashboard-api.service"

life_dashboard_ssh "$VPS" bash -s <<REMOTE
set -euo pipefail
cat > ${REMOTE}/api/.env <<EOF
DATABASE_URL=${AMSTERDAM_DB_URL}
EOF
chmod 600 ${REMOTE}/api/.env
chown lifebot:lifebot ${REMOTE}/api/.env
systemctl daemon-reload
systemctl enable life-dashboard-api
systemctl restart life-dashboard-api
REMOTE

echo "→ Сертификаты с Selectel"
bash "${SCRIPT_DIR}/sync-certs-to-amsterdam.sh"

echo "→ Caddy VPN (10.0.0.1:443), отключаем socat-proxy"
life_dashboard_scp "${SCRIPT_DIR}/Caddyfile.svodbot-vpn" "${VPS}:/etc/caddy/Caddyfile"
life_dashboard_ssh "$VPS" bash -s <<'REMOTE'
set -euo pipefail
systemctl stop dash-selectel-proxy 2>/dev/null || true
systemctl disable dash-selectel-proxy 2>/dev/null || true
systemctl enable caddy
systemctl restart caddy
REMOTE

life_dashboard_ssh_close

echo "→ Проверка Amsterdam"
sleep 2
ssh -o ConnectTimeout=15 "root@${AMSTERDAM_HOST}" \
  "curl -sf http://127.0.0.1:8765/health && curl -sf --resolve dash.svodbot.ru:443:10.0.0.1 https://dash.svodbot.ru/health"

echo "✓ Amsterdam VPN API готов. Публичный путь без изменений (Selectel)."
