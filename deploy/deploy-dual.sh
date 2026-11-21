#!/usr/bin/env bash
# Деплой mini-app + API на Selectel (единственный фронт).
# Amsterdam: только бот + VPN (Xray/WG) — без API/БД.
#
#   ./deploy/deploy-dual.sh           # Selectel (по умолчанию)
#   ./deploy/deploy-dual.sh selectel  # то же
#
# Убрать API/БД с Amsterdam: ./deploy/teardown-amsterdam-api.sh
#
# Перед деплоем: bump ?v= в mini-app/index.html
set -euo pipefail

TARGET="${1:-selectel}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="/opt/life-dashboard"
SELECTEL_HOST="${SELECTEL_HOST:-161.104.47.52}"
AMSTERDAM_HOST="${AMSTERDAM_HOST:-194.135.20.35}"
COMPOSE="${ROOT}/deploy/docker-compose.vps.yml"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=../bot/deploy/ssh-common.sh
source "${SCRIPT_DIR}/../bot/deploy/ssh-common.sh"

POSTGRES_PASSWORD="$(grep 'POSTGRES_PASSWORD:' "${COMPOSE}" | head -1 | sed 's/.*POSTGRES_PASSWORD:[[:space:]]*//')"
if [[ -z "${POSTGRES_PASSWORD}" ]]; then
  echo "Задай POSTGRES_PASSWORD в ${COMPOSE}"
  exit 1
fi

SELECTEL_DB_URL="postgresql://lifeapp:${POSTGRES_PASSWORD}@127.0.0.1:5432/life_dashboard"
AMSTERDAM_DB_URL="postgresql://lifeapp:${POSTGRES_PASSWORD}@${SELECTEL_HOST}:5432/life_dashboard"

deploy_code() {
  local host="$1"
  local user="${2:-root}"
  echo "→ rsync api + mini-app → ${user}@${host}"
  rsync -avz --delete -e "${RSYNC_RSH}" \
    --exclude '.venv' --exclude '__pycache__' --exclude '*.pyc' --exclude '.env' \
    "${ROOT}/api/" "${user}@${host}:${REMOTE}/api/"
  rsync -avz --delete -e "${RSYNC_RSH}" \
    "${ROOT}/mini-app/" "${user}@${host}:${REMOTE}/mini-app/"
}

restart_api() {
  local host="$1"
  local user="${2:-root}"
  life_dashboard_ssh "${user}@${host}" \
    'chown -R lifebot:lifebot /opt/life-dashboard/api /opt/life-dashboard/mini-app 2>/dev/null || true; systemctl restart life-dashboard-api'
}

# Merge api/.env on VPS: keep existing DATABASE_URL (prod password), refresh LD_ACCESS_TOKEN.
write_api_env() {
  local host="$1"
  local db_url="$2"
  local tmp_token
  tmp_token="$(mktemp)"
  if [[ -f "${ROOT}/api/.env" ]]; then
    grep -E '^LD_ACCESS_TOKEN=.+' "${ROOT}/api/.env" | head -1 >"${tmp_token}" || true
  else
    : >"${tmp_token}"
  fi
  life_dashboard_scp "${tmp_token}" "root@${host}:/tmp/ld_access_token.line"
  rm -f "${tmp_token}"
  life_dashboard_ssh "root@${host}" bash -s <<REMOTE
set -euo pipefail
ENV_FILE="${REMOTE}/api/.env"
FALLBACK_DB='DATABASE_URL=${db_url}'
EXISTING_DB=""
if [[ -f "\$ENV_FILE" ]]; then
  EXISTING_DB="\$(grep -E '^DATABASE_URL=.+' "\$ENV_FILE" | head -1 || true)"
fi
TOKEN_LINE="\$(cat /tmp/ld_access_token.line 2>/dev/null || true)"
if [[ -z "\$TOKEN_LINE" && -f "\$ENV_FILE" ]]; then
  TOKEN_LINE="\$(grep -E '^LD_ACCESS_TOKEN=.+' "\$ENV_FILE" | head -1 || true)"
fi
{
  if [[ -n "\$EXISTING_DB" ]]; then echo "\$EXISTING_DB"; else echo "\$FALLBACK_DB"; fi
  if [[ -n "\$TOKEN_LINE" ]]; then echo "\$TOKEN_LINE"; fi
} >"\$ENV_FILE"
chmod 600 "\$ENV_FILE"
chown lifebot:lifebot "\$ENV_FILE" 2>/dev/null || true
rm -f /tmp/ld_access_token.line
grep -E '^[A-Z_]+=' "\$ENV_FILE" | cut -d= -f1
REMOTE
}

deploy_selectel() {
  echo "═══ Selectel ${SELECTEL_HOST} (публичный, БД) ═══"
  VPS_USER=root
  VPS_HOST="${SELECTEL_HOST}"
  life_dashboard_ssh_init
  life_dashboard_ssh "root@${SELECTEL_HOST}" "mkdir -p ${REMOTE}"
  deploy_code "${SELECTEL_HOST}"
  write_api_env "${SELECTEL_HOST}" "${SELECTEL_DB_URL}"
  restart_api "${SELECTEL_HOST}"
  life_dashboard_ssh_close
  echo "✓ Selectel"
}

deploy_amsterdam() {
  echo "═══ Amsterdam ${AMSTERDAM_HOST} (VPN + бот) ═══"
  VPS_USER=root
  VPS_HOST="${AMSTERDAM_HOST}"
  life_dashboard_ssh_init
  life_dashboard_ssh "root@${AMSTERDAM_HOST}" "mkdir -p ${REMOTE}"
  deploy_code "${AMSTERDAM_HOST}"
  life_dashboard_ssh "root@${AMSTERDAM_HOST}" bash -s <<REMOTE
set -euo pipefail
cat > ${REMOTE}/api/.env <<EOF
DATABASE_URL=${AMSTERDAM_DB_URL}
EOF
chmod 600 ${REMOTE}/api/.env
chown lifebot:lifebot ${REMOTE}/api/.env
REMOTE
  restart_api "${AMSTERDAM_HOST}"
  life_dashboard_ssh_close
  echo "✓ Amsterdam"
}

echo "Life Dashboard · dual deploy (target: ${TARGET})"
echo "Напоминание: bump ?v= в mini-app/index.html перед деплоем UI"
echo

case "${TARGET}" in
  selectel|rf|ru|all|both|"")
    deploy_selectel
  ;;
  amsterdam|nl|vpn)
    echo "Amsterdam API отключён. Используй: $0 selectel"
    exit 1
  ;;
  *)
    echo "Неизвестный target: ${TARGET}"
    echo "Использование: $0 [all|selectel|amsterdam]"
    exit 1
  ;;
esac

echo
echo "Проверка:"
echo "  curl -sf https://dash.svodbot.ru/health"
echo "  ssh root@${SELECTEL_HOST} curl -sf http://127.0.0.1:8765/health"
