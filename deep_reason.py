"""Deep reasoning orchestrator — 3-stage pipeline for complex analysis.

Stage 1: LLM query parsing → structured query plan (JSON)
Stage 2: Data execution → JSON cache or MySQL
Stage 3: LLM report generation → structured report JSON
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

from llm_provider import call_llm

ROOT = Path(__file__).resolve().parent

SUPPORTED_METRICS = {
    "epc", "aov", "orders", "clicks", "salesAmount", "conversionRate",
    "commissionRate", "affCommission", "dpv", "atc", "paymentCycle",
    "paymentStatus",
}

ANALYSIS_TYPES = {"comparison", "trend", "ranking", "overview", "anomaly", "distribution"}
ENTITY_TYPES = {"merchant", "category", "tier"}

# Cache file paths
OFFERS_CACHE_PATH = ROOT / "protected_data" / "db_offers_cache.json"
KEYWORDS_CACHE_PATH = ROOT / "protected_data" / "db_keywords_cache.json"

PARSE_QUERY_SYSTEM_PROMPT = """你是一个电商数据分析师，负责将用户的问题转化为结构化的数据查询计划。
输出 JSON 格式，只包含以下字段：

{
  "analysisType": string,
  "entityType": "merchant" | "category" | "tier",
  "entities": [string],
  "metrics": [string],
  "timeRange": { "months": int },
  "comparisonType": string | null,
  "filters": {},
  "analysisGoal": string
}

analysisType 必须是以下之一: comparison, trend, ranking, overview, anomaly, distribution
entityType 必须是: merchant, category, tier
已知指标: epc, aov, orders, clicks, salesAmount, conversionRate, commissionRate, affCommission, dpv, atc, paymentCycle, paymentStatus
timeRange.months: 1-24 的整数
comparisonType: 可选 "vs_category" / "vs_tier" / "vs_each_other" / null

重要规则——同时提到 Tier 和品类/商户时的处理：

用户可能说"Tier2的Beauty"、"Tier 1中的美妆"、"Tier 3的Shokz"这种句式，
此时品类名或商户名是主要的分析实体，Tier 是限定范围：
- entityType 应为 "category"（主要实体是品类）或 "merchant"（主要实体是商户）
- entities 只放品类名或商户名，不要放 Tier 名称
- filters 中放入 tier: "Tier 2" 表示限定在特定层级内

示例：
"分析Tier2的Beauty" → entityType="category", entities=["Beauty"], filters={"tier": "Tier 2"}
"对比Tier 1中Shokz和Anker的EPC" → entityType="merchant", entities=["Shokz", "Anker"], filters={"tier": "Tier 1"}, analysisType="comparison"
"Tier 3中的Electronics品类表现" → entityType="category", entities=["Electronics"], filters={"tier": "Tier 3"}

如果用户只提到 Tier 没有具体品类/商户，则：
"分析Tier 2" → entityType="tier", entities=["Tier 2"]

注意：禁止编造商户名或品类名，只使用用户提到的实体名称。输出纯 JSON，不要 markdown 包裹。"""


def _text(language: str, zh: str, en: str) -> str:
    """Return Chinese or English text based on language setting."""
    return zh if language == "zh" else en


def _maybe_string(v: Any) -> str:
    """Safely convert a value to string for display."""
    if v is None:
        return ""
    s = str(v)
    return "0" if s == "0.0" else s


def parse_query(prompt: str, language: str = "zh") -> dict:
    """Stage 1: Use LLM to parse user question into a structured query plan.

    Returns the parsed query plan dict, or an error dict with "error" key.
    """
    if not prompt or len(prompt.strip()) < 4:
        examples_zh = "问题太短，请详细描述你需要分析的内容。\n\n示例：\n- 对比 Shokz 和 Anker 的 EPC\n- Tier 2 中美妆商户过去 3 个月的 AOV 趋势\n- 各品类在 Tier 1-3 的分布情况"
        examples_en = "Query too short. Please describe what you'd like to analyze.\n\nExamples:\n- Compare EPC of Shokz and Anker\n- AOV trend of beauty merchants in Tier 2 over the past 3 months\n- Distribution of categories across Tier 1-3"
        return {"error": _text(language, examples_zh, examples_en)}

    raw = call_llm(
        system_prompt=PARSE_QUERY_SYSTEM_PROMPT,
        user_message=prompt,
        max_tokens=600,
        timeout=20,
        temperature=0,
    )

    if raw is None:
        return {"error": _text(language, "LLM 暂时无法处理，请稍后重试。", "LLM temporarily unavailable. Please try again later.")}

    # Try to extract JSON from response (handle potential markdown wrapping)
    json_str = raw.strip()
    if json_str.startswith("```"):
        # Extract JSON from markdown code block
        lines = json_str.split("\n")
        start = 0
        for i, line in enumerate(lines):
            if line.strip().startswith("```"):
                start = i + 1
                break
        end = len(lines)
        for i in range(len(lines) - 1, start - 1, -1):
            if lines[i].strip().startswith("```"):
                end = i
                break
        json_str = "\n".join(lines[start:end])

    try:
        plan = json.loads(json_str)
    except json.JSONDecodeError:
        err = _text(language, f"无法解析查询计划，请重新描述问题。\nLLM 返回: {raw[:200]}", f"Could not parse query plan. Please rephrase.\nLLM returned: {raw[:200]}")
        return {"error": err}

    # Validate
    errors = _validate_plan(plan, language)
    if errors:
        return {"error": errors}

    return plan


def _validate_plan(plan: dict, language: str = "zh") -> str | None:
    """Validate the parsed query plan. Returns error string or None if valid."""
    if not isinstance(plan.get("entities"), list) or len(plan["entities"]) == 0:
        return _text(language, "请指定要分析的目标（商户名、品类名或 Tier 级别）。", "Please specify what to analyze (merchant name, category, or tier level).")
    if len(plan["entities"]) > 10:
        plan["entities"] = plan["entities"][:10]

    metrics = plan.get("metrics", [])
    if not metrics:
        plan["metrics"] = ["epc", "aov", "orders", "salesAmount", "conversionRate"]
    else:
        unknown = [m for m in metrics if m not in SUPPORTED_METRICS]
        if unknown:
            return _text(language,
                f"不支持的指标: {', '.join(unknown)}。支持的指标: {', '.join(sorted(SUPPORTED_METRICS))}",
                f"Unsupported metrics: {', '.join(unknown)}. Supported: {', '.join(sorted(SUPPORTED_METRICS))}")

    if plan.get("entityType") not in ENTITY_TYPES:
        plan["entityType"] = "merchant"

    if plan.get("analysisType") not in ANALYSIS_TYPES:
        plan["analysisType"] = "overview"

    time_range = plan.get("timeRange") or {}
    if not isinstance(time_range, dict):
        time_range = {}
    months = time_range.get("months", 2)
    if not isinstance(months, (int, float)) or months < 1:
        months = 2
    if months > 24:
        months = 24
    plan["timeRange"] = {"months": int(months)}

    return None


def _load_cache(path: Path) -> dict:
    """Load a JSON cache file. Returns empty dict if file doesn't exist."""
    if not path.exists():
        print(f"[deep_reason] Cache not found: {path}", file=sys.stderr)
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def execute_query_plan(plan: dict) -> dict:
    """Stage 2: Execute the query plan against data sources.

    Uses JSON cache for <=2-month snapshots, MySQL for historical trends.
    Returns structured data dict for Stage 3.
    """
    months = plan.get("timeRange", {}).get("months", 2)
    entity_type = plan.get("entityType", "merchant")
    entities = plan.get("entities", [])
    metrics = plan.get("metrics", [])
    comparison_type = plan.get("comparisonType")

    if months <= 2:
        return _execute_from_cache(entity_type, entities, metrics, comparison_type, plan)
    else:
        return _execute_from_db(entity_type, entities, metrics, months, comparison_type, plan)


