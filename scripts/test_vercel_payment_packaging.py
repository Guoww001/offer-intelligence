import importlib
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    handler_path = ROOT / "api" / "levanta" / "payments.py"
    service_path = ROOT / "levanta_payments.py"
    if not service_path.is_file():
        raise AssertionError("missing extracted Levanta payment service module")

    handler_source = handler_path.read_text(encoding="utf-8")
    if "from server import" in handler_source:
        raise AssertionError("Levanta Vercel handler must not import the local server monolith")
    if "from levanta_payments import" not in handler_source:
        raise AssertionError("Levanta Vercel handler must import the extracted payment service")

    server_source = (ROOT / "server.py").read_text(encoding="utf-8")
    if "from levanta_payments import" not in server_source:
        raise AssertionError("local server must reuse the extracted payment service")

    payment_service = importlib.import_module("levanta_payments")
    server = importlib.import_module("server")
    shared_names = (
        "fetch_invoice_items_for_marketplaces",
        "is_trackable_payment_record",
        "marketplaces_from_query",
        "months_from_query",
        "normalize_invoice_item",
        "payment_summary",
        "with_pending_placeholders",
    )
    for name in shared_names:
        if getattr(server, name) is not getattr(payment_service, name):
            raise AssertionError(f"server.{name} must reuse levanta_payments.{name}")

    print("Vercel Levanta payment packaging checks passed")


if __name__ == "__main__":
    main()
