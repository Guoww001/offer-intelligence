import importlib.util
import os
from pathlib import Path
import sys
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

spec = importlib.util.spec_from_file_location("llm_provider", ROOT / "llm_provider.py")
llm_provider = importlib.util.module_from_spec(spec)
spec.loader.exec_module(llm_provider)
import chat_agent_http


def test_normalize_deepseek_tool_calls():
    message = SimpleNamespace(
        content=None,
        tool_calls=[
            SimpleNamespace(id="c1", function=SimpleNamespace(name="merchant_analysis", arguments='{"merchant": "Shokz"}')),
            SimpleNamespace(id="c2", function=SimpleNamespace(name="category_analysis", arguments='{"category": "Electronics"}')),
        ],
    )
    result = llm_provider.normalize_tool_response("deepseek", message)
    assert result["content"] is None
    assert result["tool_calls"][0] == {"id": "c1", "name": "merchant_analysis", "arguments": {"merchant": "Shokz"}}
    assert result["tool_calls"][1]["arguments"] == {"category": "Electronics"}


def test_normalize_deepseek_invalid_json_arguments():
    message = SimpleNamespace(
        content="fallback text",
        tool_calls=[SimpleNamespace(id="c1", function=SimpleNamespace(name="merchant_analysis", arguments="{not json"))],
    )
    result = llm_provider.normalize_tool_response("deepseek", message)
    args = result["tool_calls"][0]["arguments"]
    assert args["_raw"] == "{not json" and args["_parse_error"] is True
    assert result["content"] == "fallback text"


def test_normalize_claude_tool_use():
    content = [
        SimpleNamespace(type="text", text="I will look that up."),
        SimpleNamespace(type="tool_use", id="t1", name="category_analysis", input={"category": "Electronics"}),
    ]
    result = llm_provider.normalize_tool_response("claude", content)
    assert result["content"] == "I will look that up."
    assert result["tool_calls"] == [{"id": "t1", "name": "category_analysis", "arguments": {"category": "Electronics"}}]


def test_call_llm_tools_returns_none_without_api_key():
    old_provider = os.environ.get("OI_LLM_PROVIDER")
    old_key = os.environ.get("DEEPSEEK_API_KEY")
    os.environ["OI_LLM_PROVIDER"] = "deepseek"
    os.environ["DEEPSEEK_API_KEY"] = ""
    try:
        assert llm_provider.call_llm_tools([{"role": "user", "content": "hi"}], []) is None
    finally:
        if old_provider is None: os.environ.pop("OI_LLM_PROVIDER", None)
        else: os.environ["OI_LLM_PROVIDER"] = old_provider
        if old_key is None: os.environ.pop("DEEPSEEK_API_KEY", None)
        else: os.environ["DEEPSEEK_API_KEY"] = old_key


def test_call_llm_tools_deepseek_payload():
    captured = {}

    class FakeMessage:
        content = None
        tool_calls = [SimpleNamespace(id="c1", function=SimpleNamespace(name="merchant_analysis", arguments='{"merchant":"Shokz"}'))]

    class FakeResponse:
        choices = [SimpleNamespace(message=FakeMessage)]

    class FakeCompletions:
        def create(self, **kwargs):
            captured.update(kwargs)
            return FakeResponse()

    class FakeClient:
        chat = SimpleNamespace(completions=FakeCompletions())

    class FakeOpenAI(FakeClient):
        def __init__(self, **kwargs): pass

    fake_openai = SimpleNamespace(OpenAI=FakeOpenAI)
    sys.modules["openai"] = fake_openai
    old_provider = os.environ.get("OI_LLM_PROVIDER")
    old_key = os.environ.get("DEEPSEEK_API_KEY")
    old_model = os.environ.get("OI_LLM_MODEL_DEEPSEEK")
    os.environ["OI_LLM_PROVIDER"] = "deepseek"
    os.environ["DEEPSEEK_API_KEY"] = "test-key"
    os.environ["OI_LLM_MODEL_DEEPSEEK"] = "deepseek-v4-flash"
    try:
        result = llm_provider.call_llm_tools(
            [{"role": "system", "content": "sys"}, {"role": "user", "content": "Shokz 表现"}],
            [{"name": "merchant_analysis", "description": "d", "parameters": {"type": "object", "properties": {}}}],
        )
        assert result is not None and result["tool_calls"][0]["name"] == "merchant_analysis"
        assert captured["tools"][0] == {"type": "function", "function": {"name": "merchant_analysis", "description": "d", "parameters": {"type": "object", "properties": {}}}}
        assert captured["tool_choice"] == "auto"
        assert captured["messages"][0]["role"] == "system"
    finally:
        del sys.modules["openai"]
        if old_provider is None: os.environ.pop("OI_LLM_PROVIDER", None)
        else: os.environ["OI_LLM_PROVIDER"] = old_provider
        if old_key is None: os.environ.pop("DEEPSEEK_API_KEY", None)
        else: os.environ["DEEPSEEK_API_KEY"] = old_key
        if old_model is None: os.environ.pop("OI_LLM_MODEL_DEEPSEEK", None)
        else: os.environ["OI_LLM_MODEL_DEEPSEEK"] = old_model


