"""根据已完成证明校验的月度事实生成明细，避免模型改写缺失值和环比。"""
from __future__ import annotations

import math
import re


def _cell(value: object) -> str:
    return str(value or "").replace("|", "\\|").replace("\n", " ").replace("\r", " ")[:180]


def verified_monthly_answer(request: dict, results: list[dict]) -> str | None:
    question = str(request.get("question") or "")
    cue = r"按月|逐月|月份|环比|订单.*新增|month.by.month|monthly|\bMoM\b"
    requested = bool(re.search(cue, question, re.I))
    context = request.get("context") or {}
    if not requested and re.search(r"上述|接下来|接着|试试|看看|同一期间", question):
        requested = any(item.get("role") == "user" and re.search(cue, str(item.get("content") or ""), re.I)
                        for item in context.get("history", []) if isinstance(item, dict))
    if not requested:
        return None
    zh = request.get("language", "zh") == "zh"
    keys = ["revenue", "revenueMoM", "clicks", "clicksMoM", "orders", "ordersDelta", "conversionRate"]
    headings = ["GMV", "GMV 环比", "点击量", "点击环比", "订单量", "订单环比新增", "转化率"] if zh else ["GMV", "GMV MoM", "Clicks", "Clicks MoM", "Orders", "Order change", "CVR"]
    def value(key: str, raw: object) -> str:
        if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not math.isfinite(raw):
            return "未提供" if zh else "Not provided"
        if key in {"revenueMoM", "clicksMoM", "conversionRate"}:
            return f"{raw * 100:,.2f}%"
        return f"{raw:,.0f}" if key in {"clicks", "orders", "ordersDelta"} else f"{raw:,.2f}"
    sections = []
    for item in results:
        result = item.get("result") or {}
        data = result.get("data") or {}
        if item.get("toolName") != "trend" or result.get("ok") is not True or not isinstance(data, dict):
            continue
        monthly = data.get("months")
        rows = [row for row in monthly if isinstance(row, dict) and isinstance(row.get("metrics"), dict)] if isinstance(monthly, list) else []
        if not rows:
            continue
        rows.sort(key=lambda row: str(row.get("month", "")))
        target = _cell(data.get("target"))
        period = f"{_cell(rows[0].get('month'))}—{_cell(rows[-1].get('month'))}"
        lines = [f"{target}｜{period}", "", "| " + " | ".join(["月份" if zh else "Month", *headings]) + " |", "| " + " | ".join(["---"] + ["---:"] * len(keys)) + " |"]
        for row in rows:
            lines.append("| " + " | ".join([_cell(row.get("month")), *(value(key, row["metrics"].get(key)) for key in keys)]) + " |")
        lines += ["", "环比采用相邻月份及有效基期；缺失不补零，转化率仅引用已提供值。" if zh else "Changes use adjacent months and valid baselines. Missing values are not zero; CVR uses supplied values only."]
        if re.search(r"站点|币种|currency|marketplace", question, re.I):
            lines.append("站点和币种：未提供，金额保留来源数值。" if zh else "Marketplace and currency: not provided. Amounts retain source values.")
        summary = data.get("summary") if isinstance(data.get("summary"), dict) else {}
        if summary.get("latestMonthComplete") is False:
            lines.append("最新月份尚未结束，不能直接与完整月份比较。" if zh else "The latest month is incomplete and cannot be directly compared with complete months.")
        sections.append("\n".join(lines))
    if not sections:
        return None
    if any((item.get("result") or {}).get("ok") is not True for item in results):
        sections.append("部分查询未完成，以上仅展示已取得的数据。" if zh else "Some queries did not complete; only available results are shown.")
    return "\n\n".join(sections)
