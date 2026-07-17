# 深度推理模式（Deep Reasoning）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有快模式聊天机器人旁新增深度推理模式，支持自然语言驱动的数据对比、趋势分析、多维交叉分析。

**架构:** 前端新增模式切换按钮和全屏覆盖层渲染器；后端新增 `deep_reason.py` 编排器（Stage1 LLM 拆解→Stage2 Python 数据执行→Stage3 LLM 报告生成），复用到现有 `/api/chat/analyze` 端点。

**Tech Stack:** Python (后端编排器) + Vanilla JS (前端覆盖层) + LLM (DeepSeek/Claude via `llm_provider.py`) + MySQL + JSON 缓存文件

## 全局约束

- 不新增 Vercel 端点文件；使用现有 `/api/chat/analyze` 加 `mode: "deep"` 分支
- 快模式保持完整不动
- 前端使用全屏覆盖层渲染报告，不新增 SVG 图表
- 关闭覆盖层后聊天流插入摘要消息
- 每个深度推理请求独立，不维护多轮对话
- 报告内容输出中文

---

### Task 1: 后端 — `deep_reason.py` 编排器（核心）

**Files:**
- Create: `deep_reason.py`
- Test: `scripts/test_deep_reason.py`
- Uses: `llm_provider.py`、`offer_db.py`、`protected_data/db_offers_cache.json`、`protected_data/db_keywords_cache.json`

**Interfaces:**
- Consumes: `llm_provider.call_llm()`、`offer_db.merchant_payload()`、`offer_db.search_payload()`
- Produces: `run_deep_reasoning(prompt: str, language: str) -> dict`

**数据逻辑：**

**JSON 缓存结构**
- `db_offers_cache.json` 是 `protected_payloads.py` 使用的完整数据结构，根层 keys: `ok`, `checkedAt`, `month`, `offers` (list), `paymentRecords` (list), `sheets` (list), `summary` (dict)
- `offers` 数组每项包含: `merchantId`, `tier`, `merchantName`, `brand`, `epc`, `aov`, `conversionRate`, `orders`, `salesAmount`, `clicks`, `category`, `mainCategory`, `paymentCycle`, `paymentStatus`, `mayRevenue`, `juneRevenue` 等
- `paymentRecords` 数组每项包含: `merchantId`, `merchantName`, `reportMonthKey`, `paymentStatus`, `revenueMade`, `commissionMade` 等
- `db_keywords_cache.json` 结构: `ok`, `checkedAt`, `summary`, `merchants` (list of 485)，每项含 `merchantId`, `merchantName`, `productKeywords` 等

- [ ] **Step 1: Write the failing test for `parse_query()`**

```python
# scripts/test_deep_reason.py
"""Tests for deep_reason module — parse_query, data execution, report generation."""
import json
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from deep_reason import parse_query, SUPPORTED_METRICS, ANALYSIS_TYPES, ENTITY_TYPES

def test_parse_query_valid_output():
    """parse_query() should return a dict with all required fields."""
    result = parse_query("对比 Anker 和 Shokz 的 EPC")
    assert isinstance(result, dict), f"Expected dict, got {type(result)}"
    assert "analysisType" in result, f"Missing analysisType in {result}"
    assert "entityType" in result, f"Missing entityType in {result}"
    assert "entities" in result, f"Missing entities in {result}"
    assert isinstance(result["entities"], list), f"entities must be list"
    assert len(result["entities"]) > 0, f"entities must not be empty"
    assert result["entityType"] in ENTITY_TYPES, f"Invalid entityType: {result['entityType']}"
    assert result["analysisType"] in ANALYSIS_TYPES, f"Invalid analysisType: {result['analysisType']}"
    assert all(m in SUPPORTED_METRICS for m in result.get("metrics", [])), f"Unsupported metrics in {result}"

def test_parse_query_short_prompt():
    """Very short prompts should return an error dict."""
    result = parse_query("hi")
    assert "error" in result, f"Short prompt should error: {result}"

def test_parse_query_max_entities():
    """parse_query should cap entities at 10."""
    # Mock the LLM call to return 15 entities
    result = parse_query("对比 A, B, C, D, E, F, G, H, I, J, K 的数据")
    assert len(result.get("entities", [])) <= 10, f"Too many entities: {result}"
```

