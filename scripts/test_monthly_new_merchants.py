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
    "reportMonth": "2026-08",
    "merchantId": "398751",
    "isPriority": True,
    "gmvMonthlyTarget": "125000.50",
    "completionReward": "$2,500 bonus after reaching the target",
}


def main():
    annotation_ddl = offer_db.MONTHLY_NEW_MERCHANT_ANNOTATIONS_TABLE_DDL
    assert "CREATE TABLE IF NOT EXISTS cnpscy_oi_monthly_new_merchant_annotations" in annotation_ddl
    assert "isPriority               TINYINT(1) NOT NULL DEFAULT 0" in annotation_ddl
    assert "gmvMonthlyTarget         DECIMAL(18, 2) DEFAULT NULL" in annotation_ddl
    assert "completionReward         VARCHAR(1000) DEFAULT NULL" in annotation_ddl
    assert "UNIQUE KEY uq_monthly_new_merchant_annotation (reportMonth, merchantId)" in annotation_ddl

    assert_equal(
        offer_db.normalize_monthly_new_merchant_month("2026-08"),
        "2026-08",
        "valid month",
    )
    assert_equal(
        offer_db._monthly_new_merchant_month_range("2026-12"),
        (dt.datetime(2026, 12, 1), dt.datetime(2027, 1, 1)),
        "December month boundary",
    )
    for invalid_month in ("2026-8", "2026-13", "August 2026"):
        try:
            offer_db.normalize_monthly_new_merchant_month(invalid_month)
        except ValueError:
            pass
        else:
            raise AssertionError(f"invalid month accepted: {invalid_month}")

    optional_values = offer_db._monthly_new_merchant_values(
        {"reportMonth": "2026-08", "merchantId": "398751"},
        updated_by="admin",
    )
    assert_equal(optional_values["isPriority"], False, "optional priority")
    assert_equal(optional_values["gmvMonthlyTarget"], None, "optional GMV target")
    assert_equal(optional_values["completionReward"], "", "optional reward")

    full_values = offer_db._monthly_new_merchant_values(BASE_PAYLOAD, updated_by="admin")
    assert_equal(full_values["isPriority"], True, "priority normalization")
    assert_equal(full_values["gmvMonthlyTarget"], Decimal("125000.50"), "GMV normalization")

    invalid_payloads = [
        ({**BASE_PAYLOAD, "merchantId": "ABC"}, "non-numeric merchant ID"),
        ({**BASE_PAYLOAD, "merchantId": ""}, "required merchant ID"),
        ({**BASE_PAYLOAD, "isPriority": "sometimes"}, "invalid priority"),
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

    source_info = {
        "advert_id": "int(11)",
        "advert_name": "varchar(255)",
        "advert_addtime": "datetime",
        "advert_bd": "varchar(64)",
        "advert_isdel": "tinyint(1)",
    }
    original_source_info = offer_db._monthly_new_merchant_source_column_info
    try:
        offer_db._monthly_new_merchant_source_column_info = lambda _conn: source_info
        source_config = offer_db._monthly_new_merchant_source_config(FakeConnection())
    finally:
        offer_db._monthly_new_merchant_source_column_info = original_source_info
    assert_equal(source_config["sourceDateColumn"], "advert_addtime", "source date column")
    assert_equal(source_config["sourceBdColumn"], "advert_bd", "source BD column")

    source_date_sql = offer_db._monthly_new_merchant_source_datetime_expr("advert_addtime")
    assert "STR_TO_DATE" in source_date_sql
    assert "FROM_UNIXTIME" in source_date_sql
    assert "CAST(NULLIF" in source_date_sql
    assert "'%%Y%%m%%d'" in source_date_sql
    bound_source_date_sql = (
        f"{source_date_sql} >= %s AND {source_date_sql} < %s"
        % ("2026-08-01", "2026-09-01")
    )
    assert "'%Y%m%d'" in bound_source_date_sql

    original_source_info = offer_db._monthly_new_merchant_source_column_info
    original_table_columns = offer_db.table_columns
    original_source_fetch_all = offer_db.fetch_all
    try:
        offer_db._monthly_new_merchant_source_column_info = lambda _conn: source_info
        offer_db.table_columns = lambda _conn, _table: set()
        offer_db.fetch_all = lambda _conn, _sql, _params=(): [
            {
                "merchantId": "101",
                "merchantName": "Newest Alpha",
                "businessManager": "Dora",
                "sourceAddedAt": dt.datetime(2026, 8, 4, 9, 30),
            },
            {
                "merchantId": "101",
                "merchantName": "Older Alpha",
                "businessManager": "Dora",
                "sourceAddedAt": dt.datetime(2026, 8, 1, 9, 30),
            },
            {
                "merchantId": "202",
                "merchantName": "Beta Beauty",
                "businessManager": "Alex",
                "sourceAddedAt": dt.datetime(2026, 8, 3, 12, 0),
            },
        ]
        deduped_sources, _ = offer_db._monthly_new_merchant_source_rows(
            FakeConnection(),
            "2026-08",
        )
    finally:
        offer_db._monthly_new_merchant_source_column_info = original_source_info
        offer_db.table_columns = original_table_columns
        offer_db.fetch_all = original_source_fetch_all
    assert_equal(len(deduped_sources), 2, "deduplicated source merchant count")
    assert_equal(deduped_sources[0]["merchantName"], "Newest Alpha", "latest source row wins")
    assert_equal(deduped_sources[0]["reportMonth"], "2026-08", "source report month")

    original_db_connection = offer_db.db_connection
    original_fetch_all = offer_db.fetch_all
    original_fetch_one = offer_db.fetch_one
    original_source_rows = offer_db._monthly_new_merchant_source_rows
    original_annotation_record = offer_db._monthly_new_merchant_annotation_record
    original_schema_ready = offer_db._monthly_new_merchants_schema_ready

    active_connection = FakeConnection()

    @contextmanager
    def fake_db_connection():
        yield active_connection

    try:
        offer_db.db_connection = fake_db_connection
        offer_db._monthly_new_merchants_schema_ready = True

        sources = [
            {
                "reportMonth": "2026-08",
                "merchantId": "101",
                "merchantName": "Alpha Home",
                "businessManager": "Dora",
                "sourceAddedAt": dt.datetime(2026, 8, 4, 9, 30),
            },
            {
                "reportMonth": "2026-08",
                "merchantId": "202",
                "merchantName": "Beta Beauty",
                "businessManager": "Alex",
                "sourceAddedAt": dt.datetime(2026, 8, 3, 12, 0),
            },
        ]
        annotation = {
            "recordId": 9,
            "reportMonth": "2026-08",
            "merchantId": "202",
            "merchantNameSnapshot": "Beta Beauty",
            "businessManagerSnapshot": "Alex",
            "sourceAddedAt": dt.datetime(2026, 8, 3, 12, 0),
            "isPriority": 1,
            "gmvMonthlyTarget": Decimal("50000.00"),
            "completionReward": "2% bonus",
            "createdBy": "admin",
            "updatedBy": "admin",
            "createdAt": dt.datetime(2026, 8, 4, 1, 0),
            "updatedAt": dt.datetime(2026, 8, 4, 1, 0),
        }
        legacy = {
            "recordId": 3,
            "reportMonth": "2026-08",
            "merchantId": "101",
            "merchantName": "Alpha Home",
            "businessManager": "Dora",
            "gmvMonthlyTarget": Decimal("12000.00"),
            "completionReward": "Legacy reward",
            "createdBy": "admin",
            "updatedBy": "admin",
            "createdAt": dt.datetime(2026, 8, 4, 1, 0),
            "updatedAt": dt.datetime(2026, 8, 4, 1, 0),
        }
        offer_db._monthly_new_merchant_source_rows = lambda _conn, month, merchant_id=None: (
            sources if merchant_id is None else [row for row in sources if row["merchantId"] == merchant_id],
            {"sourceDateColumn": "advert_addtime", "sourceBdColumn": "advert_bd"},
        )

        def fake_fetch_all(_conn, sql, params=()):
            assert_equal(params, ("2026-08",), "month query params")
            if offer_db.MONTHLY_NEW_MERCHANT_ANNOTATIONS_TABLE in sql:
                return [annotation]
            if "FROM cnpscy_oi_monthly_new_merchants" in sql:
                return [legacy]
            raise AssertionError(f"unexpected monthly list SQL: {sql}")

        offer_db.fetch_all = fake_fetch_all
        listed = offer_db.monthly_new_merchants_payload("2026-08")
        assert_equal(listed["count"], 2, "backend merchant count")
        assert_equal(listed["priorityCount"], 1, "priority count")
        assert_equal(listed["annotatedCount"], 1, "annotation count")
        assert_equal(listed["records"][0]["merchantId"], "202", "priority merchant sorts first")
        assert_equal(listed["records"][0]["isPriority"], True, "priority merge")
        assert_equal(listed["records"][0]["gmvMonthlyTarget"], 50000.0, "annotation GMV")
        alpha = next(row for row in listed["records"] if row["merchantId"] == "101")
        assert_equal(alpha["gmvMonthlyTarget"], 12000.0, "legacy GMV compatibility")
        assert_equal(alpha["sourceLinked"], True, "backend source linkage")
        assert_equal(alpha["addedAt"], "2026-08-04T09:30:00", "full backend added time")
        assert_equal(
            listed["annotationSource"],
            "cnpscy_oi_monthly_new_merchant_annotations",
            "annotation source",
        )

        active_connection = FakeConnection()
        offer_db.fetch_all = original_fetch_all
        offer_db._monthly_new_merchant_source_rows = lambda _conn, month, merchant_id=None: (
            [{
                "reportMonth": "2026-08",
                "merchantId": "398751",
                "merchantName": "August Merchant",
                "businessManager": "Fiona",
                "sourceAddedAt": dt.datetime(2026, 8, 4, 10, 0),
            }],
            {"sourceDateColumn": "advert_addtime", "sourceBdColumn": "advert_bd"},
        )
        annotation_responses = [None, annotation]

        def fake_annotation_record(_conn, _month, _merchant_id):
            return annotation_responses.pop(0)

        offer_db._monthly_new_merchant_annotation_record = fake_annotation_record
        created = offer_db.upsert_monthly_new_merchant(BASE_PAYLOAD, updated_by="admin")
        assert_equal(created["ok"], True, "annotation create result")
        assert_equal(created["action"], "created", "annotation create action")
        assert_equal(active_connection.begun, True, "annotation transaction begun")
        assert_equal(active_connection.committed, True, "annotation transaction committed")
        insert_sql, insert_params = next(
            item
            for item in active_connection.executed
            if "INSERT INTO cnpscy_oi_monthly_new_merchant_annotations" in item[0]
        )
        assert "ON DUPLICATE KEY UPDATE" in insert_sql
        assert_equal(insert_params[0], "2026-08", "stored report month")
        assert_equal(insert_params[1], "398751", "stored merchant link")
        assert_equal(insert_params[5], 1, "stored priority")
        assert_equal(insert_params[6], Decimal("125000.50"), "stored GMV target")
        assert_equal(insert_params[7], BASE_PAYLOAD["completionReward"], "stored reward")

        active_connection = FakeConnection()
        offer_db._monthly_new_merchant_source_rows = lambda _conn, month, merchant_id=None: (
            [],
            {"sourceDateColumn": "advert_addtime", "sourceBdColumn": "advert_bd"},
        )
        offer_db.fetch_one = lambda _conn, _sql, _params=(): None
        missing = offer_db.upsert_monthly_new_merchant(BASE_PAYLOAD, updated_by="admin")
        assert_equal(missing["code"], "merchant_not_found", "unlinked merchant rejection")
        assert_equal(active_connection.begun, False, "missing merchant does not start a write")

        print("Monthly new merchant source and annotation checks passed")
    finally:
        offer_db.db_connection = original_db_connection
        offer_db.fetch_all = original_fetch_all
        offer_db.fetch_one = original_fetch_one
        offer_db._monthly_new_merchant_source_rows = original_source_rows
        offer_db._monthly_new_merchant_annotation_record = original_annotation_record
        offer_db._monthly_new_merchants_schema_ready = original_schema_ready


if __name__ == "__main__":
    main()
