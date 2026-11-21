"""Парсинг числовых полей спорта (целые и дробные через запятую)."""

import re
from typing import Union

SPORT_NUMBER_RE = re.compile(r"^\d+(?:,\d+)?$")

SportNumber = Union[int, float]


def parse_sport_number(text: str) -> SportNumber | None:
    """Принимает «6», «6,7»; возвращает int или float ≥ 0."""
    raw = (text or "").strip().replace(" ", "")
    if not raw or not SPORT_NUMBER_RE.match(raw):
        return None
    if "," in raw:
        value = float(raw.replace(",", "."))
    else:
        value = int(raw)
    if value < 0:
        return None
    if isinstance(value, float) and value == int(value):
        return int(value)
    return value


def is_sport_number(value: object) -> bool:
    return isinstance(value, (int, float)) and value >= 0
