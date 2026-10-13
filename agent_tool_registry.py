"""Agent 服务端工具注册表和边界校验。

这个模块不访问数据库、不调用 Provider，也不信任浏览器传入的工具定义。
"""

from __future__ import annotations

import copy
import datetime as dt
import json
import math
import re
import unicodedata
from typing import Any

from agent_promotion_contract import (
    PROMOTION_MAX_ROWS,
    PROMOTION_METRICS,
    PROMOTION_RESULT_FIELDS,
    PROMOTION_SORTS,
    PROMOTION_VIEWS,
    validate_promotion_arguments,
    validate_promotion_result,
)


AGENT_CONTRACT_VERSION = "v2"
AGENT_TOOL_REGISTRY_VERSION = "agent-tools-v1"
AGENT_TOOL_NAMES = (
    "merchant_analysis",
    "category_analysis",
    "merchant_comparison",
    "tier_analysis",
    "category_comparison",
    "payment_status",
    "trend",
    "asin_analysis",
    "keyword_search",
    "promotion_analysis",
)
AGENT_TIER_NAMES = ("Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER")
AGENT_KEYWORD_METRICS = ("salesAmount", "orders", "conversionRate", "aov", "epc", "affCommission", "clicks")
AGENT_FILTER_OPERATORS = (">", ">=", "<", "<=", "=")
AGENT_PAYMENT_STATUSES = ("paid", "pending", "unpaid", "overdue", "partial")
AGENT_TREND_METRICS = (
    "revenue",
    "orders",
    "epc",
    "aov",
    "clicks",
    "affiliatePayout",
    "dpv",
    "atc",
    "conversionRate",
    "payout",
    "directSales",
    "haloSales",
)
AGENT_DATA_SOURCES = ("database", "cache", "mixed", "unavailable", "unknown")
AGENT_RESULT_MAX_BYTES = 6000
AGENT_TIER_RESULT_MAX_BYTES = 18000
AGENT_MAX_RESULT_STRING_CHARS = 1000
AGENT_MAX_RESULT_ARRAY_ITEMS = 100
AGENT_MAX_RESULT_DEPTH = 4

AGENT_RESULT_FIELDS = {
    "merchant_analysis": (
        "merchant", "tier", "category", "metrics", "ranks", "comparisons",
        "strengths", "weaknesses", "paymentRisk", "peers", "latestMonth",
        "monthly", "monthlyDataAvailable", "monthlyDataSource", "monthlyNote",
        "headline", "note", "topAsins", "asinRanking", "topAsinMetrics",
    ),
    "category_analysis": (
        "category", "merchantCount", "tierDistribution", "aggregates",
        "vsGlobal", "topMerchants", "headline", "note",
    ),
    "merchant_comparison": (
        "entities", "notFound", "deltas", "pairwiseDeltas", "headline", "note",
    ),
    "tier_analysis": (
        "tier", "merchantCount", "aggregates", "vsOtherTiers", "segments",
        "outliers", "merchantList", "merchants", "headline", "note",
    ),
    "category_comparison": ("tierFilter", "entities", "headline", "note"),
    "payment_status": ("filter", "summary", "rows", "headline", "note"),
    "trend": (
        "entityType", "target", "estimated", "metric", "metrics", "months",
        "summary", "headline", "note",
    ),
    "asin_analysis": (
        "asins", "rows", "monthly", "notFound", "headline", "note",
        "source", "dataAsOf",
    ),
    "keyword_search": (
        "keyword", "matchedKeyword", "matchType", "mode", "rows", "matchedCount", "returnedCount",
        "truncated", "unrankedCount", "headline", "note", "partial", "keywordCheckedAt",
        "appliedFilters", "eligibleCount", "excludedMissingMetricsCount", "matchSetComplete",
    ),
    "promotion_analysis": tuple(PROMOTION_RESULT_FIELDS),
}

_UNSAFE_KEYS = {"__proto__", "constructor", "prototype"}
_ASIN_PATTERN = re.compile(r"^B[0-9A-Z]{9}$", re.IGNORECASE)
_RESULT_ERROR_CODES = {
    "tool_error",
    "tool_timeout",
    "llm_timeout",
    "invalid_arguments",
    "invalid_filter",
    "not_found",
    "stopped_by_user",
}
_MONTH_PATTERN = re.compile(r"^20\d{2}-(0[1-9]|1[0-2])$")


