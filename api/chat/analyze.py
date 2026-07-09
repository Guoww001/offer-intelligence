from http.server import BaseHTTPRequestHandler

from auth import _read_json_body, require_auth, send_json
from llm_classify import generate_analysis_text


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        send_json(self, 204, {})

    def do_POST(self):
        if not require_auth(self):
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 8192:
            send_json(self, 400, {"ok": False, "error": "Request body is too large"})
            return

        try:
            body = _read_json_body(self)
        except (ValueError, Exception):
            send_json(self, 400, {"ok": False, "error": "Invalid JSON body"})
            return

        summary = body.get("summary")
        if not isinstance(summary, dict):
            send_json(self, 400, {"ok": False, "error": "summary must be a JSON object"})
            return

        language = str(body.get("language") or "en").strip()
        if language not in ("en", "zh"):
            language = "en"

        text = generate_analysis_text(summary, language)
        if text is None:
            send_json(self, 200, {"ok": False, "error": "LLM analysis unavailable"})
        else:
            send_json(self, 200, {"ok": True, "text": text})
