from dataclasses import dataclass


@dataclass(frozen=True)
class Sphere:
    name: str
    col_1based: int  # B=2 … I=9


# Порядок как в шапке таблицы B1:I1
SPHERES: tuple[Sphere, ...] = (
    Sphere("семья", 2),
    Sphere("спорт/здоровье", 3),
    Sphere("экономика", 4),
    Sphere("бизнес", 5),
    Sphere("познание", 6),
    Sphere("чтение", 7),
    Sphere("духовность", 8),
    Sphere("веселье", 9),
)
