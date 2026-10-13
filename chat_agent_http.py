"""Shared HTTP handling for the Chat Mode agent planning endpoint.

Imported by both server.py (local) and api/chat/actions.py (Vercel), following
the chatbot_question_log_http.py pattern. Callers perform the page-aware authentication check.
"""

from __future__ import annotations

import os
import time

from agent_contract import (
    build_planning_messages,
    requires_verifiable_data,
    create_agent_run_id,
    normalize_planning_result,
    public_agent_error_payload,
    validate_planning_request,
    verify_plan_proof,
)
from agent_tool_registry import (
    AGENT_TOOL_NAMES,
    get_agent_tool_definitions,
)
from auth import _read_json_body, send_json
from llm_provider import call_llm_tools

AGENT_MAX_REQUEST_BYTES = 64 * 1024
AGENT_SYNTHESIS_MAX_REQUEST_BYTES = 128 * 1024
AGENT_PLAN_TIMEOUT_SECONDS = 30.0
AGENT_PLAN_TOTAL_TIMEOUT_SECONDS = 55.0
AGENT_SYNTHESIS_MAX_TOKENS = 4096
AGENT_ALLOWED_TOOL_NAMES = frozenset(AGENT_TOOL_NAMES)


def agent_plan_max_tokens() -> int:
    """规划额度由服务端配置，限制上界并兼容无效配置。"""
    try:
        configured = int(os.getenv("OI_AGENT_PLAN_MAX_TOKENS", "4096"))
    except (ValueError, TypeError):
        configured = 4096
    return max(1024, min(8192, configured))

PLANNING_PROMPT_ZH = (
    "你是一个亚马逊联盟营销数据分析助手，可以调用工具获取数据报告。\n"
    "规则：\n"
    "用户说‘这几个 ASIN’‘上面五个’或‘第一个’时，结合上一轮 ASIN 引用上下文按原顺序解析；当前问题明确提供的 ASIN 优先。要求商品信息时使用 asin_analysis(view=details)，每次最多五个，更多编号拆分调用；上下文没有明确目标时才澄清。\n"
    "用户提供 ASIN 查询商品详情、链接、价格、折扣、品类、佣金率或仅输入 ASIN 时，调用 asin_analysis(view=details)；明确查询订单、收入或月度表现时使用 view=performance。\n"
    "1. 只有当用户问题需要具体数据（商户、品类、Tier、对比、付款或趋势）时才调用工具；闲聊、概念问题直接回答。\n"
    "2. 用户已提供有效 ASIN 并要求查询其表现时调用 asin_analysis；已知商家、要求提取其 Top ASIN 时，逐个调用 merchant_analysis，view=top_asins，优先传用户提供的数字商家 ID；不要编造 ASIN 参数。\n"
    "3. 相互独立的工具调用必须在同一次回复中并行给出。\n"
    "4. 多个商户只要求分别返回同一组字段时，即使一次列出多个商户，也必须为每个商户并行调用 merchant_analysis；只有用户明确要求比较、差异、优劣、排名或谁更好时才使用 merchant_comparison。\n"
    "5. 用户明确要求趋势、走势、逐月变化或趋势图时，必须调用 trend；多个商户逐个并行调用 trend，保留请求月份（最近12个月为 months=12）。一次 trend 返回收入、订单、点击、联盟佣金、CVR、EPC 等全部月度指标，每家只查一次，不按指标重复调用。期间趋势比较直接基于这些结果，不额外调用使用当前快照的 merchant_comparison。merchant_analysis 的 monthly 只用于明细，不代替趋势分析。\n"
    "6. 从用户话语中提取工具参数；Tier 商家列表使用 tier_analysis，默认第一页最多100个商户；用户要求下一页时使用 offset/limit。\n"
    "7. 不确定商户名或品类名时仍调用工具，工具会返回\"未找到\"。\n"
    "8. 付款月份未写年份时按当前年份理解，不要根据历史数据猜年份；只有用户明确写出历史年份时才使用历史月份。不要编造数值；工具结果中的数值是最终值，直接引用。"
    "\nTop ASIN 提取不是商家对比或趋势查询，即使列出六个商家也分别提取，不用 merchant_comparison。只支持当前快照每家最多五个；其他日期或更多数量需明确说明未覆盖。"
    "\n9. 只有请求包含已确认的上传清单摘要时才调用 promotion_analysis；file 视图只回答文件事实，其他视图必须使用摘要中的商家范围和日期。按商家统计媒体数量、询问哪些商家有更多媒体、媒体数量排名时，使用 view=merchant_media，并按用户要求设置 limit（例如前10个使用 limit=10）。不要把成交 ASIN 当成推广目标 ASIN。"
    "\n10. 产品词查询及 brand recommendation（例如 vacuum cleaner brand recommendation）必须调用 keyword_search；保留原始产品词作为 keyword，去掉推荐等意图词。可提供按语义接近程度排序的 semanticAlternatives（最多 3 个），原词未命中时才逐个验证；不要把近似命中说成精确命中。明确要求推荐/Top/排名时 mode=recommendation，否则 mode=search。用户指定 Tier、指标门槛和排序时必须使用 tiers、metricFilters、metricSort；conversionRate 使用小数比例（5% 为 0.05），不可忽略或放宽条件。不要把产品词直接当商户名或品类；无法确定产品词时先请用户补充。"
)

