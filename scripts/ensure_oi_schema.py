#!/usr/bin/env python3
"""
幂等执行 cnpscy_oi_* 表结构初始化 / 增量变更。
在每次 sync_oi_tables.py 运行前执行，确保新表和视图存在。

安全：所有语句都是幂等的（CREATE TABLE IF NOT EXISTS,
ALTER TABLE with 手动检查, CREATE OR REPLACE VIEW）。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def db_connection():
    """创建 MySQL 连接（复用 offer_db.py 的配置模式）。"""
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


def column_exists(conn, table: str, column: str) -> bool:
    """检查列是否已存在。"""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s",
            (table, column),
        )
        return cur.fetchone()[0] > 0


def table_exists(conn, table: str) -> bool:
    """检查表是否已存在。"""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM information_schema.TABLES "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s",
            (table,),
        )
        return cur.fetchone()[0] > 0


def main():
    print("=== ensure_oi_schema ===\n")

    conn = db_connection()
    print("[db] connected\n")

    try:
        # ── 1. cnpscy_oi_payment_records ──
        if not table_exists(conn, "cnpscy_oi_payment_records"):
            print("[ddl] CREATE TABLE cnpscy_oi_payment_records ...")
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS cnpscy_oi_payment_records (
                      id                      VARCHAR(128) NOT NULL,
                      merchantId              VARCHAR(32) NOT NULL,
                      levantaBrandId          VARCHAR(32) DEFAULT NULL,
                      merchantName            VARCHAR(255) DEFAULT NULL,
                      network                 VARCHAR(64) NOT NULL DEFAULT 'Levanta',
                      region                  VARCHAR(16) DEFAULT NULL,
                      tier                    VARCHAR(32) DEFAULT 'Unknown',
                      category                VARCHAR(128) DEFAULT 'Uncategorized',
                      categoryPath            VARCHAR(255) DEFAULT NULL,
                      mainCategory            VARCHAR(128) DEFAULT NULL,
                      subCategory             VARCHAR(128) DEFAULT NULL,
                      mainCategoryCn          VARCHAR(128) DEFAULT NULL,
                      subCategoryCn           VARCHAR(128) DEFAULT NULL,
                      reportMonth             VARCHAR(16) NOT NULL,
                      reportYear              INT NOT NULL,
                      reportMonthKey          VARCHAR(7) NOT NULL,
                      revenueMade             DECIMAL(12,2) NOT NULL DEFAULT 0,
                      commissionMade          DECIMAL(12,2) NOT NULL DEFAULT 0,
                      expectedPaymentAmount   DECIMAL(12,2) NOT NULL DEFAULT 0,
                      paidAmount              DECIMAL(12,2) NOT NULL DEFAULT 0,
                      remainingAmount         DECIMAL(12,2) NOT NULL DEFAULT 0,
                      paymentCycle            INT NOT NULL DEFAULT 60,
                      paymentAvailabilityDate VARCHAR(16) DEFAULT NULL,
                      expectedPaymentDate     VARCHAR(16) DEFAULT NULL,
                      paymentStatus           VARCHAR(16) NOT NULL DEFAULT 'Unknown',
                      rawStatus               VARCHAR(32) DEFAULT NULL,
                      lastCheckedDate         VARCHAR(16) DEFAULT NULL,
                      currency                VARCHAR(8) DEFAULT 'USD',
                      isPlaceholder           TINYINT(1) NOT NULL DEFAULT 0,
                      notes                   TEXT DEFAULT NULL,
                      updatedAt               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                      PRIMARY KEY (id),
                      KEY idx_payment_merchant (merchantId),
                      KEY idx_payment_month (reportMonthKey),
                      KEY idx_payment_status (paymentStatus),
                      KEY idx_payment_tier (tier)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """)
            print("  → created")
        else:
            print("[ddl] cnpscy_oi_payment_records already exists, skipping")

        # ── 2. cnpscy_oi_offer_sheet_metadata ──
        if not table_exists(conn, "cnpscy_oi_offer_sheet_metadata"):
            print("[ddl] CREATE TABLE cnpscy_oi_offer_sheet_metadata ...")
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS cnpscy_oi_offer_sheet_metadata (
                      merchantId          VARCHAR(32) NOT NULL,
                      reason              TEXT DEFAULT NULL,
                      recommendation      TEXT DEFAULT NULL,
                      recommendedLink     VARCHAR(512) DEFAULT NULL,
                      phase               VARCHAR(64) DEFAULT NULL,
                      publisherCount      VARCHAR(32) DEFAULT NULL,
                      successRate         DECIMAL(10,6) DEFAULT NULL,
                      publisherCountJune  VARCHAR(32) DEFAULT NULL,
                      successRateJune     DECIMAL(10,6) DEFAULT NULL,
                      completionRate      DECIMAL(10,6) DEFAULT NULL,
                      timeline            VARCHAR(128) DEFAULT NULL,
                      bestSubCategoryBsr  VARCHAR(128) DEFAULT NULL,
                      mainCategoryBsr     VARCHAR(64) DEFAULT NULL,
                      subcategoryBsr      VARCHAR(64) DEFAULT NULL,
                      paymentCycle        INT DEFAULT NULL,
                      paymentCycleSource  VARCHAR(32) DEFAULT 'network_default',
                      sheetCategory       VARCHAR(128) DEFAULT NULL,
                      categorySource      VARCHAR(32) DEFAULT NULL,
                      sourceSheet         VARCHAR(64) DEFAULT NULL,
                      rowNumber           INT DEFAULT NULL,
                      originalRank        INT DEFAULT NULL,
                      mayRevenue          DECIMAL(12,2) DEFAULT NULL,
                      juneRevenue         DECIMAL(12,2) DEFAULT NULL,
                      dpvPerClick         DECIMAL(10,6) DEFAULT NULL,
                      atcPerClick         DECIMAL(10,6) DEFAULT NULL,
                      backendMatchStatus  VARCHAR(64) DEFAULT NULL,
                      region              VARCHAR(16) DEFAULT NULL,
                      hasDiscount         TINYINT(1) NOT NULL DEFAULT 0,
                      discountInfo        VARCHAR(255) DEFAULT NULL,
                      dealInfo            VARCHAR(255) DEFAULT NULL,
                      cpc                 DECIMAL(10,6) DEFAULT NULL,
                      updatedAt           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                      PRIMARY KEY (merchantId),
                      KEY idx_sheet_category (sheetCategory),
                      KEY idx_sheet_region (region)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """)
            print("  → created")
        else:
            print("[ddl] cnpscy_oi_offer_sheet_metadata already exists, skipping")

        # ── 3. cnpscy_oi_category: add categoryNameCn ──
        if not column_exists(conn, "cnpscy_oi_category", "categoryNameCn"):
            print("[ddl] ALTER TABLE cnpscy_oi_category ADD COLUMN categoryNameCn ...")
            with conn.cursor() as cur:
                cur.execute(
                    "ALTER TABLE cnpscy_oi_category "
                    "ADD COLUMN categoryNameCn VARCHAR(128) DEFAULT NULL COMMENT '中文类目名' "
                    "AFTER source"
                )
            print("  → added")
        else:
            print("[ddl] cnpscy_oi_category.categoryNameCn already exists, skipping")

        # ── 4. cnpscy_oi_offer_base VIEW: recreate with region column ──
        print("[ddl] CREATE OR REPLACE VIEW cnpscy_oi_offer_base ...")
        with conn.cursor() as cur:
            cur.execute("""
                CREATE OR REPLACE VIEW cnpscy_oi_offer_base AS
                SELECT
                  CAST(a.advert_id AS CHAR)     AS merchantId,
                  a.advert_name                 AS merchantName,
                  a.m_id                        AS levantaBrandId,
                  a.advert_lianmeng_id          AS network,
                  NULL                          AS category,
                  a.advert_money                AS commissionRate,
                  NULL                          AS paymentCycle,
                  (
                    SELECT COUNT(*)
                    FROM cnpscy_amazon_product p
                    WHERE p.advert_id = a.advert_id
                  )                             AS productCount,
                  NULL                          AS region,
                  NULL                          AS updatedAt
                FROM cnpscy_advert a
                WHERE a.advert_isdel = 1
            """)
        print("  → view recreated")

        print("\n=== schema check complete ===")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
