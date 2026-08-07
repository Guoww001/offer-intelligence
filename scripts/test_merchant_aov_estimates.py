from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import offer_db
import ensure_oi_schema
import sync_oi_tables


def assert_equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def test_source_snapshot():
    rows = sync_oi_tables.load_merchant_aov_estimates_csv()
    assert_equal(len(rows), 450, "dated AOV observations")
    assert_equal(len({row["Merchant ID"] for row in rows}), 261, "unique source merchants")
    keys = [(row["Merchant ID"], row["Source Date"]) for row in rows]
    assert_equal(len(keys), len(set(keys)), "merchant and source-date uniqueness")
    assert all(float(row["Tentative AOV"]) > 0 for row in rows), "all AOV values must be positive"
    assert all(int(row["Sample Product Count"]) == 5 for row in rows), "all estimates use five products"
    assert all(row["Method"] == "five_product_average" for row in rows), "method provenance"


def test_resolution_priority():
    estimate = {
        "aov": 119.99,
        "currency": "USD",
        "sampleProductCount": 5,
        "method": "five_product_average",
        "sourceFile": "YP Amazon Offers (8-3) .xlsx",
        "sourceDate": "2026-08-03",
    }
    actual = offer_db.resolve_merchant_aov(2, 80, estimate)
    assert_equal(actual["aov"], 40.0, "actual AOV formula")
    assert_equal(actual["aovType"], "actual", "actual AOV priority")
    assert_equal(actual["aovMethod"], "revenue_divided_by_orders", "actual AOV method")

    tentative = offer_db.resolve_merchant_aov(0, 0, estimate)
    assert_equal(tentative["aov"], 119.99, "tentative AOV fallback")
    assert_equal(tentative["aovType"], "tentative", "tentative AOV type")
    assert_equal(tentative["aovSampleProductCount"], 5, "tentative sample size")

    zero_revenue = offer_db.resolve_merchant_aov(2, 0, estimate)
    assert_equal(zero_revenue["aovType"], "tentative", "positive orders without revenue are not actual AOV")

    unavailable = offer_db.resolve_merchant_aov(0, 0, None)
    assert_equal(unavailable["aov"], None, "missing AOV stays blank")
    assert_equal(unavailable["aovType"], "unavailable", "missing AOV provenance")


def test_sync_shape():
    captured = {}
    original_upsert = sync_oi_tables.upsert

    def fake_upsert(_conn, table, rows, key_columns):
        captured.update(table=table, rows=rows, key_columns=key_columns)
        return len(rows)

    sync_oi_tables.upsert = fake_upsert
    try:
        source_rows = sync_oi_tables.load_merchant_aov_estimates_csv()
        count = sync_oi_tables.sync_merchant_aov_estimates(object(), source_rows)
    finally:
        sync_oi_tables.upsert = original_upsert

    assert_equal(count, 450, "synced observation count")
    assert_equal(captured["table"], offer_db.MERCHANT_AOV_ESTIMATES_TABLE, "AOV target table")
    assert_equal(captured["key_columns"], ["merchantId", "sourceDate"], "AOV upsert key")
    assert_equal(captured["rows"][0]["sampleProductCount"], 5, "persisted sample size")


def test_schema_contract():
    ddl = offer_db.MERCHANT_AOV_ESTIMATES_TABLE_DDL
    assert "CREATE TABLE IF NOT EXISTS cnpscy_oi_merchant_aov_estimates" in ddl
    assert "UNIQUE KEY uq_merchant_aov_source_date (merchantId, sourceDate)" in ddl
    schema_script = (ROOT / "scripts" / "ensure_oi_schema.py").read_text(encoding="utf-8")
    assert "MERCHANT_AOV_ESTIMATES_TABLE_DDL" in schema_script
    assert_equal(
        ensure_oi_schema.MERCHANT_AOV_ESTIMATES_TABLE,
        "cnpscy_oi_merchant_aov_estimates",
        "schema table name",
    )


def test_targeted_sync_entrypoint():
    source = (ROOT / "scripts" / "sync_merchant_aov_estimates.py").read_text(encoding="utf-8")
    workflow = (ROOT / ".github" / "workflows" / "sync-merchant-aov-estimates.yml").read_text(
        encoding="utf-8"
    )
    assert "sync_merchant_aov_estimates(conn, rows)" in source
    assert "verify_persisted_estimates(conn, rows)" in source
    assert "github.repository == 'Yeahpromos/offer-intelligence'" in workflow
    assert "python scripts/ensure_oi_schema.py" in workflow
    assert "python scripts/sync_merchant_aov_estimates.py" in workflow


def main():
    test_source_snapshot()
    test_resolution_priority()
    test_sync_shape()
    test_schema_contract()
    test_targeted_sync_entrypoint()
    print("Merchant AOV estimate checks passed")


if __name__ == "__main__":
    main()
