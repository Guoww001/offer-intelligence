# Chat Mode Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Chat Mode 升级为工具调用型 Agent：用户问「Shokz 的在同品类的表现」时，前端自动规划 → 调用 `merchant_analysis`/`category_analysis` 工具（复用现有 `analyzeMerchant`/`analyzeCategory`）→ 基于工具结果流式生成回答，LLM 不可用时完整降级回现有单发路径。

**Architecture:** 前端循环 + 后端 LLM 工具调用。新增非流式端点 `POST /api/chat/agent`（规划步，服务端 `llm_provider.call_llm_tools()` 支持 DeepSeek/Claude function calling）；工具在浏览器执行并压缩为紧凑 JSON 文本；综合步复用 `/api/chat/stream` 的 SSE（新增可选 `messages` 数组分支）。现有 prompt+memory 单发路径代码不动。

**Tech Stack:** Vanilla JS（`public/app.js` IIFE）、Python `http.server`/Vercel Serverless、DeepSeek（OpenAI 兼容 SDK）/Claude（Anthropic SDK）、Node VM 沙箱测试（`scripts/test_chatbot_intent_flow.mjs` 范式）。

**设计依据:** `docs/superpowers/specs/2026-08-14-chat-mode-agent-design.md`（已获用户批准）。

## Global Constraints

- 现有 `/api/chat/stream` 的 prompt+memory 路径**零行为变化**：`messages` 为可选参数，缺失时走原逻辑。
- 限制常量：请求体 ≤32768 字节（agent）/ 65536 字节（stream）；规划超时 30.0s；循环 ≤2 规划轮；单轮工具 ≤4 个；总计 ≤6 次工具调用；单工具结果序列化 ≤6000 字符。
- 新环境变量 `OI_AGENT_ENABLED`（默认开，`0/false/no/off` 关闭）；与 `OI_LLM_ENABLED` 同一暴露机制（`auth.py` → session payload → `auth.js` → `window.__OI_AGENT_ENABLED`）。
- 前端开关语义：`state.agentEnabled = window.__OI_AGENT_ENABLED !== false;`（未定义视为开）。
- 本地命令在项目根目录执行（Windows PowerShell / Git Bash 均可，测试命令语法相同）；CI 用 ubuntu-latest + node 22 + python 3.12。
- **Git 提交步骤仅在用户明确授权提交时执行**；跳过时记录为"未提交"。提交信息按仓库双语规范（`<English summary> / <中文摘要>`）。
- 不新增 npm/pip 依赖；不修改 `skills/*`、`llm_classify.py`、Report Mode 渲染、记忆栏逻辑。
- 每处 LLM 交互都必须有降级路径；任何任务完成后运行该任务列出的验证命令并确认输出。
- `public/app.js` 是 ~25k 行的 IIFE：**永远不要整文件读取**，只按本计划给出的锚点行号/锚点文本做插入和替换。

---

### Task 1: `llm_provider.py` — 工具调用与响应归一化

**Files:**
- Modify: `llm_provider.py`（顶部 import 区 + 文件末尾追加）
- Create: `scripts/test_llm_agent.py`

**Interfaces:**
- Consumes: 现有 `_provider()` / `_api_key()` / `_model_name()` / `_default_timeout()` / `DEEPSEEK_BASE_URL`
- Produces:
  - `normalize_tool_response(provider: str, payload) -> dict | None`：`{"content": str|None, "tool_calls": [{"id","name","arguments"}]}`
  - `call_llm_tools(messages: list, tools: list, max_tokens=300, timeout=None, temperature=0.1) -> dict | None`：失败返回 `None`；`tools` 元素为 `{"name","description","parameters"}`

- [ ] **Step 1: 写失败测试**

创建 `scripts/test_llm_agent.py`：

```python
import importlib.util
import os
from pathlib import Path
import sys
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

spec = importlib.util.spec_from_file_location("llm_provider", ROOT / "llm_provider.py")
llm_provider = importlib.util.module_from_spec(spec)
spec.loader.exec_module(llm_provider)


def test_normalize_deepseek_tool_calls():
    message = SimpleNamespace(
        content=None,
        tool_calls=[
            SimpleNamespace(id="c1", function=SimpleNamespace(name="merchant_analysis", arguments='{"merchant": "Shokz"}')),
            SimpleNamespace(id="c2", function=SimpleNamespace(name="category_analysis", arguments='{"category": "Electronics"}')),
        ],
    )
    result = llm_provider.normalize_tool_response("deepseek", message)
    assert result["content"] is None
    assert result["tool_calls"][0] == {"id": "c1", "name": "merchant_analysis", "arguments": {"merchant": "Shokz"}}
    assert result["tool_calls"][1]["arguments"] == {"category": "Electronics"}


def test_normalize_deepseek_invalid_json_arguments():
    message = SimpleNamespace(
        content="fallback text",
        tool_calls=[SimpleNamespace(id="c1", function=SimpleNamespace(name="merchant_analysis", arguments="{not json"))],
    )
    result = llm_provider.normalize_tool_response("deepseek", message)
    args = result["tool_calls"][0]["arguments"]
    assert args["_raw"] == "{not json" and args["_parse_error"] is True
    assert result["content"] == "fallback text"


def test_normalize_claude_tool_use():
    content = [
        SimpleNamespace(type="text", text="I will look that up."),
        SimpleNamespace(type="tool_use", id="t1", name="category_analysis", input={"category": "Electronics"}),
    ]
    result = llm_provider.normalize_tool_response("claude", content)
    assert result["content"] == "I will look that up."
    assert result["tool_calls"] == [{"id": "t1", "name": "category_analysis", "arguments": {"category": "Electronics"}}]


def test_call_llm_tools_returns_none_without_api_key():
    old_provider = os.environ.get("OI_LLM_PROVIDER")
    old_key = os.environ.get("DEEPSEEK_API_KEY")
    os.environ["OI_LLM_PROVIDER"] = "deepseek"
    os.environ["DEEPSEEK_API_KEY"] = ""
    try:
        assert llm_provider.call_llm_tools([{"role": "user", "content": "hi"}], []) is None
    finally:
        if old_provider is None: os.environ.pop("OI_LLM_PROVIDER", None)
        else: os.environ["OI_LLM_PROVIDER"] = old_provider
        if old_key is None: os.environ.pop("DEEPSEEK_API_KEY", None)
        else: os.environ["DEEPSEEK_API_KEY"] = old_key


def test_call_llm_tools_deepseek_payload():
    captured = {}

    class FakeMessage:
        content = None
        tool_calls = [SimpleNamespace(id="c1", function=SimpleNamespace(name="merchant_analysis", arguments='{"merchant":"Shokz"}'))]

    class FakeResponse:
        choices = [SimpleNamespace(message=FakeMessage)]

    class FakeCompletions:
        def create(self, **kwargs):
            captured.update(kwargs)
            return FakeResponse()

    class FakeClient:
        chat = SimpleNamespace(completions=FakeCompletions())

    class FakeOpenAI:
        def __init__(self, **kwargs): pass

    fake_openai = SimpleNamespace(OpenAI=FakeOpenAI)
    sys.modules["openai"] = fake_openai
    old_provider = os.environ.get("OI_LLM_PROVIDER")
    old_key = os.environ.get("DEEPSEEK_API_KEY")
    os.environ["OI_LLM_PROVIDER"] = "deepseek"
    os.environ["DEEPSEEK_API_KEY"] = "test-key"
    try:
        result = llm_provider.call_llm_tools(
            [{"role": "system", "content": "sys"}, {"role": "user", "content": "Shokz 表现"}],
            [{"name": "merchant_analysis", "description": "d", "parameters": {"type": "object", "properties": {}}}],
        )
        assert result is not None and result["tool_calls"][0]["name"] == "merchant_analysis"
        assert captured["tools"][0] == {"type": "function", "function": {"name": "merchant_analysis", "description": "d", "parameters": {"type": "object", "properties": {}}}}
        assert captured["tool_choice"] == "auto"
        assert captured["messages"][0]["role"] == "system"
    finally:
        del sys.modules["openai"]
        if old_provider is None: os.environ.pop("OI_LLM_PROVIDER", None)
        else: os.environ["OI_LLM_PROVIDER"] = old_provider
        if old_key is None: os.environ.pop("DEEPSEEK_API_KEY", None)
        else: os.environ["DEEPSEEK_API_KEY"] = old_key


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"PASS {t.__name__}")
    print(f"OK {len(tests)} tests")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python scripts/test_llm_agent.py`
Expected: FAIL，报 `AttributeError: module 'llm_provider' has no attribute 'normalize_tool_response'`

- [ ] **Step 3: 实现 `llm_provider.py`**

在 `import os` 之后加 `import json`（当前第 16 行 `import os` 上方是 `from __future__ import annotations`）：

```python
import json
import os
```

在文件末尾（`stream_chat` 之后）追加：

