"""Общие константы и хелперы питания. Single-user + XOR food/product."""

from __future__ import annotations

import re
import unicodedata
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from bju_score import bju_score_fields

if TYPE_CHECKING:
    import psycopg

MEAL_ORDER: tuple[str, ...] = ("breakfast", "lunch", "dinner", "snacks")

MEAL_LABELS: dict[str, str] = {
    "breakfast": "Завтрак",
    "lunch": "Обед",
    "dinner": "Ужин",
    "snacks": "Снеки",
    "uncategorized": "Без группы",
}

MEAL_IDS = frozenset(MEAL_ORDER) | frozenset({"uncategorized"})

# weighed × factor → учётные граммы (база КБЖУ = сырое/сухое на 100 г).
# Fallback, если имя не попало в COOK_FACTOR_RULES (матрица A/B/C/D).
COOK_MODE_FACTORS: dict[str, float] = {
    "plain": 1.0,
    "boil_pasta": 101.0 / 274.0,
    "boil_grain": 1.0 / 2.7,
    "boil_legume": 1.0 / 2.3,
    "steam_meat": 1.25,
    "boil_meat": 1.25,
    "stew_meat": 1.0 / 0.85,
    "fry_meat": 1.275,
    "fry_stew_meat": 1.275 * (1.0 / 0.85),
    # Овощи: каталог = сырое/заморозка на 100 г. Пар/варка почти не меняют вес; жарка сушит + масло отдельно.
    "steam_veg": 1.1,
    "boil_veg": 1.05,
    "fry_veg": 1.2,
}
COOK_MODE_IDS = frozenset(COOK_MODE_FACTORS)
FRY_COOK_MODES = frozenset({"fry_meat", "fry_stew_meat", "fry_veg"})
# Дневник: те же режимы, что в блюде (жарка + масло для мяса/рыбы/овощей).
DIARY_COOK_MODE_IDS = COOK_MODE_IDS
COOK_KIND_IDS = frozenset({"pasta", "grain", "legume", "meat_fish", "veg"})
OIL_KCAL_PER_G = 9.0
# Single-user life-dashboard: скрытие food после adopt.
HIDDEN_FOOD_USER_ID = 1

# Рамочные помарки в названии своих продуктов (до матча cook_kind).
_COOK_NAME_TYPO_FIXES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"крпы"), "крупы"),
    (re.compile(r"крпа\b"), "крупа"),
    (re.compile(r"круа\b"), "крупа"),
    (re.compile(r"гречкк"), "гречк"),
    (re.compile(r"говяин"), "говядин"),
    (re.compile(r"свиин"), "свинин"),
    (re.compile(r"курицц"), "куриц"),
    (re.compile(r"индейкк"), "индейк"),
    (re.compile(r"лосос\b"), "лосось"),
    (re.compile(r"шашл\b"), "шашлык"),
]