def _error(error_code: str, field: str, status: int = 400) -> dict[str, Any]:
    return {"status": status, "errorCode": error_code, "field": field}


def _string(value: Any, field: str, maximum: int) -> tuple[str | None, dict | None]:
    if not isinstance(value, str):
        return None, _error("invalid_arguments", field)
    value = value.strip()
    if not value or len(value) > maximum:
        return None, _error("invalid_arguments", field)
    return value, None


def _integer(value: Any, field: str, minimum: int, maximum: int) -> tuple[int | None, dict | None]:
    if isinstance(value, bool):
        return None, _error("invalid_arguments", field)
    if isinstance(value, float):
        if not value.is_integer():
            return None, _error("invalid_arguments", field)
        value = int(value)
    if not isinstance(value, int) or value < minimum or value > maximum:
        return None, _error("invalid_arguments", field)
    return int(value), None


def _enum(value: Any, field: str, allowed: tuple[str, ...]) -> tuple[str | None, dict | None]:
    if not isinstance(value, str):
        return None, _error("invalid_arguments", field)
    value = value.strip()
    if value not in allowed:
        return None, _error("invalid_arguments", field)
    return value, None


def _string_array(
    value: Any,
    field: str,
    minimum: int,
    maximum: int,
    item_maximum: int,
) -> tuple[list[str] | None, dict | None]:
    if not isinstance(value, list) or not minimum <= len(value) <= maximum:
        return None, _error("invalid_arguments", field)
    cleaned = []
    for item in value:
        item_value, item_error = _string(item, field, item_maximum)
        if item_error:
            return None, item_error
        cleaned.append(item_value)
    return cleaned, None


def _asin_array(value: Any, field: str) -> tuple[list[str] | None, dict | None]:
    cleaned, error = _string_array(value, field, 1, 5, 10)
    if error:
        return None, error
    normalized: list[str] = []
    for item in cleaned or []:
        asin = item.upper()
        if not _ASIN_PATTERN.fullmatch(asin):
            return None, _error("invalid_arguments", field)
        if asin not in normalized:
            normalized.append(asin)
    return normalized, None


def _text_property(description_zh: str, description_en: str, maximum: int) -> dict[str, Any]:
    return {
        "type": "string",
        "description_zh": description_zh,
        "description_en": description_en,
        "maxLength": maximum,
    }