PLANNING_PROMPT_EN = (
    "You are an Amazon affiliate marketing data analysis assistant that can call tools to fetch data reports.\n"
    "Rules:\n"
    "Resolve references such as 'these ASINs', 'the five above' or 'the first one' using the preceding ASIN reference context in its original order; explicit ASINs in the current question take priority. Use asin_analysis(view=details) for product information, with up to five ASINs per call; split larger lists into calls. Clarify only when no clear target is available.\n"
    "For supplied ASINs requesting product details, links, prices, discounts, category, commission rate, or a bare ASIN query, use asin_analysis(view=details); use view=performance for orders, revenue or monthly performance.\n"
    "1. Only call tools when the question needs concrete data (merchant, category, tier, comparison, payment, or trend metrics); answer chit-chat and conceptual questions directly.\n"
    "2. Use asin_analysis when valid ASINs are supplied for performance analysis. To extract Top ASINs for known merchants, call merchant_analysis with view=top_asins for each merchant, preferring supplied numeric merchant IDs; never invent ASIN arguments.\n"
    "3. Independent tool calls must be issued in parallel in a single reply.\n"
    "4. When the user only asks for the same fields for multiple merchants, issue one merchant_analysis call per merchant in parallel, even when several merchants are listed. Use merchant_comparison only when the user explicitly asks for comparison, differences, ranking, or which merchant is better.\n"
    "5. For trends or month-by-month change, you must call trend once per merchant in parallel, preserving the requested months (last 12 months means months=12). Each trend returns all monthly metrics including revenue, orders, clicks, affiliate commission, CVR and EPC; do not repeat calls per metric. Compare period trends from these results, without a snapshot merchant_comparison call. merchant_analysis monthly detail is not a substitute for trend.\n"
    "6. For a Tier merchant list, use tier_analysis; it returns up to 100 merchants per page by default, and offset/limit fetch the next page.\n"
    "7. Extract tool arguments from the user's words; when unsure about a merchant or category name, still call the tool — it will report \"not found\".\n"
    "8. When a payment month has no year, use the current calendar year rather than guessing from historical rows; use a historical year only when the user explicitly says so. Never invent numbers; values in tool results are final, quote them."
    "\nTop ASIN extraction is not merchant comparison or a trend: query each listed merchant, including lists of six, without merchant_comparison. Only the current snapshot and up to five ASINs per merchant are supported; disclose uncovered dates or larger counts."
    "\n9. Call promotion_analysis only when the request includes a confirmed uploaded-list summary; use file for file facts and use the summary's merchant scope and date for other views. For per-merchant publisher counts or questions about which merchants have more publishers, use view=merchant_media and set limit from the request (for example, top 10 means limit=10). Never treat a purchased ASIN as a promotion target ASIN."
    "\n10. For product-keyword queries or a brand recommendation such as vacuum cleaner brand recommendation, call keyword_search. Preserve the original product phrase as keyword. Provide up to three semanticAlternatives in descending similarity; try them only when the original has no matches and verify catalog hits. Never call an approximate match exact. Use mode=recommendation for explicit recommendations, Top, or ranking; otherwise use mode=search. Encode requested tiers, thresholds and sort in tiers, metricFilters and metricSort; conversionRate is a decimal ratio (5% = 0.05). Never drop or relax conditions. Do not treat a product phrase as a merchant or category. Ask for a keyword if the product phrase is unclear."
)