def _execute_from_cache(entity_type: str, entities: list, metrics: list,
                        comparison_type: str | None, plan: dict) -> dict:
    """Execute query using JSON cache files (<=2 months data)."""
    cache = _load_cache(OFFERS_CACHE_PATH)
    offers = cache.get("offers", [])
    payment_records = cache.get("paymentRecords", [])

    if not offers:
        # Warning text depends on language — stored in plan["language"]
        lang = plan.get("language", "zh")
        return {
            "data": [],
            "summary": {},
            "warning": _text(lang, "缓存数据不可用，请稍后重试。", "Cache data unavailable. Please try again later.")
        }

    # Apply tier filter from plan.filters (e.g. "Tier2中Beauty品类的趋势")
    filters = plan.get("filters", {}) or {}
    tier_filter = filters.get("tier")
    if tier_filter:
        tier_lower = tier_filter.lower().strip()
        offers = [
            o for o in offers
            if tier_lower in (o.get("tier") or "").lower()
        ]

    # Apply category filter from plan.filters (backup when LLM extracts
    # category separately from entityType, e.g. "Tier2的Beauty")
    category_filter = filters.get("category")
    if category_filter:
        cat_lower = category_filter.lower().strip()
        offers = [
            o for o in offers
            if cat_lower in (o.get("mainCategory") or o.get("category") or "").lower()
        ]

    # Filter offers based on entity type
    if entity_type == "merchant":
        entity_lower = [e.lower().strip() for e in entities]
        matched = [
            o for o in offers
            if any(
                e in (o.get("brand") or "").lower()
                or e in (o.get("merchantName") or "").lower()
                or e == (o.get("merchantId") or "").lower()
                for e in entity_lower
            )
        ]
        # Build result per merchant
        results = _summarize_offers(matched, metrics, plan)
        # Find peers for comparison
        if comparison_type == "vs_category" and matched:
            categories = set(o.get("mainCategory") or o.get("category") for o in matched)
            peers = [o for o in offers if (o.get("mainCategory") or o.get("category")) in categories and o not in matched]
            results["peers"] = _summarize_offers(peers, metrics, plan)
        elif comparison_type == "vs_tier" and matched:
            tiers = set(o.get("tier") for o in matched)
            peers = [o for o in offers if o.get("tier") in tiers and o not in matched]
            results["peers"] = _summarize_offers(peers, metrics, plan)

    elif entity_type == "category":
        entity_lower = [e.lower().strip() for e in entities]
        matched = [
            o for o in offers
            if any(
                e in (o.get("mainCategory") or o.get("category") or "").lower()
                for e in entity_lower
            )
        ]
        results = _summarize_offers(matched, metrics, plan)
        # Group by category for distribution
        if plan.get("analysisType") == "distribution":
            by_category = defaultdict(list)
            for o in offers:
                cat = o.get("mainCategory") or o.get("category") or "Uncategorized"
                by_category[cat].append(o)
            results["distribution"] = {
                cat: _summarize_offers(group, metrics, plan)
                for cat, group in sorted(by_category.items(), key=lambda x: len(x[1]), reverse=True)[:15]
            }

    elif entity_type == "tier":
        entity_lower = [e.lower().strip() for e in entities]
        matched = [
            o for o in offers
            if any(e in (o.get("tier") or "").lower() for e in entity_lower)
        ]
        # 兜底：如果 entityType 为 tier 但部分实体名称不匹配任何 tier
        # （如 LLM 将 "Beauty" 也放入了 entities），检查它们是否为品类名并过滤
        for e in entity_lower:
            has_tier_match = any(
                e in (o.get("tier") or "").lower()
                for o in offers[:10]
            )
            if not has_tier_match:
                # 检查是否可能是品类名
                has_category_match = any(
                    e in (o.get("mainCategory") or o.get("category") or "").lower()
                    for o in offers[:10]
                )
                if has_category_match:
                    matched = [
                        o for o in matched
                        if e in (o.get("mainCategory") or o.get("category") or "").lower()
                    ]
        results = _summarize_offers(matched, metrics, plan)

    else:
        results = {"data": [], "summary": {}}
        matched = []

    # Per-entity breakdown for comparison / multi-entity queries
    if len(entities) >= 2 and plan.get("analysisType") in ("comparison", "overview", "ranking"):
        breakdown = {}
        for entity in entities:
            el = entity.lower().strip()
            if entity_type == "merchant":
                e_offers = [
                    o for o in offers
                    if el in (o.get("brand") or "").lower()
                    or el in (o.get("merchantName") or "").lower()
                    or el == (o.get("merchantId") or "").lower()
                ]
            elif entity_type == "category":
                e_offers = [
                    o for o in offers
                    if el in (o.get("mainCategory") or o.get("category") or "").lower()
                ]
            elif entity_type == "tier":
                e_offers = [
                    o for o in offers
                    if el in (o.get("tier") or "").lower()
                ]
            else:
                e_offers = []
            breakdown[entity] = _summarize_offers(
                e_offers,
                # Always compute basic metrics so the comparison report has rich data
                list(set(metrics) | {"orders", "salesAmount", "clicks", "epc", "aov", "conversionRate"}),
                plan,
            )
        results["entityBreakdown"] = breakdown

    results["entityType"] = entity_type
    results["entities"] = entities
    results["entityCount"] = len(set(o.get("merchantId") or o.get("brand") for o in matched))
    results["totalOffers"] = len(matched)
    results["cacheMonth"] = cache.get("month")
    results["cacheCheckedAt"] = cache.get("checkedAt")

    return results


