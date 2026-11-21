#!/usr/bin/env bash
# Генерация AllowedIPs = 0.0.0.0/0 минус один IP (для WG на iPhone).
# Использование: ./deploy/wg-allowed-ips-exclude.sh 161.104.47.52
set -euo pipefail
IP="${1:?IP to exclude, e.g. 161.104.47.52}"
python3 - "$IP" <<'PY'
import ipaddress, sys
exclude = ipaddress.ip_address(sys.argv[1])
result = []
def process(network):
    if exclude not in network:
        result.append(network)
        return
    if network.prefixlen == 32:
        return
    for child in network.subnets(prefixlen_diff=1):
        process(child)
process(ipaddress.ip_network('0.0.0.0/0'))
print(', '.join(str(c) for c in result))
print(f'# routes: {len(result)}', file=sys.stderr)
PY
