"""推广分析工具的附件上下文、范围和结果投影校验。"""

from __future__ import annotations

import copy
import json
import math
import re
from datetime import date, timedelta
from typing import Any


PROMOTION_VIEWS = ("file", "merchants", "merchant_media", "publishers", "links", "history", "categories")
PROMOTION_METRICS = ("revenue", "clicks", "dpv", "atc", "orders", "commission")
PROMOTION_SORTS = ("after", "before", "delta", "change")
PROMOTION_DIRECTIONS = ("asc", "desc")
PROMOTION_MAX_MERCHANTS = 200
PROMOTION_MAX_ROWS = 25
PROMOTION_RESULT_MAX_BYTES = 18000
_MERCHANT_ID_PATTERN = re.compile(r"^[1-9]\d{0,12}$")
_DATE_PATTERN = re.compile(r"^20\d{2}-\d{2}-\d{2}$")
_MEDIA_COUNT_PATTERN = re.compile(
    r"(?:媒体|media|publisher|publishers).{0,20}(?:数量|数|多少|更多|最多|排名|count|number|more|most|ranking|top\s*\d+)"
    r"|(?:数量|数|多少|更多|最多|排名|count|number|more|most|ranking|top\s*\d+).{0,20}(?:媒体|media|publisher|publishers)",
    re.I,
)
_MEDIA_COUNT_LIMIT_PATTERN = re.compile(r"(?:前\s*|top\s*)(\d{1,3})", re.I)
_UNSAFE_KEYS = {"__proto__", "constructor", "prototype"}
_CONTEXT_KEYS = {"attachmentId", "fileName", "merchantCount", "merchants", "window"}
_WINDOW_KEYS = {"launchDate", "startDate", "endDate", "beforeStart", "beforeEnd", "days"}
_ARGUMENT_KEYS = {
    "attachmentId", "view", "merchantIds", "window", "metric", "sortBy", "direction", "offset", "limit"
}
PROMOTION_RESULT_FIELDS = {
    "view", "metric", "attachmentId", "fileName", "merchantCount", "window", "totalRows", "offset", "limit",
    "returned", "nextOffset", "hasMore", "rows", "evidenceOrigin", "availableThrough", "generatedAt", "clickSource",
    "supported", "dateRange", "aggregates", "headline", "note",
}


def requested_merchant_media_limit(question: str) -> int | None:
    """识别明确的按商家统计媒体数量问题，并提取安全的分页上限。"""
    if not isinstance(question, str) or not _MEDIA_COUNT_PATTERN.search(question):
        return None
    match = _MEDIA_COUNT_LIMIT_PATTERN.search(question)
    if not match:
        return PROMOTION_MAX_ROWS
    return max(1, min(PROMOTION_MAX_ROWS, int(match.group(1))))


def _error(error_code: str, field: str, status: int = 400) -> dict[str, Any]:
    return {"status": status, "errorCode": error_code, "field": field}


def _string(value: Any, field: str, maximum: int) -> tuple[str | None, dict | None]:
    if not isinstance(value, str):
        return None, _error("invalid_arguments", field)
    value = value.strip()
    if not value or len(value) > maximum:
        return None, _error("invalid_arguments", field)
    return value, None


def _date(value: Any, field: str) -> tuple[str | None, dict | None]:
    cleaned, error = _string(value, field, 10)
    if error or not _DATE_PATTERN.fullmatch(cleaned or ""):
        return None, _error("invalid_arguments", field)
    try:
        date.fromisoformat(cleaned or "")
    except ValueError:
        return None, _error("invalid_arguments", field)
    return cleaned, None


def _integer(value: Any, field: str, minimum: int, maximum: int) -> tuple[int | None, dict | None]:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum or value > maximum:
        return None, _error("invalid_arguments", field)
    return value, None