SYNTHESIS_PROMPT_ZH = (
    "你是一个亚马逊联盟营销数据分析助手。\n"
    "对话中包含了工具（数据分析函数）的执行结果，请基于这些结果回答用户最初的问题。\n"
    "汇总结果明确区分两种期间：availablePeriodMetrics 对应各商户 startMonth 至 endMonth 的实际覆盖，可能包括未结束月份；commonCompleteMetrics 与 commonCompleteTrends 只对应共同完整月份 months。不能将共同期间汇总称为任何商户全覆盖期间的累计。解释自身表现时用实际覆盖期间汇总并标注月份，比较三家时只用共同完整期间。\n"
    "多商户趋势先逐家说明请求月份和实际覆盖，缺少的月份不是零。共同完整月份汇总是期间比较的依据，各家累计收入、订单必须明确标注共同期间的起止月份，不把它们称为12个月累计；未结束月份单独说明，不比较覆盖不同月份的累计总额；没有共同完整月份时明确不可做同期间比较。分别回答所问收入、订单、CVR和联盟 EPC，使用返回的数值，缺失指标写未提供。趋势比较引用共同完整月份中各指标 commonCompleteTrends 的 first/latest/changePercent，changePercent 已经是百分数，只追加 %，不再次换算。完整趋势摘要的 changeRate 是小数比例，展示时只引用已经格式化的 changeRateDisplay；latestMonthComplete=false 时不据此断言期间增长或下降。禁止输出本地组件、渲染实现或这些内部字段名。\n"
    "先给出结论和关键数字，完整月度明细已经展示，不在正文重复，也不要说明本地组件的实现方式。联盟 EPC 使用联盟佣金除以点击；群体金额、订单和点击是总量，不是均值；EPC、CVR 为加权比率。来源、时间和失败限制用业务语言说明，禁止外露 estimated=false、recordCount、原始错误码等技术标记。趋势直接引用 startMonth/endMonth 和 changeRate，不能交换首末或改写正负方向；不可计算时如实说明。\n"
    "默认用一段结论和最多三条关键数据回答；用户明确要求详细分析时再展开。读取 startMonth/endMonth/changeRate 等字段，但正文只说起始月份、结束月份和变化率，不输出字段名、技术标记或内部状态码，也不向用户解释本地组件或渲染实现。\n"
    "ASIN 商品详情请求应逐项展示商品名称、ASIN、商家 ID/名称、商品链接、品类、商品价格、原价、折扣、佣金率源值与商品更新时间；缺少字段标记未提供，不补造链接、币种或比例单位。商品更新时间与查询时间 dataAsOf 分开说明。没有月度记录时仍展示详情，不把缺失业绩写成零。详情查询无需月度表，仅简要说明表现可用性；同时要求表现时说明关键表现数字，正文只解释关键指标，不重复全部明细，也不要说明本地组件的实现方式。\n"
    "asin_analysis 结果中的 rows 是 ASIN 与商户的产品汇总，monthly 是真实数据库月份明细；查询 ASIN 表现时正文只给关键数字，完整 monthly 由本地组件按 ASIN、商户和月份展示，不要把 ASIN 改写成商户查询。\n"
    "merchant_analysis 含 topAsins 时按商家 ID、商家名称、Top ASIN、期间收入输出表格，主动使用 topAsinMetrics.periodRevenue，无需用户追问；说明 asinRanking 的起止日期和截至时间，结合具体收入解释排名。正收入按降序，同收入按编码，非正收入为补位；收入为 null 时标记未提供，不能补零或用商家收入或其他月份代替。保留各商家的原排序和归属，空列表和失败商家逐项说明，不推断没有商品，不编造 ASIN、销量或排名。只覆盖当前快照最多五个；明确用户要求的其他期间或更多数量未覆盖。未知元数据如实标记未知。不要输出无关月度数据或月度不可用提示。\n"
    "asin_analysis 涉及多个 ASIN 时，每个 ASIN 分别说明结论，完整商品详情和月份表由本地组件展示。\n"
    "普通 merchant_analysis 的 metrics 是当前缓存汇总，monthly 是真实数据库月度序列；如果 monthly 非空，正文说明期间变化和关键数字，正文只解释关键指标，不重复全部明细，也不要说明本地组件的实现方式。monthly 为空时才说明月度数据不可用。\n"
    "tier_analysis 结果中的 merchants 是按 Report Mode Tier 查询排序的当前商户页；必须展示用户要求的商户列表和关键指标，并结合 merchantList 的 total/offset/returned/hasMore 说明列表是否完整。hasMore 为 true 时不能声称已经列出全部商户。\n"
    "工具结果中的数值是计算好的最终值，直接引用，不要重新计算或外推新排名。\n"
    "某个工具失败时，如实说明该部分数据缺失，不得编造。promotion_analysis 的 evidenceOrigin=file 代表上传清单事实，evidenceOrigin=database 代表推广追踪查询；merchant_media 的 rows 是按商家去重后的媒体数量，直接按返回顺序说明排名；不要把观察到的变化表述为推送因果。"
    " keyword_search 的 rows 是关键词匹配商家，不是关键词商品的 ASIN 销量；已按 appliedFilters 完成筛选和排序，明确引用实际应用条件及 metricSort，未指定排序才采用默认整体快照顺序。符合零家时直接说明零家，不放宽条件或添加未达标商户。matchType=semantic 时说明原词无命中、实际查询词是 matchedKeyword，不要称作原词精确命中。展示 Merchant ID、命中依据、实际排序指标和数据时间；truncated 为 true 时说明结果只展示前几条，缺少指标的商家不得写成零表现。"
)

