-- Run once as a database administrator in the configured OFFER_DB_NAME database.
-- Keep the runtime account limited to SELECT, INSERT and UPDATE on these tables.

CREATE TABLE IF NOT EXISTS cnpscy_oi_merchant_registry (
    recordId BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    identityKey CHAR(64) NOT NULL,
    merchantId VARCHAR(64) DEFAULT NULL,
    merchantName VARCHAR(180) NOT NULL,
    nameKey VARCHAR(180) NOT NULL,
    platform VARCHAR(128) DEFAULT NULL,
    profile LONGTEXT NOT NULL,
    isDeleted TINYINT(1) NOT NULL DEFAULT 0,
    createdBy VARCHAR(128) NOT NULL,
    updatedBy VARCHAR(128) NOT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_registry_identity (identityKey),
    KEY idx_registry_name (nameKey),
    KEY idx_registry_platform (platform)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cnpscy_oi_merchant_registry_migrations (
    migrationKey VARCHAR(128) NOT NULL PRIMARY KEY,
    appliedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
