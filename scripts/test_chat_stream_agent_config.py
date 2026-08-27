from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import chat_agent_http


def test_synthesis_readers_use_shared_request_limit():
    for relative in ("server.py", "api/chat/stream.py"):
        source = (ROOT / relative).read_text(encoding="utf-8")
        assert "_read_json_body(self, max_size=AGENT_SYNTHESIS_MAX_REQUEST_BYTES)" in source, (
            f"{relative} must pass the shared Agent synthesis request limit to _read_json_body"
        )


def test_synthesis_entries_use_structured_contract():
    for relative in ("server.py", "api/chat/stream.py"):
        source = (ROOT / relative).read_text(encoding="utf-8")
        assert "validate_synthesis_request" in source, f"{relative} must validate Agent synthesis requests"
        assert "validate_bound_tool_results" in source, f"{relative} must bind Agent tool results"
        assert "build_synthesis_messages" in source, f"{relative} must build provider messages on the server"
        assert "agent_synthesis=True" in source, f"{relative} must mark the internal synthesis stream"
        assert "messages = body.get(\"messages\")" not in source, f"{relative} must not expose a messages bypass"
        assert "if isinstance(messages, list) and messages" not in source, f"{relative} must not stream client messages directly"


def main():
    assert chat_agent_http.AGENT_MAX_REQUEST_BYTES == 64 * 1024
    assert chat_agent_http.AGENT_SYNTHESIS_MAX_REQUEST_BYTES == 128 * 1024
    assert chat_agent_http.AGENT_SYNTHESIS_MAX_TOKENS == 4096
    test_synthesis_readers_use_shared_request_limit()
    test_synthesis_entries_use_structured_contract()
    for relative in ("server.py", "api/chat/stream.py"):
        source = (ROOT / relative).read_text(encoding="utf-8")
        assert "max_tokens=AGENT_SYNTHESIS_MAX_TOKENS" in source, f"{relative} must use the shared Agent synthesis budget"
        assert "AGENT_SYNTHESIS_MAX_REQUEST_BYTES" in source, f"{relative} must use the shared Agent synthesis request limit"
        assert "usageAvailable" in source, f"{relative} must expose provider usage metadata"
        assert "type\": \"usage\"" in source, f"{relative} must send a usage SSE event"
    print("Agent synthesis stream configuration checks passed")


if __name__ == "__main__":
    main()
