import re
from datetime import date, timedelta

DATE_INPUT_RE = re.compile(r"^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$")
TIME_INPUT_RE = re.compile(r"^(\d{1,2}):(\d{2})$")

WEEKDAYS = (
    "понедельник",
    "вторник",
    "среда",
    "четверг",
    "пятница",
    "суббота",
    "воскресенье",
)

RECENT_FILL_DAYS = 2


def yesterday() -> date:
    return date.today() - timedelta(days=1)


def recent_fill_dates(count: int = RECENT_FILL_DAYS) -> list[date]:
    """Два дня до сегодня: при today=20.05 → 18.05, 19.05."""
    today = date.today()
    return [today - timedelta(days=offset) for offset in range(count, 0, -1)]


def short_label(day: date) -> str:
    return day.strftime("%d.%m")


def full_label(day: date) -> str:
    weekday = WEEKDAYS[day.weekday()]
    return f"{day.strftime('%d.%m.%Y')}, {weekday}"


def is_sunday(day: date) -> bool:
    return day.weekday() == 6


def parse_date_input(text: str) -> date | None:
    raw = (text or "").strip()
    match = DATE_INPUT_RE.match(raw)
    if not match:
        return None

    day_num = int(match.group(1))
    month_num = int(match.group(2))
    year_str = match.group(3)
    if year_str:
        year = int(year_str)
        if year < 100:
            year += 2000
    else:
        year = date.today().year

    try:
        return date(year, month_num, day_num)
    except ValueError:
        return None


def parse_time_input(text: str) -> tuple[int, int] | None:
    raw = (text or "").strip()
    match = TIME_INPUT_RE.match(raw)
    if not match:
        return None

    hour = int(match.group(1))
    minute = int(match.group(2))
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        return None

    return hour, minute
