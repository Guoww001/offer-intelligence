#!/usr/bin/env python3
"""Sync the Google Sheet Tier 1 Agency snapshot into offer sheet metadata."""

from __future__ import annotations

import argparse
import re

from sync_oi_tables import db_connection, load_tier1_agencies_csv

DIGITS_RE = re.compile(r"^\d+$")


def normalized_agency_rows(rows: list[dict]) -> list[tuple[str, str | None, str]]:
    normalized: list[tuple[str, str | None, str]] = []
    seen: set[str] = set()
    for row in rows:
        merchant_id = str(row.get("merchantId") or row.get("Merchant ID") or "").strip()
        if not DIGITS_RE.match(merchant_id):
            raise ValueError(f"Invalid Tier 1 agency Merchant ID: {merchant_id!r}")
        if merchant_id in seen:
            raise ValueError(f"Duplicate Tier 1 agency Merchant ID: {merchant_id}")
        seen.add(merchant_id)
        agency = str(row.get("agency") or row.get("Agency") or row.get("Agency ") or "").strip()
        if len(agency) > 128:
            raise ValueError(f"Agency is longer than 128 characters for Merchant ID {merchant_id}")
        normalized.append((merchant_id, agency or None, "Tier 1"))
    return normalized


def sync_tier1_agencies(conn, rows: list[dict]) -> dict[str, int]:
    normalized = normalized_agency_rows(rows)
    nonblank = sum(1 for _merchant_id, agency, _source_sheet in normalized if agency)
    try:
        conn.begin()
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE cnpscy_oi_offer_sheet_metadata sm
                INNER JOIN cnpscy_oi_tier_assignments t ON sm.merchantId = t.merchantId
                SET sm.agency = NULL
                WHERE t.tier = 'Tier 1'
                """
            )
            cur.executemany(
                """
                INSERT INTO cnpscy_oi_offer_sheet_metadata (merchantId, agency, sourceSheet)
                VALUES (%s, %s, %s)
                ON DUPLICATE KEY UPDATE agency = VALUES(agency)
                """,
                normalized,
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return {"rows": len(normalized), "nonblank": nonblank, "blank": len(normalized) - nonblank}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and summarize the snapshot without connecting to MySQL.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    rows = load_tier1_agencies_csv()
    normalized = normalized_agency_rows(rows)
    if args.dry_run:
        nonblank = sum(1 for _merchant_id, agency, _source_sheet in normalized if agency)
        print(f"Tier 1 agencies validated: {len(normalized)} rows, {nonblank} nonblank")
        return

    conn = db_connection()
    try:
        result = sync_tier1_agencies(conn, rows)
    finally:
        conn.close()
    print(
        "Tier 1 agencies synced to cnpscy_oi_offer_sheet_metadata: "
        f"{result['rows']} rows, {result['nonblank']} nonblank, {result['blank']} blank"
    )


if __name__ == "__main__":
    main()