def _window(value: Any, field: str = "window") -> tuple[dict | None, dict | None]:
    if value is None:
        return None, None
    if not isinstance(value, dict) or set(value) != _WINDOW_KEYS:
        return None, _error("invalid_arguments", field)
    cleaned: dict[str, Any] = {}
    for key in ("launchDate", "startDate", "endDate", "beforeStart", "beforeEnd"):
        parsed, error = _date(value.get(key), f"{field}.{key}")
        if error:
            return None, error
        cleaned[key] = parsed
    days, error = _integer(value.get("days"), f"{field}.days", 1, 92)
    if error:
        return None, error
    cleaned["days"] = days
    start = date.fromisoformat(cleaned["startDate"])
    launch = date.fromisoformat(cleaned["launchDate"])
    end = date.fromisoformat(cleaned["endDate"])
    before_start = date.fromisoformat(cleaned["beforeStart"])
    before_end = date.fromisoformat(cleaned["beforeEnd"])
    if (
        cleaned["startDate"] > cleaned["endDate"]
        or start < launch
        or cleaned["beforeStart"] > cleaned["beforeEnd"]
        or (end - start).days + 1 != days
        or before_end != launch - timedelta(days=1)
        or before_start != launch - timedelta(days=days)
    ):
        return None, _error("invalid_arguments", field)
    return cleaned, None


def validate_promotion_context(value: Any) -> tuple[dict | None, dict | None]:
    if value is None:
        return None, None
    if not isinstance(value, dict) or set(value) != _CONTEXT_KEYS:
        return None, _error("invalid_agent_contract", "promotionContext")
    attachment_id, error = _string(value.get("attachmentId"), "promotionContext.attachmentId", 128)
    if error:
        return None, error
    file_name, error = _string(value.get("fileName"), "promotionContext.fileName", 160)
    if error:
        return None, error
    merchant_count, error = _integer(value.get("merchantCount"), "promotionContext.merchantCount", 1, PROMOTION_MAX_MERCHANTS)
    if error:
        return None, error
    raw_merchants = value.get("merchants")
    if not isinstance(raw_merchants, list) or len(raw_merchants) != merchant_count or len(raw_merchants) > PROMOTION_MAX_MERCHANTS:
        return None, _error("invalid_agent_contract", "promotionContext.merchants")
    merchants = []
    seen = set()
    for item in raw_merchants:
        if not isinstance(item, dict) or set(item) != {"merchantId", "merchantName"}:
            return None, _error("invalid_agent_contract", "promotionContext.merchants")
        merchant_id, error = _string(item.get("merchantId"), "promotionContext.merchants.merchantId", 13)
        if error or not _MERCHANT_ID_PATTERN.fullmatch(merchant_id or "") or merchant_id in seen:
            return None, _error("invalid_agent_contract", "promotionContext.merchants.merchantId")
        merchant_name, error = _string(item.get("merchantName"), "promotionContext.merchants.merchantName", 160)
        if error:
            return None, error
        seen.add(merchant_id)
        merchants.append({"merchantId": merchant_id, "merchantName": merchant_name})
    window, error = _window(value.get("window"), "promotionContext.window")
    if error:
        return None, error
    return {
        "attachmentId": attachment_id,
        "fileName": file_name,
        "merchantCount": merchant_count,
        "merchants": merchants,
        "window": window,
    }, None


def _merchant_ids(value: Any, context: dict | None) -> tuple[list[str] | None, dict | None]:
    if value is None:
        if context is None:
            return [], None
        return [item["merchantId"] for item in context["merchants"]], None
    if not isinstance(value, list) or not 1 <= len(value) <= PROMOTION_MAX_MERCHANTS:
        return None, _error("invalid_arguments", "merchantIds")
    cleaned = []
    seen = set()
    allowed = {item["merchantId"] for item in context["merchants"]} if context else None
    for item in value:
        merchant_id, error = _string(item, "merchantIds", 13)
        if error or not _MERCHANT_ID_PATTERN.fullmatch(merchant_id or "") or merchant_id in seen:
            return None, _error("invalid_arguments", "merchantIds")
        if allowed is not None and merchant_id not in allowed:
            return None, _error("invalid_filter", "merchantIds")
        seen.add(merchant_id)
        cleaned.append(merchant_id)
    return cleaned, None


