#!/usr/bin/env bash
# Убрать с Amsterdam: API-копия, Postgres, Caddy VPN-path (10.0.0.1).
# Остаётся: SQL-бот, Xray, WireGuard, Amnezia AWG.
set -euo pipefail

VPS="${VPS:-root@194.135.20.35}"

echo "→ Amsterdam: stop API + Postgres + VPN Caddy"
ssh -o ConnectTimeout=20 "$VPS" bash -s <<'REMOTE'
set -euo pipefail

systemctl stop life-dashboard-api 2>/dev/null || true
systemctl disable life-dashboard-api 2>/dev/null || true

if docker ps -a --format '{{.Names}}' | grep -qx life_dashboard_pg; then
  docker stop life_dashboard_pg
  docker rm life_dashboard_pg
fi

if [ -f /opt/life-dashboard/docker-compose.yml ]; then
  cd /opt/life-dashboard
  docker compose down 2>/dev/null || docker-compose down 2>/dev/null || true
fi

docker volume rm life_dashboard_pg_data 2>/dev/null || true

# Caddy только для VPN dash на 10.0.0.1 — больше не нужен
if grep -q 'bind 10.0.0.1' /etc/caddy/Caddyfile 2>/dev/null; then
  cat > /etc/caddy/Caddyfile <<'CADDY'
# API/mini-app на Amsterdam отключены. dash.svodbot.ru → Selectel.
{
	auto_https off
}
CADDY
  systemctl reload caddy 2>/dev/null || systemctl stop caddy 2>/dev/null || true
fi

# dnsmasq: убрать override dash → 10.0.0.1 (иначе WG клиенты бьют в пустоту)
if [ -f /etc/dnsmasq-wg.conf ]; then
  sed -i '/dash\.svodbot\.ru/d' /etc/dnsmasq-wg.conf
  sed -i '/^local=\/dash\.svodbot\.ru\//d' /etc/dnsmasq-wg.conf
  systemctl restart dnsmasq-wg 2>/dev/null || true
fi

systemctl is-active life-dashboard-sql-bot
docker ps --format '{{.Names}}' | grep -v '^$' || true
ss -tlnp | grep -E '8765|5432|10.0.0.1:443' || echo 'no api/pg/vpn-caddy listeners'
free -h | head -2
REMOTE

echo "✓ Amsterdam очищен (бот + VPN остались)"
