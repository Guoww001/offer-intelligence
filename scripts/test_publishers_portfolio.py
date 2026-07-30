from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
import sys
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import offer_db
from scripts import build_publishers_data


ROWS = [
    {
        "user_id": 7,
        "merchant_id": 101,
        "merchant_name": "Alpha",
        "category": "Electronics",
        "network": "Levanta",
        "tier": "Tier 1",
        "commission_rate": 15,
        "market": "amazon.com",
        "clicks": 20,
        "dpv": 10,
        "atc": 3,
        "orders": 2,
        "sales": 80,
        "all_commission": 12,
        "aff_commission": 9,
    },
    {
        "user_id": 7,
        "merchant_id": 101,
        "merchant_name": "Alpha",
        "category": "Electronics",
        "network": "Levanta",
        "tier": "Tier 1",
        "commission_rate": 15,
        "market": "amazon.co.uk",
        "clicks": 5,
        "dpv": 2,
        "atc": 0,
        "orders": 1,
        "sales": 50,
        "all_commission": 7.5,
        "aff_commission": 5,
    },
    {
        "user_id": 7,
        "merchant_id": 202,
        "merchant_name": "Beta",
        "category": "Home & Kitchen",
        "network": "Wayward",
        "tier": "Tier 3",
        "commission_rate": 20,
        "market": "amazon.com",
        "clicks": 4,
        "dpv": 0,
        "atc": 0,
        "orders": 0,
        "sales": 0,
        "all_commission": 0,
        "aff_commission": 0,
    },
]


def assert_equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def assert_close(actual, expected, label):
    if actual is None or abs(float(actual) - float(expected)) > 0.0001:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


@contextmanager
def fake_connection():
    yield object()


def main():
    by_user, name_map = offer_db.publisher_portfolios_from_rows(ROWS)
    merchants = by_user[7]
    alpha = merchants[0]
    beta = merchants[1]

    assert_equal(name_map, {101: "Alpha", 202: "Beta"}, "merchant name map")
    assert_equal(alpha["merchantId"], 101, "portfolio sorting")
    assert_equal(alpha["tier"], "Tier 1", "merchant tier")
    assert_equal(beta["tier"], "Tier 3", "second merchant tier")
    assert_equal(set(alpha["markets"]), {"amazon.com", "amazon.co.uk"}, "market breakdown")
    assert_equal(alpha["total"]["orders"], 3, "merchant orders")
    assert_close(alpha["total"]["sales"], 130, "merchant sales")
    assert_close(alpha["total"]["aov"], 130 / 3, "merchant AOV")
    assert_equal(beta["total"]["aov"], None, "zero-order AOV")

    summary = offer_db.publisher_portfolio_summary(merchants)
    assert_equal(summary["merchantCount"], 2, "summary merchant count")
    assert_equal(summary["topCategory"], "Electronics", "top category")
    assert_close(summary["total"]["aov"], 130 / 3, "summary AOV")
    assert_close(summary["weightedCommissionRate"], 15, "weighted commission rate")

    if "cnpscy_oi_offer_sheet_metadata" in build_publishers_data.MERCHANT_SQL:
        raise AssertionError("publisher cache must keep a lightweight merchant index")
    if "cnpscy_oi_offer_sheet_metadata" not in offer_db.PUBLISHER_PORTFOLIO_SQL:
        raise AssertionError("publisher portfolio query must include sheet category metadata")
    if "commission_rate" not in offer_db.PUBLISHER_PORTFOLIO_SQL:
        raise AssertionError("publisher portfolio query must include merchant commission rate")
    if "cnpscy_oi_tier_assignments" not in offer_db.PUBLISHER_PORTFOLIO_SQL:
        raise AssertionError("publisher portfolio query must include the database-backed merchant tier")

    invalid_inputs = [
        ({"user_id": "invalid"}, "invalid publisher id"),
        ({"user_id": 7, "start_date": "07/01/2026"}, "invalid start date"),
        (
            {"user_id": 7, "start_date": "2026-07-28", "end_date": "2026-07-01"},
            "reversed date range",
        ),
    ]
    for kwargs, label in invalid_inputs:
        try:
            offer_db.publisher_portfolio_payload(**kwargs)
        except ValueError:
            pass
        else:
            raise AssertionError(f"{label}: expected ValueError")

    def fake_fetch_all(_conn, sql, params=None):
        if "FROM cnpscy_amazon_order" in sql:
            assert_equal(params, (7, 20260701, 20260728), "portfolio query params")
            return ROWS
        if "FROM cnpscy_user" in sql:
            return [{"user_id": 7, "user_name": "Media Seven", "admin_name": "Fiona"}]
        raise AssertionError(f"unexpected query: {sql[:80]}")

    offer_db._publisher_portfolio_cache = {}
    with (
        patch.object(offer_db, "db_connection", fake_connection),
        patch.object(offer_db, "fetch_all", fake_fetch_all),
    ):
        payload = offer_db.publisher_portfolio_payload(
            7,
            start_date="2026-07-01",
            end_date="2026-07-28",
        )

    assert_equal(payload["publisher"]["userName"], "Media Seven", "publisher identity")
    assert_equal(payload["dateRange"]["startDate"], "2026-07-01", "portfolio start date")
    assert_equal(payload["summary"]["merchantCount"], 2, "payload merchant count")
    assert_equal(payload["merchants"][1]["total"]["aov"], None, "payload zero-order AOV")

    print("Publisher portfolio aggregation checks passed")


if __name__ == "__main__":
    main()
