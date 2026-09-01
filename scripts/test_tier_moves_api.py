import contextlib
import io
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from api import tier_moves


class Target:
    def __init__(self, body=b"", headers=None):
        self.headers = {"Content-Length": str(len(body)), **(headers or {})}
        self.rfile = io.BytesIO(body)
        self.status = None
        self.response_headers = []
        self.wfile = io.BytesIO()

    def send_response(self, status):
        self.status = status

    def send_header(self, name, value):
        self.response_headers.append((name, value))

    def end_headers(self):
        return None

    def payload(self):
        raw = self.wfile.getvalue()
        return json.loads(raw.decode("utf-8")) if raw else None


class WebhookResponse:
    status = 200

    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self):
        return self.body


@contextlib.contextmanager
def env(**updates):
    previous = {key: os.environ.get(key) for key in updates}
    try:
        for key, value in updates.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def assert_equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def test_json_body_must_be_object():
    target = Target(b"[]")
    try:
        tier_moves._read_json_body(target)
    except ValueError as error:
        assert_equal(str(error), "Request body must be a JSON object", "array body error")
    else:
        raise AssertionError("array JSON body should be rejected")


def test_json_body_has_size_limit():
    target = Target(b"{" + b"a" * (256 * 1024) + b"}")
    try:
        tier_moves._read_json_body(target)
    except ValueError as error:
        assert_equal(str(error), "Request body is too large", "oversized body error")
    else:
        raise AssertionError("oversized JSON body should be rejected")


def test_webhook_response_must_be_object():
    original_urlopen = tier_moves.urlopen
    tier_moves.urlopen = lambda *_args, **_kwargs: WebhookResponse(b"[]")
    try:
        with env(TIER_MOVES_WEBHOOK_URL="https://example.test/tier-moves"):
            status, payload = tier_moves._call_webhook("GET")
    finally:
        tier_moves.urlopen = original_urlopen
    assert_equal(status, 502, "invalid webhook response status")
    assert_equal(payload["ok"], False, "invalid webhook response ok")
    assert_equal(payload["moves"], [], "invalid webhook response moves")


def test_handler_returns_400_for_array_body():
    target = Target(b"[]")
    with env(OI_AUTH_ENABLED="0", TIER_MOVES_ADMIN_TOKEN=None, TIER_MOVES_WEBHOOK_URL=None):
        tier_moves.handle_tier_moves(target, "POST")
    assert_equal(target.status, 400, "array request status")
    assert_equal(target.payload()["error"], "Request body must be a JSON object", "array request error")


def test_handler_rejects_non_array_moves():
    target = Target(json.dumps({"moves": ""}).encode("utf-8"))
    with env(OI_AUTH_ENABLED="0", TIER_MOVES_ADMIN_TOKEN=None, TIER_MOVES_WEBHOOK_URL=None):
        tier_moves.handle_tier_moves(target, "POST")
    assert_equal(target.status, 400, "non-array moves status")
    assert_equal(target.payload()["error"], "moves must be an array", "non-array moves error")


def main():
    test_json_body_must_be_object()
    test_json_body_has_size_limit()
    test_webhook_response_must_be_object()
    test_handler_returns_400_for_array_body()
    test_handler_rejects_non_array_moves()
    print("PASS: Tier Move API boundary contract")


if __name__ == "__main__":
    main()
