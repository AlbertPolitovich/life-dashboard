"""Добавить bot/ в sys.path (flows, data_store, app_context)."""
from __future__ import annotations

import sys
from pathlib import Path

BOT_DIR = Path(__file__).resolve().parent.parent / "bot"
_bot = str(BOT_DIR)
if _bot not in sys.path:
    sys.path.insert(0, _bot)
