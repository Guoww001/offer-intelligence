from http.server import BaseHTTPRequestHandler

from auth import require_auth
from offer_db import (
    handle_options,
    product_keywords_payload,
    send_db_error,
    send_json,
)


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        handle_options(self)

    def do_GET(self):
        if not require_auth(self):
            return
        try:
            send_json(self, 200, product_keywords_payload())
        except Exception as error:
            send_db_error(self, error)