def _summarize_offers(offers: list, metrics: list, plan: dict) -> dict:
    """Aggregate a list of offers into summary stats."""
    if not offers:
        return {"offers": [], "averages": {}, "totals": {}, "sampleSize": 0}

    totals = {}
    averages = {}
    epc_values = []

    if "epc" in metrics or not metrics:
        vals = [float(o.get("epc") or 0) for o in offers]
        epc_values = vals
        averages["epc"] = round(sum(vals) / len(vals), 4) if vals else 0
    if "aov" in metrics:
        vals = [float(o.get("aov") or 0) for o in offers]
        averages["aov"] = round(sum(vals) / len(vals), 2) if vals else 0
    if "conversionRate" in metrics:
        vals = [float(o.get("conversionRate") or 0) for o in offers]
        averages["conversionRate"] = round(sum(vals) / len(vals), 4) if vals else 0
    if "orders" in metrics:
        totals["orders"] = sum(float(o.get("orders") or 0) for o in offers)
    if "clicks" in metrics:
        totals["clicks"] = sum(float(o.get("clicks") or 0) for o in offers)
    if "salesAmount" in metrics:
        totals["salesAmount"] = sum(float(o.get("salesAmount") or 0) for o in offers)
    if "commissionRate" in metrics:
        vals = [float(o.get("commissionRate") or 0) for o in offers]
        averages["commissionRate"] = round(sum(vals) / len(vals), 4) if vals else 0
    if "affCommission" in metrics:
        totals["affCommission"] = sum(float(o.get("affiliatePayout") or o.get("payout") or 0) for o in offers)
    if "paymentCycle" in metrics:
        vals = [float(o.get("paymentCycle") or 0) for o in offers if float(o.get("paymentCycle") or 0) > 0]
        averages["paymentCycle"] = round(sum(vals) / len(vals), 1) if vals else 0
    if "dpv" in metrics:
        vals = [float(o.get("dpv") or 0) for o in offers]
        averages["dpv"] = round(sum(vals) / len(vals), 4) if vals else 0
    if "atc" in metrics:
        vals = [float(o.get("atc") or 0) for o in offers]
        averages["atc"] = round(sum(vals) / len(vals), 4) if vals else 0

    # Calculate weighted EPC
    clicks_list = [float(o.get("clicks") or 0) for o in offers]
    total_clicks = sum(clicks_list)
    if epc_values and total_clicks > 0:
        weighted_epc = sum(
            epc_values[i] * clicks_list[i]
            for i in range(len(offers))
        ) / total_clicks
        averages["weightedEpc"] = round(weighted_epc, 4)

    # Top 10 offers sorted by EPC for display
    sorted_offers = sorted(offers, key=lambda o: float(o.get("epc") or 0), reverse=True)

    return {
        "offers": [
            {
                "merchantId": o.get("merchantId"),
                "brand": o.get("brand"),
                "tier": o.get("tier"),
                "category": o.get("mainCategory") or o.get("category"),
                "epc": float(o.get("epc") or 0),
                "aov": float(o.get("aov") or 0),
                "orders": float(o.get("orders") or 0),
                "clicks": float(o.get("clicks") or 0),
                "salesAmount": float(o.get("salesAmount") or 0),
                "conversionRate": float(o.get("conversionRate") or 0),
            }
            for o in sorted_offers[:10]
        ],
        "averages": averages,
        "totals": totals,
        "sampleSize": len(offers),
    }


def _execute_from_db(entity_type: str, entities: list, metrics: list,
                     months: int, comparison_type: str | None, plan: dict) -> dict:
    """Execute query using MySQL for historical trends (>2 months)."""
    # Import offer_db lazily to avoid import errors when DB isn't configured
    try:
        from offer_db import merchant_payload
    except ImportError:
        lang = plan.get("language", "zh")
        return {
            "data": [],
            "summary": {},
            "warning": _text(lang, "数据库模块不可用。", "Database module is not available.")
        }

    # Fix 1: Handle non-merchant entity types — fall back to cache
    if entity_type != "merchant":
        lang = plan.get("language", "zh")
        warning = _text(lang, "品类/Tier 的历史趋势数据暂不支持，已降级使用当前快照数据。", "Historical trend data for category/tier is not yet supported. Using current snapshot data.")
        data = _execute_from_cache(entity_type, entities, metrics, comparison_type, plan)
        data["warning"] = warning
        return data

    results = {
        "entityType": entity_type,
        "entities": entities,
        "timeRangeMonths": months,
        "historicalData": [],
        "warning": None,
    }

    # Fix 3: Load cache once before the loop
    cache = _load_cache(OFFERS_CACHE_PATH)
    cache_offers = cache.get("offers", [])

    if entity_type == "merchant":
        for entity_name in entities[:5]:  # Limit to 5 merchants for DB queries
            # Try to find merchant ID from cache
            match = None
            elower = entity_name.lower().strip()
            for o in cache_offers:
                if elower in (o.get("brand") or "").lower() or elower in (o.get("merchantName") or "").lower():
                    match = o
                    break

            if match and match.get("merchantId"):
                try:
                    payload = merchant_payload(match["merchantId"], product_limit=5, months=months)
                    results["historicalData"].append({
                        "merchantId": match["merchantId"],
                        "brand": match.get("brand"),
                        "monthlyMetrics": payload.get("monthlyAmazonMetrics", []),
                    })
                except Exception as exc:
                    lang = plan.get("language", "zh")
                    results["warning"] = _text(lang, f"查询 {entity_name} 历史数据失败: {exc}", f"Failed to query historical data for {entity_name}: {exc}")

    if not results["historicalData"]:
        lang = plan.get("language", "zh")
        results["warning"] = _text(lang, "未找到历史数据，请检查商户名称或稍后重试。", "No historical data found. Please check the merchant name or try again later.")

    return results


