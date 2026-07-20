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

# 查询每个 publisher 关联的联盟（network）
NETWORK_SQL = """
SELECT DISTINCT o.user_id, TRIM(at.advert_type_name) AS network
FROM cnpscy_amazon_order o
LEFT JOIN cnpscy_advert a ON o.advert_id = a.advert_id
LEFT JOIN cnpscy_advert_type at
    ON a.advert_advertiser = at.advert_type_id AND at.advert_type_parent_id = 53
WHERE o.user_id IS NOT NULL AND o.user_id > 0
  AND at.advert_type_name IS NOT NULL AND TRIM(at.advert_type_name) != ''
"""

# 查询每个 publisher 的链接类型（product / storefront）
# Amazon 商品链接的常见模式：/dp/ASIN, /gp/product/ASIN, /exec/obidos/ASIN, &asin= 参数
LINK_TYPE_SQL = """
SELECT
  o.user_id,
  CASE
    WHEN a.advert_url_real LIKE '%%/dp/%%' THEN 'product'
    WHEN a.advert_url_real LIKE '%%/gp/product/%%' THEN 'product'
    WHEN a.advert_url_real LIKE '%%/exec/obidos/%%' THEN 'product'
    WHEN a.advert_url_real LIKE '%%&asin=%%' THEN 'product'
    WHEN a.advert_url_real LIKE '%%?asin=%%' THEN 'product'
    ELSE 'storefront'
  END AS link_type,
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
GROUP BY o.user_id, link_type
"""

# 查询每个 publisher 关联的 merchants
MERCHANT_SQL = """
SELECT DISTINCT o.user_id, a.advert_id AS merchant_id, a.advert_name AS merchant_name
FROM cnpscy_amazon_order o
LEFT JOIN cnpscy_advert a ON o.advert_id = a.advert_id
WHERE o.user_id IS NOT NULL AND o.user_id > 0
  AND a.advert_id IS NOT NULL AND a.advert_id > 0
"""

# 按月聚合（用于前端月份筛选）
MONTHLY_SQL = f"""
SELECT
  o.user_id,
  LEFT(CAST(o.order_time_day AS CHAR), 6) AS month,
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
  AND o.order_time_day IS NOT NULL
GROUP BY o.user_id, month, market
"""

CACHE_FILE = ROOT / "protected_data" / "db_publishers_cache.json"


def build_publishers_payload() -> dict:
    with db_connection() as conn:
        # 1) 查询聚合后的订单数据（MySQL 端 GROUP BY user_id, market）
        rows = fetch_all(conn, AGG_SQL)

        # 2) 获取所有用户和管理员映射
        admins_map = _load_admin_map(conn)

        # 3) 查询每个 publisher 的联盟（network）
        network_rows = fetch_all(conn, NETWORK_SQL)
        networks_by_user: dict[int, list[str]] = {}
        for nr in network_rows:
            uid = int(nr["user_id"])
            net = str(nr["network"]).strip()
            if net:
                networks_by_user.setdefault(uid, []).append(net)

        # 4) 查询每个 publisher 的链接类型
        link_type_rows = fetch_all(conn, LINK_TYPE_SQL)
        link_types_by_user: dict[int, dict[str, dict]] = {}
        for lr in link_type_rows:
            uid = int(lr["user_id"])
            lt = str(lr["link_type"]).strip()
            if lt:
                if uid not in link_types_by_user:
                    link_types_by_user[uid] = {}
                link_types_by_user[uid][lt] = {
                    "clicks": int(lr["clicks"] or 0),
                    "dpv": int(lr["dpv"] or 0),
                    "atc": int(lr["atc"] or 0),
                    "orders": int(lr["orders"] or 0),
                    "sales": float(lr["sales"] or 0),
                    "allCommission": float(lr["all_commission"] or 0),
                    "affCommission": float(lr["aff_commission"] or 0),
                }

        # 5) 查询每个 publisher 关联的 merchants
        merchant_rows = fetch_all(conn, MERCHANT_SQL)
        merchants_by_user: dict[int, list[dict]] = {}
        merchant_name_map: dict[int, str] = {}
        for mr in merchant_rows:
            uid = int(mr["user_id"])
            mid = int(mr["merchant_id"])
            mname = str(mr["merchant_name"] or "")
            if uid not in merchants_by_user:
                merchants_by_user[uid] = []
            if mid not in merchant_name_map:
                merchant_name_map[mid] = mname
            merchants_by_user[uid].append({"merchantId": mid, "merchantName": mname})

        # 6) 查询按月聚合数据
        monthly_rows = fetch_all(conn, MONTHLY_SQL)
        monthly_data: dict[str, list[dict]] = {}  # month -> rows
        months_set: set[str] = set()
        for mr in monthly_rows:
            uid = int(mr["user_id"])
            month = str(mr["month"]).strip()
            if not month or len(month) != 6:
                continue
            # format as YYYY-MM
            month_key = f"{month[:4]}-{month[4:]}"
            months_set.add(month_key)
            if month_key not in monthly_data:
                monthly_data[month_key] = []
            market = str(mr["market"])
            monthly_data[month_key].append({
                "userId": uid,
                "market": market,
                "clicks": int(mr["clicks"] or 0),
                "dpv": int(mr["dpv"] or 0),
                "atc": int(mr["atc"] or 0),
                "orders": int(mr["orders"] or 0),
                "sales": float(mr["sales"] or 0),
                "allCommission": float(mr["all_commission"] or 0),
                "affCommission": float(mr["aff_commission"] or 0),
            })

        # 7) 聚合数据: { userId -> { ... } }
        publishers: dict[int, dict] = {}
        summary = {
            "totalPublishers": 0,
            "totalClicks": 0, "totalDpv": 0, "totalAtc": 0, "totalOrders": 0,
            "totalSales": 0.0, "totalAllCommission": 0.0, "totalAffCommission": 0.0,
        }
        markets_set: set[str] = set()
        all_networks_set: set[str] = set()
        all_link_types_set: set[str] = set()

        for row in rows:
            uid = int(row["user_id"])
            market = str(row["market"])
            markets_set.add(market)

            if uid not in publishers:
                networks = networks_by_user.get(uid, [])
                link_types = link_types_by_user.get(uid, {})
                merchants = merchants_by_user.get(uid, [])
                for net in networks:
                    all_networks_set.add(net)
                for lt in link_types:
                    all_link_types_set.add(lt)

                publishers[uid] = {
                    "userId": uid,
                    "userName": str(uid),
                    "adminName": "Unknown",
                    "networks": sorted(set(networks)),
                    "linkTypes": link_types,
                    "merchantIds": sorted(set(m["merchantId"] for m in merchants)),
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

        # 7) 填充用户名称和经理信息
        _fill_user_info(conn, publishers, admins_map)

        # 8) 计算 summary
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
            "networks": sorted(all_networks_set),
            "linkTypes": sorted(all_link_types_set),
            "merchantNameMap": {str(k): v for k, v in merchant_name_map.items()},
            "months": sorted(months_set),
            "monthlyRows": monthly_data,
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
