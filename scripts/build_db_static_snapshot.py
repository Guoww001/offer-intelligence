#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from offer_db import db_connection, fetch_all, fetch_one, q, table_columns, utc_now_iso  # noqa: E402


TIER_ORDER = ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"]


def compact(row):
    return {key: value for key, value in row.items() if value not in (None, "", [], {})}


def column_map(columns):
    return {column.lower(): column for column in columns}


def existing(columns, *names):
    mapped = column_map(columns)
    for name in names:
        if name in columns:
            return name
        lowered = name.lower()
        if lowered in mapped:
            return mapped[lowered]
    return None


def require_view(conn, view):
    columns = table_columns(conn, view)
    if not columns:
        raise RuntimeError(f"{view} is unavailable. Create the reporting views before building a DB snapshot.")
    return columns


def select_columns(columns, requested):
    return [q(existing(columns, name) or name) for name in requested if existing(columns, name)]


def value(row, *names, default=None):
    mapped = {key.lower(): key for key in row}
    for name in names:
        if name in row and row[name] not in (None, ""):
            return row[name]
        lowered = name.lower()
        if lowered in mapped and row[mapped[lowered]] not in (None, ""):
            return row[mapped[lowered]]
    return default


def fetch_rows(conn, view, fields, where="", params=(), order="", limit=None):
    columns = require_view(conn, view)
    selected = select_columns(columns, fields)
    if not selected:
        raise RuntimeError(f"{view} does not expose any expected fields: {', '.join(fields)}")
    sql = f"SELECT {', '.join(selected)} FROM {q(view)}"
    if where:
        sql += f" WHERE {where}"
    if order:
        sql += f" ORDER BY {order}"
    if limit:
        sql += f" LIMIT {int(limit)}"
    return fetch_all(conn, sql, tuple(params))


def latest_metric_month(conn):
    columns = require_view(conn, "oi_offer_monthly_amazon_metrics")
    month_column = existing(columns, "month")
    if not month_column:
        raise RuntimeError("oi_offer_monthly_amazon_metrics must expose a month column")
    row = fetch_one(conn, f"SELECT MAX({q(month_column)}) AS month FROM {q('oi_offer_monthly_amazon_metrics')}")
    return row["month"] if row else None


def fetch_metric_map(conn, month):
    fields = [
        "merchantId",
        "month",
        "clicks",
        "orders",
        "revenue",
        "salesAmount",
        "payout",
        "affiliatePayout",
        "epc",
        "aov",
        "conversionRate",
        "dpv",
        "atc",
        "directSales",
        "haloSales",
    ]
    columns = require_view(conn, "oi_offer_monthly_amazon_metrics")
    month_column = existing(columns, "month")
    if not month_column:
        raise RuntimeError("oi_offer_monthly_amazon_metrics must expose a month column")
    rows = fetch_rows(conn, "oi_offer_monthly_amazon_metrics", fields, f"{q(month_column)} = %s", (month,))
    return {str(value(row, "merchantId")).strip(): row for row in rows if value(row, "merchantId")}


def fetch_tier_map(conn):
    columns = table_columns(conn, "oi_tier_assignments")
    if not columns:
        return {}
    fields = ["merchantId", "tier", "source", "movedAt", "updatedAt"]
    rows = fetch_rows(conn, "oi_tier_assignments", fields)
    return {str(value(row, "merchantId")).strip(): row for row in rows if value(row, "merchantId")}


def fetch_visual_status_map(conn):
    columns = table_columns(conn, "oi_tier_visual_status")
    if not columns:
        return {}
    fields = [
        "merchantId",
        "color",
        "visualStatusColor",
        "reason_code",
        "visualStatusCode",
        "reason_text",
        "visualStatusReason",
        "source",
        "updatedBy",
        "updatedAt",
    ]
    rows = fetch_rows(conn, "oi_tier_visual_status", fields)
    return {str(value(row, "merchantId")).strip(): row for row in rows if value(row, "merchantId")}


def fetch_top_asins(conn, merchant_ids, per_merchant):
    if per_merchant <= 0 or not merchant_ids or not table_columns(conn, "oi_offer_products"):
        return {}
    columns = require_view(conn, "oi_offer_products")
    merchant_column = existing(columns, "merchantId")
    asin_column = existing(columns, "asin", "ASIN")
    if not merchant_column or not asin_column:
        return {}
    fields = ["merchantId", "asin", "productName", "category", "bsr", "updatedAt"]
    output = {}
    for merchant_id in merchant_ids:
        rows = fetch_rows(
            conn,
            "oi_offer_products",
            fields,
            f"{q(merchant_column)} = %s",
            (merchant_id,),
            order=f"{q(existing(columns, 'updatedAt') or asin_column)} DESC",
            limit=per_merchant,
        )
        output[merchant_id] = [compact(row) for row in rows if value(row, "asin")]
    return output


def offer_from_rows(base, metrics, tier, visual, products):
    merchant_id = str(value(base, "merchantId")).strip()
    brand = value(base, "merchantName", "brand", default="")
    revenue = value(metrics, "salesAmount", "revenue", default=0)
    top_asins = [value(product, "asin") for product in products if value(product, "asin")]
    return compact(
        {
            "id": f"{tier or 'Unknown'}::{merchant_id}::{brand}",
            "merchantId": merchant_id,
            "brand": brand,
            "tier": tier or value(base, "tier", default="Unknown"),
            "network": value(base, "network", "agency", default="Unknown"),
            "category": value(base, "category", "mainCategory", default="Uncategorized"),
            "clicks": value(metrics, "clicks", default=0),
            "orders": value(metrics, "orders", default=0),
            "salesAmount": revenue,
            "epc": value(metrics, "epc", default=0),
            "aov": value(metrics, "aov", default=0),
            "conversionRate": value(metrics, "conversionRate", default=0),
            "commissionRate": value(base, "commissionRate", default=None),
            "paymentCycle": value(base, "paymentCycle", default=None),
            "dpv": value(metrics, "dpv", default=None),
            "atc": value(metrics, "atc", default=None),
            "directSales": value(metrics, "directSales", default=None),
            "haloSales": value(metrics, "haloSales", default=None),
            "topAsins": top_asins,
            "products": products,
            "visualStatusColor": value(visual, "visualStatusColor", "color", default=None),
            "visualStatusCode": value(visual, "visualStatusCode", "reason_code", default=None),
            "visualStatusReason": value(visual, "visualStatusReason", "reason_text", default=None),
            "visualStatusSource": value(visual, "source", default=None),
        }
    )


