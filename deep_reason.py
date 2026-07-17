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

注意：禁止编造商户名或品类名，只使用用户提到的实体名称。输出纯 JSON，不要 markdown 包裹。"""


def parse_query(prompt: str) -> dict:
    """Stage 1: Use LLM to parse user question into a structured query plan.

    Returns the parsed query plan dict, or an error dict with "error" key.
    """
    if not prompt or len(prompt.strip()) < 4:
        return {"error": "问题太短，请详细描述你需要分析的内容。\n\n示例：\n- 对比 Shokz 和 Anker 的 EPC\n- Tier 2 中美妆商户过去 3 个月的 AOV 趋势\n- 各品类在 Tier 1-3 的分布情况"}

    raw = call_llm(
        system_prompt=PARSE_QUERY_SYSTEM_PROMPT,
        user_message=prompt,
        max_tokens=600,
        timeout=20,
        temperature=0,
    )

    if raw is None:
        return {"error": "LLM 暂时无法处理，请稍后重试。"}

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
        return {"error": f"无法解析查询计划，请重新描述问题。\nLLM 返回: {raw[:200]}"}

    # Validate
    errors = _validate_plan(plan)
    if errors:
        return {"error": errors}

    return plan


def _validate_plan(plan: dict) -> str | None:
    """Validate the parsed query plan. Returns error string or None if valid."""
    if not isinstance(plan.get("entities"), list) or len(plan["entities"]) == 0:
        return "请指定要分析的目标（商户名、品类名或 Tier 级别）。"
    if len(plan["entities"]) > 10:
        plan["entities"] = plan["entities"][:10]

    metrics = plan.get("metrics", [])
    if not metrics:
        plan["metrics"] = ["epc", "aov", "orders", "salesAmount", "conversionRate"]
    else:
        unknown = [m for m in metrics if m not in SUPPORTED_METRICS]
        if unknown:
            return f"不支持的指标: {', '.join(unknown)}。支持的指标: {', '.join(sorted(SUPPORTED_METRICS))}"

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
        return {
            "data": [],
            "summary": {},
            "warning": "缓存数据不可用，请稍后重试。"
        }

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
        results = _summarize_offers(matched, metrics, plan)

    else:
        results = {"data": [], "summary": {}}

    results["entityType"] = entity_type
    results["entities"] = entities
    results["entityCount"] = len(set(o.get("merchantId") or o.get("brand") for o in matched))
    results["totalOffers"] = len(matched)

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
        return {
            "data": [],
            "summary": {},
            "warning": "数据库模块不可用。"
        }

    # Fix 1: Handle non-merchant entity types — fall back to cache
    if entity_type != "merchant":
        warning = "品类/Tier 的历史趋势数据暂不支持，已降级使用当前快照数据。"
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
                    results["warning"] = f"查询 {entity_name} 历史数据失败: {exc}"

    if not results["historicalData"]:
        results["warning"] = "未找到历史数据，请检查商户名称或稍后重试。"

    return results


def generate_report(data: dict, plan: dict, language: str = "zh") -> dict:
    """Stage 3: Use LLM to generate structured analysis report from data.

    Falls back to data-only display on LLM failure.
    """
    # Prepare a compact data summary for the LLM (target ~5KB)
    data_summary = _prepare_data_summary(data, plan)

    user_message = f"""用户问题：{plan.get('analysisGoal', '数据分析')}
分析类型：{plan.get('analysisType', 'overview')}
实体类型：{plan.get('entityType', 'merchant')}
目标实体：{', '.join(plan.get('entities', []))}

数据摘要：
{json.dumps(data_summary, ensure_ascii=False, indent=2)[:4000]}
"""

    raw = call_llm(
        system_prompt=REPORT_SYSTEM_PROMPT,
        user_message=user_message,
        max_tokens=1500,
        timeout=30,
        temperature=0.3,
    )

    if raw is None:
        # Fallback: data-only display
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


REPORT_SYSTEM_PROMPT = """你是一个电商数据分析师。你将收到一组结构化数据，请基于这些数据生成分析报告。

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
- 输出纯 JSON，不要 markdown 包裹"""


def _prepare_data_summary(data: dict, plan: dict) -> dict:
    """Prepare a compact data summary for LLM input."""
    summary = {}

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

    # Top offers
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

    findings = []
    if avgs.get("epc") is not None:
        findings.append(f"平均 EPC: {avgs['epc']}")
    if avgs.get("aov") is not None:
        findings.append(f"平均 AOV: {avgs['aov']}")
    if totals.get("orders") is not None:
        findings.append(f"总订单: {totals['orders']}")
    if totals.get("salesAmount") is not None:
        findings.append(f"总销售额: {totals['salesAmount']}")

    table_headers = ["商户", "Tier", "EPC", "AOV", "订单", "销售额"]
    table_rows = [
        [o.get("brand", ""), o.get("tier", ""),
         str(o.get("epc", 0)), str(o.get("aov", 0)),
         str(int(o.get("orders", 0))), str(o.get("salesAmount", 0))]
        for o in offers[:8]
    ]

    # Fix 2: Preserve Stage 2 warning in summary
    warning = data.get("warning")
    summary_text = f"共 {data.get('totalOffers', 0)} 条数据，{data.get('entityCount', 0)} 个实体。LLM 分析暂不可用。"
    if warning:
        summary_text += f"- 注意：{warning}"

    return {
        "title": f"{' vs '.join(plan.get('entities', []))} 数据分析",
        "summary": summary_text,
        "sections": [
            {
                "type": "overview",
                "title": "数据概览",
                "findings": findings or ["数据加载完成，但 LLM 分析不可用。"],
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
    plan = parse_query(prompt)
    if "error" in plan:
        stages["parse"] = "error"
        return {
            "title": "无法理解问题",
            "summary": plan["error"],
            "sections": [{
                "type": "overview",
                "title": "提示",
                "findings": [plan["error"]],
                "severity": "medium",
            }],
            "stages": stages,
        }

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
            "title": "数据查询失败",
            "summary": f"查询数据时出错: {str(exc)}",
            "sections": [{
                "type": "overview",
                "title": "错误信息",
                "findings": [f"数据查询异常: {str(exc)}"],
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

    report["stages"] = stages
    return report
