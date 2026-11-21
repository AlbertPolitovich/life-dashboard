from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Protocol

import aiohttp


class SheetsError(Exception):
    pass


class SheetsNotConfigured(Exception):
    pass


@dataclass(frozen=True)
class PrepareDayResult:
    """Внутренние координаты строки — пользователю не показываем."""

    date_iso: str
    month: str
    row_1based: int


class DataStore(Protocol):
    async def prepare_day(self, day: date) -> PrepareDayResult:
        """Найти строку с датой в таблице для заполнения B:I."""

    async def write_sport_batch(
        self,
        day: date,
        cells: list[dict[str, int | str]],
        row_1based: int,
    ) -> None:
        """Записать несколько ячеек J–V одним запросом."""

    async def write_sport_cell(
        self, day: date, col_1based: int, value: int | str, row_1based: int
    ) -> None:
        """Записать одно целое в колонку J–V дневной строки."""

    async def write_routine_batch(
        self, day: date, values: list[int], row_1based: int
    ) -> None:
        """Записать все сферы B:I одним запросом."""

    async def get_month_rows(self, day: date) -> list[dict[str, Any]]:
        """Прочитать сводку rows (факт/цель) через doGet для месяца day."""

    async def get_month_sport(self, day: date) -> dict[str, Any]:
        """Прочитать sport и sportByType через doGet для месяца day."""


class GoogleSheetsStore:
    def __init__(self, api_url: str, secret: str | None = None) -> None:
        base = api_url.split("?")[0].rstrip("/")
        self._api_url = base
        self._secret = secret
        self._session: aiohttp.ClientSession | None = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()

    async def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self._secret:
            payload = {**payload, "secret": self._secret}

        session = await self._get_session()
        async with session.post(
            self._api_url,
            json=payload,
            timeout=aiohttp.ClientTimeout(total=90),
        ) as response:
            try:
                data = await response.json()
            except aiohttp.ContentTypeError as exc:
                text = await response.text()
                raise SheetsError(
                    f"Таблица вернула не JSON (код {response.status}): {text[:200]}"
                ) from exc

        if not data.get("ok"):
            raise SheetsError(str(data.get("error", "table_not_configured")))

        return data

    async def _get(self, params: dict[str, str]) -> dict[str, Any]:
        session = await self._get_session()
        async with session.get(
            self._api_url,
            params=params,
            timeout=aiohttp.ClientTimeout(total=90),
        ) as response:
            try:
                data = await response.json()
            except aiohttp.ContentTypeError as exc:
                text = await response.text()
                raise SheetsError(
                    f"Таблица вернула не JSON (код {response.status}): {text[:200]}"
                ) from exc

        if not data.get("ok"):
            raise SheetsError(str(data.get("error", "table_not_configured")))
        return data

    async def prepare_day(self, day: date) -> PrepareDayResult:
        data = await self._post(
            {
                "action": "prepareDay",
                "date": day.isoformat(),
            }
        )
        return PrepareDayResult(
            date_iso=str(data["date"]),
            month=str(data["month"]),
            row_1based=int(data["row1Based"]),
        )

    async def write_sport_batch(
        self,
        day: date,
        cells: list[dict[str, int | str]],
        row_1based: int,
    ) -> None:
        if not cells:
            raise SheetsError("table_not_configured")

        payload = {
            "action": "writeSportBatch",
            "date": day.isoformat(),
            "row1Based": row_1based,
            "cells": cells,
        }
        try:
            await self._post(payload)
        except SheetsError as exc:
            if not self._should_fallback_sport_batch(exc):
                raise
            for cell in cells:
                await self.write_sport_cell(
                    day,
                    int(cell["col1Based"]),
                    cell["value"],
                    row_1based,
                )

    @staticmethod
    def _should_fallback_sport_batch(exc: SheetsError) -> bool:
        msg = str(exc)
        return ("Unknown action" in msg or "не JSON" in msg) and "Unauthorized" not in msg

    async def write_sport_cell(
        self, day: date, col_1based: int, value: int | str, row_1based: int
    ) -> None:
        await self._post(
            {
                "action": "writeSportCell",
                "date": day.isoformat(),
                "row1Based": row_1based,
                "col1Based": col_1based,
                "value": value,
            }
        )

    async def write_routine_batch(
        self, day: date, values: list[int], row_1based: int
    ) -> None:
        if len(values) != 8:
            raise SheetsError("table_not_configured")

        await self._post(
            {
                "action": "writeRoutineBatch",
                "date": day.isoformat(),
                "row1Based": row_1based,
                "values": values,
            }
        )

    async def get_month_rows(self, day: date) -> list[dict[str, Any]]:
        month = day.strftime("%Y-%m")
        data = await self._get({"month": month})
        rows = data.get("rows")
        if not isinstance(rows, list):
            raise SheetsError("table_not_configured")
        # keep only shape needed for routine/radar rendering
        result: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            sphere = str(row.get("sphere", "")).strip()
            if not sphere:
                continue
            result.append(
                {
                    "sphere": sphere,
                    "fact": row.get("fact", 0),
                    "goal": row.get("goal", 0),
                    "progress": row.get("progress", 0),
                }
            )
        if not result:
            raise SheetsError("table_not_configured")
        return result

    async def get_month_sport(self, day: date) -> dict[str, Any]:
        month = day.strftime("%Y-%m")
        data = await self._get({"month": month})
        sport = data.get("sport")
        sport_by_type = data.get("sportByType")
        if not isinstance(sport, dict) or not isinstance(sport_by_type, dict):
            raise SheetsError("table_not_configured")
        return {
            "sport": sport,
            "sportByType": sport_by_type,
        }