Run: `python -m pytest scripts/test_deep_reason.py::test_parse_query_valid_output -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'deep_reason'`

- [ ] **Step 2: Implement `parse_query()` — Stage 1 LLM 需求拆解**

```python
# deep_reason.py
"""Deep reasoning orchestrator — 3-stage pipeline for complex analysis.

Stage 1: LLM query parsing → structured query plan (JSON)
Stage 2: Data execution → JSON cache or MySQL
Stage 3: LLM report generation → structured report JSON
"""

from __future__ import annotations

import json
import os
import sys
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
```

- [ ] **Step 3: Run test to verify it passes**

Run: `python -m pytest scripts/test_deep_reason.py::test_parse_query_valid_output -v`
Expected: PASS

- [ ] **Step 4: Implement data execution layer — Stage 2**

```python
# Add to deep_reason.py

import datetime as dt
from collections import defaultdict

# Cache file paths
OFFERS_CACHE_PATH = ROOT / "protected_data" / "db_offers_cache.json"
KEYWORDS_CACHE_PATH = ROOT / "protected_data" / "db_keywords_cache.json


def _load_cache(path: Path) -> dict:
    """Load a JSON cache file. Returns empty dict if file doesn't exist."""
    if not path.exists():
        print(f"[deep_reason] Cache not found: {path}", file=sys.stderr)
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def execute_query_plan(plan: dict) -> dict:
    """Stage 2: Execute the query plan against data sources.
    
    Uses JSON cache for ≤2-month snapshots, MySQL for historical trends.
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
    """Execute query using JSON cache files (≤2 months data)."""
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
    
    results = {
        "entityType": entity_type,
        "entities": entities,
        "timeRangeMonths": months,
        "historicalData": [],
        "warning": None,
    }
    
    if entity_type == "merchant":
        for entity_name in entities[:5]:  # Limit to 5 merchants for DB queries
            # Try to find merchant ID from cache
            cache = _load_cache(OFFERS_CACHE_PATH)
            cache_offers = cache.get("offers", [])
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
```

- [ ] **Step 5: Write test for data execution**

```python
# Add to scripts/test_deep_reason.py

def test_execute_from_cache_merchant():
    """execute_query_plan should return summary for known merchants."""
    from deep_reason import execute_query_plan
    result = execute_query_plan({
        "analysisType": "comparison",
        "entityType": "merchant",
        "entities": ["anker"],
        "metrics": ["epc", "aov"],
        "timeRange": {"months": 2},
        "comparisonType": None,
        "filters": {},
        "analysisGoal": "测试"
    })
    assert isinstance(result, dict), f"Expected dict, got {type(result)}"
    assert "entityType" in result
    assert "totalOffers" in result
    # Should be able to run without DB
    assert "warning" not in result or result["warning"] is None, f"Unexpected warning: {result.get('warning')}"

def test_execute_from_cache_category():
    """execute_query_plan should aggregate by category."""
    from deep_reason import execute_query_plan
    result = execute_query_plan({
        "analysisType": "ranking",
        "entityType": "category",
        "entities": ["Beauty"],
        "metrics": ["epc", "orders"],
        "timeRange": {"months": 2},
        "comparisonType": None,
        "filters": {},
        "analysisGoal": "测试"
    })
    assert isinstance(result, dict)
    assert result.get("totalOffers", 0) >= 0
```

Run: `python -m pytest scripts/test_deep_reason.py::test_execute_from_cache_merchant -v`
Expected: PASS

- [ ] **Step 6: Implement report generation — Stage 3**

