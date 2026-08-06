from __future__ import annotations

from contextlib import contextmanager
import datetime as dt
import json
from pathlib import Path
import sys
import uuid


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from chatbot_question_logs import (
    CHATBOT_QUESTION_LOGS_TABLE_DDL,
    QuestionLogConflictError,
    QuestionLogNotFoundError,
    QuestionLogValidationError,
    complete_question_log,
    create_question_log,
    fetch_question_logs,
    render_question_log_export,
)


SESSION_ID = "550e8400-e29b-41d4-a716-446655440000"


def assert_equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


class FakeCursor:
    def __init__(self, connection):
        self.connection = connection
        self.rowcount = 0
        self._one = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=()):
        self.connection.executed.append((sql, params))
        normalized = " ".join(str(sql).split()).upper()
        if normalized.startswith("INSERT INTO"):
            self.rowcount = 0 if self.connection.one_row else 1
        elif normalized.startswith("UPDATE"):
            self.rowcount = self.connection.update_rowcount
        elif "WHERE EVENTID = %S" in normalized:
            self._one = self.connection.one_row
        elif normalized.startswith("SELECT"):
            self._one = self.connection.one_row

    def fetchone(self):
        return self._one

    def fetchall(self):
        return list(self.connection.rows)


class FakeConnection:
    def __init__(self, *, rows=None, one_row=None, update_rowcount=1):
        self.executed = []
        self.rows = list(rows or [])
        self.one_row = one_row
        self.update_rowcount = update_rowcount
        self.committed = False
        self.rolled_back = False
        self.began = False

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.committed = True

    def begin(self):
        self.began = True

    def rollback(self):
        self.rolled_back = True


def connection_factory(connection):
    @contextmanager
    def factory():
        yield connection

    return factory


def expect_validation_error(payload, operation, label):
    try:
        operation(payload, connection_factory(FakeConnection()))
    except QuestionLogValidationError:
        return
    raise AssertionError(f"invalid payload accepted: {label}")


def sample_create_payload(**overrides):
    payload = {
        "prompt": "推荐五个 Beauty offer",
        "mode": "report",
        "sessionId": SESSION_ID,
        "language": "zh",
        "intent": "recommendation",
    }
    payload.update(overrides)
    return payload


def sample_row(**overrides):
    row = {
        "recordId": 2,
        "eventId": "fbe8f58d-a61a-4ec9-9882-da09405bdb73",
        "anonymousSessionId": SESSION_ID,
        "mode": "report",
        "prompt": "推荐五个 Beauty offer",
        "language": "zh",
        "intent": "recommendation",
        "status": "success",
        "submittedAt": dt.datetime(2026, 8, 6, 3, 4, 5, 123456),
        "completedAt": dt.datetime(2026, 8, 6, 3, 4, 7, 654321),
        "updatedAt": dt.datetime(2026, 8, 6, 3, 4, 7, 654321),
    }
    row.update(overrides)
    return row


