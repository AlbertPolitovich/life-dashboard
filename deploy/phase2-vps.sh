#!/usr/bin/env bash
# Фаза 2: Postgres + API + Mini App + HTTPS на VPS.
# Запуск с Mac: ./deploy/phase2-vps.sh
set -euo pipefail

VPS_USER="${VPS_USER:-root}"
VPS_HOST="${VPS_HOST:-194.135.20.35}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="/opt/life-dashboard"
COMPOSE="${ROOT}/deploy/docker-compose.vps.yml"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../bot/deploy/ssh-common.sh
source "${SCRIPT_DIR}/../bot/deploy/ssh-common.sh"

cleanup() { life_dashboard_ssh_close; }
trap cleanup EXIT

life_dashboard_ssh_init

if [[ ! -f "${COMPOSE}" ]]; then
  echo "Нет ${COMPOSE}"
  exit 1
fi

POSTGRES_PASSWORD="$(grep 'POSTGRES_PASSWORD:' "${COMPOSE}" | head -1 | sed 's/.*POSTGRES_PASSWORD:[[:space:]]*//')"
if [[ -z "${POSTGRES_PASSWORD}" || "${POSTGRES_PASSWORD}" == REPLACE_WITH_STRONG_PASSWORD ]]; then
  echo "Задай POSTGRES_PASSWORD в ${COMPOSE}"
  exit 1
fi

DATABASE_URL="postgresql://lifeapp:${POSTGRES_PASSWORD}@127.0.0.1:5432/life_dashboard"

echo "→ SSH (пароль VPS — один раз, если ключ не добавлен)"
life_dashboard_ssh "${VPS_USER}@${VPS_HOST}" "echo OK"

echo "→ db/ + docker-compose.yml"
rsync -avz -e "${RSYNC_RSH}" "${ROOT}/db/" "${VPS_USER}@${VPS_HOST}:${REMOTE}/db/"
rsync -avz -e "${RSYNC_RSH}" "${COMPOSE}" "${VPS_USER}@${VPS_HOST}:${REMOTE}/docker-compose.yml"

echo "→ Docker + Postgres"
life_dashboard_ssh "${VPS_USER}@${VPS_HOST}" bash -s <<'REMOTE_DOCKER'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi
if ! docker compose version >/dev/null 2>&1; then
  apt-get update
  apt-get install -y docker-compose
fi
mkdir -p /opt/life-dashboard
cd /opt/life-dashboard
if docker compose version >/dev/null 2>&1; then
  docker compose up -d
else
  docker-compose up -d
fi
REMOTE_DOCKER

echo "→ Firewall (22, 80, 443)"
life_dashboard_ssh "${VPS_USER}@${VPS_HOST}" bash -s <<'REMOTE_UFW'
set -euo pipefail
if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
  ufw status
fi
REMOTE_UFW

echo "→ API + mini-app + bot + !bot_SQL"
rsync -avz --delete -e "${RSYNC_RSH}" \
  --exclude '.venv' --exclude '__pycache__' --exclude '*.pyc' --exclude '.env' \
  "${ROOT}/api/" "${VPS_USER}@${VPS_HOST}:${REMOTE}/api/"
rsync -avz --delete -e "${RSYNC_RSH}" \
  "${ROOT}/mini-app/" "${VPS_USER}@${VPS_HOST}:${REMOTE}/mini-app/"
rsync -avz -e "${RSYNC_RSH}" \
  --exclude '.venv' --exclude '__pycache__' --exclude '.env' \
  "${ROOT}/bot/" "${VPS_USER}@${VPS_HOST}:${REMOTE}/bot/"
rsync -avz -e "${RSYNC_RSH}" \
  --exclude '.env.sql' \
  "${ROOT}/!bot_SQL/" "${VPS_USER}@${VPS_HOST}:${REMOTE}/!bot_SQL/"
if [[ -f "${ROOT}/index-sql.html" ]]; then
  rsync -avz -e "${RSYNC_RSH}" "${ROOT}/index-sql.html" "${VPS_USER}@${VPS_HOST}:${REMOTE}/"
fi

echo "→ api/.env"
life_dashboard_ssh "${VPS_USER}@${VPS_HOST}" bash -s <<REMOTE_ENV
set -euo pipefail
cat > ${REMOTE}/api/.env <<EOF
DATABASE_URL=${DATABASE_URL}
EOF
chmod 600 ${REMOTE}/api/.env
REMOTE_ENV

echo "→ Python venv + lifebot"
life_dashboard_ssh "${VPS_USER}@${VPS_HOST}" bash -s <<'REMOTE_VENV'
set -euo pipefail
cd /opt/life-dashboard/bot
test -d .venv || python3 -m venv .venv
./.venv/bin/pip install -q --upgrade pip
./.venv/bin/pip install -q -r requirements.txt
./.venv/bin/pip install -q -r /opt/life-dashboard/api/requirements.txt
id lifebot &>/dev/null || useradd --system --home /opt/life-dashboard --shell /usr/sbin/nologin lifebot
chown -R lifebot:lifebot /opt/life-dashboard
REMOTE_VENV

echo "→ systemd: life-dashboard-api"
life_dashboard_scp "${SCRIPT_DIR}/life-dashboard-api.service" \
  "${VPS_USER}@${VPS_HOST}:/etc/systemd/system/life-dashboard-api.service"
life_dashboard_ssh "${VPS_USER}@${VPS_HOST}" \
  'systemctl daemon-reload && systemctl enable life-dashboard-api && systemctl restart life-dashboard-api'

echo "→ Caddy + HTTPS"
life_dashboard_ssh "${VPS_USER}@${VPS_HOST}" bash -s <<'REMOTE_CADDY'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if ! command -v caddy >/dev/null 2>&1; then
  apt-get update
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi
REMOTE_CADDY
life_dashboard_scp "${SCRIPT_DIR}/Caddyfile.svodbot" "${VPS_USER}@${VPS_HOST}:/etc/caddy/Caddyfile"
life_dashboard_ssh "${VPS_USER}@${VPS_HOST}" 'systemctl enable caddy && systemctl reload caddy'

echo "→ Проверка"
sleep 3
curl -sf "https://dash.svodbot.ru/health" && echo ""
curl -s -o /dev/null -w "mini-app HTTP %{http_code}\n" "https://dash.svodbot.ru/mini-app/"

echo "✓ Фаза 2 готова. Дальше: pg_dump с Mac (фаза 3 в DEPLOY_SQL_MINIAPP_VPS.md)"
