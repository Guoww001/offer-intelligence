"""LLM intent classification orchestrator.

Assembles system prompts from the skill registry, parses LLM responses using
schema-driven validation, and provides the public ``classify_intent()`` and
``generate_analysis_text()`` entry points.

Provider abstraction lives in ``llm_provider.py`` — no circular imports.
"""

from __future__ import annotations

import json
import os
import re
import sys
from typing import Any

# Provider abstraction (DeepSeek / Claude).
from llm_provider import (  # noqa: E402
    _api_key,
    _default_timeout,
    _model_name,
    _provider,
    call_llm,
)

# Skill registry — triggers auto-registration on first import.
from skills import registry  # noqa: E402

# VALID_INTENTS is derived from the registry (no hardcoded list).
VALID_INTENTS = frozenset(registry.list_intents())


# ═══════════════════════════════════════════════════════════════════════════════
# Prompt assembly
# ═══════════════════════════════════════════════════════════════════════════════

def _build_system_prompt(categories: list[str]) -> str:
    """Build a single-call system prompt by assembling fragments from all
    registered skills (used when two-stage mode is disabled).

    Structure::

        [fixed prefix — role + output format]
        [intent definitions — one per registered IntentSkill]
        [parameter descriptions — deduplicated, generated from ParamDefs]
        [fixed suffix — global rules + known categories]
        [few-shot examples — collected from all skills]
    """
    category_list = ", ".join(categories) if categories else "(none provided)"
    skills_list = registry.list_all()

    parts: list[str] = [
        "You are an intent classifier AND parameter extractor for an Amazon affiliate "
        "offer intelligence dashboard chatbot.\n"
        "Analyze the user's query and output a single JSON object with two keys: "
        '"intent" and "params".\n'
        "Output ONLY the JSON object, nothing else — no markdown fences, no explanation.\n"
        "\n"
        "Intent labels (choose exactly one for the \"intent\" field):\n",
    ]

    # ── intent definitions ──
    for skill in skills_list:
        parts.append(skill.prompt_intent_section())

    # ── parameter section ──
    parts.append(
        "\n"
        'The "params" field must be a JSON object containing extracted parameters. '
        "Only include fields that are relevant to the detected intent. "
        "Omit fields that are not mentioned in the query "
        "(set them to null or omit them entirely).\n"
        "\n"
        "Available param fields:\n",
    )

    seen_params: set[str] = set()
    for skill in skills_list:
        for pname, pdef in skill.param_schema().items():
            if pname in seen_params:
                continue
            seen_params.add(pname)
            type_hint = pdef.type
            if pdef.enum:
                type_hint = " | ".join(f'"{v}"' for v in pdef.enum)
            elif pdef.type == "array" and pdef.nested_schema:
                inner = ", ".join(
                    f"{nk} ({nd.type})" for nk, nd in pdef.nested_schema.items()
                )
                type_hint = f"array of {{{inner}}}"
            elif pdef.type == "object" and pdef.nested_schema:
                inner = ", ".join(
                    f"{nk} ({nd.type})" for nk, nd in pdef.nested_schema.items()
                )
                type_hint = f"object {{{inner}}}"
            parts.append(f"- {pname} ({type_hint}): {pdef.description}\n")

    # ── global rules ──
    parts.append(_GLOBAL_RULES.format(category_list=category_list))

    # ── few-shot examples ──
    examples_added = False
    for skill in skills_list:
        skill_examples = skill.examples()
        if not skill_examples:
            continue
        if not examples_added:
            parts.append("\nExample outputs:\n")
            examples_added = True
        for ex in skill_examples:
            parts.append(
                f'Query: "{ex.query}"\n'
                f"Output: {json.dumps(ex.output, ensure_ascii=False)}\n"
                "\n"
            )

    return "".join(parts)


# ── shared prompt fragments ──────────────────────────────────────────────────

