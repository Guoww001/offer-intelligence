"""Agent 运行追踪的白名单合同、持久化和幂等操作。

Trace 只保存运行元数据，不保存 Prompt、完整工具参数、工具结果、回答正文
或异常堆栈。该模块故意不依赖问题日志表，便于日志开关关闭时仍能保留诊断
数据。数据库迁移仍由 ``scripts/ensure_oi_schema.py`` 显式执行。
"""

from __future__ import annotations

import datetime as dt
import math
import re
import uuid
from contextlib import AbstractContextManager
from typing import Any, Callable

from offer_db import db_connection


AGENT_RUNS_TABLE = "cnpscy_oi_agent_runs"
AGENT_STEPS_TABLE = "cnpscy_oi_agent_steps"

TRACE_PHASES = frozenset({"planning", "tool", "synthesis"})
TRACE_STEP_STATUSES = frozenset({"success", "failed", "stopped", "timeout"})
TRACE_RUN_STATUSES = frozenset({"running", "success", "failed", "stopped", "timeout"})
TRACE_DATA_SOURCES = frozenset({"cache", "database", "mixed", "unknown"})
TRACE_ERROR_CODES = frozenset(
    {
        "unknown",
        "validation_error",
        "request_error",
        "network_error",
        "database_error",
        "llm_unavailable",
        "llm_timeout",
        "provider_error",
        "tool_error",
        "tool_timeout",
        "synthesis_unavailable",
        "no_verifiable_source",
        "stopped_by_user",
        "trace_write_failed",
    }
)

MAX_PROVIDER_LENGTH = 64
MAX_MODEL_LENGTH = 128
MAX_TOOL_NAME_LENGTH = 64
MAX_ERROR_CODE_LENGTH = 64
MAX_DATA_AS_OF_LENGTH = 64
SESSION_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{16,64}$")
FORBIDDEN_TRACE_FIELDS = frozenset(
    {"prompt", "messages", "arguments", "toolResult", "response", "rawJson"}
)

ConnectionFactory = Callable[[], AbstractContextManager[Any]]


AGENT_RUNS_TABLE_DDL = f"""
CREATE TABLE IF NOT EXISTS {AGENT_RUNS_TABLE} (
  runId               CHAR(36) NOT NULL,
  questionEventId     CHAR(36) NOT NULL,
  anonymousSessionId  VARCHAR(64) NOT NULL,
  mode                VARCHAR(16) NOT NULL,
  language            VARCHAR(8) NOT NULL,
  status              VARCHAR(16) NOT NULL,
  startedAt           DATETIME(6) NOT NULL,
  completedAt         DATETIME(6) DEFAULT NULL,
  durationMs          BIGINT UNSIGNED DEFAULT NULL,
  planningBypassed    TINYINT(1) NOT NULL DEFAULT 0,
  partial             TINYINT(1) NOT NULL DEFAULT 0,
  fallbackDelivered   TINYINT(1) NOT NULL DEFAULT 0,
  stoppedByUser       TINYINT(1) NOT NULL DEFAULT 0,
  plannedToolCalls    INT UNSIGNED NOT NULL DEFAULT 0,
  executedToolCalls   INT UNSIGNED NOT NULL DEFAULT 0,
  failedToolCalls     INT UNSIGNED NOT NULL DEFAULT 0,
  errorCode           VARCHAR(64) DEFAULT NULL,
  createdAt           DATETIME(6) NOT NULL,
  PRIMARY KEY (runId),
  KEY idx_agent_run_question (questionEventId),
  KEY idx_agent_run_status_started (status, startedAt),
  KEY idx_agent_run_session_started (anonymousSessionId, startedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
""".strip()

