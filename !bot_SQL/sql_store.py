import _bootstrap  # noqa: F401

import os

from data_store import GoogleSheetsStore
from http_store import HttpStore
from postgres_store import PostgresStore
from sql_config import SqlBotConfig


def build_sql_store(
    config: SqlBotConfig,
) -> PostgresStore | GoogleSheetsStore | HttpStore | None:
    """
    DATA_STORE=postgres (по умолчанию) → PostgresStore (прямо в БД).
    DATA_STORE=http → HttpStore (через FastAPI /write + /month).
    DATA_STORE=sheets → тот же Google Sheets (dual-write / сравнение).
    """
    mode = os.getenv("DATA_STORE", "postgres").strip().lower()

    if mode == "http":
        if not config.api_base_url:
            return None
        return HttpStore(config.api_base_url)

    if mode == "sheets":
        if not config.sheets_api_url:
            return None
        return GoogleSheetsStore(config.sheets_api_url, config.sheets_api_secret)

    if not config.database_url:
        return None
    return PostgresStore(config.database_url)
