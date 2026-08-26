from __future__ import annotations

import os
from pathlib import Path
import sys
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import llm_provider


def _set_env(values):
    previous = {key: os.environ.get(key) for key in values}
    for key, value in values.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
    return previous


def _restore_env(previous):
    for key, value in previous.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value


def _install_module(name, module):
    previous = sys.modules.get(name)
    sys.modules[name] = module
    return previous


def _restore_module(name, previous):
    if previous is None:
        sys.modules.pop(name, None)
    else:
        sys.modules[name] = previous


def _openai_module(response):
    class FakeCompletions:
        def create(self, **kwargs):
            return response

    class FakeClient:
        chat = SimpleNamespace(completions=FakeCompletions())

        def __init__(self, **kwargs):
            self.config = kwargs

    return SimpleNamespace(OpenAI=FakeClient)


def test_openai_usage_is_normalized():
    response = SimpleNamespace(
        usage=SimpleNamespace(prompt_tokens=11, completion_tokens=7, total_tokens=18),
        choices=[SimpleNamespace(message=SimpleNamespace(content="ok", tool_calls=[]))],
    )
    previous_env = _set_env({
        "OI_LLM_PROVIDER": "deepseek",
        "DEEPSEEK_API_KEY": "test-key",
        "OI_LLM_MODEL_DEEPSEEK": "deepseek-test",
    })
    previous_module = _install_module("openai", _openai_module(response))
    try:
        result = llm_provider.call_llm_tools(
            [{"role": "user", "content": "hello"}],
            [],
            return_metadata=True,
        )
        assert result["ok"] is True
        assert result["provider"] == "deepseek"
        assert result["model"] == "deepseek-test"
        assert result["usageAvailable"] is True
        assert result["inputTokens"] == 11
        assert result["outputTokens"] == 7
        assert result["totalTokens"] == 18
    finally:
        _restore_module("openai", previous_module)
        _restore_env(previous_env)


def test_anthropic_usage_is_normalized_without_provider_response_leak():
    message = SimpleNamespace(
        content=[SimpleNamespace(type="text", text="ok")],
        usage=SimpleNamespace(input_tokens=13, output_tokens=5),
    )

    class FakeAnthropic:
        def __init__(self, **kwargs):
            pass

        class messages:
            @staticmethod
            def create(**kwargs):
                return message

    previous_env = _set_env({
        "OI_LLM_PROVIDER": "claude",
        "ANTHROPIC_API_KEY": "test-key",
        "OI_LLM_MODEL_CLAUDE": "claude-test",
    })
    previous_module = _install_module("anthropic", SimpleNamespace(Anthropic=FakeAnthropic))
    try:
        result = llm_provider.call_llm_tools(
            [{"role": "user", "content": "hello"}],
            [],
            return_metadata=True,
        )
        assert result["ok"] is True
        assert result["provider"] == "claude"
        assert result["inputTokens"] == 13
        assert result["outputTokens"] == 5
        assert result["totalTokens"] == 18
        assert "response" not in result and "rawJson" not in result
    finally:
        _restore_module("anthropic", previous_module)
        _restore_env(previous_env)


def test_missing_usage_never_uses_character_or_chunk_counts():
    response = SimpleNamespace(
        usage=None,
        choices=[SimpleNamespace(message=SimpleNamespace(content="lots of text", tool_calls=[]))],
    )
    previous_env = _set_env({"OI_LLM_PROVIDER": "deepseek", "DEEPSEEK_API_KEY": "test-key"})
    previous_module = _install_module("openai", _openai_module(response))
    try:
        result = llm_provider.call_llm_tools(
            [{"role": "user", "content": "hello"}], [], return_metadata=True
        )
        assert result["usageAvailable"] is False
        assert result["inputTokens"] is None
        assert result["outputTokens"] is None
        assert result["totalTokens"] is None
    finally:
        _restore_module("openai", previous_module)
        _restore_env(previous_env)


def test_call_llm_tools_default_shape_remains_compatible():
    response = SimpleNamespace(
        usage=None,
        choices=[SimpleNamespace(message=SimpleNamespace(content="ok", tool_calls=[]))],
    )
    previous_env = _set_env({"OI_LLM_PROVIDER": "deepseek", "DEEPSEEK_API_KEY": "test-key"})
    previous_module = _install_module("openai", _openai_module(response))
    try:
        result = llm_provider.call_llm_tools([{ "role": "user", "content": "hello" }], [])
        assert set(result) == {"content", "tool_calls"}
    finally:
        _restore_module("openai", previous_module)
        _restore_env(previous_env)


