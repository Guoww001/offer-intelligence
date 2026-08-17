from __future__ import annotations

from contextlib import contextmanager
import datetime as dt
import json
from pathlib import Path
import sys
import uuid


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from chatbot_answer_feedback import (
    CHATBOT_ANSWER_FEEDBACK_TABLE_DDL,
    AnswerFeedbackConflictError,
    AnswerFeedbackNotFoundError,
    AnswerFeedbackValidationError,
    create_answer_feedback,
    fetch_answer_feedback,
    render_answer_feedback_export,
)


SESSION_ID = "550e8400-e29b-41d4-a716-446655440000"
QUESTION_ID = "fbe8f58d-a61a-4ec9-9882-da09405bdb73"
FEEDBACK_ID = "63b496be-1aa8-4ec0-bcc3-28a823aff76d"


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
        if "FROM CNPSCY_OI_CHATBOT_QUESTION_LOGS" in normalized:
            self._one = self.connection.question_row
        elif "FROM CNPSCY_OI_CHATBOT_ANSWER_FEEDBACK" in normalized and "WHERE" in normalized:
            self._one = self.connection.feedback_row
        elif normalized.startswith("INSERT INTO"):
            self.rowcount = 1

    def fetchone(self):
        return self._one

    def fetchall(self):
        return list(self.connection.rows)


class FakeConnection:
    def __init__(self, *, question_row=None, feedback_row=None, rows=None):
        self.executed = []
        self.question_row = question_row
        self.feedback_row = feedback_row
        self.rows = list(rows or [])
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


def question_row(**overrides):
    row = {
        "eventId": QUESTION_ID,
        "anonymousSessionId": SESSION_ID,
        "mode": "chat",
        "prompt": "请推荐五个 Beauty offer",
        "status": "success",
    }
    row.update(overrides)
    return row


def sample_payload(**overrides):
    payload = {
        "feedbackEventId": FEEDBACK_ID,
        "questionEventId": QUESTION_ID,
        "sessionId": SESSION_ID,
        "mode": "chat",
        "prompt": "请推荐五个 Beauty offer",
        "answer": "这是回答。\n\n- 第一项",
        "language": "zh",
        "reasonCode": "inaccurate",
        "reasonDetail": "第二项的数据不对",
    }
    payload.update(overrides)
    return payload


def feedback_row(**overrides):
    row = {
        "feedbackId": 3,
        "feedbackEventId": FEEDBACK_ID,
        "questionEventId": QUESTION_ID,
        "anonymousSessionId": SESSION_ID,
        "mode": "chat",
        "prompt": "请推荐五个 Beauty offer",
        "answer": "这是回答。\n\n- 第一项",
        "answerTruncated": 0,
        "language": "zh",
        "reasonCode": "inaccurate",
        "reasonDetail": "第二项的数据不对",
        "submittedAt": dt.datetime(2026, 8, 6, 3, 4, 5, 123456),
    }
    row.update(overrides)
    return row


def expect_error(error_type, payload, connection, label):
    try:
        create_answer_feedback(payload, connection_factory(connection))
    except error_type:
        return
    raise AssertionError(f"expected {error_type.__name__}: {label}")


