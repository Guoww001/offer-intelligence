#!/usr/bin/env python3
"""Fetch Levanta payment records and write them directly to MySQL.

Previously this script wrote into protected_data/chatbot_data.js, which was
then consumed by sync_oi_tables.py to reach the database. Now it writes
directly to cnpscy_oi_payment_records, eliminating the chatbot_data.js
dependency for payment data.

Outputs a payment_records.json for CI validation if --records-output is set.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import os
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import server  # noqa: E402


# ?? MySQL helpers (same pattern as sync_oi_tables.py) ????????????????????

def db_connection():
    """Create a MySQL connection (reuses offer_db.py env-var convention)."""
    try:
        import pymysql
    except ImportError:
        sys.exit("PyMySQL not installed. Run: pip install pymysql")

    required = ["OFFER_DB_HOST", "OFFER_DB_NAME", "OFFER_DB_USER", "OFFER_DB_PASSWORD"]
    missing = [k for k in required if not os.environ.get(k, "").strip()]
    if missing:
        sys.exit(f"Missing env vars: {', '.join(missing)}")

    return pymysql.connect(
        host=os.environ["OFFER_DB_HOST"].strip(),
        port=int(os.environ.get("OFFER_DB_PORT", "3306")),
        database=os.environ["OFFER_DB_NAME"].strip(),
        user=os.environ["OFFER_DB_USER"].strip(),
        password=os.environ["OFFER_DB_PASSWORD"],
        charset="utf8mb4",
        connect_timeout=30,
        read_timeout=60,
        write_timeout=60,
        ssl=None,
        autocommit=True,
    )


def upsert(conn, table: str, rows: list[dict], key_columns: list[str]) -> int:
    """Batch UPSERT: INSERT ? ON DUPLICATE KEY UPDATE. Returns row count."""
    if not rows:
        return 0

    columns = list(rows[0].keys())
    col_names = ", ".join(f"`{c}`" for c in columns)

    update_parts = [f"`{c}` = VALUES(`{c}`)" for c in columns if c not in key_columns]

    if update_parts:
        placeholders = ", ".join(["%s"] * len(columns))
        sql = (
            f"INSERT INTO `{table}` ({col_names}) VALUES ({placeholders}) "
            f"ON DUPLICATE KEY UPDATE {', '.join(update_parts)}"
        )
    else:
        placeholders = ", ".join(["%s"] * len(columns))
        sql = f"INSERT IGNORE INTO `{table}` ({col_names}) VALUES ({placeholders})"

    values_list = [tuple(row.get(c) for c in columns) for row in rows]

    written = 0
    batch_size = 100
    with conn.cursor() as cur:
        for i in range(0, len(values_list), batch_size):
            batch = values_list[i:i + batch_size]
            cur.executemany(sql, batch)
            written += len(batch)
        conn.commit()
    return written


# ?? existing-record helpers (replaces chatbot_data.js reads) ?????????????

LOAD_COLUMNS = [
    "id", "merchantId", "merchantName", "network", "region",
    "paymentStatus", "rawStatus",
    "paymentMadeDate", "lastCheckedDate",
    "reportMonth", "reportYear", "reportMonthKey",
    "revenueMade", "commissionMade",
]

LOAD_COLUMN_TYPES = {
    "reportYear": int,
    "revenueMade": float,
    "commissionMade": float,
}


def load_existing_records(conn) -> list[dict]:
    """Read payment records currently stored in the database."""
    col_list = ", ".join(f"`{c}`" for c in LOAD_COLUMNS)
    with conn.cursor() as cur:
        cur.execute(f"SELECT {col_list} FROM `cnpscy_oi_payment_records`")
        rows = []
        for row in cur.fetchall():
            record = {}
            for i, col in enumerate(LOAD_COLUMNS):
                val = row[i]
                if val is not None and col in LOAD_COLUMN_TYPES:
                    try:
                        val = LOAD_COLUMN_TYPES[col](val)
                    except (TypeError, ValueError):
                        pass
                record[col] = val
            rows.append(record)
    return rows


# ?? helpers (unchanged) ?????????????????????????????????????????????????

def month_key(month: tuple[str, int, int]) -> str:
    _name, zero_based_month, year = month
    return f"{year}-{zero_based_month + 1:02d}"


def fetch_payment_records(months: list[tuple[str, int, int]], api_key: str) -> list[dict]:
    records = []
    marketplaces = server.DEFAULT_MARKETPLACES
    for month_name, zero_based_month, year in months:
        rows = server.fetch_invoice_items_for_marketplaces(zero_based_month, year, api_key, marketplaces)
        print(f"Fetched {len(rows)} Levanta invoice items for {month_name} {year} across {', '.join(marketplaces)}")
        for item, marketplace in rows:
            records.append(server.normalize_invoice_item(item, month_name, zero_based_month, year, marketplace))
    return records


def source_url_with_window(source_url: str, start: str = "", end: str = "") -> str:
    parts = urlsplit(source_url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    if start:
        query["start"] = start
    if end:
        query["end"] = end
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def fetch_payment_records_from_source(source_url: str, start: str, end: str, source_token: str = "") -> tuple[list[dict], str]:
    url = source_url_with_window(source_url, start, end)
    headers = {
        "Accept": "application/json",
        "User-Agent": "YeahPromos-Offer-Intelligence-PaymentSync/1.0",
    }
    if source_token:
        headers["Authorization"] = f"Bearer {source_token}"
    request = Request(url, headers=headers)
    last_error = ""
    payload = None
    for attempt in range(3):
        try:
            with urlopen(request, timeout=240) as response:
                payload = json.loads(response.read().decode("utf-8"))
            break
        except HTTPError as error:
            body = error.read().decode("utf-8", "replace")[:500]
            last_error = f"HTTP {error.code} {error.reason}: {body}"
            if error.code in {408, 429} or error.code >= 500:
                if attempt < 2:
                    time.sleep(1 + attempt)
                    continue
            break
        except (URLError, TimeoutError, json.JSONDecodeError, OSError) as error:
            last_error = str(error)
            if attempt < 2:
                time.sleep(1 + attempt)
                continue
            break
    if payload is None:
        raise ValueError(f"Payment source request failed after retries: {last_error}")
    if not payload.get("ok"):
        raise ValueError(f"Payment source returned an error: {payload.get('error') or payload}")
    records = payload.get("records") or []
    print(f"Fetched {len(records)} payment records from {url}")
    return records, str(payload.get("checkedAt") or "")


def validate_payment_records(records: list[dict], months: list[tuple[str, int, int]]) -> dict:
    if not records:
        raise ValueError("Levanta sync produced no payment records; refusing to overwrite static data")

    counts_by_key = collections.Counter(record.get("reportMonthKey") for record in records)
    zero_amount = [
        record
        for record in records
        if server.number(record.get("revenueMade")) <= 0 and server.number(record.get("commissionMade")) <= 0
    ]
    if zero_amount:
        raise ValueError("Payment sync produced zero revenue/commission records after filtering")

    return {
        "recordCount": len(records),
        "countsByMonth": dict(sorted(counts_by_key.items())),
        "zeroRowsRemoved": True,
    }


def payment_record_key(record: dict) -> str:
    merchant_key = str(
        record.get("merchantId")
        or record.get("levantaBrandId")
        or server.normalize(record.get("merchantName") or record.get("brand"))
        or ""
    ).strip()
    report_month_key = str(record.get("reportMonthKey") or "").strip()
    if not merchant_key or not report_month_key:
        return ""
    region = server.normalize_region(record.get("region") or record.get("marketplace") or "")
    return "::".join((merchant_key, report_month_key, region))


def is_paid_payment_record(record: dict | None) -> bool:
    if not record:
        return False
    return str(record.get("paymentStatus") or record.get("rawStatus") or "").strip().lower() == "paid"


def payment_date(value: object) -> str:
    text = str(value or "").strip()
    return text[:10] if len(text) >= 10 else text


def apply_payment_made_dates(records: list[dict], previous_records: list[dict], checked_at: str) -> list[dict]:
    previous_by_key = {
        payment_record_key(record): record
        for record in previous_records
        if payment_record_key(record)
    }
    detected_date = payment_date(checked_at) or dt.date.today().isoformat()
    stamped_records = []

    for source_record in records:
        record = dict(source_record)
        previous = previous_by_key.get(payment_record_key(record))
        previous_payment_date = payment_date((previous or {}).get("paymentMadeDate"))

        if is_paid_payment_record(record):
            if is_paid_payment_record(previous):
                first_known_date = previous_payment_date or payment_date(previous.get("lastCheckedDate"))
            else:
                first_known_date = previous_payment_date
            record["paymentMadeDate"] = first_known_date or payment_date(record.get("paymentMadeDate")) or detected_date
        elif previous_payment_date:
            # Preserve first-payment history; the UI only displays this field while status is Paid.
            record["paymentMadeDate"] = previous_payment_date
        else:
            record.pop("paymentMadeDate", None)

        stamped_records.append(record)

    return stamped_records


def source_payment_record_id(record: dict, merchant_id: str) -> str:
    month_key = str(record.get("reportMonthKey") or "").strip()
    merchant_name = str(record.get("merchantName") or record.get("brand") or "").strip()
    brand_key = server.normalize(merchant_name)
    if merchant_id and month_key and brand_key:
        return f"{merchant_id}::{month_key}::{brand_key}"
    return str(record.get("id") or "").strip()


def reconcile_source_payment_record(record: dict) -> dict:
    if not isinstance(record, dict):
        return record

    merchant_name = str(record.get("merchantName") or record.get("brand") or "").strip()
    source_merchant_id = str(record.get("merchantId") or record.get("brand_id") or "").strip()
    network = record.get("network") or "Levanta"
    # ??? levantaBrandId ? merchantId ????
    levanta_brand_id = str(record.get("levantaBrandId") or "").strip()
    mapped_id = server.LEVANTA_BRAND_TO_MERCHANT.get(levanta_brand_id) if levanta_brand_id else None
    if mapped_id:
        merchant_id = mapped_id
        offer = server.offer_for_payment_source(merchant_id, merchant_name, network) or {}
    else:
        offer = server.offer_for_payment_source(source_merchant_id, merchant_name, network)
        if not offer:
            return record
        merchant_id = source_merchant_id or str(offer.get("merchantId") or "").strip()
    if not merchant_id:
        return record

    reconciled = dict(record)
    reconciled["merchantId"] = merchant_id

    if not levanta_brand_id:
        levanta_brand_id = source_merchant_id
    if levanta_brand_id:
        reconciled["levantaBrandId"] = levanta_brand_id

    new_id = source_payment_record_id(reconciled, merchant_id)
    if new_id:
        reconciled["id"] = new_id

    for key in ("network", "tier", "category", "categoryPath", "mainCategory", "subCategory", "mainCategoryCn", "subCategoryCn"):
        value = reconciled.get(key)
        if value not in (None, "", "Unknown", "Uncategorized"):
            continue
        offer_value = offer.get(key)
        if offer_value not in (None, ""):
            reconciled[key] = offer_value

    return reconciled


# ?? MySQL row builder (mirrors sync_oi_tables.py sync_payment_records) ???

def _num(value) -> float | None:
    if value is None:
        return None
    try:
        return float(str(value).replace(",", "").replace("$", "").replace("%", ""))
    except (ValueError, TypeError):
        return None


def payment_record_to_db_row(r: dict) -> dict:
    """Convert a payment record dict to a MySQL upsert row."""
    rid = str(r.get("id") or "").strip()
    if not rid:
        return {}
    return {
        "id": rid[:128],
        "merchantId": str(r.get("merchantId") or "").strip()[:32] or None,
        "levantaBrandId": str(r.get("levantaBrandId") or "").strip()[:32] or None,
        "merchantName": str(r.get("merchantName") or "").strip()[:255] or None,
        "network": str(r.get("network") or "Levanta").strip()[:64],
        "region": str(r.get("region") or "").strip()[:16] or None,
        "tier": str(r.get("tier") or "Unknown").strip()[:32],
        "category": str(r.get("category") or "Uncategorized").strip()[:128],
        "categoryPath": str(r.get("categoryPath") or "").strip()[:255] or None,
        "mainCategory": str(r.get("mainCategory") or "").strip()[:128] or None,
        "subCategory": str(r.get("subCategory") or "").strip()[:128] or None,
        "mainCategoryCn": str(r.get("mainCategoryCn") or "").strip()[:128] or None,
        "subCategoryCn": str(r.get("subCategoryCn") or "").strip()[:128] or None,
        "reportMonth": str(r.get("reportMonth") or "").strip()[:16],
        "reportYear": int(r.get("reportYear") or 0),
        "reportMonthKey": str(r.get("reportMonthKey") or "").strip()[:7],
        "revenueMade": _num(r.get("revenueMade")) or 0,
        "commissionMade": _num(r.get("commissionMade")) or 0,
        "expectedPaymentAmount": _num(r.get("expectedPaymentAmount")) or 0,
        "paidAmount": _num(r.get("paidAmount")) or 0,
        "remainingAmount": _num(r.get("remainingAmount")) or 0,
        "paymentCycle": int(_num(r.get("paymentCycle")) or 60),
        "paymentAvailabilityDate": str(r.get("paymentAvailabilityDate") or r.get("expectedPaymentDate") or "").strip()[:16] or None,
        "expectedPaymentDate": str(r.get("expectedPaymentDate") or "").strip()[:16] or None,
        "paymentStatus": str(r.get("paymentStatus") or "Unknown").strip()[:16],
        "rawStatus": str(r.get("rawStatus") or "").strip()[:32] or None,
        "paymentMadeDate": str(r.get("paymentMadeDate") or "").strip()[:16] or None,
        "lastCheckedDate": str(r.get("lastCheckedDate") or "").strip()[:16] or None,
        "currency": str(r.get("currency") or "USD").strip()[:8],
        "isPlaceholder": 1 if r.get("isPlaceholder") else 0,
        "notes": str(r.get("notes") or "").strip()[:1024] or None,
    }


# ?? CLI ?????????????????????????????????????????????????????????????????

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch Levanta payments and write them to cnpscy_oi_payment_records."
    )
    parser.add_argument("--start", default="",
                        help="Optional first report month, formatted YYYY-MM. Empty uses server/API default.")
    parser.add_argument("--end", default="",
                        help="Optional last report month, formatted YYYY-MM. Empty uses server/API default.")
    parser.add_argument(
        "--source-url",
        default=os.environ.get("PAYMENT_SYNC_SOURCE_URL", ""),
        help="Optional Vercel payment API URL. When set, GitHub pulls records from Vercel instead of reading LEVANTA_API_KEY.",
    )
    parser.add_argument(
        "--source-token",
        default=os.environ.get("PAYMENT_SYNC_TOKEN", "") or os.environ.get("OI_PAYMENT_SYNC_TOKEN", ""),
        help="Optional bearer token for protected payment source URLs.",
    )
    parser.add_argument(
        "--records-output",
        default="",
        help="Optional path to write processed payment records as JSON (for CI validation).",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Fetch and validate without writing to the database.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    query = {}
    if args.start:
        query["start"] = [args.start]
    if args.end:
        query["end"] = [args.end]
    months = server.months_from_query(query)
    window_start = f"{months[0][2]}-{months[0][1] + 1:02d}"
    window_end = f"{months[-1][2]}-{months[-1][1] + 1:02d}"

    # ?? 1. Fetch ??????????????????????????????????????????????????????
    source_url = str(args.source_url or "").strip()
    checked_at = ""
    if source_url:
        raw_records, checked_at = fetch_payment_records_from_source(
            source_url,
            args.start,
            args.end,
            str(args.source_token or "").strip(),
        )
        raw_records = [reconcile_source_payment_record(record) for record in raw_records]
    else:
        api_key = os.environ.get("LEVANTA_API_KEY", "").strip()
        if not api_key:
            print("Set PAYMENT_SYNC_SOURCE_URL or LEVANTA_API_KEY for payment sync.", file=sys.stderr)
            return 2
        raw_records = fetch_payment_records(months, api_key)

    checked_at = checked_at or dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")

    # ?? 2. Transform ??????????????????????????????????????????????????
    # Load existing records for payment-made-date tracking
    previous_records: list[dict] = []
    if not args.dry_run:
        try:
            conn = db_connection()
            previous_records = load_existing_records(conn)
            conn.close()
            print(f"Loaded {len(previous_records)} existing payment records from database")
        except SystemExit:
            raise
        except Exception as exc:
            print(f"Warning: could not load existing records from DB ({exc}); will proceed without history.", file=sys.stderr)

    records = [
        record
        for record in server.with_pending_placeholders(raw_records, months)
        if server.is_trackable_payment_record(record)
    ]
    records = apply_payment_made_dates(records, previous_records, checked_at)
    validation = validate_payment_records(records, months)

    # ?? 3. Write to MySQL ?????????????????????????????????????????????
    if not args.dry_run:
        db_rows = [payment_record_to_db_row(r) for r in records]
        db_rows = [r for r in db_rows if r]  # remove empties (no id)
        conn = db_connection()
        try:
            n = upsert(conn, "cnpscy_oi_payment_records", db_rows, ["id"])
            print(f"Wrote {n} payment records to cnpscy_oi_payment_records")
        finally:
            conn.close()

    # ?? 4. Optional JSON output for CI validation ?????????????????????
    output_path = str(args.records_output or "").strip()
    if output_path:
        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(
            json.dumps({"records": records, "checkedAt": checked_at, **validation}, ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"Wrote {len(records)} records to {out}")

    # ?? 5. Summary ????????????????????????????????????????????????????
    print(json.dumps({"checkedAt": checked_at, **validation}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
