import os
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import llm_provider


def assert_equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def main():
    old_value = os.environ.get("OI_LLM_STREAM_TIMEOUT")
    try:
        os.environ.pop("OI_LLM_STREAM_TIMEOUT", None)
        assert_equal(llm_provider.stream_timeout(), 50.0, "default stream timeout")

        os.environ["OI_LLM_STREAM_TIMEOUT"] = "25.5"
        assert_equal(llm_provider.stream_timeout(), 25.5, "configured stream timeout")

        os.environ["OI_LLM_STREAM_TIMEOUT"] = "1"
        assert_equal(llm_provider.stream_timeout(), 5.0, "minimum stream timeout")

        os.environ["OI_LLM_STREAM_TIMEOUT"] = "120"
        assert_equal(llm_provider.stream_timeout(), 50.0, "maximum stream timeout")

        os.environ["OI_LLM_STREAM_TIMEOUT"] = "invalid"
        assert_equal(llm_provider.stream_timeout(), 50.0, "invalid stream timeout fallback")

        source = (ROOT / "llm_provider.py").read_text(encoding="utf-8")
        if source.count("max_retries=0") != 2:
            raise AssertionError("both streaming providers must disable automatic retries")
        if "deadline = time.monotonic() + timeout" not in source:
            raise AssertionError("streaming must enforce an application deadline")

        print("LLM streaming timeout checks passed")
    finally:
        if old_value is None:
            os.environ.pop("OI_LLM_STREAM_TIMEOUT", None)
        else:
            os.environ["OI_LLM_STREAM_TIMEOUT"] = old_value


if __name__ == "__main__":
    main()
