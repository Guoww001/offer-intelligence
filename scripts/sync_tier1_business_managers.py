#!/usr/bin/env python3
"""Validate and upsert Tier 1 merchant BD values from a CSV."""

from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path

from sync_oi_tables import db_connection


DIGITS_RE = re.compile(r"^\d+$")
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CSV_PATH = ROOT / "data" / "tier1_bd.csv"
BD_KEYS = ("BD", "bd")
DEFAULT_BD = "Timmy"


def load_bd_csv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        headers = set(reader.fieldnames or [])
        if not any(key in headers for key in BD_KEYS):
            raise ValueError("CSV must include a BD or bd column")
        return list(reader)


def normalized_bd_rows(rows: list[dict]) -> list[tuple[str, str, str]]:
    if rows and not any(
        key in row
        for row in rows
        for key in BD_KEYS
    ):
        raise ValueError("CSV rows must include a BD or bd field")
    normalized: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    for row in rows:
        merchant_id = str(row.get("merchantId") or row.get("Merchant ID") or "").strip()
        if not DIGITS_RE.match(merchant_id):
            raise ValueError(f"Invalid Tier 1 BD Merchant ID: {merchant_id!r}")
        if merchant_id in seen:
            raise ValueError(f"Duplicate Tier 1 BD Merchant ID: {merchant_id}")
        seen.add(merchant_id)

        bd = ""
        for key in BD_KEYS:
            if row.get(key) is not None:
                bd = str(row.get(key) or "").strip()
                break
        bd = bd or DEFAULT_BD
        if len(bd) > 128:
            raise ValueError(f"BD is longer than 128 characters for Merchant ID {merchant_id}")
        normalized.append((merchant_id, bd, "Tier 1"))
    return normalized


def sync_tier1_bd(conn, rows: list[dict]) -> dict[str, int]:
    normalized = normalized_bd_rows(rows)
    if not normalized:
        return {"rows": 0, "bryan": 0, "timmy": 0, "other": 0}

    merchant_ids = [merchant_id for merchant_id, _bd, _source_sheet in normalized]
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
                    "BD can only be assigned to current Tier 1 merchants: "
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

    bryan = sum(1 for _merchant_id, bd, _source_sheet in normalized if bd.casefold() == "bryan")
    timmy = sum(1 for _merchant_id, bd, _source_sheet in normalized if bd.casefold() == "timmy")
    return {
        "rows": len(normalized),
        "bryan": bryan,
        "timmy": timmy,
        "other": len(normalized) - bryan - timmy,
    }


# Backward-compatible Python entry points; the user-facing and CSV field is BD.
load_business_manager_csv = load_bd_csv
normalized_business_manager_rows = normalized_bd_rows
sync_tier1_business_managers = sync_tier1_bd


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "csv_path",
        nargs="?",
        type=Path,
        default=DEFAULT_CSV_PATH,
        help="UTF-8 CSV with Merchant ID and BD columns (default: data/tier1_bd.csv)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and summarize the CSV without connecting to MySQL.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    rows = load_bd_csv(args.csv_path)
    normalized = normalized_bd_rows(rows)
    bryan = sum(1 for _merchant_id, bd, _source_sheet in normalized if bd.casefold() == "bryan")
    timmy = sum(1 for _merchant_id, bd, _source_sheet in normalized if bd.casefold() == "timmy")
    if args.dry_run:
        print(
            "Tier 1 BD values validated: "
            f"{len(normalized)} rows, {bryan} Bryan, {timmy} Timmy, "
            f"{len(normalized) - bryan - timmy} other"
        )
        return

    conn = db_connection()
    try:
        result = sync_tier1_bd(conn, rows)
    finally:
        conn.close()
    print(
        "Tier 1 BD values synced to cnpscy_oi_offer_sheet_metadata.businessManager: "
        f"{result['rows']} rows, {result['bryan']} Bryan, {result['timmy']} Timmy, "
        f"{result['other']} other"
    )


if __name__ == "__main__":
    main()