def main():
    ddl = CHATBOT_ANSWER_FEEDBACK_TABLE_DDL
    assert "CREATE TABLE IF NOT EXISTS cnpscy_oi_chatbot_answer_feedback" in ddl
    assert "UNIQUE KEY uq_chatbot_feedback_event (feedbackEventId)" in ddl
    assert "UNIQUE KEY uq_chatbot_feedback_question (questionEventId)" in ddl
    assert "FOREIGN KEY (questionEventId)" in ddl
    assert "idx_chatbot_feedback_mode" in ddl
    assert "idx_chatbot_feedback_reason" in ddl
    assert "idx_chatbot_feedback_session" in ddl
    assert "DEFAULT CHARSET=utf8mb4" in ddl

    connection = FakeConnection(question_row=question_row())
    result = create_answer_feedback(sample_payload(), connection_factory(connection))
    assert_equal(result["ok"], True, "create ok")
    assert_equal(result["feedbackEventId"], FEEDBACK_ID, "feedback event id")
    assert_equal(result["questionEventId"], QUESTION_ID, "question event id")
    assert_equal(connection.committed, True, "create commit")
    assert_equal(connection.began, True, "explicit transaction")
    assert "FOR UPDATE" in connection.executed[0][0]
    insert_sql, insert_params = connection.executed[-1]
    assert "INSERT INTO cnpscy_oi_chatbot_answer_feedback" in insert_sql
    assert "ON DUPLICATE KEY UPDATE" in insert_sql
    assert FEEDBACK_ID in insert_params
    assert QUESTION_ID in insert_params
    assert "inaccurate" in insert_params

    agent_connection = FakeConnection(question_row=question_row(mode="agent"))
    agent_result = create_answer_feedback(
        sample_payload(mode="agent"),
        connection_factory(agent_connection),
    )
    assert_equal(agent_result["ok"], True, "Agent feedback create ok")
    assert "agent" in agent_connection.executed[-1][1]

    idempotent_connection = FakeConnection(
        question_row=question_row(),
        feedback_row=feedback_row(),
    )
    idempotent = create_answer_feedback(sample_payload(), connection_factory(idempotent_connection))
    assert_equal(idempotent["feedbackEventId"], FEEDBACK_ID, "idempotent event")
    assert not any("INSERT INTO" in sql for sql, _ in idempotent_connection.executed)

    conflict_connection = FakeConnection(
        question_row=question_row(),
        feedback_row=feedback_row(feedbackEventId=str(uuid.uuid4())),
    )
    expect_error(AnswerFeedbackConflictError, sample_payload(), conflict_connection, "one feedback per answer")

    expect_error(
        AnswerFeedbackNotFoundError,
        sample_payload(),
        FakeConnection(question_row=None),
        "question must exist",
    )
    expect_error(
        AnswerFeedbackConflictError,
        sample_payload(mode="report"),
        FakeConnection(question_row=question_row()),
        "mode must match question",
    )
    expect_error(
        AnswerFeedbackConflictError,
        sample_payload(prompt="不同问题"),
        FakeConnection(question_row=question_row()),
        "prompt must match question",
    )

    invalid_payloads = [
        (sample_payload(feedbackEventId="bad"), "feedback UUID"),
        (sample_payload(questionEventId="bad"), "question UUID"),
        (sample_payload(sessionId="short"), "session UUID"),
        (sample_payload(mode="fast"), "mode"),
        (sample_payload(prompt=" "), "prompt"),
        (sample_payload(answer=" "), "answer"),
        (sample_payload(language="fr"), "language"),
        (sample_payload(reasonCode="slow"), "reason code"),
        (sample_payload(reasonDetail="详" * 5000), "reason detail byte limit"),
    ]
    for payload, label in invalid_payloads:
        expect_error(
            AnswerFeedbackValidationError,
            payload,
            FakeConnection(question_row=question_row()),
            label,
        )

    long_answer = "答" * 100000
    truncate_connection = FakeConnection(question_row=question_row())
    create_answer_feedback(
        sample_payload(answer=long_answer),
        connection_factory(truncate_connection),
    )
    truncate_params = truncate_connection.executed[-1][1]
    stored_answer = truncate_params[6]
    assert len(stored_answer.encode("utf-8")) <= 262144
    assert stored_answer.endswith("\n\n[回答因长度限制已截断]")
    assert_equal(truncate_params[7], 1, "answer truncated flag")

    rows = [feedback_row(), feedback_row(feedbackId=2, feedbackEventId=str(uuid.uuid4()))]
    fetch_connection = FakeConnection(rows=rows)
    fetched = fetch_answer_feedback(connection_factory(fetch_connection))
    assert_equal(fetched, rows, "fetched rows")
    assert "ORDER BY submittedAt DESC, feedbackId DESC" in " ".join(fetch_connection.executed[0][0].split())

    csv_body, csv_type, csv_name = render_answer_feedback_export(rows, "csv", dt.date(2026, 8, 6))
    assert csv_body.startswith(b"\xef\xbb\xbf")
    csv_text = csv_body.decode("utf-8-sig")
    assert "feedbackEventId,questionEventId,submittedAt,mode,prompt,answer,answerTruncated" in csv_text
    assert "回答不准确" in csv_text
    assert_equal(csv_type, "text/csv; charset=utf-8", "CSV type")
    assert_equal(csv_name, "chatbot-feedback-2026-08-06.csv", "CSV filename")

    jsonl_body, jsonl_type, jsonl_name = render_answer_feedback_export(rows, "jsonl", dt.date(2026, 8, 6))
    jsonl_rows = [json.loads(line) for line in jsonl_body.decode("utf-8").splitlines()]
    assert_equal(jsonl_rows[0]["reasonLabel"], "回答不准确", "reason label")
    assert_equal(jsonl_rows[0]["answer"], "这是回答。\n\n- 第一项", "answer snapshot")
    assert_equal(jsonl_type, "application/x-ndjson; charset=utf-8", "JSONL type")
    assert_equal(jsonl_name, "chatbot-feedback-2026-08-06.jsonl", "JSONL filename")

    try:
        render_answer_feedback_export([], "xlsx")
    except AnswerFeedbackValidationError:
        pass
    else:
        raise AssertionError("unsupported export format should be rejected")

    schema_script = (ROOT / "scripts" / "ensure_oi_schema.py").read_text(encoding="utf-8")
    assert "CHATBOT_ANSWER_FEEDBACK_TABLE_DDL" in schema_script
    assert 'table_exists(conn, "cnpscy_oi_chatbot_answer_feedback")' in schema_script
    assert "cur.execute(CHATBOT_ANSWER_FEEDBACK_TABLE_DDL)" in schema_script

    base_contract = (ROOT / "docs" / "offer-db-reporting-contract.sql").read_text(encoding="utf-8")
    production_contract = (ROOT / "docs" / "offer-db-reporting-contract-adjusted.sql").read_text(encoding="utf-8")
    assert "CREATE TABLE IF NOT EXISTS oi_chatbot_answer_feedback" in base_contract
    assert "CREATE TABLE IF NOT EXISTS cnpscy_oi_chatbot_answer_feedback" in production_contract
    for contract in (base_contract, production_contract):
        assert "uq_chatbot_feedback_question" in contract
        assert "answerTruncated" in contract
        assert "reasonCode" in contract
        assert "FOREIGN KEY (questionEventId)" in contract

    feature_report = (ROOT / "docs" / "chatbot-feature-report.md").read_text(encoding="utf-8")
    assert "cnpscy_oi_chatbot_answer_feedback" in feature_report
    assert "operation=feedback" in feature_report
    assert "不满意反馈" in feature_report

    print("PASS: chatbot answer feedback domain and export tests")


if __name__ == "__main__":
    main()
