"""Permanent merchant profiles and the authoritative Direct -> Tier 1 rule.

The legacy monthly route is retained as an API alias. Months are provenance,
never a membership filter. All writes and first-run migrations share a MySQL
advisory lock, including across serverless instances.
"""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import re
import threading
import unicodedata

import offer_db as db

TABLE = "cnpscy_oi_merchant_registry"
META_TABLE = "cnpscy_oi_merchant_registry_migrations"
SOURCE = "merchant-registry-direct"
LOCK = "oi-merchant-registry-v1"
SEED = Path(__file__).with_name("merchant_registry_seed.json")
EXTRA_FIELDS = {
    "site": 128, "contractNumber": 255, "notes": 4000,
    "contactName": 255, "category": 255, "onboardingDate": 64,
    "sourceSection": 255, "sourceFile": 255, "merchantStatus": 128,
    "sourceMerchantId": 64,
}
DDL = f"""CREATE TABLE IF NOT EXISTS {TABLE} (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"""
_ready = False
_schema_lock = threading.Lock()
META_DDL = f"""CREATE TABLE IF NOT EXISTS {META_TABLE} (
    migrationKey VARCHAR(128) NOT NULL PRIMARY KEY,
    appliedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"""


class RegistrySchemaUnavailable(db.OfferDbError):
    """The database administrator has not provisioned the registry tables."""


SCHEMA_SETUP_MESSAGE = (
    "Merchant registry setup is pending. A database administrator must apply "
    "docs/merchant-registry-schema.sql and grant SELECT, INSERT and UPDATE on the new tables, "
    "then rerun Sync permanent merchant registry."
)


def ensure_registry_table(conn, table, ddl):
    try:
        db.fetch_one(conn, f"SELECT 1 FROM {table} LIMIT 0")
        return
    except Exception as error:
        if error.args and error.args[0] == 1142:
            raise RegistrySchemaUnavailable(SCHEMA_SETUP_MESSAGE) from error
        if not error.args or error.args[0] != 1146:
            raise
    try:
        with conn.cursor() as cursor:
            cursor.execute(ddl)
    except Exception as error:
        if error.args and error.args[0] == 1142:
            raise RegistrySchemaUnavailable(SCHEMA_SETUP_MESSAGE) from error
        raise


def name_key(value):
    return " ".join(unicodedata.normalize("NFKC", str(value or "")).casefold().split())


def merchant_ids(value):
    raw = str(value or "").strip()
    return tuple(dict.fromkeys(re.split(r"\s*/\s*", raw))) if re.fullmatch(r"\d+(?:\s*/\s*\d+)*", raw) else ()


def is_direct(record):
    return str(record.get("platform") or "").strip().casefold() == "direct"


def identity_key(record):
    ids = merchant_ids(record.get("merchantId"))
    value = "id:" + "/".join(sorted(ids)) if ids else "name:" + name_key(record["merchantName"])
    return hashlib.sha256(value.encode()).hexdigest()


def normalize(payload, actor):
    # Reuse the existing money, percentage, length and required-name validators.
    values = db._monthly_new_merchant_values({**payload, "merchantId": ""}, updated_by=actor)
    raw_id = db._monthly_new_merchant_text(payload, "merchantId", maximum=64)
    values["merchantId"] = "/".join(merchant_ids(raw_id))
    for field, maximum in EXTRA_FIELDS.items():
        values[field] = db._monthly_new_merchant_text(payload, field, maximum=maximum)
    if raw_id:
        values["sourceMerchantId"] = raw_id
    return db._monthly_new_merchant_api_record(values)


def decode(row):
    profile = json.loads(row.get("profile") or "{}")
    result = {**profile, **{k: v for k, v in row.items() if k not in {"profile", "identityKey", "nameKey", "isDeleted"}}}
    result["merchantId"] = str(result.get("merchantId") or "")
    result["isPriority"] = bool(result.get("isPriority"))
    result["tier1Eligible"] = is_direct(result) and bool(merchant_ids(result["merchantId"]))
    return db._monthly_new_merchant_api_record(result)


