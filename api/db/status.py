from http.server import BaseHTTPRequestHandler

from offer_db import handle_options, require_db_token, send_db_error, send_json, status_payload


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        handle_options(self)

    def do_GET(self):
        if not require_db_token(self):
            return
        try:
            send_json(self, 200, status_payload())
        except Exception as error:
            send_db_error(self, error)
