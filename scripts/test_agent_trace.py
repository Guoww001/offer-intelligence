from __future__ import annotations

from contextlib import redirect_stderr
from io import StringIO
from pathlib import Path
import sys
import uuid


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import agent_trace
from scripts import prune_agent_trace


RUN_ID = str(uuid.uuid4())
QUESTION_ID = str(uuid.uuid4())
SESSION_ID = "session-agent-trace-20260826"


class FakeCursor:
    def __init__(self, database):
        self.database = database
        self.rowcount = 0
        self._row = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split()).lower()
        self.rowcount = 0
        self._row = None
        if normalized.startswith("insert into cnpscy_oi_agent_runs"):
            run_id = str(params[0])
            if run_id in self.database.runs:
                return
            self.database.runs[run_id] = {
                "runId": run_id,
                "questionEventId": str(params[1]),
                "anonymousSessionId": str(params[2]),
                "status": "running",
            }
            self.rowcount = 1
        elif normalized.startswith("select runid") and "from cnpscy_oi_agent_runs" in normalized:
            self._row = self.database.runs.get(str(params[0]))
        elif normalized.startswith("insert into cnpscy_oi_agent_steps"):
            key = (str(params[1]), int(params[3]))
            if key in self.database.steps:
                return
            self.database.steps[key] = {"runId": key[0], "sequence": key[1], "status": str(params[6])}
            self.rowcount = 1
        elif normalized.startswith("select sequence") and "from cnpscy_oi_agent_steps" in normalized:
            key = (str(params[0]), int(params[1]))
            self._row = self.database.steps.get(key)
        elif normalized.startswith("update cnpscy_oi_agent_runs"):
            run_id = str(params[-2])
            row = self.database.runs.get(run_id)
            if row and row["status"] == "running":
                row["status"] = str(params[0])
                self.rowcount = 1
        else:
            raise AssertionError(f"unexpected SQL in fake database: {sql}")

    def fetchone(self):
        return self._row


class FakeConnection:
    def __init__(self):
        self.runs = {}
        self.steps = {}
        self.commits = 0
        self.rollbacks = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def assert_raises(expected, callback, label):
    try:
        callback()
    except expected:
        return
    raise AssertionError(f"{label}: expected {expected.__name__}")


def test_trace_contract_validation():
    base = {
        "runId": RUN_ID,
        "questionEventId": QUESTION_ID,
        "sessionId": SESSION_ID,
        "mode": "agent",
        "language": "zh",
        "sequence": 1,
        "phase": "tool",
        "status": "success",
        "durationMs": 12,
        "inputBytes": 128,
        "retryCount": 0,
    }
    assert agent_trace.normalize_trace_step(base)["phase"] == "tool"
    for phase in ("running", "prompt", "Planning"):
        invalid = dict(base, phase=phase)
        assert_raises(ValueError, lambda invalid=invalid: agent_trace.normalize_trace_step(invalid), f"phase {phase}")
    for status in ("running", "cancelled", "ok"):
        invalid = dict(base, status=status)
        assert_raises(ValueError, lambda invalid=invalid: agent_trace.normalize_trace_step(invalid), f"status {status}")
    for source in ("estimate", "live", ""):
        invalid = dict(base, dataSource=source)
        assert_raises(ValueError, lambda invalid=invalid: agent_trace.normalize_trace_step(invalid), f"dataSource {source}")
    for field in ("errorCode", "provider", "model", "toolName", "dataAsOf"):
        invalid = dict(base, **{field: "x" * 300})
        assert_raises(ValueError, lambda invalid=invalid: agent_trace.normalize_trace_step(invalid), f"length {field}")


