#!/usr/bin/env bash
# Восстановить WG + sing-box tproxy split (рабочая схема для 1.12).
set -euo pipefail

WG_CONF="/etc/wireguard/wg-clients.conf"
SB_CONF="/etc/sing-box/config.json"
TPROXY_PORT=7895
MARK=1

PRIV=$(awk -F' = ' '/^PrivateKey/{print $2}' "$WG_CONF")
PHONE_PUB=$(awk -F' = ' '/^PublicKey/{print $2}' "$WG_CONF" | tail -1)

cat > "$SB_CONF" <<EOF
{
  "log": { "level": "warn" },
  "dns": {
    "servers": [
      { "type": "udp", "tag": "cf", "server": "1.1.1.1" },
      { "type": "local", "tag": "local" }
    ],
    "rules": [
      { "domain": ["dash.svodbot.ru", "svodbot.ru"], "server": "local" }
    ],
    "final": "cf",
    "strategy": "prefer_ipv4"
  },
  "inbounds": [
    {
      "type": "tproxy",
      "tag": "tproxy-in",
      "listen": "0.0.0.0",
      "listen_port": ${TPROXY_PORT},
      "sniff": true,
      "sniff_override_destination": true
    }
  ],
  "outbounds": [
    { "type": "direct", "tag": "direct" },
    { "type": "direct", "tag": "nl-exit", "bind_interface": "wg-nl" }
  ],
  "route": {
    "rule_set": [
      {
        "tag": "geoip-ru",
        "type": "remote",
        "format": "binary",
        "url": "https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-ru.srs",
        "download_detour": "direct"
      },
      {
        "tag": "geosite-ru",
        "type": "remote",
        "format": "binary",
        "url": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-category-ru.srs",
        "download_detour": "direct"
      }
    ],
    "rules": [
      { "ip_is_private": true, "outbound": "direct" },
      { "rule_set": "geoip-ru", "outbound": "direct" },
      { "rule_set": "geosite-ru", "outbound": "direct" },
      { "domain": ["dash.svodbot.ru", "svodbot.ru"], "outbound": "direct" }
    ],
    "final": "nl-exit",
    "auto_detect_interface": true
  },
  "experimental": {
    "cache_file": { "enabled": true, "path": "/var/lib/sing-box/cache.db" }
  }
}
EOF
chmod 600 "$SB_CONF"

cat > /opt/ru-nl-vpn/wg-postup.sh <<'POSTUP'
#!/bin/bash
set -euo pipefail
IF=wg-clients
PORT=51830
TPROXY_PORT=7895
MARK=1
TABLE=100

sysctl -w net.ipv4.ip_forward=1 >/dev/null
sysctl -w net.ipv4.conf."$IF".rp_filter=0 >/dev/null

ufw allow "${PORT}/udp" comment 'ru-vpn wg-clients' >/dev/null 2>&1 || true

ufw_fwd() {
  iptables -C FORWARD -i "$1" -o "$2" -j ACCEPT 2>/dev/null || \
    iptables -I ufw-before-forward 1 -i "$1" -o "$2" -j ACCEPT
}
ufw_fwd "$IF" eth0
ufw_fwd eth0 "$IF"
ufw_fwd "$IF" wg-nl
ufw_fwd wg-nl "$IF"

iptables -t nat -C POSTROUTING -o eth0 -s 10.10.0.0/24 -j MASQUERADE 2>/dev/null || \
  iptables -t nat -A POSTROUTING -o eth0 -s 10.10.0.0/24 -j MASQUERADE
iptables -t nat -C POSTROUTING -o wg-nl -s 10.10.0.0/24 -j MASQUERADE 2>/dev/null || \
  iptables -t nat -A POSTROUTING -o wg-nl -s 10.10.0.0/24 -j MASQUERADE

# DNS клиентов — напрямую в dnsmasq, не через tproxy
iptables -t mangle -C PREROUTING -i "$IF" -p udp --dport 53 -j ACCEPT 2>/dev/null || \
  iptables -t mangle -I PREROUTING 1 -i "$IF" -p udp --dport 53 -j ACCEPT

iptables -t mangle -C PREROUTING -i "$IF" -j TPROXY --tproxy-mark "${MARK}" --on-port "${TPROXY_PORT}" 2>/dev/null || \
  iptables -t mangle -A PREROUTING -i "$IF" -j TPROXY --tproxy-mark "${MARK}" --on-port "${TPROXY_PORT}"

ip rule del fwmark "${MARK}" table "${TABLE}" 2>/dev/null || true
ip rule add fwmark "${MARK}" table "${TABLE}" priority 100
ip route replace local 0.0.0.0/0 dev lo table "${TABLE}"

POSTUP
chmod +x /opt/ru-nl-vpn/wg-postup.sh

systemctl enable wg-quick@wg-clients 2>/dev/null || true
systemctl reset-failed sing-box wg-quick@wg-clients 2>/dev/null || true
sing-box check -c "$SB_CONF"
systemctl restart sing-box
sleep 2

wg-quick down wg-clients 2>/dev/null || true
wg-quick up wg-clients

cat > /etc/systemd/system/dnsmasq-ru-vpn.service <<'UNIT'
[Unit]
Description=dnsmasq for RU VPN clients
After=wg-quick@wg-clients.service
Wants=wg-quick@wg-clients.service

[Service]
Type=simple
ExecStart=/usr/sbin/dnsmasq -k --port=53 --bind-interfaces --interface=wg-clients --listen-address=10.10.0.1 --server=1.1.1.1 --server=8.8.8.8 --no-resolv --local=/dash.svodbot.ru/ --address=/dash.svodbot.ru/161.104.47.52
ExecStop=/bin/kill -TERM $MAINPID
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable dnsmasq-ru-vpn
systemctl restart dnsmasq-ru-vpn

echo "--- status ---"
systemctl is-active sing-box wg-quick@wg-clients dnsmasq-ru-vpn
wg show wg-clients | head -8
dig @10.10.0.1 google.com +short +time=2 | head -1
