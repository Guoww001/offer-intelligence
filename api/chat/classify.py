from http.server import BaseHTTPRequestHandler

from auth import _read_json_body, require_auth, send_json
from llm_classify import classify_intent


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        send_json(self, 204, {})

    def do_POST(self):
        if not require_auth(self):
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 2048:
            send_json(self, 400, {"ok": False, "error": "Request body is too large"})
            return

        try:
            body = _read_json_body(self)
        except (ValueError, Exception):
            send_json(self, 400, {"ok": False, "error": "Invalid JSON body"})
            return

        prompt = str(body.get("prompt") or "").strip()
        if not prompt:
            send_json(self, 400, {"ok": False, "error": "prompt is required"})
            return

        categories = body.get("categories") or []
        if not isinstance(categories, list):
            categories = []

        result = classify_intent(prompt, categories)
        if result is None:
            send_json(self, 200, {"intent": None, "params": None})
        else:
            send_json(self, 200, result)
