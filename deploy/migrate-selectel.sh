#!/usr/bin/env bash
# Миграция life-dashboard на Selectel VDS (API + mini-app + Postgres + SQL-бот).
# Запуск с Mac (после SSH-ключа или пароля root на новом VPS):
#   ./deploy/migrate-selectel.sh
# Опционально: VPS_HOST=161.104.47.52 DUMP=db/backups/life_dashboard_20260629.sql
set -euo pipefail

VPS_USER="${VPS_USER:-root}"
VPS_HOST="${VPS_HOST:-161.104.47.52}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="/opt/life-dashboard"
COMPOSE="${ROOT}/deploy/docker-compose.vps.yml"
DUMP="${DUMP:-${ROOT}/db/backups/life_dashboard_20260629.sql}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=../bot/deploy/ssh-common.sh
source "${SCRIPT_DIR}/../bot/deploy/ssh-common.sh"
cleanup() { life_dashboard_ssh_close; }
trap cleanup EXIT

if [[ ! -f "${COMPOSE}" ]]; then
  echo "Нет ${COMPOSE}"
  exit 1
fi
if [[ ! -f "${DUMP}" ]]; then
  echo "Нет дампа: ${DUMP}"
  exit 1
fi

POSTGRES_PASSWORD="$(grep 'POSTGRES_PASSWORD:' "${COMPOSE}" | head -1 | sed 's/.*POSTGRES_PASSWORD:[[:space:]]*//')"
if [[ -z "${POSTGRES_PASSWORD}" ]]; then
  echo "Задай POSTGRES_PASSWORD в ${COMPOSE}"
  exit 1
fi
DATABASE_URL="postgresql://lifeapp:${POSTGRES_PASSWORD}@127.0.0.1:5432/life_dashboard"

life_dashboard_ssh_init
echo "→ SSH ${VPS_USER}@${VPS_HOST}"
life_dashboard_ssh "${VPS_USER}@${VPS_HOST}" "mkdir -p ${REMOTE} && echo OK"

echo "→ db/ + docker-compose.yml"
rsync -avz -e "${RSYNC_RSH}" \
  --exclude 'backups' \
  "${ROOT}/db/" "${VPS_USER}@${VPS_HOST}:${REMOTE}/db/"
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
mkdir -p /opt/life-dashboard
cd /opt/life-dashboard
docker compose up -d
REMOTE_DOCKER

echo "→ Восстановление БД из дампа"
life_dashboard_scp "${DUMP}" "${VPS_USER}@${VPS_HOST}:/tmp/life_dashboard_restore.sql"
life_dashboard_ssh "${VPS_USER}@${VPS_HOST}" \
  'docker exec -i life_dashboard_pg psql -U lifeapp -d life_dashboard -v ON_ERROR_STOP=1 < /tmp/life_dashboard_restore.sql'

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

echo "→ api/.env + !bot_SQL/.env.sql"
life_dashboard_ssh "${VPS_USER}@${VPS_HOST}" bash -s <<REMOTE_ENV
set -euo pipefail
cat > ${REMOTE}/api/.env <<EOF
DATABASE_URL=${DATABASE_URL}
EOF
chmod 600 ${REMOTE}/api/.env
REMOTE_ENV

if [[ ! -f "${ROOT}/!bot_SQL/.env.sql" ]]; then
  echo "Нет ${ROOT}/!bot_SQL/.env.sql — создай с Mac"
  exit 1
fi
life_dashboard_scp "${ROOT}/!bot_SQL/.env.sql" "${VPS_USER}@${VPS_HOST}:${REMOTE}/!bot_SQL/.env.sql"
life_dashboard_ssh "${VPS_USER}@${VPS_HOST}" bash -s <<REMOTE_SQL_ENV
set -euo pipefail
ENV_FILE="${REMOTE}/!bot_SQL/.env.sql"
if grep -q '^DATABASE_URL=' "\$ENV_FILE"; then
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=${DATABASE_URL}|" "\$ENV_FILE"
else
  echo "DATABASE_URL=${DATABASE_URL}" >> "\$ENV_FILE"
fi
chmod 600 "\$ENV_FILE"
REMOTE_SQL_ENV

echo "→ Python venv + lifebot"
life_dashboard_ssh "${VPS_USER}@${VPS_HOST}" bash -s <<'REMOTE_VENV'
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
REMOTE_VENV

echo "→ systemd: API + SQL-бот"
life_dashboard_scp "${SCRIPT_DIR}/life-dashboard-api.service" \
  "${VPS_USER}@${VPS_HOST}:/etc/systemd/system/life-dashboard-api.service"
life_dashboard_scp "${SCRIPT_DIR}/life-dashboard-sql-bot.service" \
  "${VPS_USER}@${VPS_HOST}:/etc/systemd/system/life-dashboard-sql-bot.service"
life_dashboard_ssh "${VPS_USER}@${VPS_HOST}" \
  'systemctl daemon-reload && systemctl enable life-dashboard-api life-dashboard-sql-bot && systemctl restart life-dashboard-api life-dashboard-sql-bot'

echo "→ Caddy (HTTP :80, CF Flexible)"
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
if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw --force enable || true
fi
REMOTE_CADDY
life_dashboard_scp "${SCRIPT_DIR}/Caddyfile.svodbot" "${VPS_USER}@${VPS_HOST}:/etc/caddy/Caddyfile"
life_dashboard_ssh "${VPS_USER}@${VPS_HOST}" 'systemctl enable caddy && systemctl reload caddy'

echo "→ Проверка на новом IP"
sleep 3
life_dashboard_ssh "${VPS_USER}@${VPS_HOST}" bash -s <<'REMOTE_CHECK'
set -euo pipefail
curl -sf http://127.0.0.1:8765/health
docker exec life_dashboard_pg psql -U lifeapp -d life_dashboard -tAc "SELECT count(*) FROM nutrition_log"
systemctl is-active life-dashboard-api life-dashboard-sql-bot caddy
REMOTE_CHECK
curl -sf --resolve "dash.svodbot.ru:80:${VPS_HOST}" "http://dash.svodbot.ru/health" && echo ""
curl -s -o /dev/null -w "mini-app %{http_code}\n" --resolve "dash.svodbot.ru:80:${VPS_HOST}" "http://dash.svodbot.ru/mini-app/"

echo ""
echo "✓ Selectel готов: ${VPS_HOST}"
echo "  Дальше вручную: Cloudflare DNS dash → ${VPS_HOST}"
echo "  VPN VPS: dnsmasq-wg dash → ${VPS_HOST}"
echo "  Старый VPS: stop life-dashboard-api, life-dashboard-sql-bot (после DNS)"
