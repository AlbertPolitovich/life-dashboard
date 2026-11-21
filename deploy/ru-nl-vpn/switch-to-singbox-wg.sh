#!/usr/bin/env bash
# Переключить VPN gateway на sing-box WireGuard inbound (без policy-routing в TUN).
set -euo pipefail

RUNTIME="/opt/ru-nl-vpn"
WG_CONF="/etc/wireguard/wg-clients.conf"
SB_CONF="/etc/sing-box/config.json"

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
      "type": "wireguard",
      "tag": "wg-in",
      "system": true,
      "interface_name": "wg-clients",
      "gso": true,
      "address": ["10.10.0.1/24"],
      "mtu": 1420,
      "listen_port": 51830,
      "private_key": "${PRIV}",
      "peers": [
        {
          "address": "10.10.0.2/32",
          "public_key": "${PHONE_PUB}",
          "allowed_ips": ["0.0.0.0/0"],
          "persistent_keepalive_interval": 25
        }
      ]
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

# Отключаем отдельный wg-quick — порт 51830 теперь у sing-box
systemctl disable wg-quick@wg-clients 2>/dev/null || true
wg-quick down wg-clients 2>/dev/null || true

ufw allow 51830/udp comment 'ru-vpn wg-clients' >/dev/null 2>&1 || true

systemctl restart sing-box
sleep 2
systemctl is-active sing-box

cat > /etc/systemd/system/dnsmasq-ru-vpn.service <<'UNIT'
[Unit]
Description=dnsmasq for RU VPN clients
After=sing-box.service
Wants=sing-box.service

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

echo "--- sing-box ---"
systemctl is-active sing-box
echo "--- dnsmasq ---"
systemctl is-active dnsmasq-ru-vpn
echo "--- wg interface ---"
ip link show wg-clients 2>&1 | head -2
echo "--- dns test ---"
dig @10.10.0.1 google.com +short +time=2 | head -1
