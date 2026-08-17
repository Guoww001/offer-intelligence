import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import auth  # noqa: E402


def test_agent_enabled_defaults_on():
    old = os.environ.get("OI_AGENT_ENABLED")
    os.environ.pop("OI_AGENT_ENABLED", None)
    try:
        assert auth.agent_enabled() is True
    finally:
        if old is not None:
            os.environ["OI_AGENT_ENABLED"] = old


def test_agent_enabled_off_values():
    old = os.environ.get("OI_AGENT_ENABLED")
    try:
        for value in ("0", "false", "no", "off"):
            os.environ["OI_AGENT_ENABLED"] = value
            assert auth.agent_enabled() is False, value
        os.environ["OI_AGENT_ENABLED"] = "1"
        assert auth.agent_enabled() is True
    finally:
        if old is None:
            os.environ.pop("OI_AGENT_ENABLED", None)
        else:
            os.environ["OI_AGENT_ENABLED"] = old


def main():
    test_agent_enabled_defaults_on()
    print("PASS test_agent_enabled_defaults_on")
    test_agent_enabled_off_values()
    print("PASS test_agent_enabled_off_values")
    print("OK 2 tests")


if __name__ == "__main__":
    main()
