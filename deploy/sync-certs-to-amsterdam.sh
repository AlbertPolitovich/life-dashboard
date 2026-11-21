#!/usr/bin/env bash
# Копирует LE-сертификат dash.svodbot.ru с Selectel на Amsterdam (для VPN HTTPS на 10.0.0.1).
# Запуск с Mac после обновления серта на Selectel (раз в ~60 дней или по cron).
set -euo pipefail

SELECTEL="${SELECTEL:-root@161.104.47.52}"
AMSTERDAM="${AMSTERDAM:-root@194.135.20.35}"
CERT_DIR="/var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory/dash.svodbot.ru"
REMOTE_CERT="/etc/caddy/certs"

ssh -o ConnectTimeout=15 "$SELECTEL" "test -f ${CERT_DIR}/dash.svodbot.ru.crt"
ssh -o ConnectTimeout=15 "$AMSTERDAM" "mkdir -p ${REMOTE_CERT} && chmod 755 ${REMOTE_CERT}"

scp -o ConnectTimeout=15 \
  "${SELECTEL}:${CERT_DIR}/dash.svodbot.ru.crt" \
  "${SELECTEL}:${CERT_DIR}/dash.svodbot.ru.key" \
  /tmp/

scp -o ConnectTimeout=15 \
  /tmp/dash.svodbot.ru.crt /tmp/dash.svodbot.ru.key \
  "${AMSTERDAM}:${REMOTE_CERT}/"

ssh -o ConnectTimeout=15 "$AMSTERDAM" bash -s <<'REMOTE'
set -euo pipefail
chown root:caddy /etc/caddy/certs/dash.svodbot.ru.*
chmod 640 /etc/caddy/certs/dash.svodbot.ru.key
chmod 644 /etc/caddy/certs/dash.svodbot.ru.crt
systemctl reload caddy
REMOTE

rm -f /tmp/dash.svodbot.ru.crt /tmp/dash.svodbot.ru.key
echo "✓ Сертификаты на Amsterdam, caddy reload"
