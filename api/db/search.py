from http.server import BaseHTTPRequestHandler

from offer_db import (
    first_query_value,
    handle_options,
    int_query_value,
    parse_query,
    require_db_token,
    search_payload,
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
        text = first_query_value(query, "q")
        limit = int_query_value(query, "limit", 25, 1, 50)
        try:
            send_json(self, 200, search_payload(text, limit=limit))
        except Exception as error:
            send_db_error(self, error)