AGENT_STEPS_TABLE_DDL = f"""
CREATE TABLE IF NOT EXISTS {AGENT_STEPS_TABLE} (
  stepId              CHAR(36) NOT NULL,
  runId               CHAR(36) NOT NULL,
  questionEventId     CHAR(36) NOT NULL,
  sequence            INT UNSIGNED NOT NULL,
  phase               VARCHAR(16) NOT NULL,
  toolName            VARCHAR(64) DEFAULT NULL,
  status              VARCHAR(16) NOT NULL,
  startedAt           DATETIME(6) DEFAULT NULL,
  completedAt         DATETIME(6) DEFAULT NULL,
  durationMs          BIGINT UNSIGNED DEFAULT NULL,
  provider            VARCHAR(64) DEFAULT NULL,
  model               VARCHAR(128) DEFAULT NULL,
  inputBytes          INT UNSIGNED DEFAULT NULL,
  inputTokens         INT UNSIGNED DEFAULT NULL,
  outputTokens        INT UNSIGNED DEFAULT NULL,
  totalTokens         INT UNSIGNED DEFAULT NULL,
  usageAvailable      TINYINT(1) NOT NULL DEFAULT 0,
  outputChunks        INT UNSIGNED DEFAULT NULL,
  dataSource          VARCHAR(16) NOT NULL DEFAULT 'unknown',
  dataAsOf            VARCHAR(64) DEFAULT NULL,
  estimated           TINYINT(1) NOT NULL DEFAULT 0,
  errorCode           VARCHAR(64) DEFAULT NULL,
  retryCount          INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (stepId),
  UNIQUE KEY uq_agent_step_run_sequence (runId, sequence),
  KEY idx_agent_step_question (questionEventId),
  KEY idx_agent_step_run_phase_status (runId, phase, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
""".strip()


class TraceValidationError(ValueError):
    """客户端 Trace 元数据不符合白名单合同。"""


class TraceConflictError(ValueError):
    """Trace 已经存在不可逆的状态或属于另一个会话。"""


def _utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)


def _reject_forbidden_fields(value: Any) -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            if str(key) in FORBIDDEN_TRACE_FIELDS:
                raise TraceValidationError(f"trace field {key} is not allowed")
            _reject_forbidden_fields(nested)
    elif isinstance(value, (list, tuple)):
        for nested in value:
            _reject_forbidden_fields(nested)


def _clean_uuid(value: Any, field: str) -> str:
    try:
        return str(uuid.UUID(str(value or "").strip()))
    except (ValueError, TypeError, AttributeError) as exc:
        raise TraceValidationError(f"{field} must be a UUID") from exc


def _clean_session_id(value: Any) -> str:
    session_id = str(value or "").strip()
    if not SESSION_ID_RE.fullmatch(session_id):
        raise TraceValidationError("sessionId is invalid")
    return session_id


def _clean_enum(value: Any, field: str, allowed: frozenset[str], default: str | None = None) -> str:
    cleaned = str(default if value in (None, "") and default is not None else value or "").strip().lower()
    if cleaned not in allowed:
        allowed_text = ", ".join(sorted(allowed))
        raise TraceValidationError(f"{field} must be one of {allowed_text}")
    return cleaned


def _clean_exact_enum(value: Any, field: str, allowed: frozenset[str], default: str | None = None) -> str:
    if value in (None, "") and default is not None:
        value = default
    if not isinstance(value, str) or value.strip() != value or value != value.lower():
        raise TraceValidationError(f"{field} is not allowed")
    return _clean_enum(value, field, allowed)


def _clean_language(value: Any) -> str:
    return _clean_enum(value, "language", frozenset({"en", "zh"}), "zh")


def _clean_text(value: Any, field: str, max_length: int, *, nullable: bool = True) -> str | None:
    if value in (None, "") and nullable:
        return None
    text = str(value or "").strip()
    if not text and nullable:
        return None
    if len(text) > max_length:
        raise TraceValidationError(f"{field} is too long")
    return text


def _clean_nonnegative(value: Any, field: str, *, nullable: bool = True) -> int | None:
    if value in (None, "") and nullable:
        return None
    if isinstance(value, bool):
        raise TraceValidationError(f"{field} must be non-negative")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise TraceValidationError(f"{field} must be non-negative") from exc
    if not math.isfinite(number) or number < 0 or not number.is_integer():
        raise TraceValidationError(f"{field} must be non-negative")
    return int(number)


def _clean_bool(value: Any, field: str, default: bool = False) -> bool:
    if value in (None, ""):
        return default
    if isinstance(value, bool):
        return value
    if value in (0, 1, "0", "1", "true", "false"):
        return str(value).lower() in {"1", "true"}
    raise TraceValidationError(f"{field} must be boolean")