def validate_promotion_arguments(value: Any, context: dict | None = None) -> tuple[dict | None, dict | None]:
    if not isinstance(value, dict) or any(key not in _ARGUMENT_KEYS or key in _UNSAFE_KEYS for key in value):
        return None, _error("invalid_arguments", "arguments")
    attachment_id, error = _string(value.get("attachmentId"), "attachmentId", 128)
    if error:
        return None, error
    view, error = _string(value.get("view"), "view", 20)
    if error or view not in PROMOTION_VIEWS:
        return None, _error("invalid_arguments", "view")
    if context is not None and attachment_id != context["attachmentId"]:
        return None, _error("invalid_filter", "attachmentId")
    merchant_ids, error = _merchant_ids(value.get("merchantIds"), context)
    if error:
        return None, error
    window_value = value.get("window") if "window" in value else (context.get("window") if context else None)
    window, error = _window(window_value)
    if error:
        return None, error
    if context and context.get("window") and window and window != context["window"]:
        return None, _error("invalid_filter", "window")
    if view != "file" and window is None:
        return None, _error("invalid_filter", "window")
    metric = value.get("metric", "revenue")
    if metric not in PROMOTION_METRICS:
        return None, _error("invalid_arguments", "metric")
    sort_by = value.get("sortBy", "after")
    if sort_by not in PROMOTION_SORTS:
        return None, _error("invalid_arguments", "sortBy")
    direction = value.get("direction", "desc")
    if direction not in PROMOTION_DIRECTIONS:
        return None, _error("invalid_arguments", "direction")
    offset, error = _integer(value.get("offset", 0), "offset", 0, 10000)
    if error:
        return None, error
    limit, error = _integer(value.get("limit", PROMOTION_MAX_ROWS), "limit", 1, PROMOTION_MAX_ROWS)
    if error:
        return None, error
    return {
        "attachmentId": attachment_id,
        "view": view,
        "merchantIds": merchant_ids,
        "window": window,
        "metric": metric,
        "sortBy": sort_by,
        "direction": direction,
        "offset": offset,
        "limit": limit,
    }, None


def _safe_json(value: Any, depth: int = 0) -> bool:
    if depth > 5:
        return False
    if value is None or isinstance(value, bool):
        return True
    if isinstance(value, (int, float)):
        return not isinstance(value, float) or math.isfinite(value)
    if isinstance(value, str):
        return len(value) <= 1000
    if isinstance(value, list):
        return len(value) <= 100 and all(_safe_json(item, depth + 1) for item in value)
    if isinstance(value, dict):
        return all(isinstance(key, str) and key not in _UNSAFE_KEYS and len(key) <= 1000 and _safe_json(item, depth + 1) for key, item in value.items())
    return False


def validate_promotion_result(value: Any) -> tuple[dict | None, dict | None]:
    if not isinstance(value, dict) or any(key not in PROMOTION_RESULT_FIELDS or key in _UNSAFE_KEYS for key in value):
        return None, _error("invalid_tool_result", "data")
    if value.get("view") not in PROMOTION_VIEWS:
        return None, _error("invalid_tool_result", "data.view")
    if value.get("evidenceOrigin") not in {"file", "database"}:
        return None, _error("invalid_tool_result", "data.evidenceOrigin")
    if not _safe_json(value):
        return None, _error("invalid_tool_result", "data")
    try:
        if len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > PROMOTION_RESULT_MAX_BYTES:
            return None, _error("invalid_tool_result", "result")
    except (TypeError, ValueError):
        return None, _error("invalid_tool_result", "result")
    return copy.deepcopy(value), None
