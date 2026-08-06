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

import os
import sys
import time
from typing import Any, Generator

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
    """
    provider = _provider()
    api_key = _api_key()
    if not api_key:
        print(f"[llm_provider] {provider}: API key is not set — stream_chat skipped", file=sys.stderr)
        return

    if timeout is None:
        timeout = stream_timeout()

    deadline = time.monotonic() + timeout

    history_count = len(history) if history else 0
    print(
        f"[llm_provider] → stream {provider} {_model_name()} "
        f"timeout={timeout}s temp={temperature} max_tokens={max_tokens} "
        f"user_len={len(user_message)} history={history_count}",
        file=sys.stderr,
    )

    try:
        if provider == "deepseek":
            from openai import OpenAI

            client = OpenAI(
                api_key=api_key,
                base_url=DEEPSEEK_BASE_URL,
                timeout=timeout,
                max_retries=0,
            )
            messages = [{"role": "system", "content": system_prompt}]
            if history:
                for msg in history:
                    messages.append({"role": msg["role"], "content": msg["content"]})
            messages.append({"role": "user", "content": user_message})

            response = client.chat.completions.create(
                model=_model_name(),
                max_tokens=max_tokens,
                temperature=temperature,
                stream=True,
                messages=messages,
            )
            for chunk in response:
                if time.monotonic() >= deadline:
                    print(
                        f"[llm_provider] stream {provider}: deadline reached after {timeout}s",
                        file=sys.stderr,
                    )
                    return
                if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        else:
            import anthropic

            client = anthropic.Anthropic(api_key=api_key, timeout=timeout, max_retries=0)
            messages = []
            if history:
                for msg in history:
                    messages.append({"role": msg["role"], "content": msg["content"]})
            messages.append({"role": "user", "content": user_message})

            with client.messages.stream(
                model=_model_name(),
                max_tokens=max_tokens,
                temperature=temperature,
                system=system_prompt,
                messages=messages,
            ) as stream:
                for text in stream.text_stream:
                    if time.monotonic() >= deadline:
                        print(
                            f"[llm_provider] stream {provider}: deadline reached after {timeout}s",
                            file=sys.stderr,
                        )
                        return
                    yield text

        print(f"[llm_provider] ← stream {provider} complete", file=sys.stderr)

    except Exception as exc:
        print(f"[llm_provider] stream {provider}: error — {exc}", file=sys.stderr)
        # Yield nothing on error — caller handles via [DONE] or error event