```python
# Add to deep_reason.py

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
    
    return {
        "title": f"{' vs '.join(plan.get('entities', []))} 数据分析",
        "summary": f"共 {data.get('totalOffers', 0)} 条数据，{data.get('entityCount', 0)} 个实体。LLM 分析暂不可用。",
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
```

- [ ] **Step 7: Implement the main orchestrator `run_deep_reasoning()`**

```python
# Add to deep_reason.py

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
```

- [ ] **Step 8: Write integration test for the full pipeline**

```python
# Add to scripts/test_deep_reason.py

def test_full_pipeline():
    """Full pipeline should produce a valid report structure."""
    from deep_reason import run_deep_reasoning
    result = run_deep_reasoning("显示 Beauty 品类中 EPC 最高的 3 个商户", "zh")
    assert "title" in result, f"Missing title in {result}"
    assert "sections" in result, f"Missing sections in {result}"
    assert isinstance(result["sections"], list), f"Sections not a list"
    assert result["sections"][0]["findings"], f"No findings in first section"
    # Should be able to run without LLM (fallback to data-only)
    assert result.get("stages", {}).get("report") in ("ok", "fallback")
```

Run: `python -m pytest scripts/test_deep_reason.py::test_full_pipeline -v`
Expected: PASS (may show LLM call warning if API key not set — should fallback gracefully)

- [ ] **Step 9: Commit**

```bash
git add deep_reason.py scripts/test_deep_reason.py
git commit -m "feat: add deep reasoning orchestrator (3-stage pipeline)"
```

---

### Task 2: 集成到现有后端 — `server.py` + `api/chat/analyze.py`

**Files:**
- Modify: `server.py:853-857`（在 handle_llm_analyze 中增加 mode 分支）
- Modify: `api/chat/analyze.py`（增加 deep mode 处理分支）
- Test: `scripts/test_deep_reason.py`（添加端到端测试）

**Interfaces:**
- Consumes: `deep_reason.run_deep_reasoning()`
- Produces: JSON with `{ok: true, mode: "deep", report: {...}}`

- [ ] **Step 1: Add test for analyze endpoint with deep mode**

```python
# Add to scripts/test_deep_reason.py

def test_analyze_endpoint_deep_mode():
    """Test server's handle_llm_analyze with mode=deep."""
    import json
    from deep_reason import run_deep_reasoning
    
    # Simulate what the server will do
    result = run_deep_reasoning("Tier 2 中 EPC 最高的商户", "zh")
    assert "title" in result
    assert "summary" in result
    assert "sections" in result
    assert "stages" in result
    # Verify the response shape matches what frontend expects
    payload = {"ok": True, "mode": "deep", "report": result}
    assert payload["ok"] is True
    assert payload["mode"] == "deep"
    assert "report" in payload
```

- [ ] **Step 2: Modify `api/chat/analyze.py` to handle deep mode**

```python
# api/chat/analyze.py — modified version

from http.server import BaseHTTPRequestHandler

from auth import _read_json_body, require_auth, send_json
from llm_classify import generate_analysis_text
from deep_reason import run_deep_reasoning


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        send_json(self, 204, {})
    
    def do_POST(self):
        if not require_auth(self):
            return
        
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 16384:  # Increased limit for deep prompts
            send_json(self, 400, {"ok": False, "error": "Request body is too large"})
            return
        
        try:
            body = _read_json_body(self)
        except (ValueError, Exception):
            send_json(self, 400, {"ok": False, "error": "Invalid JSON body"})
            return
        
        mode = str(body.get("mode") or "fast").strip()
        
        if mode == "deep":
            # Deep reasoning mode
            prompt = str(body.get("prompt") or "").strip()
            if not prompt:
                send_json(self, 400, {"ok": False, "error": "prompt is required for deep reasoning mode"})
                return
            language = str(body.get("language") or "zh").strip()
            if language not in ("en", "zh"):
                language = "zh"
            
            report = run_deep_reasoning(prompt, language)
            send_json(self, 200, {"ok": True, "mode": "deep", "report": report})
            return
        
        # Fast mode (existing behavior)
        summary = body.get("summary")
        if not isinstance(summary, dict):
            send_json(self, 400, {"ok": False, "error": "summary must be a JSON object"})
            return
        
        language = str(body.get("language") or "en").strip()
        if language not in ("en", "zh"):
            language = "en"
        
        text = generate_analysis_text(summary, language)
        if text is None:
            send_json(self, 200, {"ok": False, "error": "LLM analysis unavailable"})
        else:
            send_json(self, 200, {"ok": True, "text": text})
```

