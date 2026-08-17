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


def test_agent_request_returns_tool_calls():
    captured = {}

    def fake_call(messages, tools, **kwargs):
        captured["messages"] = messages
        captured["tools"] = tools
        return PLAN_FIXTURE

    chat_agent_http.call_llm_tools = fake_call
    target = FakeTarget({
        "messages": [{"role": "user", "content": "Shokz 表现"}],
        "tools": [{"name": "merchant_analysis", "description": "d", "parameters": {"type": "object"}}],
        "language": "zh",
    })
    chat_agent_http.handle_agent_request(target)
    payload = response_json(target)
    assert target.status == 200 and payload["ok"] is True
    assert payload["finishReason"] == "tool_calls"
    assert payload["toolCalls"] == PLAN_FIXTURE["tool_calls"]
    assert captured["messages"][0]["role"] == "system"
    assert captured["messages"][-1]["content"] == "Shokz 表现"


def test_agent_request_llm_unavailable():
    chat_agent_http.call_llm_tools = lambda messages, tools, **kw: None
    target = FakeTarget({
        "messages": [{"role": "user", "content": "hi"}],
        "tools": [{"name": "merchant_analysis", "description": "d", "parameters": {"type": "object"}}],
    })
    chat_agent_http.handle_agent_request(target)
    payload = response_json(target)
    assert target.status == 200 and payload == {"ok": False, "error": "LLM unavailable"}


def test_agent_request_rejects_missing_tools():
    target = FakeTarget({"messages": [{"role": "user", "content": "hi"}]})
    chat_agent_http.handle_agent_request(target)
    assert target.status == 400
    assert response_json(target)["ok"] is False


def test_agent_request_rejects_oversized_body():
    huge = "x" * 40000
    body = json.dumps({"messages": [{"role": "user", "content": huge}], "tools": []}).encode("utf-8")
    target = FakeTarget.__new__(FakeTarget)
    target.headers = {"Content-Length": str(len(body))}
    target.rfile = BytesIO(body)
    target.wfile = BytesIO()
    target.status = None
    target.response_headers = []
    chat_agent_http.handle_agent_request(target)
    assert target.status == 400
    assert response_json(target)["ok"] is False


def test_synthesis_prompt_language():
    zh = chat_agent_http.agent_synthesis_system_prompt("zh")
    en = chat_agent_http.agent_synthesis_system_prompt("en")
    assert zh != en and "不要" in zh and "do not" in en.lower()


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"PASS {t.__name__}")
    print(f"OK {len(tests)} tests")


if __name__ == "__main__":
    main()
