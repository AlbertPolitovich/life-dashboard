"""Напоминания по КБЖУ после заполнения спорта (HTML для Telegram)."""

from enum import StrEnum
from typing import Any

from sport_fields import CYCLING_FIELDS, RUNNING_FIELDS, WORKOUT_FIELDS

KBJU_PARSE_MODE = "HTML"

_CYCLING_COLS = frozenset(f.col_1based for f in CYCLING_FIELDS)
_RUNNING_COLS = frozenset(f.col_1based for f in RUNNING_FIELDS)
_WORKOUT_COLS = frozenset(f.col_1based for f in WORKOUT_FIELDS)
_CYCLING_TIME_COL = CYCLING_FIELDS[1].col_1based  # Cycling time, min
_CYCLING_LONG_MIN = 90


class SportDayKind(StrEnum):
    REST = "rest"
    WORKOUT = "workout"
    CYCLING = "cycling"
    CYCLING_LONG = "cycling_long"
    RUNNING = "running"
    # Ручной override в мини-аппе; classify_sport_day() его не возвращает.
    CHEATMEAL = "cheatmeal"


def _line_calories(value: str) -> str:
    return f"<b>Калории</b> {value}"


def _line_fats(value: str) -> str:
    return f"<b>Жиры</b> {value}"


def _line_protein(value: str, *, underline: bool = False) -> str:
    amount = f"<u>{value}</u>" if underline else value
    return f"<b>Белок</b> {amount}"


def _line_carbs(value: str, *, underline: bool = False) -> str:
    amount = f"<u>{value}</u>" if underline else value
    return f"<b>Углеводы</b> {amount}"


def _kbju_block(
    *,
    calories: str,
    protein: str,
    fats: str,
    carbs: str,
    protein_underline: bool = False,
    carbs_underline: bool = False,
) -> str:
    lines = (
        _line_calories(calories),
        _line_protein(protein, underline=protein_underline),
        _line_fats(fats),
        _line_carbs(carbs, underline=carbs_underline),
    )
    return "\n".join(lines)


_KBJU_TEXT: dict[SportDayKind, str] = {
    SportDayKind.REST: (
        "Сегодня день отдыха:\n\n"
        + _kbju_block(
            calories="2000–2100",
            protein="150 г",
            fats="75 г",
            carbs="200 г",
        )
    ),
    SportDayKind.WORKOUT: (
        "Не забудь про КБЖУ после воркаута:\n\n"
        + _kbju_block(
            calories="2350–2500",
            protein="155 г",
            fats="75 г",
            carbs="270 г",
            protein_underline=True,
        )
    ),
    SportDayKind.CYCLING: (
        "Не забудь про КБЖУ после вело (60–90 мин):\n\n"
        + _kbju_block(
            calories="2450–2600",
            protein="150 г",
            fats="65 г",
            carbs="320 г",
            carbs_underline=True,
        )
    ),
    SportDayKind.CYCLING_LONG: (
        "Не забудь про КБЖУ после длинного вело (90+ мин):\n\n"
        + _kbju_block(
            calories="2700–2900",
            protein="155 г",
            fats="65 г",
            carbs="380 г",
            carbs_underline=True,
        )
    ),
    SportDayKind.RUNNING: (
        "Не забудь про КБЖУ после бега (30–45 мин):\n\n"
        + _kbju_block(
            calories="2050–2200",
            protein="145 г",
            fats="65 г",
            carbs="240 г",
        )
    ),
}


def _cycling_minutes(pending: dict[int, Any]) -> float | None:
    raw = pending.get(_CYCLING_TIME_COL)
    if raw is None or raw == "":
        return None
    try:
        return float(str(raw).replace(",", ".").strip())
    except (TypeError, ValueError):
        return None


def classify_sport_day(pending: dict[int, Any]) -> SportDayKind:
    """Тип дня по записанным колонкам; при нескольких блоках — приоритет нагрузки.

    Вело: время ≥ 90 мин → cycling_long, иначе cycling (включая отсутствие минут).
    Приоритет: вело → бег → воркаут → отдых.
    """
    cols = set(pending)
    if cols & _CYCLING_COLS:
        minutes = _cycling_minutes(pending)
        if minutes is not None and minutes >= _CYCLING_LONG_MIN:
            return SportDayKind.CYCLING_LONG
        return SportDayKind.CYCLING
    if cols & _RUNNING_COLS:
        return SportDayKind.RUNNING
    if cols & _WORKOUT_COLS:
        return SportDayKind.WORKOUT
    return SportDayKind.REST


def kbju_reminder_text(pending: dict[int, Any]) -> str:
    return _KBJU_TEXT[classify_sport_day(pending)]