```python
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
) -> dict | None:
    """Single non-streaming LLM call that may return tool calls.

    ``messages`` is an OpenAI-style list of {role, content} dicts (roles:
    system/user/assistant only — this project never sends tool-role messages).
    ``tools`` is a list of {"name", "description", "parameters"} dicts.

    Returns {"content": str|None, "tool_calls": [...]} or None on failure.
    """
    provider = _provider()
    api_key = _api_key()
    if not api_key:
        print(f"[llm_provider] {provider}: API key is not set — call_llm_tools skipped", file=sys.stderr)
        return None
    if timeout is None:
        timeout = _default_timeout()

    try:
        if provider == "deepseek":
            from openai import OpenAI

            client = OpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL, timeout=timeout, max_retries=0)
            response = client.chat.completions.create(
                model=_model_name(),
                max_tokens=max_tokens,
                temperature=temperature,
                messages=messages,
                tools=[{"type": "function", "function": tool} for tool in tools],
                tool_choice="auto",
            )
            return normalize_tool_response("deepseek", response.choices[0].message)

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
            model=_model_name(),
            max_tokens=max_tokens,
            temperature=temperature,
            timeout=timeout,
            system=system or "",
            tools=claude_tools,
            messages=claude_messages,
        )
        return normalize_tool_response("claude", message.content)
    except Exception as exc:
        print(f"[llm_provider] {provider}: tool call error — {exc}", file=sys.stderr)
        return None
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python scripts/test_llm_agent.py`
Expected: 5 行 PASS + `OK 5 tests`

- [ ] **Step 5: 回归检查**

Run: `python scripts/test_llm_stream_timeout.py && python -m py_compile llm_provider.py`
Expected: 均通过，无输出错误

- [ ] **Step 6: Commit（仅在用户授权提交时）**

```bash
git add llm_provider.py scripts/test_llm_agent.py
git commit -m "Add LLM tool-calling with provider normalization / 新增 LLM 工具调用与双厂商响应归一化"
```

---

### Task 2: `stream_chat()` 支持 `messages` 直传

**Files:**
- Modify: `llm_provider.py:191-294`（`stream_chat`）
- Modify: `scripts/test_llm_agent.py`（追加测试）

**Interfaces:**
- Consumes: Task 1 无依赖（本任务只改 `stream_chat`）
- Produces: `stream_chat(user_message, system_prompt, max_tokens=1024, timeout=None, temperature=0.7, history=None, messages=None)` — `messages` 为 OpenAI 风格 user/assistant 消息列表时，不再拼接 `user_message` 与 `history`，system prompt 照常前置

- [ ] **Step 1: 追加失败测试**

在 `scripts/test_llm_agent.py` 的 `main()` 之前追加：

```python
def test_stream_chat_messages_passthrough():
    captured = {}

    class FakeChunk:
        def __init__(self):
            self.choices = [SimpleNamespace(delta=SimpleNamespace(content="ok"))]

    class FakeStream:
        def __iter__(self):
            yield FakeChunk()
            return

    class FakeCompletions:
        def create(self, **kwargs):
            captured.update(kwargs)
            return FakeStream()

    class FakeClient:
        chat = SimpleNamespace(completions=FakeCompletions())

    class FakeOpenAI:
        def __init__(self, **kwargs): pass

    sys.modules["openai"] = SimpleNamespace(OpenAI=FakeOpenAI)
    old_provider = os.environ.get("OI_LLM_PROVIDER")
    old_key = os.environ.get("DEEPSEEK_API_KEY")
    os.environ["OI_LLM_PROVIDER"] = "deepseek"
    os.environ["DEEPSEEK_API_KEY"] = "test-key"
    try:
        tokens = list(llm_provider.stream_chat(
            "ignored",
            "sys",
            messages=[{"role": "user", "content": "Q"}, {"role": "assistant", "content": "A"}],
        ))
        assert tokens == ["ok"]
        sent = captured["messages"]
        assert sent[0] == {"role": "system", "content": "sys"}
        assert sent[1] == {"role": "user", "content": "Q"}
        assert sent[2] == {"role": "assistant", "content": "A"}
        assert len(sent) == 3  # user_message 未被追加
    finally:
        del sys.modules["openai"]
        if old_provider is None: os.environ.pop("OI_LLM_PROVIDER", None)
        else: os.environ["OI_LLM_PROVIDER"] = old_provider
        if old_key is None: os.environ.pop("DEEPSEEK_API_KEY", None)
        else: os.environ["DEEPSEEK_API_KEY"] = old_key
```

- [ ] **Step 2: 运行确认失败**

Run: `python scripts/test_llm_agent.py`
Expected: FAIL，`TypeError: stream_chat() got an unexpected keyword argument 'messages'`

- [ ] **Step 3: 修改 `stream_chat` 签名与消息组装**

`llm_provider.py:191`，签名行改为：

```python
def stream_chat(
    user_message: str,
    system_prompt: str,
    max_tokens: int = 1024,
    timeout: float | None = None,
    temperature: float = 0.7,
    history: list | None = None,
    messages: list | None = None,
) -> Generator[str, None, None] | None:
```

docstring 的 `history:` 行之后加一行：

```python
        messages: Optional full message list ({role, content}) that replaces
            ``user_message`` and ``history`` when provided (agent synthesis).
```

DeepSeek 分支（现第 242-246 行）整体替换为：

```python
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
```

并把 `create(...)` 调用中的 `messages=messages` 改为 `messages=final_messages`。

Claude 分支（现第 268-272 行）整体替换为：

```python
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
```

并把 `with client.messages.stream(...)` 调用中的 `messages=messages` 改为 `messages=claude_messages`。

- [ ] **Step 4: 运行确认通过**

Run: `python scripts/test_llm_agent.py`
Expected: 6 行 PASS + `OK 6 tests`

- [ ] **Step 5: 回归**

Run: `python scripts/test_llm_stream_timeout.py && python -m py_compile llm_provider.py`
Expected: 均通过

- [ ] **Step 6: Commit（仅在用户授权提交时）**

```bash
git add llm_provider.py scripts/test_llm_agent.py
git commit -m "Support message-list passthrough in stream_chat / stream_chat 支持消息列表直传"
```

---

### Task 3: `chat_agent_http.py` 共享模块 + `server.py` 本地路由

**Files:**
- Create: `chat_agent_http.py`
- Modify: `server.py`（import 区约第 64-66 行附近；`do_POST` 第 189 行 `/api/chat/analyze` 分支之后；`handle_chat_stream` 第 274 行之后加 messages 分支；类内追加 `_chat_stream_messages`）
- Create: `scripts/test_agent_http.py`

**Interfaces:**
- Consumes: `auth._read_json_body`, `auth.send_json`, `llm_provider.call_llm_tools`（Task 1）、`llm_provider.stream_chat`（Task 2）
- Produces:
  - `chat_agent_http.handle_agent_request(target) -> None`（鉴权由调用方完成；body ≤32768；返回 200 JSON `{ok, content, toolCalls, finishReason}` 或 `{ok:False,error}`）
  - `chat_agent_http.agent_planning_system_prompt(language) -> str`
  - `chat_agent_http.agent_synthesis_system_prompt(language) -> str`

- [ ] **Step 1: 写失败测试**

创建 `scripts/test_agent_http.py`：

```python
import importlib.util
from io import BytesIO
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

spec = importlib.util.spec_from_file_location("chat_agent_http", ROOT / "chat_agent_http.py")
chat_agent_http = importlib.util.module_from_spec(spec)
spec.loader.exec_module(chat_agent_http)


class FakeTarget:
    def __init__(self, payload=None):
        body = json.dumps(payload or {}).encode("utf-8")
        self.headers = {"Content-Length": str(len(body))}
        self.rfile = BytesIO(body)
        self.wfile = BytesIO()
        self.status = None
        self.response_headers = []

    def send_response(self, status):
        self.status = int(status)

    def send_header(self, name, value):
        self.response_headers.append((str(name), str(value)))

    def end_headers(self):
        return None


def response_json(target):
    return json.loads(target.wfile.getvalue().decode("utf-8"))


PLAN_FIXTURE = {
    "content": None,
    "tool_calls": [{"id": "c1", "name": "merchant_analysis", "arguments": {"merchant": "Shokz"}}],
}


def test_agent_request_returns_tool_calls():
    captured = {}

    def fake_call(messages, tools, **kwargs):
        captured["messages"] = messages
        captured["tools"] = tools
        return PLAN_FIXTURE

    chat_agent_http.call_llm_tools = fake_call
    target = FakeTarget({
        "messages": [{"role": "user", "content": "Shokz 表现"}],
        "tools": [{"name": "merchant_analysis", "description": "d", "parameters": {"type": "object"}}],
        "language": "zh",
    })
    chat_agent_http.handle_agent_request(target)
    payload = response_json(target)
    assert target.status == 200 and payload["ok"] is True
    assert payload["finishReason"] == "tool_calls"
    assert payload["toolCalls"] == PLAN_FIXTURE["tool_calls"]
    assert captured["messages"][0]["role"] == "system"
    assert captured["messages"][-1]["content"] == "Shokz 表现"


def test_agent_request_llm_unavailable():
    chat_agent_http.call_llm_tools = lambda messages, tools, **kw: None
    target = FakeTarget({
        "messages": [{"role": "user", "content": "hi"}],
        "tools": [{"name": "merchant_analysis", "description": "d", "parameters": {"type": "object"}}],
    })
    chat_agent_http.handle_agent_request(target)
    payload = response_json(target)
    assert target.status == 200 and payload == {"ok": False, "error": "LLM unavailable"}


def test_agent_request_rejects_missing_tools():
    target = FakeTarget({"messages": [{"role": "user", "content": "hi"}]})
    chat_agent_http.handle_agent_request(target)
    assert target.status == 400
    assert response_json(target)["ok"] is False


def test_agent_request_rejects_oversized_body():
    huge = "x" * 40000
    body = json.dumps({"messages": [{"role": "user", "content": huge}], "tools": []}).encode("utf-8")
    target = FakeTarget.__new__(FakeTarget)
    target.headers = {"Content-Length": str(len(body))}
    target.rfile = BytesIO(body)
    target.wfile = BytesIO()
    target.status = None
    target.response_headers = []
    chat_agent_http.handle_agent_request(target)
    assert target.status == 400
    assert response_json(target)["ok"] is False


def test_synthesis_prompt_language():
    zh = chat_agent_http.agent_synthesis_system_prompt("zh")
    en = chat_agent_http.agent_synthesis_system_prompt("en")
    assert zh != en and "不要" in zh and "do not" in en.lower()


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"PASS {t.__name__}")
    print(f"OK {len(tests)} tests")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 运行确认失败**

Run: `python scripts/test_agent_http.py`
Expected: FAIL，`FileNotFoundError: ... chat_agent_http.py`（模块不存在）

- [ ] **Step 3: 创建 `chat_agent_http.py`**

完整文件内容：

```python
"""Shared HTTP handling for the Chat Mode agent planning endpoint.

Imported by both server.py (local) and api/chat/actions.py (Vercel), following
the chatbot_question_log_http.py pattern.  Callers perform require_auth().
"""