def _records(conn, *, include_deleted=False):
    clause = "" if include_deleted else " WHERE isDeleted = 0"
    return db.fetch_all(conn, f"SELECT * FROM {TABLE}{clause} ORDER BY recordId")


@contextmanager
def locked(conn):
    result = db.fetch_one(conn, "SELECT GET_LOCK(%s, 30) AS acquired", (LOCK,))
    if not result or result.get("acquired") != 1:
        raise db.OfferDbError("Merchant registry is busy. Please retry.")
    try:
        conn.begin()
        yield
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        db.fetch_one(conn, "SELECT RELEASE_LOCK(%s) AS released", (LOCK,))


def match_record(rows, incoming):
    """Match by ID first; only claim a name-only profile when unambiguous.

    Conflicting names sharing an ID remain separate profiles with the second
    ID unresolved. No guessed ID or accidental cross-network name merge.
    """
    ids = set(merchant_ids(incoming.get("merchantId")))
    key = name_key(incoming["merchantName"])
    id_matches = [r for r in rows if ids.intersection(merchant_ids(r.get("merchantId")))]
    if id_matches:
        same_name = [r for r in id_matches if name_key(r["merchantName"]) == key]
        if len(same_name) == 1:
            return same_name[0], ""
        unresolved = [r for r in rows if not merchant_ids(r.get("merchantId")) and name_key(r["merchantName"]) == key]
        warning = f"Merchant ID {incoming['merchantId']} is also used by {id_matches[0]['merchantName']}; confirm this brand's ID."
        return unresolved[0] if len(unresolved) == 1 else None, warning
    names = [r for r in rows if name_key(r["merchantName"]) == key]
    if ids:
        names = [r for r in names if not merchant_ids(r.get("merchantId"))]
    if len(names) > 1:
        raise ValueError("Multiple merchants share this brand name. Supply a Merchant ID.")
    return names[0] if names else None, ""


def merge_profile(existing, incoming, *, merge_only):
    if not existing:
        return incoming.copy()
    result = existing.copy()
    for field, value in incoming.items():
        if field in {"recordId", "createdAt", "createdBy", "updatedAt"}:
            continue
        if merge_only and (value is None or value == "" or value is False):
            continue
        result[field] = value
    # First recorded month is provenance only; it never limits visibility.
    result["reportMonth"] = existing.get("reportMonth") or incoming.get("reportMonth", "")
    return result


