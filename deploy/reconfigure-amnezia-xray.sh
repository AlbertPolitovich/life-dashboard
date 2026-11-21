#!/usr/bin/env bash
# Переконфигурация Amnezia Xray на Amsterdam (июнь 2026, Yota-friendly).
# Порт 443 (вместо 8443), SNI www.booking.com (NL/EU, не googletagmanager).
set -euo pipefail

VPS="${VPS:-root@194.135.20.35}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME="/opt/amnezia/amnezia-xray-runtime"
HOST_PORT="${HOST_PORT:-44337}"

echo "→ Backup текущего server.json"
ssh -o ConnectTimeout=20 "$VPS" "mkdir -p ${RUNTIME}/xray /root/xray-backup-\$(date +%Y%m%d) && docker exec amnezia-xray cat /opt/amnezia/xray/server.json > /root/xray-backup-\$(date +%Y%m%d)/server.json 2>/dev/null || true"

echo "→ Заливка server.json + start.sh"
scp -o ConnectTimeout=20 "${ROOT}/deploy/amnezia-xray/server.json" "${VPS}:${RUNTIME}/xray/server.json"
scp -o ConnectTimeout=20 "${ROOT}/deploy/amnezia-xray/start.sh" "${VPS}:${RUNTIME}/start.sh"
ssh -o ConnectTimeout=20 "$VPS" "chmod +x ${RUNTIME}/start.sh"

echo "→ Пересоздание контейнера (host :${HOST_PORT} → container :443)"
ssh -o ConnectTimeout=20 "$VPS" bash -s <<REMOTE
set -euo pipefail
docker stop amnezia-xray 2>/dev/null || true
docker rm amnezia-xray 2>/dev/null || true
docker run -d --name amnezia-xray \
  --privileged --cap-add NET_ADMIN \
  --restart always \
  --network amnezia-dns-net \
  -p ${HOST_PORT}:443/tcp \
  -v ${RUNTIME}:/opt/amnezia \
  --entrypoint dumb-init \
  amnezia-xray:latest \
  /opt/amnezia/start.sh
docker network connect bridge amnezia-xray 2>/dev/null || true
sleep 2
docker exec amnezia-xray pgrep -a xray
ss -tlnp | grep -E ":${HOST_PORT} "
REMOTE

echo "✓ Xray на ${VPS#*@}:${HOST_PORT}, SNI www.booking.com"
echo "  Клиент: deploy/amnezia-xray-client.txt"
