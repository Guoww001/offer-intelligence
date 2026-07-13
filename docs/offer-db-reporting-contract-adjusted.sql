-- ============================================================
-- Offer Intelligence 报表层 DDL（基于生产环境实际表结构调整）
-- 数据库: yg_ht_test @ 43.153.38.91
-- 生成时间: 2026-07-10
-- 说明: 原合约 docs/offer-db-reporting-contract.sql 中的列名假设
--        与实际表结构有偏差，本文件已根据 SHOW COLUMNS 结果修正。
-- ============================================================

-- ============================================================
-- 第一部分：TABLE（需要写入数据的实体表）
-- ============================================================



-- 1. 分层分配表
DROP TABLE IF EXISTS cnpscy_oi_tier_assignments;
CREATE TABLE cnpscy_oi_tier_assignments (
  merchantId VARCHAR(32) NOT NULL COMMENT '商户ID，对应 cnpscy_advert.advert_id',
  tier        VARCHAR(32) NOT NULL COMMENT '分层名称',
  source      VARCHAR(32) NOT NULL DEFAULT 'google_sheet' COMMENT '来源',
  movedFromTier VARCHAR(32) DEFAULT NULL,
  movedAt       DATETIME DEFAULT NULL,
  updatedBy     VARCHAR(128) DEFAULT NULL,
  updatedAt     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (merchantId),
  KEY idx_cnpscy_oi_tier_assignments_tier (tier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. 分层视觉状态表
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

-- 3. 分类定义表（自引用，支持多层级）
DROP TABLE IF EXISTS cnpscy_oi_category;
CREATE TABLE cnpscy_oi_category (
  categoryId       INT AUTO_INCREMENT PRIMARY KEY,
  categoryName     VARCHAR(128) NOT NULL COMMENT '分类名称',
  parentCategoryId INT DEFAULT NULL COMMENT '父分类ID，NULL表示一级类目',
  level            TINYINT NOT NULL DEFAULT 1 COMMENT '层级：1=主类目，2=次类目',
  sortOrder        INT DEFAULT 0 COMMENT '排序',
  source           VARCHAR(32) DEFAULT 'manual' COMMENT '数据来源',
  categoryNameCn   VARCHAR(128) DEFAULT NULL COMMENT '中文类目名',
  updatedAt        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_parent (parentCategoryId),
  KEY idx_level (level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. 商户-分类关联表
DROP TABLE IF EXISTS cnpscy_oi_merchant_category;
CREATE TABLE cnpscy_oi_merchant_category (
  merchantId VARCHAR(32) NOT NULL,
  categoryId INT NOT NULL COMMENT '关联到 cnpscy_oi_category.categoryId',
  PRIMARY KEY (merchantId, categoryId),
  KEY idx_category (categoryId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. 支付记录表（来自 Levanta API）
DROP TABLE IF EXISTS cnpscy_oi_payment_records;
CREATE TABLE cnpscy_oi_payment_records (
  id                      VARCHAR(128) NOT NULL COMMENT '唯一标识: merchantId::monthKey::brandKey',
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
  reportMonth             VARCHAR(16) NOT NULL COMMENT '报表月份名称, e.g. January',
  reportYear              INT NOT NULL COMMENT '报表年份',
  reportMonthKey          VARCHAR(7) NOT NULL COMMENT 'YYYY-MM 格式',
  revenueMade             DECIMAL(12,2) NOT NULL DEFAULT 0,
  commissionMade          DECIMAL(12,2) NOT NULL DEFAULT 0,
  expectedPaymentAmount   DECIMAL(12,2) NOT NULL DEFAULT 0,
  paidAmount              DECIMAL(12,2) NOT NULL DEFAULT 0,
  remainingAmount         DECIMAL(12,2) NOT NULL DEFAULT 0,
  paymentCycle            INT NOT NULL DEFAULT 60 COMMENT '账期天数',
  paymentAvailabilityDate VARCHAR(16) DEFAULT NULL COMMENT '预计到账日期',
  expectedPaymentDate     VARCHAR(16) DEFAULT NULL,
  paymentStatus           VARCHAR(16) NOT NULL DEFAULT 'Unknown' COMMENT 'Paid|Pending|Unpaid|Overdue|Partial|Unknown',
  rawStatus               VARCHAR(32) DEFAULT NULL COMMENT 'Levanta 原始状态',
  lastCheckedDate         VARCHAR(16) DEFAULT NULL,
  currency                VARCHAR(8) DEFAULT 'USD',
  isPlaceholder           TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否为占位记录',
  notes                   TEXT DEFAULT NULL,
  updatedAt               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payment_merchant (merchantId),
  KEY idx_payment_month (reportMonthKey),
  KEY idx_payment_status (paymentStatus),
  KEY idx_payment_tier (tier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6. Offer Sheet 运营元数据表（来自 Google Sheets 的人工标注）
DROP TABLE IF EXISTS cnpscy_oi_offer_sheet_metadata;
CREATE TABLE cnpscy_oi_offer_sheet_metadata (
  merchantId          VARCHAR(32) NOT NULL,
  reason              TEXT DEFAULT NULL COMMENT 'Tier 原因 / 黑名单原因',
  recommendation      TEXT DEFAULT NULL COMMENT '运营建议',
  recommendedLink     VARCHAR(512) DEFAULT NULL COMMENT '推荐链接',
  phase               VARCHAR(64) DEFAULT NULL COMMENT '运营阶段',
  publisherCount      VARCHAR(32) DEFAULT NULL,
  successRate         DECIMAL(10,6) DEFAULT NULL,
  publisherCountJune  VARCHAR(32) DEFAULT NULL,
  successRateJune     DECIMAL(10,6) DEFAULT NULL,
  completionRate      DECIMAL(10,6) DEFAULT NULL,
  timeline            VARCHAR(128) DEFAULT NULL,
  bestSubCategoryBsr  VARCHAR(128) DEFAULT NULL,
  mainCategoryBsr     VARCHAR(64) DEFAULT NULL COMMENT '主类目 BSR 排名（来自飞书）',
  subcategoryBsr      VARCHAR(64) DEFAULT NULL COMMENT '子类目 BSR 排名（来自飞书）',
  paymentCycle        INT DEFAULT NULL COMMENT 'Sheet 中标注的账期天数（覆盖默认值）',
  paymentCycleSource  VARCHAR(32) DEFAULT 'network_default' COMMENT 'google_sheet | network_default',
  sheetCategory       VARCHAR(128) DEFAULT NULL COMMENT 'Google Sheet 直接标注的分类',
  categorySource      VARCHAR(32) DEFAULT NULL COMMENT '分类来源: Google Sheet | Feishu | Levanta | Source',
  sourceSheet         VARCHAR(64) DEFAULT NULL COMMENT '来源 Sheet 名称',
  rowNumber           INT DEFAULT NULL,
  originalRank        INT DEFAULT NULL,
  backendMatchStatus  VARCHAR(64) DEFAULT NULL,
  region              VARCHAR(16) DEFAULT NULL COMMENT '从 Sheet/CSV 推断的 region',
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
-- 1.5：已有表的增量变更（幂等，可重复执行）
-- ============================================================

-- cnpscy_oi_category 新增列（若尚未添加）
ALTER TABLE cnpscy_oi_category
  ADD COLUMN IF NOT EXISTS categoryNameCn VARCHAR(128) DEFAULT NULL COMMENT '中文类目名'
  AFTER source;


-- ============================================================
-- 第二部分：VIEW（从 cnpscy_* 原始表映射到 cnpscy_oi_* 报表层）
-- ============================================================

-- ------------------------------------------------------------
-- VIEW: cnpscy_oi_offer_base — 商户基础信息
--
-- 列映射说明：
--   merchantId    ← advert_id (int → char)
--   merchantName  ← advert_name
--   levantaBrandId ← m_id (Levanta 品牌ID)
--   network       ← advert_lianmeng_id (联盟网络，非直接字段)
--   category      ← NULL (由外部 CSV/飞书数据补充)
--   commissionRate ← advert_money (float)
--   paymentCycle  ← NULL (由 Google Sheets 数据补充)
--   productCount  ← 从 cnpscy_amazon_product 子查询统计
--   region        ← NULL (由 cnpscy_oi_offer_sheet_metadata 补充)
--   updatedAt     ← NULL (cnpscy_advert 无时间戳字段)
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
-- VIEW: cnpscy_oi_offer_products — 商户产品（ASIN 级别）
--
-- 列映射：
--   merchantId      ← advert_id (int → char)
--   asin            ← asin
--   productName     ← product_name
--   price           ← price_value
--   category        ← category_name
--   bsr             ← p_rank (Best Seller Rank)
--   subCategoryBsr ← NULL (可从 product_extra 的 bsr_rank_2 补充)
--   commissionRate  ← payout_aff
--   updatedAt       ← updated_at
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
-- VIEW: cnpscy_oi_offer_monthly_amazon_metrics — 月度 Amazon 指标
--
-- 说明：
--   order_time_day 是 int(11) 格式 YYYYMMDD（如 20260710）
--   LEFT(CAST(..., CHAR), 6) 提取 YYYYMM
--   cnpscy_amazon_order 包含 clicks/dpv(detail_page_views)/
--   atc(add_to_carts)/directSales/haloSales 等列
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
-- VIEW: cnpscy_oi_offer_monthly_aggregate_metrics — 月度聚合指标
--
-- 来自 cnpscy_order_new_aggregate 表
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
-- VIEW: cnpscy_oi_levanta_monthly_metrics — Levanta 月度指标
--
-- 说明: Levanta 数据来自外部 API，不在 cnpscy_* 表中。
--       此视图留作占位，数据可通过 Levanta API 同步到独立表中。
--       当前返回空结果集。
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
