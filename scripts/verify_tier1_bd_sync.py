#!/usr/bin/env python3
"""Compare the versioned Tier 1 BD snapshot with the live database."""

from __future__ import annotations

import argparse
from pathlib import Path

import ensure_oi_schema
from apply_tier1_business_manager_schema import load_env_file
from sync_tier1_business_managers import (
    DEFAULT_CSV_PATH,
    load_bd_csv,
    normalized_bd_rows,
)


TABLE_NAME = "cnpscy_oi_offer_sheet_metadata"
COLUMN_NAME = "businessManager"


def inspect_bd_state(conn, rows: list[dict]) -> dict:
    normalized = normalized_bd_rows(rows)
    expected = {merchant_id: bd for merchant_id, bd, _source_sheet in normalized}
    merchant_ids = list(expected)
    placeholders = ", ".join(["%s"] * len(merchant_ids))

    with conn.cursor() as cursor:
        cursor.execute(
            f"""
            SELECT merchantId, tier
            FROM cnpscy_oi_tier_assignments
            WHERE merchantId IN ({placeholders})
            """,
            merchant_ids,
        )
        assignments = {
            str(row.get("merchantId") if isinstance(row, dict) else row[0]):
            str(row.get("tier") if isinstance(row, dict) else row[1])
            for row in cursor.fetchall()
        }
        cursor.execute(
            "SELECT COUNT(*) FROM cnpscy_oi_tier_assignments WHERE tier = %s",
            ("Tier 1",),
        )
        total_row = cursor.fetchone()
        tier1_total = int(
            total_row.get("COUNT(*)") if isinstance(total_row, dict) else total_row[0]
        )

        column_exists = ensure_oi_schema.column_exists(conn, TABLE_NAME, COLUMN_NAME)
        actual: dict[str, str] = {}
        if column_exists:
            cursor.execute(
                f"""
                SELECT merchantId, businessManager
                FROM {TABLE_NAME}
                WHERE merchantId IN ({placeholders})
                """,
                merchant_ids,
            )
            actual = {
                str(row.get("merchantId") if isinstance(row, dict) else row[0]):
                str(
                    (row.get("businessManager") if isinstance(row, dict) else row[1])
                    or ""
                ).strip()
                for row in cursor.fetchall()
            }

    not_tier1 = {
        merchant_id: assignments.get(merchant_id)
        for merchant_id in merchant_ids
        if assignments.get(merchant_id) != "Tier 1"
    }
    mismatches = {
        merchant_id: {
            "expected": expected[merchant_id],
            "actual": actual.get(merchant_id, ""),
        }
        for merchant_id in merchant_ids
        if actual.get(merchant_id, "") != expected[merchant_id]
    }
    return {
        "column_exists": column_exists,
        "tier1_total": tier1_total,
        "snapshot_rows": len(expected),
        "not_tier1": not_tier1,
        "matched": len(expected) - len(mismatches) if column_exists else 0,
        "mismatches": mismatches,
        "bryan": sum(1 for bd in expected.values() if bd == "Bryan"),
        "timmy": sum(1 for bd in expected.values() if bd == "Timmy"),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--env-file",
        type=Path,
        help="Optional Vercel-style env file containing OFFER_DB_* variables.",
    )
    parser.add_argument(
        "--csv-path",
        type=Path,
        default=DEFAULT_CSV_PATH,
        help="Tier 1 BD CSV (default: data/tier1_bd.csv).",
    )
    parser.add_argument(
        "--require-match",
        action="store_true",
        help="Exit nonzero unless every snapshot row is Tier 1 and matches the database.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    load_env_file(args.env_file)
    rows = load_bd_csv(args.csv_path)
    conn = ensure_oi_schema.db_connection()
    try:
        state = inspect_bd_state(conn, rows)
    finally:
        conn.close()

    print(
        f"{TABLE_NAME}.{COLUMN_NAME}="
        f"{'present' if state['column_exists'] else 'missing'}"
    )
    print(
        "Tier 1 BD snapshot: "
        f"{state['snapshot_rows']} rows, {state['bryan']} Bryan, "
        f"{state['timmy']} Timmy"
    )
    print(f"Database Tier 1 assignments: {state['tier1_total']}")
    print(
        "Snapshot merchants not assigned to Tier 1: "
        + (
            ", ".join(
                f"{merchant_id}:{tier or 'missing'}"
                for merchant_id, tier in state["not_tier1"].items()
            )
            or "none"
        )
    )
    print(
        f"Database BD matches: {state['matched']}/{state['snapshot_rows']}; "
        f"mismatches={len(state['mismatches'])}"
    )
    if args.require_match and (
        not state["column_exists"]
        or state["not_tier1"]
        or state["mismatches"]
    ):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
