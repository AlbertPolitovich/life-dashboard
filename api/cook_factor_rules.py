"""Матрица кэфов готовки: id × имя продукта × cook_mode. First-match wins."""

from __future__ import annotations

import re
from typing import Any, Callable

from nutrition_common import soften_cook_name_typos

_FB_STEAM = 1.25
_FB_FRY = 1.275
_FB_STEW = 1.0 / 0.85
_FB_FRY_STEW = _FB_FRY * _FB_STEW
_FB_GRAIN = 1.0 / 2.7
_FB_LEGUME = 1.0 / 2.3

_MEASURED_A1_STEAM = 812.0 / 538.0
_MEASURED_A2_FRY = 420.0 / 350.0
_MEASURED_A3_FRY_STEW = _MEASURED_A2_FRY * _FB_STEW
_MEASURED_A5_FRY = 554.0 / 463.0
_MEASURED_B7_FRY = 500.0 / 385.0
_MEASURED_B7_FRY_STEW = _MEASURED_B7_FRY * _FB_STEW
_MEASURED_C1_STEAM = 190.0 / 120.0
_MEASURED_C3_STEAM = 150.0 / 108.0
_MEASURED_D_GRECHKA = 55.0 / 175.0
_MEASURED_D_PASTA = 101.0 / 274.0

_PASTA_RE = re.compile(
    r"(?i)макарон|спагетт|пенне|вермишел|лапш|фунчоз|ньокк|орзо\b|"
    r"рожки|спираль|гнёзд|лингвини|тальятелл|"
    r"(?<!томатная )(?<!томатной )(?<!томатные )паста\b"
)
_LEGUME_RE = re.compile(r"(?i)фасоль|чечевиц|горох\b|нут\b|маш\b|бобы|бобов|эдамаме")
_VEG_RE = re.compile(
    r"(?i)овощ|брокколи|кабачок|цукини|баклажан|морков|свёкл|свекл|"
    r"шпинат|спаржа|кольраби|патиссон|тыкв|капуст|картофел|картошк|"
    r"болгарск|помидор|томат(?!н)|огурец|огурц|редис|сельдерей|"
    r"фенхель|порей|репчат|горошек|стручков|гриб|кукуруз"
)
_RICE_RE = re.compile(r"(?i)(?<![а-яёa-z0-9])рис\b|рисовый\b")
_OATS_RE = re.compile(r"(?i)овсян|геркулес|хлопь")
_GRECHKA_RE = re.compile(r"(?i)гречк")
_OTHER_GRAIN_RE = re.compile(
    r"(?i)крупа|крупы|пшен(?!и)|перлов|ячнев|манк|киноа|булгур|кускус|полб|полента|каша\b"
)
_PORK_RE = re.compile(r"(?i)свинин")
_BEEF_RE = re.compile(r"(?i)говядин|телятин")
_FARSH_RE = re.compile(r"(?i)фарш")
_SALMON_RE = re.compile(r"(?i)лосос|сёмг|семг|форел")
_COD_RE = re.compile(r"(?i)треск")
_POLLOCK_RE = re.compile(r"(?i)минтай")
_FISH_RE = re.compile(
    r"(?i)рыб[аые]|^рыба\b|хек\b|сельд|селёдк|скумбр|горбуш|тунец|"
    r"сибас|дорад|палтус|кревет|кальмар|мидии|краб(?!ов)|морепродукт"
)
_TURKEY_RE = re.compile(r"(?i)индейк")
_CHICKEN_RE = re.compile(r"(?i)курин|куриц|цыпл")


def _match(pattern: re.Pattern[str]) -> Callable[[str], bool]:
    def _fn(name: str) -> bool:
        return bool(pattern.search(soften_cook_name_typos(name)))

    return _fn


def _is_chicken_breast_name(name: str) -> bool:
    s = soften_cook_name_typos(name)
    if re.search(r"(?i)бедр|голен|окороч|индейк", s):
        return False
    return bool(
        re.search(
            r"(?i)грудк|(?<![а-яёa-z0-9])филе.{0,14}курин|курин.{0,14}филе",
            s,
        )
    )


def _is_chicken_thigh_name(name: str) -> bool:
    s = soften_cook_name_typos(name)
    if _is_chicken_breast_name(name) or _TURKEY_RE.search(s):
        return False
    return bool(re.search(r"(?i)бедр|голен|окороч", s))


def _is_generic_chicken_name(name: str) -> bool:
    s = soften_cook_name_typos(name)
    if _is_chicken_breast_name(name) or _is_chicken_thigh_name(name) or _TURKEY_RE.search(s):
        return False
    return bool(_CHICKEN_RE.search(s))


def _is_other_grain_name(name: str) -> bool:
    s = soften_cook_name_typos(name)
    if _GRECHKA_RE.search(s) or _RICE_RE.search(s) or _OATS_RE.search(s):
        return False
    return bool(_OTHER_GRAIN_RE.search(s))


def _is_generic_fish_name(name: str) -> bool:
    s = soften_cook_name_typos(name)
    if _COD_RE.search(s) or _POLLOCK_RE.search(s) or _SALMON_RE.search(s):
        return False
    return bool(_FISH_RE.search(s))


