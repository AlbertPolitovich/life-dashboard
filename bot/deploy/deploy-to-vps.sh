#!/usr/bin/env bash
# Деплой/обновление бота на VPS с Mac. Запуск из bot/: ./deploy/deploy-to-vps.sh
set -euo pipefail

VPS_USER="${VPS_USER:-root}"
VPS_HOST="${VPS_HOST:-194.135.20.35}"
REMOTE_DIR="/opt/life-dashboard/bot"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# shellcheck source=ssh-common.sh
source "${SCRIPT_DIR}/ssh-common.sh"

cleanup() { life_dashboard_ssh_close; }
trap cleanup EXIT

life_dashboard_ssh_init

echo "→ SSH (пароль — один раз, если нет ключа)"
life_dashboard_ssh "${VPS_USER}@${VPS_HOST}" "echo OK"

echo "→ Синхронизация ${BOT_DIR} → ${VPS_USER}@${VPS_HOST}:${REMOTE_DIR}"
rsync -avz --delete -e "${RSYNC_RSH}" \
  --exclude '.venv' \
  --exclude '.env' \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  --exclude 'notification_settings.json' \
  "${BOT_DIR}/" "${VPS_USER}@${VPS_HOST}:${REMOTE_DIR}/"

echo "→ Перезапуск сервиса на VPS"
life_dashboard_ssh "${VPS_USER}@${VPS_HOST}" "systemctl restart life-dashboard-bot && systemctl is-active life-dashboard-bot"

echo "✓ Готово. Логи: ssh ${VPS_USER}@${VPS_HOST} 'journalctl -u life-dashboard-bot -f'"
