from http.server import BaseHTTPRequestHandler
import json
import sys

from auth import _read_json_body, require_auth
from llm_provider import stream_chat


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        """SSE streaming endpoint for Chat Mode LLM conversation."""
        if not require_auth(self):
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 65536:
            self._send_json(400, {"ok": False, "error": "Request body is too large"})
            return

        try:
            body = _read_json_body(self)
        except (ValueError, Exception):
            self._send_json(400, {"ok": False, "error": "Invalid JSON body"})
            return

        prompt = str(body.get("prompt") or "").strip()
        if not prompt:
            self._send_json(400, {"ok": False, "error": "prompt is required"})
            return

        memory = str(body.get("memory") or "").strip() or None
        language = str(body.get("language") or "zh").strip()
        if language not in ("en", "zh"):
            language = "zh"
        history = body.get("history") or None

        # Build system prompt
        system_parts = [
            "你是一个亚马逊联盟营销数据分析助手，帮助用户分析广告活动、商家表现和付款数据。",
            "请根据用户提供的信息和已有的数据分析结果，回答用户的问题。",
            "回答要简洁、准确、有数据支撑。如果问题涉及具体数据但上下文中没有提供，",
            "请说明缺少哪些数据并给出一般性分析建议。",
        ]
        if language == "en":
            system_parts = [
                "You are an Amazon affiliate marketing data analysis assistant.",
                "Answer user questions based on their input and any provided context.",
                "Be concise, accurate, and data-driven. If specific data is not available,"
                " explain what's missing and give general analysis advice.",
            ]
        if memory:
            system_parts.append(
                f"\n\n用户已有的分析上下文（来自拖入的面板）：\n{memory}\n"
                "请优先参考以上上下文来回答问题。如果问题与上下文无关，可以忽略。"
            )

        system_prompt = "\n".join(system_parts)

        # SSE streaming
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()

            token_count = 0
            for token in stream_chat(prompt, system_prompt, max_tokens=2048, temperature=0.7, history=history):
                if token:
                    self.wfile.write(f"data: {json.dumps({'token': token}, ensure_ascii=False)}\n\n".encode("utf-8"))
                    self.wfile.flush()
                    token_count += 1

            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
            print(f"[chat_stream] sent {token_count} tokens for prompt={prompt[:60]!r}", file=sys.stderr)

        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            print(f"[chat_stream] client disconnected: {prompt[:60]!r}", file=sys.stderr)
        except Exception as exc:
            print(f"[chat_stream] error: {exc}", file=sys.stderr)
            try:
                self.wfile.write(f"data: {json.dumps({'error': str(exc)}, ensure_ascii=False)}\n\n".encode("utf-8"))
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                pass

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
