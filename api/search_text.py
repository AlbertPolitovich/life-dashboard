"""Нормализация поисковых запросов: транслит ru↔en + раскладка клавиатуры."""

from __future__ import annotations

# Многосимвольные замены — сначала длинные.
_CYR_TO_LAT: tuple[tuple[str, str], ...] = (
    ("ще", "sche"),
    ("щё", "schyo"),
    ("щ", "sch"),
    ("ш", "sh"),
    ("ч", "ch"),
    ("ж", "zh"),
    ("ю", "yu"),
    ("я", "ya"),
    ("ё", "yo"),
    ("й", "y"),
    ("ц", "ts"),
    ("х", "kh"),
    ("ъ", ""),
    ("ь", ""),
    ("а", "a"),
    ("б", "b"),
    ("в", "v"),
    ("г", "g"),
    ("д", "d"),
    ("е", "e"),
    ("з", "z"),
    ("и", "i"),
    ("к", "k"),
    ("л", "l"),
    ("м", "m"),
    ("н", "n"),
    ("о", "o"),
    ("п", "p"),
    ("р", "r"),
    ("с", "s"),
    ("т", "t"),
    ("у", "u"),
    ("ф", "f"),
    ("ы", "y"),
    ("э", "e"),
)

_LAT_TO_CYR: tuple[tuple[str, str], ...] = (
    ("sche", "ще"),
    ("schyo", "щё"),
    ("sch", "щ"),
    ("yo", "ё"),
    ("yu", "ю"),
    ("ya", "я"),
    ("zh", "ж"),
    ("kh", "х"),
    ("ts", "ц"),
    ("ch", "ч"),
    ("sh", "ш"),
    ("a", "а"),
    ("b", "б"),
    ("v", "в"),
    ("g", "г"),
    ("d", "д"),
    ("e", "е"),
    ("z", "з"),
    ("i", "и"),
    ("y", "й"),
    ("k", "к"),
    ("l", "л"),
    ("m", "м"),
    ("n", "н"),
    ("o", "о"),
    ("p", "п"),
    ("r", "р"),
    ("s", "с"),
    ("t", "т"),
    ("u", "у"),
    ("f", "ф"),
)

# qwerty ↔ йцукен (пользователь забыл переключить раскладку)
_EN_KEYS = """qwertyuiop[]asdfghjkl;'zxcvbnm,.`QWERTYUIOP{}ASDFGHJKL:"ZXCVBNM<>~"""
_RU_KEYS = """йцукенгшщзхъфывапролджэячсмитьбюёЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮЁ"""
_EN_TO_RU = str.maketrans(_EN_KEYS, _RU_KEYS)
_RU_TO_EN = str.maketrans(_RU_KEYS, _EN_KEYS)


def _replace_pairs(text: str, pairs: tuple[tuple[str, str], ...]) -> str:
    out = text
    for src, dst in pairs:
        out = out.replace(src, dst)
    return out


def cyr_to_lat(text: str) -> str:
    return _replace_pairs(text.lower(), _CYR_TO_LAT)


def lat_to_cyr(text: str) -> str:
    return _replace_pairs(text.lower(), _LAT_TO_CYR)


def layout_en_to_ru(text: str) -> str:
    return text.translate(_EN_TO_RU)


def layout_ru_to_en(text: str) -> str:
    return text.translate(_RU_TO_EN)


def _has_cyr(text: str) -> bool:
    return any("а" <= ch <= "я" or ch == "ё" for ch in text.lower())


def _has_lat(text: str) -> bool:
    return any("a" <= ch <= "z" for ch in text.lower())


def search_variants(query: str) -> list[str]:
    """Варианты запроса для ILIKE: оригинал, транслит, чужая раскладка."""
    q = (query or "").strip()
    if not q:
        return []
    seen: set[str] = set()
    out: list[str] = []

    def add(v: str) -> None:
        v = v.strip()
        if not v:
            return
        key = v.casefold()
        if key in seen:
            return
        seen.add(key)
        out.append(v)

    add(q)
    low = q.lower()
    only_cyr = _has_cyr(low) and not _has_lat(low)
    only_lat = _has_lat(low) and not _has_cyr(low)

    if only_cyr:
        add(cyr_to_lat(low))
        # песто → gtcnj (набрали кириллицу в EN-раскладке — ищем и так)
        laid = layout_ru_to_en(q)
        add(laid)
    elif only_lat:
        phonetic = lat_to_cyr(low)
        add(phonetic)
        # Раскладку пробуем, если фонетика не «съела» все латинские буквы
        # (pesto→песто ок; gtcnj→гтcнj — остался мусор → нужен layout).
        if _has_lat(phonetic):
            laid = layout_en_to_ru(q)
            add(laid)
            if _has_cyr(laid) and not _has_lat(laid):
                add(cyr_to_lat(laid.lower()))

    return out


def expand_search_terms(query: str) -> tuple[list[str], list[str]]:
    """(primary, all_terms): primary — для ранжирования; all — WHERE (primary + синонимы)."""
    from food_synonyms import synonym_stems

    primary = search_variants(query)
    if not primary:
        return [], []

    seen = {v.casefold() for v in primary}
    all_terms = list(primary)

    # Синонимы — по исходному запросу и по кириллическим вариантам (после транслита).
    stem_sources = [query] + [v for v in primary if _has_cyr(v)]
    for src in stem_sources:
        for stem in synonym_stems(src):
            key = stem.casefold()
            if key in seen:
                continue
            seen.add(key)
            all_terms.append(stem)

    return primary, all_terms


def tokenize_query(query: str) -> list[str]:
    """Слова запроса (пробелы). «батончик чиа» → ['батончик', 'чиа']."""
    import re

    q = (query or "").strip()
    if not q:
        return []
    return [t for t in re.split(r"\s+", q) if t]


def expand_search_token_groups(query: str) -> tuple[list[str], list[list[str]]]:
    """
    Multi-word: AND по токенам, OR внутри вариантам токена.
    Returns (rank_primary, token_term_groups).
    rank_primary — варианты целой фразы + первого слова (для ORDER BY).
    """
    tokens = tokenize_query(query)
    if not tokens:
        return [], []

    groups: list[list[str]] = []
    for tok in tokens:
        _primary, terms = expand_search_terms(tok)
        if terms:
            groups.append(terms)
    if not groups:
        return [], []

    # Ранжирование: целая фраза (если >1 слова) + первый токен.
    rank_primary, _ = expand_search_terms(query)
    first_primary, _ = expand_search_terms(tokens[0])
    seen = {v.casefold() for v in rank_primary}
    for v in first_primary:
        key = v.casefold()
        if key not in seen:
            seen.add(key)
            rank_primary.append(v)
    return rank_primary, groups