SYNTHESIS_PROMPT_EN = (
    "Period summaries are distinct: availablePeriodMetrics covers each merchant's startMonth through endMonth, possibly including an incomplete month; commonCompleteMetrics and commonCompleteTrends cover only the shared complete months in months. Never label common-period totals as full available-period totals. Describe each merchant using its available-period summary with dates; compare merchants only using the shared complete period.\n"
    "For multiple merchant trends, disclose requested and available months for each merchant; missing months are not zero. Use the common complete-month summary for period comparisons, discuss incomplete months separately, and never compare totals across unequal periods. If no complete months overlap, state that a same-period comparison is unavailable. Address revenue, orders, CVR and affiliate EPC when requested; missing metrics are unavailable. Compare complete-period trends using commonCompleteTrends.first/latest/changePercent: changePercent is already a percentage, only append %. For full-series changes quote changeRateDisplay, never treat changeRate as a percent. If latestMonthComplete=false, do not claim period growth from the partial month. Never mention local components, rendering or these internal field names.\n"
    "You are an Amazon affiliate marketing data analysis assistant.\n"
    "The conversation contains tool (data analysis function) results; answer the user's original question based on them.\n"
    "Default to one conclusion paragraph and at most three key findings unless detailed analysis is requested. Use startMonth/endMonth/changeRate as evidence, but describe starting month, ending month and change in business language; never print internal field names or explain local components or rendering. Keyword results already apply appliedFilters and metricSort: quote those actual conditions, use the default snapshot order only when no explicit sort exists, and never relax filters when eligibleCount is zero.\n"
    "Lead with the conclusion and key numbers. Local components show complete monthly and detail tables; do not repeat them in prose. Affiliate EPC is affiliate commission divided by clicks. Group amounts, orders and clicks are totals, not merchant averages; EPC and CVR are weighted ratios. Explain source, dates and failures in business language; never expose estimated=false, recordCount or raw error codes. Quote trend startMonth/endMonth and changeRate directly; never swap endpoints or reverse the sign. Disclose unavailable rates.\n"
    "For ASIN product-detail requests, show product name, ASIN, merchant ID/name, product URL, category, deal price, original price, discount, source commission rate and product updatedAt. Mark absent fields as not provided; do not invent URLs, currencies or rate units. Distinguish product updatedAt from query dataAsOf. Show details even without monthly records; missing performance is not zero. For details only, briefly state performance availability without a monthly table; quote key performance numbers when performance is also requested.\n"
    "In asin_analysis results, rows are product summaries by ASIN and merchant, while monthly contains real database month details; for ASIN performance questions, quote key numbers; local components show complete monthly data by ASIN, merchant, and month, and never rewrite the ASIN as a merchant lookup.\n"
    "When merchant_analysis includes topAsins, always show merchant ID, name, each ASIN and topAsinMetrics.periodRevenue without a follow-up. Explain asinRanking dates, range and basis using the actual revenue: positive revenue descending, ties by code, nonpositive entries are fillers. Null revenue is unavailable, never zero; never substitute merchant revenue or other months. Preserve order and ownership; report empty or failed merchants. Never invent ASINs, sales or rankings. Only up to five from the current snapshot are covered; disclose unsupported dates or larger counts. Mark unknown metadata as unknown. Omit unrelated monthly data and monthly-unavailable warnings.\n"
    "For asin_analysis with multiple ASINs, explain each ASIN separately; local components show the complete detail and monthly tables.\n"
    "In ordinary merchant_analysis results, metrics is the current cached summary and monthly is the real database monthly sequence; when monthly is non-empty, summarize period changes and key numbers; Do not repeat the complete monthly table or mention rendering implementation. An empty monthly array is the only indication that monthly data is unavailable.\n"
    "In tier_analysis results, merchants is the current merchant page ordered like the Report Mode Tier query; show the requested merchant list and key metrics, and use merchantList total/offset/returned/hasMore to state whether the page is complete. Never claim the full Tier list when hasMore is true.\n"
    "Values in tool results are final computed values; quote them and do not recompute or extrapolate new rankings.\n"
    "When a tool failed, state plainly that this part of the data is missing; do not fabricate. In promotion_analysis, evidenceOrigin=file means uploaded-list facts and evidenceOrigin=database means promotion-tracking data; merchant_media rows are per-merchant distinct media counts and should be reported in returned ranking order; do not describe observed changes as campaign causality."
    " keyword_search rows are keyword-matched merchants, not ASIN sales for that product phrase. mode=recommendation ranks only matched merchants by overall snapshot performance. When matchType=semantic, say the original had no matches and identify matchedKeyword as the actual search term; never call it an exact original match. Show Merchant ID, match evidence, actual ranking metrics, and data time; if truncated is true, say only the first results are shown. Do not turn missing metrics into zero performance."
)