def test_trace_rejects_invalid_run_and_sensitive_payloads():
    invalid_run = {
        "runId": "not-a-uuid",
        "questionEventId": QUESTION_ID,
        "sessionId": SESSION_ID,
        "mode": "chat",
        "language": "fr",
    }
    assert_raises(ValueError, lambda: agent_trace.validate_trace_run(invalid_run), "run contract")
    for forbidden in ("prompt", "messages", "arguments", "toolResult", "response", "rawJson"):
        payload = {
            "runId": RUN_ID,
            "questionEventId": QUESTION_ID,
            "sessionId": SESSION_ID,
            "mode": "agent",
            "language": "zh",
            forbidden: "must not persist",
        }
        assert_raises(ValueError, lambda payload=payload: agent_trace.validate_trace_run(payload), f"forbidden field {forbidden}")


def test_trace_steps_are_idempotent_and_terminal_state_is_stable():
    database = FakeConnection()

    def connection_factory():
        return database

    started = agent_trace.start_agent_run(
        {
            "runId": RUN_ID,
            "questionEventId": QUESTION_ID,
            "sessionId": SESSION_ID,
            "mode": "agent",
            "language": "zh",
        },
        connection_factory=connection_factory,
    )
    assert started["runId"] == RUN_ID
    step = {
        "runId": RUN_ID,
        "questionEventId": QUESTION_ID,
        "sequence": 1,
        "phase": "tool",
        "toolName": "merchant_analysis",
        "status": "success",
        "durationMs": 25,
        "dataSource": "cache",
        "estimated": False,
        "retryCount": 0,
    }
    first = agent_trace.append_agent_steps(
        {"runId": RUN_ID, "sessionId": SESSION_ID, "steps": [step]},
        connection_factory=connection_factory,
    )
    second = agent_trace.append_agent_steps(
        {"runId": RUN_ID, "sessionId": SESSION_ID, "steps": [step]},
        connection_factory=connection_factory,
    )
    assert first["inserted"] == 1 and second["duplicates"] == 1
    assert len(database.steps) == 1

    complete = agent_trace.complete_agent_run(
        {
            "runId": RUN_ID,
            "sessionId": SESSION_ID,
            "status": "success",
            "durationMs": 100,
            "executedToolCalls": 1,
        },
        connection_factory=connection_factory,
    )
    assert complete["status"] == "success"
    assert_raises(
        ValueError,
        lambda: agent_trace.complete_agent_run(
            {"runId": RUN_ID, "sessionId": SESSION_ID, "status": "failed"},
            connection_factory=connection_factory,
        ),
        "terminal state transition",
    )


def test_ddl_and_prune_contract():
    runs_ddl = agent_trace.AGENT_RUNS_TABLE_DDL
    steps_ddl = agent_trace.AGENT_STEPS_TABLE_DDL
    for table in ("cnpscy_oi_agent_runs", "cnpscy_oi_agent_steps"):
        assert table in runs_ddl + steps_ddl
    assert "PRIMARY KEY" in runs_ddl and "PRIMARY KEY" in steps_ddl
    assert "questionEventId" in runs_ddl and "idx_agent_run_question" in runs_ddl
    assert "UNIQUE KEY uq_agent_step_run_sequence" in steps_ddl
    assert "idx_agent_step_run_phase_status" in steps_ddl
    prune_source = (ROOT / "scripts" / "prune_agent_trace.py").read_text(encoding="utf-8")
    assert "OI_AGENT_TRACE_RETENTION_DAYS" in prune_source
    assert "--dry-run" in prune_source and "--days" in prune_source
    assert prune_source.index("agent_steps") < prune_source.index("agent_runs")


def test_prune_cli_masks_database_errors():
    original_connection = prune_agent_trace.db_connection

    def failing_connection():
        raise RuntimeError("secret connection details")

    prune_agent_trace.db_connection = failing_connection
    stderr = StringIO()
    try:
        with redirect_stderr(stderr):
            exit_code = prune_agent_trace.cli(["--dry-run"])
    finally:
        prune_agent_trace.db_connection = original_connection

    output = stderr.getvalue()
    assert exit_code == 1
    assert "database operation was not completed" in output
    assert "secret connection details" not in output


def main():
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    for test in tests:
        test()
        print(f"PASS {test.__name__}")
    print(f"OK {len(tests)} tests")


if __name__ == "__main__":
    main()
