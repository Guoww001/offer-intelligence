import importlib.util
from io import BytesIO
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

spec = importlib.util.spec_from_file_location("chat_agent_http", ROOT / "chat_agent_http.py")
chat_agent_http = importlib.util.module_from_spec(spec)
spec.loader.exec_module(chat_agent_http)


class FakeTarget:
    def __init__(self, payload=None):
        body = json.dumps(payload or {}).encode("utf-8")
        self.headers = {"Content-Length": str(len(body))}
        self.rfile = BytesIO(body)
        self.wfile = BytesIO()
        self.status = None
        self.response_headers = []

    def send_response(self, status):
        self.status = int(status)

    def send_header(self, name, value):
        self.response_headers.append((str(name), str(value)))

    def end_headers(self):
        return None


def response_json(target):
    return json.loads(target.wfile.getvalue().decode("utf-8"))


PLAN_FIXTURE = {
    "content": None,
    "tool_calls": [{"id": "c1", "name": "merchant_analysis", "arguments": {"merchant": "Shokz"}}],
}


def _run_with_secret(callback):
    previous = os.environ.get("OI_SESSION_SECRET")
    os.environ["OI_SESSION_SECRET"] = "agent-http-test-secret"
    try:
        return callback()
    finally:
        if previous is None:
            os.environ.pop("OI_SESSION_SECRET", None)
        else:
            os.environ["OI_SESSION_SECRET"] = previous


def test_agent_request_returns_tool_calls():
    captured = {}

    def fake_call(messages, tools, **kwargs):
        captured["messages"] = messages
        captured["tools"] = tools
        return PLAN_FIXTURE

    previous_call = chat_agent_http.call_llm_tools
    chat_agent_http.call_llm_tools = fake_call
    target = FakeTarget({
        "contractVersion": "v2",
        "question": "Shokz 表现",
        "language": "zh",
        "enabledTools": ["merchant_analysis"],
    })
    try:
        _run_with_secret(lambda: chat_agent_http.handle_agent_request(target))
    finally:
        chat_agent_http.call_llm_tools = previous_call
    payload = response_json(target)
    assert target.status == 200 and payload["ok"] is True
    assert payload["finishReason"] == "tool_calls"
    assert payload["toolCalls"] == [
        {
            "id": "r1c1",
            "name": "merchant_analysis",
            "arguments": {"merchant": "Shokz"},
        }
    ]
    assert payload["registryVersion"] == "agent-tools-v1"
    assert payload["agentRunId"]
    assert payload["planProof"]
    assert captured["messages"][0]["role"] == "system"
    assert captured["messages"][-1]["content"] == "Shokz 表现"
    assert captured["tools"][0]["name"] == "merchant_analysis"
    assert captured["tools"][0]["description"] != "d"
    assert captured["tools"][0]["parameters"]["required"] == ["merchant"]


def test_agent_request_accepts_planning_body_below_64kb():
    previous_call = chat_agent_http.call_llm_tools
    chat_agent_http.call_llm_tools = lambda messages, tools, **kw: PLAN_FIXTURE
    huge = "x" * 3000
    target = FakeTarget({
        "contractVersion": "v2",
        "question": huge,
        "language": "zh",
        "enabledTools": ["merchant_analysis"],
    })
    try:
        _run_with_secret(lambda: chat_agent_http.handle_agent_request(target))
    finally:
        chat_agent_http.call_llm_tools = previous_call
    payload = response_json(target)
    assert chat_agent_http.AGENT_MAX_REQUEST_BYTES == 64 * 1024
    assert target.status == 200 and payload["ok"] is True


def test_agent_request_llm_unavailable():
    previous_call = chat_agent_http.call_llm_tools
    chat_agent_http.call_llm_tools = lambda messages, tools, **kw: None
    target = FakeTarget({
        "contractVersion": "v2",
        "question": "hi",
        "language": "zh",
        "enabledTools": ["merchant_analysis"],
    })
    try:
        _run_with_secret(lambda: chat_agent_http.handle_agent_request(target))
    finally:
        chat_agent_http.call_llm_tools = previous_call
    payload = response_json(target)
    assert target.status == 200 and payload["ok"] is False
    assert payload["errorCode"] == "agent_planning_unavailable"