def _entity_labels(entity_type: str, language: str = "zh") -> dict:
    """Return entity-type-aware label mappings for reports.

    category → "Beauty品类" (zh) / "Beauty category" (en)
    tier → "Tier 1" / "merchant" → "Shokz"
    """
    is_zh = language == "zh"
    labels = {
        "category": {
            "suffix": "品类" if is_zh else "",
            "unit": "商家" if is_zh else "merchants",
            "head_title": "头部品牌" if is_zh else "Top Brands",
            "orders_label": "订单量" if is_zh else "orders",
            "orders_unit": "单" if is_zh else " orders",
            "sales_label": "总销售额为" if is_zh else " total sales: ",
            "sales_unit": "元" if is_zh else "",
            "aov_prefix": "平均订单价值（AOV）为" if is_zh else "average AOV: ",
            "aov_unit": "元" if is_zh else "",
            "merchant_count_unit": "个" if is_zh else " ",
        },
        "merchant": {
            "suffix": "", "unit": "商家" if is_zh else "merchants",
            "head_title": "头部品牌" if is_zh else "Top Brands",
            "orders_label": "订单量为" if is_zh else " orders: ",
            "orders_unit": "单" if is_zh else "",
            "sales_label": "总销售额为" if is_zh else " total sales: ",
            "sales_unit": "元" if is_zh else "",
            "aov_prefix": "平均订单价值（AOV）为" if is_zh else "average AOV: ",
            "aov_unit": "元" if is_zh else "",
            "merchant_count_unit": "个" if is_zh else " ",
        },
        "tier": {
            "suffix": "", "unit": "商家" if is_zh else "merchants",
            "head_title": "头部品牌" if is_zh else "Top Brands",
            "orders_label": "订单量为" if is_zh else " orders: ",
            "orders_unit": "单" if is_zh else "",
            "sales_label": "总销售额为" if is_zh else " total sales: ",
            "sales_unit": "元" if is_zh else "",
            "aov_prefix": "平均订单价值（AOV）为" if is_zh else "average AOV: ",
            "aov_unit": "元" if is_zh else "",
            "merchant_count_unit": "个" if is_zh else " ",
        },
    }
    return labels.get(entity_type, labels["category"])