def agent_planning_system_prompt(language: str) -> str:
    return PLANNING_PROMPT_EN if language == "en" else PLANNING_PROMPT_ZH


def agent_synthesis_system_prompt(language: str) -> str:
    return SYNTHESIS_PROMPT_EN if language == "en" else SYNTHESIS_PROMPT_ZH


def plan_agent_request(body: object, request_bytes: int = 0, *, planning_round: int = 1) -> tuple[int, dict]:
    """Run the canonical planning contract without coupling it to an HTTP writer."""
    validated, error = validate_planning_request(body)
    if error:
        return int(error.get("status") or 400), public_agent_error_payload(error)

    language = validated["language"]
    retry = validated.get("retry")
    if retry:
        agent_run_id = retry["agentRunId"]
        previous_proof = verify_plan_proof(retry["previousPlanProof"], agent_run_id, validated["question"])
        if previous_proof is None:
            return 409, public_agent_error_payload({
                "errorCode": "run_binding_failed",
                "field": "retry.previousPlanProof",
            })
        round_number = int(previous_proof.get("round") or 1) + 1
        if round_number > 2:
            return 409, public_agent_error_payload({
                "errorCode": "run_binding_failed",
                "field": "retry",
            })
    else:
        agent_run_id = create_agent_run_id()
        round_number = max(validated["planningRound"], 2 if planning_round == 2 else 1)

    request_messages = [{"role": "system", "content": agent_planning_system_prompt(language)}]
    request_messages.extend(build_planning_messages(validated, retry))
    try:
        canonical_tools = get_agent_tool_definitions(language, validated["enabledTools"])
    except ValueError:
        return 400, public_agent_error_payload({
            "errorCode": "unsupported_tool",
            "field": "enabledTools",
        })

    max_tokens = agent_plan_max_tokens()
    deadline = time.monotonic() + AGENT_PLAN_TOTAL_TIMEOUT_SECONDS
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            result = {"ok": False, "errorCode": "llm_timeout"}
            break
        result = call_llm_tools(request_messages, canonical_tools, max_tokens=max_tokens,
                                timeout=min(AGENT_PLAN_TIMEOUT_SECONDS, remaining), temperature=0.1, return_metadata=True)
        if not isinstance(result, dict) or result.get("ok") is False:
            break
        truncated = result.get("finishReason") in {"length", "max_tokens"}
        no_data_calls = (not (result.get("tool_calls") or result.get("toolCalls"))
                         and requires_verifiable_data(validated["question"]))
        if not truncated and not no_data_calls:
            break
        failure_code = "agent_plan_truncated" if truncated else "agent_no_tool_plan"
        if round_number >= 2:
            return 200, {"ok": False, "errorCode": failure_code, "round": round_number,
                         "telemetry": {"inputBytes": request_bytes, "finishReason": result.get("finishReason")}}
        # 截断与无工具纠正共享剩余一轮，不携带或执行部分调用。
        correction = (
            "上一次规划未完成。请重新生成完整且精简的必要工具调用，保留原商户、时间和指标条件；每个商户趋势只查询一次，不能以正文代替数据查询。"
            if language == "zh" else
            "The prior plan was incomplete. Generate a complete concise plan preserving targets, period and metrics. Query each merchant trend once; prose cannot replace a lookup."
        )
        request_messages = request_messages + [{"role": "user", "content": correction}]
        round_number = 2
        if truncated:
            max_tokens = min(8192, max_tokens * 2)
    if result is None:
        return 200, {
            "ok": False,
            "errorCode": "agent_planning_unavailable",
            "round": round_number,
            "telemetry": {"inputBytes": request_bytes},
        }
    telemetry = {
        "provider": result.get("provider"),
        "model": result.get("model"),
        "usageAvailable": bool(result.get("usageAvailable")),
        "inputTokens": result.get("inputTokens"),
        "outputTokens": result.get("outputTokens"),
        "totalTokens": result.get("totalTokens"),
        "inputBytes": request_bytes,
        "errorCode": result.get("errorCode"),
        "finishReason": result.get("finishReason"),
    }
    if result.get("ok") is False:
        return 200, {
            "ok": False,
            "errorCode": "agent_planning_unavailable",
            "round": round_number,
            "telemetry": telemetry,
        }
    normalized, normalize_error = normalize_planning_result(result, validated, agent_run_id, round_number)
    if normalize_error:
        return int(normalize_error.get("status") or 400), public_agent_error_payload(normalize_error)
    normalized["telemetry"] = telemetry
    return 200, normalized


def handle_agent_request(target) -> None:
    length = int(target.headers.get("Content-Length") or 0)
    if length <= 0 or length > AGENT_MAX_REQUEST_BYTES:
        send_json(target, 400, {"ok": False, "error": "Request body is too large"})
        return
    try:
        body = _read_json_body(target)
    except Exception:
        send_json(target, 400, {"ok": False, "error": "Invalid JSON body"})
        return
    if not isinstance(body, dict):
        send_json(target, 400, {"ok": False, "error": "JSON body must be an object"})
        return
    status, payload = plan_agent_request(body, length)
    send_json(target, status, payload)