def _build_specs() -> dict[str, dict[str, Any]]:
    return {
        "merchant_analysis": {
            "description_zh": "查询单个商户的核心指标和月度数据；view=top_asins 根据商户名称或 ID 提取当前快照中最多五个 Top ASIN，无需预先提供 ASIN。",
            "description_en": "Get one merchant's metrics and monthly data; view=top_asins extracts up to five ranked ASINs from the current snapshot by merchant name or ID, without known ASINs.",
            "parameters": {
                "type": "object",
                "properties": {
                    "merchant": _text_property("商户名称或商户 ID。", "Merchant name or merchant ID.", 80),
                    "view": {"type": "string", "enum": ["overview", "top_asins"], "default": "overview"},
                },
                "required": ["merchant"],
                "additionalProperties": False,
            },
            "argument_fields": ("merchant", "view"),
        },
        "category_analysis": {
            "description_zh": "查询品类汇总、Tier 分布、全站对比和 Top 商户。",
            "description_en": "Get category aggregates, Tier distribution, global comparison, and top merchants.",
            "parameters": {
                "type": "object",
                "properties": {"category": _text_property("品类名称。", "Category name.", 120)},
                "required": ["category"],
                "additionalProperties": False,
            },
            "argument_fields": ("category",),
        },
        "merchant_comparison": {
            "description_zh": "仅在用户明确要求时比较 2–5 个商户的指标和差异。",
            "description_en": "Compare 2-5 merchants only when the user explicitly asks for comparison or differences.",
            "parameters": {
                "type": "object",
                "properties": {
                    "merchants": {
                        "type": "array",
                        "items": {"type": "string", "maxLength": 80},
                        "minItems": 2,
                        "maxItems": 5,
                    }
                },
                "required": ["merchants"],
                "additionalProperties": False,
            },
            "argument_fields": ("merchants",),
        },
        "tier_analysis": {
            "description_zh": "查询单个 Tier 的汇总、分段、异常商户和分页商户列表。",
            "description_en": "Get one Tier's aggregates, segments, outliers, and paginated merchant list.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tier": {"type": "string", "enum": list(AGENT_TIER_NAMES)},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 100},
                    "offset": {"type": "integer", "minimum": 0, "maximum": 10000, "default": 0},
                },
                "required": ["tier"],
                "additionalProperties": False,
            },
            "argument_fields": ("tier", "limit", "offset"),
        },
        "category_comparison": {
            "description_zh": "比较 2–4 个品类的汇总指标和 Top 商户，可选按 Tier 过滤。",
            "description_en": "Compare 2-4 category aggregates and top merchants, optionally filtered by Tier.",
            "parameters": {
                "type": "object",
                "properties": {
                    "categories": {
                        "type": "array",
                        "items": {"type": "string", "maxLength": 120},
                        "minItems": 2,
                        "maxItems": 4,
                    },
                    "tier": {"type": "string", "enum": list(AGENT_TIER_NAMES)},
                },
                "required": ["categories"],
                "additionalProperties": False,
            },
            "argument_fields": ("categories", "tier"),
        },
        "payment_status": {
            "description_zh": "按状态、月份、Tier 或商户查询付款记录。",
            "description_en": "Query payment records by status, month, Tier, or merchant.",
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {"type": "string", "enum": list(AGENT_PAYMENT_STATUSES)},
                    "month": {"type": "string", "pattern": r"^20\d{2}-(0[1-9]|1[0-2])$"},
                    "tier": {"type": "string", "enum": list(AGENT_TIER_NAMES)},
                    "merchant": _text_property("商户名称或商户 ID。", "Merchant name or merchant ID.", 80),
                },
                "minProperties": 1,
                "additionalProperties": False,
            },
            "argument_fields": ("status", "month", "tier", "merchant"),
        },
        "trend": {
            "description_zh": "查询商户、品类或 Tier 的月度趋势。一次返回收入、订单、点击、联盟佣金、CVR、EPC 等全部指标；metric 只指定主图指标，多商户分别调用，不按指标重复查询。",
            "description_en": "Get monthly trends for a merchant, category or Tier. One call returns all metrics including revenue, orders, clicks, affiliate commission, CVR and EPC; metric selects the chart only. Call once per merchant, not per metric.",
            "parameters": {
                "type": "object",
                "properties": {
                    "entityType": {"type": "string", "enum": ["merchant", "category", "tier"]},
                    "target": _text_property("商户、品类或 Tier 名称。", "Merchant, category, or Tier name.", 80),
                    "months": {"type": "integer", "minimum": 2, "maximum": 24, "default": 12},
                    "metric": {"type": "string", "enum": list(AGENT_TREND_METRICS)},
                },
                "required": ["target"],
                "additionalProperties": False,
            },
            "argument_fields": ("entityType", "target", "months", "metric"),
        },
        "asin_analysis": {
            "description_zh": "查询一个或多个 ASIN 的产品、商户汇总和真实月份表现。",
            "description_en": "Get product details, merchant summaries, and real month-by-month performance for one or more ASINs.",
            "parameters": {
                "type": "object",
                "properties": {
                    "asins": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "pattern": r"^B[0-9A-Z]{9}$",
                            "maxLength": 10,
                        },
                        "minItems": 1,
                        "maxItems": 5,
                    },
                    "view": {"type": "string", "enum": ["details", "performance"]},
                },
                "required": ["asins"],
                "additionalProperties": False,
            },
            "argument_fields": ("asins", "view"),
        },
        "keyword_search": {
            "description_zh": "按产品关键词查找匹配商户；原词无命中时可依次尝试最多三个语义相近候选词。推荐只按命中商户的整体快照表现排序，不代表该产品销量。",
            "description_en": "Find merchants by product keyword; when the original has no matches, try up to three semantic alternatives in order. Recommendations rank matched merchants by overall snapshot performance, not product sales.",
            "parameters": {
                "type": "object",
                "properties": {
                    "keyword": _text_property("产品关键词，不包含推荐等意图词。", "Product keyword without recommendation intent words.", 120),
                    "semanticAlternatives": {"type": "array", "items": {"type": "string", "minLength": 2, "maxLength": 120}, "minItems": 1, "maxItems": 3},
                    "mode": {"type": "string", "enum": ["search", "recommendation"], "default": "search"},
                    "tiers": {"type": "array", "items": {"type": "string", "enum": list(AGENT_TIER_NAMES)}, "maxItems": 5},
                    "metricFilters": {"type": "array", "maxItems": 6, "items": {"type": "object", "properties": {"field": {"type": "string", "enum": list(AGENT_KEYWORD_METRICS)}, "operator": {"type": "string", "enum": list(AGENT_FILTER_OPERATORS)}, "value": {"type": "number"}}, "required": ["field", "operator", "value"], "additionalProperties": False}},
                    "metricSort": {"type": "object", "properties": {"field": {"type": "string", "enum": list(AGENT_KEYWORD_METRICS)}, "direction": {"type": "string", "enum": ["asc", "desc"]}}, "required": ["field", "direction"], "additionalProperties": False},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 20, "default": 10},
                },
                "required": ["keyword"],
                "additionalProperties": False,
            },
            "argument_fields": ("keyword", "semanticAlternatives", "mode", "limit", "tiers", "metricFilters", "metricSort"),
        },
        "promotion_analysis": {
            "description_zh": "基于用户上传的商家清单，查询推广前后商家、按商家统计媒体数量、媒体、链接、品类或历史表现；没有上传清单时不要调用。",
            "description_en": "Analyze merchant performance, count distinct active publishers per merchant, or inspect publisher, link, category, or history performance for an uploaded merchant list; do not call without an uploaded list.",
            "parameters": {
                "type": "object",
                "properties": {
                    "attachmentId": _text_property("当前上传清单的附件 ID。", "The current uploaded list attachment ID.", 128),
                    "view": {"type": "string", "enum": list(PROMOTION_VIEWS)},
                    "merchantIds": {"type": "array", "items": {"type": "string", "pattern": r"^[1-9]\d{0,12}$", "maxLength": 13}, "minItems": 1, "maxItems": 200},
                    "window": {"type": ["object", "null"]},
                    "metric": {"type": "string", "enum": list(PROMOTION_METRICS), "default": "revenue"},
                    "sortBy": {"type": "string", "enum": list(PROMOTION_SORTS), "default": "after"},
                    "direction": {"type": "string", "enum": ["asc", "desc"], "default": "desc"},
                    "offset": {"type": "integer", "minimum": 0, "maximum": 10000, "default": 0},
                    "limit": {"type": "integer", "minimum": 1, "maximum": PROMOTION_MAX_ROWS, "default": PROMOTION_MAX_ROWS},
                },
                "required": ["attachmentId", "view"],
                "additionalProperties": False,
            },
            "argument_fields": ("attachmentId", "view", "merchantIds", "window", "metric", "sortBy", "direction", "offset", "limit"),
        },
    }


