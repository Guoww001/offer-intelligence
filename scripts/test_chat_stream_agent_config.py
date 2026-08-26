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


def main():
    assert chat_agent_http.AGENT_MAX_REQUEST_BYTES == 64 * 1024
    assert chat_agent_http.AGENT_SYNTHESIS_MAX_REQUEST_BYTES == 128 * 1024
    assert chat_agent_http.AGENT_SYNTHESIS_MAX_TOKENS == 4096
    test_synthesis_readers_use_shared_request_limit()
    for relative in ("server.py", "api/chat/stream.py"):
        source = (ROOT / relative).read_text(encoding="utf-8")
        assert "max_tokens=AGENT_SYNTHESIS_MAX_TOKENS" in source, f"{relative} must use the shared Agent synthesis budget"
        assert "AGENT_SYNTHESIS_MAX_REQUEST_BYTES" in source, f"{relative} must use the shared Agent synthesis request limit"
        assert "usageAvailable" in source, f"{relative} must expose provider usage metadata"
        assert "type\": \"usage\"" in source, f"{relative} must send a usage SSE event"
    print("Agent synthesis stream configuration checks passed")


if __name__ == "__main__":
    main()
