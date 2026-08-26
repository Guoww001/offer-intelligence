from __future__ import annotations

import datetime as dt
import os
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import google_ads_workbench as workbench


def assert_equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def assert_close(actual, expected, label):
    if actual is None or abs(float(actual) - float(expected)) > 0.0001:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def main():
    old_aliases = os.environ.pop("GOOGLE_ADS_MERCHANT_ALIASES", None)
    try:
        backend_rows = [
            {
                "date": "2026-08-01",
                "merchantId": 101,
                "merchantName": "Ulike",
                "clicks": 25,
                "orders": 4,
                "revenue": 100,
                "allCommission": 20,
                "affCommission": 15,
                "detailPageViews": 18,
                "addToCarts": 8,
                "asins": ["B0D1S48CSX"],
            },
            {
                "date": "2026-08-01",
                "merchantId": 102,
                "merchantName": "Beatbot Amazon",
                "clicks": 10,
                "orders": 1,
                "revenue": 40,
                "allCommission": 8,
                "affCommission": 6,
                "detailPageViews": 8,
                "addToCarts": 2,
                "asins": [],
            },
        ]
        campaign_rows = [
            {
                "date": "2026-08-01",
                "campaignId": "1",
                "campaignName": "Ulike brand",
                "status": "ENABLED",
                "channelType": "SEARCH",
                "impressions": 100,
                "clicks": 10,
                "cost": 12,
                "nativeConversions": 0,
                "nativeConversionValue": 0,
            },
            {
                "date": "2026-08-01",
                "campaignId": "2",
                "campaignName": "Ulike exact match",
                "status": "ENABLED",
                "channelType": "SEARCH",
                "impressions": 80,
                "clicks": 8,
                "cost": 8,
                "nativeConversions": 0,
                "nativeConversionValue": 0,
            },
            {
                "date": "2026-08-01",
                "campaignId": "3",
                "campaignName": "beatbot-0809",
                "status": "ENABLED",
                "channelType": "SEARCH",
                "impressions": 60,
                "clicks": 6,
                "cost": 10,
                "nativeConversions": 0,
                "nativeConversionValue": 0,
            },
            {
                "date": "2026-08-01",
                "campaignId": "4",
                "campaignName": "unresolved-brand",
                "status": "ENABLED",
                "channelType": "SEARCH",
                "impressions": 20,
                "clicks": 2,
                "cost": 5,
                "nativeConversions": 0,
                "nativeConversionValue": 0,
            },
        ]
        result = workbench.merge_workbench_sources(
            campaign_rows,
            backend_rows,
            dt.date(2026, 8, 1),
            dt.date(2026, 8, 2),
        )
        summary = result["summary"]
        assert_close(summary["spend"], 35, "total Google spend")
        assert_close(summary["revenue"], 140, "backend revenue must not duplicate")
        assert_close(summary["matchedSpend"], 30, "matched spend")
        assert_close(summary["unmatchedSpend"], 5, "unmatched spend")
        assert_equal(summary["campaignCount"], 4, "campaign count")
        assert_equal(summary["matchedCampaignCount"], 3, "matched campaign count")
        assert_equal(summary["matchedMerchantCount"], 2, "matched merchant count")
        assert_close(summary["merchantLevelRoas"], 140 / 30, "merchant-level ROAS")

        ulike = next(row for row in result["merchants"] if row["merchantId"] == 101)
        assert_equal(ulike["campaignCount"], 2, "two campaigns grouped under one merchant")
        assert_close(ulike["spend"], 20, "merchant spend")
        assert_close(ulike["revenue"], 100, "merchant backend revenue counted once")
        assert_equal(ulike["matchMethod"], "merchant_name", "merchant-name match method")

        beatbot = next(row for row in result["merchants"] if row["merchantId"] == 102)
        assert_equal(beatbot["campaignCount"], 1, "generic Amazon suffix ignored")
        assert_equal(result["unmatchedCampaigns"][0]["campaignId"], "4", "unmatched campaign")
        assert_equal(len(result["daily"]), 2, "zero-filled daily range")
        assert_close(result["daily"][0]["revenue"], 140, "daily backend revenue")
        assert_close(result["daily"][1]["spend"], 0, "empty day spend")

        os.environ["GOOGLE_ADS_MERCHANT_ALIASES"] = '{"special": 101}'
        manual = workbench.merge_workbench_sources(
            [{**campaign_rows[3], "campaignName": "special search"}],
            backend_rows,
            dt.date(2026, 8, 1),
            dt.date(2026, 8, 1),
        )
        assert_equal(manual["campaigns"][0]["merchantId"], 101, "manual alias merchant")
        assert_equal(manual["campaigns"][0]["matchMethod"], "manual_alias", "manual alias method")

        for args in [
            ("2026-08-01", None),
            ("invalid", "2026-08-01"),
            ("2026-08-02", "2026-08-01"),
            ("2025-01-01", "2026-08-01"),
        ]:
            try:
                workbench._date_range(*args)
            except ValueError:
                pass
            else:
                raise AssertionError(f"invalid date range should fail: {args!r}")
    finally:
        if old_aliases is None:
            os.environ.pop("GOOGLE_ADS_MERCHANT_ALIASES", None)
        else:
            os.environ["GOOGLE_ADS_MERCHANT_ALIASES"] = old_aliases

    print("Google Ads workbench aggregation checks passed")


if __name__ == "__main__":
    main()
