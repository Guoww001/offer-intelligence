from http.server import BaseHTTPRequestHandler

from auth import handle_auth_options
from protected_payloads import handle_protected_data


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        handle_auth_options(self)

    def do_GET(self):
        handle_protected_data(self)