# First-match wins. Паста раньше крупы (рисовая лапша → pasta).
# Мясо раньше круп (филе куриное с гречкой → meat_fish).
# Стручковая фасоль → veg до бобовых. Овощи последними (рис с овощами → grain).
_COOK_KIND_FROM_NAME: list[tuple[str, re.Pattern[str]]] = [
    (
        "pasta",
        re.compile(
            r"(?i)макарон|спагетт|пенне|вермишел|лапш|фунчоз|ньокк|орзо\b|"
            r"рожки|спираль|гнёзд|лингвини|тальятелл|"
            r"(?<!томатная )(?<!томатной )(?<!томатные )паста\b"
        ),
    ),
    (
        "meat_fish",
        re.compile(
            r"(?i)мясо|говядин|свинин|баранин|телятин|куриц|курин|индейк|цыпл|"
            r"утка\b|гусь\b|кролик|перепел|фарш|стейк|бекон|вырезка|"
            r"филе\b|грудк|бедр|голен|эскалоп|шашлык|"
            r"лосос|сёмг|семг|форел|тунец|минтай|треск|хек|сельдь|селёдк|"
            r"скумбр|горбуш|сибас|дорад|палтус|кревет|кальмар|мидии|"
            r"краб(?!ов)|рыб[аые]|морепродукт|^рыба\b"
        ),
    ),
    (
        "veg",
        re.compile(r"(?i)стручков"),
    ),
    (
        "legume",
        re.compile(
            r"(?i)фасоль|чечевиц|горох\b|нут\b|маш\b|бобы|бобов|эдамаме"
        ),
    ),
    (
        "grain",
        # пшен(?!и) = пшено/пшёнка, не «пшеничный» хлеб.
        re.compile(
            r"(?i)крупа|крупы|гречк|рис\b|овсян|пшен(?!и)|перлов|ячнев|манк|"
            r"киноа|булгур|кускус|полб|геркулес|полента|хлопь|мюсли|каша\b"
        ),
    ),
    (
        "veg",
        re.compile(
            r"(?i)овощ|брокколи|кабачок|цукини|баклажан|морков|свёкл|свекл|"
            r"шпинат|спаржа|кольраби|патиссон|тыкв|капуст|картофел|картошк|"
            r"болгарск|помидор|томат(?!н)|огурец|огурц|редис|сельдерей|"
            r"фенхель|порей|репчат|горошек|стручков|гриб|кукуруз"
        ),
    ),
]


def soften_cook_name_typos(name: str) -> str:
    """Лёгкая нормализация помарок перед матчем cook_kind."""
    s = unicodedata.normalize("NFC", str(name or "")).casefold()
    for pat, repl in _COOK_NAME_TYPO_FIXES:
        s = pat.sub(repl, s)
    return s


# Яйца/омлет не мясо: «яйца куриного» ловит курин → meat_fish. Шоколадные яйца — обычный матч.
_EGG_PRODUCT_RE = re.compile(r"(?i)яйц|яичниц|омлет")
_CHOCOLATE_RE = re.compile(r"(?i)шоколад")
# Готовые к еде: без чипов готовки (хлеб ≠ крупа; авокадо ≠ овощ для варки).
_NO_COOK_PRODUCT_RE = re.compile(
    r"(?i)хлеб|батон(?![а-яёa-z0-9])|багет|чиабатт|фокачч|лаваш|лепёшк|лепешк|"
    r"булк|булочк|круассан|баранк|сухар|гренк|тартин|"
    r"(?<![а-яёa-z0-9])тост(?![а-яёa-z0-9])|"
    r"авокадо"
)
# Категории каталога: cook_kind с категории не показываем (и имя не доугадываем).
NO_COOK_CATEGORY_SLUGS = frozenset(
    {"eggs", "bread_bakery", "fruits_berries", "sweets", "snacks", "drinks"}
)


def is_egg_product_name(name: str) -> bool:
    """Яйца/омлет — без чипов готовки (не путать с «куриные яйца» → мясо)."""
    s = soften_cook_name_typos(name)
    if not _EGG_PRODUCT_RE.search(s):
        return False
    if _CHOCOLATE_RE.search(s):
        return False
    return True


def is_no_cook_product_name(name: str) -> bool:
    """Хлеб/выпечка/авокадо и т.п. — без чипов «сырой/варёный»."""
    s = soften_cook_name_typos(name)
    if not s.strip():
        return False
    if is_egg_product_name(name):
        return True
    return bool(_NO_COOK_PRODUCT_RE.search(s))


def should_skip_cook_kind(name: str, category_slug: str | None = None) -> bool:
    """Не показывать блок готовки: категория или имя (хлеб, яйца, авокадо…)."""
    slug = str(category_slug or "").strip().lower()
    if slug in NO_COOK_CATEGORY_SLUGS:
        return True
    return is_no_cook_product_name(name)


def infer_cook_kind_from_name(name: str) -> str | None:
    """Определяет cook_kind по ключевым словам в названии (свои продукты / пробелы в каталоге)."""
    s = soften_cook_name_typos(name)
    if not s.strip():
        return None
    if is_no_cook_product_name(name):
        return None
    for kind, pat in _COOK_KIND_FROM_NAME:
        if pat.search(s):
            return kind
    return None