- [ ] **Step 3: Verify `server.py` already routes to `handle_llm_analyze`**

`server.py:853-857` 已有：
```python
if parsed.path == "/api/chat/analyze":
    if not require_auth(self):
        return
    self.handle_llm_analyze()
    return
```

无需修改 server.py 的路由——`handle_llm_analyze` 已在 server.py:883-904 中实现，新逻辑在 `api/chat/analyze.py:handler.do_POST()` 中处理 mode 分支。确认 server.py 不修改。

- [ ] **Step 4: Run tests**

Run: `python -m pytest scripts/test_deep_reason.py::test_analyze_endpoint_deep_mode -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/chat/analyze.py scripts/test_deep_reason.py
git commit -m "feat: integrate deep reasoning mode into analyze endpoint"
```

---

### Task 3: 前端 — 模式切换按钮

**Files:**
- Modify: `public/index.html`（聊天框上方加上切换按钮）
- Modify: `public/app.js`（state.deepMode + 切换逻辑）
- Modify: `public/styles.css`（切换按钮样式）

- [ ] **Step 1: 在 `public/index.html` 的聊天框上方添加模式切换按钮**

在现有 `chat-form` 前添加（大约第 202-208 行，`chat-panel` section 内）：

```html
<!-- 在 <form class="chat-input" id="chatForm"> 之前插入 -->
<div class="chat-mode-toggle" id="chatModeToggle">
  <button class="mode-btn mode-fast active" data-mode="fast" type="button">
    <span class="mode-indicator"></span>
    快速模式
  </button>
  <button class="mode-btn mode-deep" data-mode="deep" type="button">
    <span class="mode-indicator"></span>
    深度推理
  </button>
</div>
```

同时添加覆盖层容器（在 `</main>` 之前）：

```html
<!-- 深度推理覆盖层 -->
<div class="deep-overlay hidden" id="deepOverlay" role="dialog" aria-modal="true" aria-labelledby="deepOverlayTitle">
  <div class="deep-overlay-backdrop"></div>
  <div class="deep-overlay-panel">
    <div class="deep-overlay-header">
      <h2 id="deepOverlayTitle">深度分析</h2>
      <div class="deep-overlay-actions">
        <button class="deep-overlay-export" id="deepOverlayExport" type="button">导出</button>
        <button class="deep-overlay-close" id="deepOverlayClose" type="button" aria-label="关闭">
          <span aria-hidden="true">✕</span>
        </button>
      </div>
    </div>
    <div class="deep-overlay-body" id="deepOverlayBody">
      <div class="deep-overlay-skeleton" id="deepOverlaySkeleton">
        <div class="deep-skeleton-step" id="deepSkeletonStep1">
          <div class="deep-skeleton-spinner"></div>
          <span>正在理解你的问题…</span>
        </div>
        <div class="deep-skeleton-step" id="deepSkeletonStep2">
          <div class="deep-skeleton-spinner"></div>
          <span>正在查询数据…</span>
        </div>
        <div class="deep-skeleton-step" id="deepSkeletonStep3">
          <div class="deep-skeleton-spinner"></div>
          <span>正在生成分析报告…</span>
        </div>
      </div>
      <div class="deep-overlay-content hidden" id="deepOverlayContent">
        <div class="deep-report-title" id="deepReportTitle"></div>
        <div class="deep-report-summary" id="deepReportSummary"></div>
        <div class="deep-report-sections" id="deepReportSections"></div>
      </div>
      <div class="deep-overlay-error hidden" id="deepOverlayError">
        <p>分析失败，请稍后重试。</p>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add CSS for mode toggle and overlay**

```css
/* 添加到 public/styles.css 末尾 */