from __future__ import annotations

from auth import _read_json_body, send_json
from llm_provider import call_llm_tools

AGENT_MAX_REQUEST_BYTES = 32768
AGENT_PLAN_TIMEOUT_SECONDS = 30.0

PLANNING_PROMPT_ZH = (
    "你是一个亚马逊联盟营销数据分析助手，可以调用工具获取数据报告。\n"
    "规则：\n"
    "1. 只有当用户问题需要具体数据（商户指标、品类统计）时才调用工具；闲聊、概念问题直接回答。\n"
    "2. 相互独立的工具调用必须在同一次回复中并行给出。\n"
    "3. 从用户话语中提取工具参数；不确定商户名或品类名时仍调用工具，工具会返回\"未找到\"。\n"
    "4. 不要编造数值；工具结果中的数值是最终值，直接引用。"
)

PLANNING_PROMPT_EN = (
    "You are an Amazon affiliate marketing data analysis assistant that can call tools to fetch data reports.\n"
    "Rules:\n"
    "1. Only call tools when the question needs concrete data (merchant metrics, category statistics); answer chit-chat and conceptual questions directly.\n"
    "2. Independent tool calls must be issued in parallel in a single reply.\n"
    "3. Extract tool arguments from the user's words; when unsure about a merchant or category name, still call the tool — it will report \"not found\".\n"
    "4. Never invent numbers; values in tool results are final, quote them."
)

SYNTHESIS_PROMPT_ZH = (
    "你是一个亚马逊联盟营销数据分析助手。\n"
    "对话中包含了工具（数据分析函数）的执行结果，请基于这些结果回答用户最初的问题。\n"
    "先给出结论，再用 Markdown 表格展示关键数据，表格前后用一两句话补充说明。\n"
    "工具结果中的数值是计算好的最终值，直接引用，不要重新计算或外推新排名。\n"
    "某个工具失败时，如实说明该部分数据缺失，不得编造。"
)

SYNTHESIS_PROMPT_EN = (
    "You are an Amazon affiliate marketing data analysis assistant.\n"
    "The conversation contains tool (data analysis function) results; answer the user's original question based on them.\n"
    "Lead with the conclusion, then present key numbers in Markdown tables with one or two sentences of context.\n"
    "Values in tool results are final computed values; quote them and do not recompute or extrapolate new rankings.\n"
    "When a tool failed, state plainly that this part of the data is missing; do not fabricate."
)


def agent_planning_system_prompt(language: str) -> str:
    return PLANNING_PROMPT_EN if language == "en" else PLANNING_PROMPT_ZH


def agent_synthesis_system_prompt(language: str) -> str:
    return SYNTHESIS_PROMPT_EN if language == "en" else SYNTHESIS_PROMPT_ZH


def _validated_agent_body(body) -> tuple[dict | None, str | None]:
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        return None, "messages must be a non-empty array"
    cleaned = []
    for msg in messages:
        if not isinstance(msg, dict) or not isinstance(msg.get("content"), str):
            return None, "each message must have a string content"
        cleaned.append({"role": str(msg.get("role") or "user"), "content": msg["content"]})
    tools = body.get("tools")
    if not isinstance(tools, list):
        return None, "tools must be an array"
    cleaned_tools = []
    for tool in tools:
        if not isinstance(tool, dict) or not tool.get("name"):
            return None, "each tool must have a name"
        cleaned_tools.append(
            {
                "name": str(tool["name"]),
                "description": str(tool.get("description") or ""),
                "parameters": tool.get("parameters") if isinstance(tool.get("parameters"), dict) else {"type": "object", "properties": {}},
            }
        )
    return {"messages": cleaned, "tools": cleaned_tools}, None


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

    language = str(body.get("language") or "zh").strip()
    if language not in ("en", "zh"):
        language = "zh"

    validated, error = _validated_agent_body(body)
    if error:
        send_json(target, 400, {"ok": False, "error": error})
        return

    request_messages = [{"role": "system", "content": agent_planning_system_prompt(language)}]
    request_messages.extend(validated["messages"])

    result = call_llm_tools(
        request_messages,
        validated["tools"],
        max_tokens=400,
        timeout=AGENT_PLAN_TIMEOUT_SECONDS,
        temperature=0.1,
    )
    if result is None:
        send_json(target, 200, {"ok": False, "error": "LLM unavailable"})
        return
    send_json(
        target,
        200,
        {
            "ok": True,
            "content": result.get("content"),
            "toolCalls": result.get("tool_calls") or [],
            "finishReason": "tool_calls" if result.get("tool_calls") else "stop",
        },
    )
```

- [ ] **Step 4: 接入 `server.py`**

Import 区（现第 66 行 `from llm_provider import stream_chat` 之后）加：

```python
from chat_agent_http import agent_synthesis_system_prompt, handle_agent_request
```

`do_POST` 中现第 189-193 行的 `/api/chat/analyze` 分支之后插入：

```python
        if parsed.path == "/api/chat/agent":
            if not require_auth(self):
                return
            handle_agent_request(self)
            return
```

`handle_chat_stream` 中现第 274 行 `history = body.get("history") or None` 之后插入：

```python
        messages = body.get("messages")
        if isinstance(messages, list) and messages:
            self._chat_stream_messages(messages, language)
            return
```

类内 `handle_chat_stream` 方法之后（现第 332 行 `pass` 结束、`def send_db_error` 之前）追加新方法：

```python
    def _chat_stream_messages(self, messages, language):
        """SSE streaming for agent synthesis: full message list passthrough."""
        system_prompt = agent_synthesis_system_prompt(language)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()

            token_count = 0
            for token in stream_chat("", system_prompt, max_tokens=2048, temperature=0.2, messages=messages):
                if token:
                    self.wfile.write(f"data: {json.dumps({'token': token}, ensure_ascii=False)}\n\n".encode("utf-8"))
                    self.wfile.flush()
                    token_count += 1

            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
            print(f"[chat_stream_messages] sent {token_count} tokens", file=sys.stderr)

        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            print("[chat_stream_messages] client disconnected", file=sys.stderr)
        except Exception as exc:
            print(f"[chat_stream_messages] error: {exc}", file=sys.stderr)
            try:
                self.wfile.write(f"data: {json.dumps({'error': str(exc)}, ensure_ascii=False)}\n\n".encode("utf-8"))
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                pass
```

- [ ] **Step 5: 运行确认通过**

Run: `python scripts/test_agent_http.py`
Expected: 5 行 PASS + `OK 5 tests`

- [ ] **Step 6: 回归**

Run: `python -m py_compile chat_agent_http.py server.py auth.py`
Expected: 无输出（成功）

- [ ] **Step 7: Commit（仅在用户授权提交时）**

```bash
git add chat_agent_http.py server.py scripts/test_agent_http.py
git commit -m "Add /api/chat/agent planning endpoint / 新增 /api/chat/agent 规划端点"
```

---

### Task 4: Vercel 路由（`api/chat/actions.py` + `vercel.json` + `api/chat/stream.py`）

**Files:**
- Modify: `api/chat/actions.py`（import 区、`CHAT_ROUTES`、dispatch 分支）
- Modify: `vercel.json`（routes 数组末尾）
- Modify: `api/chat/stream.py`（`do_POST` 中 history 解析后加 messages 分支 + 新方法 `_chat_stream_messages`）
- Modify: `scripts/test_vercel_chat_routes.py`（追加 agent 用例）

**Interfaces:**
- Consumes: `chat_agent_http.handle_agent_request`（Task 3）、`agent_synthesis_system_prompt`（Task 3）、`llm_provider.stream_chat` messages 参数（Task 2）
- Produces: Vercel 上 `POST /api/chat/agent` 与 `POST /api/chat/stream`（messages 分支）与本地行为一致

- [ ] **Step 1: 修改 `api/chat/actions.py`**

Import 区（现第 3-4 行）改为：

```python
from auth import _read_json_body, require_auth, send_json
from chat_agent_http import handle_agent_request
from llm_classify import classify_intent, generate_analysis_text
```

`CHAT_ROUTES = {"analyze", "classify"}` 改为：

```python
CHAT_ROUTES = {"analyze", "classify", "agent"}
```

dispatch 分支（现第 82-85 行）改为：

```python
    if route == "classify":
        handle_classify(target)
    elif route == "agent":
        handle_agent_request(target)
    else:
        handle_analyze(target)
