"""Оценка продукта по БЖУ (упрощённый Yuka): только ккал + макросы.

Без состава, сахара, соли, добавок. Балл считается на лету — в БД не храним.
"""

from __future__ import annotations

from typing import Any, Literal

BjuTier = Literal["high", "mid", "low"]

TIER_HIGH_MIN = 70
TIER_MID_MIN = 40


def _f(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def compute_bju_score(
    *,
    kcal: Any = None,
    protein: Any = None,
    fat: Any = None,
    carbs: Any = None,
    fiber: Any = None,
) -> tuple[int | None, BjuTier | None]:
    """Вернуть (score 0–100, tier) или (None, None), если считать нечего."""
    p = _f(protein) or 0.0
    f = _f(fat) or 0.0
    c = _f(carbs) or 0.0
    fi = _f(fiber) or 0.0
    k = _f(kcal)

    if k is None or k <= 0:
        k = 4.0 * p + 9.0 * f + 4.0 * c
    if k <= 0:
        return None, None
    # Хотя бы один макрос / ккал — иначе бессмысленно
    if p == 0 and f == 0 and c == 0 and _f(kcal) is None:
        return None, None

    # г белка на 100 ккал — главный сигнал «качества» калорий
    pd = (p / k) * 100.0

    if pd <= 0:
        protein_score = 0.0
    elif pd < 2:
        protein_score = (pd / 2.0) * 25.0
    elif pd < 5:
        protein_score = 25.0 + ((pd - 2.0) / 3.0) * 25.0
    elif pd < 10:
        protein_score = 50.0 + ((pd - 5.0) / 5.0) * 25.0
    else:
        protein_score = 75.0 + min(15.0, ((pd - 10.0) / 5.0) * 15.0)

    fiber_score = min(12.0, fi * 1.2)

    penalty = 0.0
    if k >= 450 and pd < 3:
        penalty += min(25.0, (k - 450.0) / 18.0)
    if f >= 40 and pd < 4:
        penalty += min(20.0, (f - 40.0) / 3.0)

    score = int(round(max(0.0, min(100.0, protein_score + fiber_score - penalty))))
    if score >= TIER_HIGH_MIN:
        tier: BjuTier = "high"
    elif score >= TIER_MID_MIN:
        tier = "mid"
    else:
        tier = "low"
    return score, tier


def bju_score_fields(
    *,
    kcal: Any = None,
    protein: Any = None,
    fat: Any = None,
    carbs: Any = None,
    fiber: Any = None,
) -> dict[str, Any]:
    score, tier = compute_bju_score(
        kcal=kcal, protein=protein, fat=fat, carbs=carbs, fiber=fiber
    )
    if score is None or tier is None:
        return {}
    return {"bjuScore": score, "bjuTier": tier}
