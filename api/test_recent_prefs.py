"""Недавние из prefs, сортировка избранного/моих, delete не сбрасывает граммы."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from item_meta import list_favorites
from nutrition_read import list_products, list_recent_logged_products
from nutrition_write import delete_log_entry


class DeleteLogEntryTests(unittest.TestCase):
    def test_delete_only_nutrition_log(self):
        conn = MagicMock()
        conn.execute.return_value.fetchone.return_value = {"id": 42}
        result = delete_log_entry(conn, 42)
        self.assertTrue(result["ok"])
        self.assertEqual(result["entryId"], 42)
        sql = conn.execute.call_args[0][0]
        self.assertIn("DELETE FROM nutrition_log", sql)
        self.assertNotIn("food_preferences", sql.lower())
        self.assertEqual(conn.execute.call_count, 1)


class ListRecentSqlTests(unittest.TestCase):
    def test_recent_from_prefs_not_only_log(self):
        conn = MagicMock()
        conn.execute.return_value.fetchall.return_value = []
        list_recent_logged_products(conn, 10)
        sql = conn.execute.call_args[0][0]
        params = conn.execute.call_args[0][1]
        self.assertEqual(sql.count("%s"), len(params))
        self.assertIn("food_preferences", sql)
        self.assertIn("pref_custom", sql)
        self.assertIn("pref_food", sql)
        self.assertIn("log_custom", sql)
        self.assertIn("ORDER BY last_used DESC", sql)


class ListMineSqlTests(unittest.TestCase):
    def test_mine_orders_by_usage_then_card(self):
        conn = MagicMock()
        conn.execute.return_value.fetchall.return_value = []
        list_products(conn, scope="mine")
        sql = conn.execute.call_args[0][0]
        self.assertIn("last_serving_grams", sql)
        self.assertIn("updated_at", sql)

    def test_mine_search_orders_by_usage(self):
        conn = MagicMock()
        conn.execute.return_value.fetchall.return_value = []
        list_products(conn, query="курица", scope="mine")
        sql = conn.execute.call_args[0][0]
        self.assertIn("last_serving_grams", sql)
        self.assertIn("updated_at", sql)


class ListFavoritesSqlTests(unittest.TestCase):
    def test_favorites_orders_by_usage_then_star(self):
        conn = MagicMock()
        conn.execute.return_value.fetchall.return_value = []
        list_favorites(conn, 10)
        sql = conn.execute.call_args[0][0]
        self.assertIn("food_preferences", sql)
        self.assertIn("m.updated_at DESC", sql)
        self.assertIn("fp.updated_at", sql)


if __name__ == "__main__":
    unittest.main()