_SPECS = _build_specs()


def validate_enabled_tools(value: object) -> tuple[list[str] | None, dict | None]:
    if not isinstance(value, list) or not value:
        return None, _error("invalid_agent_contract", "enabledTools")
    requested = []
    for item in value:
        if not isinstance(item, str):
            return None, _error("unsupported_tool", "enabledTools")
        name = item.strip()
        if name not in _SPECS:
            return None, _error("unsupported_tool", "enabledTools")
        if name not in requested:
            requested.append(name)
    ordered = [name for name in AGENT_TOOL_NAMES if name in requested]
    return ordered, None


def get_agent_tool_definitions(language: str, enabled_tools: object) -> list[dict]:
    names, error = validate_enabled_tools(enabled_tools)
    if error:
        raise ValueError(error["errorCode"])
    selected_language = "en" if language == "en" else "zh"
    definitions = []
    for name in names or []:
        spec = _SPECS[name]
        definitions.append(
            {
                "name": name,
                "description": spec["description_en"] if selected_language == "en" else spec["description_zh"],
                "parameters": copy.deepcopy(spec["parameters"]),
            }
        )
    return definitions


def _validate_keyword_filters(value: object) -> tuple[dict | None, dict | None]:
    """关键词筛选保持比例数值，并拒绝非白名单条件。"""
    if not isinstance(value, dict) or any(key not in {"tiers", "metricFilters", "metricSort"} for key in value):
        return None, _error("invalid_filter", "appliedFilters")
    cleaned = copy.deepcopy(value)
    if "tiers" in value:
        tiers = value["tiers"]
        if not isinstance(tiers, list) or len(tiers) > 5 or any(tier not in AGENT_TIER_NAMES for tier in tiers):
            return None, _error("invalid_filter", "tiers")
        cleaned["tiers"] = list(dict.fromkeys(tiers))
    if "metricFilters" in value:
        filters = value["metricFilters"]
        if not isinstance(filters, list) or len(filters) > 6:
            return None, _error("invalid_filter", "metricFilters")
        for item in filters:
            if (not isinstance(item, dict) or set(item) != {"field", "operator", "value"}
                    or item["field"] not in AGENT_KEYWORD_METRICS or item["operator"] not in AGENT_FILTER_OPERATORS
                    or not _finite_filter_number(item["value"])):
                return None, _error("invalid_filter", "metricFilters")
    if "metricSort" in value:
        sort = value["metricSort"]
        if (not isinstance(sort, dict) or set(sort) != {"field", "direction"}
                or sort["field"] not in AGENT_KEYWORD_METRICS or sort["direction"] not in ("asc", "desc")):
            return None, _error("invalid_filter", "metricSort")
    return cleaned, None


