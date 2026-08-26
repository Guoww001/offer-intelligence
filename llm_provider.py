"""LLM provider abstraction — DeepSeek / Claude switching, API keys, model config.

This module has NO dependency on skills/ or llm_classify.  It is imported by
both ``llm_classify.py`` (the orchestrator) and ``skills/analysis_text.py``
(the analysis skill), avoiding the circular-import problem that existed when
everything lived in ``llm_classify.py``.

To add a new provider:
1. Add constants above.
2. Extend ``_provider()`` to recognise the new name.
3. Add ``_classify_<provider>()`` and a branch in ``_call_llm()``.
"""

from __future__ import annotations

import json
import os
import sys
import time
from typing import Any, Callable, Generator

DEFAULT_PROVIDER = "deepseek"
DEFAULT_MODEL_DEEPSEEK = "deepseek-chat"
DEFAULT_MODEL_CLAUDE = "claude-haiku-3-5-latest"
DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEFAULT_STREAM_TIMEOUT = 50.0
MIN_STREAM_TIMEOUT = 5.0
MAX_STREAM_TIMEOUT = 50.0


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


def _usage_value(usage: Any, *names: str) -> int | None:
    if usage is None:
        return None
    for name in names:
        if isinstance(usage, dict):
            value = usage.get(name)
        else:
            value = getattr(usage, name, None)
        if value in (None, ""):
            continue
        try:
            number = int(value)
        except (TypeError, ValueError):
            continue
        if number >= 0:
            return number
    return None


def normalize_usage_metadata(usage: Any, provider: str) -> dict[str, Any]:
    """归一化 OpenAI-compatible 与 Anthropic usage，不保存原始响应。"""
    if provider == "claude":
        input_tokens = _usage_value(usage, "input_tokens", "prompt_tokens")
        output_tokens = _usage_value(usage, "output_tokens", "completion_tokens")
        total_tokens = _usage_value(usage, "total_tokens")
    else:
        input_tokens = _usage_value(usage, "prompt_tokens", "input_tokens")
        output_tokens = _usage_value(usage, "completion_tokens", "output_tokens")
        total_tokens = _usage_value(usage, "total_tokens")
    if total_tokens is None and input_tokens is not None and output_tokens is not None:
        total_tokens = input_tokens + output_tokens
    available = input_tokens is not None or output_tokens is not None or total_tokens is not None
    if not available:
        input_tokens = output_tokens = total_tokens = None
    return {
        "usageAvailable": available,
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "totalTokens": total_tokens,
    }


def _controlled_error_code(error: BaseException | None) -> str:
    if error is None:
        return "unknown"
    if isinstance(error, TimeoutError) or "timeout" in type(error).__name__.lower():
        return "llm_timeout"
    if isinstance(error, (ConnectionError, BrokenPipeError, ConnectionResetError)):
        return "network_error"
    return "provider_error"


def _llm_metadata(
    provider: str,
    model: str,
    usage: Any = None,
    *,
    ok: bool,
    error_code: str | None = None,
    finish_reason: str | None = None,
    output_chunks: int | None = None,
) -> dict[str, Any]:
    result = {
        "ok": bool(ok),
        "provider": provider,
        "model": model,
        "errorCode": error_code,
        "finishReason": finish_reason,
    }
    result.update(normalize_usage_metadata(usage, provider))
    if output_chunks is not None:
        result["outputChunks"] = max(0, int(output_chunks))
    return result


def _default_timeout() -> float:
    try:
        return float(os.environ.get("OI_LLM_TIMEOUT", "15").strip())
    except ValueError:
        return 15.0


def stream_timeout() -> float:
    """Return a bounded streaming deadline that stays below Vercel's 60s cap."""
    try:
        value = float(
            os.environ.get("OI_LLM_STREAM_TIMEOUT", str(DEFAULT_STREAM_TIMEOUT)).strip()
        )
    except ValueError:
        value = DEFAULT_STREAM_TIMEOUT
    return min(MAX_STREAM_TIMEOUT, max(MIN_STREAM_TIMEOUT, value))


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