def resolve_cook_kind(raw: Any, name: str) -> str | None:
    """Явный cookKind из body, иначе вывод из названия."""
    kind = str(raw or "").strip().lower()
    if kind in COOK_KIND_IDS:
        return kind
    return infer_cook_kind_from_name(name)


def is_fry_cook_mode(raw: Any) -> bool:
    return normalize_cook_mode(raw) in FRY_COOK_MODES


def normalize_cook_mode(raw: Any) -> str:
    mode = str(raw or "plain").strip().lower()
    return mode if mode in COOK_MODE_IDS else "plain"


def normalize_diary_cook_mode(raw: Any) -> str:
    mode = normalize_cook_mode(raw)
    return mode if mode in DIARY_COOK_MODE_IDS else "plain"


def parse_oil_grams(raw: Any) -> float | None:
    """Масло при жарке: пусто → 0; мусор → None."""
    if raw is None or raw == "":
        return 0.0
    v = parse_positive_number(raw)
    if v is None:
        return None
    return max(0.0, float(v))


def apply_fry_oil_macros(
    macros: dict[str, float], cook_mode: str, oil_grams: float = 0.0
) -> dict[str, float]:
    """К массе/белку масла нет; при жарке + масло → +ккал и жир."""
    out = dict(macros)
    oil = max(0.0, float(oil_grams or 0))
    if oil > 0 and is_fry_cook_mode(cook_mode):
        out["kcal"] = float(out.get("kcal") or 0) + oil * OIL_KCAL_PER_G
        out["fat"] = float(out.get("fat") or 0) + oil
    return out


def resolve_cook_factor(name: str | None, cook_mode: str) -> float:
    """Кэф по матрице замеров (имя + режим) или fallback COOK_MODE_FACTORS."""
    from cook_factor_rules import COOK_FACTOR_RULES

    mode = normalize_cook_mode(cook_mode)
    if name and str(name).strip():
        for _rule_id, modes, factor, matcher in COOK_FACTOR_RULES:
            if mode in modes and matcher(name):
                return factor
    return COOK_MODE_FACTORS.get(mode, 1.0)


def account_grams_from_weighed(
    weighed: float, cook_mode: str, *, product_name: str | None = None
) -> float:
    factor = resolve_cook_factor(product_name, cook_mode)
    return round(weighed * factor, 1)


def cooked_grams_from_raw(
    raw: float, cook_mode: str, *, product_name: str | None = None
) -> float:
    """Сырой/сухой вес → вес после выбранной готовки (обратный diary-фактор)."""
    raw_g = float(raw or 0)
    if raw_g <= 0:
        return 0.0
    factor = resolve_cook_factor(product_name, cook_mode)
    if factor <= 0:
        return round(raw_g, 1)
    return round(raw_g / factor, 1)


# Макросы строки лога: продукт или food. Adopt → КБЖУ замены (p_rep).
LOG_ITEM_MACRO_SELECT = """
    COALESCE(p.name, p_rep.name, f.name) AS name,
    COALESCE(p.kcal_per_100g, p_rep.kcal_per_100g, f.kcal_per_100g, 0) AS kcal_per_100g,
    COALESCE(p.protein_per_100g, p_rep.protein_per_100g, f.protein_per_100g, 0) AS protein_per_100g,
    COALESCE(p.fat_per_100g, p_rep.fat_per_100g, f.fat_per_100g, 0) AS fat_per_100g,
    COALESCE(p.carbs_per_100g, p_rep.carbs_per_100g, f.carbs_per_100g, 0) AS carbs_per_100g,
    COALESCE(p.fiber_per_100g, p_rep.fiber_per_100g, f.fiber_per_100g, 0) AS fiber_per_100g,
    COALESCE(p.cook_kind, p_rep.cook_kind, f.cook_kind, fc.cook_kind) AS cook_kind,
    COALESCE(p.is_dish, p_rep.is_dish, false) AS is_dish,
    COALESCE(nl.product_id, uhf.product_id) AS resolved_product_id,
    CASE WHEN uhf.product_id IS NOT NULL THEN NULL ELSE nl.food_id END AS resolved_food_id
"""

