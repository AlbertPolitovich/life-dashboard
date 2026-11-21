import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

SQL_DIR = Path(__file__).resolve().parent


@dataclass(frozen=True)
class SqlBotConfig:
    bot_token: str
    database_url: str
    api_base_url: str | None
    sheets_api_url: str | None
    sheets_api_secret: str | None


def load_sql_config() -> SqlBotConfig:
    """Настройки из !bot_SQL/.env.sql (не коммитить)."""
    load_dotenv(SQL_DIR / ".env.sql")

    bot_token = os.getenv("BOT_TOKEN", "").strip()
    if not bot_token:
        raise RuntimeError(
            "Не найден BOT_TOKEN в !bot_SQL/.env.sql. См. !bot_SQL/SQL_BOT_SETUP.md"
        )

    database_url = os.getenv("DATABASE_URL", "").strip()
    api_base_url = os.getenv("API_BASE_URL", "").strip()
    sheets_url = os.getenv("SHEETS_API_URL", "").strip()
    secret = os.getenv("SHEETS_API_SECRET", "").strip()

    return SqlBotConfig(
        bot_token=bot_token,
        database_url=database_url,
        api_base_url=api_base_url or None,
        sheets_api_url=sheets_url or None,
        sheets_api_secret=secret or None,
    )
