from __future__ import annotations

import json
import os
import re
import sys
from typing import Any

VALID_INTENTS = frozenset({"asin", "merchant", "payment", "recommendation", "tier", "category", "analysis"})

DEFAULT_PROVIDER = "deepseek"
DEFAULT_MODEL_DEEPSEEK = "deepseek-chat"
DEFAULT_MODEL_CLAUDE = "claude-haiku-3-5-latest"
DEEPSEEK_BASE_URL = "https://api.deepseek.com"


def _provider() -> str:
    value = os.environ.get("OI_LLM_PROVIDER", DEFAULT_PROVIDER).strip().lower()
    if value in {"deepseek", "claude"}:
        return value
    return DEFAULT_PROVIDER


def _model_name() -> str:
    if _provider() == "deepseek":
        return os.environ.get("OI_LLM_MODEL_DEEPSEEK", DEFAULT_MODEL_DEEPSEEK).strip() or DEFAULT_MODEL_DEEPSEEK
    return os.environ.get("OI_LLM_MODEL_CLAUDE", DEFAULT_MODEL_CLAUDE).strip() or DEFAULT_MODEL_CLAUDE


def _api_key() -> str:
    if _provider() == "deepseek":
        return os.environ.get("DEEPSEEK_API_KEY", "").strip()
    return os.environ.get("ANTHROPIC_API_KEY", "").strip()


