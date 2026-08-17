from __future__ import annotations

import csv
import datetime as dt
import io
import json
import re
import uuid
from contextlib import AbstractContextManager
from typing import Any, Callable

from offer_db import db_connection


CHATBOT_QUESTION_LOGS_TABLE = "cnpscy_oi_chatbot_question_logs"
CHATBOT_QUESTION_LOGS_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS cnpscy_oi_chatbot_question_logs (
  recordId            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  eventId             CHAR(36) NOT NULL,
  anonymousSessionId  VARCHAR(64) NOT NULL,
  mode                VARCHAR(16) NOT NULL,
  prompt              TEXT NOT NULL,
  language            VARCHAR(8) NOT NULL,
  intent              VARCHAR(64) NOT NULL DEFAULT 'unknown',
  status              VARCHAR(16) NOT NULL DEFAULT 'submitted',
  submittedAt         DATETIME(6) NOT NULL,
  completedAt         DATETIME(6) DEFAULT NULL,
  updatedAt           DATETIME(6) NOT NULL,
  PRIMARY KEY (recordId),
  UNIQUE KEY uq_chatbot_question_event (eventId),
  KEY idx_chatbot_question_submitted (submittedAt, recordId),
  KEY idx_chatbot_question_mode (mode, submittedAt),
  KEY idx_chatbot_question_session (anonymousSessionId, submittedAt),
  KEY idx_chatbot_question_intent (intent, submittedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
""".strip()

MAX_PROMPT_BYTES = 16_384
SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
INTENT_RE = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
EXPORT_COLUMNS = (
    "eventId",
    "submittedAt",
    "completedAt",
    "mode",
    "prompt",
    "anonymousSessionId",
    "language",
    "intent",
    "status",
)

ConnectionFactory = Callable[[], AbstractContextManager[Any]]


class QuestionLogValidationError(ValueError):
    pass


class QuestionLogNotFoundError(LookupError):
    pass


class QuestionLogConflictError(RuntimeError):
    pass


def _utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)


def _clean_prompt(value: Any) -> str:
    prompt = str(value or "").strip()
    if not prompt:
        raise QuestionLogValidationError("prompt is required")
    if len(prompt.encode("utf-8")) > MAX_PROMPT_BYTES:
        raise QuestionLogValidationError("prompt is too large")
    return prompt


def _clean_mode(value: Any) -> str:
    mode = str(value or "").strip().lower()
    if mode not in {"report", "chat", "agent"}:
        raise QuestionLogValidationError("mode must be report, chat, or agent")
    return mode


def _clean_session_id(value: Any) -> str:
    session_id = str(value or "").strip()
    if not SESSION_ID_RE.fullmatch(session_id):
        raise QuestionLogValidationError("sessionId is invalid")
    return session_id


def _clean_language(value: Any) -> str:
    language = str(value or "en").strip().lower()
    if language not in {"en", "zh"}:
        raise QuestionLogValidationError("language must be en or zh")
    return language


def _clean_intent(value: Any) -> str:
    intent = str(value or "unknown").strip().lower() or "unknown"
    if not INTENT_RE.fullmatch(intent):
        raise QuestionLogValidationError("intent is invalid")
    return intent


def _clean_record_id(value: Any) -> str:
    try:
        return str(uuid.UUID(str(value or "").strip()))
    except (ValueError, TypeError, AttributeError) as exc:
        raise QuestionLogValidationError("recordId must be a UUID") from exc


def _clean_final_status(value: Any) -> str:
    status = str(value or "").strip().lower()
    if status not in {"success", "failed"}:
        raise QuestionLogValidationError("status must be success or failed")
    return status


def create_question_log(
    payload: dict[str, Any],
    connection_factory: ConnectionFactory = db_connection,
) -> dict[str, Any]:
    prompt = _clean_prompt(payload.get("prompt"))
    mode = _clean_mode(payload.get("mode"))
    session_id = _clean_session_id(payload.get("sessionId"))
    language = _clean_language(payload.get("language"))
    intent = _clean_intent(payload.get("intent"))
    supplied_event_id = payload.get("eventId") not in (None, "")
    event_id = (
        _clean_record_id(payload.get("eventId"))
        if supplied_event_id
        else str(uuid.uuid4())
    )
    now = _utc_now()

    with connection_factory() as conn:
        try:
            if supplied_event_id:
                if hasattr(conn, "begin"):
                    conn.begin()

            with conn.cursor() as cursor:
                duplicate_clause = (
                    "ON DUPLICATE KEY UPDATE eventId = cnpscy_oi_chatbot_question_logs.eventId"
                    if supplied_event_id
                    else ""
                )
                cursor.execute(
                    f"""
                    INSERT INTO cnpscy_oi_chatbot_question_logs
                        (
                            eventId,
                            anonymousSessionId,
                            mode,
                            prompt,
                            language,
                            intent,
                            status,
                            submittedAt,
                            completedAt,
                            updatedAt
                        )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    {duplicate_clause}
                    """,
                    (
                        event_id,
                        session_id,
                        mode,
                        prompt,
                        language,
                        intent,
                        "submitted",
                        now,
                        None,
                        now,
                    ),
                )
                inserted = int(cursor.rowcount or 0)

            if supplied_event_id and not inserted:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT
                            eventId,
                            anonymousSessionId,
                            mode,
                            prompt,
                            language,
                            intent,
                            status
                        FROM cnpscy_oi_chatbot_question_logs
                        WHERE eventId = %s
                        LIMIT 1
                        """,
                        (event_id,),
                    )
                    existing = cursor.fetchone()
                if not existing:
                    raise QuestionLogConflictError("eventId could not be resolved")
                if (
                    str(existing.get("anonymousSessionId") or "") != session_id
                    or str(existing.get("mode") or "").lower() != mode
                    or str(existing.get("prompt") or "").strip() != prompt
                    or str(existing.get("language") or "").lower() != language
                ):
                    raise QuestionLogConflictError(
                        "eventId already belongs to a different question"
                    )
                conn.commit()
                return {
                    "ok": True,
                    "recordId": event_id,
                    "status": str(existing.get("status") or "submitted"),
                }
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    return {"ok": True, "recordId": event_id, "status": "submitted"}


def complete_question_log(
    payload: dict[str, Any],
    connection_factory: ConnectionFactory = db_connection,
) -> dict[str, Any]:
    event_id = _clean_record_id(payload.get("recordId"))
    session_id = _clean_session_id(payload.get("sessionId"))
    status = _clean_final_status(payload.get("status"))
    intent = _clean_intent(payload.get("intent"))
    now = _utc_now()

    with connection_factory() as conn:
        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE cnpscy_oi_chatbot_question_logs
                    SET status = %s,
                        intent = %s,
                        completedAt = %s,
                        updatedAt = %s
                    WHERE eventId = %s
                      AND anonymousSessionId = %s
                      AND status = 'submitted'
                    """,
                    (status, intent, now, now, event_id, session_id),
                )
                updated = int(cursor.rowcount or 0)

            if not updated:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT eventId, status
                        FROM cnpscy_oi_chatbot_question_logs
                        WHERE eventId = %s
                          AND anonymousSessionId = %s
                        LIMIT 1
                        """,
                        (event_id, session_id),
                    )
                    existing = cursor.fetchone()
                if not existing:
                    raise QuestionLogNotFoundError("question log was not found")
                existing_status = str(existing.get("status") or "").strip().lower()
                if existing_status != status:
                    raise QuestionLogValidationError("question log already has a different final status")

            conn.commit()
        except Exception:
            conn.rollback()
            raise

    return {"ok": True, "recordId": event_id, "status": status}


