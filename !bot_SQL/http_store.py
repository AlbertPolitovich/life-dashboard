"""HttpStore: бот пишет/читает через FastAPI (а не напрямую в Postgres)."""

from __future__ import annotations

from datetime import date
from typing import Any

import _bootstrap  # noqa: F401
import aiohttp
from data_store import PrepareDayResult, SheetsError


class HttpStore:
    def __init__(self, api_base_url: str) -> None:
        self._base = api_base_url.rstrip("/")
        self._session: aiohttp.ClientSession | None = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()

    async def _post_action(self, payload: dict[str, Any]) -> dict[str, Any]:
        session = await self._get_session()
        async with session.post(
            f"{self._base}/write",
            json=payload,
            timeout=aiohttp.ClientTimeout(total=90),
        ) as response:
            try:
                data = await response.json()
            except aiohttp.ContentTypeError as exc:
                text = await response.text()
                raise SheetsError(
                    f"API вернул не JSON (код {response.status}): {text[:200]}"
                ) from exc
        if not data.get("ok"):
            raise SheetsError(str(data.get("error", "table_not_configured")))
        return data

    async def _get_month(self, month: str) -> dict[str, Any]:
        session = await self._get_session()
        async with session.get(
            f"{self._base}/month",
            params={"month": month},
            timeout=aiohttp.ClientTimeout(total=90),
        ) as response:
            try:
                data = await response.json()
            except aiohttp.ContentTypeError as exc:
                text = await response.text()
                raise SheetsError(
                    f"API вернул не JSON (код {response.status}): {text[:200]}"
                ) from exc
        if not data.get("ok"):
            raise SheetsError(str(data.get("error", "table_not_configured")))
        return data

    async def prepare_day(self, day: date) -> PrepareDayResult:
        data = await self._post_action(
            {"action": "prepareDay", "date": day.isoformat()}
        )
        return PrepareDayResult(
            date_iso=str(data["date"]),
            month=str(data["month"]),
            row_1based=int(data["row1Based"]),
        )

    async def write_routine_batch(
        self, day: date, values: list[int], row_1based: int
    ) -> None:
        if len(values) != 8:
            raise SheetsError("table_not_configured")
        await self._post_action(
            {
                "action": "writeRoutineBatch",
                "date": day.isoformat(),
                "row1Based": row_1based,
                "values": values,
            }
        )

    async def write_sport_batch(
        self, day: date, cells: list[dict[str, int | str]], row_1based: int
    ) -> None:
        if not cells:
            raise SheetsError("table_not_configured")
        await self._post_action(
            {
                "action": "writeSportBatch",
                "date": day.isoformat(),
                "row1Based": row_1based,
                "cells": cells,
            }
        )

    async def write_sport_cell(
        self, day: date, col_1based: int, value: int | str, row_1based: int
    ) -> None:
        await self._post_action(
            {
                "action": "writeSportCell",
                "date": day.isoformat(),
                "row1Based": row_1based,
                "col1Based": col_1based,
                "value": value,
            }
        )

    async def get_month_rows(self, day: date) -> list[dict[str, Any]]:
        data = await self._get_month(day.strftime("%Y-%m"))
        rows = data.get("rows")
        if not isinstance(rows, list):
            raise SheetsError("table_not_configured")
        return rows

    async def get_month_sport(self, day: date) -> dict[str, Any]:
        data = await self._get_month(day.strftime("%Y-%m"))
        sport = data.get("sport")
        sport_by_type = data.get("sportByType")
        if not isinstance(sport, dict) or not isinstance(sport_by_type, dict):
            raise SheetsError("table_not_configured")
        return {"sport": sport, "sportByType": sport_by_type}
