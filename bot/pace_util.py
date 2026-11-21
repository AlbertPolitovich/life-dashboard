"""Расчёт Pace (median) из дистанции и времени бега."""

from sport_fields import PACE_COL_1BASED, RUNNING_FIELDS
from sport_parse import SportNumber, is_sport_number

RUN_KM_COL = RUNNING_FIELDS[0].col_1based
RUN_TIME_COL = RUNNING_FIELDS[1].col_1based


def compute_running_pace(run_km: SportNumber, run_time_min: SportNumber) -> str | None:
    """Темп в формате ММ:СС:00 — минуты и секунды на километр (время / км)."""
    if run_km <= 0 or run_time_min <= 0:
        return None
    secs_per_km = round((float(run_time_min) * 60) / float(run_km))
    minutes, seconds = divmod(int(secs_per_km), 60)
    return f"{minutes:02d}:{seconds:02d}:00"


def apply_computed_pace(pending: dict[int, SportNumber | str]) -> None:
    """Дописывает pace в pending, если есть Run km и Run time, min."""
    run_km = pending.get(RUN_KM_COL)
    run_time = pending.get(RUN_TIME_COL)
    if not is_sport_number(run_km) or not is_sport_number(run_time):
        return
    pace = compute_running_pace(run_km, run_time)
    if pace is not None:
        pending[PACE_COL_1BASED] = pace
    else:
        pending.pop(PACE_COL_1BASED, None)
