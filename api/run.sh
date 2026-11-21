#!/usr/bin/env bash
# Запуск только из api/ — иначе uvicorn может взять bot/main.py
cd "$(dirname "$0")"
source ../bot/.venv/bin/activate
exec uvicorn server:app --host 127.0.0.1 --port 8765 --reload
