"""resolve_cook_factor: матрица замеров по имени + cook_mode."""

from __future__ import annotations

import unittest

from cook_factor_rules import _FB_GRAIN, _FB_STEAM
from nutrition_common import (
    COOK_MODE_FACTORS,
    account_grams_from_weighed,
    cooked_grams_from_raw,
    resolve_cook_factor,
)


class CookFactorRulesTests(unittest.TestCase):
    def test_a1_chicken_breast_steam(self):
        name = "Грудка куриная"
        self.assertAlmostEqual(resolve_cook_factor(name, "steam_meat"), 812.0 / 538.0, places=6)
        self.assertAlmostEqual(cooked_grams_from_raw(812, "steam_meat", product_name=name), 538.0, places=1)

    def test_a2_chicken_breast_fry(self):
        name = "Филе куриное"
        self.assertAlmostEqual(resolve_cook_factor(name, "fry_meat"), 420.0 / 350.0, places=6)
        self.assertAlmostEqual(cooked_grams_from_raw(420, "fry_meat", product_name=name), 350.0, places=1)

    def test_a4_thigh_uses_name_rule(self):
        self.assertEqual(resolve_cook_factor("Бедро куриное", "steam_meat"), _FB_STEAM)

    def test_a5_turkey_fry(self):
        name = "Филе грудки индейки"
        self.assertAlmostEqual(resolve_cook_factor(name, "fry_meat"), 554.0 / 463.0, places=6)
        self.assertAlmostEqual(cooked_grams_from_raw(554, "fry_meat", product_name=name), 463.0, places=1)

    def test_c1_cod_steam(self):
        name = "Треска филе порц. ВВ"
        self.assertAlmostEqual(resolve_cook_factor(name, "steam_meat"), 190.0 / 120.0, places=6)
        self.assertAlmostEqual(cooked_grams_from_raw(190, "steam_meat", product_name=name), 120.0, places=1)

    def test_c3_pollock_steam(self):
        name = "Минтай Borealis филе 750г Магнит"
        self.assertAlmostEqual(resolve_cook_factor(name, "steam_meat"), 150.0 / 108.0, places=6)
        self.assertAlmostEqual(account_grams_from_weighed(108, "steam_meat", product_name=name), 150.0, places=1)

    def test_d_grechka_boil(self):
        name = "Гречка Увелка Экстра"
        self.assertAlmostEqual(resolve_cook_factor(name, "boil_grain"), 55.0 / 175.0, places=6)
        self.assertAlmostEqual(cooked_grams_from_raw(55, "boil_grain", product_name=name), 175.0, places=1)

    def test_d_rice_by_name(self):
        self.assertEqual(resolve_cook_factor("Рис басмати", "boil_grain"), _FB_GRAIN)

    def test_d_oats_by_name(self):
        self.assertEqual(resolve_cook_factor("овсянка", "boil_grain"), _FB_GRAIN)

    def test_d_pasta_by_name(self):
        self.assertAlmostEqual(resolve_cook_factor("макароны", "boil_pasta"), 101.0 / 274.0, places=6)

    def test_c2_salmon_by_name(self):
        self.assertEqual(resolve_cook_factor("лосось стейк", "steam_meat"), _FB_STEAM)

    def test_b1_pork_by_name(self):
        self.assertEqual(resolve_cook_factor("свинина лопатка", "steam_meat"), _FB_STEAM)

    def test_b7_farsh_fry(self):
        name = "Фарш говяжий"
        self.assertAlmostEqual(resolve_cook_factor(name, "fry_meat"), 500.0 / 385.0, places=6)
        self.assertAlmostEqual(cooked_grams_from_raw(500, "fry_meat", product_name=name), 385.0, places=1)
        self.assertEqual(resolve_cook_factor(name, "steam_meat"), _FB_STEAM)

    def test_l_legume_by_name(self):
        self.assertEqual(resolve_cook_factor("нут сухой", "boil_legume"), COOK_MODE_FACTORS["boil_legume"])

    def test_v_broccoli_by_name(self):
        self.assertAlmostEqual(resolve_cook_factor("брокколи", "steam_veg"), 1.1, places=3)

    def test_unknown_falls_back_to_mode(self):
        self.assertEqual(resolve_cook_factor("творог 5%", "steam_meat"), COOK_MODE_FACTORS["steam_meat"])


if __name__ == "__main__":
    unittest.main()