_GLOBAL_RULES = """\
Important rules:
- If the query contains both a merchant name AND a category (e.g. 'Shokz Electronics'),
  classify as 'merchant' (the user wants to look up that brand).
- If the query is a short greeting or help request with no clear domain intent,
  classify as 'merchant' (the default fallback) with empty params.
- Treat metric filters like 'aov above 100', 'epc lower than 1', 'conversion above 10%'
  as 'recommendation' (they are filtering/ranking requests).
- When a recommendation query mentions a specific tier (e.g. 'Tier 2 推荐', 'Tier 1 top 10',
  or compact forms like 'tier1', 'Tier2'), ALWAYS extract the "tier" param using the
  canonical format "Tier 1", "Tier 2", "Tier 3", "Tier 4", or "BLACK TIER".
- When the query asks to analyze, evaluate, check, or assess something (e.g. 'analyze Shokz',
  'how is Electronics doing?', 'Tier 2 performance check', '评估一下美妆品类', 'Shokz 最近怎么样'),
  classify as 'analysis' and extract the analysisType and analysisTarget.
- For analysisType: if the target is a brand/merchant name, use 'merchant'; if it is a category
  name (matching the known categories list), use 'category'; if it is a tier like 'Tier 1' etc.,
  use 'tier'. If the query only has a merchant name without explicit analysis keyword but asks
  'how is X doing?' / 'X怎么样', still classify as 'analysis'.
- IMPORTANT: Promotion/demotion questions like 'which Tier 2 should be promoted to Tier 1',
  '哪些Tier2要升Tier1', 'who deserves an upgrade/downgrade' are ANALYSIS, not recommendation.
  The user is asking for a diagnostic assessment, not a simple ranked list.
- However, queries that simply ask for top N offers from a tier (e.g. 'Tier2推荐10个',
  'top 10 Tier 2 offers') are RECOMMENDATION, not analysis — they want a ranked list, not a diagnosis.
- IMPORTANT — tierOfferPlan vs tier+count: When the query asks for a DIFFERENT count
  PER tier (signaled by '各N个', '各N', 'each N', or explicit per-tier counts like
  'Tier1 3个 Tier2 5个'), you MUST use 'tierOfferPlan' (an array of {{tier, count}} objects).
  Only use 'tier'+'count' when ALL mentioned tiers share the SAME single count.
  - 'Tier1和Tier2各推荐5个' → tierOfferPlan (each tier gets its own count)
  - '推荐Tier1和Tier2各5个' → tierOfferPlan (各 = each has its own count)
  - 'Tier1推荐3个，Tier2推荐5个' → tierOfferPlan (different counts per tier)
  - '推荐10个Tier1' → tier=['Tier 1'] + count=10 (single tier, single count)
  - 'Tier1和Tier2推荐10个' → tier=['Tier 1','Tier 2'] + count=10 (both tiers share same count)
- For Chinese queries, extract the same parameters using Chinese understanding.
  Common Chinese patterns: 推荐=recommend, 第X层/级=Tier X, 前N个=N results, 付款/支付=payment,
  分析/评估/诊断/怎么样/表现/趋势/升级/降级/升降级=analysis, 各N个=each N (→ tierOfferPlan).

Known product categories (use these canonical names for the "category" param): {category_list}
"""

# ── Router prompt (two-stage mode) ───────────────────────────────────────────

_ROUTER_PREFIX = """\
You are an intent classifier for an Amazon affiliate offer intelligence dashboard chatbot.
Analyze the user's query and pick EXACTLY ONE intent from the list below.
Output ONLY a JSON object: {"intent": "<intent>"}
No explanation, no markdown fences.

PRIORITY RULES (apply in order):
1. If the query asks for recommendations (recommend/rank/top/best/pick, or
   "推荐"/"排行"/"最好"/"最佳"), it is ALWAYS "recommendation", even if it
   mentions a tier or category name.
2. If the query asks to analyze/evaluate/diagnose/assess (or "分析"/"评估"/
   "诊断"/"怎么样"/"表现"/"趋势") or asks "how is"/"how are"/"performance"/
   "health check"/"trend"/"upgrade"/"downgrade", it is ALWAYS "analysis",
   even if it mentions a tier or merchant name.
3. "tier" intent is ONLY for queries that browse/view/filter tier contents
   WITHOUT recommendation or analysis keywords (e.g. "Show Tier 1",
   "Tier 2有哪些", "Tier 2", "黑名单").
4. If the query does NOT clearly match any specific intent (greetings like
   "hello"/"hi", gibberish, or very short ambiguous text), default to
   "merchant".

Intent labels:
"""


def _build_router_prompt() -> str:
    """Build a lightweight prompt that only asks the LLM to pick an intent.

    Used as stage 1 in two-stage mode.  No parameter descriptions, no examples.
    """
    parts = [_ROUTER_PREFIX]
    for skill in registry.list_all():
        parts.append(skill.prompt_intent_section())
    return "".join(parts)


