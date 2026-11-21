import os
from dataclasses import dataclass

from dotenv import load_dotenv


@dataclass(frozen=True)
class Config:
    bot_token: str
    sheets_api_url: str
    sheets_api_secret: str | None


def load_config() -> Config:
    load_dotenv()

    bot_token = os.getenv("BOT_TOKEN", "").strip()
    if not bot_token:
        raise RuntimeError(
            "Не найден BOT_TOKEN. Добавь его в файл .env рядом с main.py"
        )

    sheets_api_url = os.getenv("SHEETS_API_URL", "").strip()
    secret = os.getenv("SHEETS_API_SECRET", "").strip()

    return Config(
        bot_token=bot_token,
        sheets_api_url=sheets_api_url,
        sheets_api_secret=secret or None,
    )