def _stream_module(chunks):
    class FakeStream:
        def __iter__(self):
            for chunk in chunks:
                yield chunk

    class FakeCompletions:
        def create(self, **kwargs):
            return FakeStream()

    class FakeClient:
        chat = SimpleNamespace(completions=FakeCompletions())

        def __init__(self, **kwargs):
            pass

    return SimpleNamespace(OpenAI=FakeClient)


def _chunk(text="", *, usage=None, finish=None):
    return SimpleNamespace(
        choices=[SimpleNamespace(delta=SimpleNamespace(content=text), finish_reason=finish)],
        usage=usage,
    )


def test_stream_callback_receives_real_usage_once():
    chunks = [
        _chunk("hello"),
        _chunk("!", usage=SimpleNamespace(prompt_tokens=20, completion_tokens=2, total_tokens=22), finish="stop"),
    ]
    previous_env = _set_env({"OI_LLM_PROVIDER": "deepseek", "DEEPSEEK_API_KEY": "test-key"})
    previous_module = _install_module("openai", _stream_module(chunks))
    callbacks = []
    try:
        tokens = list(llm_provider.stream_chat("q", "sys", on_complete=callbacks.append))
        assert tokens == ["hello", "!"]
        assert len(callbacks) == 1
        assert callbacks[0]["usageAvailable"] is True
        assert callbacks[0]["outputTokens"] == 2
        assert callbacks[0]["finishReason"] == "stop"
    finally:
        _restore_module("openai", previous_module)
        _restore_env(previous_env)


def test_stream_without_usage_reports_null_tokens_once():
    previous_env = _set_env({"OI_LLM_PROVIDER": "deepseek", "DEEPSEEK_API_KEY": "test-key"})
    previous_module = _install_module("openai", _stream_module([_chunk("hello", finish="stop")]))
    callbacks = []
    try:
        list(llm_provider.stream_chat("q", "sys", on_complete=callbacks.append))
        assert len(callbacks) == 1
        assert callbacks[0]["usageAvailable"] is False
        assert callbacks[0]["inputTokens"] is None
        assert callbacks[0]["outputTokens"] is None
        assert callbacks[0]["totalTokens"] is None
    finally:
        _restore_module("openai", previous_module)
        _restore_env(previous_env)


def test_claude_stream_callback_reads_final_message_usage():
    class FakeStream:
        text_stream = ["hello"]

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get_final_message(self):
            return SimpleNamespace(
                usage=SimpleNamespace(input_tokens=31, output_tokens=4)
            )

    class FakeMessages:
        @staticmethod
        def stream(**kwargs):
            return FakeStream()

    class FakeAnthropic:
        messages = FakeMessages()

        def __init__(self, **kwargs):
            pass

    previous_env = _set_env({
        "OI_LLM_PROVIDER": "claude",
        "ANTHROPIC_API_KEY": "test-key",
        "OI_LLM_MODEL_CLAUDE": "claude-test",
    })
    previous_module = _install_module("anthropic", SimpleNamespace(Anthropic=FakeAnthropic))
    callbacks = []
    try:
        tokens = list(llm_provider.stream_chat("q", "sys", on_complete=callbacks.append))
        assert tokens == ["hello"]
        assert len(callbacks) == 1
        assert callbacks[0]["usageAvailable"] is True
        assert callbacks[0]["inputTokens"] == 31
        assert callbacks[0]["outputTokens"] == 4
        assert callbacks[0]["totalTokens"] == 35
    finally:
        _restore_module("anthropic", previous_module)
        _restore_env(previous_env)


def test_stream_timeout_callback_is_controlled_and_single():
    class TimeoutStream:
        def __iter__(self):
            raise TimeoutError("provider timeout with secret details")

    class FakeCompletions:
        def create(self, **kwargs):
            return TimeoutStream()

    class FakeClient:
        chat = SimpleNamespace(completions=FakeCompletions())

        def __init__(self, **kwargs):
            pass

    previous_env = _set_env({"OI_LLM_PROVIDER": "deepseek", "DEEPSEEK_API_KEY": "test-key"})
    previous_module = _install_module("openai", SimpleNamespace(OpenAI=FakeClient))
    callbacks = []
    try:
        list(llm_provider.stream_chat("q", "sys", on_complete=callbacks.append))
        assert len(callbacks) == 1
        assert callbacks[0]["errorCode"] == "llm_timeout"
        assert "secret" not in str(callbacks[0])
    finally:
        _restore_module("openai", previous_module)
        _restore_env(previous_env)


def main():
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    for test in tests:
        test()
        print(f"PASS {test.__name__}")
    print(f"OK {len(tests)} tests")


if __name__ == "__main__":
    main()