def _clean_datetime(value: Any, field: str, *, nullable: bool = True) -> dt.datetime | None:
    if value in (None, "") and nullable:
        return None
    if isinstance(value, dt.datetime):
        parsed = value
    else:
        raw = str(value or "").strip()
        if not raw:
            return None if nullable else (_ for _ in ()).throw(TraceValidationError(f"{field} is required"))
        try:
            parsed = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError as exc:
            raise TraceValidationError(f"{field} is invalid") from exc
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(dt.timezone.utc).replace(tzinfo=None)
    return parsed


def _clean_error_code(value: Any) -> str | None:
    code = _clean_text(value, "errorCode", MAX_ERROR_CODE_LENGTH)
    if code is None:
        return None
    code = code.lower()
    if code not in TRACE_ERROR_CODES:
        raise TraceValidationError("errorCode is not allowed")
    return code


def validate_trace_run(payload: dict[str, Any], *, allow_running: bool = False) -> dict[str, Any]:
    """校验运行级元数据并返回去除未知字段的内部表示。"""
    if not isinstance(payload, dict):
        raise TraceValidationError("trace payload must be an object")
    _reject_forbidden_fields(payload)
    run_id = _clean_uuid(payload.get("runId"), "runId")
    question_event_id = _clean_uuid(payload.get("questionEventId"), "questionEventId")
    session_id = _clean_session_id(payload.get("sessionId") or payload.get("anonymousSessionId"))
    mode = _clean_enum(payload.get("mode"), "mode", frozenset({"agent"}))
    language = _clean_language(payload.get("language"))
    status_value = payload.get("status")
    status = None
    if status_value not in (None, ""):
        allowed = TRACE_RUN_STATUSES if allow_running else TRACE_STEP_STATUSES
        status = _clean_enum(status_value, "status", allowed)
    return {
        "runId": run_id,
        "questionEventId": question_event_id,
        "anonymousSessionId": session_id,
        "mode": mode,
        "language": language,
        "status": status,
        "startedAt": _clean_datetime(payload.get("startedAt"), "startedAt"),
        "completedAt": _clean_datetime(payload.get("completedAt"), "completedAt"),
        "durationMs": _clean_nonnegative(payload.get("durationMs"), "durationMs"),
        "planningBypassed": _clean_bool(payload.get("planningBypassed"), "planningBypassed"),
        "partial": _clean_bool(payload.get("partial"), "partial"),
        "fallbackDelivered": _clean_bool(payload.get("fallbackDelivered"), "fallbackDelivered"),
        "stoppedByUser": _clean_bool(payload.get("stoppedByUser"), "stoppedByUser"),
        "plannedToolCalls": _clean_nonnegative(payload.get("plannedToolCalls", 0), "plannedToolCalls", nullable=False) or 0,
        "executedToolCalls": _clean_nonnegative(payload.get("executedToolCalls", 0), "executedToolCalls", nullable=False) or 0,
        "failedToolCalls": _clean_nonnegative(payload.get("failedToolCalls", 0), "failedToolCalls", nullable=False) or 0,
        "errorCode": _clean_error_code(payload.get("errorCode")),
    }