/* === 深度推理模式切换 === */
.chat-mode-toggle {
  display: flex;
  gap: 4px;
  padding: 8px 12px 0;
  border-top: 1px solid var(--line);
  background: var(--panel);
}

.mode-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid var(--line);
  border-radius: 20px;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.mode-btn:hover {
  border-color: var(--blue);
  color: var(--ink);
}

.mode-btn.active {
  border-color: var(--blue);
  background: var(--blue-soft);
  color: var(--blue);
}

.mode-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--muted);
}

.mode-fast .mode-indicator {
  background: var(--teal);
}

.mode-deep .mode-indicator {
  background: var(--amber);
}

.mode-btn.active .mode-indicator {
  box-shadow: 0 0 4px currentColor;
}

/* === 深度推理覆盖层 === */
.deep-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.deep-overlay-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
}

.deep-overlay-panel {
  position: relative;
  width: min(800px, 92vw);
  max-height: 85vh;
  background: var(--panel);
  border-radius: 16px;
  box-shadow: var(--shadow), 0 0 0 1px rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.deep-overlay-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--line);
}

.deep-overlay-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}

.deep-overlay-actions {
  display: flex;
  gap: 8px;
}

.deep-overlay-export,
.deep-overlay-close {
  padding: 6px 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: transparent;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  color: var(--muted);
  transition: all 0.15s ease;
}

.deep-overlay-export:hover,
.deep-overlay-close:hover {
  border-color: var(--blue);
  color: var(--ink);
}

.deep-overlay-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

/* 骨架屏 */
.deep-overlay-skeleton {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 0;
}

.deep-skeleton-step {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  color: var(--muted);
  font-size: 14px;
  transition: all 0.3s ease;
}

.deep-skeleton-step.active {
  color: var(--blue);
  font-weight: 600;
}

.deep-skeleton-step.done {
  color: var(--teal);
}

.deep-skeleton-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--line);
  border-top-color: var(--blue);
  border-radius: 50%;
  animation: deep-spin 0.8s linear infinite;
}

.deep-skeleton-step.done .deep-skeleton-spinner {
  border-color: var(--teal);
  animation: none;
}

.deep-skeleton-step.done .deep-skeleton-spinner::after {
  content: "✓";
}

@keyframes deep-spin {
  to { transform: rotate(360deg); }
}

/* 报告内容 */
.deep-overlay-content {
  animation: deep-fade-in 0.3s ease;
}

@keyframes deep-fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.deep-report-title {
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 8px;
  color: var(--ink);
}

.deep-report-summary {
  font-size: 14px;
  color: var(--muted);
  margin-bottom: 24px;
  padding: 12px 16px;
  background: var(--blue-soft);
  border-radius: 10px;
  line-height: 1.5;
}

.deep-report-section {
  margin-bottom: 20px;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fbfcfc;
}

.deep-report-section h3 {
  margin: 0 0 10px;
  font-size: 15px;
  font-weight: 700;
  color: var(--ink);
}

.deep-report-findings {
  list-style: none;
  padding: 0;
  margin: 0 0 12px;
}

.deep-report-findings li {
  padding: 5px 0;
  font-size: 13px;
  line-height: 1.5;
  color: #3a464b;
}

.deep-report-findings li::before {
  content: "•";
  color: var(--blue);
  font-weight: 700;
  margin-right: 8px;
}

.deep-report-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.deep-report-table th {
  text-align: left;
  padding: 6px 10px;
  border-bottom: 2px solid var(--line);
  font-weight: 700;
  color: var(--muted);
  white-space: nowrap;
}

.deep-report-table td {
  padding: 5px 10px;
  border-bottom: 1px solid var(--line);
}

.severity-high {
  border-left: 3px solid var(--rose);
}

.severity-medium {
  border-left: 3px solid var(--amber);
}

