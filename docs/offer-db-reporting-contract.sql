-- Offer Intelligence reporting contract for MySQL 5.6.
-- Run this in a staging copy first, then adjust view SELECT columns to the
-- exact production schema aliases. The app reads only oi_* objects.

CREATE TABLE IF NOT EXISTS oi_tier_assignments (
  merchantId VARCHAR(32) NOT NULL,
  tier VARCHAR(32) NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'google_sheet',
  movedFromTier VARCHAR(32) DEFAULT NULL,
  movedAt DATETIME DEFAULT NULL,
  updatedBy VARCHAR(128) DEFAULT NULL,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (merchantId),
  KEY idx_oi_tier_assignments_tier (tier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS oi_tier_visual_status (
  merchantId VARCHAR(32) NOT NULL,
  color ENUM('green','yellow','red','none') NOT NULL DEFAULT 'none',
  reason_code VARCHAR(64) NOT NULL DEFAULT 'no_rule_match',
  reason_text VARCHAR(512) DEFAULT NULL,
  source ENUM('rule','manual') NOT NULL DEFAULT 'rule',
  updatedBy VARCHAR(128) DEFAULT NULL,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (merchantId),
  KEY idx_oi_tier_visual_status_color (color),
  KEY idx_oi_tier_visual_status_source (source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Required view aliases:
--
-- oi_offer_base
--   merchantId, merchantName, levantaBrandId, network, category,
--   commissionRate, paymentCycle, productCount, updatedAt
--
-- oi_offer_products
--   merchantId, asin, productName, price, category, bsr,
--   subCategoryBsr, commissionRate, updatedAt
--
-- oi_offer_monthly_amazon_metrics
--   merchantId, month, clicks, orders, revenue, payout, affiliatePayout,
--   epc, aov, conversionRate, dpv, atc, directSales, haloSales
--
-- oi_offer_monthly_aggregate_metrics
--   merchantId, month, clicks, orders, revenue, payout
--
-- oi_levanta_monthly_metrics
--   merchantId, month, salesAmount, commissionAmount, metricSource
--
-- Example pattern, not a blind production migration:
--
-- CREATE OR REPLACE VIEW oi_offer_monthly_amazon_metrics AS
-- SELECT
--   CAST(advert_id AS CHAR) AS merchantId,
--   CONCAT(SUBSTRING(CAST(order_time_day AS CHAR), 1, 4), '-', SUBSTRING(CAST(order_time_day AS CHAR), 5, 2)) AS month,
--   SUM(COALESCE(clicks, 0)) AS clicks,
--   COUNT(*) AS orders,
--   SUM(COALESCE(amount, 0)) AS revenue,
--   SUM(COALESCE(payout, 0)) AS payout,
--   SUM(COALESCE(aff_payout, 0)) AS affiliatePayout,
--   CASE WHEN SUM(COALESCE(clicks, 0)) > 0 THEN SUM(COALESCE(amount, 0)) / SUM(COALESCE(clicks, 0)) ELSE 0 END AS epc,
--   CASE WHEN COUNT(*) > 0 THEN SUM(COALESCE(amount, 0)) / COUNT(*) ELSE 0 END AS aov,
--   CASE WHEN SUM(COALESCE(clicks, 0)) > 0 THEN COUNT(*) / SUM(COALESCE(clicks, 0)) ELSE 0 END AS conversionRate,
--   SUM(COALESCE(dpv, 0)) AS dpv,
--   SUM(COALESCE(atc, 0)) AS atc,
--   SUM(COALESCE(direct_sales, 0)) AS directSales,
--   SUM(COALESCE(halo_sales, 0)) AS haloSales
-- FROM cnpscy_amazon_order
-- GROUP BY advert_id, CONCAT(SUBSTRING(CAST(order_time_day AS CHAR), 1, 4), '-', SUBSTRING(CAST(order_time_day AS CHAR), 5, 2));


-- 分类定义表（自引用，支持任意层级）
CREATE TABLE IF NOT EXISTS oi_category (
  categoryId INT AUTO_INCREMENT PRIMARY KEY,
  categoryName VARCHAR(128) NOT NULL COMMENT '分类名称',
  parentCategoryId INT DEFAULT NULL COMMENT '父分类ID，NULL表示一级类目',
  level TINYINT NOT NULL DEFAULT 1 COMMENT '层级：1=主类目，2=次类目',
  sortOrder INT DEFAULT 0 COMMENT '排序',
  source VARCHAR(32) DEFAULT 'manual' COMMENT '数据来源',
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_parent (parentCategoryId),
  KEY idx_level (level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 商户-分类关联表
CREATE TABLE IF NOT EXISTS oi_merchant_category (
  merchantId VARCHAR(32) NOT NULL,
  categoryId INT NOT NULL COMMENT '关联到 oi_category.categoryId',
  PRIMARY KEY (merchantId, categoryId),
  KEY idx_category (categoryId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;