def normalize_trace_step(payload: dict[str, Any]) -> dict[str, Any]:
    """校验并归一化单个步骤；只返回 Trace 白名单字段。"""
    if not isinstance(payload, dict):
        raise TraceValidationError("trace step must be an object")
    _reject_forbidden_fields(payload)
    step_id = _clean_uuid(payload.get("stepId") or uuid.uuid4(), "stepId")
    run_id = _clean_uuid(payload.get("runId"), "runId")
    question_event_id = payload.get("questionEventId")
    if question_event_id not in (None, ""):
        question_event_id = _clean_uuid(question_event_id, "questionEventId")
    sequence = _clean_nonnegative(payload.get("sequence"), "sequence", nullable=False)
    if sequence is None or sequence < 1:
        raise TraceValidationError("sequence must be a positive integer")
    phase = _clean_exact_enum(payload.get("phase"), "phase", TRACE_PHASES)
    status = _clean_exact_enum(payload.get("status"), "status", TRACE_STEP_STATUSES)
    data_source = _clean_exact_enum(
        payload.get("dataSource", "unknown"), "dataSource", TRACE_DATA_SOURCES
    )
    usage_available = _clean_bool(payload.get("usageAvailable"), "usageAvailable")
    return {
        "stepId": step_id,
        "runId": run_id,
        "questionEventId": question_event_id,
        "sequence": sequence,
        "phase": phase,
        "toolName": _clean_text(payload.get("toolName"), "toolName", MAX_TOOL_NAME_LENGTH),
        "status": status,
        "startedAt": _clean_datetime(payload.get("startedAt"), "startedAt"),
        "completedAt": _clean_datetime(payload.get("completedAt"), "completedAt"),
        "durationMs": _clean_nonnegative(payload.get("durationMs"), "durationMs"),
        "provider": _clean_text(payload.get("provider"), "provider", MAX_PROVIDER_LENGTH),
        "model": _clean_text(payload.get("model"), "model", MAX_MODEL_LENGTH),
        "inputBytes": _clean_nonnegative(payload.get("inputBytes"), "inputBytes"),
        "inputTokens": _clean_nonnegative(payload.get("inputTokens"), "inputTokens") if usage_available else None,
        "outputTokens": _clean_nonnegative(payload.get("outputTokens"), "outputTokens") if usage_available else None,
        "totalTokens": _clean_nonnegative(payload.get("totalTokens"), "totalTokens") if usage_available else None,
        "usageAvailable": usage_available,
        "outputChunks": _clean_nonnegative(payload.get("outputChunks"), "outputChunks"),
        "dataSource": data_source,
        "dataAsOf": _clean_text(payload.get("dataAsOf"), "dataAsOf", MAX_DATA_AS_OF_LENGTH),
        "estimated": _clean_bool(payload.get("estimated"), "estimated"),
        "errorCode": _clean_error_code(payload.get("errorCode")),
        "retryCount": _clean_nonnegative(payload.get("retryCount", 0), "retryCount", nullable=False) or 0,
    }


def _iso_utc(value: Any) -> str | None:
    parsed = _clean_datetime(value, "timestamp")
    if parsed is None:
        return None
    return parsed.isoformat(timespec="microseconds") + "Z"


def trace_error_code(error: BaseException | None) -> str:
    """把异常映射为有限错误码；绝不返回异常正文。"""
    if error is None:
        return "unknown"
    if isinstance(error, TraceValidationError):
        return "validation_error"
    if isinstance(error, TimeoutError) or "timeout" in type(error).__name__.lower():
        return "llm_timeout"
    if isinstance(error, (ConnectionError, BrokenPipeError, ConnectionResetError)):
        return "network_error"
    text = str(error).lower()
    if "api key" in text or "not configured" in text:
        return "llm_unavailable"
    if "provider" in text or "anthropic" in text or "deepseek" in text:
        return "provider_error"
    if "database" in text or "mysql" in text or "sql" in text:
        return "database_error"
    return "unknown"


def _connection_error(conn: Any) -> None:
    rollback = getattr(conn, "rollback", None)
    if callable(rollback):
        rollback()


def _connection_commit(conn: Any) -> None:
    commit = getattr(conn, "commit", None)
    if callable(commit):
        commit()


def start_agent_run(
    payload: dict[str, Any],
    connection_factory: ConnectionFactory = db_connection,
) -> dict[str, Any]:
    run = validate_trace_run(payload, allow_running=False)
    now = run["startedAt"] or _utc_now()
    with connection_factory() as conn:
        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    f"""
                    INSERT INTO {AGENT_RUNS_TABLE}
                        (runId, questionEventId, anonymousSessionId, mode, language, status,
                         startedAt, completedAt, durationMs, planningBypassed, partial,
                         fallbackDelivered, stoppedByUser, plannedToolCalls, executedToolCalls,
                         failedToolCalls, errorCode, createdAt)
                    VALUES (%s, %s, %s, %s, %s, 'running', %s, NULL, NULL, %s, %s, %s, %s, 0, 0, 0, NULL, %s)
                    ON DUPLICATE KEY UPDATE runId = runId
                    """,
                    (
                        run["runId"], run["questionEventId"], run["anonymousSessionId"],
                        run["mode"], run["language"], now,
                        int(run["planningBypassed"]), int(run["partial"]),
                        int(run["fallbackDelivered"]), int(run["stoppedByUser"]), _utc_now(),
                    ),
                )
                inserted = int(getattr(cursor, "rowcount", 0) or 0) > 0
                if not inserted:
                    cursor.execute(
                        f"SELECT runId, questionEventId, anonymousSessionId, status FROM {AGENT_RUNS_TABLE} WHERE runId = %s LIMIT 1",
                        (run["runId"],),
                    )
                    existing = cursor.fetchone()
                    if not existing:
                        raise TraceConflictError("agent run could not be resolved")
                    existing_question = str(existing.get("questionEventId") or "")
                    existing_session = str(existing.get("anonymousSessionId") or "")
                    if existing_question != run["questionEventId"] or existing_session != run["anonymousSessionId"]:
                        raise TraceConflictError("agent run belongs to another session")
                    status = str(existing.get("status") or "running")
                else:
                    status = "running"
            _connection_commit(conn)
        except Exception:
            _connection_error(conn)
            raise
    return {
        "ok": True,
        "runId": run["runId"],
        "questionEventId": run["questionEventId"],
        "status": status,
        "idempotent": not inserted,
    }