def _finite_filter_number(value: object) -> bool:
    """拒绝无法表达为前端有限数值的筛选门槛。"""
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def validate_tool_arguments(tool_name: str, arguments: object) -> tuple[dict | None, dict | None]:
    spec = _SPECS.get(tool_name)
    if spec is None:
        return None, _error("unsupported_tool", "toolName")
    if not isinstance(arguments, dict):
        return None, _error("invalid_arguments", "arguments")
    allowed = set(spec["argument_fields"])
    if any(key not in allowed or key in _UNSAFE_KEYS for key in arguments):
        return None, _error("invalid_arguments", "arguments")

    cleaned: dict[str, Any] = {}
    if tool_name == "merchant_analysis":
        cleaned_value, error = _string(arguments.get("merchant"), "merchant", 80)
        if error:
            return None, error
        cleaned["merchant"] = cleaned_value
        if "view" in arguments:
            view, error = _enum(arguments["view"], "view", ("overview", "top_asins"))
            if error:
                return None, error
            cleaned["view"] = view
    elif tool_name == "category_analysis":
        cleaned_value, error = _string(arguments.get("category"), "category", 120)
        if error:
            return None, error
        cleaned["category"] = cleaned_value
    elif tool_name == "merchant_comparison":
        cleaned_value, error = _string_array(arguments.get("merchants"), "merchants", 2, 5, 80)
        if error:
            return None, error
        cleaned["merchants"] = cleaned_value
    elif tool_name == "tier_analysis":
        tier, error = _enum(arguments.get("tier"), "tier", AGENT_TIER_NAMES)
        if error:
            return None, error
        cleaned["tier"] = tier
        if "limit" in arguments:
            limit, error = _integer(arguments["limit"], "limit", 1, 100)
            if error:
                return None, error
            cleaned["limit"] = limit
        if "offset" in arguments:
            offset, error = _integer(arguments["offset"], "offset", 0, 10000)
            if error:
                return None, error
            cleaned["offset"] = offset
    elif tool_name == "category_comparison":
        cleaned_value, error = _string_array(arguments.get("categories"), "categories", 2, 4, 120)
        if error:
            return None, error
        cleaned["categories"] = cleaned_value
        if "tier" in arguments:
            tier, error = _enum(arguments["tier"], "tier", AGENT_TIER_NAMES)
            if error:
                return None, error
            cleaned["tier"] = tier
    elif tool_name == "asin_analysis":
        asins, error = _asin_array(arguments.get("asins"), "asins")
        if error:
            return None, error
        cleaned["asins"] = asins
        if "view" in arguments:
            view, error = _enum(arguments["view"], "view", ("details", "performance"))
            if error:
                return None, error
            cleaned["view"] = view
    elif tool_name == "keyword_search":
        keyword, error = _string(arguments.get("keyword"), "keyword", 120)
        if error or len(keyword or "") < 2:
            return None, _error("invalid_arguments", "keyword")
        mode, error = _enum(arguments.get("mode", "search"), "mode", ("search", "recommendation"))
        if error:
            return None, error
        limit, error = _integer(arguments.get("limit", 10), "limit", 1, 20)
        if error:
            return None, error
        cleaned.update({"keyword": keyword, "mode": mode, "limit": limit})
        if "semanticAlternatives" in arguments:
            alternatives, error = _string_array(arguments["semanticAlternatives"], "semanticAlternatives", 1, 3, 120)
            if error or any(len(item) < 2 for item in alternatives or []):
                return None, _error("invalid_arguments", "semanticAlternatives")
            cleaned["semanticAlternatives"] = alternatives
        filters, error = _validate_keyword_filters({key: arguments[key] for key in ("tiers", "metricFilters", "metricSort") if key in arguments})
        if error:
            return None, error
        cleaned.update(filters)
    elif tool_name == "promotion_analysis":
        cleaned, error = validate_promotion_arguments(arguments)
        if error:
            return None, error
        return cleaned, None
    elif tool_name == "payment_status":
        if not arguments:
            return None, _error("invalid_arguments", "arguments")
        if "status" in arguments:
            status, error = _enum(arguments["status"], "status", AGENT_PAYMENT_STATUSES)
            if error:
                return None, error
            cleaned["status"] = status
        if "month" in arguments:
            month, error = _string(arguments["month"], "month", 7)
            if error or not _MONTH_PATTERN.fullmatch(month or ""):
                return None, _error("invalid_arguments", "month")
            cleaned["month"] = month
        if "tier" in arguments:
            tier, error = _enum(arguments["tier"], "tier", AGENT_TIER_NAMES)
            if error:
                return None, error
            cleaned["tier"] = tier
        if "merchant" in arguments:
            merchant, error = _string(arguments["merchant"], "merchant", 80)
            if error:
                return None, error
            cleaned["merchant"] = merchant
    elif tool_name == "trend":
        target, error = _string(arguments.get("target"), "target", 80)
        if error:
            return None, error
        cleaned["target"] = target
        if "entityType" in arguments:
            entity, error = _enum(arguments["entityType"], "entityType", ("merchant", "category", "tier"))
            if error:
                return None, error
            cleaned["entityType"] = entity
        months, error = _integer(arguments.get("months", 12), "months", 2, 24)
        if error:
            return None, error
        cleaned["months"] = months
        if "metric" in arguments:
            metric, error = _enum(arguments["metric"], "metric", AGENT_TREND_METRICS)
            if error:
                return None, error
            cleaned["metric"] = metric
    return cleaned, None


