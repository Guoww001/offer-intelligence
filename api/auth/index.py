from http.server import BaseHTTPRequestHandler

from auth import (
    handle_auth_login,
    handle_auth_logout,
    handle_auth_options,
    handle_auth_session,
    send_json,
)


AUTH_METHODS = {
    "login": "POST",
    "logout": "POST",
    "session": "GET",
}


def dispatch_request(target, method, route):
    expected_method = AUTH_METHODS.get(route)
    if expected_method is None:
        send_json(target, 404, {"ok": False, "error": "Unknown authentication route"})
        return

    if method == "OPTIONS":
        handle_auth_options(target)
        return

    if method != expected_method:
        send_json(target, 405, {"ok": False, "error": "Method not allowed"})
        return

    if route == "login":
        handle_auth_login(target)
    elif route == "logout":
        handle_auth_logout(target)
    else:
        handle_auth_session(target)


class handler(BaseHTTPRequestHandler):
    def _dispatch(self, method):
        route = str(self.headers.get("X-Oi-Auth-Route") or "").strip()
        dispatch_request(self, method, route)

    def do_OPTIONS(self):
        self._dispatch("OPTIONS")

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")
