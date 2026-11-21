"""Синонимы поиска каталога food (v1.5). Только код, без таблиц."""

from __future__ import annotations

# Стемы для ILIKE %stem%. Короткие/шумные (маш, пшен, паста как расширение макарон) — не кладём.
_PASTA_SHAPES: tuple[str, ...] = (
    "макарон",
    "спагетт",
    "пенне",
    "фузилл",
    "фарфалл",
    "вермишел",
    "лапш",
    "удон",
    "фунчоз",
    "фетуч",
    "феттуч",
    "лингвин",
    "ригатон",
    "лазан",
    "птитим",
    "орзо",
    "каппеллин",
    "ширатаки",
    "рожки",
    "ракуш",
    "спираль",
    "перья",
    "бантик",
    "гнёзд",
    "гнезд",
)

_LAPSHA: tuple[str, ...] = (
    "лапш",
    "удон",
    "соба",
    "фунчоз",
    "вермишел",
    "ширатаки",
)

_KRUPA: tuple[str, ...] = (
    "гречк",
    "рис",
    "овсян",
    "перлов",
    "пшено",
    "пшён",
    "киноа",
    "булгур",
    "кускус",
    "полб",
    "манн",
    "ячмен",
    "амарант",
)

_BOBOVYE: tuple[str, ...] = (
    "чечевиц",
    "нут",
    "фасол",
    "горох",
)

_PTICA: tuple[str, ...] = (
    "курин",
    "куриц",
    "цыпл",
    "индейк",
)

_RYBA: tuple[str, ...] = (
    "лосос",
    "сёмг",
    "семг",
    "треск",
    "тунец",
    "сельд",
    "форел",
    "скумбр",
    "минтай",
    "горбуш",
)

_MOREPRODUCTY: tuple[str, ...] = (
    "креветк",
    "кальмар",
    "мидии",
    "мидия",
    "осьминог",
    "гребеш",
)

_KOLBASA: tuple[str, ...] = (
    "сосиск",
    "сардельк",
    "ветчин",
    "сервелат",
    "буженин",
    "балык",
    "колбас",
)

_HLEB: tuple[str, ...] = (
    "хлеб",
    "батон",
    "багет",
    "чиабатт",
    "лаваш",
    "лепёш",
    "лепеш",
    "тостовый",
)

_ZELEN: tuple[str, ...] = (
    "кинза",
    "петрушк",
    "укроп",
    "базилик",
)

# ключ (нижний регистр, ё→е) → стемы
_SYNONYM_GROUPS: dict[str, tuple[str, ...]] = {
    "макароны": _PASTA_SHAPES,
    "макаронные": _PASTA_SHAPES,
    "макарон": _PASTA_SHAPES,
    "паста": _PASTA_SHAPES,
    "лапша": _LAPSHA,
    "крупа": _KRUPA,
    "крупы": _KRUPA,
    "каша": ("геркулес", "овсян", "каша"),
    "бобовые": _BOBOVYE,
    "птица": _PTICA,
    "рыба": _RYBA,
    "морепродукты": _MOREPRODUCTY,
    "колбаса": _KOLBASA,
    "колбаски": _KOLBASA,
    "хлеб": _HLEB,
    "зелень": _ZELEN,
}


def _norm(text: str) -> str:
    return text.strip().lower().replace("ё", "е")


def _candidate_keys(text: str) -> list[str]:
    """Ключи для словаря: оригинал + усечение окончания + й↔ы после транслита."""
    low = _norm(text)
    if not low:
        return []
    keys = [low]
    if low.endswith("й"):
        keys.append(low[:-1] + "ы")
        keys.append(low[:-1])
    if low.endswith(("ы", "и", "е", "а", "я")) and len(low) > 4:
        keys.append(low[:-1])
    if low.endswith("ные") and len(low) > 5:
        keys.append(low[:-3])
    # dedupe, keep order
    seen: set[str] = set()
    out: list[str] = []
    for k in keys:
        if k and k not in seen:
            seen.add(k)
            out.append(k)
    return out


def synonym_stems(query: str) -> list[str]:
    """Доп. стемы по словарю для запроса (без транслита — его даёт search_variants)."""
    q = (query or "").strip()
    if not q:
        return []
    found: tuple[str, ...] | None = None
    for key in _candidate_keys(q):
        if key in _SYNONYM_GROUPS:
            found = _SYNONYM_GROUPS[key]
            break
    if found is None:
        # префикс: «макарон» ↔ «макароны», мин. длина 4
        low = _norm(q)
        if len(low) >= 4:
            for key, stems in _SYNONYM_GROUPS.items():
                if len(key) >= 4 and (low.startswith(key) or key.startswith(low)):
                    found = stems
                    break
    if not found:
        return []
    qn = _norm(q)
    return [s for s in found if _norm(s) != qn]