def call_llm(
    system_prompt: str,
    user_message: str,
    max_tokens: int = 300,
    timeout: float | None = None,
    temperature: float = 0.3,
) -> str | None:
    """Call the configured LLM provider with the given prompts.

    This is the single shared LLM call path used by both intent classification
    and analysis text generation.  All provider / timeout / error-handling logic
    lives here.

    Returns the response text, or None if the call fails.
    """
    provider = _provider()
    api_key = _api_key()
    if not api_key:
        print(f"[llm_provider] {provider}: API key is not set", file=sys.stderr)
        return None

    if timeout is None:
        timeout = _default_timeout()

    # Rough token estimate: ~4 chars per token for English/Chinese mix
    system_len = len(system_prompt)
    user_len = len(user_message)
    est_input_tokens = (system_len + user_len) // 3
    print(
        f"[llm_provider] → {provider} {_model_name()} "
        f"est_input={est_input_tokens}tok "
        f"(sys={system_len}chars + user={user_len}chars) "
        f"max_output={max_tokens}tok",
        file=sys.stderr,
    )

    try:
        if provider == "deepseek":
            from openai import OpenAI
            client = OpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL, timeout=timeout)
            response = client.chat.completions.create(
                model=_model_name(),
                max_tokens=max_tokens,
                temperature=temperature,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
            )
            usage = getattr(response, "usage", None)
            if usage:
                print(
                    f"[llm_provider] ← {provider} "
                    f"prompt_tokens={usage.prompt_tokens} "
                    f"completion_tokens={usage.completion_tokens} "
                    f"total_tokens={usage.total_tokens}",
                    file=sys.stderr,
                )
            else:
                print(f"[llm_provider] ← {provider} (no usage data)", file=sys.stderr)
            return response.choices[0].message.content or ""
        else:
            import anthropic
            client = anthropic.Anthropic(api_key=api_key, timeout=timeout)
            message = client.messages.create(
                model=_model_name(),
                max_tokens=max_tokens,
                temperature=temperature,
                timeout=timeout,
                system=system_prompt,
                messages=[{"role": "user", "content": user_message}],
            )
            usage = getattr(message, "usage", None)
            if usage:
                print(
                    f"[llm_provider] ← {provider} "
                    f"input_tokens={usage.input_tokens} "
                    f"output_tokens={usage.output_tokens}",
                    file=sys.stderr,
                )
            else:
                print(f"[llm_provider] ← {provider} (no usage data)", file=sys.stderr)
            return "".join(
                block.text for block in message.content if getattr(block, "type", None) == "text"
            )
    except Exception as exc:
        print(f"[llm_provider] {provider}: error — {exc}", file=sys.stderr)
        return None


