import random
import unittest
from datetime import date

from tbm import evolve
from tbm.hazards import DaySummary, assess, summarize


def S(**kw):
    base = dict(feels_max=20, temp_min=10, temp_max=20, gust_max=3, rain_max_h=0, rain_total=0,
                snow_max_h=0, peak_feels_hour=14, peak_gust_hour=14)
    base.update(kw)
    return DaySummary(**base)


def codes(s):
    return {h.code: h for h in assess(s)}


class HazardRules(unittest.TestCase):
    def test_calm_day_has_no_hazard(self):
        self.assertEqual(assess(S()), [])

    def test_heat_levels_follow_guide(self):
        self.assertEqual(codes(S(feels_max=31))["heat"].level, 1)
        self.assertEqual(codes(S(feels_max=33))["heat"].level, 2)
        self.assertEqual(codes(S(feels_max=35))["heat"].level, 3)
        self.assertEqual(codes(S(feels_max=38))["heat"].level, 4)
        self.assertTrue(any("20분" in a for a in codes(S(feels_max=33))["heat"].actions))

    def test_wind_crane_thresholds(self):
        self.assertFalse(any("해체" in a for a in codes(S(gust_max=10))["wind"].actions))
        self.assertTrue(any("해체" in a for a in codes(S(gust_max=10.1))["wind"].actions))
        self.assertFalse(any("운전 작업 중지" in a for a in codes(S(gust_max=20))["wind"].actions))
        self.assertTrue(any("운전 작업 중지" in a for a in codes(S(gust_max=20.1))["wind"].actions))

    def test_steel_work_stop_on_rain(self):
        self.assertTrue(any("철골" in a for a in codes(S(rain_max_h=1, rain_total=3))["rain"].actions))

    def test_sorted_by_severity(self):
        hz = assess(S(feels_max=31, gust_max=21))
        self.assertEqual([h.code for h in hz], ["wind", "heat"])

    def test_summarize_uses_work_hours_only(self):
        hourly = {
            "time": [f"2026-07-01T{h:02d}:00" for h in range(24)],
            "temperature_2m": [25] * 24,
            "apparent_temperature": [40 if h == 3 else 30 for h in range(24)],
            "wind_gusts_10m": [1] * 24, "precipitation": [0] * 24, "snowfall": [None] * 24,
        }
        self.assertEqual(summarize(hourly).feels_max, 30)


class Evolution(unittest.TestCase):
    def test_pick_prefers_winner(self):
        st = evolve.ensure({})
        st["arms"]["b"] = {"views": 500, "shows": 600}
        for k in "acd":
            st["arms"][k] = {"views": 5, "shows": 600}
        rng = random.Random(1)
        picks = [evolve.pick(st, rng) for _ in range(200)]
        self.assertGreater(picks.count("b"), 190)

    def test_update_without_token_is_noop(self):
        st = evolve.ensure({})
        st2, msg = evolve.update(st, date(2026, 1, 1))
        self.assertIn("미연결", msg)


if __name__ == "__main__":
    unittest.main()