LOG_ITEM_JOINS = f"""
    LEFT JOIN products p ON p.id = nl.product_id
    LEFT JOIN food f ON f.id = nl.food_id
    LEFT JOIN food_categories fc ON fc.id = f.category_id
    LEFT JOIN user_hidden_food uhf
        ON uhf.food_id = nl.food_id AND uhf.user_id = {HIDDEN_FOOD_USER_ID}
    LEFT JOIN products p_rep
        ON p_rep.id = uhf.product_id
"""


def normalize_product_name(name: str) -> str:
    return unicodedata.normalize("NFC", name.strip().lower())


def parse_positive_number(raw: Any) -> float | None:
    if raw is None:
        return None
    s = str(raw).strip().replace(",", ".")
    if not s:
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    if v < 0:
        return None
    return v


def parse_grams_input(raw: Any) -> float | None:
    v = parse_positive_number(raw)
    if v is None or v <= 0:
        return None
    return v


RESTAURANT_FOOD_SOURCES = frozenset({"vkusnoitochka", "shvili"})
READY_MEAL_RETAIL_SOURCES = frozenset({"perekrestok", "magnit", "lenta", "lavka"})

_PARENS_RE = re.compile(r"\([^)]*\)")
_MULTIPACK_G_RE = re.compile(
    r"(?i)(\d+)\s*[xх×]\s*(\d+(?:[.,]\d+)?)\s*г(?:\.|р)?"
)
_NAME_G_RE = re.compile(r"(?i)(\d+(?:[.,]\d+)?)\s*г(?:\.|р)?(?=[,\s]|$)")
_NAME_ML_RE = re.compile(r"(?i)(\d+(?:[.,]\d+)?)\s*мл(?=[,\s]|$)")
_BULK_PACK_RE = re.compile(r"(?i)1\s*кг|1000\s*г")
_SWEETS_PORTION_RE = re.compile(
    r"(?i)батончик|шоколад|конфет|вафл|печень|леденц|жевательн|драже|пастил|мармелад"
)
_DAIRY_PORTION_RE = re.compile(
    r"(?i)йогурт|творог|кефир|ряженк|сметан|десерт|молоко"
)
_DAIRY_BULK_RE = re.compile(r"(?i)1\s*л\b|1\s*кг|900\s*г|1000\s*г")


def _parse_name_number(raw: str) -> float | None:
    s = str(raw or "").strip().replace(",", ".")
    if not s:
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    if v <= 0:
        return None
    return round(v, 1)


def parse_weight_g_from_name(name: str) -> float | None:
    """Граммовка из названия; скобки (…135 г…) не разбираем."""
    s = _PARENS_RE.sub("", str(name or ""))
    m = _MULTIPACK_G_RE.search(s)
    if m:
        return _parse_name_number(m.group(2))
    matches = list(_NAME_G_RE.finditer(s))
    if not matches:
        return None
    return _parse_name_number(matches[-1].group(1))


def parse_volume_ml_from_name(name: str) -> float | None:
    s = _PARENS_RE.sub("", str(name or ""))
    matches = list(_NAME_ML_RE.finditer(s))
    if not matches:
        return None
    return _parse_name_number(matches[-1].group(1))


def suggested_serving_grams(
    name: str,
    *,
    source: str | None = None,
    category_slug: str | None = None,
) -> float | None:
    """Порция из названия, если уверены; иначе None (UI → 100 г)."""
    src = str(source or "").strip().lower()
    cat = str(category_slug or "").strip().lower()
    if src == "generic":
        return None
    if _BULK_PACK_RE.search(name):
        return None

    grams = parse_weight_g_from_name(name)
    ml = parse_volume_ml_from_name(name)

    if src in RESTAURANT_FOOD_SOURCES:
        return grams

    if grams is not None and grams > 300:
        return None

    if cat == "snacks" and grams is not None and 30 <= grams <= 150:
        return grams

    if cat == "baby_food" and grams is not None and grams <= 150:
        return grams

    if (
        cat == "sweets"
        and grams is not None
        and 20 <= grams <= 100
        and _SWEETS_PORTION_RE.search(name)
    ):
        return grams

    if cat == "drinks" and ml is not None and 200 <= ml <= 500:
        return ml

    if (
        cat == "ready_meals"
        and src in READY_MEAL_RETAIL_SOURCES
        and grams is not None
        and 100 <= grams <= 350
    ):
        return grams

    if (
        cat == "dairy"
        and grams is not None
        and 100 <= grams <= 200
        and _DAIRY_PORTION_RE.search(name)
        and not _DAIRY_BULK_RE.search(name)
    ):
        return grams

    return None