def _validate_json_value(value: Any, depth: int = 0) -> bool:
    if depth > AGENT_MAX_RESULT_DEPTH:
        return False
    if value is None or isinstance(value, bool):
        return True
    if isinstance(value, (int, float)):
        return not isinstance(value, float) or math.isfinite(value)
    if isinstance(value, str):
        return len(value) <= AGENT_MAX_RESULT_STRING_CHARS
    if isinstance(value, list):
        return len(value) <= AGENT_MAX_RESULT_ARRAY_ITEMS and all(
            _validate_json_value(item, depth + 1) for item in value
        )
    if isinstance(value, dict):
        return all(
            isinstance(key, str)
            and key not in _UNSAFE_KEYS
            and len(key) <= AGENT_MAX_RESULT_STRING_CHARS
            and _validate_json_value(item, depth + 1)
            for key, item in value.items()
        )
    return False


def _validate_source(source: Any) -> tuple[dict | None, dict | None]:
    if source is None:
        return {"dataSource": "unknown", "dataAsOf": None, "estimated": False}, None
    if not isinstance(source, dict) or any(key not in {"dataSource", "dataAsOf", "estimated"} for key in source):
        return None, _error("invalid_tool_result", "source")
    data_source = source.get("dataSource", "unknown")
    if data_source not in AGENT_DATA_SOURCES:
        return None, _error("invalid_tool_result", "source")
    data_as_of = source.get("dataAsOf")
    if data_as_of is not None and (not isinstance(data_as_of, str) or len(data_as_of) > 100):
        return None, _error("invalid_tool_result", "source")
    estimated = source.get("estimated", False)
    if not isinstance(estimated, bool):
        return None, _error("invalid_tool_result", "source")
    return {"dataSource": data_source, "dataAsOf": data_as_of, "estimated": estimated}, None