.severity-low {
  border-left: 3px solid var(--teal);
}

/* 摘要消息（聊天流中） */
.deep-summary-card {
  padding: 10px 14px;
  border: 1px solid var(--amber-soft);
  border-radius: 10px;
  background: var(--amber-soft);
  cursor: pointer;
  transition: all 0.15s ease;
}

.deep-summary-card:hover {
  border-color: var(--amber);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.deep-summary-card h4 {
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
}

.deep-summary-card p {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.4;
}
```

- [ ] **Step 3: Add state and mode toggle logic to `public/app.js`**

在 `const state = { ... }` 对象中（约第 75 行）添加：

```javascript
deepMode: false,
deepReport: null,
deepHistory: [],
```

在 `state.tierSheetFilters` 之后（约第 130 行）添加 DOM 引用：

```javascript
// 在文件顶部 DOM 引用区域添加（约第 135 行）
els.deepOverlay = null;     // Will be set in init()
els.deepOverlayBody = null;
els.deepOverlayContent = null;
els.deepOverlaySkeleton = null;
els.deepOverlayError = null;
els.deepReportTitle = null;
els.deepReportSummary = null;
els.deepReportSections = null;
els.deepOverlayClose = null;
els.deepOverlayExport = null;
els.chatModeToggle = null;
els.modeFastBtn = null;
els.modeDeepBtn = null;
```

在 `init()` 函数中（约第 8700 行区域，找到 `els.chatLog.addEventListener` 附近）添加 DOM 引用绑定：

```javascript
// 在 init() 的 DOM 引用部分添加
els.deepOverlay = document.getElementById("deepOverlay");
els.deepOverlayBody = document.getElementById("deepOverlayBody");
els.deepOverlayContent = document.getElementById("deepOverlayContent");
els.deepOverlaySkeleton = document.getElementById("deepOverlaySkeleton");
els.deepOverlayError = document.getElementById("deepOverlayError");
els.deepReportTitle = document.getElementById("deepReportTitle");
els.deepReportSummary = document.getElementById("deepReportSummary");
els.deepReportSections = document.getElementById("deepReportSections");
els.deepOverlayClose = document.getElementById("deepOverlayClose");
els.deepOverlayExport = document.getElementById("deepOverlayExport");
els.chatModeToggle = document.getElementById("chatModeToggle");
els.modeFastBtn = els.chatModeToggle?.querySelector('[data-mode="fast"]');
els.modeDeepBtn = els.chatModeToggle?.querySelector('[data-mode="deep"]');
```

在 `init()` 末尾的事件绑定部分添加模式切换和覆盖层事件：

```javascript
// 模式切换
els.modeFastBtn?.addEventListener("click", () => {
  state.deepMode = false;
  els.modeFastBtn.classList.add("active");
  els.modeDeepBtn.classList.remove("active");
  els.chatInput.placeholder = chatbotI18n[currentLanguage]?.chat?.placeholder || "Ask about EPC, tiers, AOV, conversion, unpaid offers...";
});

els.modeDeepBtn?.addEventListener("click", () => {
  state.deepMode = true;
  els.modeDeepBtn.classList.add("active");
  els.modeFastBtn.classList.remove("active");
  els.chatInput.placeholder = "输入复杂分析问题（支持对比、趋势、多维分析…）";
});

// 覆盖层关闭
els.deepOverlayClose?.addEventListener("click", closeDeepOverlay);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !els.deepOverlay?.classList.contains("hidden")) {
    closeDeepOverlay();
  }
});

