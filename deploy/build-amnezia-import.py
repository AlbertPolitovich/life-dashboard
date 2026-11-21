#!/usr/bin/env python3
"""Собрать vpn:// ключ Amnezia (Qt qCompress) для импорта в приложение."""
from __future__ import annotations

import base64
import json
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
XRAY_JSON = ROOT / "deploy" / "amsterdam-xray-import.json"
OUT_VPN = ROOT / "deploy" / "amsterdam-xray.vpn"
OUT_VLESS = ROOT / "deploy" / "amsterdam-xray.vless"

XRAY_CLIENT = json.loads(XRAY_JSON.read_text(encoding="utf-8"))


def qcompress(data: bytes, level: int = 8) -> bytes:
    return struct.pack(">I", len(data)) + zlib.compress(data, level)


def build_amnezia_config() -> dict:
    return {
        "description": "Amsterdam Xray",
        "hostName": "194.135.20.35",
        "defaultContainer": "amnezia-xray",
        "dns1": "1.1.1.1",
        "dns2": "1.0.0.1",
        "containers": [
            {
                "container": "amnezia-xray",
                "xray": {
                    "last_config": json.dumps(XRAY_CLIENT, separators=(",", ":")),
                    "isThirdPartyConfig": True,
                    "port": "44337",
                    "site": "www.booking.com",
                },
            }
        ],
    }


def build_vless() -> str:
    o = XRAY_CLIENT["outbounds"][0]
    v = o["settings"]["vnext"][0]
    u = v["users"][0]
    r = o["streamSettings"]["realitySettings"]
    return (
        f"vless://{u['id']}@{v['address']}:{v['port']}"
        f"?type={o['streamSettings']['network']}"
        f"&security={o['streamSettings']['security']}"
        f"&pbk={r['publicKey']}"
        f"&fp={r['fingerprint']}"
        f"&sni={r['serverName']}"
        f"&sid={r['shortId']}"
        f"&flow={u['flow']}"
        f"&encryption={u['encryption']}"
        f"#Amsterdam-Xray"
    )


def main() -> None:
    cfg = build_amnezia_config()
    raw = json.dumps(cfg, separators=(",", ":")).encode("utf-8")
    compressed = qcompress(raw, 8)
    b64 = base64.urlsafe_b64encode(compressed).decode("ascii").rstrip("=")
    vpn_key = f"vpn://{b64}"

    OUT_VPN.write_text(vpn_key + "\n", encoding="utf-8")
    OUT_VLESS.write_text(build_vless() + "\n", encoding="utf-8")

    print(f"✓ {OUT_VPN}")
    print(f"✓ {OUT_VLESS}")
    print(f"✓ {XRAY_JSON}")


if __name__ == "__main__":
    main()