def fetch_question_logs(
    connection_factory: ConnectionFactory = db_connection,
) -> list[dict[str, Any]]:
    with connection_factory() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    recordId,
                    eventId,
                    anonymousSessionId,
                    mode,
                    prompt,
                    language,
                    intent,
                    status,
                    submittedAt,
                    completedAt,
                    updatedAt
                FROM cnpscy_oi_chatbot_question_logs
                ORDER BY submittedAt DESC, recordId DESC
                """
            )
            return list(cursor.fetchall())


def _iso_utc(value: Any) -> str:
    if value in (None, ""):
        return ""
    if isinstance(value, dt.datetime):
        if value.tzinfo is not None:
            value = value.astimezone(dt.timezone.utc).replace(tzinfo=None)
        return value.isoformat(timespec="microseconds") + "Z"
    return str(value)


def _export_row(row: dict[str, Any]) -> dict[str, str]:
    return {
        "eventId": str(row.get("eventId") or ""),
        "submittedAt": _iso_utc(row.get("submittedAt")),
        "completedAt": _iso_utc(row.get("completedAt")),
        "mode": str(row.get("mode") or ""),
        "prompt": str(row.get("prompt") or "").replace("\x00", ""),
        "anonymousSessionId": str(row.get("anonymousSessionId") or ""),
        "language": str(row.get("language") or ""),
        "intent": str(row.get("intent") or "unknown"),
        "status": str(row.get("status") or ""),
    }


def _csv_text(value: Any) -> str:
    text = str(value or "").replace("\x00", "")
    if text.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + text
    return text


def render_question_log_export(
    rows: list[dict[str, Any]],
    export_format: str,
    export_date: dt.date | None = None,
) -> tuple[bytes, str, str]:
    export_format = str(export_format or "").strip().lower()
    if export_format not in {"csv", "jsonl"}:
        raise QuestionLogValidationError("format must be csv or jsonl")

    date_value = export_date or dt.datetime.now(dt.timezone.utc).date()
    filename = f"chatbot-questions-{date_value.isoformat()}.{export_format}"
    public_rows = [_export_row(row) for row in rows]

    if export_format == "jsonl":
        body = "".join(
            json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"
            for row in public_rows
        ).encode("utf-8")
        return body, "application/x-ndjson; charset=utf-8", filename

    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\r\n")
    writer.writerow(EXPORT_COLUMNS)
    for row in public_rows:
        writer.writerow([_csv_text(row[column]) for column in EXPORT_COLUMNS])
    body = b"\xef\xbb\xbf" + stream.getvalue().encode("utf-8")
    return body, "text/csv; charset=utf-8", filename