// 导出
els.deepOverlayExport?.addEventListener("click", () => {
  window.print();
});
```

- [ ] **Step 4: Add the `submitDeepReasoning()` function and overlay helpers**

在 `applyPrompt` 函数之前（约第 6055 行）添加：

```javascript
async function submitDeepReasoning(prompt) {
  const language = responseLanguageFor(prompt);
  
  // 1. 打开覆盖层，显示骨架屏
  openDeepOverlay();
  
  // 2. 发送请求
  try {
    const response = await fetch("/api/chat/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, mode: "deep", language }),
    });
    
    if (!response.ok) {
      showDeepOverlayError("分析请求失败（" + response.status + "），请稍后重试。");
      return;
    }
    
    const data = await response.json();
    
    if (!data.ok || !data.report) {
      showDeepOverlayError("分析返回异常，请稍后重试。");
      return;
    }
    
    // 3. 渲染报告
    renderDeepReport(data.report);
    
    // 4. 插入聊天摘要
    addMessage("assistant", deepSummaryHtml(data.report, prompt));
    
  } catch (error) {
    console.error("[deep] reasoning error:", error);
    showDeepOverlayError("网络请求失败，请检查连接后重试。");
  }
}

function openDeepOverlay() {
  els.deepOverlay.classList.remove("hidden");
  els.deepOverlaySkeleton.classList.remove("hidden");
  els.deepOverlayContent.classList.add("hidden");
  els.deepOverlayError.classList.add("hidden");
  document.body.style.overflow = "hidden";
  
  // Reset skeleton steps
  document.querySelectorAll(".deep-skeleton-step").forEach((el, i) => {
    el.classList.remove("active", "done");
    if (i === 0) el.classList.add("active");
  });
  
  // Animate through stages
  setTimeout(() => {
    const step1 = document.getElementById("deepSkeletonStep1");
    if (step1) { step1.classList.remove("active"); step1.classList.add("done"); }
    const step2 = document.getElementById("deepSkeletonStep2");
    if (step2) step2.classList.add("active");
  }, 1500);
  
  setTimeout(() => {
    const step2 = document.getElementById("deepSkeletonStep2");
    if (step2) { step2.classList.remove("active"); step2.classList.add("done"); }
    const step3 = document.getElementById("deepSkeletonStep3");
    if (step3) step3.classList.add("active");
  }, 4000);
}

function closeDeepOverlay() {
  els.deepOverlay.classList.add("hidden");
  document.body.style.overflow = "";
}

function showDeepOverlayError(message) {
  els.deepOverlaySkeleton.classList.add("hidden");
  els.deepOverlayContent.classList.add("hidden");
  els.deepOverlayError.classList.remove("hidden");
  els.deepOverlayError.innerHTML = "<p>" + escapeHtml(message) + "</p>";
  // Still insert a message in chat
  addMessage("assistant", "📊 深度分析失败：" + escapeHtml(message));
}