```

- [ ] **Step 2: 修改 `vercel.json`**

在 routes 数组最后一个元素（`^/api/chat/analyze/?$` 块）之后、`]` 之前追加：

```json
    {
      "src": "^/api/chat/agent/?$",
      "dest": "/api/chat/actions",
      "transforms": [
        {
          "type": "request.headers",
          "op": "set",
          "target": { "key": "x-oi-chat-route" },
          "args": "agent"
        }
      ]
    }
```

（注意前一个元素结尾的 `}` 后加逗号。）

- [ ] **Step 3: 修改 `api/chat/stream.py`**

现第 63 行 `history = body.get("history") or None` 之后插入：

```python
        messages = body.get("messages")
        if isinstance(messages, list) and messages:
            self._chat_stream_messages(messages, language)
            return
```

类内 `_send_json` 方法之前追加：

```python
    def _chat_stream_messages(self, messages, language):
        """SSE streaming for agent synthesis: full message list passthrough."""
        from chat_agent_http import agent_synthesis_system_prompt

        system_prompt = agent_synthesis_system_prompt(language)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()

            token_count = 0
            for token in stream_chat("", system_prompt, max_tokens=2048, temperature=0.2, messages=messages):
                if token:
                    self.wfile.write(f"data: {json.dumps({'token': token}, ensure_ascii=False)}\n\n".encode("utf-8"))
                    self.wfile.flush()
                    token_count += 1

            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
            print(f"[chat_stream_messages] sent {token_count} tokens", file=sys.stderr)

        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            print("[chat_stream_messages] client disconnected", file=sys.stderr)
        except Exception as exc:
            print(f"[chat_stream_messages] error: {exc}", file=sys.stderr)
            try:
                self.wfile.write(f"data: {json.dumps({'error': str(exc)}, ensure_ascii=False)}\n\n".encode("utf-8"))
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                pass
```

- [ ] **Step 4: 追加 Vercel 路由测试**

`scripts/test_vercel_chat_routes.py` 的 `main()` 中，`unknown_route` 断言（现约第 78-80 行）之前插入：

```python
        module.handle_agent_request = lambda target: target_writer(target, "agent")
        agent = FakeTarget({
            "messages": [{"role": "user", "content": "Shokz"}],
            "tools": [{"name": "merchant_analysis", "description": "d", "parameters": {"type": "object"}}],
        })
        module.dispatch_request(agent, "POST", "agent")
        if agent.status != 200 or response_json(agent).get("route") != "agent":
            raise AssertionError("agent route did not dispatch to handle_agent_request")

        class NullTarget:
            def send_response(self, status): self.status = status
            def send_header(self, *a): pass
            def end_headers(self): pass

        def target_writer(target, route):
            send_json(target, 200, {"ok": True, "route": route})
```

并在 `main()` 顶部 import 区（文件头，`sys.path.insert(0, str(ROOT))` 之后）加：

```python
from auth import send_json
```

- [ ] **Step 5: 运行确认通过**

Run: `python scripts/test_vercel_chat_routes.py && python scripts/test_agent_http.py`
Expected: 两者均 PASS 无异常输出

- [ ] **Step 6: 校验 vercel.json**

Run: `python -c "import json; json.load(open('vercel.json', encoding='utf-8')); print('vercel.json OK')"`
Expected: `vercel.json OK`

- [ ] **Step 7: Commit（仅在用户授权提交时）**

```bash
git add api/chat/actions.py api/chat/stream.py vercel.json scripts/test_vercel_chat_routes.py
git commit -m "Wire /api/chat/agent for Vercel serverless / 接入 Vercel 的 /api/chat/agent 路由"
```

---

### Task 5: `OI_AGENT_ENABLED` 开关（auth.py → auth.js → app.js）

**Files:**
- Modify: `auth.py`（`llm_enabled` 之后加 `agent_enabled`；4 处 session payload 加 `agentEnabled` 字段）
- Modify: `public/auth.js:282` 与 `:310`（`window.__OI_LLM_ENABLED` 行之后）
- Modify: `public/app.js:23746`（`state.llmEnabled = ...` 行之后）
- Create: `scripts/test_agent_config.py`

**Interfaces:**
- Consumes: Task 1-4 无依赖
- Produces: `auth.agent_enabled() -> bool`；`window.__OI_AGENT_ENABLED`；`state.agentEnabled`

- [ ] **Step 1: 写失败测试**

创建 `scripts/test_agent_config.py`：

```python
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import auth  # noqa: E402


def test_agent_enabled_defaults_on():
    old = os.environ.get("OI_AGENT_ENABLED")
    os.environ.pop("OI_AGENT_ENABLED", None)
    try:
        assert auth.agent_enabled() is True
    finally:
        if old is not None:
            os.environ["OI_AGENT_ENABLED"] = old


def test_agent_enabled_off_values():
    old = os.environ.get("OI_AGENT_ENABLED")
    try:
        for value in ("0", "false", "no", "off"):
            os.environ["OI_AGENT_ENABLED"] = value
            assert auth.agent_enabled() is False, value
        os.environ["OI_AGENT_ENABLED"] = "1"
        assert auth.agent_enabled() is True
    finally:
        if old is None:
            os.environ.pop("OI_AGENT_ENABLED", None)
        else:
            os.environ["OI_AGENT_ENABLED"] = old


def main():
    test_agent_enabled_defaults_on()
    print("PASS test_agent_enabled_defaults_on")
    test_agent_enabled_off_values()
    print("PASS test_agent_enabled_off_values")
    print("OK 2 tests")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 运行确认失败**

Run: `python scripts/test_agent_config.py`
Expected: FAIL，`AttributeError: module 'auth' has no attribute 'agent_enabled'`

- [ ] **Step 3: 修改 `auth.py`**

`llm_enabled()` 函数（现第 42-44 行）之后追加：

```python
def agent_enabled() -> bool:
    value = os.environ.get("OI_AGENT_ENABLED", "1").strip().lower()
    return value not in {"0", "false", "no", "off"}
```

在 4 处 `"llmEnabled": llm_enabled(),` 之后各加一行 `"agentEnabled": agent_enabled(),`（`grep -n 'llmEnabled' auth.py` 可定位：约第 279、306、318、351 行）。

- [ ] **Step 4: 修改 `public/auth.js`**

现第 282 行 `window.__OI_LLM_ENABLED = session.llmEnabled !== false;` 之后加：

```js
      window.__OI_AGENT_ENABLED = session.agentEnabled !== false;
```

现第 310 行 `window.__OI_LLM_ENABLED = loginResult.llmEnabled !== false;` 之后加：

```js
      window.__OI_AGENT_ENABLED = loginResult.agentEnabled !== false;
```

- [ ] **Step 5: 修改 `public/app.js`**

现第 23746 行 `state.llmEnabled = window.__OI_LLM_ENABLED !== false;` 之后加：

```js
    state.agentEnabled = window.__OI_AGENT_ENABLED !== false;
```

- [ ] **Step 6: 运行确认通过**

Run: `python scripts/test_agent_config.py && node --check public/auth.js && node --check public/app.js`
Expected: `OK 2 tests`；两个 `node --check` 无输出

- [ ] **Step 7: Commit（仅在用户授权提交时）**

```bash
git add auth.py public/auth.js public/app.js scripts/test_agent_config.py
git commit -m "Expose OI_AGENT_ENABLED flag through session / 通过会话暴露 OI_AGENT_ENABLED 开关"
```

---

### Task 6: 前端工具注册表 + 结果压缩 + 步骤卡片 + `streamAssistantReply` 抽取

**Files:**
- Modify: `public/app.js`（`applyPrompt` 定义之前插入工具块；`applyPrompt` Chat 分支内联 SSE 块抽取为 `streamAssistantReply`）
- Modify: `public/app.js:24967`（测试钩子追加）

**Interfaces:**
- Consumes: `analyzeMerchant`(5668)、`analyzeCategory`(5961)、`findOfferByMerchantName`(5560)、`markdownToHtml`(2227)、`escapeHtml`、`state.chatHistory`
- Produces（Task 7 依赖）：
  - `agentToolDefinitions() -> [{name, description, parameters}]`
  - `agentExecuteTool(name, args) -> {ok:true, data}|{ok:false, error}`
  - `compactAgentToolResult(toolName, summary, language) -> object`（含 `headline`、`note`）
  - `renderAgentStepCard(chatLogEl, payload) -> cardEl`
  - `agentStepCopy(language) -> {planning, running, reportDone, failed}`
  - `streamAssistantReply(requestBody, opts) -> Promise<{ok, fullResponse, msgEl, statusBar}|{ok:false, error}>`

- [ ] **Step 1: 插入工具块（`applyPrompt` 之前）**

定位锚点（`public/app.js:12791`）：

```js
  async function applyPrompt(prompt) {
```

