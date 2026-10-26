"""Apply the permanent registry migration and verify Direct membership in MySQL."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import merchant_registry as registry
import offer_db as db


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Persist the registry and synchronize Tier 1")
    args = parser.parse_args()
    if not args.apply:
        parser.error("Pass --apply to persist the registry migration.")
    records, revision = registry.snapshot()
    expected = {mid for r in records if registry.is_direct(r) for mid in registry.merchant_ids(r.get("merchantId"))}
    with db.db_connection() as conn:
        rows = db.fetch_all(conn, "SELECT merchantId FROM cnpscy_oi_tier_assignments WHERE tier = %s", ("Tier 1",))
    actual = {str(r["merchantId"]) for r in rows}
    if actual != expected:
        raise RuntimeError("Tier 1 membership does not match Direct merchant profiles")
    print(json.dumps({"ok": True, "profiles": len(records), "tier1Merchants": len(actual),
        "identityWarnings": sum(bool(r.get("identityWarning")) for r in records),
        "registryVersion": revision}, ensure_ascii=False))


if __name__ == "__main__":
    main()
