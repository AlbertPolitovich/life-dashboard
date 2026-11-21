from dataclasses import dataclass


@dataclass(frozen=True)
class SportField:
    label: str
    col_1based: int


WARMUP_FIELD = SportField("Разминка, min", 10)
STRETCH_FIELD = SportField("Растяжка, min", 11)

CYCLING_FIELDS: tuple[SportField, ...] = (
    SportField("Cycling, km", 19),
    SportField("Cycling time, min", 20),
    SportField("Wt (avr)", 21),
    SportField("Heart rate cycling (avr)", 22),
)

WORKOUT_FIELDS: tuple[SportField, ...] = (
    SportField("Workout, min", 14),
    SportField("Push ups", 13),
    SportField("Pull ups", 12),
)

RUNNING_FIELDS: tuple[SportField, ...] = (
    SportField("Run, km", 15),
    SportField("Run time, min", 16),
    SportField("Pace (median)", 17),
    SportField("Heart rate running (avr)", 18),
)

SPORT_FIELD_BY_COL: dict[int, SportField] = {
    f.col_1based: f
    for block in (CYCLING_FIELDS, WORKOUT_FIELDS, RUNNING_FIELDS)
    for f in block
}
SPORT_FIELD_BY_COL[WARMUP_FIELD.col_1based] = WARMUP_FIELD
SPORT_FIELD_BY_COL[STRETCH_FIELD.col_1based] = STRETCH_FIELD

# step_id → поле (только шаги ввода числа)
FIELD_STEP_TO_FIELD: dict[str, SportField] = {
    "cycling_km": CYCLING_FIELDS[0],
    "cycling_time": CYCLING_FIELDS[1],
    "cycling_wt": CYCLING_FIELDS[2],
    "cycling_hr": CYCLING_FIELDS[3],
    "workout_min": WORKOUT_FIELDS[0],
    "push_ups": WORKOUT_FIELDS[1],
    "pull_ups": WORKOUT_FIELDS[2],
    "running_km": RUNNING_FIELDS[0],
    "running_time": RUNNING_FIELDS[1],
    "running_hr": RUNNING_FIELDS[3],
}

WARMUP_STEP = "warmup"
STRETCH_STEP = "stretching"
OPTIONAL_MINUTES_STEPS: frozenset[str] = frozenset({WARMUP_STEP, STRETCH_STEP})

# Шаги с кнопкой «Пропустить» — в таблицу не пишем
SKIPPABLE_FIELD_STEPS: frozenset[str] = frozenset(
    {
        WARMUP_STEP,
        STRETCH_STEP,
        "cycling_wt",
        "workout_min",
        "push_ups",
        "pull_ups",
        "running_hr",
    }
)

PACE_FIELD_STEP = "running_pace"
PACE_COL_1BASED = RUNNING_FIELDS[2].col_1based
