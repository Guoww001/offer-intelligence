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

CREATE TABLE IF NOT EXISTS oi_tier_move_history (
  eventId BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  merchantId VARCHAR(32) NOT NULL,
  merchantName VARCHAR(255) DEFAULT NULL,
  sourceTier VARCHAR(32) DEFAULT NULL,
  targetTier VARCHAR(32) NOT NULL,
  source VARCHAR(64) NOT NULL,
  movedAt DATETIME NOT NULL,
  movedBy VARCHAR(128) DEFAULT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (eventId),
  KEY idx_oi_tier_move_merchant (merchantId),
  KEY idx_oi_tier_move_target_time (targetTier, movedAt),
  KEY idx_oi_tier_move_source (source)
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

CREATE TABLE IF NOT EXISTS oi_merchant_aov_estimates (
  estimateId BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  merchantId VARCHAR(32) NOT NULL,
  merchantName VARCHAR(255) DEFAULT NULL,
  aov DECIMAL(12,6) NOT NULL,
  currency VARCHAR(8) DEFAULT NULL,
  sampleProductCount SMALLINT UNSIGNED NOT NULL DEFAULT 5,
  method VARCHAR(64) NOT NULL DEFAULT 'five_product_average',
  sourceFile VARCHAR(255) NOT NULL,
  sourceDate DATE NOT NULL,
  importedBy VARCHAR(128) DEFAULT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (estimateId),
  UNIQUE KEY uq_merchant_aov_source_date (merchantId, sourceDate),
  KEY idx_merchant_aov_latest (merchantId, sourceDate),
  KEY idx_merchant_aov_method (method)
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

-- Anonymous chatbot question history for usage analysis and export.
CREATE TABLE IF NOT EXISTS oi_chatbot_question_logs (
  recordId BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  eventId CHAR(36) NOT NULL,
  anonymousSessionId VARCHAR(64) NOT NULL,
  mode VARCHAR(16) NOT NULL,
  prompt TEXT NOT NULL,
  language VARCHAR(8) NOT NULL,
  intent VARCHAR(64) NOT NULL DEFAULT 'unknown',
  status VARCHAR(16) NOT NULL DEFAULT 'submitted',
  submittedAt DATETIME(6) NOT NULL,
  completedAt DATETIME(6) DEFAULT NULL,
  updatedAt DATETIME(6) NOT NULL,
  PRIMARY KEY (recordId),
  UNIQUE KEY uq_chatbot_question_event (eventId),
  KEY idx_chatbot_question_submitted (submittedAt, recordId),
  KEY idx_chatbot_question_mode (mode, submittedAt),
  KEY idx_chatbot_question_session (anonymousSessionId, submittedAt),
  KEY idx_chatbot_question_intent (intent, submittedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Explicit dissatisfaction feedback linked one-to-one with a successful question log.
CREATE TABLE IF NOT EXISTS oi_chatbot_answer_feedback (
  feedbackId BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  feedbackEventId CHAR(36) NOT NULL,
  questionEventId CHAR(36) NOT NULL,
  anonymousSessionId VARCHAR(64) NOT NULL,
  mode VARCHAR(16) NOT NULL,
  prompt TEXT NOT NULL,
  language VARCHAR(8) NOT NULL,
  answer MEDIUMTEXT NOT NULL,
  answerTruncated TINYINT(1) NOT NULL DEFAULT 0,
  reasonCode VARCHAR(32) NOT NULL,
  reasonDetail TEXT NOT NULL,
  submittedAt DATETIME(6) NOT NULL,
  PRIMARY KEY (feedbackId),
  UNIQUE KEY uq_chatbot_feedback_event (feedbackEventId),
  UNIQUE KEY uq_chatbot_feedback_question (questionEventId),
  KEY idx_chatbot_feedback_submitted (submittedAt, feedbackId),
  KEY idx_chatbot_feedback_mode (mode, submittedAt),
  KEY idx_chatbot_feedback_reason (reasonCode, submittedAt),
  KEY idx_chatbot_feedback_session (anonymousSessionId, submittedAt),
  CONSTRAINT fk_chatbot_feedback_question
    FOREIGN KEY (questionEventId) REFERENCES oi_chatbot_question_logs (eventId)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Agent runtime trace. Production setup creates the cnpscy_oi_* names via
-- scripts/ensure_oi_schema.py; these unprefixed names document the contract.
CREATE TABLE IF NOT EXISTS oi_agent_runs (
  runId               CHAR(36) NOT NULL,
  questionEventId     CHAR(36) NOT NULL,
  anonymousSessionId  VARCHAR(64) NOT NULL,
  mode                VARCHAR(16) NOT NULL,
  language            VARCHAR(8) NOT NULL,
  status              VARCHAR(16) NOT NULL,
  startedAt           DATETIME(6) NOT NULL,
  completedAt         DATETIME(6) DEFAULT NULL,
  durationMs          BIGINT UNSIGNED DEFAULT NULL,
  planningBypassed    TINYINT(1) NOT NULL DEFAULT 0,
  partial             TINYINT(1) NOT NULL DEFAULT 0,
  fallbackDelivered   TINYINT(1) NOT NULL DEFAULT 0,
  stoppedByUser       TINYINT(1) NOT NULL DEFAULT 0,
  plannedToolCalls    INT UNSIGNED NOT NULL DEFAULT 0,
  executedToolCalls   INT UNSIGNED NOT NULL DEFAULT 0,
  failedToolCalls     INT UNSIGNED NOT NULL DEFAULT 0,
  errorCode           VARCHAR(64) DEFAULT NULL,
  createdAt           DATETIME(6) NOT NULL,
  PRIMARY KEY (runId),
  KEY idx_agent_run_question (questionEventId),
  KEY idx_agent_run_status_started (status, startedAt),
  KEY idx_agent_run_session_started (anonymousSessionId, startedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS oi_agent_steps (
  stepId              CHAR(36) NOT NULL,
  runId               CHAR(36) NOT NULL,
  questionEventId     CHAR(36) NOT NULL,
  sequence            INT UNSIGNED NOT NULL,
  phase               VARCHAR(16) NOT NULL,
  toolName            VARCHAR(64) DEFAULT NULL,
  status              VARCHAR(16) NOT NULL,
  startedAt           DATETIME(6) DEFAULT NULL,
  completedAt         DATETIME(6) DEFAULT NULL,
  durationMs          BIGINT UNSIGNED DEFAULT NULL,
  provider            VARCHAR(64) DEFAULT NULL,
  model               VARCHAR(128) DEFAULT NULL,
  inputBytes          INT UNSIGNED DEFAULT NULL,
  inputTokens         INT UNSIGNED DEFAULT NULL,
  outputTokens        INT UNSIGNED DEFAULT NULL,
  totalTokens         INT UNSIGNED DEFAULT NULL,
  usageAvailable      TINYINT(1) NOT NULL DEFAULT 0,
  outputChunks        INT UNSIGNED DEFAULT NULL,
  dataSource          VARCHAR(16) NOT NULL DEFAULT 'unknown',
  dataAsOf            VARCHAR(64) DEFAULT NULL,
  estimated           TINYINT(1) NOT NULL DEFAULT 0,
  errorCode           VARCHAR(64) DEFAULT NULL,
  retryCount          INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (stepId),
  UNIQUE KEY uq_agent_step_run_sequence (runId, sequence),
  KEY idx_agent_step_question (questionEventId),
  KEY idx_agent_step_run_phase_status (runId, phase, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
