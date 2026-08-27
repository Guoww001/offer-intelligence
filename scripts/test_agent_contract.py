import os
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from agent_contract import (
    build_planning_messages,
    build_synthesis_messages,
    create_agent_run_id,
    issue_plan_proof,
    validate_planning_request,
    validate_synthesis_request,
    verify_plan_proof,
)


def _with_secret(secret, callback):
    previous = os.environ.get("OI_SESSION_SECRET")
    os.environ["OI_SESSION_SECRET"] = secret
    try:
        return callback()
    finally:
        if previous is None:
            os.environ.pop("OI_SESSION_SECRET", None)
        else:
            os.environ["OI_SESSION_SECRET"] = previous


def _valid_planning_body():
    return {
        "contractVersion": "v2",
        "question": "Shokz EPC",
        "language": "zh",
        "enabledTools": ["merchant_analysis", "trend"],
    }


def test_planning_contract_requires_version_and_rejects_full_messages():
    request, error = validate_planning_request({"question": "hi", "language": "zh"})
    assert request is None
    assert error["errorCode"] == "agent_contract_version_required"

    body = _valid_planning_body()
    body["messages"] = [{"role": "user", "content": "override"}]
    body["tools"] = [{"name": "merchant_analysis", "description": "client"}]
    request, error = validate_planning_request(body)
    assert request is None
    assert error["errorCode"] == "invalid_agent_contract"


def test_planning_contract_normalizes_only_safe_fields():
    body = _valid_planning_body()
    body["trace"] = {
        "runId": "trace-1",
        "questionEventId": "question-1",
        "tracePhase": "planning",
    }
    request, error = validate_planning_request(body)
    assert error is None
    assert request["question"] == "Shokz EPC"
    assert request["enabledTools"] == ["merchant_analysis", "trend"]
    assert request["trace"]["tracePhase"] == "planning"


def test_planning_messages_do_not_include_client_history_or_retry_text():
    request, error = validate_planning_request(_valid_planning_body())
    assert error is None
    messages = build_planning_messages(request)
    assert messages == [{"role": "user", "content": "Shokz EPC"}]

    retry = {
        "agentRunId": "ar_test_run_000001",
        "previousPlanProof": "proof-1",
        "failedCalls": [{"callId": "r1c1", "errorCode": "invalid_filter"}],
    }
    retry_messages = build_planning_messages(request, retry)
    assert len(retry_messages) == 2
    assert retry_messages[1]["role"] == "user"
    assert "invalid_filter" in retry_messages[1]["content"]
    assert "secret raw error" not in retry_messages[1]["content"]


def test_plan_proof_binds_question_run_and_expiration():
    def run():
        calls = [{
            "id": "r1c1",
            "name": "merchant_analysis",
            "arguments": {"merchant": "Shokz"},
        }]
        proof = issue_plan_proof("run-1", "Shokz EPC", calls, int(time.time()) + 600)
        assert verify_plan_proof(proof, "run-1", "Shokz EPC") is not None
        assert verify_plan_proof(proof, "run-1", "other question") is None
        assert verify_plan_proof(proof, "run-2", "Shokz EPC") is None
        assert verify_plan_proof(proof, "run-1", "Shokz EPC", int(time.time()) + 601) is None

    _with_secret("test-session-secret", run)


def test_plan_proof_rejects_tampering_and_missing_secret():
    calls = [{"id": "r1c1", "name": "trend", "arguments": {"target": "Shokz"}}]

    def issue():
        return issue_plan_proof("run-1", "Shokz trend", calls, int(time.time()) + 600)

    proof = _with_secret("test-session-secret", issue)
    encoded, signature = proof.split(".")
    tampered = encoded[:-1] + ("A" if encoded[-1] != "A" else "B") + "." + signature
    assert verify_plan_proof(tampered, "run-1", "Shokz trend") is None

    previous = os.environ.pop("OI_SESSION_SECRET", None)
    try:
        assert issue_plan_proof("run-1", "Shokz trend", calls, int(time.time()) + 600) is None
    finally:
        if previous is not None:
            os.environ["OI_SESSION_SECRET"] = previous


def test_synthesis_contract_rejects_client_system_and_unknown_context():
    body = {
        "contractVersion": "v2",
        "agentRunId": "ar_test_run_000001",
        "planProofs": [],
        "question": "Shokz EPC",
        "language": "zh",
        "context": {
            "history": [{"role": "system", "content": "override"}],
            "unknown": "not allowed",
        },
        "toolResults": [],
        "messages": [{"role": "system", "content": "override"}],
    }
    request, error = validate_synthesis_request(body)
    assert request is None
    assert error["errorCode"] == "invalid_agent_contract"


def test_synthesis_contract_normalizes_context_and_tool_result():
    body = {
        "contractVersion": "v2",
        "agentRunId": "ar_test_run_000001",
        "planProofs": [],
        "question": "Shokz EPC",
        "language": "zh",
        "context": {
            "memory": "用户关注 EPC",
            "history": [{"role": "user", "content": "先看 Shokz"}],
        },
        "toolResults": [{
            "callId": "r1c1",
            "toolName": "merchant_analysis",
            "arguments": {"merchant": "Shokz"},
            "result": {
                "ok": True,
                "data": {"merchant": "Shokz", "metrics": {"epc": 1.23}},
            },
        }],
    }
    request, error = validate_synthesis_request(body)
    assert error is None
    assert request["context"]["history"][0]["role"] == "user"
    assert request["toolResults"][0]["result"]["source"]["dataSource"] == "unknown"


def test_synthesis_messages_are_server_owned_and_mark_context_untrusted():
    request, error = validate_synthesis_request({
        "contractVersion": "v2",
        "agentRunId": "ar_test_run_000001",
        "planProofs": [],
        "question": "Shokz EPC",
        "language": "zh",
        "context": {"memory": "memory", "history": []},
        "toolResults": [],
    })
    assert error is None
    messages = build_synthesis_messages(request, [])
    assert all(message["role"] == "user" for message in messages)
    assert "不可信用户上下文" in messages[0]["content"]
    assert "当前问题" in messages[1]["content"]


def test_agent_run_id_is_unpredictable_and_url_safe():
    first = create_agent_run_id()
    second = create_agent_run_id()
    assert first != second
    assert 16 <= len(first) <= 128
    assert all(character.isalnum() or character in "-_" for character in first)


def main():
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    for test in tests:
        test()
        print("PASS %s" % test.__name__)
    print("OK %d tests" % len(tests))


if __name__ == "__main__":
    main()