def macro_for_grams(per_100: dict[str, Any], grams: float) -> dict[str, float]:
    factor = grams / 100.0

    def _n(key: str) -> float:
        val = per_100.get(key)
        if isinstance(val, Decimal):
            return float(val)
        return float(val or 0)

    return {
        "kcal": _n("kcal_per_100g") * factor,
        "protein": _n("protein_per_100g") * factor,
        "fat": _n("fat_per_100g") * factor,
        "carbs": _n("carbs_per_100g") * factor,
        "fiber": _n("fiber_per_100g") * factor,
    }


def product_row_to_api(row: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": int(row["id"]),
        "name": row["name"],
        "kcalPer100g": float(row["kcal_per_100g"] or 0),
        "proteinPer100g": float(row["protein_per_100g"] or 0),
        "fatPer100g": float(row["fat_per_100g"] or 0),
        "carbsPer100g": float(row["carbs_per_100g"] or 0),
        "fiberPer100g": float(row["fiber_per_100g"] or 0),
    }
    out.update(
        bju_score_fields(
            kcal=out["kcalPer100g"],
            protein=out["proteinPer100g"],
            fat=out["fatPer100g"],
            carbs=out["carbsPer100g"],
            fiber=out["fiberPer100g"],
        )
    )
    if "last_serving_grams" in row and row["last_serving_grams"] is not None:
        out["lastServingGrams"] = float(row["last_serving_grams"])
    ck = row.get("cook_kind")
    is_dish = bool(row.get("is_dish"))
    if is_dish:
        out["isDish"] = True
        yg = row.get("dish_yield_grams")
        if yg is not None:
            out["dishYieldGrams"] = float(yg)
    else:
        pname = row.get("name") or ""
        if should_skip_cook_kind(pname, row.get("category_slug")):
            ck = None
        elif not ck:
            ck = infer_cook_kind_from_name(pname)
        if ck:
            out["cookKind"] = ck
    fid = row.get("food_id")
    if fid is not None:
        out["foodId"] = int(fid)
    if row.get("from_catalog"):
        out["fromCatalog"] = True
        if fid is None:
            out["foodId"] = int(row["id"])
    suggested = suggested_serving_grams(
        row.get("name") or "",
        source=row.get("source"),
        category_slug=row.get("category_slug"),
    )
    if suggested is not None:
        out["suggestedServingGrams"] = suggested
    return out


PRODUCT_SELECT_COLS = (
    "id, name, kcal_per_100g, protein_per_100g, fat_per_100g, "
    "carbs_per_100g, fiber_per_100g, last_serving_grams, cook_kind, "
    "is_dish, dish_yield_grams"
)


def remember_last_serving_grams(
    conn: "psycopg.Connection",
    product_id: int,
    grams: float,
) -> None:
    conn.execute(
        """
        UPDATE products
        SET last_serving_grams = %s, updated_at = now()
        WHERE id = %s
        """,
        (Decimal(str(grams)), product_id),
    )


def remember_last_serving_food_grams(
    conn: "psycopg.Connection",
    food_id: int,
    grams: float,
) -> None:
    conn.execute(
        """
        INSERT INTO food_preferences (food_id, last_serving_grams)
        VALUES (%s, %s)
        ON CONFLICT (food_id) DO UPDATE SET
            last_serving_grams = EXCLUDED.last_serving_grams,
            updated_at = now()
        """,
        (food_id, Decimal(str(grams))),
    )
