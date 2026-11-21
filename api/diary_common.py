"""Общие хелперы дневника."""

from __future__ import annotations

import calendar
import re
from datetime import date

from finance_common import month_bounds

# Синхрон с mini-app/diary.js (wiki / #теги).
_WIKI_RE = re.compile(r"\[\[([^\]|#^]+)\]\]")
_HASHTAG_RE = re.compile(r"#([^\s#.,;:!?)\[\]{}<>\"']+)")


def month_elapsed_days(year_month: str, today: date | None = None) -> int:
    """Сколько календарных дней месяца уже наступило (включая сегодня), не больше длины месяца."""
    ref = today or date.today()
    start, end = month_bounds(year_month)
    if ref < start:
        return 0
    if ref > end:
        return (end - start).days + 1
    return (ref - start).days + 1


def days_in_month(year_month: str) -> int:
    y, m = map(int, year_month.split("-"))
    return calendar.monthrange(y, m)[1]


def normalize_diary_body(raw: object) -> str:
    if raw is None:
        return ""
    return str(raw).replace("\r\n", "\n").replace("\r", "\n")


def extract_wiki_links(text: str) -> list[str]:
    out: list[str] = []
    body = text or ""
    for m in _WIKI_RE.finditer(body):
        if m.start() > 0 and body[m.start() - 1] == "!":
            continue
        label = m.group(1).strip()
        if label:
            out.append(label)
    return out


def extract_hashtags(text: str) -> list[str]:
    out: list[str] = []
    body = text or ""
    for m in _HASHTAG_RE.finditer(body):
        if m.start() > 0 and body[m.start() - 1] == "#":
            continue
        tag = m.group(1).strip()
        if tag:
            out.append(tag)
    return out
