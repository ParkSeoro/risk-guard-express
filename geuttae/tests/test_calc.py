import random
import unittest
from datetime import date

from gl import evolve
from gl.calc import lump, price_on, won, years_ago


class Won(unittest.TestCase):
    def test_korean_money_format(self):
        self.assertEqual(won(1_000_000), "100만원")
        self.assertEqual(won(123_450_000), "1억 2,345만원")
        self.assertEqual(won(300_000_000), "3억원")
        self.assertEqual(won(5_300), "5,300원")
        self.assertEqual(won(12_345_670_000), "123억 4,567만원")


class Calc(unittest.TestCase):
    P = {"2020-01-01": 100.0, "2020-01-02": 200.0, "2020-01-05": 50.0}

    def test_exact_day(self):
        r = lump(self.P, "2020-01-01", 1_000_000, 300.0)
        self.assertAlmostEqual(r["value"], 3_000_000)
        self.assertAlmostEqual(r["mult"], 3.0)

    def test_gap_uses_previous_close(self):
        self.assertEqual(price_on(self.P, "2020-01-04"), 200.0)

    def test_before_listing_is_none(self):
        self.assertIsNone(lump(self.P, date(2019, 12, 31), 1_000_000, 300.0))

    def test_leap_day(self):
        self.assertEqual(years_ago(date(2024, 2, 29), 1), date(2023, 2, 28))


class Evolution(unittest.TestCase):
    def test_variants_format(self):
        for t in evolve.TITLE_VARIANTS.values():
            t.format(coin="비트코인", when="5년 전 오늘", amount="100만원", value="1억원", mult="10.0")

    def test_pick_prefers_winner(self):
        st = evolve.ensure({})
        st["arms"]["b"] = {"views": 500, "shows": 600}
        for k in "acd":
            st["arms"][k] = {"views": 5, "shows": 600}
        rng = random.Random(1)
        self.assertGreater([evolve.pick(st, rng) for _ in range(200)].count("b"), 190)


if __name__ == "__main__":
    unittest.main()
