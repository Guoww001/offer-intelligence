from http.server import BaseHTTPRequestHandler

from auth import require_auth
from offer_db import (
    first_query_value,
    handle_options,
    offers_payload,
    parse_query,
    send_db_error,
    send_json,
)


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        handle_options(self)

    def do_GET(self):
        if not require_auth(self):
            return
        query = parse_query(self)
        month = first_query_value(query, "month") or None
        try:
            send_json(self, 200, offers_payload(month=month))
        except ValueError as error:
            send_json(self, 400, {"ok": False, "error": str(error)})
        except Exception as error:
            send_db_error(self, error)