在其**上方**插入完整块：

```js
  // ════════════════════════════════════════════════════════
  // Chat Agent：工具注册表 + 结果压缩 + 步骤卡片 + 流式回复
  // ════════════════════════════════════════════════════════
  var AGENT_MAX_PLANNING_ROUNDS = 2;
  var AGENT_MAX_TOOL_CALLS = 6;
  var AGENT_MAX_TOOLS_PER_ROUND = 4;
  var AGENT_MAX_RESULT_CHARS = 6000;

  var AGENT_METRIC_NOTE_ZH = "口径：EPC(Aff)=affCommission/clicks；AFF Comm%=affCommission/salesAmount*100；CVR=conversionRate*100。样本门槛：EPC/CVR 需 clicks≥100，AOV/AFF Comm% 需 orders≥10；样本不足不参与百分位与强弱项。百分位≥70 为亮点、≤30 为短板。以上数值为最终计算结果，请直接引用，不要重新计算或外推新排名。";
  var AGENT_METRIC_NOTE_EN = "Metrics: EPC(Aff)=affCommission/clicks; AFF Comm%=affCommission/salesAmount*100; CVR=conversionRate*100. Sample gates: EPC/CVR need clicks>=100, AOV/AFF Comm% need orders>=10; below-gate samples get no percentile. Percentile>=70 highlight, <=30 weakness. Values are final computed results; quote them, do not recompute or extrapolate.";

  function agentStepCopy(language) {
    var zh = language !== "en";
    return {
      planning: zh ? "正在规划分析步骤…" : "Planning analysis steps…",
      running: zh ? "正在生成" : "Generating",
      reportDone: zh ? "报告完成" : "report ready",
      failed: zh ? "失败" : "failed",
      fallbackNote: zh ? "数据获取失败，已降级为通用回答。" : "Data fetch failed; fell back to a generic answer."
    };
  }

  function renderAgentStepCard(chatLogEl, payload) {
    var card = document.createElement("div");
    card.className = "agent-step agent-step-" + (payload.status || "running");
    var icon = payload.status === "done" ? "✓" : (payload.status === "error" ? "✗" : "⋯");
    card.innerHTML = '<span class="agent-step-icon">' + icon + '</span><span class="agent-step-text">' +
      escapeHtml(payload.text || "") + '</span>';
    chatLogEl.appendChild(card);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
    return card;
  }

  function agentRoundNumber(value) {
    if (value === null || value === undefined || typeof value !== "number") return value;
    return Math.round(value * 1000) / 1000;
  }

  function agentRoundMetrics(metrics) {
    var out = {};
    Object.keys(metrics || {}).forEach(function (k) { out[k] = agentRoundNumber(metrics[k]); });
    return out;
  }

  function compactAgentToolResult(toolName, summary, language) {
    var note = language === "en" ? AGENT_METRIC_NOTE_EN : AGENT_METRIC_NOTE_ZH;
    if (toolName === "merchant_analysis") {
      var target = summary.target || {};
      var out = {
        tool: "merchant_analysis",
        merchant: target.name || "Unknown",
        tier: target.tier || "Unknown",
        category: target.category || "Uncategorized",
        metrics: agentRoundMetrics(summary.metrics || {}),
        ranks: {},
        comparisons: {},
        strengths: summary.strengths || [],
        weaknesses: summary.weaknesses || [],
        paymentRisk: summary.paymentRisk || null,
        peers: (summary.peers || []).slice(0, 3).map(function (p) {
          return { name: p.name, metrics: agentRoundMetrics(p.metrics || {}) };
        })
      };
      Object.keys(summary.ranks || {}).forEach(function (f) {
        var r = summary.ranks[f];
        out.ranks[f] = {
          value: agentRoundNumber(r.value),
          percentile: r.percentile === null || r.percentile === undefined ? null : Math.round(r.percentile),
          sampleEligible: !!r.sampleEligible,
          totalInCategory: r.totalInCategory || 0
        };
      });
      ["vsCategory", "vsTier", "vsGlobal"].forEach(function (group) {
        out.comparisons[group] = {};
        Object.keys((summary.comparisons || {})[group] || {}).forEach(function (f) {
          var row = summary.comparisons[group][f];
          out.comparisons[group][f] = {
            self: agentRoundNumber(row.self),
            avg: agentRoundNumber(row.avg),
            delta: row.delta === null || row.delta === undefined ? null : Math.round(row.delta)
          };
        });
      });
      out.headline = out.merchant + "（" + out.category + " · " + out.tier + "）";
      out.note = note;
      if (JSON.stringify(out).length > AGENT_MAX_RESULT_CHARS) {
        out.peers = out.peers.slice(0, 1);
        delete out.comparisons.vsGlobal;
      }
      return out;
    }
    if (toolName === "category_analysis") {
      var t2 = summary.target || {};
      var agg = summary.aggregates || {};
      var out2 = {
        tool: "category_analysis",
        category: t2.name || "Unknown",
        merchantCount: t2.merchantCount !== undefined && t2.merchantCount !== null ? t2.merchantCount : agg.merchantCount,
        tierDistribution: t2.tierDistribution || {},
        aggregates: agentRoundMetrics(agg),
        vsGlobal: summary.vsGlobal || {},
        topMerchants: (summary.topMerchants || []).slice(0, 5)
      };
      out2.headline = out2.category + "（" + out2.merchantCount + " 个商户）";
      out2.note = note;
      if (JSON.stringify(out2).length > AGENT_MAX_RESULT_CHARS) {
        out2.topMerchants = out2.topMerchants.slice(0, 3);
      }
      return out2;
    }
    return summary;
  }

  function agentExecuteTool(name, args) {
    args = args || {};
    if (name === "merchant_analysis") {
      var merchant = typeof args.merchant === "string" ? args.merchant.trim().slice(0, 80) : "";
      if (!merchant) return { ok: false, error: "merchant 参数缺失" };
      var summary = analyzeMerchant(merchant);
      if (!summary) return { ok: false, error: "未找到商户 '" + merchant + "'" };
      return { ok: true, data: compactAgentToolResult("merchant_analysis", summary, state.language || "zh") };
    }
    if (name === "category_analysis") {
      var category = typeof args.category === "string" ? args.category.trim().slice(0, 80) : "";
      if (!category) return { ok: false, error: "category 参数缺失" };
      var catSummary = analyzeCategory(category);
      if (!catSummary) return { ok: false, error: "未找到品类 '" + category + "'" };
      return { ok: true, data: compactAgentToolResult("category_analysis", catSummary, state.language || "zh") };
    }
    return { ok: false, error: "未知工具 '" + name + "'" };
  }

  function agentToolDefinitions() {
    return [
      {
        name: "merchant_analysis",
        description: "获取单个商户的核心指标及其在同品类中的百分位、品类/Tier/全站均值对比、强弱项、Top3 同行(Peer)和付款风险。参数 merchant 为品牌名或商户ID。",
        parameters: {
          type: "object",
          properties: { merchant: { type: "string", description: "商户品牌名或商户ID，如 Shokz" } },
          required: ["merchant"]
        }
      },
      {
        name: "category_analysis",
        description: "获取某个品类的汇总统计：商户数、总Sales/Commission/Orders、平均EPC/AOV/CVR/佣金率、Tier分布、vs全站对比、按佣金排序的Top5商户。参数 category 为品类名。",
        parameters: {
          type: "object",
          properties: { category: { type: "string", description: "品类名，如 Electronics / 美妆" } },
          required: ["category"]
        }
      }
    ];
  }

  async function streamAssistantReply(requestBody, opts) {
    // opts: {chatLogEl, language, viewContext:{prompt, recommendationResult}, onError}
    var language = opts.language || "zh";
    var chatLogEl = opts.chatLogEl;
    var loadingText = language === "zh" ? "正在思考…" : "Thinking…";
    var loadingMsg = document.createElement("div");
    loadingMsg.className = "message assistant loading-indicator";
    loadingMsg.textContent = loadingText;
    chatLogEl.appendChild(loadingMsg);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;

    var responseStream;
    try {
      responseStream = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
    } catch (error) {
      loadingMsg.remove();
      if (opts.onError) opts.onError(error);
      return { ok: false, error: error };
    }
    loadingMsg.remove();

    if (!responseStream.ok) {
      var httpError = new Error("HTTP " + responseStream.status);
      if (opts.onError) opts.onError(httpError);
      return { ok: false, error: httpError };
    }

    var msgEl = document.createElement("div");
    msgEl.className = "message assistant";
    var msgContent = document.createElement("div");
    msgContent.className = "chat-stream-text";
    msgEl.appendChild(msgContent);
    var statusBar = document.createElement("div");
    statusBar.className = "chat-stream-status";
    msgEl.appendChild(statusBar);
    chatLogEl.appendChild(msgEl);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;

    var tokenCount = 0;
    var fullResponse = "";
    var streamHadError = false;
    var streamStartTime = Date.now();
    var thinkingZh = ["思考中", "分析中", "处理中", "生成中", "整合中"];
    var thinkingEn = ["thinking", "analyzing", "processing", "generating", "compiling"];
    var thinkIdx = 0;
    var thinkTicks = 0;
    var timerTick = setInterval(function () {
      var e = ((Date.now() - streamStartTime) / 1000).toFixed(1);
      thinkTicks++;
      if (thinkTicks % 30 === 0) {
        thinkIdx = (thinkIdx + 1) % (language === "zh" ? thinkingZh.length : thinkingEn.length);
      }
      var word = language === "zh" ? thinkingZh[thinkIdx] : thinkingEn[thinkIdx];
      var timeUnit = language === "zh" ? "秒" : "s";
      statusBar.textContent = "\u23f1 " + e + timeUnit + " \u00b7 " + word + "…";
    }, 100);

    var reader = responseStream.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";
    var doneReading = false;

    while (!doneReading) {
      var readResult = await reader.read();
      if (readResult.done) break;
      buffer += decoder.decode(readResult.value, { stream: true });
      var lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (var j = 0; j < lines.length; j++) {
        var line = lines[j];
        if (line.startsWith("data: ")) {
          var payload = line.slice(6).trim();
          if (payload === "[DONE]") { doneReading = true; break; }
          try {
            var parsed = JSON.parse(payload);
            if (parsed.token) {
              msgContent.textContent += parsed.token;
              fullResponse += parsed.token;
              tokenCount++;
              chatLogEl.scrollTop = chatLogEl.scrollHeight;
            }
            if (parsed.error) streamHadError = true;
          } catch (e) { /* skip malformed SSE */ }
        }
      }
    }

    clearInterval(timerTick);
    if (fullResponse.trim()) {
      var renderedHtml = markdownToHtml(fullResponse);
      if (renderedHtml) msgContent.innerHTML = renderedHtml;
    }
    var finalElapsed = ((Date.now() - streamStartTime) / 1000).toFixed(1);
    statusBar.textContent = language === "zh"
      ? "\u23f1 " + finalElapsed + "秒 \u00b7 \u229e " + tokenCount + " tokens"
      : "\u23f1 " + finalElapsed + "s \u00b7 \u229e " + tokenCount + " tokens";
    if (fullResponse && fullResponse.trim() && opts.viewContext) {
      var viewBtn = document.createElement("button");
      viewBtn.className = "chat-to-deep-btn";
      viewBtn.textContent = language === "zh" ? "转为 View" : "Open as View";
      viewBtn._chatPrompt = opts.viewContext.prompt;
      viewBtn._fullResponse = fullResponse;
      viewBtn._recommendationResult = opts.viewContext.recommendationResult;
      viewBtn.addEventListener("click", function (e) {
        var btn = e.currentTarget;
        var _prompt = btn._chatPrompt || "";
        var _html = btn._fullResponse ? '<div class="chat-stream-text">' + markdownToHtml(btn._fullResponse) + '</div>' : "";
        if (!_html) return;
        var existing = _deepPanels.find(function (p) { return p._viewBtn === btn; });
        if (existing && existing._hidden) {
          _showDeepPanel(existing.id);
        } else if (existing) {
          _bringPanelToFront(existing);
        } else {
          var p = _createDeepPanel(_prompt);
          p._mode = "chat";
          p.el.classList.add("source-chat");
          p._viewBtn = btn;
          _showQuickResultInDeepPanel(p, _html, _prompt, {
            recommendationResult: btn._recommendationResult
          });
        }
      });
      statusBar.appendChild(viewBtn);
    }
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
    var ok = !!fullResponse.trim() && !streamHadError;
    return { ok: ok, fullResponse: fullResponse, msgEl: msgEl, statusBar: statusBar };
  }
```