def _generate_entity_comparison_report(data: dict, plan: dict, language: str) -> dict:
    """Pre-computed comparison report from entityBreakdown — no LLM, exact numbers.

    Produces the same JSON structure as the LLM report, with guaranteed accuracy.
    """
    breakdown = data["entityBreakdown"]
    entity_names = list(breakdown.keys())
    entities = plan.get("entities", entity_names)
    title_entities = " vs ".join(entities)
    cache_month = data.get("cacheMonth", "")
    entity_type = plan.get("entityType", "category")
    is_en = language == "en"
    el = _entity_labels(entity_type, language)
    suffix = el["suffix"]
    unit = el["unit"]
    head_title = el["head_title"]

    # ── Build comparison table ──
    comp_headers = [_text(language, "指标", "Metric")]
    for ename in entities:
        comp_headers.append(ename)

    all_metrics = set()
    for edata in breakdown.values():
        all_metrics.update(edata.get("totals", {}).keys())
        all_metrics.update(edata.get("averages", {}).keys())

    # Pick metrics in priority order
    metric_labels = {
        "orders": _text(language, "总订单量", "Total Orders"),
        "salesAmount": _text(language, "总销售额（元）", "Total Sales"),
        "epc": _text(language, "平均 EPC", "Avg EPC"),
        "aov": _text(language, "平均 AOV（元）", "Avg AOV"),
        "clicks": _text(language, "总点击", "Total Clicks"),
        "conversionRate": _text(language, "转化率", "Conv. Rate"),
    }
    preferred = ["orders", "salesAmount", "aov", "epc", "clicks", "conversionRate"]
    used_metrics = [m for m in preferred if m in all_metrics][:4]

    for m in used_metrics:
        row = {ename: "" for ename in entities}
        for ename in entities:
            edata = breakdown.get(ename, {})
            val = None
            if m in edata.get("totals", {}):
                val = edata["totals"][m]
            elif m in edata.get("averages", {}):
                val = edata["averages"][m]
            if val is not None:
                if m in ("epc", "aov", "conversionRate"):
                    row[ename] = f"{val:.2f}"
                else:
                    row[ename] = f"{val:,.0f}"
            else:
                row[ename] = "-"
        comp_rows_map[metric_labels.get(m, m)] = row

    comp_rows = []
    for label, row in comp_rows_map.items():
        comp_rows.append([label] + [row[ename] for ename in entities])

    # ── Findings (entity-type-aware & language-aware labels) ──
    findings = []
    gap = " " if not suffix else suffix
    if "orders" in all_metrics:
        orders_data = {e: breakdown[e].get("totals", {}).get("orders", 0) for e in entities}
        sorted_orders = sorted(orders_data.items(), key=lambda x: x[1], reverse=True)
        if len(sorted_orders) >= 2:
            top_name, top_val = sorted_orders[0]
            bot_name, bot_val = sorted_orders[1]
            if bot_val > 0:
                ratio = top_val / bot_val
                if is_en:
                    findings.append(f"{top_name} has {top_val:,.0f} orders, {ratio:.1f}x {bot_name}'s {bot_val:,.0f} orders.")
                else:
                    findings.append(f"{top_name}{suffix}订单量为{top_val:,.0f}单，是{bot_name}{suffix}（{bot_val:,.0f}单）的{ratio:.1f}倍。")
            else:
                if is_en:
                    findings.append(f"{top_name}: {top_val:,.0f} orders; {bot_name}: no orders data.")
                else:
                    findings.append(f"{top_name}{suffix}订单量为{top_val:,.0f}单，{bot_name}{suffix}暂无订单数据。")
        elif len(sorted_orders) == 1:
            if is_en:
                findings.append(f"{sorted_orders[0][0]}: {sorted_orders[0][1]:,.0f} total orders.")
            else:
                findings.append(f"{sorted_orders[0][0]}{suffix}总订单量为{sorted_orders[0][1]:,.0f}单。")

    if "salesAmount" in all_metrics:
        sales_data = {e: breakdown[e].get("totals", {}).get("salesAmount", 0) for e in entities}
        sorted_sales = sorted(sales_data.items(), key=lambda x: x[1], reverse=True)
        if len(sorted_sales) >= 2:
            top_n, top_v = sorted_sales[0]
            bot_n, bot_v = sorted_sales[1]
            if bot_v > 0:
                ratio = top_v / bot_v
                if is_en:
                    findings.append(f"{top_n} total sales: ${top_v:,.2f}, {ratio:.1f}x {bot_n}'s ${bot_v:,.2f}.")
                else:
                    findings.append(f"{top_n}{suffix}总销售额为{top_v:,.2f}元，是{bot_n}{suffix}（{bot_v:,.2f}元）的{ratio:.1f}倍。")
            else:
                if is_en:
                    findings.append(f"{top_n} total sales: ${top_v:,.2f}.")
                else:
                    findings.append(f"{top_n}{suffix}总销售额为{top_v:,.2f}元。")

    if "aov" in all_metrics:
        aov_data = {e: breakdown[e].get("averages", {}).get("aov", 0) for e in entities}
        sorted_aov = sorted(aov_data.items(), key=lambda x: x[1], reverse=True)
        if len(sorted_aov) >= 2:
            top_n, top_v = sorted_aov[0]
            bot_n, bot_v = sorted_aov[1]
            if bot_v > 0:
                if is_en:
                    findings.append(f"{top_n} avg AOV: ${top_v:.2f}, {bot_n}: ${bot_v:.2f}.")
                else:
                    findings.append(f"{top_n}{suffix}平均订单价值（AOV）为{top_v:.2f}元，{bot_n}{suffix}为{bot_v:.2f}元。")
            else:
                if is_en:
                    findings.append(f"{top_n}{gap}AOV: ${top_v:.2f}.")
                else:
                    findings.append(f"{top_n}{gap}AOV为{top_v:.2f}元。")

    if not findings:
        if is_en:
            findings = [f"Comparison analysis of {len(entities)} entities: {title_entities}."]
        else:
            findings = [f"对比分析{title_entities}的{len(entities)}个实体。"]

    # ── Summary ──
    summary_parts = []
    if "orders" in all_metrics:
        total_orders = sum(breakdown[e].get("totals", {}).get("orders", 0) for e in entities)
        if is_en:
            summary_parts.append(f"{total_orders:,.0f} total orders")
        else:
            summary_parts.append(f"共{total_orders:,.0f}单")
    if "salesAmount" in all_metrics:
        total_sales = sum(breakdown[e].get("totals", {}).get("salesAmount", 0) for e in entities)
        if is_en:
            summary_parts.append(f"${total_sales:,.2f} total sales")
        else:
            summary_parts.append(f"总销售额{total_sales:,.2f}元")
    if is_en:
        summary_text = ". ".join(summary_parts) if summary_parts else f"{title_entities} comparison"
        if cache_month:
            summary_text += f". Data period: {cache_month}"
    else:
        summary_text = "，".join(summary_parts) if summary_parts else f"{title_entities} 对比分析"
        if cache_month:
            summary_text += f"。数据周期：{cache_month}"

    # ── Sections ──
    sections = [
        {
            "type": "comparison",
            "title": _text(language, "整体表现对比", "Performance Comparison"),
            "findings": findings,
            "table": {
                "headers": comp_headers,
                "rows": comp_rows,
            },
            "severity": "medium",
        },
    ]

    # Per-entity brand list section
    for ename in entities:
        edata = breakdown.get(ename, {})
        e_offers = edata.get("offers", [])[:5]
        if e_offers:
            brand_rows = [
                [
                    o.get("brand", ""),
                    o.get("tier", ""),
                    f"{o.get('epc', 0):.2f}",
                    f"{o.get('aov', 0):.2f}",
                    f"{o.get('salesAmount', 0):,.2f}",
                    f"{int(o.get('orders', 0)):,}",
                ]
                for o in e_offers
            ]
            if is_en:
                e_title = f"Top Brands — {ename}"
                e_findings = [
                    f"{ename}: {edata.get('sampleSize', 0)} {unit}.",
                    f"Top brand {e_offers[0].get('brand', '')} has EPC {e_offers[0].get('epc', 0):.2f}.",
                ]
                e_headers = ["Brand", "Tier", "EPC", "AOV", "Sales", "Orders"]
            else:
                e_title = f"{ename}{suffix}{head_title}"
                e_findings = [
                    f"{ename}{suffix}共{edata.get('sampleSize', 0)}个{unit}。",
                    f"{head_title} {e_offers[0].get('brand', '')} EPC 为 {e_offers[0].get('epc', 0):.2f}。",
                ]
                e_headers = ["品牌", "Tier", "EPC", "AOV", "销售额", "订单"]
            sections.append({
                "type": "overview",
                "title": e_title,
                "findings": e_findings,
                "table": {
                    "headers": e_headers,
                    "rows": brand_rows,
                },
                "severity": "low",
            })

    # Comparison summary card at end
    total_records = sum(breakdown[e].get("sampleSize", 0) for e in entities)
    if is_en:
        summary_card_title = "Data Summary"
        summary_card_findings = [
            f"Source: cache snapshot ({cache_month or 'unknown'}), {total_records:,.0f} records.",
            "All numbers are calculated from cached data.",
        ]
    else:
        summary_card_title = "数据摘要"
        summary_card_findings = [
            f"数据来源：缓存快照（{cache_month or '未知'}），共{total_records:,.0f}条记录。",
            "以上数字均基于缓存数据精确计算。",
        ]
    sections.append({
        "type": "recommendation",
        "title": summary_card_title,
        "findings": summary_card_findings,
        "severity": "low",
    })

    title_suffix = _text(language, "对比分析", "Comparison")
    return {
        "title": f"{title_entities} {title_suffix}",
        "summary": summary_text,
        "sections": sections,
    }


