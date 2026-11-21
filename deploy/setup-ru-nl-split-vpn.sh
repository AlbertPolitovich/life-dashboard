#!/usr/bin/env bash
# RU (Selectel) → NL (Amsterdam) split VPN gateway
# Телефон: WG → Selectel → RU-сайты direct, остальное → NL exit
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELECTEL="${SELECTEL:-root@161.104.47.52}"
AMSTERDAM="${AMSTERDAM:-root@194.135.20.35}"
RUNTIME="/opt/ru-nl-vpn"
CLIENT_PORT=51830
SITE_PORT=51822

echo "=== 1. Генерация ключей на Selectel ==="
ssh -o ConnectTimeout=20 "$SELECTEL" "mkdir -p ${RUNTIME}/keys"
ssh -o ConnectTimeout=20 "$SELECTEL" bash -s <<'GEN'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq wireguard-tools >/dev/null
D=/opt/ru-nl-vpn/keys
gen() {
  if [ ! -s "$D/$1" ]; then
    wg genkey | tee "$D/$1" | wg pubkey > "$D/$1.pub"
  fi
}
gen wg-clients.key
gen wg-nl.key
chmod 600 "$D"/*
GEN

echo "=== 2. Заливка файлов на Selectel ==="
ssh -o ConnectTimeout=20 "$SELECTEL" "mkdir -p ${RUNTIME}"
scp -o ConnectTimeout=20 -q \
  "${ROOT}/ru-nl-vpn/sing-box.json" \
  "${ROOT}/ru-nl-vpn/wg-postup.sh" \
  "${ROOT}/ru-nl-vpn/wg-postdown.sh" \
  "${SELECTEL}:${RUNTIME}/"
ssh -o ConnectTimeout=20 "$SELECTEL" "chmod +x ${RUNTIME}/wg-postup.sh ${RUNTIME}/wg-postdown.sh"

echo "=== 3. Amsterdam: wg-nl (exit для Selectel) ==="
ssh -o ConnectTimeout=20 "$AMSTERDAM" "apt-get update -qq && apt-get install -y -qq wireguard-tools >/dev/null 2>&1 || true"
NL_PRIV=$(ssh -o ConnectTimeout=20 "$AMSTERDAM" 'test -f /etc/wireguard/wg-nl.key && cat /etc/wireguard/wg-nl.key || (wg genkey | tee /etc/wireguard/wg-nl.key)')
NL_PUB=$(echo "$NL_PRIV" | ssh -o ConnectTimeout=20 "$AMSTERDAM" wg pubkey)
RU_NL_PUB=$(ssh -o ConnectTimeout=20 "$SELECTEL" "cat ${RUNTIME}/keys/wg-nl.key.pub")

ssh -o ConnectTimeout=20 "$AMSTERDAM" bash -s <<REMOTE
set -euo pipefail
cat > /etc/wireguard/wg-nl.conf <<EOF
[Interface]
Address = 10.255.255.2/30
ListenPort = ${SITE_PORT}
PrivateKey = ${NL_PRIV}
PostUp = iptables -A FORWARD -i wg-nl -j ACCEPT; iptables -A FORWARD -o wg-nl -j ACCEPT; iptables -t nat -A POSTROUTING -s 10.10.0.0/24 -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg-nl -j ACCEPT; iptables -D FORWARD -o wg-nl -j ACCEPT; iptables -t nat -D POSTROUTING -s 10.10.0.0/24 -o eth0 -j MASQUERADE

[Peer]
# Selectel RU gateway
PublicKey = ${RU_NL_PUB}
AllowedIPs = 10.10.0.0/24, 10.255.255.0/30
EOF
chmod 600 /etc/wireguard/wg-nl.conf
systemctl enable wg-quick@wg-nl 2>/dev/null || true
wg-quick down wg-nl 2>/dev/null || true
wg-quick up wg-nl
wg show wg-nl | head -8
ss -ulpn | grep ${SITE_PORT} || true
REMOTE

echo "=== 4. Selectel: wireguard + sing-box + dnsmasq ==="
RU_CLIENTS_PRIV=$(ssh -o ConnectTimeout=20 "$SELECTEL" "cat ${RUNTIME}/keys/wg-clients.key")
RU_CLIENTS_PUB=$(ssh -o ConnectTimeout=20 "$SELECTEL" "cat ${RUNTIME}/keys/wg-clients.key.pub")
RU_NL_PRIV=$(ssh -o ConnectTimeout=20 "$SELECTEL" "cat ${RUNTIME}/keys/wg-nl.key")
PHONE_PRIV=$(ssh -o ConnectTimeout=20 "$SELECTEL" "wg genkey")
PHONE_PUB=$(echo "$PHONE_PRIV" | ssh -o ConnectTimeout=20 "$SELECTEL" wg pubkey)

ssh -o ConnectTimeout=20 "$SELECTEL" bash -s <<REMOTE
set -euo pipefail
RUNTIME=/opt/ru-nl-vpn
NL_PUB='${NL_PUB}'
RU_CLIENTS_PRIV='${RU_CLIENTS_PRIV}'
RU_NL_PRIV='${RU_NL_PRIV}'
PHONE_PUB='${PHONE_PUB}'
PHONE_PRIV='${PHONE_PRIV}'
CLIENT_PORT=${CLIENT_PORT}
SITE_PORT=${SITE_PORT}

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq wireguard wireguard-tools dnsmasq curl ca-certificates >/dev/null

# sing-box
if ! command -v sing-box >/dev/null; then
  SB_VER=1.12.0
  curl -fsSL -o /tmp/sb.deb "https://github.com/SagerNet/sing-box/releases/download/v\${SB_VER}/sing-box_\${SB_VER}_linux_amd64.deb"
  dpkg -i /tmp/sb.deb || apt-get install -f -y -qq
fi
mkdir -p /var/lib/sing-box /usr/local/share/sing-box
if [ ! -f /usr/local/share/sing-box/geoip.db ]; then
  curl -fsSL -o /usr/local/share/sing-box/geoip.db https://github.com/SagerNet/sing-geoip/releases/latest/download/geoip.db
  curl -fsSL -o /usr/local/share/sing-box/geosite.db https://github.com/SagerNet/sing-geosite/releases/latest/download/geosite.db
fi

cat > /etc/wireguard/wg-clients.conf <<EOF
[Interface]
Address = 10.10.0.1/24
ListenPort = \${CLIENT_PORT}
PrivateKey = \${RU_CLIENTS_PRIV}
PostUp = \${RUNTIME}/wg-postup.sh
PostDown = \${RUNTIME}/wg-postdown.sh

[Peer]
# iPhone admin
PublicKey = \${PHONE_PUB}
AllowedIPs = 10.10.0.2/32
EOF

cat > /etc/wireguard/wg-nl.conf <<EOF
[Interface]
Address = 10.255.255.1/30
PrivateKey = \${RU_NL_PRIV}
Table = off
PostUp = sysctl -w net.ipv4.ip_forward=1

[Peer]
PublicKey = \${NL_PUB}
Endpoint = 194.135.20.35:\${SITE_PORT}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
EOF

chmod 600 /etc/wireguard/wg-clients.conf /etc/wireguard/wg-nl.conf

# Отдельный dnsmasq только на wg-clients (systemd-resolved держит 127.0.0.53:53)
rm -f /etc/dnsmasq.d/ru-vpn.conf
systemctl stop dnsmasq 2>/dev/null || true
systemctl disable dnsmasq 2>/dev/null || true

cat > /etc/systemd/system/dnsmasq-ru-vpn.service <<'UNIT'
[Unit]
Description=dnsmasq for RU VPN clients
After=wg-quick@wg-clients.service
PartOf=wg-quick@wg-clients.service

[Service]
Type=simple
ExecStart=/usr/sbin/dnsmasq -k --port=53 --bind-interfaces --interface=wg-clients --listen-address=10.10.0.1 --server=1.1.1.1 --server=8.8.8.8 --no-resolv --local=/dash.svodbot.ru/ --address=/dash.svodbot.ru/161.104.47.52
ExecStop=/bin/kill -TERM \$MAINPID
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT

mkdir -p /etc/sing-box
cp \${RUNTIME}/sing-box.json /etc/sing-box/config.json
cat > /etc/systemd/system/sing-box.service <<'SB'
[Unit]
Description=sing-box split router RU/NL
After=network-online.target wg-quick@wg-nl.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/sing-box run -c /etc/sing-box/config.json
Restart=on-failure
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
SB

systemctl daemon-reload
systemctl enable sing-box wg-quick@wg-clients wg-quick@wg-nl

wg-quick down wg-nl 2>/dev/null || true
wg-quick down wg-clients 2>/dev/null || true
wg-quick up wg-nl
sleep 1
wg-quick up wg-clients

cat > \${RUNTIME}/client-phone.conf <<CLIENT
[Interface]
PrivateKey = \${PHONE_PRIV}
Address = 10.10.0.2/32
DNS = 10.10.0.1

[Peer]
PublicKey = ${RU_CLIENTS_PUB}
Endpoint = 161.104.47.52:\${CLIENT_PORT}
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
CLIENT
chmod 600 \${RUNTIME}/client-phone.conf

echo "--- wg-clients ---"
wg show wg-clients | head -6
echo "--- wg-nl ---"
wg show wg-nl | head -6
systemctl is-active sing-box wg-quick@wg-clients wg-quick@wg-nl
REMOTE

echo "=== 5. Копия client-phone.conf на Mac ==="
scp -o ConnectTimeout=20 -q "${SELECTEL}:${RUNTIME}/client-phone.conf" "${HOME}/Desktop/wg-ru-gateway.conf"
chmod 600 "${HOME}/Desktop/wg-ru-gateway.conf"

echo ""
echo "✓ Готово"
echo "  Телефон: импорт ~/Desktop/wg-ru-gateway.conf в WireGuard"
echo "  Selectel: ${SELECTEL} ${RUNTIME}/"
echo "  Amsterdam exit: wg-nl :${SITE_PORT}"
echo ""
echo "  Проверка с Yota:"
echo "    1) WG вкл → https://2ip.ru (должен быть RU IP для российских сайтов)"
echo "    2) Telegram / YouTube (через NL)"
echo "    3) https://dash.svodbot.ru/mini-app/ (direct RU)"
