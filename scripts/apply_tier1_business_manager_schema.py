#!/usr/bin/env python3
"""Idempotently add the Tier 1 BD metadata storage column."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import ensure_oi_schema


TABLE_NAME = "cnpscy_oi_offer_sheet_metadata"
COLUMN_NAME = "businessManager"
HISTORY_TABLE_NAME = "cnpscy_oi_tier_move_history"
HISTORY_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS cnpscy_oi_tier_move_history (
  eventId       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  merchantId    VARCHAR(32) NOT NULL,
  merchantName  VARCHAR(255) DEFAULT NULL,
  sourceTier    VARCHAR(32) DEFAULT NULL,
  targetTier    VARCHAR(32) NOT NULL,
  source        VARCHAR(64) NOT NULL,
  movedAt       DATETIME NOT NULL,
  movedBy       VARCHAR(128) DEFAULT NULL,
  createdAt     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (eventId),
  KEY idx_tier_move_merchant (merchantId),
  KEY idx_tier_move_target_time (targetTier, movedAt),
  KEY idx_tier_move_source (source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""


def load_env_file(path: Path | None) -> None:
    if path is None:
        return
    with path.open(encoding="utf-8") as file:
        for raw_line in file:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("\"'")
            if key and not os.environ.get(key):
                os.environ[key] = value


def apply_business_manager_schema(conn) -> str:
    if ensure_oi_schema.column_exists(conn, TABLE_NAME, COLUMN_NAME):
        return "already existed"
    with conn.cursor() as cursor:
        cursor.execute(
            ensure_oi_schema.OFFER_SHEET_METADATA_COLUMN_MIGRATIONS[COLUMN_NAME]
        )
    if not ensure_oi_schema.column_exists(conn, TABLE_NAME, COLUMN_NAME):
        raise RuntimeError(f"{TABLE_NAME}.{COLUMN_NAME} was not created")
    return "added"


def apply_tier1_move_history_schema(conn) -> str:
    if ensure_oi_schema.table_exists(conn, HISTORY_TABLE_NAME):
        return "already existed"
    with conn.cursor() as cursor:
        cursor.execute(HISTORY_TABLE_DDL)
    if not ensure_oi_schema.table_exists(conn, HISTORY_TABLE_NAME):
        raise RuntimeError(f"{HISTORY_TABLE_NAME} was not created")
    return "added"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--env-file",
        type=Path,
        help="Optional Vercel-style env file containing OFFER_DB_* variables.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    load_env_file(args.env_file)
    conn = ensure_oi_schema.db_connection()
    try:
        history_status = apply_tier1_move_history_schema(conn)
        status = apply_business_manager_schema(conn)
    finally:
        conn.close()
    print(f"{TABLE_NAME}.{COLUMN_NAME} (BD): {status}; verified=true")
    print(f"{HISTORY_TABLE_NAME}: {history_status}; verified=true")


if __name__ == "__main__":
    main()
