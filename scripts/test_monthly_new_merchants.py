from contextlib import contextmanager
import datetime as dt
from decimal import Decimal
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import offer_db


def assert_equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


class FakeCursor:
    def __init__(self, connection):
        self.connection = connection
        self.lastrowid = connection.lastrowid

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=()):
        self.connection.executed.append((sql, params))


class FakeConnection:
    def __init__(self, lastrowid=41):
        self.lastrowid = lastrowid
        self.executed = []
        self.begun = False
        self.committed = False
        self.rolled_back = False

    def begin(self):
        self.begun = True

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def cursor(self):
        return FakeCursor(self)


BASE_PAYLOAD = {
    "reportMonth": "2026-07",
    "merchantId": "398751",
    "merchantName": "July Merchant",
    "businessManager": "Fiona",
    "gmvMonthlyTarget": "125000.50",
    "completionReward": "$2,500 bonus after reaching the target",
}


def main():
    ddl = offer_db.MONTHLY_NEW_MERCHANTS_TABLE_DDL
    assert "CREATE TABLE IF NOT EXISTS cnpscy_oi_monthly_new_merchants" in ddl
    assert "merchantId       VARCHAR(64) DEFAULT NULL" in ddl
    assert "merchantName     VARCHAR(180) NOT NULL" in ddl
    assert "gmvMonthlyTarget DECIMAL(18, 2) DEFAULT NULL" in ddl
    assert "completionReward VARCHAR(1000) DEFAULT NULL" in ddl
    assert "UNIQUE KEY uq_monthly_new_merchant_id (reportMonth, merchantId)" in ddl

    assert_equal(
        offer_db.normalize_monthly_new_merchant_month("2026-07"),
        "2026-07",
        "valid month",
    )
    for invalid_month in ("2026-7", "2026-13", "July 2026"):
        try:
            offer_db.normalize_monthly_new_merchant_month(invalid_month)
        except ValueError:
            pass
        else:
            raise AssertionError(f"invalid month accepted: {invalid_month}")

    optional_values = offer_db._monthly_new_merchant_values(
        {"reportMonth": "2026-07", "merchantName": "Name only"},
        updated_by="admin",
    )
    assert_equal(optional_values["merchantId"], "", "optional merchant ID")
    assert_equal(optional_values["businessManager"], "", "optional BD")
    assert_equal(optional_values["gmvMonthlyTarget"], None, "optional GMV target")
    assert_equal(optional_values["completionReward"], "", "optional reward")

    invalid_payloads = [
        ({**BASE_PAYLOAD, "merchantId": "ABC"}, "non-numeric merchant ID"),
        ({**BASE_PAYLOAD, "merchantName": ""}, "required merchant name"),
        ({**BASE_PAYLOAD, "gmvMonthlyTarget": "-1"}, "negative GMV target"),
        ({**BASE_PAYLOAD, "gmvMonthlyTarget": "not-a-number"}, "invalid GMV target"),
    ]
    for payload, label in invalid_payloads:
        try:
            offer_db._monthly_new_merchant_values(payload, updated_by="admin")
        except ValueError:
            pass
        else:
            raise AssertionError(f"{label} must be rejected")

    original_db_connection = offer_db.db_connection
    original_fetch_all = offer_db.fetch_all
    original_fetch_one = offer_db.fetch_one
    original_schema_ready = offer_db._monthly_new_merchants_schema_ready

    active_connection = FakeConnection()
    fetch_one_responses = []

    @contextmanager
    def fake_db_connection():
        yield active_connection

    def fake_fetch_one(_conn, _sql, _params=()):
        if not fetch_one_responses:
            raise AssertionError("unexpected fetch_one call")
        return fetch_one_responses.pop(0)

    try:
        offer_db.db_connection = fake_db_connection
        offer_db.fetch_one = fake_fetch_one
        offer_db._monthly_new_merchants_schema_ready = True

        created_row = {
            "recordId": 41,
            "reportMonth": "2026-07",
            "merchantId": "398751",
            "merchantName": "July Merchant",
            "businessManager": "Fiona",
            "gmvMonthlyTarget": Decimal("125000.50"),
            "completionReward": "$2,500 bonus after reaching the target",
            "createdBy": "admin",
            "updatedBy": "admin",
            "createdAt": dt.datetime(2026, 7, 30, 4, 0, 0),
            "updatedAt": dt.datetime(2026, 7, 30, 4, 0, 0),
        }
        active_connection = FakeConnection(lastrowid=41)
        fetch_one_responses[:] = [None, created_row]
        created = offer_db.upsert_monthly_new_merchant(
            BASE_PAYLOAD,
            updated_by="admin",
        )
        assert_equal(created["ok"], True, "create result")
        assert_equal(created["action"], "created", "create action")
        assert_equal(created["record"]["recordId"], 41, "created record ID")
        assert_equal(created["record"]["gmvMonthlyTarget"], 125000.5, "GMV JSON value")
        assert_equal(active_connection.begun, True, "create transaction begun")
        assert_equal(active_connection.committed, True, "create committed")
        insert_sql, insert_params = next(
            item for item in active_connection.executed
            if "INSERT INTO cnpscy_oi_monthly_new_merchants" in item[0]
        )
        assert "gmvMonthlyTarget" in insert_sql and "completionReward" in insert_sql
        assert_equal(insert_params[4], Decimal("125000.50"), "stored GMV target")
        assert_equal(insert_params[6], "admin", "create actor")

        updated_payload = {
            **BASE_PAYLOAD,
            "recordId": 41,
            "merchantId": "",
            "businessManager": "",
            "gmvMonthlyTarget": "",
            "completionReward": "",
        }
        updated_row = {
            **created_row,
            "merchantId": None,
            "businessManager": None,
            "gmvMonthlyTarget": None,
            "completionReward": None,
            "updatedBy": "editor",
        }
        active_connection = FakeConnection()
        fetch_one_responses[:] = [{"recordId": 41}, None, updated_row]
        updated = offer_db.upsert_monthly_new_merchant(
            updated_payload,
            updated_by="editor",
        )
        assert_equal(updated["action"], "updated", "update action")
        assert_equal(updated["record"].get("gmvMonthlyTarget"), None, "cleared GMV target")
        update_sql, update_params = next(
            item for item in active_connection.executed
            if "UPDATE cnpscy_oi_monthly_new_merchants" in item[0]
        )
        assert "updatedAt" in update_sql
        assert_equal(update_params[1], None, "cleared merchant ID")
        assert_equal(update_params[6], "editor", "update actor")

        active_connection = FakeConnection()
        fetch_one_responses[:] = [{"recordId": 99}]
        duplicate = offer_db.upsert_monthly_new_merchant(
            {"reportMonth": "2026-07", "merchantName": "July Merchant"},
            updated_by="admin",
        )
        assert_equal(duplicate["code"], "duplicate_month_merchant", "duplicate code")
        assert_equal(active_connection.rolled_back, True, "duplicate rolled back")
        if any("INSERT INTO" in sql for sql, _params in active_connection.executed):
            raise AssertionError("duplicate record must not be inserted")

        active_connection = FakeConnection()
        fetch_one_responses[:] = [created_row]
        deleted = offer_db.delete_monthly_new_merchant(41, deleted_by="admin")
        assert_equal(deleted["action"], "deleted", "delete action")
        assert_equal(deleted["record"]["merchantId"], "398751", "deleted record")
        assert_equal(active_connection.committed, True, "delete committed")
        assert any(
            "DELETE FROM cnpscy_oi_monthly_new_merchants" in sql
            for sql, _params in active_connection.executed
        )

        records = [
            created_row,
            {
                **created_row,
                "recordId": 42,
                "merchantId": None,
                "merchantName": "Name only",
                "gmvMonthlyTarget": None,
                "completionReward": None,
            },
        ]

        def fake_fetch_all(_conn, sql, params=()):
            assert "FROM cnpscy_oi_monthly_new_merchants" in sql
            assert "gmvMonthlyTarget" in sql
            assert_equal(params, ("2026-07",), "month query params")
            return records

        offer_db.fetch_all = fake_fetch_all
        active_connection = FakeConnection()
        listed = offer_db.monthly_new_merchants_payload("2026-07")
        assert_equal(listed["count"], 2, "monthly record count")
        assert_equal(listed["gmvTargetCount"], 1, "targeted merchant count")
        assert_equal(listed["gmvTargetTotal"], 125000.5, "monthly GMV target total")
        assert_equal(
            listed["source"],
            "cnpscy_oi_monthly_new_merchants",
            "database source",
        )

        print("Monthly new merchant persistence checks passed")
    finally:
        offer_db.db_connection = original_db_connection
        offer_db.fetch_all = original_fetch_all
        offer_db.fetch_one = original_fetch_one
        offer_db._monthly_new_merchants_schema_ready = original_schema_ready


if __name__ == "__main__":
    main()