def _build_skill_prompt(skill: "IntentSkill", categories: list[str]) -> str:
    """Build a focused prompt for a *single* intent's parameter extraction.

    Used as stage 2 in two-stage mode.  Only includes this skill's param
    descriptions and examples, plus the global rules.
    """
    category_list = ", ".join(categories) if categories else "(none provided)"

    parts: list[str] = [
        "You are a parameter extractor for an Amazon affiliate offer intelligence "
        "dashboard chatbot.\n"
        "The user's intent has already been determined as: "
        f'"{skill.intent}".\n'
        "Extract the relevant parameters from the user's query.\n"
        "Output ONLY a JSON object with a single \"params\" key — "
        "no markdown fences, no explanation.\n"
        "\n"
        "Available params for this intent:\n",
    ]

    for pname, pdef in skill.param_schema().items():
        type_hint = pdef.type
        if pdef.enum:
            type_hint = " | ".join(f'"{v}"' for v in pdef.enum)
        elif pdef.type == "array" and pdef.nested_schema:
            inner = ", ".join(
                f"{nk} ({nd.type})" for nk, nd in pdef.nested_schema.items()
            )
            type_hint = f"array of {{{inner}}}"
        elif pdef.type == "object" and pdef.nested_schema:
            inner = ", ".join(
                f"{nk} ({nd.type})" for nk, nd in pdef.nested_schema.items()
            )
            type_hint = f"object {{{inner}}}"
        parts.append(f"- {pname} ({type_hint}): {pdef.description}\n")

    parts.append("\n")
    parts.append(
        _GLOBAL_RULES.format(category_list=category_list)
        if "{category_list}" in _GLOBAL_RULES
        else _GLOBAL_RULES
    )
    parts.append("\n")

    skill_examples = skill.examples()
    if skill_examples:
        parts.append("Examples:\n")
        for ex in skill_examples:
            parts.append(
                f'Query: "{ex.query}"\n'
                f"Output: {json.dumps(ex.output, ensure_ascii=False)}\n"
                "\n"
            )

    return "".join(parts)


# ═══════════════════════════════════════════════════════════════════════════════
# Response parsing (schema-driven from skill ParamDefs)
# ═══════════════════════════════════════════════════════════════════════════════

def _validate_param_value(key: str, value: Any, param_def: "ParamDef") -> Any | None:
    """Validate and clean a single parameter value against its ParamDef."""
    from skills.base import ParamDef  # noqa: PLC0415

    if value is None:
        return None

    ptype = param_def.type

    if ptype == "str":
        s = str(value).strip()
        if not s:
            return None
        if param_def.enum and s not in param_def.enum:
            return None
        return s

    if ptype == "int":
        if isinstance(value, (int, float)) and value > 0:
            return int(value)
        return None

    if ptype == "bool":
        return bool(value)

    if ptype == "object":
        if not isinstance(value, dict):
            return None
        if param_def.nested_schema:
            cleaned: dict[str, Any] = {}
            for nested_key, nested_def in param_def.nested_schema.items():
                nested_value = value.get(nested_key)
                result = _validate_param_value(nested_key, nested_value, nested_def)
                if result is not None:
                    cleaned[nested_key] = result
                elif nested_def.required:
                    return None
            return cleaned if cleaned else None
        return value

    if ptype == "array":
        # Accept a single string and auto-wrap into a list (backward
        # compatible — LLMs sometimes return a string for array params).
        if isinstance(value, str) and value.strip():
            value = [value.strip()]
        if not isinstance(value, list):
            return None
        if param_def.nested_schema:
            cleaned_items = []
            for item in value:
                if not isinstance(item, dict):
                    continue
                cleaned_item: dict[str, Any] = {}
                skip_item = False
                for nested_key, nested_def in param_def.nested_schema.items():
                    nested_value = item.get(nested_key)
                    result = _validate_param_value(nested_key, nested_value, nested_def)
                    if result is not None:
                        cleaned_item[nested_key] = result
                    elif nested_def.required:
                        skip_item = True
                        break
                if not skip_item and cleaned_item:
                    cleaned_items.append(cleaned_item)
            return cleaned_items if cleaned_items else None
        # For plain arrays (no nested_schema), filter each item through the
        # enum validator if an enum is defined (e.g. tier values, ASIN format).
        if param_def.enum:
            filtered = []
            for item in value:
                if isinstance(item, str) and item.strip() in param_def.enum:
                    filtered.append(item.strip())
            return filtered if filtered else None
        return value

    return value


