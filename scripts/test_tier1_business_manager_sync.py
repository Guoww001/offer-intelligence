import sys
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
    column_checks = iter([False, True])
    ensure_oi_schema.column_exists = lambda _conn, _table, _column: next(column_checks)
    try:
        schema_status = apply_tier1_business_manager_schema.apply_business_manager_schema(
            schema_connection
        )
    finally:
        ensure_oi_schema.column_exists = original_column_exists
    assert_equal(schema_status, "added", "schema migration status")
    assert_equal(
        schema_connection.cursor_instance.execute_calls,
        [migration],
        "schema migration DDL",
    )

    rows = [
        {"Merchant ID": "101", "Business Manager": "Alice"},
        {"merchantId": "202", "businessManager": ""},
    ]
    normalized = sync_tier1_business_managers.normalized_business_manager_rows(rows)
    assert_equal(
        normalized,
        [("101", "Alice", "Tier 1"), ("202", None, "Tier 1")],
        "normalized business-manager values",
    )

    connection = FakeConnection({"101", "202"})
    result = sync_tier1_business_managers.sync_tier1_business_managers(connection, rows)
    assert_equal(result, {"rows": 2, "nonblank": 1, "blank": 1}, "sync summary")
    assert connection.begun and connection.committed and not connection.rolled_back
    select_sql, select_params = connection.cursor_instance.execute_calls[0]
    assert "FROM cnpscy_oi_tier_assignments" in select_sql
    assert "WHERE tier = %s" in select_sql
    assert_equal(select_params, ("Tier 1", "101", "202"), "Tier 1 validation parameters")
    upsert_sql, upsert_values = connection.cursor_instance.executemany_calls[0]
    assert "businessManager = VALUES(businessManager)" in upsert_sql
    assert_equal(upsert_values, normalized, "business-manager database values")

    invalid_connection = FakeConnection({"101"})
    try:
        sync_tier1_business_managers.sync_tier1_business_managers(invalid_connection, rows)
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
        sync_tier1_business_managers.normalized_business_manager_rows([
            {"Merchant ID": "101", "Business Manager": "Alice"},
            {"Merchant ID": "101", "Business Manager": "Bob"},
        ])
        raise AssertionError("duplicate Merchant IDs must be rejected")
    except ValueError as error:
        assert "Duplicate" in str(error)

    print("Tier 1 business-manager sync checks passed")


if __name__ == "__main__":
    main()
