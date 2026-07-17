from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import offer_db


class OfferNetworkFallbackTests(unittest.TestCase):
    def test_empty_or_invalid_ids_skip_direct_lookup(self) -> None:
        with patch.object(offer_db, "fetch_all", return_value=[]) as fetch_all:
            result = offer_db.offer_network_fallback_map(
                object(), [None, ""], None
            )

        self.assertEqual(result, {})
        fetch_all.assert_not_called()

    def test_previous_cache_wins_and_direct_lookup_fills_new_merchants(self) -> None:
        previous = {
            "offers": [
                {"merchantId": "1", "network": "Archer"},
                {"merchantId": "2", "network": "Unknown"},
            ]
        }

        def fake_fetch_all(_conn, sql, params=()):
            self.assertEqual(params, ("2",))
            return [{"merchantId": "2", "network": "Levanta"}]

        with patch.object(offer_db, "fetch_all", side_effect=fake_fetch_all):
            result = offer_db.offer_network_fallback_map(
                object(), ["1", "2"], previous
            )

        self.assertEqual(result, {"1": "Archer", "2": "Levanta"})

    def test_direct_lookup_avoids_performance_view_and_server_distinct(self) -> None:
        calls: list[str] = []

        def fake_fetch_all(_conn, sql, params=()):
            self.assertEqual(params, ())
            calls.append(sql)
            if "cnpscy_advert_type" in sql:
                return [
                    {"merchantId": "2", "network": "sl"},
                    {"merchantId": "1", "network": "brandreward"},
                ]
            return [
                {"merchantId": "1", "network": "Levanta"},
                {"merchantId": "1", "network": "Archer"},
            ]

        with patch.object(offer_db, "fetch_all", side_effect=fake_fetch_all):
            result = offer_db.direct_network_map(object())

        self.assertEqual(len(calls), 2)
        self.assertTrue(all("cnpscy_advertiser_performance_daily_view" not in sql for sql in calls))
        self.assertTrue(all("DISTINCT" not in sql for sql in calls))
        self.assertEqual(result, {"1": "Archer", "2": "sl"})


if __name__ == "__main__":
    unittest.main()