def _build_system_prompt(categories: list[str]) -> str:
    """Build a system prompt that defines intent classes, parameter extraction, and known categories."""
    category_list = ", ".join(categories) if categories else "(none provided)"
    return (
        "You are an intent classifier AND parameter extractor for an Amazon affiliate offer intelligence dashboard chatbot.\n"
        "Analyze the user's query and output a single JSON object with two keys: \"intent\" and \"params\".\n"
        "Output ONLY the JSON object, nothing else — no markdown fences, no explanation.\n"
        "\n"
        "Intent labels (choose exactly one for the \"intent\" field):\n"
        "- asin: The query contains a 10-character ASIN starting with 'B' (e.g. B0D2HKCMBP).\n"
        "- merchant: The query asks about a specific merchant/brand by name or by numeric merchant ID (5-8 digits). "
        "This includes queries like 'Shokz', 'Aiper offers', '362938'.\n"
        "- payment: The query asks about payment status, unpaid/paid/overdue/pending amounts, payment cycles, "
        "or commissions. In Chinese this includes 付款、未付款、已付款、逾期、到期、待处理、佣金、结算、收款.\n"
        "- recommendation: The query asks for recommendations, rankings, best/top offers, or filtered lists. "
        "In Chinese this includes 推荐、排行、最好、最佳、优先、选品、主推.\n"
        "- tier: The query asks about a specific tier level (Tier 1-4 or BLACK TIER). "
        "In Chinese this includes 第一层/级、Tier 1、黑名单.\n"
        "- category: The query asks about offers in a product category (e.g. beauty, electronics, pet supplies). "
        "In Chinese this includes category aliases like 美妆、电子、宠物.\n"
        "- analysis: The query asks to analyze, evaluate, diagnose, or assess the performance of a merchant, "
        "category, or tier. This includes questions about how something is performing, health checks, "
        "trend assessment, comparisons, or promotion/demotion decisions. In Chinese this includes "
        "分析、评估、诊断、怎么样、表现、趋势、健康度、状态、测测、看看、升级、降级、升降级、提升到.\n"
        "\n"
        "The \"params\" field must be a JSON object containing extracted parameters. "
        "Only include fields that are relevant to the detected intent. "
        "Omit fields that are not mentioned in the query (set them to null or omit them entirely).\n"
        "\n"
        "Available param fields:\n"
        "- asin (string): The 10-character ASIN, e.g. \"B0D2HKCMBP\". Only for asin intent.\n"
        "- merchantName (string): The brand/merchant name mentioned, e.g. \"Shokz\", \"Aiper\". For merchant or payment intents.\n"
        "- merchantId (string): A 5-8 digit numeric merchant ID, e.g. \"362938\". For merchant intent.\n"
        "- category (string): The product category name, e.g. \"electronics\", \"beauty\", \"pet supplies\". "
        "For category or recommendation intents. Use the canonical category names from the known list below.\n"
        "- tier (string): The tier level, one of \"Tier 1\", \"Tier 2\", \"Tier 3\", \"Tier 4\", \"BLACK TIER\". "
        "For tier or recommendation intents.\n"
        "- includeTier4 (boolean): true if the query explicitly asks to include Tier 4. For recommendation/tier/category intents.\n"
        "- includeBlack (boolean): true if the query explicitly asks to include BLACK TIER / blocked merchants. "
        "For recommendation/tier/category intents.\n"
        "- count (number): The number of offers requested, e.g. 5, 10, 20. For recommendation intent.\n"
        "- month (string): A month name like \"January\", \"February\", etc. For payment intent.\n"
        "- paymentStatus (string): Payment status filter, one of \"unpaid\", \"paid\", \"pending\", \"partial\", \"overdue\". "
        "For payment intent.\n"
        "- paymentCycleFilter (object): Payment cycle duration filter with \"operator\" (one of \">\", \">=\", \"<\", \"<=\") "
        "and \"threshold\" (number of days). For payment intent.\n"
        "- metricFilters (array of objects): Metric comparison filters. Each object has \"field\" (metric name: "
        "\"aov\", \"epc\", \"conversionRate\", \"orders\", \"clicks\", \"affCommission\", \"commissionRate\", "
        "\"salesAmount\", \"dpv\", \"atc\"), \"operator\" (one of \">\", \">=\", \"<\"), and \"value\" (number). "
        "For recommendation intent. Example: [{\"field\": \"aov\", \"operator\": \">\", \"value\": 100}]\n"
        "- metricSort (object): Sort specification with \"field\" (same metric names as above) and "
        "\"direction\" (\"asc\" or \"desc\"). For recommendation intent.\n"
        "- keywordSearch (string): A keyword/phrase to search for. For recommendation intent.\n"
        "- tierOfferPlan (array of objects): Tier-specific offer count requests. Each object has \"tier\" "
        "(e.g. \"Tier 1\") and \"count\" (number). For recommendation intent.\n"
        "- analysisType (string): The type of analysis requested, one of \"merchant\", \"category\", \"tier\". "
        "For analysis intent. Extract from the target of the analysis query.\n"
        "- analysisTarget (string): The name of the entity to analyze — a merchant/brand name, "
        "a category name, or a tier name like \"Tier 1\"/\"Tier 2\" etc. For analysis intent.\n"
        "\n"
        "Important rules:\n"
        "- If the query contains both a merchant name AND a category (e.g. 'Shokz Electronics'), "
        "classify as 'merchant' (the user wants to look up that brand).\n"
        "- If the query is a short greeting or help request with no clear domain intent, "
        "classify as 'merchant' (the default fallback) with empty params.\n"
        "- Treat metric filters like 'aov above 100', 'epc lower than 1', 'conversion above 10%' "
        "as 'recommendation' (they are filtering/ranking requests).\n"
        "- When a recommendation query mentions a specific tier (e.g. 'Tier 2 推荐', 'Tier 1 top 10', "
        "or compact forms like 'tier1', 'Tier2'), ALWAYS extract the \"tier\" param using the "
        "canonical format \"Tier 1\", \"Tier 2\", \"Tier 3\", \"Tier 4\", or \"BLACK TIER\".\n"
        "- When the query asks to analyze, evaluate, check, or assess something (e.g. 'analyze Shokz', "
        "'how is Electronics doing?', 'Tier 2 performance check', '评估一下美妆品类', 'Shokz 最近怎么样'), "
        "classify as 'analysis' and extract the analysisType and analysisTarget.\n"
        "- For analysisType: if the target is a brand/merchant name, use 'merchant'; if it is a category "
        "name (matching the known categories list), use 'category'; if it is a tier like 'Tier 1' etc., "
        "use 'tier'. If the query only has a merchant name without explicit analysis keyword but asks "
        "'how is X doing?' / 'X怎么样', still classify as 'analysis'.\n"
        "- IMPORTANT: Promotion/demotion questions like 'which Tier 2 should be promoted to Tier 1', "
        "'哪些Tier2要升Tier1', 'who deserves an upgrade/downgrade' are ANALYSIS, not recommendation. "
        "The user is asking for a diagnostic assessment, not a simple ranked list.\n"
        "- However, queries that simply ask for top N offers from a tier (e.g. 'Tier2推荐10个', "
        "'top 10 Tier 2 offers') are RECOMMENDATION, not analysis — they want a ranked list, not a diagnosis.\n"
        "- For Chinese queries, extract the same parameters using Chinese understanding. "
        "Common Chinese patterns: 推荐=recommend, 第X层/级=Tier X, 前N个=N results, 付款/支付=payment, "
        "分析/评估/诊断/怎么样/表现/趋势/升级/降级/升降级=analysis.\n"
        "\n"
        f"Known product categories (use these canonical names for the \"category\" param): {category_list}\n"
        "\n"
        "Example outputs:\n"
        'Query: "Show me top 5 electronics offers with aov above 100"\n'
        'Output: {"intent": "recommendation", "params": {"category": "electronics", "count": 5, "metricFilters": [{"field": "aov", "operator": ">", "value": 100}]}}\n'
        "\n"
        'Query: "tier1 推荐6个"\n'
        'Output: {"intent": "recommendation", "params": {"tier": "Tier 1", "count": 6}}\n'
        "\n"
        'Query: "Tier 2 推荐10个"\n'
        'Output: {"intent": "recommendation", "params": {"tier": "Tier 2", "count": 10}}\n'
        "\n"
        'Query: "Tier 1 前5个 aov最高的"\n'
        'Output: {"intent": "recommendation", "params": {"tier": "Tier 1", "count": 5, "metricSort": {"field": "aov", "direction": "desc"}}}\n'
        "\n"
        'Query: "Shokz payment status"\n'
        'Output: {"intent": "payment", "params": {"merchantName": "Shokz"}}\n'
        "\n"
        'Query: "B0D2HKCMBP"\n'
        'Output: {"intent": "asin", "params": {"asin": "B0D2HKCMBP"}}\n'
        "\n"
        'Query: "hello"\n'
        'Output: {"intent": "merchant", "params": {}}\n'
        "\n"
        'Query: "分析 Shokz"\n'
        'Output: {"intent": "analysis", "params": {"analysisType": "merchant", "analysisTarget": "Shokz"}}\n'
        "\n"
        'Query: "how is Electronics doing?"\n'
        'Output: {"intent": "analysis", "params": {"analysisType": "category", "analysisTarget": "electronics"}}\n'
        "\n"
        'Query: "Tier 2 整体表现怎么样"\n'
        'Output: {"intent": "analysis", "params": {"analysisType": "tier", "analysisTarget": "Tier 2"}}\n'
        "\n"
        'Query: "哪些Tier2要升Tier1"\n'
        'Output: {"intent": "analysis", "params": {"analysisType": "tier", "analysisTarget": "Tier 2"}}\n'
        "\n"
        'Query: "Tier2推荐10个"\n'
        'Output: {"intent": "recommendation", "params": {"tier": "Tier 2", "count": 10}}\n'
    )


