#!/bin/bash
set -euo pipefail
IF=wg-clients
PORT=51830
TPROXY_PORT=7895
MARK=1
TABLE=100

iptables -D ufw-before-input -i "$IF" -j ACCEPT 2>/dev/null || true
iptables -D DOCKER-USER -i "$IF" -j ACCEPT 2>/dev/null || true
iptables -D DOCKER-USER -o "$IF" -j ACCEPT 2>/dev/null || true

iptables -t mangle -D PREROUTING -i "$IF" -p udp --dport 53 -j ACCEPT 2>/dev/null || true
iptables -t mangle -D PREROUTING -i "$IF" -p tcp -j TPROXY --on-port "${TPROXY_PORT}" --tproxy-mark "${MARK}"/0x1 2>/dev/null || true
iptables -t mangle -D PREROUTING -i "$IF" -p udp -m udp ! --dport 53 -j TPROXY --on-port "${TPROXY_PORT}" --tproxy-mark "${MARK}"/0x1 2>/dev/null || true

ip rule del fwmark "${MARK}" table "${TABLE}" 2>/dev/null || true
ip route flush table "${TABLE}" 2>/dev/null || true

ufw delete allow "${PORT}/udp" 2>/dev/null || true
