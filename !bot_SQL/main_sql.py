"""
Routine/Sport SQL — лабораторный бот (!bot_SQL/).
Общий UX из bot/; свой токен и .env.sql.

Запуск:
  cd /Users/artem/Desktop/life-dashboard/!bot_SQL
  source ../bot/.venv/bin/activate
  python main_sql.py
"""
from __future__ import annotations

import asyncio
import logging
import os
from importlib.machinery import SourceFileLoader
from pathlib import Path

import _bootstrap  # noqa: F401 — bot/ на sys.path

import app_context
from aiogram import Bot, Dispatcher
from aiogram import BaseMiddleware
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import TelegramObject
from sql_config import load_sql_config
from sql_store import build_sql_store

ROOT = Path(__file__).resolve().parent.parent
BOT_MAIN = ROOT / "bot" / "main.py"


def _allowed_user(message_user, allowed_username: str, allowed_id: str) -> bool:
    if message_user is None:
        return False
    if allowed_id:
        return str(getattr(message_user, "id", "")) == allowed_id
    username = str(getattr(message_user, "username", "") or "").strip().lower()
    return bool(allowed_username and username == allowed_username)


class AccessOnlyOwnerMiddleware(BaseMiddleware):
    def __init__(self, allowed_username: str, allowed_id: str) -> None:
        self.allowed_username = allowed_username
        self.allowed_id = allowed_id
        self._warned_ids: set[int] = set()

    async def __call__(self, handler, event: TelegramObject, data):
        user = data.get("event_from_user")
        if _allowed_user(user, self.allowed_username, self.allowed_id):
            return await handler(event, data)
        chat = data.get("event_chat")
        bot: Bot | None = data.get("bot")
        if bot and chat:
            chat_id = getattr(chat, "id", None)
            if isinstance(chat_id, int) and chat_id not in self._warned_ids:
                self._warned_ids.add(chat_id)
                await bot.send_message(chat_id, "Доступ закрыт.")
        return None


def _load_prod_router():
    mod = SourceFileLoader("life_dashboard_prod_main", str(BOT_MAIN)).load_module()
    return mod.router


async def main() -> None:
    logging.basicConfig(level=logging.INFO)

    config = load_sql_config()
    app_context.sheets_store = build_sql_store(config)
    bot = Bot(token=config.bot_token)
    router = _load_prod_router()
    allowed_username = os.getenv("ALLOWED_TELEGRAM_USERNAME", "tim710").strip().lower()
    allowed_id = (os.getenv("ALLOWED_TELEGRAM_ID") or "").strip()

    storage = MemoryStorage()
    dispatcher = Dispatcher(storage=storage)
    dispatcher.update.outer_middleware(AccessOnlyOwnerMiddleware(allowed_username, allowed_id))
    dispatcher.include_router(router)

    logging.info(
        "SQL-бот (!bot_SQL) DATA_STORE=%s. Напоминания отключены. Access: username=%s id=%s",
        os.getenv("DATA_STORE", "postgres"),
        allowed_username or "-",
        allowed_id or "-",
    )
    await dispatcher.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
