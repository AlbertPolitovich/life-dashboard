#!/bin/bash
# PostUp: WG-клиенты → sing-box tproxy → RU direct / NL exit
set -euo pipefail
IF=wg-clients
PORT=51830
TPROXY_PORT=7895
MARK=1
TABLE=100

sysctl -w net.ipv4.ip_forward=1 >/dev/null
sysctl -w net.ipv4.conf."$IF".rp_filter=0 >/dev/null
sysctl -w net.ipv4.conf.all.rp_filter=0 >/dev/null

ufw allow "${PORT}/udp" comment 'ru-vpn wg-clients' >/dev/null 2>&1 || true

iptables -C ufw-before-input -i "$IF" -j ACCEPT 2>/dev/null || \
  iptables -I ufw-before-input 1 -i "$IF" -j ACCEPT

iptables -C DOCKER-USER -i "$IF" -j ACCEPT 2>/dev/null || \
  iptables -I DOCKER-USER 1 -i "$IF" -j ACCEPT
iptables -C DOCKER-USER -o "$IF" -j ACCEPT 2>/dev/null || \
  iptables -I DOCKER-USER 1 -o "$IF" -j ACCEPT

# DNS клиентов — локально на 10.10.0.1, мимо tproxy
iptables -t mangle -C PREROUTING -i "$IF" -p udp --dport 53 -j ACCEPT 2>/dev/null || \
  iptables -t mangle -I PREROUTING 1 -i "$IF" -p udp --dport 53 -j ACCEPT

iptables -t mangle -C PREROUTING -i "$IF" -p tcp -j TPROXY --on-port "${TPROXY_PORT}" --tproxy-mark "${MARK}"/0x1 2>/dev/null || \
  iptables -t mangle -A PREROUTING -i "$IF" -p tcp -j TPROXY --on-port "${TPROXY_PORT}" --tproxy-mark "${MARK}"/0x1

iptables -t mangle -C PREROUTING -i "$IF" -p udp -m udp ! --dport 53 -j TPROXY --on-port "${TPROXY_PORT}" --tproxy-mark "${MARK}"/0x1 2>/dev/null || \
  iptables -t mangle -A PREROUTING -i "$IF" -p udp -m udp ! --dport 53 -j TPROXY --on-port "${TPROXY_PORT}" --tproxy-mark "${MARK}"/0x1

ip rule del fwmark "${MARK}" table "${TABLE}" 2>/dev/null || true
ip rule add fwmark "${MARK}" table "${TABLE}" priority 100
ip route replace local 0.0.0.0/0 dev lo table "${TABLE}"
