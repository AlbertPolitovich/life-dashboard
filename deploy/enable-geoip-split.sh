#!/usr/bin/env bash
# Включить geoip/geosite split: RU → Selectel, остальное → Amsterdam
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELECTEL="${SELECTEL:-root@161.104.47.52}"

echo "=== Заливка конфигов на Selectel ==="
scp -o ConnectTimeout=20 -q \
  "${ROOT}/ru-nl-vpn/sing-box.json" \
  "${ROOT}/ru-nl-vpn/wg-postup.sh" \
  "${ROOT}/ru-nl-vpn/wg-postdown.sh" \
  "${SELECTEL}:/opt/ru-nl-vpn/"

ssh -o ConnectTimeout=20 "$SELECTEL" bash -s <<'REMOTE'
set -euo pipefail
cp /opt/ru-nl-vpn/sing-box.json /etc/sing-box/config.json
chmod 600 /etc/sing-box/config.json
chmod +x /opt/ru-nl-vpn/wg-postup.sh /opt/ru-nl-vpn/wg-postdown.sh

sing-box check -c /etc/sing-box/config.json
systemctl restart sing-box
sleep 2
systemctl is-active sing-box

# Перезапуск WG чтобы применить tproxy rules в PostUp
wg-quick down wg-clients 2>/dev/null || true
wg-quick up wg-clients
systemctl restart dnsmasq-ru-vpn

echo "--- status ---"
systemctl is-active sing-box wg-quick@wg-clients dnsmasq-ru-vpn
wg show wg-nl | grep -E "handshake|transfer" || true
iptables -t mangle -L PREROUTING -n -v | grep wg-clients | head -5
REMOTE

echo ""
echo "✓ GeoIP split включён"
echo "  RU IP/geo + geosite-ru → direct (Selectel)"
echo "  Остальное → nl-exit (Amsterdam)"
echo "  Конфиг телефона не меняется — переподключи WG"