def _parse_intent_only(text: str) -> str | None:
    """Parse just the intent label from an LLM response (stage 1)."""
    cleaned = text.strip()
    fence_match = re.match(r"```(?:json)?\s*\n?(.*?)\n?```", cleaned, re.DOTALL)
    if fence_match:
        cleaned = fence_match.group(1).strip()
    try:
        data = json.loads(cleaned)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    intent = str(data.get("intent", "")).strip().lower() if data.get("intent") else ""
    return intent if intent in VALID_INTENTS else None


def _parse_params_only(text: str, skill: "IntentSkill") -> dict[str, Any]:
    """Parse parameters from an LLM response using the skill's schema (stage 2)."""
    cleaned = text.strip()
    fence_match = re.match(r"```(?:json)?\s*\n?(.*?)\n?```", cleaned, re.DOTALL)
    if fence_match:
        cleaned = fence_match.group(1).strip()
    try:
        data = json.loads(cleaned)
    except (json.JSONDecodeError, TypeError):
        return {}
    if not isinstance(data, dict):
        return {}
    raw_params = data.get("params", data)  # accept {"params": {...}} or just {...}
    if not isinstance(raw_params, dict):
        return {}
    schema = skill.param_schema()
    params: dict[str, Any] = {}
    for key, param_def in schema.items():
        if key not in raw_params or raw_params[key] is None:
            continue
        cleaned_value = _validate_param_value(key, raw_params[key], param_def)
        if cleaned_value is not None:
            params[key] = cleaned_value
    return params


def _parse_response(text: str) -> dict | None:
    """Parse the single-call LLM JSON response into {intent, params}.

    Validation rules are driven by the matched intent skill's param_schema().
    """
    cleaned = text.strip()
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

    skill = registry.get(intent)
    if skill is None:
        print(f"[llm_classify] no skill registered for intent: {intent!r}", file=sys.stderr)
        return None

    raw_params = data.get("params")
    if not isinstance(raw_params, dict):
        raw_params = {}

    schema = skill.param_schema()
    params: dict[str, Any] = {}
    for key, param_def in schema.items():
        if key not in raw_params or raw_params[key] is None:
            continue
        cleaned_value = _validate_param_value(key, raw_params[key], param_def)
        if cleaned_value is not None:
            params[key] = cleaned_value

    return {"intent": intent, "params": params}


# ═══════════════════════════════════════════════════════════════════════════════
# Two-stage helper
# ═══════════════════════════════════════════════════════════════════════════════

def _two_stage_enabled() -> bool:
    """Check whether two-stage classification is enabled via env var."""
    val = os.environ.get("OI_LLM_TWO_STAGE", "").strip().lower()
    return val in ("1", "true", "yes", "on")


# ═══════════════════════════════════════════════════════════════════════════════
# Public API
# ═══════════════════════════════════════════════════════════════════════════════

def classify_intent(
    prompt: str,
    categories: list[str] | None = None,
    timeout: float | None = None,
) -> dict | None:
    """Classify a user query and extract parameters using the configured LLM provider.

    Supports two modes:
    - **Single-call** (default): one LLM call with all intents' prompts assembled.
    - **Two-stage** (``OI_LLM_TWO_STAGE=1``): stage 1 routes the intent with a
      lightweight prompt; stage 2 extracts params using only the matched skill's
      prompt.  This reduces total tokens and gives each stage a focused task.

    Args:
        prompt: The raw user query text.
        categories: Known product category names for the system prompt.
        timeout: API call timeout in seconds.

    Returns:
        A dict ``{"intent": str, "params": dict}``, or None if classification fails.
    """
    provider = _provider()
    api_key = _api_key()
    if not api_key:
        print(f"[llm_classify] {provider}: API key is not set — returning None", file=sys.stderr)
        return None

    if timeout is None:
        timeout = _default_timeout()

    prompt_preview = prompt[:80].replace("\n", " ") + ("…" if len(prompt) > 80 else "")
    print(
        f"[llm_classify] → calling {provider} model={_model_name()} "
        f"timeout={timeout}s two_stage={_two_stage_enabled()} prompt=\"{prompt_preview}\"",
        file=sys.stderr,
    )

    if _two_stage_enabled():
        return _classify_two_stage(prompt, categories, timeout, provider, prompt_preview)
    return _classify_single_call(prompt, categories, timeout, provider)