- [ ] **Step 2: 语法检查**

Run: `node --check public/app.js`
Expected: 无输出

- [ ] **Step 3: 追加测试钩子**

在测试钩子对象（现第 24968 行 `window.OFFER_INTELLIGENCE_TEST_HOOKS = {` 之后、首个键之前）插入：

```js
      agentToolDefinitions,
      agentExecuteTool,
      compactAgentToolResult,
      runChatAgent,
      firstOfferName: function () {
        return offers.length ? (offers[0].brand || offers[0].merchantName || "") : "";
      },
```

（`runChatAgent` 由 Task 7 定义；在 Task 7 完成前该引用会报 ReferenceError，所以本步先不加 `runChatAgent`，只加其余三个 + `firstOfferName`；Task 7 再补 `runChatAgent,` 一行。若在本步加入，`node --check` 会因未定义引用失败。）

- [ ] **Step 4: 运行语法检查与现有测试**

Run: `node --check public/app.js && node scripts/test_chatbot_intent_flow.mjs && node scripts/test_zh_chatbot.mjs`
Expected: 无输出错误，两个测试 PASS

- [ ] **Step 5: Commit（仅在用户授权提交时）**

```bash
git add public/app.js
git commit -m "Add agent tool registry and reply streamer / 新增 Agent 工具注册表与流式回复函数"
```

---

### Task 7: `runChatAgent` 循环 + `applyPrompt` 集成

**Files:**
- Modify: `public/app.js`（`streamAssistantReply` 之后追加 `runChatAgent`；`applyPrompt` Chat 分支替换内联 fetch/SSE 块；测试钩子补 `runChatAgent`）
- Create: `scripts/test_chat_agent.mjs`

**Interfaces:**
- Consumes: Task 6 全部产物；`state.chatHistory`、`state.reportMemory`
- Produces: `runChatAgent(prompt, opts) -> Promise<{handled:true, ok, fullResponse?} | {handled:true, directContent} | {handled:false, error}>`，`opts = {language, chatLogEl, memoryText, history, viewContext}`

- [ ] **Step 1: 追加 `runChatAgent`（`streamAssistantReply` 函数结束之后）**

锚点：Task 6 插入块的末尾 `return { ok: ok, fullResponse: fullResponse, msgEl: msgEl, statusBar: statusBar };\n  }`（`streamAssistantReply` 的结尾）。在其后插入：

```js
  async function runChatAgent(prompt, opts) {
    var language = opts.language || "zh";
    var chatLogEl = opts.chatLogEl;
    var copy = agentStepCopy(language);
    var memoryText = opts.memoryText || "";
    var history = opts.history || [];

    var messages = [];
    if (memoryText) messages.push({ role: "user", content: "[上下文]\n" + memoryText });
    for (var i = 0; i < history.length; i++) {
      messages.push({ role: history[i].role, content: history[i].content });
    }
    messages.push({ role: "user", content: prompt });

    var toolCallsTotal = 0;
    var toolResults = [];

    for (var round = 0; round < AGENT_MAX_PLANNING_ROUNDS; round++) {
      var planCard = renderAgentStepCard(chatLogEl, { status: "running", text: copy.planning });
      var plan;
      try {
        var planResp = await fetch("/api/chat/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: messages, tools: agentToolDefinitions(), language: language })
        });
        plan = planResp.ok ? await planResp.json() : { ok: false, error: "HTTP " + planResp.status };
      } catch (error) {
        plan = { ok: false, error: String((error && error.message) || error) };
      }
      if (planCard.remove) planCard.remove();

      if (!plan || plan.ok !== true || !Array.isArray(plan.toolCalls) || !plan.toolCalls.length) {
        if (plan && typeof plan.content === "string" && plan.content.trim()) {
          return { handled: true, ok: true, directContent: plan.content };
        }
        return { handled: false, error: plan && plan.error };
      }

      var calls = plan.toolCalls.slice(0, AGENT_MAX_TOOLS_PER_ROUND);
      var results = await Promise.all(calls.map(async function (call) {
        if (toolCallsTotal >= AGENT_MAX_TOOL_CALLS) return null;
        toolCallsTotal++;
        var kind = call.name === "category_analysis" ? "品类" : "商户";
        var card = renderAgentStepCard(chatLogEl, { status: "running", text: copy.running + " " + kind + "报告…" });
        var result = agentExecuteTool(call.name, call.arguments || {});
        var text = result.ok
          ? ("✓ " + kind + copy.reportDone + "：" + result.data.headline)
          : ("✗ " + copy.failed + "：" + result.error);
        card.className = "agent-step " + (result.ok ? "agent-step-done" : "agent-step-error");
        card.innerHTML = '<span class="agent-step-icon">' + (result.ok ? "✓" : "✗") + '</span><span class="agent-step-text">' + escapeHtml(text) + '</span>';
        return { id: call.id, name: call.name, result: result };
      }));

      var finished = results.filter(function (r) { return r !== null; });
      finished.forEach(function (r) { toolResults.push(r); });
      var allOk = finished.every(function (r) { return r.result.ok; });
      if (allOk) break;

      var failedCount = finished.filter(function (r) { return !r.result.ok; }).length;
      for (var f = 0; f < finished.length; f++) {
        var item = finished[f];
        var content = item.result.ok
          ? ("工具 " + item.name + " 结果：\n" + JSON.stringify(item.result.data))
          : ("工具 " + item.name + " 失败：" + item.result.error);
        messages.push({ role: "user", content: content });
      }
      messages.push({
        role: "user",
        content: "有 " + failedCount + " 个工具失败。请修正参数后重试（这是最后一轮），或停止调用工具并基于已有结果回答。"
      });
    }

    var synthMessages = [];
    if (memoryText) synthMessages.push({ role: "user", content: "[上下文]\n" + memoryText });
    for (var h = 0; h < history.length; h++) {
      synthMessages.push({ role: history[h].role, content: history[h].content });
    }
    synthMessages.push({ role: "user", content: prompt });
    if (toolResults.length) {
      var resultsBlock = toolResults.map(function (r) {
        return r.result.ok
          ? ("工具 " + r.name + " 结果：\n" + JSON.stringify(r.result.data))
          : ("工具 " + r.name + " 失败：" + r.result.error);
      }).join("\n---\n");
      synthMessages.push({ role: "user", content: "工具执行结果：\n" + resultsBlock + "\n\n请基于以上工具结果回答最初的问题；工具失败的部分请如实说明。" });
    }

    var reply = await streamAssistantReply(
      { messages: synthMessages, language: language },
      {
        chatLogEl: chatLogEl,
        language: language,
        viewContext: opts.viewContext || null,
        onError: opts.onError || null
      }
    );
    if (!reply.ok) return { handled: true, ok: false, error: reply.error };
    return { handled: true, ok: true, fullResponse: reply.fullResponse, statusBar: reply.statusBar };
  }
```

