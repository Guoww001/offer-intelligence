import datetime as dt
import sys
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import offer_db
from scripts import build_db_static_snapshot


def assert_equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def assert_close(actual, expected, label):
    if abs(float(actual) - float(expected)) > 0.000001:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def assert_raises(message, callback, label):
    try:
        callback()
    except ValueError as error:
        if message not in str(error):
            raise AssertionError(f"{label}: expected {message!r} in {str(error)!r}") from error
    else:
        raise AssertionError(f"{label}: expected ValueError")


def test_date_ranges():
    assert_equal(
        offer_db.resolve_tier_report_date_range("2026-07-21", "2026-07-22"),
        (dt.date(2026, 7, 21), dt.date(2026, 7, 22)),
        "two-day range",
    )
    assert_equal(
        offer_db.resolve_tier_report_date_range("2026/06/01", "2026/07/15"),
        (dt.date(2026, 6, 1), dt.date(2026, 7, 15)),
        "slash range",
    )
    assert_equal(
        offer_db.resolve_tier_report_date_range("2026-07-21", None),
        (dt.date(2026, 7, 21), dt.date(2026, 7, 21)),
        "single start date",
    )
    assert_equal(
        offer_db.resolve_tier_report_date_range(None, "2026-07-22"),
        (dt.date(2026, 7, 22), dt.date(2026, 7, 22)),
        "single end date",
    )
    assert_equal(
        offer_db.resolve_tier_report_date_range(month="2026-06"),
        (dt.date(2026, 6, 1), dt.date(2026, 6, 30)),
        "legacy month range",
    )
    assert_equal(
        offer_db.resolve_tier_report_date_range(reference_date=dt.date(2026, 7, 22)),
        (dt.date(2026, 7, 1), dt.date(2026, 7, 22)),
        "default current month-to-date",
    )
    assert_raises(
        "cannot be after",
        lambda: offer_db.resolve_tier_report_date_range("2026-07-22", "2026-07-21"),
        "reversed range",
    )
    assert_raises(
        "cannot exceed",
        lambda: offer_db.resolve_tier_report_date_range("2025-01-01", "2026-07-22"),
        "oversized range",
    )


def test_commission_epc_formula():
    clicks = 5521
    assert_close(
        offer_db.commission_amount_epc(452.93, clicks),
        452.93 / clicks,
        "ALL commission amount EPC",
    )
    assert_close(
        offer_db.commission_amount_epc(339.6975, clicks),
        339.6975 / clicks,
        "AFF commission amount EPC",
    )
    assert_equal(offer_db.commission_amount_epc(452.93, 0), 0.0, "zero-click EPC")


def test_static_snapshot_epc_formula():
    offer = build_db_static_snapshot.offer_from_rows(
        {"merchantId": "362653", "merchantName": "Shokz Official", "commissionRate": 10},
        {"revenue": 4528.59, "clicks": 5521, "payout": 452.859, "affiliatePayout": 339.64425},
        "Tier 1",
        {},
        [],
    )
    assert_close(offer["allEpc"], 452.859 / 5521, "snapshot all EPC")
    assert_close(offer["affEpc"], 339.64425 / 5521, "snapshot AFF EPC")
    assert_equal(offer["allCommissionRate"], 10, "snapshot ALL commission rate")
    assert_close(offer["affCommissionRate"], 7.5, "snapshot AFF commission rate")
    assert_equal(offer["epc"], offer["affEpc"], "snapshot legacy EPC")