def _validate_resolution(resolution: Any) -> tuple[dict | None, dict | None]:
    if resolution is None:
        return None, None
    if not isinstance(resolution, dict):
        return None, _error("invalid_tool_result", "resolution")
    allowed = {"status", "field", "allowed", "candidates", "value"}
    if any(key not in allowed for key in resolution):
        return None, _error("invalid_tool_result", "resolution")
    if not _validate_json_value(resolution):
        return None, _error("invalid_tool_result", "resolution")
    return copy.deepcopy(resolution), None


def _valid_top_asins(data: dict) -> bool:
    """校验商家 Top ASIN 与同一快照的排序元数据。"""
    asins = data.get("topAsins")
    ranking = data.get("asinRanking")
    if not isinstance(asins, list) or len(asins) > 5:
        return False
    if any(not isinstance(asin, str) or not re.fullmatch(r"B[0-9A-Z]{9}", asin) for asin in asins):
        return False
    if len(set(asins)) != len(asins) or not isinstance(ranking, dict):
        return False
    fields = {"status", "basis", "limit", "returned", "startDate", "endDate", "dataAsOf", "version"}
    if set(ranking) != fields:
        return False
    if type(ranking["limit"]) is not int or ranking["limit"] != 5:
        return False
    if type(ranking["returned"]) is not int or ranking["returned"] != len(asins):
        return False
    if ranking["status"] not in ("available", "empty", "unavailable"):
        return False
    if (ranking["status"] == "available") != bool(asins):
        return False
    version = ranking["version"]
    if version is not None and (type(version) is not int or version < 1):
        return False
    basis = "period_revenue_desc_then_asin" if version in (1, 2, 3) else "unknown"
    if ranking["basis"] != basis:
        return False
    for field in ("startDate", "endDate"):
        value = ranking[field]
        if value is not None:
            if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                return False
            try:
                dt.date.fromisoformat(value)
            except ValueError:
                return False
    if ranking["startDate"] and ranking["endDate"] and ranking["startDate"] > ranking["endDate"]:
        return False
    as_of = ranking["dataAsOf"]
    if as_of is not None and (not isinstance(as_of, str) or not as_of or len(as_of) > 100):
        return False
    merchant = data.get("merchant")
    metrics = data.get("topAsinMetrics")
    if metrics is not None:
        if not isinstance(metrics, list) or len(metrics) != len(asins):
            return False
        for asin, row in zip(asins, metrics):
            if not isinstance(row, dict) or set(row) != {"asin", "periodRevenue"} or row["asin"] != asin:
                return False
            revenue = row["periodRevenue"]
            if revenue is not None and (type(revenue) not in (int, float) or not math.isfinite(revenue)):
                return False
    return (isinstance(merchant, dict) and set(merchant) == {"id", "name"}
            and isinstance(merchant["id"], str) and bool(re.fullmatch(r"\d+", merchant["id"]))
            and isinstance(merchant["name"], str) and bool(merchant["name"]))


def _normalize_keyword(value: str) -> str:
    folded = unicodedata.normalize("NFKD", value.lower().replace("&", " and "))
    without_marks = "".join(char for char in folded if not unicodedata.combining(char))
    return " ".join(re.findall(r"[a-z0-9\u4e00-\u9fff]+", without_marks))