_EXPECTED_PARAM_KEYS = frozenset({
    "asin",
    "merchantName",
    "merchantId",
    "category",
    "tier",
    "includeTier4",
    "includeBlack",
    "count",
    "month",
    "paymentStatus",
    "paymentCycleFilter",
    "metricFilters",
    "metricSort",
    "keywordSearch",
    "tierOfferPlan",
    "analysisType",
    "analysisTarget",
})

_VALID_METRIC_FIELDS = frozenset({
    "aov", "epc", "conversionRate", "orders", "clicks",
    "affCommission", "commissionRate", "salesAmount", "dpv", "atc",
})

_VALID_TIERS = frozenset({"Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"})

_VALID_ANALYSIS_TYPES = frozenset({"merchant", "category", "tier"})


def _parse_response(text: str) -> dict | None:
    """Parse the LLM JSON response into a validated {intent, params} dict.

    Returns None if the response cannot be parsed or the intent is invalid.
    """
    cleaned = text.strip()

    # Strip markdown code fences if present
    fence_match = re.match(r"```(?:json)?\s*\n?(.*?)\n?```", cleaned, re.DOTALL)
    if fence_match:
        cleaned = fence_match.group(1).strip()

    try:
        data = json.loads(cleaned)
    except (json.JSONDecodeError, TypeError):
        print(f"[llm_classify] JSON parse failed for: {cleaned!r}", file=sys.stderr)
        return None

    if not isinstance(data, dict):
        print(f"[llm_classify] response is not a dict: {type(data).__name__}", file=sys.stderr)
        return None

    intent = str(data.get("intent", "")).strip().lower() if data.get("intent") else ""
    if intent not in VALID_INTENTS:
        print(f"[llm_classify] invalid intent: {intent!r}", file=sys.stderr)
        return None

    raw_params = data.get("params")
    if not isinstance(raw_params, dict):
        raw_params = {}

    params: dict[str, Any] = {}
    for key in _EXPECTED_PARAM_KEYS:
        if key not in raw_params or raw_params[key] is None:
            continue
        value = raw_params[key]
        if key in ("includeTier4", "includeBlack"):
            params[key] = bool(value)
        elif key == "count":
            if isinstance(value, (int, float)) and value > 0:
                params[key] = int(value)
        elif key == "month":
            params[key] = str(value).strip() or None
        elif key == "paymentStatus":
            s = str(value).strip().lower()
            if s in ("unpaid", "paid", "pending", "partial", "overdue"):
                params[key] = s
        elif key == "paymentCycleFilter":
            if isinstance(value, dict):
                op = str(value.get("operator", "")).strip()
                threshold = value.get("threshold")
                if op in (">", ">=", "<", "<=") and isinstance(threshold, (int, float)):
                    params[key] = {"operator": op, "threshold": float(threshold)}
        elif key == "metricFilters":
            if isinstance(value, list):
                cleaned_filters = []
                for f in value:
                    if not isinstance(f, dict):
                        continue
                    field = str(f.get("field", "")).strip()
                    if field not in _VALID_METRIC_FIELDS:
                        continue
                    op = str(f.get("operator", "")).strip()
                    if op not in (">", ">=", "<", "<="):
                        continue
                    val = f.get("value")
                    if not isinstance(val, (int, float)):
                        continue
                    cleaned_filters.append({"field": field, "operator": op, "value": float(val)})
                if cleaned_filters:
                    params[key] = cleaned_filters
        elif key == "metricSort":
            if isinstance(value, dict):
                field = str(value.get("field", "")).strip()
                direction = str(value.get("direction", "")).strip().lower()
                if field in _VALID_METRIC_FIELDS and direction in ("asc", "desc"):
                    params[key] = {"field": field, "direction": direction}
        elif key == "tierOfferPlan":
            if isinstance(value, list):
                plan = []
                for item in value:
                    if not isinstance(item, dict):
                        continue
                    t = str(item.get("tier", "")).strip()
                    c = item.get("count")
                    if t in _VALID_TIERS and isinstance(c, (int, float)) and c > 0:
                        plan.append({"tier": t, "count": int(c)})
                if plan:
                    params[key] = plan
        elif key in ("asin", "merchantName", "merchantId", "category", "keywordSearch"):
            s = str(value).strip()
            if s:
                params[key] = s
        elif key == "analysisType":
            s = str(value).strip()
            if s in _VALID_ANALYSIS_TYPES:
                params[key] = s
        elif key == "analysisTarget":
            s = str(value).strip()
            if s:
                params[key] = s

    return {"intent": intent, "params": params}