def append_agent_steps(
    payload: dict[str, Any],
    connection_factory: ConnectionFactory = db_connection,
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise TraceValidationError("trace payload must be an object")
    _reject_forbidden_fields(payload)
    run_id = _clean_uuid(payload.get("runId"), "runId")
    session_id = _clean_session_id(payload.get("sessionId"))
    raw_steps = payload.get("steps")
    if not isinstance(raw_steps, list) or not raw_steps:
        raise TraceValidationError("steps must be a non-empty array")
    if len(raw_steps) > 64:
        raise TraceValidationError("steps cannot contain more than 64 items")
    question_event_id = payload.get("questionEventId")
    if question_event_id not in (None, ""):
        question_event_id = _clean_uuid(question_event_id, "questionEventId")

    normalized_steps = []
    for raw_step in raw_steps:
        if not isinstance(raw_step, dict):
            raise TraceValidationError("each step must be an object")
        step_payload = dict(raw_step)
        step_payload["runId"] = run_id
        if question_event_id and not step_payload.get("questionEventId"):
            step_payload["questionEventId"] = question_event_id
        normalized = normalize_trace_step(step_payload)
        if normalized["runId"] != run_id:
            raise TraceValidationError("step runId does not match payload")
        if not normalized["questionEventId"]:
            raise TraceValidationError("questionEventId is required for each step")
        normalized_steps.append(normalized)

    with connection_factory() as conn:
        try:
            inserted = 0
            duplicates = 0
            states = []
            with conn.cursor() as cursor:
                cursor.execute(
                    f"SELECT runId, questionEventId, anonymousSessionId, status FROM {AGENT_RUNS_TABLE} WHERE runId = %s LIMIT 1",
                    (run_id,),
                )
                existing_run = cursor.fetchone()
            if not existing_run:
                raise TraceConflictError("agent run was not found")
            if str(existing_run.get("anonymousSessionId") or "") != session_id:
                raise TraceConflictError("agent run belongs to another session")
            existing_question_event_id = str(existing_run.get("questionEventId") or "")
            if question_event_id and question_event_id != existing_question_event_id:
                raise TraceConflictError("questionEventId does not match agent run")
            question_event_id = question_event_id or existing_question_event_id
            for step in normalized_steps:
                if not step["questionEventId"]:
                    step["questionEventId"] = question_event_id
                elif step["questionEventId"] != question_event_id:
                    raise TraceConflictError("questionEventId does not match agent run")
                with conn.cursor() as cursor:
                    cursor.execute(
                        f"""
                        INSERT INTO {AGENT_STEPS_TABLE}
                          (stepId, runId, questionEventId, sequence, phase, toolName, status,
                           startedAt, completedAt, durationMs, provider, model, inputBytes,
                           inputTokens, outputTokens, totalTokens, usageAvailable, outputChunks,
                           dataSource, dataAsOf, estimated, errorCode, retryCount)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                                %s, %s, %s, %s, %s, %s, %s, %s)
                        ON DUPLICATE KEY UPDATE stepId = stepId
                        """,
                        (
                            step["stepId"], step["runId"], step["questionEventId"], step["sequence"],
                            step["phase"], step["toolName"], step["status"], step["startedAt"],
                            step["completedAt"], step["durationMs"], step["provider"], step["model"],
                            step["inputBytes"], step["inputTokens"], step["outputTokens"],
                            step["totalTokens"], int(step["usageAvailable"]), step["outputChunks"],
                            step["dataSource"], step["dataAsOf"], int(step["estimated"]),
                            step["errorCode"], step["retryCount"],
                        ),
                    )
                    if int(getattr(cursor, "rowcount", 0) or 0) > 0:
                        inserted += 1
                        states.append({"sequence": step["sequence"], "status": step["status"]})
                    else:
                        duplicates += 1
                        cursor.execute(
                            f"SELECT sequence, status FROM {AGENT_STEPS_TABLE} WHERE runId = %s AND sequence = %s LIMIT 1",
                            (run_id, step["sequence"]),
                        )
                        existing = cursor.fetchone()
                        states.append({
                            "sequence": step["sequence"],
                            "status": str((existing or {}).get("status") or step["status"]),
                        })
            _connection_commit(conn)
        except Exception:
            _connection_error(conn)
            raise
    return {"ok": True, "runId": run_id, "inserted": inserted, "duplicates": duplicates, "steps": states}


def complete_agent_run(
    payload: dict[str, Any],
    connection_factory: ConnectionFactory = db_connection,
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise TraceValidationError("trace payload must be an object")
    _reject_forbidden_fields(payload)
    run_payload = dict(payload)
    supplied_question_event_id = payload.get("questionEventId")
    if supplied_question_event_id in (None, ""):
        run_payload["questionEventId"] = str(uuid.uuid4())
    run_payload.setdefault("mode", "agent")
    run_payload.setdefault("language", "zh")
    run = validate_trace_run(run_payload, allow_running=False)
    status = run["status"]
    if status not in TRACE_STEP_STATUSES:
        raise TraceValidationError("status is required")
    session_id = _clean_session_id(payload.get("sessionId"))
    completed_at = run["completedAt"] or _utc_now()

    with connection_factory() as conn:
        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    f"SELECT runId, questionEventId, anonymousSessionId, status FROM {AGENT_RUNS_TABLE} WHERE runId = %s LIMIT 1",
                    (run["runId"],),
                )
                existing = cursor.fetchone()
                if not existing:
                    raise TraceConflictError("agent run was not found")
                if str(existing.get("anonymousSessionId") or "") != session_id:
                    raise TraceConflictError("agent run belongs to another session")
                if supplied_question_event_id not in (None, ""):
                    supplied_question_event_id = _clean_uuid(supplied_question_event_id, "questionEventId")
                    if str(existing.get("questionEventId") or "") != supplied_question_event_id:
                        raise TraceConflictError("questionEventId does not match agent run")
                current_status = str(existing.get("status") or "running").lower()
                if current_status in TRACE_STEP_STATUSES:
                    if current_status != status:
                        raise TraceConflictError("agent run already has a different final status")
                    _connection_commit(conn)
                    return {"ok": True, "runId": run["runId"], "status": status, "idempotent": True}
                if current_status != "running":
                    raise TraceConflictError("agent run has an invalid current status")
                cursor.execute(
                    f"""
                    UPDATE {AGENT_RUNS_TABLE}
                    SET status = %s, completedAt = %s, durationMs = %s,
                        planningBypassed = %s, partial = %s, fallbackDelivered = %s,
                        stoppedByUser = %s, plannedToolCalls = %s, executedToolCalls = %s,
                        failedToolCalls = %s, errorCode = %s
                    WHERE runId = %s AND anonymousSessionId = %s AND status = 'running'
                    """,
                    (
                        status, completed_at, run["durationMs"], int(run["planningBypassed"]),
                        int(run["partial"]), int(run["fallbackDelivered"]), int(run["stoppedByUser"]),
                        run["plannedToolCalls"], run["executedToolCalls"], run["failedToolCalls"],
                        run["errorCode"], run["runId"], session_id,
                    ),
                )
            _connection_commit(conn)
        except Exception:
            _connection_error(conn)
            raise
    return {"ok": True, "runId": run["runId"], "status": status, "idempotent": False}