def _upsert(conn, payload, actor, *, merge_only=True):
    values = normalize(payload, actor)
    rows = _records(conn, include_deleted=True)
    record_id = values.get("recordId")
    if record_id:
        found = next((r for r in rows if r["recordId"] == record_id and not r.get("isDeleted")), None)
        if not found:
            raise ValueError("Merchant record was not found.")
        other, conflict = match_record([r for r in rows if r["recordId"] != record_id], values)
        if conflict or other:
            raise ValueError("This Merchant ID or brand is already recorded in another profile.")
    else:
        found, conflict = match_record(rows, values)
        if found and found.get("isDeleted"):
            # Explicit re-import restores an archived record; seed migration is one-off.
            pass
        if conflict:
            values["merchantId"] = ""
            values["identityWarning"] = conflict
    previous = decode(found) if found else None
    if record_id and previous and previous.get("identityWarning") and values.get("merchantId"):
        values["identityWarning"] = ""
    merged = merge_profile(previous, values, merge_only=merge_only)
    if merge_only and previous:
        previous_ids = merchant_ids(previous.get("merchantId"))
        incoming_ids = merchant_ids(values.get("merchantId"))
        if set(previous_ids).intersection(incoming_ids):
            merged["merchantId"] = "/".join(dict.fromkeys((*previous_ids, *incoming_ids)))
        if previous.get("sourceSection") and values.get("sourceSection"):
            merged["sourceSection"] = "; ".join(dict.fromkeys(
                part.strip() for value in (previous["sourceSection"], values["sourceSection"])
                for part in value.split(";") if part.strip()
            ))
    if payload.get("_authoritativePlatform"):
        merged["platform"] = values["platform"]
    merged.pop("tier1Eligible", None)
    key = identity_key(merged)
    encoded = json.dumps(merged, ensure_ascii=False, separators=(",", ":"))
    with conn.cursor() as cursor:
        if found:
            cursor.execute(f"""UPDATE {TABLE} SET identityKey=%s, merchantId=%s,
                merchantName=%s, nameKey=%s, platform=%s, profile=%s,
                isDeleted=0, updatedBy=%s, updatedAt=UTC_TIMESTAMP()
                WHERE recordId=%s""", (key, merged["merchantId"] or None,
                merged["merchantName"], name_key(merged["merchantName"]),
                merged["platform"] or None, encoded, actor, found["recordId"]))
            record_id = found["recordId"]
        else:
            cursor.execute(f"""INSERT INTO {TABLE}
                (identityKey, merchantId, merchantName, nameKey, platform, profile, createdBy, updatedBy)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""", (key,
                merged["merchantId"] or None, merged["merchantName"],
                name_key(merged["merchantName"]), merged["platform"] or None,
                encoded, actor, actor))
            record_id = cursor.lastrowid
    row = db.fetch_one(conn, f"SELECT * FROM {TABLE} WHERE recordId=%s", (record_id,))
    return {"ok": True, "action": "updated" if found else "created", "record": decode(row)}


def sync_tiers(conn, records):
    direct = {mid: r for r in records if is_direct(r) for mid in merchant_ids(r.get("merchantId"))}
    assignments = db.fetch_all(conn, "SELECT merchantId, tier, movedFromTier FROM cnpscy_oi_tier_assignments")
    by_id = {str(r["merchantId"]): r for r in assignments}
    changes = []
    for mid, row in by_id.items():
        if row.get("tier") == "Tier 1" and mid not in direct:
            fallback = row.get("movedFromTier")
            if fallback not in {"Tier 2", "Tier 3", "Tier 4", "BLACK TIER"}:
                fallback = "Tier 4"
            changes.append((mid, fallback, row))
    for mid in direct:
        row = by_id.get(mid) or {}
        if row.get("tier") != "Tier 1":
            changes.append((mid, "Tier 1", row))
    for record in records:
        for mid in merchant_ids(record.get("merchantId")):
            if mid not in by_id and mid not in direct:
                changes.append((mid, "Tier 4", {}))
    with conn.cursor() as cursor:
        for mid, tier, old in changes:
            cursor.execute("""INSERT INTO cnpscy_oi_tier_assignments
                (merchantId,tier,source,movedFromTier,movedAt,updatedBy)
                VALUES (%s,%s,%s,%s,UTC_TIMESTAMP(),%s)
                ON DUPLICATE KEY UPDATE tier=VALUES(tier),source=VALUES(source),
                movedFromTier=VALUES(movedFromTier),movedAt=VALUES(movedAt),updatedBy=VALUES(updatedBy)""",
                (mid, tier, SOURCE, old.get("tier"), SOURCE))
            cursor.execute("""INSERT INTO cnpscy_oi_tier_move_history
                (merchantId,merchantName,sourceTier,targetTier,source,movedAt,movedBy)
                VALUES (%s,%s,%s,%s,%s,UTC_TIMESTAMP(),%s)""",
                (mid, (direct.get(mid) or {}).get("merchantName"), old.get("tier"), tier, SOURCE, SOURCE))
    return len(changes)


