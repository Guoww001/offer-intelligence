"""从已绑定趋势结果计算共同完整月份，避免跨期间比较。"""
from __future__ import annotations

import math
import re


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
    if len(merchants) < 2:
        return None
    for item, rows in merchants.values():
        data = item["result"]["data"]
        summary = data.get("summary")
        if isinstance(summary, dict) and summary.get("latestMonthComplete") is False:
            incomplete.add(max(rows))
    common = set.intersection(*(set(rows) for _, rows in merchants.values()))
    months = sorted(common - incomplete)
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
            "startMonth": min(rows),
            "endMonth": max(rows),
            "availablePeriodMetrics": _metrics(list(rows.values())),
            "includesIncompleteMonth": bool(set(rows) & incomplete),
            "commonCompleteMetrics": _metrics(selected),
            "commonCompleteTrends": trends,
        })
    return {"months": months, "excludedIncompleteMonths": sorted(common & incomplete), "entities": entities}
