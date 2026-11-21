#!/usr/bin/env bash
# Первый деплой бота на VPS с Mac (код + .env + настройка systemd).
# Запуск: cd bot && ./deploy/deploy-first-time.sh
# Вход по паролю: пароль спросят один раз (SSH ControlMaster). Лучше — SSH-ключ (см. DEPLOY_VPS.md).
set -euo pipefail

VPS_USER="${VPS_USER:-root}"
VPS_HOST="${VPS_HOST:-194.135.20.35}"
REMOTE_DIR="/opt/life-dashboard/bot"
TZ="${TZ:-Europe/Moscow}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${BOT_DIR}/.env"

# shellcheck source=ssh-common.sh
source "${SCRIPT_DIR}/ssh-common.sh"

cleanup() { life_dashboard_ssh_close; }
trap cleanup EXIT

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Нет ${ENV_FILE}. Создай из .env.example и заполни BOT_TOKEN, SHEETS_API_URL."
  exit 1
fi

life_dashboard_ssh_init

echo "→ SSH ${VPS_USER}@${VPS_HOST} (при запросе введи пароль root — один раз на весь скрипт)"
life_dashboard_ssh "${VPS_USER}@${VPS_HOST}" "echo SSH OK"

echo "→ Каталог на VPS"
life_dashboard_ssh "${VPS_USER}@${VPS_HOST}" "mkdir -p ${REMOTE_DIR}"

echo "→ Синхронизация кода (без .env и .venv)"
rsync -avz --delete -e "${RSYNC_RSH}" \
  --exclude '.venv' \
  --exclude '.env' \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  --exclude 'notification_settings.json' \
  "${BOT_DIR}/" "${VPS_USER}@${VPS_HOST}:${REMOTE_DIR}/"

echo "→ Копирование .env (только на сервер, не в git)"
life_dashboard_scp "${ENV_FILE}" "${VPS_USER}@${VPS_HOST}:${REMOTE_DIR}/.env"
life_dashboard_ssh "${VPS_USER}@${VPS_HOST}" "chmod 600 ${REMOTE_DIR}/.env"

echo "→ Первичная настройка на VPS (Python, venv, systemd, Playwright) — может занять несколько минут"
life_dashboard_ssh "${VPS_USER}@${VPS_HOST}" "TZ=${TZ} bash ${REMOTE_DIR}/deploy/vps-first-setup.sh"

echo ""
echo "✓ Бот на VPS. Проверь в Telegram: /start"
echo "  Логи: ssh ${VPS_USER}@${VPS_HOST} 'journalctl -u life-dashboard-bot -f'"
echo "  Останови локальный python main.py на Mac — один токен = один polling."
