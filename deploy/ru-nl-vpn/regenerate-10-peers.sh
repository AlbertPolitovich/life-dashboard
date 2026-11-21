#!/usr/bin/env bash
# 10 новых WG peer (_0.._9), старые peer полностью удаляются
set -euo pipefail

WG_CONF="/etc/wireguard/wg-clients.conf"
CLIENTS_DIR="/opt/ru-nl-vpn/clients/wg-ru-gateway"
PRIV_KEY=$(awk -F' = ' '/^PrivateKey/{print $2}' "$WG_CONF")
SERVER_PUB=$(wg show wg-clients public-key 2>/dev/null || wg pubkey <<< "$PRIV_KEY")

rm -rf "$CLIENTS_DIR"
mkdir -p "$CLIENTS_DIR"

cat > "$WG_CONF" <<EOF
[Interface]
Address = 10.10.0.1/24
ListenPort = 51830
PrivateKey = ${PRIV_KEY}
PostUp = /opt/ru-nl-vpn/wg-postup.sh
PostDown = /opt/ru-nl-vpn/wg-postdown.sh

EOF

for i in $(seq 0 9); do
  IP="10.10.0.$((10 + i))"
  PRIV=$(wg genkey)
  PUB=$(echo "$PRIV" | wg pubkey)

  cat >> "$WG_CONF" <<EOF
[Peer]
# user_${i}
PublicKey = ${PUB}
AllowedIPs = ${IP}/32

EOF

  cat > "${CLIENTS_DIR}/wg-ru-gateway_${i}.conf" <<CLIENT
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
  chmod 600 "${CLIENTS_DIR}/wg-ru-gateway_${i}.conf"
done

wg-quick down wg-clients 2>/dev/null || true
wg-quick up wg-clients

echo "✓ 10 peers: 10.10.0.10 – 10.10.0.19"
wg show wg-clients | grep -E "peer:|allowed"
