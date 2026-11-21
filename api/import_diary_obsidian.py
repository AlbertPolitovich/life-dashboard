#!/usr/bin/env python3
"""
Импорт дневника из Obsidian (.md YYYY-MM-DD) → diary_entries.

Сканирует текущий год и архивы 03_home (в т.ч. вложенные !YYYY/YYYY-MM/).

Пример:
  cd api && python import_diary_obsidian.py --dry-run
  cd api && python import_diary_obsidian.py
  cd api && python import_diary_obsidian.py --skip-existing
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import date
from pathlib import Path

import psycopg
from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))

from diary_common import normalize_diary_body

OBSIDIAN_HOME = (
    Path.home()
    / "Library/Mobile Documents/iCloud~md~obsidian/Documents/Home"
)

DEFAULT_ROOTS = (
    OBSIDIAN_HOME / "03_home",
    OBSIDIAN_HOME / "00_archive/2024/03_home 2024 archive",
    OBSIDIAN_HOME / "00_archive/2025/03_home archive",
)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://life:life@localhost:5432/life_dashboard",
).strip()

DATE_FILE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.md$", re.IGNORECASE)


def strip_frontmatter(text: str) -> str:
    if not text.startswith("---"):
        return text
    parts = text.split("---", 2)
    if len(parts) >= 3:
        return parts[2].lstrip("\n")
    return text


def read_diary_body(path: Path) -> str:
    raw = path.read_text(encoding="utf-8")
    return normalize_diary_body(strip_frontmatter(raw))


def collect_diary_files(roots: list[Path]) -> dict[str, Path]:
    by_date: dict[str, Path] = {}
    missing_roots: list[str] = []

    for root in roots:
        if not root.exists():
            missing_roots.append(str(root))
            continue
        for path in root.glob("**/????-??-??.md"):
            if not path.is_file():
                continue
            match = DATE_FILE_RE.match(path.name)
            if not match:
                continue
            iso = match.group(1)
            try:
                date.fromisoformat(iso)
            except ValueError:
                continue
            prev = by_date.get(iso)
            if prev is None or path.stat().st_mtime >= prev.stat().st_mtime:
                by_date[iso] = path

    if missing_roots:
        print("Пропущены несуществующие корни:", *missing_roots, sep="\n  ")

    return by_date


def existing_nonempty_dates(conn: psycopg.Connection) -> set[str]:
    rows = conn.execute(
        """
        SELECT entry_date::text
        FROM diary_entries
        WHERE btrim(body) <> ''
        """
    ).fetchall()
    return {str(r[0]) for r in rows}


def import_entries(
    conn: psycopg.Connection,
    files_by_date: dict[str, Path],
    *,
    skip_existing: bool,
    dry_run: bool,
) -> dict[str, int]:
    stats = {"scanned": len(files_by_date), "imported": 0, "skipped_empty": 0, "skipped_existing": 0}

    skip_dates: set[str] = set()
    if skip_existing:
        skip_dates = existing_nonempty_dates(conn)

    for iso in sorted(files_by_date):
        path = files_by_date[iso]
        body = read_diary_body(path)
        if not body.strip():
            stats["skipped_empty"] += 1
            continue
        if iso in skip_dates:
            stats["skipped_existing"] += 1
            continue
        if dry_run:
            stats["imported"] += 1
            continue
        conn.execute(
            """
            INSERT INTO diary_entries (entry_date, body, updated_at)
            VALUES (%s::date, %s, now())
            ON CONFLICT (entry_date)
            DO UPDATE SET body = EXCLUDED.body, updated_at = now()
            """,
            (iso, body),
        )
        stats["imported"] += 1

    if not dry_run:
        conn.commit()

    return stats


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Импорт дневника Obsidian → Postgres")
    parser.add_argument(
        "--root",
        action="append",
        dest="roots",
        help="Корень vault (можно несколько). По умолчанию — 03_home + архивы 2024/2025",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Не перезаписывать дни, где в БД уже есть непустой текст",
    )
    parser.add_argument("--dry-run", action="store_true", help="Только подсчёт, без записи")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    roots = [Path(p).expanduser() for p in args.roots] if args.roots else list(DEFAULT_ROOTS)

    files_by_date = collect_diary_files(roots)
    if not files_by_date:
        print("Не найдено файлов YYYY-MM-DD.md")
        return 1

    years = sorted({iso[:4] for iso in files_by_date})
    print(f"Найдено дней: {len(files_by_date)} ({years[0]}…{years[-1]})")

    with psycopg.connect(DATABASE_URL) as conn:
        stats = import_entries(
            conn,
            files_by_date,
            skip_existing=args.skip_existing,
            dry_run=args.dry_run,
        )

    mode = "dry-run" if args.dry_run else "import"
    print(
        f"{mode}: scanned={stats['scanned']} imported={stats['imported']} "
        f"skipped_empty={stats['skipped_empty']} skipped_existing={stats['skipped_existing']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
