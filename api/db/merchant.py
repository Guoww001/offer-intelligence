from http.server import BaseHTTPRequestHandler

from offer_db import (
    first_query_value,
    handle_options,
    int_query_value,
    merchant_payload,
    parse_query,
    require_db_token,
    send_db_error,
    send_json,
)


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        handle_options(self)

    def do_GET(self):
        if not require_db_token(self):
            return
        query = parse_query(self)
        merchant_id = first_query_value(query, "merchantId")
        if not merchant_id:
            send_json(self, 400, {"ok": False, "error": "merchantId is required"})
            return
        limit = int_query_value(query, "limit", 50, 1, 100)
        months = int_query_value(query, "months", 12, 1, 36)
        try:
            send_json(self, 200, merchant_payload(merchant_id, product_limit=limit, months=months))
        except ValueError as error:
            send_json(self, 400, {"ok": False, "error": str(error)})
        except Exception as error:
            send_db_error(self, error)
