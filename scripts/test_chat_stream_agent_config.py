from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import chat_agent_http


def main():
    assert chat_agent_http.AGENT_MAX_REQUEST_BYTES == 64 * 1024
    assert chat_agent_http.AGENT_SYNTHESIS_MAX_REQUEST_BYTES == 128 * 1024
    assert chat_agent_http.AGENT_SYNTHESIS_MAX_TOKENS == 4096
    for relative in ("server.py", "api/chat/stream.py"):
        source = (ROOT / relative).read_text(encoding="utf-8")
        assert "max_tokens=AGENT_SYNTHESIS_MAX_TOKENS" in source, f"{relative} must use the shared Agent synthesis budget"
        assert "AGENT_SYNTHESIS_MAX_REQUEST_BYTES" in source, f"{relative} must use the shared Agent synthesis request limit"
    print("Agent synthesis stream configuration checks passed")


if __name__ == "__main__":
    main()