def _classify_claude(prompt: str, system_prompt: str, timeout: float) -> str | None:
    import anthropic

    client = anthropic.Anthropic(api_key=_api_key(), timeout=timeout)
    message = client.messages.create(
        model=_model_name(),
        max_tokens=300,
        temperature=0,
        timeout=timeout,
        system=system_prompt,
        messages=[{"role": "user", "content": prompt}],
    )
    return "".join(
        block.text for block in message.content if getattr(block, "type", None) == "text"
    )


def _classify_deepseek(prompt: str, system_prompt: str, timeout: float) -> str | None:
    from openai import OpenAI

    client = OpenAI(api_key=_api_key(), base_url=DEEPSEEK_BASE_URL, timeout=timeout)
    response = client.chat.completions.create(
        model=_model_name(),
        max_tokens=300,
        temperature=0,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
    )
    choice = response.choices[0]
    return choice.message.content or ""


def _default_timeout() -> float:
    try:
        return float(os.environ.get("OI_LLM_TIMEOUT", "15").strip())
    except ValueError:
        return 15.0


def classify_intent(
    prompt: str,
    categories: list[str] | None = None,
    timeout: float | None = None,
) -> dict | None:
    """Classify a user query and extract parameters using the configured LLM provider.

    Set OI_LLM_PROVIDER to "deepseek" (default) or "claude".
    Set DEEPSEEK_API_KEY or ANTHROPIC_API_KEY accordingly.
    Override model via OI_LLM_MODEL_DEEPSEEK / OI_LLM_MODEL_CLAUDE.

    Args:
        prompt: The raw user query text.
        categories: Known product category names to include in the system prompt.
        timeout: API call timeout in seconds.

    Returns:
        A dict {"intent": str, "params": dict}, or None if classification fails.
    """
    provider = _provider()
    api_key = _api_key()
    if not api_key:
        print(f"[llm_classify] {provider}: API key is not set — returning None", file=sys.stderr)
        return None

    if timeout is None:
        timeout = _default_timeout()

    category_list: list[str] = list(categories or [])
    system_prompt = _build_system_prompt(category_list)

    prompt_preview = prompt[:80].replace("\n", " ") + ("…" if len(prompt) > 80 else "")
    print(
        f"[llm_classify] → calling {provider} model={_model_name()} timeout={timeout}s prompt=\"{prompt_preview}\"",
        file=sys.stderr,
    )

    try:
        if provider == "deepseek":
            raw_text = _classify_deepseek(prompt, system_prompt, timeout)
        else:
            raw_text = _classify_claude(prompt, system_prompt, timeout)

        result = _parse_response(raw_text or "")
        if result is None:
            print(
                f"[llm_classify] {provider}: unrecognized response: {raw_text!r}",
                file=sys.stderr,
            )
        else:
            param_keys = list(result["params"].keys()) if result["params"] else []
            print(
                f"[llm_classify] ← intent={result['intent']} params={param_keys}",
                file=sys.stderr,
            )
        return result

    except Exception as exc:
        print(f"[llm_classify] {provider}: error — {exc}", file=sys.stderr)
        return None