def _classify_single_call(
    prompt: str,
    categories: list[str] | None,
    timeout: float,
    provider: str,
) -> dict | None:
    """Original single-call path: one prompt, one LLM call."""
    category_list: list[str] = list(categories or [])
    system_prompt = _build_system_prompt(category_list)

    try:
        raw_text = call_llm(system_prompt, prompt, max_tokens=300, timeout=timeout, temperature=0)

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


def _classify_two_stage(
    prompt: str,
    categories: list[str] | None,
    timeout: float,
    provider: str,
    prompt_preview: str,
) -> dict | None:
    """Two-stage path: lightweight intent routing → focused param extraction."""
    category_list: list[str] = list(categories or [])

    # ── Stage 1: Intent routing ──
    router_prompt = _build_router_prompt()
    print(
        f"[llm_classify]   [stage1] router prompt len={len(router_prompt)}",
        file=sys.stderr,
    )

    try:
        raw_text = call_llm(router_prompt, prompt, max_tokens=50, timeout=timeout, temperature=0)
    except Exception as exc:
        print(f"[llm_classify] {provider}: stage1 error — {exc}, falling back to single-call", file=sys.stderr)
        return _classify_single_call(prompt, categories, timeout, provider)

    intent = _parse_intent_only(raw_text or "")
    if intent is None:
        print(
            f"[llm_classify]   [stage1] unrecognized: {raw_text!r}, falling back to single-call",
            file=sys.stderr,
        )
        return _classify_single_call(prompt, categories, timeout, provider)

    print(f"[llm_classify]   [stage1] → intent={intent}", file=sys.stderr)

    # ── Stage 2: Parameter extraction ──
    skill = registry.get(intent)
    if skill is None:
        return {"intent": intent, "params": {}}

    skill_prompt = _build_skill_prompt(skill, category_list)
    print(
        f"[llm_classify]   [stage2] skill={intent} prompt len={len(skill_prompt)}",
        file=sys.stderr,
    )

    try:
        raw_text = call_llm(skill_prompt, prompt, max_tokens=300, timeout=timeout, temperature=0)
    except Exception as exc:
        print(f"[llm_classify] {provider}: stage2 error — {exc}", file=sys.stderr)
        return {"intent": intent, "params": {}}

    params = _parse_params_only(raw_text or "", skill)
    param_keys = list(params.keys())
    print(
        f"[llm_classify] ← intent={intent} params={param_keys} (two-stage)",
        file=sys.stderr,
    )
    return {"intent": intent, "params": params}


def generate_analysis_text(
    summary: dict,
    language: str = "en",
    timeout: float | None = None,
) -> str | None:
    """Generate a natural-language analysis narrative from a statistical summary.

    Delegates to the registered AnalysisSkill so that analysis text generation
    shares the same provider infrastructure as intent classification.

    Args:
        summary: Structured analysis result dict.
        language: "en" for English, "zh" for Chinese.
        timeout: API call timeout in seconds.  Defaults to 15.

    Returns:
        The LLM-generated analysis text, or None if the call fails.
    """
    if timeout is None:
        timeout = _default_timeout()

    analysis_skill = registry.get_analysis()
    if analysis_skill is None:
        print("[llm_classify] no AnalysisSkill registered — returning None", file=sys.stderr)
        return None

    preview = json.dumps(summary, ensure_ascii=False)[:120].replace("\n", " ") + (
        "…" if len(json.dumps(summary, ensure_ascii=False)) > 120 else ""
    )
    print(
        f"[llm_classify] → analysis {_provider()} model={_model_name()} "
        f"lang={language} timeout={timeout}s preview=\"{preview}\"",
        file=sys.stderr,
    )

    text = analysis_skill.generate(summary, language, timeout)
    if text:
        print(
            f"[llm_classify] ← analysis text len={len(text)}",
            file=sys.stderr,
        )
    else:
        print("[llm_classify] ← analysis returned None", file=sys.stderr)
    return text