- [ ] **Step 2: 集成 `applyPrompt` Chat 分支**

`public/app.js:12833-12834`（`chatRecommendationResult` 与 `memoryText` 两行之后、`try {` 之前）插入：

```js
      if (state.agentEnabled !== false) {
        var agentOutcome = await runChatAgent(prompt, {
          language: language,
          chatLogEl: _chatLog,
          memoryText: memoryText,
          history: state.chatHistory.slice(0, -1),
          viewContext: { prompt: prompt, recommendationResult: chatRecommendationResult },
          onError: null
        });
        if (agentOutcome && agentOutcome.handled) {
          if (agentOutcome.directContent) {
            var directMsg = document.createElement("div");
            directMsg.className = "message assistant";
            directMsg.innerHTML = markdownToHtml(agentOutcome.directContent) || escapeHtml(agentOutcome.directContent);
            _chatLog.appendChild(directMsg);
            _chatLog.scrollTop = _chatLog.scrollHeight;
            state.chatHistory.push({ role: "assistant", content: agentOutcome.directContent });
            completeQuestionLog(questionLogPromise, "success", questionLogIntent);
            return;
          }
          if (agentOutcome.ok) {
            state.chatHistory.push({ role: "assistant", content: agentOutcome.fullResponse });
            var agentQuestionCompletion = completeQuestionLog(questionLogPromise, "success", questionLogIntent);
            attachAnswerFeedbackButton(agentOutcome.statusBar, {
              questionPromise: agentQuestionCompletion,
              questionEventId: questionEventId,
              mode: "chat",
              prompt: prompt,
              language: language,
              intent: questionLogIntent,
              getAnswer: function () { return agentOutcome.fullResponse; }
            });
            return;
          }
          // agent 综合失败 → 继续走下方单发 fallback
        }
      }
```

然后用 `streamAssistantReply` 调用替换原内联 fetch/SSE 块（现第 12836-12996 行，从 `try {` 到 `return;` 结束的整个块）。替换后的完整代码（原块位置）：

```js
      var replyOutcome = await streamAssistantReply(
        { prompt: prompt, memory: memoryText, language: language, history: state.chatHistory.slice(0, -1) },
        {
          chatLogEl: _chatLog,
          language: language,
          viewContext: { prompt: prompt, recommendationResult: chatRecommendationResult },
          onError: function (error) {
            var _errMsg = document.createElement("div");
            _errMsg.className = "message assistant";
            _errMsg.textContent = (language === "zh" ? "网络错误，请稍后重试。" : "Network error, please retry.")
              + " (" + (error.message || "") + ")";
            _chatLog.appendChild(_errMsg);
            _chatLog.scrollTop = _chatLog.scrollHeight;
          }
        }
      );
      if (!replyOutcome.ok) {
        completeQuestionLog(questionLogPromise, "failed", questionLogIntent);
        return;
      }
      state.chatHistory.push({ role: "assistant", content: replyOutcome.fullResponse });
      var chatQuestionCompletion = completeQuestionLog(questionLogPromise, "success", questionLogIntent);
      attachAnswerFeedbackButton(replyOutcome.statusBar, {
        questionPromise: chatQuestionCompletion,
        questionEventId: questionEventId,
        mode: "chat",
        prompt: prompt,
        language: language,
        intent: questionLogIntent,
        getAnswer: function () { return replyOutcome.fullResponse; }
      });
      return;
```

注意：被替换的原块中包含 `var chatRecommendationResult = await prepareChatMemoryRecommendation(prompt);` 之后的 try/catch 整段（约第 12836 行 `try {` 至第 12996 行 `}` 后的 `return;`）。删除 `loadingMsg`/`msgEl`/`statusBar`/`reader` 等原内联实现，逻辑已移入 `streamAssistantReply`。`completeQuestionLog(questionLogPromise, "failed", ...)` 语义等价于原 catch 分支。

- [ ] **Step 3: 补测试钩子 `runChatAgent`**

Task 6 Step 3 插入的钩子中，`compactAgentToolResult,` 行之后加：

```js
      runChatAgent,
```

- [ ] **Step 4: 写前端测试**

创建 `scripts/test_chat_agent.mjs`：

```js
import fs from "node:fs";
import vm from "node:vm";
import { TextDecoder } from "node:util";

function runScript(file, sandbox) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}

function assertTruthy(value, label) {
  if (!value) throw new Error(`${label}: expected a truthy value, got ${JSON.stringify(value)}`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(haystack, needle, label) {
  if (String(haystack).indexOf(needle) === -1) {
    throw new Error(`${label}: expected to include ${JSON.stringify(needle)}, got ${JSON.stringify(haystack).slice(0, 300)}`);
  }
}

const elementStub = {
  addEventListener() {},
  classList: { add() {}, remove() {}, toggle() {} },
  dataset: {},
  appendChild() {}, insertBefore() {},
  querySelectorAll() { return []; },
  querySelector() { return null; },
  setAttribute() {}, removeAttribute() {},
  style: {},
  remove() {}
};

let mockFetchImpl = null;
let fetchCalls = [];

const sandbox = {
  console, Date, Math, Number, String, RegExp, Array, Object, Set, Map, JSON,
  TextDecoder,
  window: { __OFFER_INTELLIGENCE_TEST__: true },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  document: {
    getElementById() { return elementStub; },
    querySelectorAll() { return []; },
    querySelector() { return elementStub; },
    createElement() { return { ...elementStub }; }
  },
  fetch: async function (url, init) {
    fetchCalls.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
    if (!mockFetchImpl) throw new Error("no mockFetchImpl for " + url);
    return mockFetchImpl(String(url), fetchCalls[fetchCalls.length - 1]);
  },
  setInterval() { return 1; },
  clearInterval() {}
};
sandbox.window.document = sandbox.document;

const _offersCache = JSON.parse(fs.readFileSync("protected_data/db_offers_cache.json", "utf8"));
sandbox.window.CHATBOT_DATA = {
  summary: _offersCache.summary || {},
  offers: _offersCache.offers || [],
  paymentRecords: _offersCache.paymentRecords || [],
  sources: { mode: "db", month: _offersCache.month }
};
sandbox.window.SHEET_REPORT_DATA = {
  sheets: _offersCache.sheets || [],
  tierSheets: ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"]
};
const _kwCache = JSON.parse(fs.readFileSync("protected_data/db_keywords_cache.json", "utf8"));
sandbox.window.PRODUCT_KEYWORDS = _kwCache;
runScript("public/chatbot_i18n.js", sandbox);
runScript("public/tier2_recommendation_rules.js", sandbox);
runScript("public/app.js", sandbox);

const hooks = sandbox.window.OFFER_INTELLIGENCE_TEST_HOOKS;
assertTruthy(hooks, "app should expose test hooks in test mode");
assertTruthy(hooks.agentExecuteTool, "agentExecuteTool hook missing");
assertTruthy(hooks.runChatAgent, "runChatAgent hook missing");

const firstOffer = hooks.firstOfferName();
assertTruthy(firstOffer, "fixture offers must not be empty");

function sseResponse(bodyText) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(bodyText);
  return {
    ok: true,
    status: 200,
    body: {
      getReader: function () {
        let done = false;
        return {
          read: async function () {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: bytes };
          }
        };
      }
    }
  };
}

const chatLogStub = { appendChild() {}, scrollTop: 0, scrollHeight: 0 };

// ── Test 1: merchant_analysis 工具直接执行 ──
{
  const result = hooks.agentExecuteTool("merchant_analysis", { merchant: firstOffer });
  assertTruthy(result.ok, "merchant_analysis should succeed for firstOffer");
  assertTruthy(result.data.ranks, "compact result should keep ranks");
  assertTruthy(result.data.headline, "compact result should carry headline");
  assertIncludes(result.data.note, "EPC", "note should carry metric definitions");
  const missing = hooks.agentExecuteTool("merchant_analysis", { merchant: "__agent_test_missing_merchant__" });
  assertEqual(missing.ok, false, "unknown merchant should fail cleanly");
}

// ── Test 2: 规划 → 执行 → 综合全链路 ──
{
  fetchCalls = [];
  mockFetchImpl = function (url) {
    if (url.indexOf("/api/chat/agent") === 0) {
      return { ok: true, json: async function () {
        return { ok: true, content: null, finishReason: "tool_calls",
          toolCalls: [{ id: "c1", name: "merchant_analysis", arguments: { merchant: firstOffer } }] };
      } };
    }
    return sseResponse('data: {"token":"OK"}\n\ndata: [DONE]\n\n');
  };
  const outcome = await hooks.runChatAgent("Shokz 在同品类的表现", {
    language: "zh", chatLogEl: chatLogStub, memoryText: "", history: [], viewContext: null
  });
  assertEqual(outcome.handled, true, "agent should handle the prompt");
  assertEqual(outcome.ok, true, "agent run should succeed");
  assertEqual(outcome.fullResponse, "OK", "synthesis tokens should accumulate");
  assertEqual(fetchCalls.length, 2, "expect one plan call and one synthesis call");
  assertIncludes(JSON.stringify(fetchCalls[1].body), "merchant_analysis", "synthesis body should carry tool result");
}

// ── Test 3: 工具失败 → 补充规划 → 直接内容 ──
{
  fetchCalls = [];
  let planCount = 0;
  mockFetchImpl = function (url) {
    if (url.indexOf("/api/chat/agent") === 0) {
      planCount++;
      if (planCount === 1) {
        return { ok: true, json: async function () {
          return { ok: true, content: null, finishReason: "tool_calls",
            toolCalls: [{ id: "c1", name: "merchant_analysis", arguments: { merchant: "__agent_test_missing_merchant__" } }] };
        } };
      }
      return { ok: true, json: async function () {
        return { ok: true, content: "未找到该商户", toolCalls: [], finishReason: "stop" };
      } };
    }
    return sseResponse('data: [DONE]\n\n');
  };
  const outcome = await hooks.runChatAgent("分析一个不存在的商户", {
    language: "zh", chatLogEl: chatLogStub, memoryText: "", history: [], viewContext: null
  });
  assertEqual(outcome.handled, true, "agent should handle failed-tool case");
  assertEqual(outcome.directContent, "未找到该商户", "second plan round content should surface");
  assertEqual(planCount, 2, "expect a corrective second planning round");
}

// ── Test 4: 规划失败 → handled:false（调用方回退单发） ──
{
  fetchCalls = [];
  mockFetchImpl = function () {
    throw new Error("network down");
  };
  const outcome = await hooks.runChatAgent("你好", {
    language: "zh", chatLogEl: chatLogStub, memoryText: "", history: [], viewContext: null
  });
  assertEqual(outcome.handled, false, "plan failure must fall back to caller");
  assertTruthy(outcome.error, "fallback outcome should carry an error");
}

console.log("OK 4 scenarios");
```

