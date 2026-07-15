#!/usr/bin/env python3
"""Rebuild db_offers_cache.json and db_keywords_cache.json from the MySQL database.

Called by the daily GitHub Actions workflow after DB sync completes.
Can also be run locally:

    python scripts/refresh_api_caches.py
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from offer_db import offers_payload, product_keywords_payload


def main() -> None:
    print("=== refresh_api_caches ===\n")

    print("[1/2] Rebuilding offers cache (force_refresh=True) ...", flush=True)
    t0 = time.time()
    offers = offers_payload(force_refresh=True)
    elapsed = time.time() - t0
    print(f"  offers: {offers['summary']['offerCount']} merchants")
    sheets = offers.get("sheets", [])
    for s in sheets:
        print(f"    {s['name']}: {len(s.get('rows', []))} rows")
    print(f"  payments: {len(offers.get('paymentRecords', []))} records")
    print(f"  completed in {elapsed:.0f}s\n")

    print("[2/2] Rebuilding keywords cache (force_refresh=True) ...", flush=True)
    t0 = time.time()
    kw = product_keywords_payload(force_refresh=True)
    elapsed = time.time() - t0
    print(f"  keywords: {kw['summary']['merchantCount']} merchants")
    print(f"  completed in {elapsed:.0f}s\n")

    print("=== cache refresh complete ===")


if __name__ == "__main__":
    main()