def build_sheet_payload(offers, generated_at):
    headers = ["Merchant ID", "Merchant Name", "Network", "Category", "Clicks", "Order count", "Revenue", "Backend EPC"]
    sheets = []
    for tier in TIER_ORDER:
        rows = []
        for offer in offers:
            if offer.get("tier") != tier:
                continue
            rows.append(
                {
                    "Merchant ID": offer.get("merchantId", ""),
                    "Merchant Name": offer.get("brand", ""),
                    "Network": offer.get("network", ""),
                    "Category": offer.get("category", ""),
                    "Clicks": offer.get("clicks", ""),
                    "Order count": offer.get("orders", ""),
                    "Revenue": offer.get("salesAmount", ""),
                    "Backend EPC": offer.get("epc", ""),
                    "visualStatusColor": offer.get("visualStatusColor", ""),
                    "visualStatusCode": offer.get("visualStatusCode", ""),
                    "visualStatusReason": offer.get("visualStatusReason", ""),
                    "visualStatusSource": offer.get("visualStatusSource", ""),
                }
            )
        sheets.append(
            {
                "name": tier,
                "title": tier,
                "kind": "tier",
                "introRows": [],
                "headers": headers,
                "rows": rows,
                "grid": [],
                "summaryCards": [{"label": "Brand Count", "value": str(len(rows))}],
            }
        )
    return {
        "source": "Offer Intelligence reporting views",
        "generatedAt": generated_at,
        "sheets": sheets,
        "tierSheets": TIER_ORDER,
    }


def build_parser():
    parser = argparse.ArgumentParser(description="Build static Offer Intelligence payloads from oi_* reporting views.")
    parser.add_argument("--month", default="", help="Metric month to export. Defaults to MAX(month) from oi_offer_monthly_amazon_metrics.")
    parser.add_argument("--chatbot-output", default=str(ROOT / "output" / "db_static_snapshot" / "chatbot_data.js"))
    parser.add_argument("--sheet-output", default="", help="Optional sheet_report_data.js output generated from DB tier assignments.")
    parser.add_argument("--product-limit-per-merchant", type=int, default=3)
    parser.add_argument("--limit", type=int, default=0, help="Optional merchant limit for smoke tests.")
    return parser


def main():
    args = build_parser().parse_args()
    generated_at = utc_now_iso()
    with db_connection() as conn:
        base_fields = [
            "merchantId",
            "merchantName",
            "brand",
            "network",
            "agency",
            "category",
            "mainCategory",
            "commissionRate",
            "paymentCycle",
        ]
        base_rows = fetch_rows(conn, "oi_offer_base", base_fields, order=q("merchantId"), limit=args.limit or None)
        month = args.month or latest_metric_month(conn)
        metrics = fetch_metric_map(conn, month)
        tiers = fetch_tier_map(conn)
        visual_statuses = fetch_visual_status_map(conn)
        merchant_ids = [str(value(row, "merchantId")).strip() for row in base_rows if value(row, "merchantId")]
        top_products = fetch_top_asins(conn, merchant_ids, args.product_limit_per_merchant)

    offers = []
    for base in base_rows:
        merchant_id = str(value(base, "merchantId")).strip()
        tier_row = tiers.get(merchant_id, {})
        tier = value(tier_row, "tier", default=value(base, "tier", default="Unknown"))
        offers.append(
            offer_from_rows(
                base,
                metrics.get(merchant_id, {}),
                tier,
                visual_statuses.get(merchant_id, {}),
                top_products.get(merchant_id, []),
            )
        )

    tier_counts = {}
    for offer in offers:
        tier_counts[offer.get("tier", "Unknown")] = tier_counts.get(offer.get("tier", "Unknown"), 0) + 1

    payload = {
        "summary": {
            "offerCount": len(offers),
            "generatedAt": generated_at,
            "source": "Offer Intelligence reporting views",
            "metricMonth": month,
            "tiers": tier_counts,
        },
        "sources": {
            "database": "oi_* reporting views",
            "metricMonth": month,
        },
        "offers": offers,
        "paymentRecords": [],
    }

    chatbot_output = Path(args.chatbot_output)
    chatbot_output.parent.mkdir(parents=True, exist_ok=True)
    chatbot_output.write_text(f"window.CHATBOT_DATA={json.dumps(payload, ensure_ascii=False, separators=(',', ':'))};\n", encoding="utf-8")

    if args.sheet_output:
        sheet_output = Path(args.sheet_output)
        sheet_output.parent.mkdir(parents=True, exist_ok=True)
        sheet_payload = build_sheet_payload(offers, generated_at)
        sheet_output.write_text(
            f"window.SHEET_REPORT_DATA={json.dumps(sheet_payload, ensure_ascii=False, separators=(',', ':'))};\n",
            encoding="utf-8",
        )

    print(
        json.dumps(
            {
                "ok": True,
                "month": month,
                "offers": len(offers),
                "chatbotOutput": str(chatbot_output),
                "sheetOutput": args.sheet_output or None,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
