"""infer_cook_kind_from_name: свои продукты / каталог → cook_kind по словам в названии."""

from __future__ import annotations

import unittest

from nutrition_common import (
    COOK_MODE_FACTORS,
    infer_cook_kind_from_name,
    is_fry_cook_mode,
    resolve_cook_kind,
    should_skip_cook_kind,
)


class CookKindFromNameTests(unittest.TestCase):
    def test_meat_fish(self):
        self.assertEqual(infer_cook_kind_from_name("Филе курицы"), "meat_fish")
        self.assertEqual(infer_cook_kind_from_name("Филе куриное"), "meat_fish")
        self.assertEqual(infer_cook_kind_from_name("говядина лопатка"), "meat_fish")

    def test_grain(self):
        self.assertEqual(infer_cook_kind_from_name("гречка"), "grain")
        self.assertEqual(infer_cook_kind_from_name("Рис басмати"), "grain")

    def test_pasta_and_legume(self):
        self.assertEqual(infer_cook_kind_from_name("макароны"), "pasta")
        self.assertEqual(infer_cook_kind_from_name("нут сухой"), "legume")

    def test_veg(self):
        self.assertEqual(infer_cook_kind_from_name("брокколи"), "veg")
        self.assertEqual(infer_cook_kind_from_name("Брокколи замороженная"), "veg")
        self.assertEqual(infer_cook_kind_from_name("замороженные овощи"), "veg")
        self.assertEqual(infer_cook_kind_from_name("овощная смесь"), "veg")
        self.assertEqual(infer_cook_kind_from_name("стручковая фасоль"), "veg")

    def test_mixed_keeps_stronger_kind(self):
        self.assertEqual(infer_cook_kind_from_name("рис с овощами"), "grain")
        self.assertEqual(infer_cook_kind_from_name("овощная смесь с курицей"), "meat_fish")

    def test_tomato_pasta_not_pasta(self):
        self.assertIsNone(infer_cook_kind_from_name("томатная паста"))

    def test_frozen_ready_meals_not_veg(self):
        self.assertIsNone(infer_cook_kind_from_name("пицца замороженная"))
        self.assertIsNone(infer_cook_kind_from_name("пельмени"))

    def test_veg_factors_softer_than_meat(self):
        self.assertAlmostEqual(COOK_MODE_FACTORS["steam_veg"], 1.1, places=3)
        self.assertAlmostEqual(COOK_MODE_FACTORS["boil_veg"], 1.05, places=3)
        self.assertAlmostEqual(COOK_MODE_FACTORS["fry_veg"], 1.2, places=3)
        self.assertLess(COOK_MODE_FACTORS["fry_veg"], COOK_MODE_FACTORS["fry_meat"])
        self.assertTrue(is_fry_cook_mode("fry_veg"))
        self.assertFalse(is_fry_cook_mode("steam_veg"))

    def test_cook_factors_fallback(self):
        self.assertAlmostEqual(COOK_MODE_FACTORS["boil_grain"], 1.0 / 2.7, places=6)
        self.assertAlmostEqual(COOK_MODE_FACTORS["steam_meat"], 1.25, places=6)
        self.assertAlmostEqual(COOK_MODE_FACTORS["boil_meat"], 1.25, places=6)
        self.assertAlmostEqual(COOK_MODE_FACTORS["fry_meat"], 1.275, places=6)

    def test_eggs_skip_meat_infer(self):
        self.assertIsNone(infer_cook_kind_from_name("Белок яйца куриного"))
        self.assertIsNone(infer_cook_kind_from_name("Желток яйца куриного"))
        self.assertIsNone(infer_cook_kind_from_name("яичница глазунья"))
        self.assertIsNone(infer_cook_kind_from_name("омлет с сыром"))
        self.assertIsNone(infer_cook_kind_from_name("яйцо варёное"))

    def test_chocolate_egg_not_skipped(self):
        # Не early-return; «шоколад» без мяса/круп → всё равно None
        self.assertIsNone(infer_cook_kind_from_name("шоколадное яйцо"))

    def test_bread_and_avocado_no_cook_kind(self):
        self.assertIsNone(infer_cook_kind_from_name("Тартины пшенично-ржаной хлеб"))
        self.assertIsNone(infer_cook_kind_from_name("Хлеб пшеничный"))
        self.assertIsNone(infer_cook_kind_from_name("авокадо хасс"))
        # пшено всё ещё крупа; пшеничный без «хлеб» больше не grain
        self.assertEqual(infer_cook_kind_from_name("пшено"), "grain")
        self.assertIsNone(infer_cook_kind_from_name("мука пшеничная"))

    def test_should_skip_overrides_category_veg(self):
        self.assertTrue(should_skip_cook_kind("Авокадо", "vegetables"))
        self.assertTrue(should_skip_cook_kind("Хлеб бородинский", "bread_bakery"))
        self.assertFalse(should_skip_cook_kind("Брокколи", "vegetables"))
        self.assertFalse(should_skip_cook_kind("гречка", None))

    def test_unknown(self):
        self.assertIsNone(infer_cook_kind_from_name("творог 5%"))
        self.assertIsNone(infer_cook_kind_from_name(""))

    def test_resolve_prefers_explicit(self):
        self.assertEqual(resolve_cook_kind("grain", "филе курицы"), "grain")
        self.assertEqual(resolve_cook_kind(None, "филе курицы"), "meat_fish")


if __name__ == "__main__":
    unittest.main()
