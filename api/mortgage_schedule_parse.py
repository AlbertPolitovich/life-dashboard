"""Парсер PDF графика платежей (Сбер / Домклик)."""

from __future__ import annotations

import re
from datetime import date, datetime
from pathlib import Path

from pypdf import PdfReader

ScheduleRow = tuple[int, date, float, float, float, float]


def parse_ru_amount(raw: str) -> float:
    s = re.sub(r"[\s\t]+", "", raw).replace(",", ".")
    return float(s)


def norm_date(raw: str) -> str:
    return re.sub(r"\s+", "", raw.strip())


def is_date_line(raw: str) -> bool:
    return bool(re.fullmatch(r"\d{2}\.\d{2}\.\d{4}", norm_date(raw)))


def parse_payment_no(raw: str) -> int | None:
    s = raw.strip()
    if "," in s or "." in s:
        return None
    if not re.fullmatch(r"[\d\s\t]+", s):
        return None
    digits = re.sub(r"[\s\t]+", "", s)
    if digits.isdigit() and 1 <= int(digits) <= 999:
        return int(digits)
    return None


def parse_compact_line(line: str) -> ScheduleRow | None:
    line = re.sub(r"\s+", " ", line.strip())
    line = re.sub(r"(\d{2})\.(\d{2})\s*\.\s*(\d{4})", r"\1.\2.\3", line)
    match = re.match(r"^(\d{1,3})\s+(\d{2}\.\d{2}\.\d{4})\s+(.+)$", line)
    if not match:
        return None
    no_s, dt_s, rest = match.groups()
    amounts: list[float] = []
    pos = 0
    for _ in range(4):
        am = re.match(r"([\d\s]+,\d{2})", rest[pos:])
        if not am:
            return None
        amounts.append(parse_ru_amount(am.group(1)))
        pos += am.end()
        while pos < len(rest) and rest[pos] == " ":
            pos += 1
    dt = datetime.strptime(dt_s, "%d.%m.%Y").date()
    return (int(no_s), dt, amounts[0], amounts[1], amounts[2], amounts[3])


def parse_mortgage_schedule_pdf(path: str | Path) -> list[dict[str, object]]:
    """Вернуть строки графика из PDF (уникальные payment_no, по возрастанию)."""
    reader = PdfReader(str(path))
    lines: list[str] = []
    for page in reader.pages:
        for line in (page.extract_text() or "").split("\n"):
            stripped = line.strip()
            if stripped:
                lines.append(stripped)

    parsed: list[ScheduleRow] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        compact = parse_compact_line(line)
        if compact:
            parsed.append(compact)
            i += 1
            continue
        payment_no = parse_payment_no(line)
        if payment_no is not None and i + 5 < len(lines) and is_date_line(lines[i + 1]):
            dt = datetime.strptime(norm_date(lines[i + 1]), "%d.%m.%Y").date()
            amounts = [parse_ru_amount(lines[i + j]) for j in range(2, 6)]
            parsed.append((payment_no, dt, amounts[0], amounts[1], amounts[2], amounts[3]))
            i += 6
            continue
        i += 1

    by_no: dict[int, ScheduleRow] = {row[0]: row for row in parsed}
    rows = [by_no[key] for key in sorted(by_no)]
    return [
        {
            "paymentNo": row[0],
            "dueDate": row[1].isoformat(),
            "principalPart": row[2],
            "interestPart": row[3],
            "paymentTotal": row[4],
            "balanceAfter": row[5],
        }
        for row in rows
    ]