def generate_report(data: dict, plan: dict, language: str = "zh") -> dict:
    """Stage 3: Generate structured analysis report.

    For comparison queries with entityBreakdown, uses a pre-computed report
    with exact numbers (no LLM hallucination). For single-entity queries,
    uses LLM with temperature=0, falling back to data-only display.
    """
    # Comparison / multi-entity queries: pre-compute report to avoid LLM hallucination
    if "entityBreakdown" in data and len(data["entityBreakdown"]) >= 2:
        return _generate_entity_comparison_report(data, plan, language)

    # Single-entity queries: use LLM with temperature=0
    data_summary = _prepare_data_summary(data, plan)

    is_en = language == "en"
    if is_en:
        user_message = f"""User question: {plan.get('analysisGoal', 'Data analysis')}
Analysis type: {plan.get('analysisType', 'overview')}
Entity type: {plan.get('entityType', 'merchant')}
Target entities: {', '.join(plan.get('entities', []))}

Data summary:
{json.dumps(data_summary, ensure_ascii=False, indent=2)[:4000]}
"""
    else:
        user_message = f"""用户问题：{plan.get('analysisGoal', '数据分析')}
分析类型：{plan.get('analysisType', 'overview')}
实体类型：{plan.get('entityType', 'merchant')}
目标实体：{', '.join(plan.get('entities', []))}

数据摘要：
{json.dumps(data_summary, ensure_ascii=False, indent=2)[:4000]}
"""

    raw = call_llm(
        system_prompt=REPORT_SYSTEM_PROMPT_EN if is_en else REPORT_SYSTEM_PROMPT_ZH,
        user_message=user_message,
        max_tokens=1500,
        timeout=30,
        temperature=0,
    )

    if raw is None:
        return _data_only_report(data, plan, language)

    json_str = raw.strip()
    if json_str.startswith("```"):
        lines = json_str.split("\n")
        start = 0
        for i, line in enumerate(lines):
            if line.strip().startswith("```"):
                start = i + 1
                break
        end = len(lines)
        for i in range(len(lines) - 1, start - 1, -1):
            if lines[i].strip().startswith("```"):
                end = i
                break
        json_str = "\n".join(lines[start:end])

    try:
        report = json.loads(json_str)
        _validate_report(report)
        return report
    except (json.JSONDecodeError, ValueError):
        # Fallback to data-only
        return _data_only_report(data, plan, language)


REPORT_SYSTEM_PROMPT_ZH = """你是一个电商数据分析师。你将收到一组结构化数据，请基于这些数据生成分析报告。

输出 JSON 格式：
{
  "title": "分析标题（<50字）",
  "summary": "核心结论（1-2句话）",
  "sections": [
    {
      "type": "overview" | "comparison" | "trend" | "anomaly" | "recommendation",
      "title": "章节标题",
      "findings": ["关键发现1", "关键发现2"],
      "table": {
        "headers": ["列名1", "列名2"],
        "rows": [["值1", "值2"]]
      },
      "severity": "high" | "medium" | "low"
    }
  ]
}

规则：
- 只使用提供的数据，不要编造数字
- 每个 finding 要包含具体数值
- findings 数量 2-5 条
- 中文输出
- 输出纯 JSON，不要 markdown 包裹

注意 entityBreakdown 字段：当数据中包含 entityBreakdown 时，这表示实体级别（按 entityName 键组织）的独立统计数据。
每个实体有自己的 sampleSize、averages（平均值）、totals（总和）和 topOffers（Top品牌列表）。
你必须严格使用 entityBreakdown 中的具体数值进行分析：
- table.rows 中的数字必须直接来自对应实体的 totals（总和）和 averages（平均值）
- 例如 entityBreakdown["Beauty"]["totals"]["orders"] 就是 Beauty 的总订单数
- 例如 entityBreakdown["Electronics"]["totals"]["salesAmount"] 就是 Electronics 的总销售额
- findings 中的每个数值也必须是 entityBreakdown 中存在的具体数字
严禁编造、猜测或修改任何数据中的数字。如果数字太长可以加千分位逗号，但不能改变数值本身。"""

REPORT_SYSTEM_PROMPT_EN = """You are an e-commerce data analyst. You will receive structured data — generate an analysis report based on it.

Output JSON format:
{
  "title": "Report title (<60 chars)",
  "summary": "Core conclusion (1-2 sentences)",
  "sections": [
    {
      "type": "overview" | "comparison" | "trend" | "anomaly" | "recommendation",
      "title": "Section title",
      "findings": ["Key finding 1", "Key finding 2"],
      "table": {
        "headers": ["Column 1", "Column 2"],
        "rows": [["value1", "value2"]]
      },
      "severity": "high" | "medium" | "low"
    }
  ]
}

Rules:
- Use ONLY the provided data, do not fabricate numbers
- Each finding must include specific values
- 2-5 findings per section
- Output in English
- Output pure JSON, no markdown wrapping

When the data includes entityBreakdown, it means entity-level (keyed by entityName) independent statistics.
Each entity has its own sampleSize, averages, totals, and topOffers.
You MUST use exact values from entityBreakdown:
- table.rows numbers must come directly from each entity's totals and averages
- e.g., entityBreakdown["Beauty"]["totals"]["orders"] is Beauty's total orders
- e.g., entityBreakdown["Electronics"]["totals"]["salesAmount"] is Electronics's total sales
- Every number in findings must exist in entityBreakdown
Strictly prohibited: fabricating, guessing, or modifying any numbers. You may add thousand separators but never change the value itself."""