def _modes(*ids: str) -> frozenset[str]:
    return frozenset(ids)


def _rule(
    rule_id: str, modes: frozenset[str], factor: float, matcher: Callable[[str], bool]
) -> tuple[str, frozenset[str], float, Any]:
    return (rule_id, modes, factor, matcher)


COOK_FACTOR_RULES: list[tuple[str, frozenset[str], float, Any]] = [
    # A: птица
    _rule("A1", _modes("steam_meat", "boil_meat"), _MEASURED_A1_STEAM, _is_chicken_breast_name),
    _rule("A2", _modes("fry_meat"), _MEASURED_A2_FRY, _is_chicken_breast_name),
    _rule("A3", _modes("fry_stew_meat"), _MEASURED_A3_FRY_STEW, _is_chicken_breast_name),
    _rule("A4", _modes("steam_meat", "boil_meat"), _FB_STEAM, _is_chicken_thigh_name),
    _rule("A5", _modes("steam_meat", "boil_meat"), _FB_STEAM, _match(_TURKEY_RE)),
    # Замер 03.09: индейка сырая 554 г → жареная 463 г.
    _rule("A5", _modes("fry_meat"), _MEASURED_A5_FRY, _match(_TURKEY_RE)),
    _rule("A0", _modes("steam_meat", "boil_meat"), _FB_STEAM, _is_generic_chicken_name),
    _rule("A0", _modes("fry_meat"), _FB_FRY, _is_generic_chicken_name),
    _rule("A0", _modes("stew_meat"), _FB_STEW, _is_generic_chicken_name),
    _rule("A0", _modes("fry_stew_meat"), _FB_FRY_STEW, _is_generic_chicken_name),
    # B: мясо
    _rule("B1", _modes("steam_meat", "boil_meat"), _FB_STEAM, _match(_PORK_RE)),
    _rule("B2", _modes("fry_meat"), _FB_FRY, _match(_PORK_RE)),
    _rule("B3", _modes("stew_meat"), _FB_STEW, _match(_PORK_RE)),
    _rule("B3", _modes("fry_stew_meat"), _FB_FRY_STEW, _match(_PORK_RE)),
    _rule("B4", _modes("steam_meat", "boil_meat"), _FB_STEAM, _match(_BEEF_RE)),
    _rule("B5", _modes("fry_meat"), _FB_FRY, _match(_BEEF_RE)),
    _rule("B6", _modes("stew_meat"), _FB_STEW, _match(_BEEF_RE)),
    _rule("B6", _modes("fry_stew_meat"), _FB_FRY_STEW, _match(_BEEF_RE)),
    _rule("B7", _modes("steam_meat", "boil_meat"), _FB_STEAM, _match(_FARSH_RE)),
    # Замер 23.09: фарш сырой 500 г → жареный 385 г.
    _rule("B7", _modes("fry_meat"), _MEASURED_B7_FRY, _match(_FARSH_RE)),
    _rule("B7", _modes("stew_meat"), _FB_STEW, _match(_FARSH_RE)),
    _rule("B7", _modes("fry_stew_meat"), _MEASURED_B7_FRY_STEW, _match(_FARSH_RE)),
    # C: рыба
    _rule("C1", _modes("steam_meat", "boil_meat"), _MEASURED_C1_STEAM, _match(_COD_RE)),
    _rule("C4", _modes("fry_meat"), _FB_FRY, _match(_COD_RE)),
    _rule("C3", _modes("steam_meat", "boil_meat"), _MEASURED_C3_STEAM, _match(_POLLOCK_RE)),
    _rule("C2", _modes("steam_meat", "boil_meat"), _FB_STEAM, _match(_SALMON_RE)),
    _rule("C0", _modes("steam_meat", "boil_meat"), _FB_STEAM, _is_generic_fish_name),
    _rule("C0", _modes("fry_meat"), _FB_FRY, _is_generic_fish_name),
    _rule("C0", _modes("stew_meat"), _FB_STEW, _is_generic_fish_name),
    _rule("C0", _modes("fry_stew_meat"), _FB_FRY_STEW, _is_generic_fish_name),
    # D: крупы / паста
    _rule("D_grechka", _modes("boil_grain"), _MEASURED_D_GRECHKA, _match(_GRECHKA_RE)),
    _rule("D_rice", _modes("boil_grain"), _FB_GRAIN, _match(_RICE_RE)),
    _rule("D_oats", _modes("boil_grain"), _FB_GRAIN, _match(_OATS_RE)),
    _rule("D_grain", _modes("boil_grain"), _FB_GRAIN, _is_other_grain_name),
    _rule("D_pasta", _modes("boil_pasta"), _MEASURED_D_PASTA, _match(_PASTA_RE)),
    # Бобовые
    _rule("L_legume", _modes("boil_legume"), _FB_LEGUME, _match(_LEGUME_RE)),
    # Овощи
    _rule("V_steam", _modes("steam_veg"), 1.1, _match(_VEG_RE)),
    _rule("V_boil", _modes("boil_veg"), 1.05, _match(_VEG_RE)),
    _rule("V_fry", _modes("fry_veg"), 1.2, _match(_VEG_RE)),
]
