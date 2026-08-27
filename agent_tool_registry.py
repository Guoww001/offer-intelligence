"""Agent 服务端工具注册表和边界校验。

这个模块不访问数据库、不调用 Provider，也不信任浏览器传入的工具定义。
"""

from __future__ import annotations

import copy
import json
import math
import re
from typing import Any


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
)
AGENT_TIER_NAMES = ("Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER")
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
        "headline", "note",
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
}

_UNSAFE_KEYS = {"__proto__", "constructor", "prototype"}
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
            "description_zh": "查询单个商户的核心指标、分位、品类/Tier/全站对比、同行、付款风险和月度数据。",
            "description_en": "Get one merchant's core metrics, percentiles, category/Tier/global comparisons, peers, payment risk, and monthly data.",
            "parameters": {
                "type": "object",
                "properties": {"merchant": _text_property("商户名称或商户 ID。", "Merchant name or merchant ID.", 80)},
                "required": ["merchant"],
                "additionalProperties": False,
            },
            "argument_fields": ("merchant",),
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
            "description_zh": "查询商户、品类或 Tier 的月度趋势和逐月数据。",
            "description_en": "Get monthly trends and month-by-month data for a merchant, category, or Tier.",
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
        field_names = set(AGENT_RESULT_FIELDS[tool_name])
        if any(key not in field_names or key in _UNSAFE_KEYS for key in data):
            return None, _error("invalid_tool_result", "data")
        if not _validate_json_value(data):
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

    maximum = AGENT_TIER_RESULT_MAX_BYTES if tool_name == "tier_analysis" else AGENT_RESULT_MAX_BYTES
    try:
        encoded = json.dumps(normalized, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    except (TypeError, ValueError):
        return None, _error("invalid_tool_result", "result")
    if len(encoded) > maximum:
        return None, _error("invalid_tool_result", "result")
    return normalized, None