- [ ] **Step 5: 运行确认通过**

Run: `node scripts/test_chat_agent.mjs`
Expected: `OK 4 scenarios`（如报 `ReferenceError: runChatAgent is not defined`，检查 Task 7 Step 1/Step 3 的插入锚点）

- [ ] **Step 6: 回归**

Run: `node --check public/app.js && node scripts/test_chatbot_intent_flow.mjs && node scripts/test_zh_chatbot.mjs && node scripts/test_chat_agent.mjs`
Expected: 全部通过

- [ ] **Step 7: Commit（仅在用户授权提交时）**

```bash
git add public/app.js scripts/test_chat_agent.mjs
git commit -m "Run agent loop in Chat Mode / Chat Mode 运行 Agent 循环"
```

---

### Task 8: 步骤卡片样式

**Files:**
- Modify: `public/styles.css`（`.chat-input` 样式区附近，~第 629-709 行区块之后）

- [ ] **Step 1: 追加样式**

在 `public/styles.css` 中找到 `.chat-input` 规则块（约第 629 行起），在其**之前**插入：

```css
/* ── Chat Agent 步骤卡片 ── */
.agent-step {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 12px;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.4;
  border: 1px solid var(--oi-border, #e2e8f0);
  background: var(--oi-surface, #f8fafc);
  color: var(--oi-text, #334155);
}
.agent-step-running { border-color: var(--oi-accent, #2563eb); background: var(--oi-accent-soft, #eff6ff); }
.agent-step-done { border-color: var(--oi-success, #16a34a); background: var(--oi-success-soft, #f0fdf4); }
.agent-step-error { border-color: var(--oi-danger, #dc2626); background: var(--oi-danger-soft, #fef2f2); }
.agent-step-icon { flex: 0 0 auto; font-weight: 700; }
.agent-step-text { overflow-wrap: anywhere; }
```

（`--oi-*` 变量为本项目现有 CSS 变量命名风格；若个别变量不存在，回退值会自动生效。）

- [ ] **Step 2: 校验**

Run: `node --check public/app.js`
Expected: 无输出（本任务不改 JS，仅确认未破坏）

- [ ] **Step 3: Commit（仅在用户授权提交时）**

```bash
git add public/styles.css
git commit -m "Style agent step cards / 添加 Agent 步骤卡片样式"
```

---

### Task 9: CI 接入 + 全量验证 + 文档备注

**Files:**
- Modify: `.github/workflows/ci.yml`（回归测试列表追加 4 个新测试）
- Modify: `docs/chatbot-feature-report.md`（概述一节后加 Agent 小节）

- [ ] **Step 1: 更新 `ci.yml`**

在 `.github/workflows/ci.yml` 的 `Run regression tests` 块中，`python scripts/test_payment_placeholders.py` 行之前追加：

```yaml
          python scripts/test_llm_agent.py
          python scripts/test_agent_http.py
          python scripts/test_agent_config.py
          node scripts/test_chat_agent.mjs
```

（该块内命令按字母/分类排序均可，保持缩进一致——列表项为 10 空格缩进。）

- [ ] **Step 2: 文档备注**

`docs/chatbot-feature-report.md` 第 7 行（概述段落）之后插入：

```markdown
> Chat Mode Agent（工具调用）设计与实现见 `docs/superpowers/specs/2026-08-14-chat-mode-agent-design.md` 与 `docs/superpowers/plans/2026-08-14-chat-mode-agent.md`。
```

- [ ] **Step 3: 全量验证**

Run（项目根目录）：

```bash
node --check public/auth.js
node --check public/app.js
node --check public/chatbot_i18n.js
python scripts/test_auth_helpers.py
python scripts/test_llm_stream_timeout.py
python scripts/test_vercel_chat_routes.py
python scripts/test_llm_agent.py
python scripts/test_agent_http.py
python scripts/test_agent_config.py
node scripts/test_chatbot_intent_flow.mjs
node scripts/test_zh_chatbot.mjs
node scripts/test_chat_agent.mjs
python -m py_compile llm_provider.py chat_agent_http.py server.py auth.py api/chat/actions.py api/chat/stream.py
```

Expected: 全部通过、无错误输出。

- [ ] **Step 4: 手动冒烟（可选，需本地 LLM key）**

Run: `python server.py`，浏览器打开 http://127.0.0.1:8765，登录后在 Chat Mode 输入「Shokz 的在同品类的表现」。
Expected: 依次看到「正在规划分析步骤…」→「✓ 商户报告完成：…」→ 流式回答含同品类百分位与 Peer 表格。
**完成后务必关闭服务器**：前台 `Ctrl+C`；或 `netstat -ano | grep 8765 | grep LISTEN` 找到 PID 后 `taskkill //F //PID <PID>`。

- [ ] **Step 5: Commit（仅在用户授权提交时）**

```bash
git add .github/workflows/ci.yml docs/chatbot-feature-report.md
git commit -m "Wire agent tests into CI / 将 Agent 测试接入 CI"
```

---

## 自审记录

**Spec 覆盖**：设计文档 §4.1-4.3（工具注册表/实现/压缩）→ Task 6；§4.4（call_llm_tools）→ Task 1；§4.5（/api/chat/agent）→ Task 3/4；§4.6（stream messages）→ Task 2/3/4；§4.7（runChatAgent + applyPrompt）→ Task 6/7；§4.8（system prompts）→ Task 3；§6 降级链（LLM 失败→单发、无工具→directContent、工具失败→补充规划、综合失败→fallback、循环上限）→ Task 7 + `AGENT_MAX_*` 常量；§7 开关 `OI_AGENT_ENABLED` → Task 5；§8 测试 → Task 1-7 各自测试 + Task 9 CI；§9 Phase 1 范围 → 本计划全部任务。

**占位符扫描**：无 TBD/TODO；所有代码块完整；所有锚点给出确切行号或唯一锚文本。

**类型一致性**：`runChatAgent` 返回 `{handled, ok, fullResponse, statusBar, directContent, error}` 与 Task 7 Step 2 调用处字段一致；`streamAssistantReply` 返回 `{ok, fullResponse, msgEl, statusBar}` 与 Task 7 Step 1/Step 2 使用一致；`handle_agent_request` 签名在 Task 3 定义、Task 4 使用一致；`agentExecuteTool` 返回 `{ok, data|error}` 与 Task 6 Step 1、Task 7 使用一致；`normalize_tool_response`/`call_llm_tools` 在 Task 1 定义、Task 3 使用一致。

**已知偏差（有意为之）**：设计文档 §11.1 的默认「步骤卡片先中文」改为 `agentStepCopy(language)` 同时提供中英（避免英文 UI 出现混合语言回归，成本 ~10 行）；设计文档 §4.7 的「补充规划以 tool 角色回传」改为以 user 角色文本回传（本项目 LLM 消息从不使用 tool 角色，跨 DeepSeek/Claude 更稳，且与 stream 直传路径一致）。