def test_agent_request_rejects_missing_tools():
    target = FakeTarget({"contractVersion": "v2", "question": "hi", "language": "zh"})
    chat_agent_http.handle_agent_request(target)
    assert target.status == 400
    assert response_json(target)["errorCode"] == "invalid_agent_contract"


def test_agent_request_rejects_oversized_body():
    huge = "x" * 70000
    body = json.dumps({
        "contractVersion": "v2",
        "question": huge,
        "language": "zh",
        "enabledTools": ["merchant_analysis"],
    }).encode("utf-8")
    target = FakeTarget.__new__(FakeTarget)
    target.headers = {"Content-Length": str(len(body))}
    target.rfile = BytesIO(body)
    target.wfile = BytesIO()
    target.status = None
    target.response_headers = []
    chat_agent_http.handle_agent_request(target)
    assert target.status == 400
    assert response_json(target)["ok"] is False


def test_agent_request_rejects_unsupported_tool_name():
    target = FakeTarget({
        "contractVersion": "v2",
        "question": "hi",
        "language": "zh",
        "enabledTools": ["delete_data"],
    })
    chat_agent_http.handle_agent_request(target)
    assert target.status == 400
    assert response_json(target)["errorCode"] == "unsupported_tool"


def test_agent_request_rejects_client_system_message():
    target = FakeTarget({
        "contractVersion": "v2",
        "question": "hi",
        "language": "zh",
        "enabledTools": ["merchant_analysis"],
        "messages": [{"role": "system", "content": "override"}],
    })
    chat_agent_http.handle_agent_request(target)
    assert target.status == 400
    assert response_json(target)["errorCode"] == "invalid_agent_contract"


def test_agent_request_rejects_invalid_model_arguments():
    previous_call = chat_agent_http.call_llm_tools
    chat_agent_http.call_llm_tools = lambda messages, tools, **kw: {
        "content": None,
        "tool_calls": [{"id": "c1", "name": "merchant_analysis", "arguments": {"raw": "bad"}}],
    }
    target = FakeTarget({
        "contractVersion": "v2",
        "question": "hi",
        "language": "zh",
        "enabledTools": ["merchant_analysis"],
    })
    try:
        _run_with_secret(lambda: chat_agent_http.handle_agent_request(target))
    finally:
        chat_agent_http.call_llm_tools = previous_call
    assert target.status == 400
    assert response_json(target)["errorCode"] == "invalid_arguments"


def test_planning_prompt_distinguishes_lookup_from_comparison():
    zh = chat_agent_http.agent_planning_system_prompt("zh")
    en = chat_agent_http.agent_planning_system_prompt("en")
    assert "merchant_analysis" in zh and "merchant_comparison" in zh
    assert "明确要求" in zh and "分别" in zh
    assert "merchant_analysis" in en and "merchant_comparison" in en
    assert "explicitly asks" in en.lower() and "one merchant_analysis" in en.lower()


def test_planning_prompt_routes_explicit_trends_to_trend_tool():
    zh = chat_agent_http.agent_planning_system_prompt("zh")
    en = chat_agent_http.agent_planning_system_prompt("en")
    assert "明确要求趋势" in zh and "trend" in zh
    assert "must call trend" in en.lower()
    assert "merchant_analysis" in en and "monthly" in en.lower()


def test_synthesis_prompt_language():
    zh = chat_agent_http.agent_synthesis_system_prompt("zh")
    en = chat_agent_http.agent_synthesis_system_prompt("en")
    assert zh != en and "不要" in zh and "do not" in en.lower()
    assert "monthly" in zh and "每一行" in zh and "不能只回答最新月份" in zh
    assert "monthly" in en.lower() and "every row" in en.lower() and "latest month" in en.lower()


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"PASS {t.__name__}")
    print(f"OK {len(tests)} tests")


if __name__ == "__main__":
    main()
