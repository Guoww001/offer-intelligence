#!/usr/bin/env python3
"""Sync only the versioned merchant AOV estimate observations to MySQL."""

from __future__ import annotations

from sync_oi_tables import (
    db_connection,
    load_merchant_aov_estimates_csv,
    sync_merchant_aov_estimates,
)
from offer_db import MERCHANT_AOV_ESTIMATES_TABLE_DDL


def verify_persisted_estimates(conn, source_rows: list[dict]) -> tuple[int, int]:
    """Verify every versioned source key and value against the persisted table."""
    with conn.cursor() as cursor:
        cursor.execute(
            """
            SELECT merchantId, sourceDate, aov, currency, sampleProductCount,
                   method, sourceFile
            FROM cnpscy_oi_merchant_aov_estimates
            """
        )
        persisted = {
            (str(row[0]), str(row[1])): row
            for row in cursor.fetchall()
        }

    merchants: set[str] = set()
    for source_row in source_rows:
        merchant_id = str(source_row["Merchant ID"]).strip()
        source_date = str(source_row["Source Date"]).strip()
        merchants.add(merchant_id)
        row = persisted.get((merchant_id, source_date))
        if row is None:
            raise RuntimeError(f"Missing persisted AOV observation: {merchant_id} {source_date}")

        expected_currency = str(source_row.get("Currency") or "").strip().upper() or None
        expected = (
            round(float(source_row["Tentative AOV"]), 6),
            expected_currency,
            int(source_row["Sample Product Count"]),
            str(source_row["Method"]).strip(),
            str(source_row["Source File"]).strip(),
        )
        actual = (
            round(float(row[2]), 6),
            str(row[3]).strip().upper() if row[3] else None,
            int(row[4]),
            str(row[5]).strip(),
            str(row[6]).strip(),
        )
        if actual != expected:
            raise RuntimeError(
                f"Persisted AOV mismatch for {merchant_id} {source_date}: "
                f"expected {expected!r}, got {actual!r}"
            )
    return len(source_rows), len(merchants)


def main() -> int:
    rows = load_merchant_aov_estimates_csv()
    if not rows:
        raise SystemExit("No merchant AOV estimate observations were loaded")

    conn = db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(MERCHANT_AOV_ESTIMATES_TABLE_DDL)
        print("Ensured cnpscy_oi_merchant_aov_estimates")
        written = sync_merchant_aov_estimates(conn, rows)
        verified_rows, verified_merchants = verify_persisted_estimates(conn, rows)
    finally:
        conn.close()

    if written != len(rows):
        raise SystemExit(
            f"Expected to upsert {len(rows)} AOV observations, wrote {written}"
        )
    print(
        f"Synced and verified {verified_rows} AOV observations for "
        f"{verified_merchants} merchants"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
