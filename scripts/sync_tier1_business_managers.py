#!/usr/bin/env python3
"""Validate and upsert Tier 1 merchant business-manager values from a CSV."""

from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path

from sync_oi_tables import db_connection


DIGITS_RE = re.compile(r"^\d+$")
MANAGER_KEYS = ("businessManager", "Business Manager", "\u4e1a\u52a1\u7ecf\u7406")


def load_business_manager_csv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        headers = set(reader.fieldnames or [])
        if not any(key in headers for key in MANAGER_KEYS):
            raise ValueError(
                "CSV must include a Business Manager, businessManager, or \u4e1a\u52a1\u7ecf\u7406 column"
            )
        return list(reader)


def normalized_business_manager_rows(rows: list[dict]) -> list[tuple[str, str | None, str]]:
    if rows and not any(
        key in row
        for row in rows
        for key in MANAGER_KEYS
    ):
        raise ValueError(
            "CSV rows must include a Business Manager, businessManager, or \u4e1a\u52a1\u7ecf\u7406 field"
        )
    normalized: list[tuple[str, str | None, str]] = []
    seen: set[str] = set()
    for row in rows:
        merchant_id = str(row.get("merchantId") or row.get("Merchant ID") or "").strip()
        if not DIGITS_RE.match(merchant_id):
            raise ValueError(f"Invalid Tier 1 business-manager Merchant ID: {merchant_id!r}")
        if merchant_id in seen:
            raise ValueError(f"Duplicate Tier 1 business-manager Merchant ID: {merchant_id}")
        seen.add(merchant_id)

        manager = ""
        for key in MANAGER_KEYS:
            if row.get(key) is not None:
                manager = str(row.get(key) or "").strip()
                break
        if len(manager) > 128:
            raise ValueError(f"Business Manager is longer than 128 characters for Merchant ID {merchant_id}")
        normalized.append((merchant_id, manager or None, "Tier 1"))
    return normalized


def sync_tier1_business_managers(conn, rows: list[dict]) -> dict[str, int]:
    normalized = normalized_business_manager_rows(rows)
    if not normalized:
        return {"rows": 0, "nonblank": 0, "blank": 0}

    merchant_ids = [merchant_id for merchant_id, _manager, _source_sheet in normalized]
    placeholders = ", ".join(["%s"] * len(merchant_ids))
    try:
        conn.begin()
        with conn.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT merchantId
                FROM cnpscy_oi_tier_assignments
                WHERE tier = %s
                  AND merchantId IN ({placeholders})
                FOR UPDATE
                """,
                ("Tier 1", *merchant_ids),
            )
            tier1_ids = {
                str(row.get("merchantId") if isinstance(row, dict) else row[0])
                for row in cursor.fetchall()
            }
            missing = [merchant_id for merchant_id in merchant_ids if merchant_id not in tier1_ids]
            if missing:
                raise ValueError(
                    "Business Manager can only be assigned to current Tier 1 merchants: "
                    + ", ".join(missing)
                )

            cursor.executemany(
                """
                INSERT INTO cnpscy_oi_offer_sheet_metadata
                    (merchantId, businessManager, sourceSheet)
                VALUES (%s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    businessManager = VALUES(businessManager)
                """,
                normalized,
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    nonblank = sum(1 for _merchant_id, manager, _source_sheet in normalized if manager)
    return {"rows": len(normalized), "nonblank": nonblank, "blank": len(normalized) - nonblank}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", type=Path, help="UTF-8 CSV with Merchant ID and Business Manager columns")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and summarize the CSV without connecting to MySQL.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    rows = load_business_manager_csv(args.csv_path)
    normalized = normalized_business_manager_rows(rows)
    nonblank = sum(1 for _merchant_id, manager, _source_sheet in normalized if manager)
    if args.dry_run:
        print(
            "Tier 1 business managers validated: "
            f"{len(normalized)} rows, {nonblank} nonblank, {len(normalized) - nonblank} blank"
        )
        return

    conn = db_connection()
    try:
        result = sync_tier1_business_managers(conn, rows)
    finally:
        conn.close()
    print(
        "Tier 1 business managers synced to cnpscy_oi_offer_sheet_metadata: "
        f"{result['rows']} rows, {result['nonblank']} nonblank, {result['blank']} blank"
    )


if __name__ == "__main__":
    main()
