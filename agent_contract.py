"""Agent v2 请求协议、计划证明和服务端消息组装。"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from typing import Any

from agent_tool_registry import (
    AGENT_CONTRACT_VERSION,
    AGENT_TOOL_NAMES,
    AGENT_TOOL_REGISTRY_VERSION,
    validate_enabled_tools,
    validate_tool_arguments,
    validate_tool_result,
)


AGENT_PROMPT_MAX_CHARS = 4000
AGENT_CONTEXT_MEMORY_MAX_CHARS = 8000
AGENT_CONTEXT_HISTORY_LIMIT = 4
AGENT_CONTEXT_MESSAGE_MAX_CHARS = 1200
AGENT_MAX_TOOL_CALLS = 6
AGENT_MAX_PLAN_PROOFS = 2
AGENT_PLAN_PROOF_TTL_SECONDS = 600
AGENT_RUN_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{16,128}$")
AGENT_CALL_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
AGENT_RETRY_ERROR_CODES = {
    "tool_error",
    "tool_timeout",
    "invalid_arguments",
    "invalid_filter",
    "not_found",
    "stopped_by_user",
}
_ALLOWED_TRACE_KEYS = {"runId", "questionEventId", "tracePhase"}
_ALLOWED_PLANNING_KEYS = {"contractVersion", "question", "language", "enabledTools", "trace", "retry"}
_ALLOWED_SYNTHESIS_KEYS = {"contractVersion", "agentRunId", "planProofs", "question", "language", "context", "toolResults", "trace"}
_SIGNING_PURPOSE = "agent-tools-v2:"


def _error(error_code: str, field: str, status: int = 400) -> dict[str, Any]:
    return {"status": status, "errorCode": error_code, "field": field}


def public_agent_error_payload(error: dict) -> dict:
    payload = {"ok": False, "errorCode": str(error.get("errorCode") or "invalid_agent_contract")}
    for key in ("field", "allowed"):
        value = error.get(key)
        if isinstance(value, (str, list, tuple)):
            payload[key] = list(value) if isinstance(value, tuple) else value
    return payload


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _hash_value(value: Any) -> str:
    digest = hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()
    return "sha256:" + digest


def _hash_question(question: str) -> str:
    return _hash_value(str(question).strip())


def _safe_text(value: Any, field: str, maximum: int) -> tuple[str | None, dict | None]:
    if not isinstance(value, str):
        return None, _error("invalid_agent_contract", field)
    cleaned = value.strip()
    if not cleaned or len(cleaned) > maximum:
        return None, _error("invalid_agent_contract", field)
    return cleaned, None


def _validate_trace(value: Any, phase: str) -> tuple[dict | None, dict | None]:
    if value is None:
        return None, None
    if not isinstance(value, dict) or any(key not in _ALLOWED_TRACE_KEYS for key in value):
        return None, _error("invalid_agent_contract", "trace")
    result = {}
    for key in ("runId", "questionEventId"):
        if key in value:
            text, error = _safe_text(value[key], key, 128)
            if error:
                return None, error
            result[key] = text
    trace_phase = value.get("tracePhase", phase)
    if trace_phase != phase:
        return None, _error("invalid_agent_contract", "trace.tracePhase")
    result["tracePhase"] = phase
    return result, None


def _validate_retry(value: Any) -> tuple[dict | None, dict | None]:
    if value is None:
        return None, None
    if not isinstance(value, dict) or set(value) != {"agentRunId", "previousPlanProof", "failedCalls"}:
        return None, _error("invalid_agent_contract", "retry")
    agent_run_id, error = _safe_text(value["agentRunId"], "retry.agentRunId", 128)
    if error or not AGENT_RUN_ID_PATTERN.fullmatch(agent_run_id or ""):
        return None, _error("invalid_agent_contract", "retry.agentRunId")
    proof, error = _safe_text(value["previousPlanProof"], "retry.previousPlanProof", 8192)
    if error:
        return None, error
    failed_calls = value["failedCalls"]
    if not isinstance(failed_calls, list) or not failed_calls or len(failed_calls) > AGENT_MAX_TOOL_CALLS:
        return None, _error("invalid_agent_contract", "retry.failedCalls")
    cleaned_calls = []
    seen = set()
    for item in failed_calls:
        if not isinstance(item, dict) or set(item) != {"callId", "errorCode"}:
            return None, _error("invalid_agent_contract", "retry.failedCalls")
        call_id, error = _safe_text(item["callId"], "retry.failedCalls.callId", 128)
        if error or not AGENT_CALL_ID_PATTERN.fullmatch(call_id or "") or call_id in seen:
            return None, _error("invalid_agent_contract", "retry.failedCalls.callId")
        if item["errorCode"] not in AGENT_RETRY_ERROR_CODES:
            return None, _error("invalid_agent_contract", "retry.failedCalls.errorCode")
        seen.add(call_id)
        cleaned_calls.append({"callId": call_id, "errorCode": item["errorCode"]})
    return {
        "agentRunId": agent_run_id,
        "previousPlanProof": proof,
        "failedCalls": cleaned_calls,
    }, None


def validate_planning_request(body: object) -> tuple[dict | None, dict | None]:
    if not isinstance(body, dict):
        return None, _error("invalid_agent_contract", "body")
    if body.get("contractVersion") != AGENT_CONTRACT_VERSION:
        return None, _error("agent_contract_version_required", "contractVersion")
    if any(key not in _ALLOWED_PLANNING_KEYS for key in body):
        return None, _error("invalid_agent_contract", "body")
    question, error = _safe_text(body.get("question"), "question", AGENT_PROMPT_MAX_CHARS)
    if error:
        return None, error
    language = body.get("language", "zh")
    if language not in ("zh", "en"):
        return None, _error("invalid_agent_contract", "language")
    enabled_tools, error = validate_enabled_tools(body.get("enabledTools"))
    if error:
        return None, error
    trace, error = _validate_trace(body.get("trace"), "planning")
    if error:
        return None, error
    retry, error = _validate_retry(body.get("retry"))
    if error:
        return None, error
    return {
        "contractVersion": AGENT_CONTRACT_VERSION,
        "question": question,
        "language": language,
        "enabledTools": enabled_tools,
        "trace": trace,
        "retry": retry,
    }, None


def build_planning_messages(request: dict, retry: dict | None = None) -> list[dict]:
    messages = [{"role": "user", "content": request["question"]}]
    if retry:
        failed_codes = ", ".join(item["errorCode"] for item in retry["failedCalls"])
        messages.append({
            "role": "user",
            "content": (
                "上一轮调用返回受控失败码：" + failed_codes
                + "。请重新检查工具参数；不要编造数据，也不要重复发送无效参数。"
            ),
        })
    return messages


def _looks_like_comparison(question: str) -> bool:
    return bool(re.search(r"比较|对比|差异|优劣|排名|谁更好|compare|comparison|difference|ranking|which .*better", question, re.I))


def _looks_like_trend(question: str) -> bool:
    return bool(re.search(r"趋势|走势|逐月|月度变化|trend|trajectory|month[- ]by[- ]month", question, re.I))


def _requested_trend_metric(question: str) -> str | None:
    matches = []
    patterns = (
        ("conversionRate", r"\b(?:cvr|conversion(?:\s+rate)?)\b|转化率|转换率"),
        ("affiliatePayout", r"\b(?:affiliate|aff)\s+(?:payout|commission)\b|联盟佣金|佣金收入"),
        ("revenue", r"\b(?:revenue|sales)\b|销售额|收入|营收"),
        ("orders", r"\border(?:s)?\b|订单"),
        ("clicks", r"\bclicks?\b|点击"),
        ("epc", r"\bepc\b"),
        ("aov", r"\baov\b|客单价|平均订单金额"),
    )
    for metric, pattern in patterns:
        if re.search(pattern, question, re.I):
            matches.append(metric)
    return matches[0] if len(matches) == 1 else None


def normalize_planning_tool_calls(tool_calls: object, question: str, round_number: int) -> list[dict]:
    calls = tool_calls if isinstance(tool_calls, list) else []
    comparison_requested = _looks_like_comparison(question)
    trend_requested = _looks_like_trend(question)
    normalized = []
    for call in calls:
        if not isinstance(call, dict):
            continue
        name = call.get("name")
        arguments = call.get("arguments")
        if not isinstance(name, str) or not isinstance(arguments, dict):
            normalized.append({"name": name, "arguments": arguments})
            continue
        if trend_requested and name == "merchant_analysis" and isinstance(arguments.get("merchant"), str):
            trend_args = {"entityType": "merchant", "target": arguments["merchant"].strip(), "months": 12}
            metric = _requested_trend_metric(question)
            if metric:
                trend_args["metric"] = metric
            normalized.append({"name": "trend", "arguments": trend_args})
            continue
        if trend_requested and name == "merchant_comparison" and isinstance(arguments.get("merchants"), list):
            for merchant in arguments["merchants"]:
                if isinstance(merchant, str) and merchant.strip():
                    trend_args = {
                        "entityType": "merchant",
                        "target": merchant.strip(),
                        "months": 12,
                    }
                    metric = _requested_trend_metric(question)
                    if metric:
                        trend_args["metric"] = metric
                    normalized.append({
                        "name": "trend",
                        "arguments": trend_args,
                    })
            continue
        if not comparison_requested and name == "merchant_comparison" and isinstance(arguments.get("merchants"), list):
            for merchant in arguments["merchants"]:
                if isinstance(merchant, str) and merchant.strip():
                    normalized.append({"name": "merchant_analysis", "arguments": {"merchant": merchant.strip()}})
            continue
        normalized.append({"name": name, "arguments": arguments})
    return normalized


def create_agent_run_id() -> str:
    return "ar_" + secrets.token_urlsafe(18)


def _base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _base64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _signing_secret() -> bytes | None:
    secret = os.environ.get("OI_SESSION_SECRET", "")
    return secret.encode("utf-8") if secret else None


def issue_plan_proof(agent_run_id: str, question: str, calls: list[dict], expires_at: int) -> str | None:
    secret = _signing_secret()
    if secret is None:
        return None
    normalized_calls = []
    for call in calls:
        arguments, error = validate_tool_arguments(call.get("name"), call.get("arguments"))
        if error:
            return None
        normalized_calls.append({
            "id": str(call["id"]),
            "name": str(call["name"]),
            "argumentsHash": _hash_value(arguments),
        })
    round_match = re.match(r"^r(\d+)c", str(normalized_calls[0]["id"])) if normalized_calls else None
    round_number = int(round_match.group(1)) if round_match else 1
    payload = {
        "version": AGENT_TOOL_REGISTRY_VERSION,
        "agentRunId": agent_run_id,
        "questionHash": _hash_question(question),
        "round": round_number,
        "expiresAt": int(expires_at),
        "calls": normalized_calls,
    }
    encoded = _base64url(_canonical_json(payload).encode("utf-8"))
    signature = hmac.new(secret, (_SIGNING_PURPOSE + encoded).encode("ascii"), hashlib.sha256).digest()
    return encoded + "." + _base64url(signature)


def _decode_and_verify_proof(token: str) -> dict | None:
    secret = _signing_secret()
    if secret is None or not isinstance(token, str):
        return None
    pieces = token.split(".")
    if len(pieces) != 2:
        return None
    encoded, supplied_signature = pieces
    try:
        expected_signature = hmac.new(secret, (_SIGNING_PURPOSE + encoded).encode("ascii"), hashlib.sha256).digest()
        actual_signature = _base64url_decode(supplied_signature)
        payload = json.loads(_base64url_decode(encoded).decode("utf-8"))
    except (ValueError, TypeError, UnicodeError, json.JSONDecodeError):
        return None
    if not hmac.compare_digest(expected_signature, actual_signature):
        return None
    if not isinstance(payload, dict):
        return None
    return payload


def verify_plan_proof(token: str, agent_run_id: str, question: str, now: int | None = None) -> dict | None:
    payload = _decode_and_verify_proof(token)
    if payload is None:
        return None
    current_time = int(time.time()) if now is None else int(now)
    if payload.get("version") != AGENT_TOOL_REGISTRY_VERSION:
        return None
    if payload.get("agentRunId") != agent_run_id or payload.get("questionHash") != _hash_question(question):
        return None
    if not isinstance(payload.get("expiresAt"), int) or payload["expiresAt"] <= current_time:
        return None
    calls = payload.get("calls")
    if not isinstance(calls, list) or len(calls) > AGENT_MAX_TOOL_CALLS:
        return None
    seen = set()
    for call in calls:
        if not isinstance(call, dict) or set(call) != {"id", "name", "argumentsHash"}:
            return None
        if not isinstance(call["id"], str) or not AGENT_CALL_ID_PATTERN.fullmatch(call["id"]):
            return None
        if call["id"] in seen or call["name"] not in AGENT_TOOL_NAMES:
            return None
        if not isinstance(call["argumentsHash"], str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", call["argumentsHash"]):
            return None
        seen.add(call["id"])
    return payload


def normalize_planning_result(
    result: dict,
    request: dict,
    agent_run_id: str,
    round_number: int,
) -> tuple[dict | None, dict | None]:
    if not isinstance(result, dict):
        return None, _error("invalid_agent_contract", "providerResult")
    raw_calls = result.get("tool_calls")
    if raw_calls is None:
        raw_calls = result.get("toolCalls")
    normalized_calls = normalize_planning_tool_calls(
        raw_calls if isinstance(raw_calls, list) else [],
        request["question"],
        round_number,
    )
    if len(normalized_calls) > AGENT_MAX_TOOL_CALLS:
        return None, _error("invalid_arguments", "toolCalls")

    calls = []
    for index, call in enumerate(normalized_calls, start=1):
        name = call.get("name") if isinstance(call, dict) else None
        if name not in request["enabledTools"]:
            return None, _error("unsupported_tool", "toolCalls.name")
        arguments, error = validate_tool_arguments(name, call.get("arguments"))
        if error:
            return None, error
        calls.append({
            "id": "r%dc%d" % (round_number, index),
            "name": name,
            "arguments": arguments,
        })

    content = result.get("content")
    if content is not None and not isinstance(content, str):
        return None, _error("invalid_agent_contract", "content")
    if isinstance(content, str):
        content = content.strip()[:8000]
    finish_reason = result.get("finishReason")
    if finish_reason not in {"tool_calls", "stop"}:
        finish_reason = "tool_calls" if calls else "stop"
    response = {
        "ok": True,
        "contractVersion": AGENT_CONTRACT_VERSION,
        "registryVersion": AGENT_TOOL_REGISTRY_VERSION,
        "agentRunId": agent_run_id,
        "content": content or None,
        "toolCalls": calls,
        "finishReason": finish_reason,
    }
    if calls:
        proof = issue_plan_proof(
            agent_run_id,
            request["question"],
            calls,
            int(time.time()) + AGENT_PLAN_PROOF_TTL_SECONDS,
        )
        if proof is None:
            return None, _error("agent_signing_unavailable", "OI_SESSION_SECRET", 503)
        response["planProof"] = proof
    return response, None


def _validate_context(value: Any) -> tuple[dict | None, dict | None]:
    if value is None:
        return {"memory": "", "history": []}, None
    if not isinstance(value, dict) or any(key not in {"memory", "history"} for key in value):
        return None, _error("invalid_agent_contract", "context")
    memory = value.get("memory", "")
    if not isinstance(memory, str) or len(memory.strip()) > AGENT_CONTEXT_MEMORY_MAX_CHARS:
        return None, _error("invalid_agent_contract", "context.memory")
    history = value.get("history", [])
    if not isinstance(history, list) or len(history) > AGENT_CONTEXT_HISTORY_LIMIT:
        return None, _error("invalid_agent_contract", "context.history")
    cleaned_history = []
    for item in history:
        if not isinstance(item, dict) or set(item) != {"role", "content"}:
            return None, _error("invalid_agent_contract", "context.history")
        if item["role"] not in {"user", "assistant"}:
            return None, _error("invalid_agent_contract", "context.history.role")
        content, error = _safe_text(item["content"], "context.history.content", AGENT_CONTEXT_MESSAGE_MAX_CHARS)
        if error:
            return None, error
        cleaned_history.append({"role": item["role"], "content": content})
    return {"memory": memory.strip(), "history": cleaned_history}, None


def validate_synthesis_request(body: object) -> tuple[dict | None, dict | None]:
    if not isinstance(body, dict):
        return None, _error("invalid_agent_contract", "body")
    if body.get("contractVersion") != AGENT_CONTRACT_VERSION:
        return None, _error("agent_contract_version_required", "contractVersion")
    if any(key not in _ALLOWED_SYNTHESIS_KEYS for key in body):
        return None, _error("invalid_agent_contract", "body")
    agent_run_id, error = _safe_text(body.get("agentRunId"), "agentRunId", 128)
    if error or not AGENT_RUN_ID_PATTERN.fullmatch(agent_run_id or ""):
        return None, _error("invalid_agent_contract", "agentRunId")
    question, error = _safe_text(body.get("question"), "question", AGENT_PROMPT_MAX_CHARS)
    if error:
        return None, error
    language = body.get("language", "zh")
    if language not in ("zh", "en"):
        return None, _error("invalid_agent_contract", "language")
    proofs = body.get("planProofs", [])
    if not isinstance(proofs, list) or len(proofs) > AGENT_MAX_PLAN_PROOFS:
        return None, _error("invalid_agent_contract", "planProofs")
    cleaned_proofs = []
    for proof in proofs:
        if not isinstance(proof, str) or not 1 <= len(proof) <= 8192:
            return None, _error("invalid_agent_contract", "planProofs")
        cleaned_proofs.append(proof)
    context, error = _validate_context(body.get("context"))
    if error:
        return None, error
    raw_results = body.get("toolResults", [])
    if not isinstance(raw_results, list) or len(raw_results) > AGENT_MAX_TOOL_CALLS:
        return None, _error("invalid_agent_contract", "toolResults")
    cleaned_results = []
    seen_call_ids = set()
    for item in raw_results:
        if not isinstance(item, dict) or set(item) != {"callId", "toolName", "arguments", "result"}:
            return None, _error("invalid_tool_result", "toolResults")
        call_id, error = _safe_text(item["callId"], "toolResults.callId", 128)
        if error or not AGENT_CALL_ID_PATTERN.fullmatch(call_id or "") or call_id in seen_call_ids:
            return None, _error("invalid_tool_result", "toolResults.callId")
        tool_name, error = _safe_text(item["toolName"], "toolResults.toolName", 64)
        if error or tool_name not in AGENT_TOOL_NAMES:
            return None, _error("unsupported_tool", "toolResults.toolName")
        arguments, error = validate_tool_arguments(tool_name, item["arguments"])
        if error:
            return None, error
        result, error = validate_tool_result(tool_name, item["result"])
        if error:
            return None, error
        seen_call_ids.add(call_id)
        cleaned_results.append({
            "callId": call_id,
            "toolName": tool_name,
            "arguments": arguments,
            "result": result,
        })
    trace, error = _validate_trace(body.get("trace"), "synthesis")
    if error:
        return None, error
    return {
        "contractVersion": AGENT_CONTRACT_VERSION,
        "agentRunId": agent_run_id,
        "planProofs": cleaned_proofs,
        "question": question,
        "language": language,
        "context": context,
        "toolResults": cleaned_results,
        "trace": trace,
    }, None


def validate_bound_tool_results(request: dict) -> tuple[list[dict] | None, dict | None]:
    proofs = request.get("planProofs") or []
    proof_calls: dict[str, dict] = {}
    for proof in proofs:
        payload = verify_plan_proof(proof, request["agentRunId"], request["question"])
        if payload is None:
            return None, _error("run_binding_failed", "planProofs", 409)
        for call in payload["calls"]:
            if call["id"] in proof_calls:
                return None, _error("run_binding_failed", "planProofs", 409)
            proof_calls[call["id"]] = call
    if request.get("toolResults") and not proof_calls:
        return None, _error("run_binding_failed", "planProofs", 409)

    validated = []
    for item in request.get("toolResults", []):
        expected = proof_calls.get(item["callId"])
        if expected is None or expected["name"] != item["toolName"]:
            return None, _error("run_binding_failed", "toolResults.callId", 409)
        if expected["argumentsHash"] != _hash_value(item["arguments"]):
            return None, _error("run_binding_failed", "toolResults.arguments", 409)
        validated.append(item)
    return validated, None


def _context_text(context: dict, language: str) -> str:
    lines = []
    if context.get("memory"):
        lines.append(context["memory"])
    for item in context.get("history", []):
        label = "助手" if item["role"] == "assistant" and language == "zh" else "用户" if language == "zh" else item["role"].title()
        lines.append("[" + label + "] " + item["content"])
    return "\n\n".join(lines)


def build_synthesis_messages(request: dict, validated_results: list[dict]) -> list[dict]:
    messages = []
    context_text = _context_text(request["context"], request["language"])
    if context_text:
        label = "[不可信用户上下文]" if request["language"] == "zh" else "[Untrusted user context]"
        messages.append({"role": "user", "content": label + "\n" + context_text})

    question_label = "[当前问题]" if request["language"] == "zh" else "[Current question]"
    messages.append({"role": "user", "content": question_label + "\n" + request["question"]})

    result_payload = []
    for item in validated_results:
        result_payload.append({
            "callId": item["callId"],
            "toolName": item["toolName"],
            "result": item["result"],
        })
    result_label = "[已验证调用绑定的工具结果]" if request["language"] == "zh" else "[Bound tool results]"
    messages.append({
        "role": "user",
        "content": result_label + "\n" + _canonical_json(result_payload),
    })

    expected_count = 0
    for proof in request.get("planProofs", []):
        payload = _decode_and_verify_proof(proof)
        if payload and isinstance(payload.get("calls"), list):
            expected_count += len(payload["calls"])
    if expected_count > len(validated_results):
        partial = (
            "工具执行结果不完整；只能引用已返回的结果，并明确说明缺少数据。"
            if request["language"] == "zh"
            else "Tool execution was partial; cite only returned results and state which data is missing."
        )
        messages.append({"role": "user", "content": partial})
    return messages