def _validate_keyword_data(data: dict) -> bool:
    if "appliedFilters" in data and _validate_keyword_filters(data["appliedFilters"])[1]:
        return False
    for field in ("eligibleCount", "excludedMissingMetricsCount"):
        if field in data and (type(data[field]) is not int or data[field] < 0):
            return False
    if "matchSetComplete" in data and type(data["matchSetComplete"]) is not bool:
        return False
    rows = data.get("rows")
    if not isinstance(rows, list) or len(rows) > 20:
        return False
    if "partial" in data and not isinstance(data["partial"], bool):
        return False
    if "matchedKeyword" in data and (not isinstance(data["matchedKeyword"], str) or not 2 <= len(data["matchedKeyword"]) <= 120):
        return False
    if "matchType" in data and (data["matchType"] not in ("exact", "semantic") or "matchedKeyword" not in data):
        return False
    if "matchType" in data:
        keyword = data.get("keyword")
        if not isinstance(keyword, str) or not 2 <= len(keyword) <= 120:
            return False
        same_keyword = _normalize_keyword(keyword) == _normalize_keyword(data["matchedKeyword"])
        if (data["matchType"] == "exact") != same_keyword or (data["matchType"] == "semantic" and not rows):
            return False
    allowed = {"merchantId", "merchantName", "tier", "category", "matchedField", "matchedText", "rank", "ranked", "salesAmount", "orders", "aov", "affCommission", "conversionRate", "epc", "clicks"}
    text_limits = {"merchantId": 80, "merchantName": 120, "tier": 40, "category": 120, "matchedField": 40, "matchedText": 80}
    for row in rows:
        if not isinstance(row, dict) or not row or any(key not in allowed for key in row):
            return False
        if not all(isinstance(row.get(key), str) and 0 < len(row[key]) <= maximum for key, maximum in text_limits.items() if key in row):
            return False
        if not isinstance(row.get("merchantId"), str) or not isinstance(row.get("merchantName"), str):
            return False
        if "ranked" in row and not isinstance(row["ranked"], bool):
            return False
        if "rank" in row and (not isinstance(row["rank"], int) or isinstance(row["rank"], bool) or not 1 <= row["rank"] <= 20):
            return False
        for key in ("salesAmount", "orders", "aov", "affCommission", "conversionRate", "epc", "clicks"):
            if key in row and (isinstance(row[key], bool) or not isinstance(row[key], (int, float)) or not math.isfinite(row[key])):
                return False
    return True


def validate_tool_result(tool_name: str, result: object) -> tuple[dict | None, dict | None]:
    if tool_name not in _SPECS:
        return None, _error("unsupported_tool", "toolName")
    if not isinstance(result, dict):
        return None, _error("invalid_tool_result", "result")
    allowed_outer = {"ok", "data", "source", "errorCode", "resolution"}
    if any(key not in allowed_outer for key in result):
        return None, _error("invalid_tool_result", "result")
    if not isinstance(result.get("ok"), bool):
        return None, _error("invalid_tool_result", "ok")

    normalized: dict[str, Any] = {"ok": result["ok"]}
    source, source_error = _validate_source(result.get("source"))
    if source_error:
        return None, source_error
    normalized["source"] = source

    if result["ok"]:
        data = result.get("data", {})
        if not isinstance(data, dict):
            return None, _error("invalid_tool_result", "data")
        if tool_name == "promotion_analysis":
            data, data_error = validate_promotion_result(data)
            if data_error:
                return None, data_error
            normalized["data"] = data
            maximum = 18000
            try:
                encoded = json.dumps(normalized, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            except (TypeError, ValueError):
                return None, _error("invalid_tool_result", "result")
            if len(encoded) > maximum:
                return None, _error("invalid_tool_result", "result")
            return normalized, None
        field_names = set(AGENT_RESULT_FIELDS[tool_name])
        if any(key not in field_names or key in _UNSAFE_KEYS for key in data):
            return None, _error("invalid_tool_result", "data")
        if tool_name == "keyword_search" and not _validate_keyword_data(data):
            return None, _error("invalid_tool_result", "data")
        if not _validate_json_value(data):
            return None, _error("invalid_tool_result", "data")
        if tool_name == "merchant_analysis" and ("topAsins" in data or "asinRanking" in data):
            if not _valid_top_asins(data):
                return None, _error("invalid_tool_result", "data")
        normalized["data"] = copy.deepcopy(data)
    else:
        error_code = result.get("errorCode", "tool_error")
        if error_code not in _RESULT_ERROR_CODES:
            return None, _error("invalid_tool_result", "errorCode")
        normalized["errorCode"] = error_code
        resolution, resolution_error = _validate_resolution(result.get("resolution"))
        if resolution_error:
            return None, resolution_error
        if resolution is not None:
            normalized["resolution"] = resolution

    maximum = (
        AGENT_TIER_RESULT_MAX_BYTES
        if tool_name in {"tier_analysis", "asin_analysis", "keyword_search"}
        else AGENT_RESULT_MAX_BYTES
    )
    try:
        encoded = json.dumps(normalized, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    except (TypeError, ValueError):
        return None, _error("invalid_tool_result", "result")
    if len(encoded) > maximum:
        return None, _error("invalid_tool_result", "result")
    return normalized, None
