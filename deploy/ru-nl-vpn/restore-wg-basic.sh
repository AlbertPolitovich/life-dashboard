#!/usr/bin/env bash
# Минимальный рабочий WG: телефон → Selectel → интернет (RU IP).
set -euo pipefail

cat > /opt/ru-nl-vpn/wg-postup.sh <<'POSTUP'
#!/bin/bash
set -euo pipefail
IF=wg-clients
PORT=51830

sysctl -w net.ipv4.ip_forward=1 >/dev/null
sysctl -w net.ipv4.conf."$IF".rp_filter=0 >/dev/null

ufw allow "${PORT}/udp" comment 'ru-vpn wg-clients' >/dev/null 2>&1 || true

ufw_fwd() {
  iptables -C FORWARD -i "$1" -o "$2" -j ACCEPT 2>/dev/null || \
    iptables -I ufw-before-forward 1 -i "$1" -o "$2" -j ACCEPT
}
ufw_fwd "$IF" eth0
ufw_fwd eth0 "$IF"

iptables -t nat -C POSTROUTING -o eth0 -s 10.10.0.0/24 -j MASQUERADE 2>/dev/null || \
  iptables -t nat -A POSTROUTING -o eth0 -s 10.10.0.0/24 -j MASQUERADE
POSTUP
chmod +x /opt/ru-nl-vpn/wg-postup.sh

cat > /opt/ru-nl-vpn/wg-postdown.sh <<'POSTDOWN'
#!/bin/bash
set -euo pipefail
IF=wg-clients
PORT=51830
iptables -t nat -D POSTROUTING -o eth0 -s 10.10.0.0/24 -j MASQUERADE 2>/dev/null || true
for pair in "$IF:eth0" "eth0:$IF"; do
  IFS=: read -r a b <<< "$pair"
  iptables -D ufw-before-forward -i "$a" -o "$b" -j ACCEPT 2>/dev/null || true
done
ufw delete allow "${PORT}/udp" 2>/dev/null || true
POSTDOWN
chmod +x /opt/ru-nl-vpn/wg-postdown.sh

systemctl reset-failed wg-quick@wg-clients 2>/dev/null || true
systemctl enable wg-quick@wg-clients
wg-quick down wg-clients 2>/dev/null || true
wg-quick up wg-clients

systemctl enable dnsmasq-ru-vpn 2>/dev/null || true
systemctl restart dnsmasq-ru-vpn 2>/dev/null || true

echo "--- status ---"
systemctl is-active wg-quick@wg-clients dnsmasq-ru-vpn 2>&1
wg show wg-clients
ss -ulpn | grep 51830
dig @10.10.0.1 google.com +short +time=2 | head -1