def stream_chat(
    user_message: str,
    system_prompt: str,
    max_tokens: int = 1024,
    timeout: float | None = None,
    temperature: float = 0.7,
    history: list | None = None,
    messages: list | None = None,
    on_complete: Callable[[dict[str, Any]], None] | None = None,
) -> Generator[str, None, None] | None:
    """Stream a chat completion token by token from the configured LLM provider.

    Yields individual text tokens as the model generates them.
    Returns None (no tokens) if the API key is missing.

    Args:
        user_message: The user's prompt text.
        system_prompt: System-level instructions for the model.
        max_tokens: Maximum output tokens.
        timeout: API call timeout in seconds. Defaults to a bounded 50-second
            deadline so the handler can finish before Vercel's 60-second cap.
        temperature: Sampling temperature.
        history: Optional list of {role, content} dicts for conversation context.
        messages: Optional full message list ({role, content}) that replaces
            ``user_message`` and ``history`` when provided (agent synthesis).
    """
    provider = _provider()
    model = _model_name()
    api_key = _api_key()
    callback_called = False

    def notify_complete(
        usage: Any = None,
        *,
        error_code: str | None = None,
        finish_reason: str | None = None,
        output_chunks: int | None = None,
    ) -> None:
        nonlocal callback_called
        if callback_called:
            return
        callback_called = True
        if on_complete is None:
            return
        metadata = _llm_metadata(
            provider,
            model,
            usage,
            ok=error_code is None,
            error_code=error_code,
            finish_reason=finish_reason,
            output_chunks=output_chunks,
        )
        try:
            on_complete(metadata)
        except Exception as callback_error:
            print(f"[llm_provider] stream completion callback failed: {type(callback_error).__name__}", file=sys.stderr)

    if not api_key:
        print(f"[llm_provider] {provider}: API key is not set — stream_chat skipped", file=sys.stderr)
        notify_complete(error_code="llm_unavailable")
        return

    if timeout is None:
        timeout = stream_timeout()

    deadline = time.monotonic() + timeout
    history_count = len(history) if history else 0
    print(
        f"[llm_provider] → stream {provider} {model} "
        f"timeout={timeout}s temp={temperature} max_tokens={max_tokens} "
        f"user_len={len(user_message)} history={history_count}",
        file=sys.stderr,
    )

    content_chunks = 0
    reasoning_chunks = 0
    finish_reasons = []
    usage = None
    try:
        if provider == "deepseek":
            from openai import OpenAI

            client = OpenAI(
                api_key=api_key,
                base_url=DEEPSEEK_BASE_URL,
                timeout=timeout,
                max_retries=0,
            )
            if messages is not None:
                final_messages = [{"role": "system", "content": system_prompt}]
                for msg in messages:
                    final_messages.append({"role": msg["role"], "content": msg["content"]})
            else:
                final_messages = [{"role": "system", "content": system_prompt}]
                if history:
                    for msg in history:
                        final_messages.append({"role": msg["role"], "content": msg["content"]})
                final_messages.append({"role": "user", "content": user_message})

            request_options = {
                "model": model,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "stream": True,
                "messages": final_messages,
                "stream_options": {"include_usage": True},
            }
            if messages is not None and model.lower().startswith("deepseek-v4"):
                request_options["extra_body"] = {"thinking": {"type": "disabled"}}
            response = client.chat.completions.create(**request_options)
            for chunk in response:
                if time.monotonic() >= deadline:
                    print(
                        f"[llm_provider] stream {provider}: deadline reached after {timeout}s",
                        file=sys.stderr,
                    )
                    notify_complete(usage, error_code="llm_timeout", output_chunks=content_chunks)
                    return
                chunk_usage = getattr(chunk, "usage", None)
                if chunk_usage is not None:
                    usage = chunk_usage
                choices = getattr(chunk, "choices", None) or []
                if choices and choices[0].delta and choices[0].delta.content:
                    content_chunks += 1
                    yield choices[0].delta.content
                if choices:
                    choice = choices[0]
                    finish_reason = getattr(choice, "finish_reason", None)
                    if finish_reason:
                        finish_reasons.append(finish_reason)
                    delta = choice.delta
                    reasoning = getattr(delta, "reasoning_content", None)
                    if not reasoning:
                        extra = getattr(delta, "model_extra", None) or {}
                        reasoning = extra.get("reasoning_content")
                    if reasoning:
                        reasoning_chunks += 1
        else:
            import anthropic

            client = anthropic.Anthropic(api_key=api_key, timeout=timeout, max_retries=0)
            if messages is not None:
                claude_messages = [
                    {"role": msg["role"], "content": msg["content"]} for msg in messages
                ]
            else:
                claude_messages = []
                if history:
                    for msg in history:
                        claude_messages.append({"role": msg["role"], "content": msg["content"]})
                claude_messages.append({"role": "user", "content": user_message})

            with client.messages.stream(
                model=model,
                max_tokens=max_tokens,
                temperature=temperature,
                system=system_prompt,
                messages=claude_messages,
            ) as stream:
                for text in stream.text_stream:
                    if time.monotonic() >= deadline:
                        print(
                            f"[llm_provider] stream {provider}: deadline reached after {timeout}s",
                            file=sys.stderr,
                        )
                        notify_complete(usage, error_code="llm_timeout", output_chunks=content_chunks)
                        return
                    if text:
                        content_chunks += 1
                        yield text
                final_message = None
                get_final_message = getattr(stream, "get_final_message", None)
                if callable(get_final_message):
                    final_message = get_final_message()
                usage = getattr(final_message, "usage", None) or getattr(stream, "usage", None)

        print(
            f"[llm_provider] ← {provider} complete content_chunks={content_chunks} "
            f"reasoning_chunks={reasoning_chunks} finish={finish_reasons or ['unknown']}",
            file=sys.stderr,
        )
        notify_complete(
            usage,
            finish_reason=finish_reasons[-1] if finish_reasons else None,
            output_chunks=content_chunks,
        )
    except Exception as exc:
        print(f"[llm_provider] stream {provider}: error — {type(exc).__name__}", file=sys.stderr)
        notify_complete(usage, error_code=_controlled_error_code(exc), output_chunks=content_chunks)
        # Yield nothing on error — caller handles via [DONE] or error event


def _parse_tool_arguments(raw: str) -> dict:
    """Parse a tool-call arguments JSON string, tolerating malformed output."""
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        return {"_raw": raw, "_parse_error": True}
    if not isinstance(parsed, dict):
        return {"_raw": raw, "_parse_error": True}
    return parsed


