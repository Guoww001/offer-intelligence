import csv
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import ensure_oi_schema
import apply_tier1_business_manager_schema
import sync_tier1_business_managers


def assert_equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


class FakeCursor:
    def __init__(self, tier1_ids):
        self.tier1_ids = tier1_ids
        self.execute_calls = []
        self.executemany_calls = []

    def __enter__(self):
        return self

    def __exit__(self, _exc_type, _exc, _traceback):
        return False

    def execute(self, sql, params):
        self.execute_calls.append((sql, params))

    def fetchall(self):
        return [(merchant_id,) for merchant_id in self.tier1_ids]

    def executemany(self, sql, values):
        self.executemany_calls.append((sql, values))


class FakeConnection:
    def __init__(self, tier1_ids):
        self.cursor_instance = FakeCursor(tier1_ids)
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


def main():
    migration = ensure_oi_schema.OFFER_SHEET_METADATA_COLUMN_MIGRATIONS["businessManager"]
    assert "ADD COLUMN businessManager VARCHAR(128) DEFAULT NULL AFTER agency" in migration

    class SchemaCursor:
        def __init__(self):
            self.execute_calls = []

        def __enter__(self):
            return self

        def __exit__(self, _exc_type, _exc, _traceback):
            return False

        def execute(self, sql):
            self.execute_calls.append(sql)

    class SchemaConnection:
        def __init__(self):
            self.cursor_instance = SchemaCursor()

        def cursor(self):
            return self.cursor_instance

    schema_connection = SchemaConnection()
    original_column_exists = ensure_oi_schema.column_exists
    original_table_exists = ensure_oi_schema.table_exists
    column_checks = iter([False, True])
    table_checks = iter([False, True])
    ensure_oi_schema.column_exists = lambda _conn, _table, _column: next(column_checks)
    ensure_oi_schema.table_exists = lambda _conn, _table: next(table_checks)
    try:
        history_status = (
            apply_tier1_business_manager_schema.apply_tier1_move_history_schema(
                schema_connection
            )
        )
        schema_status = apply_tier1_business_manager_schema.apply_business_manager_schema(
            schema_connection
        )
    finally:
        ensure_oi_schema.column_exists = original_column_exists
        ensure_oi_schema.table_exists = original_table_exists
    assert_equal(history_status, "added", "Tier 1 move-history migration status")
    assert_equal(schema_status, "added", "schema migration status")
    assert_equal(
        schema_connection.cursor_instance.execute_calls,
        [apply_tier1_business_manager_schema.HISTORY_TABLE_DDL, migration],
        "schema migration DDL",
    )

    rows = [
        {"Merchant ID": "101", "BD": "Bryan"},
        {"merchantId": "202", "bd": ""},
    ]
    normalized = sync_tier1_business_managers.normalized_bd_rows(rows)
    assert_equal(
        normalized,
        [("101", "Bryan", "Tier 1"), ("202", "Timmy", "Tier 1")],
        "normalized BD values",
    )

    connection = FakeConnection({"101", "202"})
    result = sync_tier1_business_managers.sync_tier1_bd(connection, rows)
    assert_equal(
        result,
        {"rows": 2, "bryan": 1, "timmy": 1, "other": 0},
        "sync summary",
    )
    assert connection.begun and connection.committed and not connection.rolled_back
    select_sql, select_params = connection.cursor_instance.execute_calls[0]
    assert "FROM cnpscy_oi_tier_assignments" in select_sql
    assert "WHERE tier = %s" in select_sql
    assert_equal(select_params, ("Tier 1", "101", "202"), "Tier 1 validation parameters")
    upsert_sql, upsert_values = connection.cursor_instance.executemany_calls[0]
    assert "businessManager = VALUES(businessManager)" in upsert_sql
    assert_equal(upsert_values, normalized, "BD database values")

    invalid_connection = FakeConnection({"101"})
    try:
        sync_tier1_business_managers.sync_tier1_bd(invalid_connection, rows)
        raise AssertionError("non-Tier 1 merchants must be rejected")
    except ValueError as error:
        assert "202" in str(error)
    assert invalid_connection.rolled_back and not invalid_connection.committed
    assert_equal(
        invalid_connection.cursor_instance.executemany_calls,
        [],
        "rejected rows must not be written",
    )

    try:
        sync_tier1_business_managers.normalized_bd_rows([
            {"Merchant ID": "101", "BD": "Bryan"},
            {"Merchant ID": "101", "BD": "Timmy"},
        ])
        raise AssertionError("duplicate Merchant IDs must be rejected")
    except ValueError as error:
        assert "Duplicate" in str(error)

    try:
        sync_tier1_business_managers.normalized_bd_rows([
            {"Merchant ID": "101", "Manager": "Alice"},
        ])
        raise AssertionError("missing BD header must be rejected")
    except ValueError as error:
        assert "BD" in str(error)

    with tempfile.TemporaryDirectory() as directory:
        malformed_csv = Path(directory) / "missing-bd-header.csv"
        malformed_csv.write_text("Merchant ID,Manager\n101,Alice\n", encoding="utf-8")
        try:
            sync_tier1_business_managers.load_bd_csv(malformed_csv)
            raise AssertionError("CSV with a misspelled BD header must be rejected")
        except ValueError as error:
            assert "BD" in str(error)

    snapshot = sync_tier1_business_managers.load_bd_csv(
        ROOT / "data" / "tier1_bd.csv"
    )
    normalized_snapshot = sync_tier1_business_managers.normalized_bd_rows(snapshot)
    assert_equal(len(normalized_snapshot), 55, "Google Sheet Tier 1 Merchant ID count")
    assert_equal(
        sum(1 for _merchant_id, bd, _source_sheet in normalized_snapshot if bd == "Bryan"),
        19,
        "Bryan Tier 1 count",
    )
    assert_equal(
        sum(1 for _merchant_id, bd, _source_sheet in normalized_snapshot if bd == "Timmy"),
        36,
        "Timmy Tier 1 count",
    )
    with (ROOT / "data" / "tier1_bd_unmatched.csv").open(
        encoding="utf-8-sig",
        newline="",
    ) as file:
        unmatched = list(csv.DictReader(file))
    assert_equal(
        [(row["merchantName"], row["BD"]) for row in unmatched],
        [("Featol", "Bryan"), ("Tabwee", "Bryan")],
        "Tier 1 source rows without Merchant IDs",
    )
    with (ROOT / "data" / "tier1_bd_corrections.csv").open(
        encoding="utf-8-sig",
        newline="",
    ) as file:
        corrections = list(csv.DictReader(file))
    assert_equal(
        [
            (row["sourceMerchantId"], row["resolvedMerchantId"], row["merchantName"])
            for row in corrections
        ],
        [("4027338", "402733", "Level8")],
        "verified Google Sheet Merchant ID corrections",
    )
    assert "402733" in {merchant_id for merchant_id, _bd, _source in normalized_snapshot}
    assert "4027338" not in {merchant_id for merchant_id, _bd, _source in normalized_snapshot}

    print("Tier 1 BD sync checks passed")


if __name__ == "__main__":
    main()
