-- ============================================================
-- Offer Intelligence ??? DDL???????????????
-- ???: yg_ht_test @ 43.153.38.91
-- ????: 2026-07-10
-- ??: ??? docs/offer-db-reporting-contract.sql ??????
--        ???????????????? SHOW COLUMNS ?????
-- ============================================================

-- ============================================================
-- ?????TABLE????????????
-- ============================================================



-- 1. ?????
DROP TABLE IF EXISTS cnpscy_oi_tier_assignments;
CREATE TABLE cnpscy_oi_tier_assignments (
  merchantId VARCHAR(32) NOT NULL COMMENT '??ID??? cnpscy_advert.advert_id',
  tier        VARCHAR(32) NOT NULL COMMENT '????',
  source      VARCHAR(32) NOT NULL DEFAULT 'google_sheet' COMMENT '??',
  movedFromTier VARCHAR(32) DEFAULT NULL,
  movedAt       DATETIME DEFAULT NULL,
  updatedBy     VARCHAR(128) DEFAULT NULL,
  updatedAt     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (merchantId),
  KEY idx_cnpscy_oi_tier_assignments_tier (tier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. ???????
DROP TABLE IF EXISTS cnpscy_oi_tier_visual_status;
CREATE TABLE cnpscy_oi_tier_visual_status (
  merchantId  VARCHAR(32) NOT NULL,
  color       ENUM('green','yellow','red','none') NOT NULL DEFAULT 'none',
  reason_code VARCHAR(64) NOT NULL DEFAULT 'no_rule_match',
  reason_text VARCHAR(512) DEFAULT NULL,
  source      ENUM('rule','manual') NOT NULL DEFAULT 'rule',
  updatedBy   VARCHAR(128) DEFAULT NULL,
  updatedAt   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (merchantId),
  KEY idx_cnpscy_oi_tier_visual_status_color (color),
  KEY idx_cnpscy_oi_tier_visual_status_source (source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. ????????????????
DROP TABLE IF EXISTS cnpscy_oi_category;
CREATE TABLE cnpscy_oi_category (
  categoryId       INT AUTO_INCREMENT PRIMARY KEY,
  categoryName     VARCHAR(128) NOT NULL COMMENT '????',
  parentCategoryId INT DEFAULT NULL COMMENT '???ID?NULL??????',
  level            TINYINT NOT NULL DEFAULT 1 COMMENT '???1=????2=???',
  sortOrder        INT DEFAULT 0 COMMENT '??',
  source           VARCHAR(32) DEFAULT 'manual' COMMENT '????',
  categoryNameCn   VARCHAR(128) DEFAULT NULL COMMENT '?????',
  updatedAt        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_parent (parentCategoryId),
  KEY idx_level (level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. ??-?????
DROP TABLE IF EXISTS cnpscy_oi_merchant_category;
CREATE TABLE cnpscy_oi_merchant_category (
  merchantId VARCHAR(32) NOT NULL,
  categoryId INT NOT NULL COMMENT '??? cnpscy_oi_category.categoryId',
  PRIMARY KEY (merchantId, categoryId),
  KEY idx_category (categoryId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. ???????? Levanta API?
DROP TABLE IF EXISTS cnpscy_oi_payment_records;
CREATE TABLE cnpscy_oi_payment_records (
  id                      VARCHAR(128) NOT NULL COMMENT '????: merchantId::monthKey::brandKey',
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
  reportMonth             VARCHAR(16) NOT NULL COMMENT '??????, e.g. January',
  reportYear              INT NOT NULL COMMENT '????',
  reportMonthKey          VARCHAR(7) NOT NULL COMMENT 'YYYY-MM ??',
  revenueMade             DECIMAL(12,2) NOT NULL DEFAULT 0,
  commissionMade          DECIMAL(12,2) NOT NULL DEFAULT 0,
  expectedPaymentAmount   DECIMAL(12,2) NOT NULL DEFAULT 0,
  paidAmount              DECIMAL(12,2) NOT NULL DEFAULT 0,
  remainingAmount         DECIMAL(12,2) NOT NULL DEFAULT 0,
  paymentCycle            INT NOT NULL DEFAULT 60 COMMENT '????',
  paymentAvailabilityDate VARCHAR(16) DEFAULT NULL COMMENT '??????',
  expectedPaymentDate     VARCHAR(16) DEFAULT NULL,
  paymentStatus           VARCHAR(16) NOT NULL DEFAULT 'Unknown' COMMENT 'Paid|Pending|Unpaid|Overdue|Partial|Unknown',
  rawStatus               VARCHAR(32) DEFAULT NULL COMMENT 'Levanta ????',
  paymentMadeDate         VARCHAR(16) DEFAULT NULL COMMENT '?????????',
  lastCheckedDate         VARCHAR(16) DEFAULT NULL,
  currency                VARCHAR(8) DEFAULT 'USD',
  isPlaceholder           TINYINT(1) NOT NULL DEFAULT 0 COMMENT '???????',
  notes                   TEXT DEFAULT NULL,
  updatedAt               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payment_merchant (merchantId),
  KEY idx_payment_month (reportMonthKey),
  KEY idx_payment_status (paymentStatus),
  KEY idx_payment_tier (tier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6. Offer Sheet ????????? Google Sheets ??????
DROP TABLE IF EXISTS cnpscy_oi_offer_sheet_metadata;
CREATE TABLE cnpscy_oi_offer_sheet_metadata (
  merchantId          VARCHAR(32) NOT NULL,
  reason              TEXT DEFAULT NULL COMMENT 'Tier ?? / ?????',
  recommendation      TEXT DEFAULT NULL COMMENT '????',
  recommendedLink     VARCHAR(512) DEFAULT NULL COMMENT '????',
  phase               VARCHAR(64) DEFAULT NULL COMMENT '????',
  publisherCount      VARCHAR(32) DEFAULT NULL,
  successRate         DECIMAL(10,6) DEFAULT NULL,
  publisherCountJune  VARCHAR(32) DEFAULT NULL,
  successRateJune     DECIMAL(10,6) DEFAULT NULL,
  completionRate      DECIMAL(10,6) DEFAULT NULL,
  timeline            VARCHAR(128) DEFAULT NULL,
  bestSubCategoryBsr  VARCHAR(128) DEFAULT NULL,
  mainCategoryBsr     VARCHAR(64) DEFAULT NULL COMMENT '??? BSR ????????',
  subcategoryBsr      VARCHAR(64) DEFAULT NULL COMMENT '??? BSR ????????',
  paymentCycle        INT DEFAULT NULL COMMENT 'Sheet ???????????????',
  paymentCycleSource  VARCHAR(32) DEFAULT 'network_default' COMMENT 'google_sheet | network_default',
  sheetCategory       VARCHAR(128) DEFAULT NULL COMMENT 'Google Sheet ???????',
  categorySource      VARCHAR(32) DEFAULT NULL COMMENT '????: Google Sheet | Feishu | Levanta | Source',
  sourceSheet         VARCHAR(64) DEFAULT NULL COMMENT '?? Sheet ??',
  rowNumber           INT DEFAULT NULL,
  originalRank        INT DEFAULT NULL,
  backendMatchStatus  VARCHAR(64) DEFAULT NULL,
  region              VARCHAR(16) DEFAULT NULL COMMENT '? Sheet/CSV ??? region',
  hasDiscount         TINYINT(1) NOT NULL DEFAULT 0,
  discountInfo        VARCHAR(255) DEFAULT NULL,
  dealInfo            VARCHAR(255) DEFAULT NULL,
  cpc                 DECIMAL(10,6) DEFAULT NULL,
  updatedAt           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (merchantId),
  KEY idx_sheet_category (sheetCategory),
  KEY idx_sheet_region (region)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ============================================================
-- 1.5???????????????????
-- ============================================================

-- cnpscy_oi_category ??????????
ALTER TABLE cnpscy_oi_category
  ADD COLUMN IF NOT EXISTS categoryNameCn VARCHAR(128) DEFAULT NULL COMMENT '?????'
  AFTER source;


-- ============================================================
-- ?????VIEW?? cnpscy_* ?????? cnpscy_oi_* ????
-- ============================================================

-- ------------------------------------------------------------
-- VIEW: cnpscy_oi_offer_base ? ??????
--
-- ??????
--   merchantId    ? advert_id (int ? char)
--   merchantName  ? advert_name
--   levantaBrandId ? m_id (Levanta ??ID)
--   network       ? advert_lianmeng_id (??????????)
--   category      ? NULL (??? CSV/??????)
--   commissionRate ? advert_money (float)
--   paymentCycle  ? NULL (? Google Sheets ????)
--   productCount  ? ? cnpscy_amazon_product ?????
--   region        ? NULL (? cnpscy_oi_offer_sheet_metadata ??)
--   updatedAt     ? NULL (cnpscy_advert ??????)
-- ------------------------------------------------------------
DROP VIEW IF EXISTS cnpscy_oi_offer_base;
CREATE VIEW cnpscy_oi_offer_base AS
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
WHERE a.advert_isdel = 1;


-- ------------------------------------------------------------
-- VIEW: cnpscy_oi_offer_products ? ?????ASIN ???
--
-- ????
--   merchantId      ? advert_id (int ? char)
--   asin            ? asin
--   productName     ? product_name
--   price           ? price_value
--   category        ? category_name
--   bsr             ? p_rank (Best Seller Rank)
--   subCategoryBsr ? NULL (?? product_extra ? bsr_rank_2 ??)
--   commissionRate  ? payout_aff
--   updatedAt       ? updated_at
-- ------------------------------------------------------------
DROP VIEW IF EXISTS cnpscy_oi_offer_products;
CREATE VIEW cnpscy_oi_offer_products AS
SELECT
  CAST(p.advert_id AS CHAR)     AS merchantId,
  p.asin                        AS asin,
  p.product_name                AS productName,
  p.price_value                 AS price,
  p.category_name               AS category,
  p.p_rank                      AS bsr,
  NULL                          AS subCategoryBsr,
  p.payout_aff                  AS commissionRate,
  p.updated_at                  AS updatedAt
FROM cnpscy_amazon_product p;


-- ------------------------------------------------------------
-- VIEW: cnpscy_oi_offer_monthly_amazon_metrics ? ?? Amazon ??
--
-- ???
--   order_time_day ? int(11) ?? YYYYMMDD?? 20260710?
--   LEFT(CAST(..., CHAR), 6) ?? YYYYMM
--   cnpscy_amazon_order ?? clicks/dpv(detail_page_views)/
--   atc(add_to_carts)/directSales/haloSales ??
-- ------------------------------------------------------------
DROP VIEW IF EXISTS cnpscy_oi_offer_monthly_amazon_metrics;
CREATE VIEW cnpscy_oi_offer_monthly_amazon_metrics AS
SELECT
  CAST(o.advert_id AS CHAR)                         AS merchantId,
  CONCAT(
    SUBSTRING(CAST(o.order_time_day AS CHAR), 1, 4),
    '-',
    SUBSTRING(CAST(o.order_time_day AS CHAR), 5, 2)
  )                                                 AS month,
  SUM(COALESCE(o.clicks, 0))                       AS clicks,
  COUNT(*)                                          AS orders,
  SUM(COALESCE(o.amount, 0))                        AS revenue,
  SUM(COALESCE(o.payout, 0))                        AS payout,
  SUM(COALESCE(o.aff_payout, 0))                    AS affiliatePayout,
  CASE WHEN SUM(COALESCE(o.clicks, 0)) > 0
    THEN SUM(COALESCE(o.amount, 0)) / SUM(COALESCE(o.clicks, 0))
    ELSE 0 END                                      AS epc,
  CASE WHEN COUNT(*) > 0
    THEN SUM(COALESCE(o.amount, 0)) / COUNT(*)
    ELSE 0 END                                      AS aov,
  CASE WHEN SUM(COALESCE(o.clicks, 0)) > 0
    THEN COUNT(*) / SUM(COALESCE(o.clicks, 0))
    ELSE 0 END                                      AS conversionRate,
  SUM(COALESCE(o.detail_page_views, 0))             AS dpv,
  SUM(COALESCE(o.add_to_carts, 0))                  AS atc,
  SUM(COALESCE(o.directSales, 0))                   AS directSales,
  SUM(COALESCE(o.haloSales, 0))                     AS haloSales
FROM cnpscy_amazon_order o
GROUP BY
  CAST(o.advert_id AS CHAR),
  CONCAT(
    SUBSTRING(CAST(o.order_time_day AS CHAR), 1, 4),
    '-',
    SUBSTRING(CAST(o.order_time_day AS CHAR), 5, 2)
  );


-- ------------------------------------------------------------
-- VIEW: cnpscy_oi_offer_monthly_aggregate_metrics ? ??????
--
-- ?? cnpscy_order_new_aggregate ?
-- ------------------------------------------------------------
DROP VIEW IF EXISTS cnpscy_oi_offer_monthly_aggregate_metrics;
CREATE VIEW cnpscy_oi_offer_monthly_aggregate_metrics AS
SELECT
  CAST(a.advert_id AS CHAR)                         AS merchantId,
  CONCAT(
    SUBSTRING(CAST(a.order_time_day AS CHAR), 1, 4),
    '-',
    SUBSTRING(CAST(a.order_time_day AS CHAR), 5, 2)
  )                                                 AS month,
  0                                                 AS clicks,
  SUM(COALESCE(a.order_num, 0))                     AS orders,
  SUM(COALESCE(a.amount, 0))                        AS revenue,
  SUM(COALESCE(a.payout, 0))                        AS payout
FROM cnpscy_order_new_aggregate a
GROUP BY
  CAST(a.advert_id AS CHAR),
  CONCAT(
    SUBSTRING(CAST(a.order_time_day AS CHAR), 1, 4),
    '-',
    SUBSTRING(CAST(a.order_time_day AS CHAR), 5, 2)
  );


-- ------------------------------------------------------------
-- VIEW: cnpscy_oi_levanta_monthly_metrics ? Levanta ????
--
-- ??: Levanta ?????? API??? cnpscy_* ???
--       ????????????? Levanta API ????????
--       ?????????
-- ------------------------------------------------------------
DROP VIEW IF EXISTS cnpscy_oi_levanta_monthly_metrics;
CREATE VIEW cnpscy_oi_levanta_monthly_metrics AS
SELECT
  ''    AS merchantId,
  ''    AS month,
  0     AS salesAmount,
  0     AS commissionAmount,
  ''    AS metricSource
FROM DUAL
WHERE FALSE;
