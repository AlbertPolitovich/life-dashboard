"""Тесты suggested_serving_grams — порция из названия."""

from __future__ import annotations

import unittest

from nutrition_common import (
    parse_weight_g_from_name,
    suggested_serving_grams,
)


class TestSuggestedServing(unittest.TestCase):
    def test_restaurant_portion(self):
        self.assertEqual(
            suggested_serving_grams(
                "Двойной Фиш Бургер, 196г, Вкусно и точка",
                source="vkusnoitochka",
                category_slug="ready_meals",
            ),
            196.0,
        )
        self.assertEqual(
            suggested_serving_grams(
                "Жареная картошка с вешенками, 220г, Швили",
                source="shvili",
                category_slug="ready_meals",
            ),
            220.0,
        )

    def test_snacks(self):
        self.assertEqual(
            suggested_serving_grams(
                "Чипсы кукурузно-рисовые Happy Crisp, 50г Перекресток",
                source="perekrestok",
                category_slug="snacks",
            ),
            50.0,
        )

    def test_sweets_multipack_uses_piece(self):
        self.assertEqual(parse_weight_g_from_name("Шоколадный батончик Snickers 4х40г"), 40.0)
        self.assertEqual(
            suggested_serving_grams(
                "Шоколадный батончик Snickers 4х40г ВкусВилл",
                source="vkusvill",
                category_slug="sweets",
            ),
            40.0,
        )

    def test_dairy_yogurt(self):
        self.assertEqual(
            suggested_serving_grams(
                "Йогурт Teos Греческий 2% 140 г ВкусВилл",
                source="vkusvill",
                category_slug="dairy",
            ),
            140.0,
        )

    def test_dairy_bulk_milk_excluded(self):
        self.assertIsNone(
            suggested_serving_grams(
                "Молоко Parmalat 1 л Перекресток",
                source="perekrestok",
                category_slug="dairy",
            )
        )

    def test_ready_meals_retail_only(self):
        self.assertEqual(
            suggested_serving_grams(
                "Салат Цезарь, 180г Перекресток",
                source="perekrestok",
                category_slug="ready_meals",
            ),
            180.0,
        )
        self.assertEqual(
            suggested_serving_grams(
                "Салат Оливье 200г Лента",
                source="lenta",
                category_slug="ready_meals",
            ),
            200.0,
        )
        self.assertEqual(
            suggested_serving_grams(
                "Борщ 300г Лавка",
                source="lavka",
                category_slug="ready_meals",
            ),
            300.0,
        )
        self.assertIsNone(
            suggested_serving_grams(
                "Борщ украинский, 350 г ВкусВилл",
                source="vkusvill",
                category_slug="ready_meals",
            )
        )

    def test_drinks_ml(self):
        self.assertEqual(
            suggested_serving_grams(
                'Коктейль безалкогольный "Цитрусовый спритц", 330 мл ВкусВилл',
                source="vkusvill",
                category_slug="drinks",
            ),
            330.0,
        )

    def test_big_pack_excluded(self):
        self.assertIsNone(
            suggested_serving_grams(
                "Батон Черемушки нарезка, 400г Перекресток",
                source="perekrestok",
                category_slug="bread_bakery",
            )
        )
        self.assertIsNone(
            suggested_serving_grams(
                "Рис для плова 900 г ВкусВилл",
                source="vkusvill",
                category_slug="grains",
            )
        )

    def test_parens_grams_ignored(self):
        self.assertIsNone(
            parse_weight_g_from_name(
                'Салат "Грин Энерджи" ВкусВилл (РЕСТОРАН: Салат(135 г))'
            )
        )

    def test_baby_food(self):
        self.assertEqual(
            suggested_serving_grams(
                "Творог детский Агуша 100 г ВкусВилл",
                source="vkusvill",
                category_slug="baby_food",
            ),
            100.0,
        )


if __name__ == "__main__":
    unittest.main()