def main():
    ddl = CHATBOT_QUESTION_LOGS_TABLE_DDL
    assert "CREATE TABLE IF NOT EXISTS cnpscy_oi_chatbot_question_logs" in ddl
    assert "UNIQUE KEY uq_chatbot_question_event (eventId)" in ddl
    assert "idx_chatbot_question_mode" in ddl
    assert "idx_chatbot_question_session" in ddl
    assert "idx_chatbot_question_intent" in ddl
    assert "DEFAULT CHARSET=utf8mb4" in ddl

    create_connection = FakeConnection()
    created = create_question_log(
        sample_create_payload(),
        connection_factory(create_connection),
    )
    assert_equal(created["ok"], True, "create ok")
    assert_equal(created["status"], "submitted", "create status")
    uuid.UUID(created["recordId"])
    assert_equal(create_connection.committed, True, "create commit")
    insert_sql, insert_params = create_connection.executed[-1]
    assert "INSERT INTO cnpscy_oi_chatbot_question_logs" in insert_sql
    assert "%s" in insert_sql
    assert "推荐五个 Beauty offer" in insert_params
    assert "report" in insert_params

    duplicate_connection = FakeConnection()
    first = create_question_log(sample_create_payload(), connection_factory(duplicate_connection))
    second = create_question_log(sample_create_payload(), connection_factory(duplicate_connection))
    assert first["recordId"] != second["recordId"], "duplicate prompts need independent UUIDs"
    duplicate_inserts = [sql for sql, _ in duplicate_connection.executed if "INSERT INTO" in sql]
    assert_equal(len(duplicate_inserts), 2, "duplicate INSERT count")

    supplied_event_id = "1df97e37-c023-424d-bf69-85d5a0ca59a3"
    supplied_connection = FakeConnection()
    supplied = create_question_log(
        sample_create_payload(eventId=supplied_event_id),
        connection_factory(supplied_connection),
    )
    assert_equal(supplied["recordId"], supplied_event_id, "browser supplied event ID")
    assert_equal(supplied_connection.began, True, "supplied UUID transaction")
    supplied_insert_sql = next(sql for sql, _ in supplied_connection.executed if "INSERT INTO" in sql)
    assert "ON DUPLICATE KEY UPDATE" in supplied_insert_sql

    existing_row = {
        "eventId": supplied_event_id,
        "anonymousSessionId": SESSION_ID,
        "mode": "report",
        "prompt": "推荐五个 Beauty offer",
        "language": "zh",
        "intent": "recommendation",
        "status": "submitted",
    }
    retry_connection = FakeConnection(one_row=existing_row)
    retried = create_question_log(
        sample_create_payload(eventId=supplied_event_id),
        connection_factory(retry_connection),
    )
    assert_equal(retried["recordId"], supplied_event_id, "idempotent retry event ID")
    retry_inserts = [sql for sql, _ in retry_connection.executed if "INSERT INTO" in sql]
    assert_equal(len(retry_inserts), 1, "idempotent retry atomic INSERT count")
    assert "ON DUPLICATE KEY UPDATE" in retry_inserts[0]

    conflict_connection = FakeConnection(one_row=existing_row)
    try:
        create_question_log(
            sample_create_payload(eventId=supplied_event_id, mode="chat"),
            connection_factory(conflict_connection),
        )
    except QuestionLogConflictError:
        pass
    else:
        raise AssertionError("same event ID with different payload should conflict")

    invalid_create_payloads = [
        (sample_create_payload(prompt=" "), "empty prompt"),
        (sample_create_payload(prompt="你" * 6000), "prompt over UTF-8 byte limit"),
        (sample_create_payload(mode="fast"), "invalid mode"),
        (sample_create_payload(sessionId="short"), "invalid session"),
        (sample_create_payload(language="fr"), "invalid language"),
        (sample_create_payload(intent="Not Valid"), "invalid intent"),
        (sample_create_payload(eventId="bad"), "invalid optional event ID"),
    ]
    for payload, label in invalid_create_payloads:
        expect_validation_error(payload, create_question_log, label)

    completion_connection = FakeConnection(update_rowcount=1)
    completed = complete_question_log(
        {
            "recordId": created["recordId"],
            "sessionId": SESSION_ID,
            "status": "success",
            "intent": "recommendation",
        },
        connection_factory(completion_connection),
    )
    assert_equal(completed["status"], "success", "complete status")
    update_sql, update_params = completion_connection.executed[0]
    normalized_update = " ".join(update_sql.split())
    assert "eventId = %s" in normalized_update
    assert "anonymousSessionId = %s" in normalized_update
    assert "status = 'submitted'" in normalized_update
    assert created["recordId"] in update_params
    assert SESSION_ID in update_params

    invalid_complete_payloads = [
        ({"recordId": "bad", "sessionId": SESSION_ID, "status": "success"}, "invalid UUID"),
        ({"recordId": created["recordId"], "sessionId": "short", "status": "success"}, "invalid complete session"),
        ({"recordId": created["recordId"], "sessionId": SESSION_ID, "status": "submitted"}, "invalid final status"),
    ]
    for payload, label in invalid_complete_payloads:
        expect_validation_error(payload, complete_question_log, label)

    idempotent_connection = FakeConnection(
        update_rowcount=0,
        one_row={"eventId": created["recordId"], "status": "success"},
    )
    idempotent = complete_question_log(
        {"recordId": created["recordId"], "sessionId": SESSION_ID, "status": "success"},
        connection_factory(idempotent_connection),
    )
    assert_equal(idempotent["status"], "success", "idempotent complete")

    try:
        complete_question_log(
            {"recordId": created["recordId"], "sessionId": SESSION_ID, "status": "failed"},
            connection_factory(FakeConnection(update_rowcount=0, one_row=None)),
        )
    except QuestionLogNotFoundError:
        pass
    else:
        raise AssertionError("missing question record should raise QuestionLogNotFoundError")

    rows = [sample_row(), sample_row(recordId=1, eventId=str(uuid.uuid4()), mode="chat")]
    fetch_connection = FakeConnection(rows=rows)
    fetched = fetch_question_logs(connection_factory(fetch_connection))
    assert_equal(fetched, rows, "fetched rows")
    fetch_sql = fetch_connection.executed[0][0]
    assert "ORDER BY submittedAt DESC, recordId DESC" in " ".join(fetch_sql.split())

    empty_csv, csv_type, csv_name = render_question_log_export([], "csv", dt.date(2026, 8, 6))
    assert empty_csv.startswith(b"\xef\xbb\xbf"), "CSV should start with UTF-8 BOM"
    assert "eventId,submittedAt,completedAt,mode,prompt,anonymousSessionId,language,intent,status" in empty_csv.decode("utf-8-sig")
    assert_equal(csv_type, "text/csv; charset=utf-8", "CSV content type")
    assert_equal(csv_name, "chatbot-questions-2026-08-06.csv", "CSV filename")

    empty_jsonl, jsonl_type, jsonl_name = render_question_log_export([], "jsonl", dt.date(2026, 8, 6))
    assert_equal(empty_jsonl, b"", "empty JSONL")
    assert_equal(jsonl_type, "application/x-ndjson; charset=utf-8", "JSONL content type")
    assert_equal(jsonl_name, "chatbot-questions-2026-08-06.jsonl", "JSONL filename")

    export_rows = [
        sample_row(prompt="推荐五个 Beauty offer"),
        sample_row(recordId=1, eventId=str(uuid.uuid4()), prompt="  =1+1", mode="chat", status="failed"),
    ]
    csv_body, _, _ = render_question_log_export(export_rows, "csv", dt.date(2026, 8, 6))
    csv_text = csv_body.decode("utf-8-sig")
    assert "推荐五个 Beauty offer" in csv_text
    assert "'  =1+1" in csv_text or "  '=1+1" in csv_text
    assert "2026-08-06T03:04:05.123456Z" in csv_text

    jsonl_body, _, _ = render_question_log_export(export_rows, "jsonl", dt.date(2026, 8, 6))
    jsonl_rows = [json.loads(line) for line in jsonl_body.decode("utf-8").splitlines()]
    assert_equal(jsonl_rows[0]["prompt"], "推荐五个 Beauty offer", "JSONL Chinese prompt")
    assert_equal(jsonl_rows[1]["prompt"], "  =1+1", "JSONL raw formula prompt")
    forbidden = {"answer", "response", "username", "ip", "userAgent", "cookie"}
    assert forbidden.isdisjoint(jsonl_rows[0]), "export should not include private or response fields"

    try:
        render_question_log_export([], "xlsx")
    except QuestionLogValidationError:
        pass
    else:
        raise AssertionError("unsupported export format should be rejected")

    schema_script = (ROOT / "scripts" / "ensure_oi_schema.py").read_text(encoding="utf-8")
    assert "CHATBOT_QUESTION_LOGS_TABLE_DDL" in schema_script
    assert 'table_exists(conn, "cnpscy_oi_chatbot_question_logs")' in schema_script
    assert "cur.execute(CHATBOT_QUESTION_LOGS_TABLE_DDL)" in schema_script

    base_contract = (ROOT / "docs" / "offer-db-reporting-contract.sql").read_text(encoding="utf-8")
    production_contract = (ROOT / "docs" / "offer-db-reporting-contract-adjusted.sql").read_text(encoding="utf-8")
    assert "CREATE TABLE IF NOT EXISTS oi_chatbot_question_logs" in base_contract
    assert "CREATE TABLE IF NOT EXISTS cnpscy_oi_chatbot_question_logs" in production_contract
    for contract in (base_contract, production_contract):
        assert "anonymousSessionId" in contract
        assert "idx_chatbot_question_mode" in contract
        assert "idx_chatbot_question_session" in contract
        assert "idx_chatbot_question_intent" in contract

    print("PASS: chatbot question log domain and export tests")


if __name__ == "__main__":
    main()
