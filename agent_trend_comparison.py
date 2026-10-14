"""从已绑定趋势结果计算共同完整月份，避免跨期间比较。"""
from __future__ import annotations

import math
import re
from datetime import datetime, timedelta, timezone


def format_agent_metric(key: str, value: float | None, language: str = "zh") -> str:
    """只格式化显示值；比例与变化百分数使用明确单位，不猜测单位。"""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return "Not provided" if language == "en" else "未提供"
    if key in {"conversionRate", "commissionRate"}:
        return f"{value * 100:.2f}%"
    if key == "changePercent":
        return f"{value:.2f}%"
    if key in {"orders", "clicks"}:
        return f"{value:,.0f}"
    return f"{value:,.3f}" if key == "epc" else f"{value:,.2f}"


def _source_month(item: dict) -> str | None:
    source = item.get("result", {}).get("source") or {}
    value = source.get("dataAsOf")
    if not isinstance(value, str):
        return None
    try:
        timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        business_zone = timezone(timedelta(hours=8))
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=business_zone)
        return timestamp.astimezone(business_zone).strftime("%Y-%m")
    except ValueError:
        return None


def _value(row: dict, field: str) -> float | None:
    metrics = row.get("metrics")
    value = metrics.get(field) if isinstance(metrics, dict) else None
    return value if not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value) else None


def _total(rows: list[dict], field: str) -> float | None:
    values = [_value(row, field) for row in rows]
    if not values or any(isinstance(value, bool) or not isinstance(value, (int, float))
                         or not math.isfinite(value) for value in values):
        return None
    total = sum(values)
    return total if math.isfinite(total) else None


def _metrics(rows: list[dict]) -> dict:
    metrics = {field: _total(rows, field) for field in ("revenue", "orders", "clicks", "commission")}
    clicks = metrics["clicks"]
    for ratio, numerator in (("conversionRate", "orders"), ("epc", "commission")):
        metrics[ratio] = metrics[numerator] / clicks if metrics[numerator] is not None and clicks is not None and clicks > 0 else None
    return metrics


def build_trend_comparison(results: list[dict]) -> dict | None:
    return _build_trend_summary(results, False, "zh")


def build_trend_summary(results: list[dict], language: str = "zh") -> dict | None:
    """单商户沿用共同完整月份算法，默认结论不使用未结束月份。"""
    return _build_trend_summary(results, True, language)


def _build_trend_summary(results: list[dict], allow_single: bool, language: str) -> dict | None:
    """只接受调用绑定后的结果；失败调用不覆盖成功结果，重试同目标取最后成功值。"""
    merchants = {}
    incomplete = set()
    for item in results:
        if item.get("toolName") != "trend" or item.get("arguments", {}).get("entityType", "merchant") != "merchant":
            continue
        result = item.get("result", {})
        data = result.get("data", {})
        if not result.get("ok") or data.get("entityType", "merchant") != "merchant":
            continue
        monthly = data.get("months")
        if not isinstance(monthly, list):
            continue
        rows = {row["month"]: row for row in monthly
                if isinstance(row, dict) and re.fullmatch(r"20\d{2}-(0[1-9]|1[0-2])", str(row.get("month", "")))}
        if not rows:
            continue
        target = data.get("target") if isinstance(data.get("target"), str) else item["arguments"]["target"]
        merchants[target] = (item, rows)
    if len(merchants) < (1 if allow_single else 2):
        return None
    unknown = set()
    complete_sets = {}
    for target, (item, rows) in merchants.items():
        data = item["result"]["data"]
        summary = data.get("summary")
        own_incomplete = set()
        own_unknown = set()
        if isinstance(summary, dict) and summary.get("latestMonthComplete") is False:
            own_incomplete.add(max(rows))
        source_month = _source_month(item)
        if source_month:
            own_incomplete.update(month for month in rows if month >= source_month)
        elif allow_single and not (isinstance(summary, dict) and isinstance(summary.get("latestMonthComplete"), bool)):
            own_unknown.update(rows)
        incomplete.update(own_incomplete)
        unknown.update(own_unknown)
        complete_sets[target] = set(rows) - own_incomplete - own_unknown
    common = set.intersection(*(set(rows) for _, rows in merchants.values()))
    months = sorted(common - incomplete - unknown)
    entities = []
    for target, (item, rows) in merchants.items():
        selected = [rows[month] for month in months]
        trends = {}
        for field in ("revenue", "orders", "conversionRate", "epc"):
            first = _value(selected[0], field) if selected else None
            latest = _value(selected[-1], field) if selected else None
            trends[field] = {"first": first, "latest": latest, "changePercent":
                             (latest - first) / first * 100 if len(selected) >= 2 and first is not None and first != 0 and latest is not None else None}
        entities.append({
            "target": target,
            "requestedMonths": item.get("arguments", {}).get("months", 12),
            "availableMonths": len(rows),
            "completeMonths": len(complete_sets[target]),
            "startMonth": min(rows),
            "endMonth": max(rows),
            "availablePeriodMetrics": _metrics(list(rows.values())),
            "includesIncompleteMonth": bool(set(rows) - complete_sets[target] - unknown),
            "commonCompleteMetrics": _metrics(selected),
            "commonCompleteTrends": trends,
            "availablePeriodMetricsDisplay": {key: format_agent_metric(key, value, language) for key, value in _metrics(list(rows.values())).items()},
            "commonCompleteMetricsDisplay": {key: format_agent_metric(key, value, language) for key, value in _metrics(selected).items()},
            "commonCompleteTrendsDisplay": {key: {name: format_agent_metric("changePercent" if name == "changePercent" else key, value, language) for name, value in trend.items()} for key, trend in trends.items()},
        })
    metric_leaders = {}
    for metric in ("revenue", "orders", "clicks", "commission", "conversionRate", "epc"):
        available = [(entity["target"], entity["commonCompleteMetrics"][metric]) for entity in entities
                     if entity["commonCompleteMetrics"][metric] is not None]
        leaders = {"highest": None, "lowest": None,
                   "availableTargets": [target for target, _ in available],
                   "unavailableTargets": [entity["target"] for entity in entities if entity["commonCompleteMetrics"][metric] is None]}
        if available:
            # 每个指标独立排名，保留并列；缺失不参与，不把其他指标顺序当作该指标顺序。
            for label, value in (("highest", max(value for _, value in available)),
                                 ("lowest", min(value for _, value in available))):
                leaders[label] = {"value": value, "display": format_agent_metric(metric, value, language),
                                  "targets": [target for target, candidate in available if candidate == value]}
        metric_leaders[metric] = leaders
    return {"months": months, "excludedIncompleteMonths": sorted(common & incomplete), "unknownCompleteMonths": sorted(common & unknown), "businessTimezone": "Asia/Shanghai", "entities": entities, "metricLeaders": metric_leaders}