def _prepare_data_summary(data: dict, plan: dict) -> dict:
    """Prepare a compact data summary for LLM input."""
    summary = {}

    has_breakdown = "entityBreakdown" in data

    # When entityBreakdown is present, skip combined totals to avoid
    # misleading the LLM — per-entity data is the source of truth.
    if not has_breakdown:
        avgs = data.get("averages", {})
        totals = data.get("totals", {})
        if avgs:
            summary["averages"] = avgs
        if totals:
            summary["totals"] = totals

    summary["entityType"] = data.get("entityType", plan.get("entityType"))
    summary["entities"] = data.get("entities", plan.get("entities", []))
    summary["sampleSize"] = data.get("totalOffers", data.get("sampleSize", 0))
    summary["entityCount"] = data.get("entityCount", 0)

    # Top offers (skip combined list when entityBreakdown provides per-entity data)
    if not has_breakdown:
        offers = data.get("offers", [])
        if offers:
            summary["topOffers"] = [
                {"brand": o["brand"], "epc": o["epc"], "aov": o["aov"],
                 "salesAmount": o["salesAmount"], "tier": o["tier"]}
                for o in offers[:5]
            ]

    # Peers for comparison
    if "peers" in data:
        summary["peerAverages"] = data["peers"].get("averages", {})
        summary["peerSampleSize"] = data["peers"].get("sampleSize", 0)

    # Per-entity breakdown (comparison queries)
    if "entityBreakdown" in data:
        summary["entityBreakdown"] = {}
        for entity, edata in data["entityBreakdown"].items():
            summary["entityBreakdown"][entity] = {
                "sampleSize": edata.get("sampleSize", 0),
                "averages": edata.get("averages", {}),
                "totals": edata.get("totals", {}),
                "topOffers": [
                    {
                        "brand": o["brand"],
                        "epc": o["epc"],
                        "aov": o["aov"],
                        "salesAmount": o["salesAmount"],
                        "orders": o["orders"],
                        "tier": o["tier"],
                    }
                    for o in edata.get("offers", [])[:5]
                ],
            }

    # Distribution
    if "distribution" in data:
        dist = {}
        for cat, cat_data in data["distribution"].items():
            dist[cat] = {
                "merchantCount": cat_data.get("sampleSize", 0),
                "avgEpc": cat_data.get("averages", {}).get("epc", 0),
            }
        summary["distribution"] = dist

    # Historical data
    if "historicalData" in data and data["historicalData"]:
        summary["historical"] = []
        for h in data["historicalData"]:
            monthly = h.get("monthlyMetrics", [])
            if monthly:
                summary["historical"].append({
                    "brand": h.get("brand"),
                    "months": [
                        {"month": m.get("month"), "epc": m.get("epc"),
                         "orders": m.get("orders"), "revenue": m.get("revenue")}
                        for m in monthly[-6:]  # Last 6 months
                    ],
                })

    return summary


def _data_only_report(data: dict, plan: dict, language: str) -> dict:
    """Fallback report when LLM fails — pure data display without analysis text."""
    avgs = data.get("averages", {})
    totals = data.get("totals", {})
    offers = data.get("offers", [])
    entity_breakdown = data.get("entityBreakdown")
    is_en = language == "en"

    # If per-entity breakdown is available, show individual entity sections
    if entity_breakdown:
        sections = []
        all_section_tables = []

        for entity, edata in entity_breakdown.items():
            e_avgs = edata.get("averages", {})
            e_totals = edata.get("totals", {})
            e_offers = edata.get("offers", [])

            findings = []
            if e_avgs.get("epc") is not None:
                findings.append(f"{'Avg EPC' if is_en else '平均 EPC'}: {e_avgs['epc']}")
            if e_avgs.get("aov") is not None:
                findings.append(f"{'Avg AOV' if is_en else '平均 AOV'}: {e_avgs['aov']}")
            if e_totals.get("orders") is not None:
                findings.append(f"{'Total orders' if is_en else '总订单'}: {e_totals['orders']}")
            if e_totals.get("salesAmount") is not None:
                findings.append(f"{'Total sales' if is_en else '总销售额'}: {e_totals['salesAmount']}")

            table_rows = [
                [o.get("brand", ""), o.get("tier", ""),
                 str(o.get("epc", 0)), str(o.get("aov", 0)),
                 str(int(o.get("orders", 0))), str(o.get("salesAmount", 0))]
                for o in e_offers[:8]
            ]

            if is_en:
                section_title = f"{entity} Data"
                fallback_finding = f"{entity}: {edata.get('sampleSize', 0)} records."
                entity_headers = ["Merchant", "Tier", "EPC", "AOV", "Orders", "Sales"]
            else:
                section_title = f"{entity} 数据"
                fallback_finding = f"{entity}: {edata.get('sampleSize', 0)} 条数据。"
                entity_headers = ["商户", "Tier", "EPC", "AOV", "订单", "销售额"]

            sections.append({
                "type": "comparison",
                "title": section_title,
                "findings": findings or [fallback_finding],
                "table": {
                    "headers": entity_headers,
                    "rows": table_rows,
                },
                "severity": "low",
            })

            # Collect rows for combined comparison table
            if e_avgs.get("epc") is not None or e_totals.get("orders") is not None:
                all_section_tables.append({
                    "entity": entity,
                    "sampleSize": edata.get("sampleSize", 0),
                    "avgEpc": e_avgs.get("epc", "-"),
                    "avgAov": e_avgs.get("aov", "-"),
                    "orders": e_totals.get("orders", "-"),
                    "salesAmount": e_totals.get("salesAmount", "-"),
                })

        # Add a comparison overview section
        if len(all_section_tables) >= 2:
            overview_findings = []
            for item in all_section_tables:
                e = item["entity"]
                if is_en:
                    overview_findings.append(f"{e}: {item.get('orders', '-')} orders, sales ${item.get('salesAmount', '-')}, EPC {item.get('avgEpc', '-')}")
                else:
                    overview_findings.append(f"{e}: {item.get('orders', '-')} 单，销售额 {item.get('salesAmount', '-')}，EPC {item.get('avgEpc', '-')}")

            if is_en:
                overview_title = "Comparison Overview"
                overview_fallback = "Multi-entity data comparison"
                overview_headers = ["Entity", "Data Size", "Avg EPC", "Avg AOV", "Total Orders", "Total Sales"]
            else:
                overview_title = "对比概览"
                overview_fallback = "多实体数据对比"
                overview_headers = ["实体", "数据量", "平均 EPC", "平均 AOV", "总订单", "总销售额"]

            sections.insert(0, {
                "type": "overview",
                "title": overview_title,
                "findings": overview_findings or [overview_fallback],
                "table": {
                    "headers": overview_headers,
                    "rows": [
                        [item["entity"], str(item["sampleSize"]),
                         str(item["avgEpc"]), str(item["avgAov"]),
                         str(item["orders"]), str(item["salesAmount"])]
                        for item in all_section_tables
                    ],
                },
                "severity": "medium",
            })

        warning = data.get("warning")
        total_records = sum(edata.get("sampleSize", 0) for edata in entity_breakdown.values())
        if is_en:
            summary_text = f"{total_records} records total. LLM analysis is temporarily unavailable."
            if warning:
                summary_text += f" Note: {warning}"
            title = " vs ".join(entity_breakdown.keys()) + " Comparison"
        else:
            summary_text = f"共 {total_records} 条数据。LLM 分析暂不可用。"
            if warning:
                summary_text += f" 注意：{warning}"
            title = " vs ".join(entity_breakdown.keys()) + " 对比分析"

        return {
            "title": title,
            "summary": summary_text,
            "sections": sections,
        }

    # Original single-entity fallback
    findings = []
    if avgs.get("epc") is not None:
        findings.append(f"{'Avg EPC' if is_en else '平均 EPC'}: {avgs['epc']}")
    if avgs.get("aov") is not None:
        findings.append(f"{'Avg AOV' if is_en else '平均 AOV'}: {avgs['aov']}")
    if totals.get("orders") is not None:
        findings.append(f"{'Total orders' if is_en else '总订单'}: {totals['orders']}")
    if totals.get("salesAmount") is not None:
        findings.append(f"{'Total sales' if is_en else '总销售额'}: {totals['salesAmount']}")

    if is_en:
        table_headers = ["Merchant", "Tier", "EPC", "AOV", "Orders", "Sales"]
        section_title = "Data Overview"
        fallback_finding = "Data loaded, but LLM analysis is unavailable."
        title_suffix = "Data Analysis"
        summary_prefix = f"{data.get('totalOffers', 0)} records, {data.get('entityCount', 0)} entities. LLM analysis temporarily unavailable."
    else:
        table_headers = ["商户", "Tier", "EPC", "AOV", "订单", "销售额"]
        section_title = "数据概览"
        fallback_finding = "数据加载完成，但 LLM 分析不可用。"
        title_suffix = "数据分析"
        summary_prefix = f"共 {data.get('totalOffers', 0)} 条数据，{data.get('entityCount', 0)} 个实体。LLM 分析暂不可用。"

    table_rows = [
        [o.get("brand", ""), o.get("tier", ""),
         str(o.get("epc", 0)), str(o.get("aov", 0)),
         str(int(o.get("orders", 0))), str(o.get("salesAmount", 0))]
        for o in offers[:8]
    ]

    warning = data.get("warning")
    summary_text = summary_prefix
    if warning:
        summary_text += f"{' - Note' if is_en else ' - 注意'}: {warning}"

    return {
        "title": f"{' vs '.join(plan.get('entities', []))} {title_suffix}",
        "summary": summary_text,
        "sections": [
            {
                "type": "overview",
                "title": section_title,
                "findings": findings or [fallback_finding],
                "table": {
                    "headers": table_headers,
                    "rows": table_rows,
                },
            }
        ],
    }


