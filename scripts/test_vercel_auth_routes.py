import importlib.util
from io import BytesIO
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
APP_PATH = ROOT / "api" / "auth" / "index.py"
sys.path.insert(0, str(ROOT))


class FakeTarget:
    def __init__(self):
        self.headers = {}
        self.rfile = BytesIO()
        self.wfile = BytesIO()
        self.status = None
        self.response_headers = []

    def send_response(self, status):
        self.status = int(status)

    def send_header(self, name, value):
        self.response_headers.append((str(name), str(value)))

    def end_headers(self):
        return None


def load_module():
    if not APP_PATH.is_file():
        raise AssertionError("missing consolidated auth entrypoint api/auth/index.py")
    spec = importlib.util.spec_from_file_location("vercel_auth_routes", APP_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    module = load_module()
    calls = []
    module.handle_auth_options = lambda target: calls.append("options")
    module.handle_auth_session = lambda target: calls.append("session")
    module.handle_auth_login = lambda target: calls.append("login")
    module.handle_auth_logout = lambda target: calls.append("logout")

    for method, route, expected in (
        ("OPTIONS", "login", "options"),
        ("GET", "session", "session"),
        ("POST", "login", "login"),
        ("POST", "logout", "logout"),
    ):
        calls.clear()
        module.dispatch_request(FakeTarget(), method, route)
        if calls != [expected]:
            raise AssertionError(
                f"{method} {route} dispatched {calls!r}; expected {expected!r}"
            )

    wrong_method = FakeTarget()
    module.dispatch_request(wrong_method, "GET", "login")
    if wrong_method.status != 405:
        raise AssertionError(f"wrong auth method should return 405, got {wrong_method.status}")

    unknown_route = FakeTarget()
    module.dispatch_request(unknown_route, "POST", "unknown")
    if unknown_route.status != 404:
        raise AssertionError(f"unknown auth route should return 404, got {unknown_route.status}")

    print("Vercel consolidated auth route checks passed")


if __name__ == "__main__":
    main()