def normalize_tool_response(provider: str, payload) -> dict | None:
    """Normalize a provider tool-call payload into {content, tool_calls}.

    ``payload`` is the completion message for deepseek, or the content list
    for claude.  ``tool_calls`` entries are {id, name, arguments(dict)}.
    """
    if provider == "deepseek":
        content = getattr(payload, "content", None) or None
        tool_calls = []
        for call in getattr(payload, "tool_calls", None) or []:
            fn = getattr(call, "function", None)
            if fn is None:
                continue
            tool_calls.append(
                {
                    "id": getattr(call, "id", "") or "",
                    "name": getattr(fn, "name", "") or "",
                    "arguments": _parse_tool_arguments(getattr(fn, "arguments", "") or ""),
                }
            )
        return {"content": content, "tool_calls": tool_calls}
    if provider == "claude":
        blocks = payload or []
        content = "".join(
            getattr(block, "text", "") or ""
            for block in blocks
            if getattr(block, "type", None) == "text"
        ) or None
        tool_calls = []
        for block in blocks:
            if getattr(block, "type", None) != "tool_use":
                continue
            tool_calls.append(
                {
                    "id": getattr(block, "id", "") or "",
                    "name": getattr(block, "name", "") or "",
                    "arguments": dict(getattr(block, "input", {}) or {}),
                }
            )
        return {"content": content, "tool_calls": tool_calls}
    return None


def call_llm_tools(
    messages: list,
    tools: list,
    max_tokens: int = 300,
    timeout: float | None = None,
    temperature: float = 0.1,
    return_metadata: bool = False,
) -> dict | None:
    """Single non-streaming LLM call that may return tool calls.

    ``messages`` is an OpenAI-style list of {role, content} dicts (roles:
    system/user/assistant only — this project never sends tool-role messages).
    ``tools`` is a list of {"name", "description", "parameters"} dicts.

    Returns {"content": str|None, "tool_calls": [...]} or None on failure.
    When ``return_metadata=True``, returns the compatible fields plus controlled
    provider/model/usage metadata and ``ok``/``errorCode``.
    """
    provider = _provider()
    model = _model_name()
    api_key = _api_key()
    if not api_key:
        print(f"[llm_provider] {provider}: API key is not set — call_llm_tools skipped", file=sys.stderr)
        if return_metadata:
            return _llm_metadata(provider, model, ok=False, error_code="llm_unavailable")
        return None
    if timeout is None:
        timeout = _default_timeout()

    try:
        if provider == "deepseek":
            from openai import OpenAI

            client = OpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL, timeout=timeout, max_retries=0)
            response = client.chat.completions.create(
                model=model,
                max_tokens=max_tokens,
                temperature=temperature,
                messages=messages,
                tools=[{"type": "function", "function": tool} for tool in tools],
                tool_choice="auto",
            )
            normalized = normalize_tool_response("deepseek", response.choices[0].message)
            if not return_metadata:
                return normalized
            metadata = _llm_metadata(provider, model, getattr(response, "usage", None), ok=True)
            metadata.update(normalized or {"content": None, "tool_calls": []})
            return metadata

        import anthropic

        client = anthropic.Anthropic(api_key=api_key, timeout=timeout, max_retries=0)
        claude_tools = [
            {
                "name": tool.get("name"),
                "description": tool.get("description") or "",
                "input_schema": tool.get("parameters") or {"type": "object", "properties": {}},
            }
            for tool in tools
        ]
        system = next(
            (m["content"] for m in messages if m.get("role") == "system"),
            None,
        )
        claude_messages = [
            {"role": m["role"], "content": m["content"]}
            for m in messages
            if m.get("role") != "system"
        ]
        message = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            timeout=timeout,
            system=system or "",
            tools=claude_tools,
            messages=claude_messages,
        )
        normalized = normalize_tool_response("claude", message.content)
        if not return_metadata:
            return normalized
        metadata = _llm_metadata(provider, model, getattr(message, "usage", None), ok=True)
        metadata.update(normalized or {"content": None, "tool_calls": []})
        return metadata
    except Exception as exc:
        print(f"[llm_provider] {provider}: tool call error — {type(exc).__name__}", file=sys.stderr)
        if return_metadata:
            return _llm_metadata(provider, model, ok=False, error_code=_controlled_error_code(exc))
        return None
