from contextlib import contextmanager
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import offer_db


class FakeCursor:
    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=()):
        self.connection.executed.append((sql, params))
        if self.connection.fail_on_history and "cnpscy_oi_tier_move_history" in sql:
            raise RuntimeError("history write failed")


class FakeConnection:
    def __init__(self, fail_on_history=False):
        self.begun = False
        self.committed = False
        self.rolled_back = False
        self.executed = []
        self.fail_on_history = fail_on_history

    def begin(self):
        self.begun = True

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def cursor(self):
        return FakeCursor(self)


@contextmanager
def fake_db_connection(connection):
    yield connection


def assert_equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def main():
    original_db_connection = offer_db.db_connection
    original_fetch_all = offer_db.fetch_all
    original_fetch_one = offer_db.fetch_one
    try:
        connection = FakeConnection()
        captured = {}
        offer_db.db_connection = lambda: fake_db_connection(connection)

        def fake_fetch_all(conn, sql, params=()):
            captured["sql"] = sql
            captured["params"] = params
            return [{
                "merchantId": "384776",
                "merchantName": "HOMMPA",
                "network": "amazon",
                "currentTier": "Tier 2",
                "category": "Patio, Lawn & Garden",
                "country": "US",
            }]

        offer_db.fetch_all = fake_fetch_all
        search = offer_db.tier1_merchant_search_payload("384776", limit=8)
        assert_equal(search["results"][0]["currentTier"], "Tier 2", "search current tier")
        if "a.advert_isdel = 1" not in captured["sql"]:
            raise AssertionError("Tier 1 search must exclude inactive merchants")
        assert_equal(captured["params"], ("384776", "%384776%", "384776", "384776"), "search parameters")

        offer_db.tier1_additions_payload(limit=25)
        if "FROM cnpscy_oi_tier_move_history" not in captured["sql"]:
            raise AssertionError("Tier 1 additions must read the immutable movement history")
        if "source = %s" not in captured["sql"]:
            raise AssertionError("Tier 1 additions must filter by management source")
        if "MAX(eventId)" not in captured["sql"]:
            raise AssertionError("Tier 1 additions must select the latest record per merchant")
        assert_equal(
            captured["params"],
            (offer_db.TIER1_NAME, offer_db.TIER1_MANUAL_SOURCE),
            "additions source parameters",
        )

        for source_tier in ("Tier 2", "Tier 3", "Tier 4"):
            connection = FakeConnection()
            offer_db.db_connection = lambda: fake_db_connection(connection)
            fetch_rows = iter([
                {"merchantId": "384776", "merchantName": "HOMMPA", "network": "amazon"},
                {"merchantId": "384776", "tier": source_tier},
            ])
            offer_db.fetch_one = lambda conn, sql, params=(): next(fetch_rows)
            added = offer_db.add_merchant_to_tier1("384776", "admin", expected_tier=source_tier)
            assert_equal(added["ok"], True, f"successful migration from {source_tier}")
            assert_equal(added["merchant"]["previousTier"], source_tier, "previous tier provenance")
            assert_equal(added["migration"]["sourceTier"], source_tier, "migration source tier")
            assert_equal(added["migration"]["targetTier"], "Tier 1", "migration target tier")
            assert_equal(connection.begun, True, "transaction started")
            assert_equal(connection.committed, True, "transaction committed")
            if connection.rolled_back:
                raise AssertionError("successful migration must not roll back")
            assert_equal(len(connection.executed), 2, "assignment and history writes")
            assignment_sql, assignment_params = connection.executed[0]
            history_sql, history_params = connection.executed[1]
            if "cnpscy_oi_tier_assignments" not in assignment_sql:
                raise AssertionError("first write must update the current assignment")
            if "cnpscy_oi_tier_move_history" not in history_sql:
                raise AssertionError("second write must append immutable history")
            assert_equal(assignment_params[1], "Tier 1", "target tier")
            assert_equal(assignment_params[2], offer_db.TIER1_MANUAL_SOURCE, "manual source")
            assert_equal(assignment_params[3], source_tier, "stored previous tier")
            assert_equal(history_params[2], source_tier, "history source tier")
            assert_equal(history_params[3], "Tier 1", "history target tier")
            assert_equal(history_params[4], offer_db.TIER1_MANUAL_SOURCE, "history source")

        connection = FakeConnection(fail_on_history=True)
        offer_db.db_connection = lambda: fake_db_connection(connection)
        fetch_rows = iter([
            {"merchantId": "384776", "merchantName": "HOMMPA", "network": "amazon"},
            {"merchantId": "384776", "tier": "Tier 4"},
        ])
        offer_db.fetch_one = lambda conn, sql, params=(): next(fetch_rows)
        try:
            offer_db.add_merchant_to_tier1("384776", "admin", expected_tier="Tier 4")
            raise AssertionError("history failure should propagate")
        except RuntimeError as error:
            assert_equal(str(error), "history write failed", "history write error")
        assert_equal(connection.committed, False, "history failure must not commit assignment")
        assert_equal(connection.rolled_back, True, "history failure rolls back assignment")

        connection = FakeConnection()
        offer_db.db_connection = lambda: fake_db_connection(connection)
        fetch_rows = iter([
            {"merchantId": "384776", "merchantName": "HOMMPA", "network": "amazon"},
            {"merchantId": "384776", "tier": "Tier 3"},
        ])
        offer_db.fetch_one = lambda conn, sql, params=(): next(fetch_rows)
        conflict = offer_db.add_merchant_to_tier1("384776", "admin", expected_tier="Tier 2")
        assert_equal(conflict["code"], "tier_changed", "stale confirmation conflict")
        assert_equal(connection.rolled_back, True, "conflict rolled back")
        assert_equal(len(connection.executed), 0, "conflict must not write")

        connection = FakeConnection()
        offer_db.db_connection = lambda: fake_db_connection(connection)
        fetch_rows = iter([
            {"merchantId": "384776", "merchantName": "HOMMPA", "network": "amazon"},
            {"merchantId": "384776", "tier": "Tier 1"},
        ])
        offer_db.fetch_one = lambda conn, sql, params=(): next(fetch_rows)
        duplicate = offer_db.add_merchant_to_tier1("384776", "admin", expected_tier="Tier 1")
        assert_equal(duplicate["code"], "already_tier1", "duplicate Tier 1 guard")
        assert_equal(connection.rolled_back, True, "duplicate rolled back")

        print("Tier 1 merchant management checks passed")
    finally:
        offer_db.db_connection = original_db_connection
        offer_db.fetch_all = original_fetch_all
        offer_db.fetch_one = original_fetch_one


if __name__ == "__main__":
    main()