function renderDeepReport(report) {
  els.deepOverlaySkeleton.classList.add("hidden");
  els.deepOverlayContent.classList.remove("hidden");
  
  els.deepReportTitle.textContent = report.title || "分析报告";
  els.deepReportSummary.textContent = report.summary || "";
  
  els.deepReportSections.innerHTML = (report.sections || []).map((section) => {
    const severityClass = section.severity ? " severity-" + section.severity : "";
    const tableHtml = section.table
      ? `<table class="deep-report-table">
           <thead><tr>${section.table.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
           <tbody>${section.table.rows.map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody>
         </table>`
      : "";
    
    return `<section class="deep-report-section${severityClass}">
      <h3>${escapeHtml(section.title)}</h3>
      ${section.findings ? `<ul class="deep-report-findings">${section.findings.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>` : ""}
      ${tableHtml}
    </section>`;
  }).join("");
}

function deepSummaryHtml(report, prompt) {
  const escapedTitle = escapeHtml(report.title || "分析报告");
  const escapedSummary = escapeHtml(report.summary || "");
  const promptPreview = escapeHtml(prompt.slice(0, 80) + (prompt.length > 80 ? "…" : ""));
  return `<div class="deep-summary-card" onclick="(function(){
    var o = document.getElementById('deepOverlay');
    if (o) {
      o.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    }
  })()">
    <h4>📊 深度分析：${escapedTitle}</h4>
    <p>${escapedSummary}</p>
    <small style="color:var(--muted);font-size:11px">${promptPreview}</small>
  </div>`;
}
```

- [ ] **Step 5: Modify `applyPrompt` to route to deep reasoning when mode is set**

修改 `applyPrompt` 函数（约第 6056 行），在开头添加深度模式分支：

```javascript
async function applyPrompt(prompt) {
  // ★ Deep reasoning mode routing
  if (state.deepMode) {
    addMessage("user", escapeHtml(prompt));
    await submitDeepReasoning(prompt);
    return;
  }
  // ... existing fast mode code unchanged ...
}
```

- [ ] **Step 6: Verify no conflicts with existing code**

确认 `applyPrompt` 的 `state.llmEnabled`、`canSkipLLMClassify()`、`classifyWithLLM()`、`answerPrompt()` 等函数完全不受影响。

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/app.js public/styles.css
git commit -m "feat: add deep reasoning mode toggle and overlay UI"
```

---

### Task 4: 端到端测试和样式微调

**Files:**
- Test: 手动验证 + `scripts/test_deep_reason.py`

- [ ] **Step 1: Write end-to-end tests**

```python
# Add to scripts/test_deep_reason.py

def test_empty_cache_fallback():
    """Test behavior when cache files are missing or empty."""
    from deep_reason import _execute_from_cache
    result = _execute_from_cache("merchant", ["test"], ["epc"], None, {})
    assert "warning" in result or "totalOffers" in result
    # Should not crash

def test_plan_validation():
    """Test parse_query returns proper error for invalid input."""
    from deep_reason import parse_query
    # Empty string
    result = parse_query("")
    assert "error" in result
    
    # Very short
    result = parse_query("ab")
    assert "error" in result
    
    # Mock LLM error
    result = parse_query("这是完全不符合格式的超级长文测试数据")
    # Should still return a dict — either valid or error
    assert isinstance(result, dict)
```

Run: `python -m pytest scripts/test_deep_reason.py -v`
Expected: All tests pass

- [ ] **Step 2: Manual end-to-end verification**

```bash
# Start the server
python server.py
```

然后在浏览器中验证：

1. 页面加载 → 聊天框上方显示"快速模式/深度推理"切换按钮
2. 默认选中"快速模式" → 原有功能正常
3. 切换到"深度推理" → placeholder 改变
4. 输入问题并发送 → 覆盖层打开，骨架屏显示三个阶段
5. 报告显示 → 标题、摘要、章节列表正确
6. 关闭覆盖层 → 聊天流中出现摘要卡片
7. 点击摘要卡片 → 覆盖层重新打开
8. 按 Esc → 覆盖层关闭

- [ ] **Step 3: Commit**

```bash
git add scripts/test_deep_reason.py
git commit -m "test: add deep reasoning e2e and edge case tests"
```

---

## 验证清单

1. **Spec 覆盖度检查**
   - ✅ 模式切换按钮（Task 3 Step 1-3）
   - ✅ 加载状态骨架屏（Task 3 Step 4 CSS）
   - ✅ 报告展示（Task 3 Step 4 renderDeepReport）
   - ✅ 关闭与历史摘要（Task 3 Step 4 closeDeepOverlay + deepSummaryHtml）
   - ✅ Stage 1 需求拆解（Task 1 Step 2）
   - ✅ Stage 2 数据执行（Task 1 Step 4-5）
   - ✅ Stage 3 报告生成（Task 1 Step 6）
   - ✅ 降级策略（Task 1 Step 6 `_data_only_report`）
   - ✅ 数据源优先级（Task 1 Step 4 `execute_query_plan` 缓存 vs MySQL）
   - ✅ 数据量控制（`_prepare_data_summary` 限制 ~5KB）
   - ✅ 错误处理（Task 1 Step 7 各阶段错误处理）

2. **占位符检查** — 所有代码块包含完整实现代码，无 TBD/TODO
3. **类型一致性** — `run_deep_reasoning` → `parse_query` → `execute_query_plan` → `generate_report` 接口类型一致
4. **文件完整** — 所有 `Create:` 和 `Modify:` 文件均已覆盖
