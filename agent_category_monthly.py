"""Agent 只读批量月度查询，保持与商户月度来源相同的合并规则。"""

from __future__ import annotations

import calendar
import datetime as dt
import re
from typing import Any

from offer_db import (
    DIGITS_RE, _normalized_date_key_sql, db_connection, fetch_all,
    format_monthly_metric_row, monthly_ratio, monthly_sum_expr,
    normalize_month, pick_column, q, qualified, table_columns, utc_now_iso,
)


_FIELDS = ("revenue", "orders", "clicks", "affiliatePayout", "payout", "dpv", "atc", "directSales", "haloSales")
_RATIOS = {"conversionRate": ("orders", "clicks"), "epc": ("affiliatePayout", "clicks"),
           "aov": ("revenue", "orders"), "allEpc": ("payout", "clicks")}
_MONTH = re.compile(r"^[0-9]{4}-(0[1-9]|1[0-2])$")


def _single(query: dict, key: str) -> str:
    values = query.get(key, [])
    if not isinstance(values, list) or len(values) != 1 or not isinstance(values[0], str):
        raise ValueError(f"{key} 必须提供一个值")
    return values[0].strip()


def _range(query: dict) -> tuple[dt.date, dt.date]:
    values = [_single(query, key) for key in ("startMonth", "endMonth")]
    if not all(_MONTH.fullmatch(value) for value in values):
        raise ValueError("startMonth/endMonth 必须为 YYYY-MM")
    try:
        start, end = (dt.date.fromisoformat(f"{value}-01") for value in values)
    except ValueError as error:
        raise ValueError("月份无效") from error
    length = (end.year - start.year) * 12 + end.month - start.month + 1
    if length < 1 or length > 24:
        raise ValueError("查询区间必须按时间升序且最多连续 24 个月")
    return start, end


def _previous(start: dt.date) -> dt.date | None:
    return (start - dt.timedelta(days=1)).replace(day=1) if start != dt.date.min else None


def _month_keys(start: dt.date, end: dt.date) -> list[str]:
    first = start.year * 12 + start.month - 1
    last = end.year * 12 + end.month - 1
    return [f"{index // 12:04d}-{index % 12 + 1:02d}" for index in range(first, last + 1)]


def _category_members(conn, categories: list[str]) -> tuple[list[str], list[str]]:
    # 只查询现有 Tier 商户；真实 Sheet 分类优先，未分类占位回退数据库主分类。
    rows = fetch_all(conn, """
        SELECT DISTINCT t.merchantId, sm.sheetCategory, cat.mainCategory
        FROM cnpscy_oi_tier_assignments t
        LEFT JOIN cnpscy_oi_offer_sheet_metadata sm ON sm.merchantId = t.merchantId
        LEFT JOIN (
            SELECT mc.merchantId, MAX(c.categoryName) AS mainCategory
            FROM cnpscy_oi_merchant_category mc
            JOIN cnpscy_oi_category c ON mc.categoryId = c.categoryId AND c.level = 1
            GROUP BY mc.merchantId
        ) cat ON cat.merchantId = t.merchantId
    """)
    resolved = []
    for row in rows:
        candidates = [str(row.get(field) or "").strip() for field in ("sheetCategory", "mainCategory")]
        category = next((value for value in candidates if value and value.casefold() != "uncategorized"), "Uncategorized")
        resolved.append((str(row.get("merchantId") or ""), category))
    actual = {category.casefold(): category for _, category in resolved}
    if any(category.casefold() not in actual for category in categories):
        raise ValueError("未找到请求的真实品类")
    selected = list(dict.fromkeys(actual[category.casefold()] for category in categories))
    members = sorted({merchant_id for merchant_id, category in resolved if merchant_id and category in selected})
    return selected, members


def _source_rows(conn, table: str, alias: str, ids: list[str], start_day: int, end_day: int,
                 fields: dict[str, list[str]], dates: list[str]) -> list[dict[str, Any]]:
    columns = table_columns(conn, table)
    id_column = pick_column(columns, ["advert_id", "merchant_id"])
    date_column = pick_column(columns, dates)
    if not id_column or not date_column:
        return []
    date_sql = _normalized_date_key_sql(alias, date_column)
    expressions = [monthly_sum_expr(alias, columns, candidates, field) for field, candidates in fields.items()]
    if table == "cnpscy_amazon_order" and not pick_column(columns, fields["orders"]):
        expressions[list(fields).index("orders")] = f"COUNT(*) AS {q('orders')}"
    sql = f"""
        SELECT CAST({qualified(alias, id_column)} AS CHAR) AS merchantId,
               LEFT(CAST({date_sql} AS CHAR), 6) AS month,
               {', '.join(expressions)}
        FROM {q(table)} {alias}
        WHERE {qualified(alias, id_column)} IN ({', '.join(['%s'] * len(ids))})
          AND {date_sql} BETWEEN %s AND %s
        GROUP BY {qualified(alias, id_column)}, month
    """
    return [format_monthly_metric_row(row) for row in fetch_all(conn, sql, (*ids, start_day, end_day))]