def ensure_schema(conn):
    global _ready
    if _ready:
        return
    with _schema_lock:
        if _ready:
            return
        db.ensure_monthly_new_merchants_schema(conn)
        ensure_registry_table(conn, TABLE, DDL)
        ensure_registry_table(conn, META_TABLE, META_DDL)
        with locked(conn):
            applied = {r["migrationKey"] for r in db.fetch_all(conn, f"SELECT migrationKey FROM {META_TABLE}")}
            for migration in ("legacy-monthly-v1", "alliance-workbook-20261026-v1"):
                if migration in applied:
                    continue
                if migration == "legacy-monthly-v1":
                    source = db.fetch_all(conn, "SELECT * FROM cnpscy_oi_monthly_new_merchants ORDER BY updatedAt, recordId")
                else:
                    source = json.loads(SEED.read_text(encoding="utf-8"))["records"]
                for raw in source:
                    raw = {**raw, "recordId": None}
                    _upsert(conn, raw, migration, merge_only=True)
                with conn.cursor() as cursor:
                    cursor.execute(f"INSERT INTO {META_TABLE} (migrationKey) VALUES (%s)", (migration,))
            sync_tiers(conn, [decode(r) for r in _records(conn)])
        _ready = True


def version(records):
    return hashlib.sha256(json.dumps(records, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()


def snapshot(conn=None):
    if conn is None:
        with db.db_connection() as connection:
            return snapshot(connection)
    ensure_schema(conn)
    with locked(conn):
        records = [decode(r) for r in _records(conn)]
        sync_tiers(conn, records)
    return records, version(records)


def payload(month=None):
    records, revision = snapshot()
    records.sort(key=lambda r: (not r.get("isPriority"), name_key(r["merchantName"]), r["recordId"]))
    return {"ok": True, "checkedAt": db.utc_now_iso(), "scope": "permanent",
        "month": "", "version": revision, "source": TABLE, "records": records,
        "count": len(records), "priorityCount": sum(bool(r.get("isPriority")) for r in records),
        "gmvTargetTotal": sum(float(r.get("gmvMonthlyTarget") or 0) for r in records),
        "gmvTargetCount": sum(r.get("gmvMonthlyTarget") is not None for r in records)}


def report_snapshot(conn=None):
    """Keep existing reports available while an administrator provisions tables.

    Registry reads and writes remain strict. Only this specific setup error
    permits reports to use their existing assignments until migration succeeds.
    """
    try:
        return snapshot() if conn is None else snapshot(conn)
    except RegistrySchemaUnavailable:
        return [], "pending-schema"


def invalidate_caches():
    db._offers_memory_cache = None
    for cache in (db._offers_range_cache, db._tier_sheet_cache, db._status_cache, db._chatbot_cache, db._merchant_cache, db._search_cache):
        cache.clear()


def upsert(payload, *, updated_by):
    actor = str(updated_by or "offer-intelligence-ui")[:128]
    with db.db_connection() as conn:
        ensure_schema(conn)
        with locked(conn):
            result = _upsert(conn, payload, actor, merge_only=bool(payload.get("mergeOnly", not payload.get("recordId"))))
            sync_tiers(conn, [decode(r) for r in _records(conn)])
    invalidate_caches()
    return result


def delete(record_id, *, deleted_by):
    record_id = db._monthly_new_merchant_record_id(record_id)
    if not record_id:
        raise ValueError("recordId is required")
    with db.db_connection() as conn:
        ensure_schema(conn)
        with locked(conn):
            existing = db.fetch_one(conn, f"SELECT * FROM {TABLE} WHERE recordId=%s AND isDeleted=0", (record_id,))
            if not existing:
                return {"ok": False, "code": "record_not_found", "error": "Merchant record was not found."}
            with conn.cursor() as cursor:
                cursor.execute(f"UPDATE {TABLE} SET isDeleted=1, updatedBy=%s, updatedAt=UTC_TIMESTAMP() WHERE recordId=%s", (str(deleted_by)[:128], record_id))
            sync_tiers(conn, [decode(r) for r in _records(conn)])
    invalidate_caches()
    return {"ok": True, "action": "deleted", "recordId": record_id}
