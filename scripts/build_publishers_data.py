#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def _load_dotenv(path: str = ".env") -> None:
    env_path = ROOT / path
    if not env_path.is_file():
        return
    with env_path.open("r", encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip("\"'")
            if key and key not in os.environ:
                os.environ[key] = value


_load_dotenv()

from offer_db import db_connection, fetch_all, utc_now_iso

AMAZON_DOMAIN_MAP = {
    "www.amazon.com": "amazon.com",
    "www.amazon.co.uk": "amazon.co.uk",
    "www.amazon.de": "amazon.de",
    "www.amazon.fr": "amazon.fr",
    "www.amazon.ca": "amazon.ca",
    "www.amazon.it": "amazon.it",
    "www.amazon.es": "amazon.es",
    "www.amazon.com.mx": "amazon.com.mx",
    "www.amazon.nl": "amazon.nl",
}

# Build SQL CASE expression for market extraction from advert URL
# Note: ORDER matters — more specific patterns should come first
# Use %% to escape % for PyMySQL's mogrify
_MARKET_WHEN_SQL = "\n".join(
    f"      WHEN a.advert_url_real LIKE '%%{domain}%%' THEN '{code}'"
    for domain, code in AMAZON_DOMAIN_MAP.items()
)

AGG_SQL = f"""
SELECT
  o.user_id,
  CASE
{_MARKET_WHEN_SQL}
      ELSE 'Unknown'
  END AS market,
  SUM(o.clicks) AS clicks,
  SUM(o.detail_page_views) AS dpv,
  SUM(o.add_to_carts) AS atc,
  SUM(o.total_purchases) AS orders,
  SUM(o.amount) AS sales,
  SUM(o.payout) AS all_commission,
  SUM(o.aff_payout) AS aff_commission
FROM cnpscy_amazon_order o
LEFT JOIN cnpscy_advert a ON o.advert_id = a.advert_id
WHERE o.user_id IS NOT NULL AND o.user_id > 0
GROUP BY o.user_id, market
"""

CACHE_FILE = ROOT / "protected_data" / "db_publishers_cache.json"


def build_publishers_payload() -> dict:
    with db_connection() as conn:
        # 1) 查询聚合后的订单数据（MySQL 端 GROUP BY user_id, market）
        rows = fetch_all(conn, AGG_SQL)

        # 2) 获取所有用户和管理员映射
        admins_map = _load_admin_map(conn)

        # 3) 聚合数据: { userId -> { userName, adminName, markets: { market -> metrics }, total } }
        publishers: dict[int, dict] = {}
        summary = {
            "totalPublishers": 0,
            "totalClicks": 0, "totalDpv": 0, "totalAtc": 0, "totalOrders": 0,
            "totalSales": 0.0, "totalAllCommission": 0.0, "totalAffCommission": 0.0,
        }
        markets_set: set[str] = set()

        for row in rows:
            uid = int(row["user_id"])
            market = str(row["market"])
            markets_set.add(market)

            if uid not in publishers:
                publishers[uid] = {
                    "userId": uid,
                    "userName": str(uid),
                    "adminName": "Unknown",
                    "markets": {},
                    "total": {"clicks": 0, "dpv": 0, "atc": 0, "orders": 0,
                              "sales": 0.0, "allCommission": 0.0, "affCommission": 0.0},
                }

            pub = publishers[uid]
            _accumulate(pub["total"], row)
            if market not in pub["markets"]:
                pub["markets"][market] = {"clicks": 0, "dpv": 0, "atc": 0, "orders": 0,
                                          "sales": 0.0, "allCommission": 0.0, "affCommission": 0.0}
            _accumulate(pub["markets"][market], row)

        # 4) 填充用户名称和经理信息
        _fill_user_info(conn, publishers, admins_map)

        # 5) 计算 summary
        for pub in publishers.values():
            summary["totalClicks"] += pub["total"]["clicks"]
            summary["totalDpv"] += pub["total"]["dpv"]
            summary["totalAtc"] += pub["total"]["atc"]
            summary["totalOrders"] += pub["total"]["orders"]
            summary["totalSales"] += pub["total"]["sales"]
            summary["totalAllCommission"] += pub["total"]["allCommission"]
            summary["totalAffCommission"] += pub["total"]["affCommission"]
        summary["totalPublishers"] = len(publishers)

        payload = {
            "generatedAt": utc_now_iso(),
            "publishers": sorted(publishers.values(), key=lambda p: p["total"]["clicks"], reverse=True),
            "summary": summary,
            "markets": sorted(m for m in markets_set if m != "Unknown") + (["Unknown"] if "Unknown" in markets_set else []),
        }
        return payload


def _accumulate(target: dict, row: dict) -> None:
    target["clicks"] += int(row["clicks"] or 0)
    target["dpv"] += int(row["dpv"] or 0)
    target["atc"] += int(row["atc"] or 0)
    target["orders"] += int(row["orders"] or 0)
    target["sales"] += float(row["sales"] or 0)
    target["allCommission"] += float(row["all_commission"] or 0)
    target["affCommission"] += float(row["aff_commission"] or 0)


def _load_admin_map(conn) -> dict[str, str]:
    """admin_code -> admin_name"""
    rows = fetch_all(
        conn,
        "SELECT admin_code, admin_name FROM cnpscy_admins WHERE is_delete = 0 AND admin_code IS NOT NULL AND admin_code != ''"
    )
    return {str(r["admin_code"]).strip(): str(r["admin_name"]) for r in rows}


def _fill_user_info(conn, publishers: dict, admins_map: dict[str, str]) -> None:
    """批量查询用户名称和管理员"""
    uids = list(publishers.keys())
    if not uids:
        return
    placeholders = ", ".join(["%s"] * len(uids))
    rows = fetch_all(
        conn,
        f"SELECT user_id, user_name, admin_id_look FROM cnpscy_user WHERE user_id IN ({placeholders})",
        tuple(uids),
    )
    for row in rows:
        uid = int(row["user_id"])
        if uid in publishers:
            publishers[uid]["userName"] = str(row["user_name"] or uid)
            admin_code = str(row["admin_id_look"] or "").strip()
            publishers[uid]["adminName"] = admins_map.get(admin_code, "Unknown")


def main():
    payload = build_publishers_payload()
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = CACHE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, default=str), encoding="utf-8")
    tmp.replace(CACHE_FILE)
    print(f"OK: {CACHE_FILE} ({len(payload['publishers'])} publishers, {len(payload['markets'])} markets)")


if __name__ == "__main__":
    main()