def test_stream_chat_messages_passthrough():
    captured = {}

    class FakeChunk:
        def __init__(self):
            self.choices = [SimpleNamespace(delta=SimpleNamespace(content="ok"))]

    class FakeStream:
        def __iter__(self):
            yield FakeChunk()
            return

    class FakeCompletions:
        def create(self, **kwargs):
            captured.update(kwargs)
            return FakeStream()

    class FakeClient:
        chat = SimpleNamespace(completions=FakeCompletions())

    class FakeOpenAI(FakeClient):
        def __init__(self, **kwargs): pass

    sys.modules["openai"] = SimpleNamespace(OpenAI=FakeOpenAI)
    old_provider = os.environ.get("OI_LLM_PROVIDER")
    old_key = os.environ.get("DEEPSEEK_API_KEY")
    old_model = os.environ.get("OI_LLM_MODEL_DEEPSEEK")
    os.environ["OI_LLM_PROVIDER"] = "deepseek"
    os.environ["DEEPSEEK_API_KEY"] = "test-key"
    os.environ["OI_LLM_MODEL_DEEPSEEK"] = "deepseek-v4-flash"
    try:
        tokens = list(llm_provider.stream_chat(
            "ignored",
            "sys",
            messages=[{"role": "user", "content": "Q"}, {"role": "assistant", "content": "A"}],
        ))
        assert tokens == ["ok"]
        sent = captured["messages"]
        assert sent[0] == {"role": "system", "content": "sys"}
        assert sent[1] == {"role": "user", "content": "Q"}
        assert sent[2] == {"role": "assistant", "content": "A"}
        assert len(sent) == 3  # user_message 未被追加
        assert captured["extra_body"] == {"thinking": {"type": "disabled"}}
    finally:
        del sys.modules["openai"]
        if old_provider is None: os.environ.pop("OI_LLM_PROVIDER", None)
        else: os.environ["OI_LLM_PROVIDER"] = old_provider
        if old_key is None: os.environ.pop("DEEPSEEK_API_KEY", None)
        else: os.environ["DEEPSEEK_API_KEY"] = old_key
        if old_model is None: os.environ.pop("OI_LLM_MODEL_DEEPSEEK", None)
        else: os.environ["OI_LLM_MODEL_DEEPSEEK"] = old_model


def test_agent_synthesis_budget_is_shared_by_local_and_vercel():
    assert chat_agent_http.AGENT_SYNTHESIS_MAX_TOKENS == 4096
    for relative in ("server.py", "api/chat/stream.py"):
        source = (ROOT / relative).read_text(encoding="utf-8")
        assert "max_tokens=AGENT_SYNTHESIS_MAX_TOKENS" in source, f"{relative} must use the shared Agent synthesis budget"


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"PASS {t.__name__}")
    print(f"OK {len(tests)} tests")


if __name__ == "__main__":
    main()
