import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import ensure_oi_schema
import sync_oi_tables
import sync_tier1_agencies


def assert_equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def main():
    assert "agency" in ensure_oi_schema.OFFER_SHEET_METADATA_COLUMN_MIGRATIONS
    assert "ADD COLUMN agency VARCHAR(128) DEFAULT NULL" in (
        ensure_oi_schema.OFFER_SHEET_METADATA_COLUMN_MIGRATIONS["agency"]
    )

    captured = {}
    original_upsert = sync_oi_tables.upsert

    def fake_upsert(_conn, table, rows, key_columns):
        captured["table"] = table
        captured["rows"] = rows
        captured["key_columns"] = key_columns
        return len(rows)

    sync_oi_tables.upsert = fake_upsert
    try:
        count = sync_oi_tables.sync_sheet_metadata(
            object(),
            sheets=[
                {
                    "name": "Tier 1",
                    "rows": [
                        {"Merchant ID": "101", "Merchant Name": "Agency Merchant"},
                        {"Merchant ID": "202", "Merchant Name": "Blank Agency Merchant"},
                    ],
                }
            ],
            offers=[],
            tier1_agencies=[
                {"merchantId": "101", "agency": "Bluefocus"},
                {"merchantId": "202", "agency": ""},
            ],
        )
    finally:
        sync_oi_tables.upsert = original_upsert

    rows = {row["merchantId"]: row for row in captured["rows"]}
    assert_equal(captured["table"], "cnpscy_oi_offer_sheet_metadata", "target table")
    assert_equal(captured["key_columns"], ["merchantId"], "upsert key")
    assert_equal(count, 2, "synced row count")
    assert_equal(rows["101"]["agency"], "Bluefocus", "agency value")
    assert_equal(rows["202"]["agency"], None, "blank agency")
    assert_equal(rows["101"]["sourceSheet"], "Tier 1", "agency source sheet")

    agency_rows = sync_oi_tables.load_tier1_agencies_csv()
    assert_equal(len(agency_rows), 54, "Tier 1 Merchant ID count")
    assert_equal(
        sum(1 for row in agency_rows if str(row.get("agency") or "").strip()),
        52,
        "nonblank Tier 1 agency count",
    )
    assert_equal(
        {row["merchantId"] for row in agency_rows if not str(row.get("agency") or "").strip()},
        {"384493", "383493"},
        "blank Tier 1 agencies",
    )
    normalized = sync_tier1_agencies.normalized_agency_rows(agency_rows)
    assert_equal(len(normalized), 54, "validated database sync row count")
    assert_equal(
        sum(1 for _merchant_id, agency, _source_sheet in normalized if agency),
        52,
        "validated database sync nonblank count",
    )
    assert_equal(
        {merchant_id for merchant_id, agency, _source_sheet in normalized if agency is None},
        {"384493", "383493"},
        "validated database sync blank agencies",
    )

    class FakeCursor:
        def __init__(self):
            self.execute_calls = []
            self.executemany_calls = []

        def __enter__(self):
            return self

        def __exit__(self, _exc_type, _exc, _traceback):
            return False

        def execute(self, sql):
            self.execute_calls.append(sql)

        def executemany(self, sql, values):
            self.executemany_calls.append((sql, values))

    class FakeConnection:
        def __init__(self):
            self.cursor_instance = FakeCursor()
            self.begun = False
            self.committed = False
            self.rolled_back = False

        def begin(self):
            self.begun = True

        def cursor(self):
            return self.cursor_instance

        def commit(self):
            self.committed = True

        def rollback(self):
            self.rolled_back = True

    fake_connection = FakeConnection()
    sync_result = sync_tier1_agencies.sync_tier1_agencies(
        fake_connection,
        [
            {"merchantId": "101", "agency": "Bluefocus"},
            {"merchantId": "202", "agency": ""},
        ],
    )
    assert_equal(sync_result, {"rows": 2, "nonblank": 1, "blank": 1}, "database sync summary")
    assert fake_connection.begun and fake_connection.committed and not fake_connection.rolled_back
    clear_sql = fake_connection.cursor_instance.execute_calls[0]
    upsert_sql, upsert_values = fake_connection.cursor_instance.executemany_calls[0]
    assert "SET sm.agency = NULL" in clear_sql
    assert "WHERE t.tier = 'Tier 1'" in clear_sql
    assert "ON DUPLICATE KEY UPDATE agency = VALUES(agency)" in upsert_sql
    assert_equal(
        upsert_values,
        [("101", "Bluefocus", "Tier 1"), ("202", None, "Tier 1")],
        "database upsert values",
    )

    print("Tier 1 agency sync checks passed")


if __name__ == "__main__":
    main()