def _build_analysis_system_prompt(language: str) -> str:
    """Build a system prompt that instructs the LLM to write an analysis narrative."""
    lang_instruction = (
        "Write your analysis in Chinese (Simplified). Use a professional but conversational tone. "
        "Keep it between 200-400 characters."
        if language == "zh" else
        "Write your analysis in English. Use a professional but conversational tone. "
        "Keep it between 150-300 words."
    )
    return (
        "You are an Amazon affiliate marketing data analyst. A user has asked you to analyze "
        "performance data from an offer intelligence dashboard.\n\n"
        "You will receive a JSON object containing structured statistical summaries. "
        "Based on this data, write a concise analysis that includes:\n"
        "1. Overall assessment — a one-sentence summary of the entity's performance.\n"
        "2. Key strengths — what metrics stand out positively (with specific numbers).\n"
        "3. Areas of concern — what metrics are below expectations (with specific numbers).\n"
        "4. Actionable recommendations — 2-3 specific suggestions for the affiliate manager.\n\n"
        "Rules:\n"
        "- Only use the data provided. Do not fabricate numbers.\n"
        "- Be specific — mention actual values and comparisons (e.g. 'EPC of $2.35 is 30% above "
        "the category average of $1.80').\n"
        "- If certain data is missing or unavailable, skip that point rather than guessing.\n"
        "- Format your response as plain paragraphs, no markdown headings or bullet points.\n"
        "- Do NOT start with phrases like 'Here is the analysis' or 'Based on the data' — "
        "just give the analysis directly.\n"
        f"{lang_instruction}\n"
    )


def _call_llm(system_prompt: str, user_message: str, max_tokens: int, timeout: float) -> str | None:
    """Call the configured LLM provider with the given prompts. Returns text or None."""
    provider = _provider()
    api_key = _api_key()
    if not api_key:
        print(f"[llm_classify] {provider}: API key is not set", file=sys.stderr)
        return None

    try:
        if provider == "deepseek":
            from openai import OpenAI
            client = OpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL, timeout=timeout)
            response = client.chat.completions.create(
                model=_model_name(),
                max_tokens=max_tokens,
                temperature=0.3,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
            )
            return response.choices[0].message.content or ""
        else:
            import anthropic
            client = anthropic.Anthropic(api_key=api_key, timeout=timeout)
            message = client.messages.create(
                model=_model_name(),
                max_tokens=max_tokens,
                temperature=0.3,
                timeout=timeout,
                system=system_prompt,
                messages=[{"role": "user", "content": user_message}],
            )
            return "".join(
                block.text for block in message.content if getattr(block, "type", None) == "text"
            )
    except Exception as exc:
        print(f"[llm_classify] {provider}: analysis error — {exc}", file=sys.stderr)
        return None


def generate_analysis_text(
    summary: dict,
    language: str = "en",
    timeout: float | None = None,
) -> str | None:
    """Generate a natural-language analysis narrative from a statistical summary.

    Args:
        summary: Structured analysis result dict (AnalysisResult from the frontend).
        language: "en" for English, "zh" for Chinese.
        timeout: API call timeout in seconds. Defaults to 15.

    Returns:
        The LLM-generated analysis text, or None if the call fails.
    """
    if timeout is None:
        timeout = _default_timeout()

    system_prompt = _build_analysis_system_prompt(language)
    user_message = json.dumps(summary, ensure_ascii=False, indent=2)

    preview = user_message[:120].replace("\n", " ") + ("…" if len(user_message) > 120 else "")
    print(
        f"[llm_classify] → analysis {_provider()} model={_model_name()} "
        f"lang={language} timeout={timeout}s preview=\"{preview}\"",
        file=sys.stderr,
    )

    text = _call_llm(system_prompt, user_message, max_tokens=600, timeout=timeout)
    if text:
        print(
            f"[llm_classify] ← analysis text len={len(text)}",
            file=sys.stderr,
        )
    else:
        print("[llm_classify] ← analysis returned None", file=sys.stderr)
    return text