def test_report_payload():
    base_rows = [
        {
            "Merchant ID": "101",
            "Merchant Name": "Order Click Merchant",
            "Brand": "Order Click Merchant",
            "Network": "Archer",
            "Agency": "Bluefocus",
            "BD": "Bryan",
            "ALL Commission": 10,
            "COUNTRY": "UK",
        },
        {
            "Merchant ID": "202",
            "Merchant Name": "Tracked Click Merchant",
            "Brand": "Tracked Click Merchant",
            "Network": "Levanta",
            "Agency": None,
            "BD": None,
            "ALL Commission": 10,
        },
        {
            "Merchant ID": "303",
            "Merchant Name": "Estimate Only Merchant",
            "Brand": "Estimate Only Merchant",
            "Network": "Levanta",
            "Agency": None,
            "BD": None,
            "ALL Commission": 12,
            "COUNTRY": "US",
        },
    ]
    order_rows = [
        {"merchantId": "101", "orders": 2, "revenue": 80, "payout": 8, "affiliatePayout": 6, "affProportion": 75, "dpv": 20, "atc": 5, "orderClicks": 10},
        {"merchantId": "202", "orders": 5, "revenue": 125, "payout": 12.5, "affiliatePayout": 10, "affProportion": 80, "dpv": 40, "atc": 9, "orderClicks": 0},
    ]
    click_rows = [
        {"merchantId": "101", "trackedClicks": 100},
        {"merchantId": "202", "trackedClicks": 50},
    ]
    calls = []

    @contextmanager
    def fake_connection():
        yield object()

    def fake_fetch_all(_conn, sql, params=None):
        calls.append((sql, params))
        if "SHOW COLUMNS FROM `cnpscy_oi_offer_sheet_metadata`" in sql:
            return [{"Field": "agency"}, {"Field": "businessManager"}]
        if "SHOW COLUMNS FROM `cnpscy_oi_merchant_aov_estimates`" in sql:
            return [{"Field": field} for field in (
                "estimateId", "merchantId", "aov", "currency", "sampleProductCount",
                "method", "sourceFile", "sourceDate",
            )]
        if "FROM `cnpscy_oi_merchant_aov_estimates` e" in sql:
            return [{
                "merchantId": "303",
                "aov": 119.99,
                "currency": "USD",
                "sampleProductCount": 5,
                "method": "five_product_average",
                "sourceFile": "YP Amazon Offers (8-3) .xlsx",
                "sourceDate": dt.date(2026, 8, 3),
            }]
        if "FROM cnpscy_amazon_order" in sql:
            return order_rows
        if "FROM cnpscy_amazon_click" in sql:
            return click_rows
        if "FROM cnpscy_oi_tier_assignments t" in sql:
            return base_rows
        raise AssertionError(f"Unexpected SQL: {sql}")

    original_connection = offer_db.db_connection
    original_fetch_all = offer_db.fetch_all
    offer_db.db_connection = fake_connection
    offer_db.fetch_all = fake_fetch_all
    offer_db.TABLE_COLUMNS_CACHE.clear()
    offer_db._tier_sheet_cache.clear()
    try:
        payload = offer_db.tier_sheet_payload(
            "Tier 1",
            start_date="2026-06-01",
            end_date="2026-07-15",
            compact=True,
        )
    finally:
        offer_db.db_connection = original_connection
        offer_db.fetch_all = original_fetch_all
        offer_db.TABLE_COLUMNS_CACHE.clear()
        offer_db._tier_sheet_cache.clear()

    assert_equal(payload["startDate"], "2026-06-01", "payload start date")
    assert_equal(payload["endDate"], "2026-07-15", "payload end date")
    assert_equal(payload["source"]["dimension"], "advert_id", "report dimension")
    assert_equal(payload["compact"], True, "compact payload flag")
    assert "May Revenue" not in payload["headers"], payload["headers"]
    assert "June Revenue" not in payload["headers"], payload["headers"]
    assert "Commission Rate" not in payload["headers"], payload["headers"]
    assert_equal(payload["rows"][0]["ALL Commission"], "10.0", "ALL commission rate")
    assert_equal(payload["rows"][0]["AFF Commission"], "7.5", "AFF commission rate")
    assert_equal(payload["rows"][1]["AFF Commission"], "8.0", "merchant AFF proportion")
    assert_equal(payload["rows"][0]["Clicks"], "10.0", "order click source")
    assert_equal(payload["rows"][0]["Revenue"], "80.0", "order revenue")
    assert_equal(payload["rows"][0]["Agency"], "Bluefocus", "sheet agency")
    assert_equal(payload["rows"][1]["Agency"], "", "missing agency stays blank")
    assert_equal(payload["rows"][0]["BD"], "Bryan", "Tier 1 BD")
    assert_equal(payload["rows"][1]["BD"], "", "missing BD stays blank")
    assert_equal(payload["rows"][0]["COUNTRY"], "UK", "compact country metadata")
    assert_equal(payload["rows"][0]["Backend EPC"], "0.6", "legacy EPC should use AFF commission")
    assert_equal(payload["rows"][0]["EPC(All)"], "0.8", "all EPC")
    assert_equal(payload["rows"][0]["EPC(Aff)"], "0.6", "AFF EPC")
    assert_equal(payload["rows"][1]["Clicks"], "50.0", "tracked click fallback")
    assert_equal(payload["rows"][1]["EPC(All)"], "0.25", "tracked-click all EPC")
    assert_equal(payload["rows"][1]["EPC(Aff)"], "0.2", "tracked-click AFF EPC")
    assert_equal(payload["rows"][1]["Conversion Rate"], "0.1", "tracked conversion")
    assert_equal(payload["rows"][0]["AOV"], "40.0", "actual AOV")
    assert_equal(payload["rows"][0]["AOV Type"], "actual", "actual AOV provenance")
    assert_equal(payload["rows"][2]["AOV"], "119.99", "tentative AOV fallback")
    assert_equal(payload["rows"][2]["AOV Type"], "tentative", "tentative AOV provenance")
    assert_equal(payload["rows"][2]["AOV Sample Products"], "5", "tentative sample size")
    assert_equal(payload["rows"][2]["AOV Source Date"], "2026-08-03", "tentative source date")

    amazon_calls = [(sql, params) for sql, params in calls if "cnpscy_amazon_" in sql]
    assert_equal(len(amazon_calls), 2, "Amazon metric query count")
    for _sql, params in amazon_calls:
        assert_equal(params, ("Tier 1", 20260601, 20260715), "inclusive date parameters")
    assert any("MAX(sm.agency) AS `Agency`" in sql for sql, _params in calls), "agency query is missing"
    assert any(
        "MAX(sm.businessManager) AS `BD`" in sql
        for sql, _params in calls
    ), "BD query is missing"
    assert any("MAX(sm.region) AS `COUNTRY`" in sql for sql, _params in calls), "compact country query is missing"


