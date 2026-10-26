"""Exercise registry transactions against a real persistent SQLite test database.

Only MySQL dialect/DDL and advisory locks are adapted; matching, migration,
upsert, deletion, rollback and tier synchronization run their production code.
Run: python -m unittest discover -s scripts -p test_merchant_registry.py -v
"""
from contextlib import contextmanager
import json
from pathlib import Path
import re
import sqlite3
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import merchant_registry as registry
import offer_db as db

MUTEX = threading.RLock()


class Cursor:
    def __init__(self, conn):
        self.conn = conn
        self.raw = conn.raw.cursor()
        self.synthetic = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.raw.close()

    @property
    def lastrowid(self):
        return self.raw.lastrowid

    def execute(self, sql, params=()):
        if "GET_LOCK" in sql:
            MUTEX.acquire()
            self.synthetic = [{"acquired": 1}]
            return
        if "RELEASE_LOCK" in sql:
            MUTEX.release()
            self.synthetic = [{"released": 1}]
            return
        if sql.startswith("CREATE TABLE"):
            return  # Equivalent SQLite tables are created once by the fixture.
        sql = sql.replace("%s", "?").replace("UTC_TIMESTAMP()", "strftime('%Y-%m-%d %H:%M:%f','now')")
        sql = sql.replace("ON DUPLICATE KEY UPDATE", "ON CONFLICT(merchantId) DO UPDATE SET")
        sql = re.sub(r"VALUES\((\w+)\)", r"excluded.\1", sql)
        self.raw.execute(sql, params)

    def fetchone(self):
        if self.synthetic is not None:
            return self.synthetic[0]
        row = self.raw.fetchone()
        return dict(row) if row else None

    def fetchall(self):
        return self.synthetic if self.synthetic is not None else [dict(row) for row in self.raw.fetchall()]


class Connection:
    def __init__(self, path):
        self.raw = sqlite3.connect(path, isolation_level=None, timeout=10)
        self.raw.row_factory = sqlite3.Row

    def cursor(self):
        return Cursor(self)

    def begin(self):
        self.raw.execute("BEGIN")

    def commit(self):
        self.raw.commit()

    def rollback(self):
        self.raw.rollback()

    def close(self):
        self.raw.close()


class RegistryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "registry.sqlite"
        c = sqlite3.connect(self.path)
        c.executescript(f"""
            CREATE TABLE {registry.TABLE} (
                recordId INTEGER PRIMARY KEY AUTOINCREMENT, identityKey TEXT UNIQUE,
                merchantId TEXT, merchantName TEXT, nameKey TEXT, platform TEXT,
                profile TEXT, isDeleted INTEGER DEFAULT 0, createdBy TEXT, updatedBy TEXT,
                createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE {registry.META_TABLE} (migrationKey TEXT PRIMARY KEY);
            CREATE TABLE cnpscy_oi_monthly_new_merchants (
                recordId INTEGER PRIMARY KEY, reportMonth TEXT, merchantId TEXT,
                merchantName TEXT, platform TEXT, notes TEXT, updatedAt TEXT);
            CREATE TABLE cnpscy_oi_tier_assignments (
                merchantId TEXT PRIMARY KEY, tier TEXT, source TEXT,
                movedFromTier TEXT, movedAt TEXT, updatedBy TEXT);
            CREATE TABLE cnpscy_oi_tier_move_history (
                merchantId TEXT, merchantName TEXT, sourceTier TEXT, targetTier TEXT,
                source TEXT, movedAt TEXT, movedBy TEXT);
        """)
        c.close()
        registry._ready = False

        @contextmanager
        def connection():
            conn = Connection(self.path)
            try:
                yield conn
            finally:
                conn.close()

        self.patches = [patch.object(db, "db_connection", connection),
                        patch.object(db, "ensure_monthly_new_merchants_schema", lambda c: None)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        registry._ready = False
        self.tmp.cleanup()

    def save(self, **values):
        return registry.upsert(values, updated_by="test")

    def sql(self, statement, params=()):
        with sqlite3.connect(self.path) as c:
            return c.execute(statement, params).fetchall()

    def test_seed_all_sheets_and_direct_only_with_conflict_retained(self):
        result = registry.payload("2026-10")
        self.assertEqual(result["scope"], "permanent")
        self.assertEqual(result["count"], 47)
        by_name = {r["merchantName"]: r for r in result["records"]}
        self.assertEqual(by_name["Bosidin"]["merchantId"], "")
        self.assertEqual(by_name["Bosidin"]["sourceMerchantId"], "406505")
        self.assertIn("Koalu", by_name["Bosidin"]["identityWarning"])
        self.assertEqual(by_name["Nulas"]["contactName"], "Jerry Huang")
        self.assertEqual(by_name["百拓"]["category"], "大件家具")
        self.assertEqual(by_name["Maxgroom"]["onboardingDate"], "26.09.29")
        self.assertEqual(by_name["Sportsroyal"]["sourceMerchantId"], "us未接入")
        self.assertEqual(by_name["ZDEER"]["merchantId"], "402512/402770")
        direct = self.sql("SELECT merchantId FROM cnpscy_oi_tier_assignments WHERE tier='Tier 1'")
        self.assertEqual(len(direct), 18)
        self.assertEqual(len([r for r in result["records"] if registry.is_direct(r)]), 19)
        self.assertEqual(registry.payload("2030-01")["records"], result["records"])

    def test_repeated_upload_merges_nonempty_fields_across_months(self):
        self.save(merchantId="999901", merchantName="New merchant", reportMonth="2026-10", notes="Keep", platform=" direct ")
        count = registry.payload()["count"]
        first = self.save(merchantId="999901", merchantName="New merchant", reportMonth="2026-11", contactName="Owner", notes="", mergeOnly=True)
        self.assertEqual(first["action"], "updated")
        self.assertEqual(first["record"]["notes"], "Keep")
        self.assertEqual(first["record"]["platform"], "direct")
        self.assertEqual(first["record"]["reportMonth"], "2026-10")
        self.assertEqual(registry.payload()["count"], count)
        self.assertEqual(self.sql("SELECT tier FROM cnpscy_oi_tier_assignments WHERE merchantId='999901'"), [("Tier 1",)])

    def test_same_brand_different_ids_stay_separate_and_reimport_is_idempotent(self):
        initial = registry.payload()["count"]
        for mid in ("999901", "999902", "999901", "999902"):
            self.save(merchantId=mid, merchantName="A shared brand")
        self.assertEqual(registry.payload()["count"], initial + 2)
        with self.assertRaisesRegex(ValueError, "Multiple merchants"):
            self.save(merchantName="A shared brand", notes="Ambiguous")

    def test_uploaded_zero_values_replace_previous_numeric_values(self):
        self.save(merchantId="999901", merchantName="Zero target", gmvMonthlyTarget=500,
                  ourCommission=10, presetCommission=15)
        result = self.save(merchantId="999901", merchantName="Zero target", gmvMonthlyTarget=0,
                           ourCommission=0, presetCommission=0, mergeOnly=True)["record"]
        self.assertEqual(result["gmvMonthlyTarget"], 0)
        self.assertEqual(result["ourCommission"], 0)
        self.assertEqual(result["presetCommission"], 0)

    def test_preprovisioned_tables_do_not_require_create_permission(self):
        original = Cursor.execute
        def no_create(cursor, sql, params=()):
            if sql.startswith("CREATE TABLE"):
                raise RuntimeError(1142, "CREATE denied")
            return original(cursor, sql, params)
        with patch.object(Cursor, "execute", no_create):
            self.assertEqual(registry.payload()["count"], 47)

    def test_missing_table_without_create_permission_has_setup_error(self):
        with patch.object(db, "fetch_one", side_effect=RuntimeError(1146, "Table missing")):
            with patch.object(Cursor, "execute", side_effect=RuntimeError(1142, "CREATE denied")):
                with db.db_connection() as conn:
                    with self.assertRaisesRegex(registry.RegistrySchemaUnavailable, "merchant-registry-schema.sql"):
                        registry.ensure_registry_table(conn, registry.TABLE, registry.DDL)

    def test_missing_select_grant_has_setup_error(self):
        with patch.object(db, "fetch_one", side_effect=RuntimeError(1142, "SELECT denied")):
            with db.db_connection() as conn:
                with self.assertRaisesRegex(registry.RegistrySchemaUnavailable, "grant SELECT"):
                    registry.ensure_registry_table(conn, registry.TABLE, registry.DDL)

    def test_only_setup_errors_allow_existing_reports_to_continue(self):
        with patch.object(registry, "snapshot", side_effect=registry.RegistrySchemaUnavailable("Setup pending")):
            self.assertEqual(registry.report_snapshot(), ([], "pending-schema"))
            with self.assertRaises(registry.RegistrySchemaUnavailable):
                registry.payload()
        with patch.object(registry, "snapshot", side_effect=RuntimeError("Unexpected write failure")):
            with self.assertRaisesRegex(RuntimeError, "Unexpected write failure"):
                registry.report_snapshot()

    def test_conflicting_id_survives_reimport_without_changing_original(self):
        first = self.save(merchantId="999901", merchantName="Alpha", platform="Direct")["record"]
        second = self.save(merchantId="999901", merchantName="Beta", platform="Direct")["record"]
        again = self.save(merchantId="999901", merchantName="Beta", platform="Direct")["record"]
        self.assertEqual(second["recordId"], again["recordId"])
        self.assertEqual(second["merchantId"], "")
        self.assertTrue(second["identityWarning"])
        corrected = self.save(**{**second, "merchantId": "999902"})["record"]
        self.assertEqual(corrected["identityWarning"], "")
        self.assertTrue(corrected["tier1Eligible"])
        self.assertNotEqual(first["recordId"], corrected["recordId"])

    def test_multi_id_account_matches_individual_id_without_losing_link(self):
        first = self.save(merchantId="999901/999902", merchantName="Linked", platform="Direct")["record"]
        again = self.save(merchantId="999901", merchantName="Linked", notes="Again")["record"]
        self.assertEqual(first["recordId"], again["recordId"])
        self.assertEqual(again["merchantId"], "999901/999902")
        self.assertEqual(len(self.sql("SELECT tier FROM cnpscy_oi_tier_assignments WHERE merchantId IN ('999901','999902') AND tier='Tier 1'")), 2)

    def test_legacy_migration_and_seed_only_once_and_deletion_persists(self):
        self.sql("INSERT INTO cnpscy_oi_monthly_new_merchants VALUES (1,'2026-01','999901','Historic','impact','Old note','2026-01-01')")
        self.sql("INSERT INTO cnpscy_oi_monthly_new_merchants VALUES (2,'2026-02','999901','Historic','impact','','2026-02-01')")
        result = registry.payload()
        historic = next(r for r in result["records"] if r["merchantId"] == "999901")
        self.assertEqual(historic["notes"], "Old note")
        self.assertEqual(result["count"], 48)
        ucin = next(r for r in result["records"] if r["merchantName"] == "UCIN")
        registry.delete(ucin["recordId"], deleted_by="test")
        registry._ready = False  # Simulate cold start on another serverless instance.
        self.assertEqual(registry.payload()["count"], 47)
        self.assertNotIn(("407021",), self.sql("SELECT merchantId FROM cnpscy_oi_tier_assignments WHERE tier='Tier 1'"))

    def test_tier_correction_restores_previous_tier_and_leaves_other_tiers(self):
        self.sql("INSERT INTO cnpscy_oi_tier_assignments (merchantId,tier) VALUES ('999901','Tier 2')")
        self.sql("INSERT INTO cnpscy_oi_tier_assignments (merchantId,tier) VALUES ('999902','BLACK TIER')")
        result = self.save(merchantId="999901", merchantName="Changed", platform="DIRECT")["record"]
        self.assertEqual(self.sql("SELECT tier FROM cnpscy_oi_tier_assignments WHERE merchantId='999901'"), [("Tier 1",)])
        self.save(**{**result, "platform": "impact"})
        self.assertEqual(self.sql("SELECT tier FROM cnpscy_oi_tier_assignments WHERE merchantId='999901'"), [("Tier 2",)])
        self.assertEqual(self.sql("SELECT tier FROM cnpscy_oi_tier_assignments WHERE merchantId='999902'"), [("BLACK TIER",)])

    def test_profile_and_tier_write_rollback_together(self):
        registry.payload()
        with patch.object(registry, "sync_tiers", side_effect=RuntimeError("Tier write failed")):
            with self.assertRaisesRegex(RuntimeError, "Tier write failed"):
                self.save(merchantId="999901", merchantName="Rollback", platform="Direct")
        self.assertEqual(self.sql(f"SELECT recordId FROM {registry.TABLE} WHERE merchantId='999901'"), [])

    def test_parallel_duplicate_uploads_create_one_profile(self):
        registry.payload()
        errors = []
        def upload():
            try:
                self.save(merchantId="999901", merchantName="Concurrent", platform="Direct")
            except Exception as error:
                errors.append(error)
        threads = [threading.Thread(target=upload) for _ in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(errors, [])
        self.assertEqual(len(self.sql(f"SELECT recordId FROM {registry.TABLE} WHERE merchantId='999901'")), 1)


if __name__ == "__main__":
    unittest.main()
