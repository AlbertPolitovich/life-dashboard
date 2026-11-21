"""PostgresStore — запись routine/sport в локальный Postgres (путь A)."""

from __future__ import annotations

import _bootstrap  # noqa: F401 — bot/ на sys.path

import re
from datetime import date

import asyncpg
from data_store import PrepareDayResult, SheetsError
from sport_fields import PACE_COL_1BASED
from month_goals_setup import upsert_month_goals
from sport_parse import parse_sport_number
from spheres import SPHERES

# Колонки J–V листа (1-based), как в apps-script-doGet.gs
SPORT_WRITE_COLS = frozenset(range(10, 23))
_PACE_RE = re.compile(r"^(\d{1,2}):(\d{2}):(\d{2})$")


class PostgresStore:
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url
        self._pool: asyncpg.Pool | None = None

    async def _get_pool(self) -> asyncpg.Pool:
        if self._pool is None:
            try:
                self._pool = await asyncpg.create_pool(
                    self._database_url,
                    min_size=1,
                    max_size=4,
                )
            except Exception as exc:
                raise SheetsError("table_not_configured") from exc
        return self._pool

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    async def ensure_month_goals(self, day: date) -> None:
        """Обновить month_goals для месяца day (routine + sport). Без создания дня."""
        month_key = day.strftime("%Y-%m")
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            month_id = await conn.fetchval(
                "SELECT id FROM months WHERE year_month = $1",
                month_key,
            )
            if month_id is None:
                raise SheetsError("table_not_configured")
            async with conn.transaction():
                await upsert_month_goals(conn, month_id, day)

    async def prepare_day(self, day: date) -> PrepareDayResult:
        """Создать месяц и день в БД, если их ещё нет."""
        month_key = day.strftime("%Y-%m")
        pool = await self._get_pool()

        try:
            async with pool.acquire() as conn:
                async with conn.transaction():
                    month_id = await conn.fetchval(
                        """
                        INSERT INTO months (year_month)
                        VALUES ($1)
                        ON CONFLICT (year_month) DO NOTHING
                        RETURNING id
                        """,
                        month_key,
                    )
                    if month_id is None:
                        month_id = await conn.fetchval(
                            "SELECT id FROM months WHERE year_month = $1",
                            month_key,
                        )

                    await upsert_month_goals(conn, month_id, day)

                    day_id = await conn.fetchval(
                        """
                        INSERT INTO days (month_id, day_date)
                        VALUES ($1, $2)
                        ON CONFLICT (day_date) DO NOTHING
                        RETURNING id
                        """,
                        month_id,
                        day,
                    )
                    if day_id is None:
                        day_id = await conn.fetchval(
                            "SELECT id FROM days WHERE day_date = $1",
                            day,
                        )
        except asyncpg.PostgresError as exc:
            raise SheetsError("table_not_configured") from exc

        if day_id is None:
            raise SheetsError("table_not_configured")

        return PrepareDayResult(
            date_iso=day.isoformat(),
            month=month_key,
            row_1based=int(day_id),
        )

    async def write_routine_batch(
        self, day: date, values: list[int], row_1based: int
    ) -> None:
        del row_1based  # в Sheets это номер строки; в Postgres достаточно day_date

        if len(values) != 8:
            raise SheetsError("table_not_configured")
        if any(v not in (0, 1) for v in values):
            raise SheetsError("table_not_configured")

        pool = await self._get_pool()
        try:
            async with pool.acquire() as conn:
                day_id = await conn.fetchval(
                    "SELECT id FROM days WHERE day_date = $1",
                    day,
                )
                if day_id is None:
                    raise SheetsError("table_not_configured")

                async with conn.transaction():
                    for sphere, value in zip(SPHERES, values, strict=True):
                        await conn.execute(
                            """
                            INSERT INTO routine_values (day_id, sphere, value)
                            VALUES ($1, $2, $3)
                            ON CONFLICT (day_id, sphere)
                            DO UPDATE SET value = EXCLUDED.value
                            """,
                            day_id,
                            sphere.col_1based,
                            value,
                        )
        except SheetsError:
            raise
        except asyncpg.PostgresError as exc:
            raise SheetsError("table_not_configured") from exc

    @staticmethod
    def _normalize_sport_value(col: int, value: int | str) -> str:
        if col not in SPORT_WRITE_COLS:
            raise SheetsError("table_not_configured")

        if col == PACE_COL_1BASED:
            match = _PACE_RE.match(str(value).strip())
            if not match:
                raise SheetsError("table_not_configured")
            minutes = int(match.group(1))
            seconds = int(match.group(2))
            if seconds > 59 or minutes < 0:
                raise SheetsError("table_not_configured")
            return f"{minutes:02d}:{seconds:02d}:{match.group(3)}"

        try:
            num = parse_sport_number(str(value).strip().replace(".", ","))
        except (TypeError, ValueError) as exc:
            raise SheetsError("table_not_configured") from exc
        if num is None:
            raise SheetsError("table_not_configured")
        if isinstance(num, float):
            return str(num).replace(".", ",")
        return str(num)

    async def _upsert_sport_cell(
        self, conn: asyncpg.Connection, day_id: int, col: int, value: int | str
    ) -> None:
        stored = self._normalize_sport_value(col, value)
        await conn.execute(
            """
            INSERT INTO sport_values (day_id, field, value)
            VALUES ($1, $2, $3)
            ON CONFLICT (day_id, field)
            DO UPDATE SET value = EXCLUDED.value
            """,
            day_id,
            str(col),
            stored,
        )

    async def write_sport_batch(
        self,
        day: date,
        cells: list[dict[str, int | str]],
        row_1based: int,
    ) -> None:
        del row_1based

        pool = await self._get_pool()
        try:
            async with pool.acquire() as conn:
                day_id = await conn.fetchval(
                    "SELECT id FROM days WHERE day_date = $1",
                    day,
                )
                if day_id is None:
                    raise SheetsError("table_not_configured")

                async with conn.transaction():
                    # Batch semantics: full rewrite for the selected day.
                    # This prevents stale workout/running/cycling cells from
                    # surviving when user removes or re-enters sport values.
                    await conn.execute(
                        "DELETE FROM sport_values WHERE day_id = $1",
                        day_id,
                    )
                    for cell in cells:
                        col = int(cell["col1Based"])
                        await self._upsert_sport_cell(
                            conn, day_id, col, cell["value"]
                        )
        except SheetsError:
            raise
        except (KeyError, TypeError, ValueError) as exc:
            raise SheetsError("table_not_configured") from exc
        except asyncpg.PostgresError as exc:
            raise SheetsError("table_not_configured") from exc

    async def write_sport_cell(
        self, day: date, col_1based: int, value: int | str, row_1based: int
    ) -> None:
        del row_1based

        pool = await self._get_pool()
        try:
            async with pool.acquire() as conn:
                day_id = await conn.fetchval(
                    "SELECT id FROM days WHERE day_date = $1",
                    day,
                )
                if day_id is None:
                    raise SheetsError("table_not_configured")

                async with conn.transaction():
                    await self._upsert_sport_cell(
                        conn, day_id, col_1based, value
                    )
        except SheetsError:
            raise
        except asyncpg.PostgresError as exc:
            raise SheetsError("table_not_configured") from exc

    async def get_month_rows(self, day: date) -> list[dict]:
        raise NotImplementedError(
            "get_month_rows — нужен для воскресных графиков routine."
        )

    async def get_month_sport(self, day: date) -> dict:
        raise NotImplementedError(
            "get_month_sport — нужен для воскресных графиков sport."
        )
