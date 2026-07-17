from http.server import BaseHTTPRequestHandler

from auth import _read_json_body, require_auth, send_json
from llm_classify import generate_analysis_text
from deep_reason import run_deep_reasoning


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        send_json(self, 204, {})

    def do_POST(self):
        if not require_auth(self):
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 16384:
            send_json(self, 400, {"ok": False, "error": "Request body is too large"})
            return

        try:
            body = _read_json_body(self)
        except (ValueError, Exception):
            send_json(self, 400, {"ok": False, "error": "Invalid JSON body"})
            return

        mode = str(body.get("mode") or "fast").strip()

        if mode == "deep":
            # Deep reasoning mode
            prompt = str(body.get("prompt") or "").strip()
            if not prompt:
                send_json(self, 400, {"ok": False, "error": "prompt is required for deep reasoning mode"})
                return
            language = str(body.get("language") or "zh").strip()
            if language not in ("en", "zh"):
                language = "zh"

            report = run_deep_reasoning(prompt, language)
            send_json(self, 200, {"ok": True, "mode": "deep", "report": report})
            return

        # Fast mode (existing behavior)
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
