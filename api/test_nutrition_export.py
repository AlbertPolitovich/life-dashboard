"""Тесты экспорта дневника CSV."""

from __future__ import annotations

import csv
import io
import sys
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "bot"))

from kbju import SportDayKind  # noqa: E402

from nutrition_read import (
    NUTRITION_CSV_HEADER,
    _export_activity_label,
    _period_bounds,
    build_nutrition_export_csv,
    export_csv_filename,
    list_daily_nutrition_totals,
)


class ExportFilenameTests(unittest.TestCase):
    def test_period_labels(self):
        self.assertEqual(export_csv_filename("7d"), "kbju-7d.csv")
        self.assertEqual(export_csv_filename("30d"), "kbju-30d.csv")
        self.assertEqual(export_csv_filename("all"), "kbju-365d.csv")


class PeriodBoundsTests(unittest.TestCase):
    def test_7d(self):
        start, end = _period_bounds("7d", date(2026, 9, 1))
        self.assertEqual(start, date(2026, 8, 26))
        self.assertEqual(end, date(2026, 9, 1))

    def test_all_is_365_days(self):
        start, end = _period_bounds("all", date(2026, 9, 1))
        self.assertEqual((end - start).days + 1, 365)


class ExportActivityLabelTests(unittest.TestCase):
    @patch("nutrition_read._is_cheatmeal_day", return_value=True)
    @patch("nutrition_read._resolve_sport_day_kind")
    def test_cheatmeal_overrides_sport(self, mock_sport, _mock_cheat):
        mock_sport.return_value = SportDayKind.WORKOUT
        self.assertEqual(_export_activity_label(MagicMock(), "2026-09-01"), "читмил")

    @patch("nutrition_read._is_cheatmeal_day", return_value=False)
    @patch("nutrition_read._resolve_sport_day_kind")
    def test_sport_when_no_cheatmeal(self, mock_sport, _mock_cheat):
        mock_sport.return_value = SportDayKind.WORKOUT
        self.assertEqual(_export_activity_label(MagicMock(), "2026-09-02"), "воркаут")


class NutritionExportCsvTests(unittest.TestCase):
    @patch("nutrition_read.list_daily_nutrition_totals")
    def test_csv_includes_activity_between_day_and_kcal(self, mock_totals):
        mock_totals.return_value = [
            {
                "day": "01.09.2026",
                "activityLabel": "читмил",
                "kcal": 2650.0,
                "protein": 150.0,
                "carbs": 360.0,
                "fat": 65.0,
                "fiber": 30.0,
            }
        ]

        csv_text = build_nutrition_export_csv(MagicMock(), "7d")
        rows = list(csv.reader(io.StringIO(csv_text)))

        self.assertEqual(rows[0], list(NUTRITION_CSV_HEADER))
        self.assertEqual(rows[1][0], "01.09.2026")
        self.assertEqual(rows[1][1], "читмил")
        self.assertEqual(rows[1][2], "2650.0")

    @patch("nutrition_read._export_activity_label", return_value="отдых")
    def test_7d_includes_all_days_with_zeros(self, _mock_label):
        conn = MagicMock()
        conn.execute.return_value.fetchall.return_value = [
            {
                "log_date": date(2026, 9, 1),
                "kcal": 1800,
                "protein": 100,
                "carbs": 180,
                "fat": 60,
                "fiber": 20,
            }
        ]

        rows = list_daily_nutrition_totals(conn, "7d", today=date(2026, 9, 1))
        self.assertEqual(len(rows), 7)
        self.assertEqual(rows[0]["day"], "26.08.2026")
        self.assertEqual(rows[-1]["day"], "01.09.2026")
        self.assertEqual(rows[0]["kcal"], 0.0)
        self.assertEqual(rows[-1]["kcal"], 1800.0)
        self.assertEqual(rows[-1]["activityLabel"], "отдых")

    @patch("nutrition_read._export_activity_label", return_value="отдых")
    def test_date_format_dd_mm_yyyy(self, _mock_label):
        conn = MagicMock()
        conn.execute.return_value.fetchall.return_value = []

        rows = list_daily_nutrition_totals(conn, "7d", today=date(2026, 9, 1))
        self.assertTrue(all("." in r["day"] and "-" not in r["day"] for r in rows))
        self.assertEqual(rows[0]["day"], "26.08.2026")


if __name__ == "__main__":
    unittest.main()