def test_frontend_contract():
    entry = (ROOT / "frontend" / "src" / "entry.ts").read_text(encoding="utf-8")
    tier_page = (ROOT / "frontend" / "src" / "features" / "tier-sheet" / "TierSheetPage.vue").read_text(encoding="utf-8")
    category_page = (ROOT / "frontend" / "src" / "features" / "category-report" / "CategoryReportPage.vue").read_text(encoding="utf-8")
    backend = (ROOT / "offer_db.py").read_text(encoding="utf-8")
    assert 'data-tier-date="start"' in tier_page
    assert 'data-tier-date="end"' in tier_page
    assert 'data-tier-action="date-apply"' in tier_page
    assert 'class="tier-date-status"' in tier_page
    assert 'data-category-date="start"' in category_page
    assert 'data-category-date="end"' in category_page
    assert 'data-category-action="apply-date"' in category_page
    assert 'id="category-report-options"' in category_page
    assert "start_date" in entry and "end_date" in entry
    for removed in ("May Revenue", "June Revenue"):
        assert removed not in tier_page, f"{removed} still present in TierSheetPage.vue"
        assert removed not in category_page, f"{removed} still present in CategoryReportPage.vue"
        assert removed not in backend, f"{removed} still present in offer_db.py"
    assert "commission_amount_epc(all_commission, clicks)" in backend
    assert "commission_amount_epc(aff_commission, clicks)" in backend


def main():
    test_date_ranges()
    test_commission_epc_formula()
    test_static_snapshot_epc_formula()
    test_report_payload()
    test_frontend_contract()
    print("Tier report date-range checks passed")


if __name__ == "__main__":
    main()