def _validate_report(report: dict) -> None:
    """Basic validation of report structure. Raises ValueError on failure."""
    if "title" not in report:
        raise ValueError("Report missing title")
    if "sections" not in report or not isinstance(report["sections"], list):
        raise ValueError("Report missing sections")
    for sec in report["sections"]:
        if "type" not in sec:
            raise ValueError("Section missing type")
        if sec["type"] not in ("overview", "comparison", "trend", "anomaly", "recommendation"):
            raise ValueError(f"Invalid section type: {sec['type']}")


def run_deep_reasoning(prompt: str, language: str = "zh") -> dict:
    """Run the full 3-stage deep reasoning pipeline.

    Args:
        prompt: User's natural language question
        language: Output language ("zh" or "en")

    Returns:
        dict with structure:
        {
            "title": str,
            "summary": str,
            "sections": [...],
            "stages": {
                "parse": "ok" | "error",
                "data": "ok" | "partial" | "empty" | "error",
                "report": "ok" | "fallback" | "error"
            }
        }
    """
    stages = {"parse": "ok", "data": "ok", "report": "ok"}

    # Stage 1: Parse query
    plan = parse_query(prompt, language)
    if "error" in plan:
        stages["parse"] = "error"
        return {
            "title": _text(language, "无法理解问题", "Unable to Understand Query"),
            "summary": plan["error"],
            "sections": [{
                "type": "overview",
                "title": _text(language, "提示", "Hint"),
                "findings": [plan["error"]],
                "severity": "medium",
            }],
            "stages": stages,
        }

    # Embed language so downstream (execute_query_plan, etc.) can use it
    plan["language"] = language

    # Stage 2: Execute data
    try:
        data = execute_query_plan(plan)
        warning = data.get("warning")
        if warning:
            stages["data"] = "partial"
        if data.get("totalOffers", data.get("sampleSize", 0)) == 0 and not data.get("historicalData"):
            stages["data"] = "empty"
    except Exception as exc:
        stages["data"] = "error"
        return {
            "title": _text(language, "数据查询失败", "Data Query Failed"),
            "summary": _text(language, f"查询数据时出错: {str(exc)}", f"Error querying data: {str(exc)}"),
            "sections": [{
                "type": "overview",
                "title": _text(language, "错误信息", "Error"),
                "findings": [_text(language, f"数据查询异常: {str(exc)}", f"Data query error: {str(exc)}")],
                "severity": "high",
            }],
            "stages": stages,
        }

    # Stage 3: Generate report
    try:
        report = generate_report(data, plan, language)
        stages["report"] = "ok"
    except Exception as exc:
        stages["report"] = "fallback"
        report = _data_only_report(data, plan, language)

    # Attach data period info
    report["dataPeriod"] = {
        "source": "cache" if plan.get("timeRange", {}).get("months", 2) <= 2 else "database",
        "cacheMonth": data.get("cacheMonth"),
        "checkedAt": data.get("cacheCheckedAt"),
    }
    report["stages"] = stages
    return report
