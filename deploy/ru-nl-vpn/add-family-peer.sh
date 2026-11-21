#!/usr/bin/env bash
# Добавить peer для члена семьи (уникальный ключ + IP 10.10.0.x)
set -euo pipefail
NAME="${1:-family}"
WG_CONF="/etc/wireguard/wg-clients.conf"
CLIENTS_DIR="/opt/ru-nl-vpn/clients"
SERVER_PUB=$(wg show wg-clients public-key)

# Найти свободный IP 10.10.0.3–10.10.0.254
for i in $(seq 3 254); do
  IP="10.10.0.${i}"
  if ! grep -q "AllowedIPs = ${IP}/32" "$WG_CONF" 2>/dev/null; then
    break
  fi
done

PRIV=$(wg genkey)
PUB=$(echo "$PRIV" | wg pubkey)

cat >> "$WG_CONF" <<EOF

[Peer]
# ${NAME}
PublicKey = ${PUB}
AllowedIPs = ${IP}/32
EOF

wg syncconf wg-clients <(wg-quick strip wg-clients)

mkdir -p "$CLIENTS_DIR"
OUT="${CLIENTS_DIR}/wg-ru-${NAME}.conf"
cat > "$OUT" <<CLIENT
[Interface]
PrivateKey = ${PRIV}
Address = ${IP}/32
DNS = 10.10.0.1

[Peer]
PublicKey = ${SERVER_PUB}
Endpoint = 161.104.47.52:51830
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
CLIENT
chmod 600 "$OUT"

echo "✓ Peer ${NAME}: ${IP}/32"
echo "  Config: ${OUT}"