def _monthly(conn, ids: list[str], start: dt.date, end: dt.date) -> dict[str, dict[str, Any]]:
    if not ids:
        return {}
    begin = _previous(start) or start
    start_day = int(f"{begin.year:04d}{begin.month:02d}01")
    end_day = int(f"{end.year:04d}{end.month:02d}{calendar.monthrange(end.year, end.month)[1]:02d}")
    common = {"revenue": ["amount", "sales_amount", "revenue"], "payout": ["payout", "commission"],
              "affiliatePayout": ["aff_payout", "affiliate_payout"]}
    amazon = _source_rows(conn, "cnpscy_amazon_order", "o", ids, start_day, end_day,
                          {**common, "orders": ["total_purchases"], "clicks": ["total_clicks", "clicks", "click_num"],
                           "dpv": ["detail_page_views", "dpv", "dpv_num"], "atc": ["add_to_carts", "atc", "atc_num"],
                           "directSales": ["direct_sales", "directSales", "direct_sale_amount"],
                           "haloSales": ["halo_sales", "haloSales", "halo_sale_amount"]}, ["order_time_day"])
    clicks = _source_rows(conn, "cnpscy_amazon_click", "c", ids, start_day, end_day,
                          {"rawClicks": ["click", "clicks", "click_num"]}, ["time_day", "click_time_day"])
    aggregate = _source_rows(conn, "cnpscy_order_new_aggregate", "a", ids, start_day, end_day,
                             {**common, "orders": ["order_num", "orders"]}, ["order_time_day", "time_day"])
    by_member: dict[tuple[str, str], dict[str, Any]] = {}
    allowed_ids = set(ids)
    for rows, source in ((amazon, "amazon"), (clicks, "clicks"), (aggregate, "aggregate")):
        for row in rows:
            merchant_id = str(row.get("merchantId") or "")
            month = normalize_month(row.get("month"))
            if merchant_id not in allowed_ids or not _MONTH.fullmatch(month):
                continue
            target = by_member.setdefault((merchant_id, month), {})
            if source == "clicks":
                if not target.get("clicks") and row.get("rawClicks") is not None:
                    target["clicks"] = row["rawClicks"]
            else:
                for field in _FIELDS:
                    if source == "aggregate" and field == "clicks":
                        continue
                    if row.get(field) is not None:
                        target[field] = row[field]
    result: dict[str, dict[str, Any]] = {}
    coverage: dict[str, dict[str, bool]] = {}
    for (_, month), values in by_member.items():
        total = result.setdefault(month, {"month": month, **dict.fromkeys(_FIELDS)})
        complete = coverage.setdefault(month, dict.fromkeys(_RATIOS, True))
        for ratio, (numerator, denominator) in _RATIOS.items():
            complete[ratio] = complete[ratio] and values.get(numerator) is not None and values.get(denominator) is not None
        for field in _FIELDS:
            if values.get(field) is not None:
                total[field] = (total[field] or 0) + values[field]
    for month, total in result.items():
        for ratio, (numerator, denominator) in _RATIOS.items():
            total[ratio] = monthly_ratio(total[numerator], total[denominator]) if coverage[month][ratio] else None
    return result


def _finish_month(month: str, totals: dict[str, dict]) -> dict[str, Any]:
    row = {"month": month, **dict.fromkeys(_FIELDS), **totals.get(month, {})}
    # 先验证参与商户月输入齐备，再使用总量；缺失覆盖不能拼成貌似完整的比例。
    for ratio, (numerator, denominator) in _RATIOS.items():
        row.setdefault(ratio, monthly_ratio(row[numerator], row[denominator]))
    row["affEpc"] = row["epc"]
    return row


def _series(conn, ids: list[str], start: dt.date, end: dt.date) -> dict[str, Any]:
    totals = _monthly(conn, ids, start, end)
    previous = _previous(start)
    return {
        "monthly": [_finish_month(month, totals) for month in _month_keys(start, end)],
        "previousMonth": _finish_month(previous.isoformat()[:7], totals) if previous else None,
    }


def category_monthly_payload(query: dict) -> dict[str, Any]:
    start, end = _range(query)
    raw = query.get("category", [])
    if not isinstance(raw, list) or not raw or any(not isinstance(value, str) or not value.strip() or len(value.strip()) > 80 for value in raw):
        raise ValueError("必须提供真实品类 category")
    categories = list(dict.fromkeys(value.strip() for value in raw))
    with db_connection() as conn:
        categories, ids = _category_members(conn, categories)
        series = _series(conn, ids, start, end)
    return {"ok": True, "checkedAt": utc_now_iso(), "categories": categories, "merchantCount": len(ids), **series}


def merchant_monthly_payload(query: dict) -> dict[str, Any]:
    """明确区间按日期查询，不受旧接口最近月份 LIMIT 限制。"""
    start, end = _range(query)
    merchant_id = _single(query, "merchantId")
    if not DIGITS_RE.fullmatch(merchant_id):
        raise ValueError("merchantId 必须为数字")
    with db_connection() as conn:
        series = _series(conn, [merchant_id], start, end)
    return {"ok": True, "checkedAt": utc_now_iso(), "merchantId": merchant_id, **series}
