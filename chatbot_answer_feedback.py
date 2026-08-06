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


CHATBOT_ANSWER_FEEDBACK_TABLE = "cnpscy_oi_chatbot_answer_feedback"
CHATBOT_ANSWER_FEEDBACK_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS cnpscy_oi_chatbot_answer_feedback (
  feedbackId          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  feedbackEventId     CHAR(36) NOT NULL,
  questionEventId     CHAR(36) NOT NULL,
  anonymousSessionId  VARCHAR(64) NOT NULL,
  mode                VARCHAR(16) NOT NULL,
  prompt              TEXT NOT NULL,
  language            VARCHAR(8) NOT NULL,
  answer              MEDIUMTEXT NOT NULL,
  answerTruncated     TINYINT(1) NOT NULL DEFAULT 0,
  reasonCode          VARCHAR(32) NOT NULL,
  reasonDetail        TEXT NOT NULL,
  submittedAt         DATETIME(6) NOT NULL,
  PRIMARY KEY (feedbackId),
  UNIQUE KEY uq_chatbot_feedback_event (feedbackEventId),
  UNIQUE KEY uq_chatbot_feedback_question (questionEventId),
  KEY idx_chatbot_feedback_submitted (submittedAt, feedbackId),
  KEY idx_chatbot_feedback_mode (mode, submittedAt),
  KEY idx_chatbot_feedback_reason (reasonCode, submittedAt),
  KEY idx_chatbot_feedback_session (anonymousSessionId, submittedAt),
  CONSTRAINT fk_chatbot_feedback_question
    FOREIGN KEY (questionEventId)
    REFERENCES cnpscy_oi_chatbot_question_logs (eventId)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
""".strip()

MAX_PROMPT_BYTES = 16_384
MAX_ANSWER_BYTES = 262_144
MAX_REASON_DETAIL_BYTES = 4_096
ANSWER_TRUNCATION_MARKER = "\n\n[回答因长度限制已截断]"
SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
REASON_LABELS = {
    "inaccurate": "回答不准确",
    "not_answered": "没有回答问题",
    "incomplete_data": "数据不完整",
    "unclear": "内容难以理解",
    "other": "其他",
}
EXPORT_COLUMNS = (
    "feedbackEventId",
    "questionEventId",
    "submittedAt",
    "mode",
    "prompt",
    "answer",
    "answerTruncated",
    "anonymousSessionId",
    "language",
    "reasonCode",
    "reasonLabel",
    "reasonDetail",
)

ConnectionFactory = Callable[[], AbstractContextManager[Any]]


class AnswerFeedbackValidationError(ValueError):
    pass


class AnswerFeedbackNotFoundError(LookupError):
    pass


class AnswerFeedbackConflictError(RuntimeError):
    def __init__(self, message: str, *, code: str = "feedback_conflict"):
        super().__init__(message)
        self.code = code


def _utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)


def _clean_uuid(value: Any, field_name: str) -> str:
    try:
        return str(uuid.UUID(str(value or "").strip()))
    except (ValueError, TypeError, AttributeError) as exc:
        raise AnswerFeedbackValidationError(f"{field_name} must be a UUID") from exc


def _clean_text(value: Any, field_name: str, max_bytes: int, *, required: bool = True) -> str:
    text = str(value or "").strip()
    if required and not text:
        raise AnswerFeedbackValidationError(f"{field_name} is required")
    if len(text.encode("utf-8")) > max_bytes:
        raise AnswerFeedbackValidationError(f"{field_name} is too large")
    return text


def _clean_mode(value: Any) -> str:
    mode = str(value or "").strip().lower()
    if mode not in {"report", "chat"}:
        raise AnswerFeedbackValidationError("mode must be report or chat")
    return mode


def _clean_session_id(value: Any) -> str:
    session_id = str(value or "").strip()
    if not SESSION_ID_RE.fullmatch(session_id):
        raise AnswerFeedbackValidationError("sessionId is invalid")
    return session_id


def _clean_language(value: Any) -> str:
    language = str(value or "en").strip().lower()
    if language not in {"en", "zh"}:
        raise AnswerFeedbackValidationError("language must be en or zh")
    return language


def _clean_reason_code(value: Any) -> str:
    reason_code = str(value or "").strip().lower()
    if reason_code not in REASON_LABELS:
        raise AnswerFeedbackValidationError("reasonCode is invalid")
    return reason_code


def _truncate_utf8(text: str, max_bytes: int, marker: str) -> tuple[str, int]:
    encoded = text.encode("utf-8")
    if len(encoded) <= max_bytes:
        return text, 0
    marker_bytes = marker.encode("utf-8")
    available = max(0, max_bytes - len(marker_bytes))
    prefix = encoded[:available].decode("utf-8", errors="ignore")
    return prefix + marker, 1


def _same_feedback(existing: dict[str, Any], values: dict[str, Any]) -> bool:
    return all(
        str(existing.get(key) or "") == str(values.get(key) or "")
        for key in (
            "feedbackEventId",
            "questionEventId",
            "anonymousSessionId",
            "mode",
            "prompt",
            "answer",
            "language",
            "reasonCode",
            "reasonDetail",
        )
    ) and int(existing.get("answerTruncated") or 0) == int(values["answerTruncated"])


def _existing_feedback_result(
    existing: dict[str, Any],
    values: dict[str, Any],
    feedback_event_id: str,
    question_event_id: str,
) -> dict[str, Any]:
    if not _same_feedback(existing, values):
        existing_question_id = str(existing.get("questionEventId") or "")
        existing_feedback_id = str(existing.get("feedbackEventId") or "")
        code = (
            "feedback_already_exists"
            if existing_question_id == question_event_id
            and existing_feedback_id != feedback_event_id
            else "feedback_event_conflict"
        )
        raise AnswerFeedbackConflictError(
            "feedback already exists for this answer",
            code=code,
        )
    return {
        "ok": True,
        "feedbackEventId": feedback_event_id,
        "questionEventId": question_event_id,
    }


def create_answer_feedback(
    payload: dict[str, Any],
    connection_factory: ConnectionFactory = db_connection,
) -> dict[str, Any]:
    feedback_event_id = _clean_uuid(payload.get("feedbackEventId"), "feedbackEventId")
    question_event_id = _clean_uuid(payload.get("questionEventId"), "questionEventId")
    session_id = _clean_session_id(payload.get("sessionId"))
    mode = _clean_mode(payload.get("mode"))
    prompt = _clean_text(payload.get("prompt"), "prompt", MAX_PROMPT_BYTES)
    raw_answer = str(payload.get("answer") or "")
    if not raw_answer.strip():
        raise AnswerFeedbackValidationError("answer is required")
    answer, answer_truncated = _truncate_utf8(
        raw_answer,
        MAX_ANSWER_BYTES,
        ANSWER_TRUNCATION_MARKER,
    )
    language = _clean_language(payload.get("language"))
    reason_code = _clean_reason_code(payload.get("reasonCode"))
    reason_detail = _clean_text(
        payload.get("reasonDetail"),
        "reasonDetail",
        MAX_REASON_DETAIL_BYTES,
        required=False,
    )
    now = _utc_now()
    values = {
        "feedbackEventId": feedback_event_id,
        "questionEventId": question_event_id,
        "anonymousSessionId": session_id,
        "mode": mode,
        "prompt": prompt,
        "answer": answer,
        "answerTruncated": answer_truncated,
        "language": language,
        "reasonCode": reason_code,
        "reasonDetail": reason_detail,
    }

    with connection_factory() as conn:
        try:
            if hasattr(conn, "begin"):
                conn.begin()
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT eventId, anonymousSessionId, mode, prompt, status
                    FROM cnpscy_oi_chatbot_question_logs
                    WHERE eventId = %s
                    LIMIT 1
                    FOR UPDATE
                    """,
                    (question_event_id,),
                )
                question = cursor.fetchone()
            if not question:
                raise AnswerFeedbackNotFoundError("question log was not found")
            if str(question.get("status") or "").lower() != "success":
                raise AnswerFeedbackConflictError(
                    "feedback requires a successful answer",
                    code="question_not_successful",
                )
            if (
                str(question.get("anonymousSessionId") or "") != session_id
                or str(question.get("mode") or "").lower() != mode
                or str(question.get("prompt") or "").strip() != prompt
            ):
                raise AnswerFeedbackConflictError(
                    "feedback does not match the question log",
                    code="context_mismatch",
                )

            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        feedbackEventId,
                        questionEventId,
                        anonymousSessionId,
                        mode,
                        prompt,
                        language,
                        answer,
                        answerTruncated,
                        reasonCode,
                        reasonDetail
                    FROM cnpscy_oi_chatbot_answer_feedback
                    WHERE feedbackEventId = %s OR questionEventId = %s
                    LIMIT 1
                    """,
                    (feedback_event_id, question_event_id),
                )
                existing = cursor.fetchone()
            if existing:
                result = _existing_feedback_result(
                    existing, values, feedback_event_id, question_event_id
                )
                conn.commit()
                return result

            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO cnpscy_oi_chatbot_answer_feedback
                        (
                            feedbackEventId,
                            questionEventId,
                            anonymousSessionId,
                            mode,
                            prompt,
                            language,
                            answer,
                            answerTruncated,
                            reasonCode,
                            reasonDetail,
                            submittedAt
                        )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        feedbackEventId = cnpscy_oi_chatbot_answer_feedback.feedbackEventId
                    """,
                    (
                        feedback_event_id,
                        question_event_id,
                        session_id,
                        mode,
                        prompt,
                        language,
                        answer,
                        answer_truncated,
                        reason_code,
                        reason_detail,
                        now,
                    ),
                )
                inserted = int(cursor.rowcount or 0)
            if not inserted:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT
                            feedbackEventId,
                            questionEventId,
                            anonymousSessionId,
                            mode,
                            prompt,
                            language,
                            answer,
                            answerTruncated,
                            reasonCode,
                            reasonDetail
                        FROM cnpscy_oi_chatbot_answer_feedback
                        WHERE feedbackEventId = %s OR questionEventId = %s
                        LIMIT 1
                        """,
                        (feedback_event_id, question_event_id),
                    )
                    existing = cursor.fetchone()
                if not existing:
                    raise AnswerFeedbackConflictError(
                        "feedback could not be resolved",
                        code="feedback_conflict",
                    )
                result = _existing_feedback_result(
                    existing, values, feedback_event_id, question_event_id
                )
                conn.commit()
                return result
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    return {
        "ok": True,
        "feedbackEventId": feedback_event_id,
        "questionEventId": question_event_id,
    }


def fetch_answer_feedback(
    connection_factory: ConnectionFactory = db_connection,
) -> list[dict[str, Any]]:
    with connection_factory() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    feedbackId,
                    feedbackEventId,
                    questionEventId,
                    anonymousSessionId,
                    mode,
                    prompt,
                    language,
                    answer,
                    answerTruncated,
                    reasonCode,
                    reasonDetail,
                    submittedAt
                FROM cnpscy_oi_chatbot_answer_feedback
                ORDER BY submittedAt DESC, feedbackId DESC
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


def _export_row(row: dict[str, Any]) -> dict[str, Any]:
    reason_code = str(row.get("reasonCode") or "")
    return {
        "feedbackEventId": str(row.get("feedbackEventId") or ""),
        "questionEventId": str(row.get("questionEventId") or ""),
        "submittedAt": _iso_utc(row.get("submittedAt")),
        "mode": str(row.get("mode") or ""),
        "prompt": str(row.get("prompt") or "").replace("\x00", ""),
        "answer": str(row.get("answer") or "").replace("\x00", ""),
        "answerTruncated": int(row.get("answerTruncated") or 0),
        "anonymousSessionId": str(row.get("anonymousSessionId") or ""),
        "language": str(row.get("language") or ""),
        "reasonCode": reason_code,
        "reasonLabel": REASON_LABELS.get(reason_code, reason_code),
        "reasonDetail": str(row.get("reasonDetail") or "").replace("\x00", ""),
    }


def _csv_text(value: Any) -> str:
    text = str(value if value is not None else "").replace("\x00", "")
    if text.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + text
    return text


def render_answer_feedback_export(
    rows: list[dict[str, Any]],
    export_format: str,
    export_date: dt.date | None = None,
) -> tuple[bytes, str, str]:
    export_format = str(export_format or "").strip().lower()
    if export_format not in {"csv", "jsonl"}:
        raise AnswerFeedbackValidationError("format must be csv or jsonl")

    date_value = export_date or dt.datetime.now(dt.timezone.utc).date()
    filename = f"chatbot-feedback-{date_value.isoformat()}.{export_format}"
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
    return (
        b"\xef\xbb\xbf" + stream.getvalue().encode("utf-8"),
        "text/csv; charset=utf-8",
        filename,
    )
