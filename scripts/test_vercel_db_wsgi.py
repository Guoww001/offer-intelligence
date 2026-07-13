import importlib.util
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP_PATH = ROOT / "api" / "db" / "index.py"
sys.path.insert(0, str(ROOT))


def assert_equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def load_app_module():
    if not APP_PATH.is_file():
        raise AssertionError("missing consolidated WSGI entrypoint api/db/index.py")
    spec = importlib.util.spec_from_file_location("vercel_db_wsgi", APP_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def request(app, route, query="", method="GET", token="unit-test-token"):
    environ = {
        "REQUEST_METHOD": method,
        "PATH_INFO": "/api/db/index",
        "QUERY_STRING": query,
        "SERVER_NAME": "localhost",
        "SERVER_PORT": "80",
        "wsgi.url_scheme": "http",
        "HTTP_X_OI_DB_ROUTE": route,
    }
    if token:
        environ["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    response = {}

    def start_response(status, headers):
        response["status"] = int(status.split(" ", 1)[0])
        response["headers"] = dict(headers)

    response["body"] = b"".join(app(environ, start_response))
    return response


def main():
    module = load_app_module()
    old_token = os.environ.get("OFFER_DB_API_TOKEN")
    os.environ["OFFER_DB_API_TOKEN"] = "unit-test-token"
    try:
        module.status_payload = lambda month=None, include_coverage=False: {
            "route": "status",
            "month": month,
            "includeCoverage": include_coverage,
        }
        module.merchant_payload = lambda merchant_id, product_limit, months: {
            "route": "merchant",
            "merchantId": merchant_id,
            "limit": product_limit,
            "months": months,
        }
        module.search_payload = lambda text, limit: {
            "route": "search",
            "q": text,
            "limit": limit,
        }

        status = request(module.app, "status", "action=search&month=202607")
        assert_equal(status["status"], 200, "status response code")
        assert b'"route":"status"' in status["body"], status["body"]

        diagnostic_status = request(module.app, "status", "month=202607&coverage=1")
        assert_equal(diagnostic_status["status"], 200, "diagnostic status response code")
        assert b'"includeCoverage":true' in diagnostic_status["body"], diagnostic_status["body"]

        merchant = request(
            module.app,
            "merchant",
            "action=search&merchantId=42&limit=7&months=3",
        )
        assert_equal(merchant["status"], 200, "merchant response code")
        assert b'"route":"merchant"' in merchant["body"], merchant["body"]

        search = request(module.app, "search", "action=status&q=coffee&limit=5")
        assert_equal(search["status"], 200, "search response code")
        assert b'"route":"search"' in search["body"], search["body"]

        unauthorized = request(module.app, "status", token="")
        assert_equal(unauthorized["status"], 401, "missing token response code")

        options = request(module.app, "status", method="OPTIONS", token="")
        assert_equal(options["status"], 204, "OPTIONS response code")

        print("Vercel DB WSGI route checks passed")
    finally:
        if old_token is None:
            os.environ.pop("OFFER_DB_API_TOKEN", None)
        else:
            os.environ["OFFER_DB_API_TOKEN"] = old_token


if __name__ == "__main__":
    main()
