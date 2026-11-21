from spheres import SPHERES
from sport_fields import (
    CYCLING_FIELDS,
    RUNNING_FIELDS,
    STRETCH_FIELD,
    WARMUP_FIELD,
    WORKOUT_FIELDS,
)


def format_routine_summary(answers: list[int]) -> str:
    lines = [
        f"{sphere.name} — {value}"
        for sphere, value in zip(SPHERES, answers, strict=True)
    ]
    return "\n".join(lines)


def format_sport_summary(pending: dict[int, int | str]) -> str:
    ordered_fields = (
        (WARMUP_FIELD, STRETCH_FIELD)
        + CYCLING_FIELDS
        + WORKOUT_FIELDS
        + RUNNING_FIELDS
    )
    lines = [
        f"{field.label} — {pending[field.col_1based]}"
        for field in ordered_fields
        if field.col_1based in pending
    ]
    if not lines:
        return "Спорт: без данных"
    return "\n".join(lines)
