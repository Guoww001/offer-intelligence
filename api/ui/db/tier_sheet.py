from http.server import BaseHTTPRequestHandler

from auth import require_auth
from offer_db import (
    first_query_value,
    handle_options,
    parse_query,
    send_db_error,
    send_json,
    tier_sheet_payload,
)


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        handle_options(self)

    def do_GET(self):
        if not require_auth(self):
            return
        query = parse_query(self)
        tier = first_query_value(query, "tier")
        if not tier:
            send_json(self, 400, {"ok": False, "error": "tier is required (e.g. Tier+1, Tier+2, ...)"})
            return
        month = first_query_value(query, "month") or None
        try:
            send_json(self, 200, tier_sheet_payload(tier, month=month))
        except ValueError as error:
            send_json(self, 400, {"ok": False, "error": str(error)})
        except Exception as error:
            send_db_error(self, error)
