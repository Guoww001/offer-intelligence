# Chat Agent Request Limit and Tool Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Chat Agent 综合请求的实际读取上限，并确保规划出的超过 4 个工具调用按批次执行且不会静默丢失目标。

**Architecture:** 保留现有 128KB 综合请求配置和 6 次工具总预算。后端将共享综合上限显式传给 JSON 读取函数；前端保留规划结果，按每批最多 4 个调用执行，达到总预算时记录并向综合模型及用户明确暴露未执行目标。

**Tech Stack:** Python `http.server` / Vercel handler、Vanilla JavaScript、Node.js/MJS 回归测试、Python 测试脚本。

## Global Constraints

- 规划请求继续使用 64KB 上限。
- 综合请求使用 `AGENT_SYNTHESIS_MAX_REQUEST_BYTES = 128 * 1024`。
- 单批最多并行执行 4 个工具调用，总工具调用预算最多 6 个。
- 不改变现有工具名称、工具结果字段和本地/Vercel 路由。
- 使用中文更新路线图和相关架构说明；不提交或推送 Git。

---

### Task 1: 传递综合请求的 128KB 读取上限

**Files:**
- Modify: `server.py:268`
- Modify: `api/chat/stream.py:50`
- Test: `scripts/test_chat_stream_agent_config.py`

**Interfaces:**
- Consumes: `chat_agent_http.AGENT_SYNTHESIS_MAX_REQUEST_BYTES`。
- Produces: 两个综合流入口都调用 `_read_json_body(..., max_size=AGENT_SYNTHESIS_MAX_REQUEST_BYTES)`。

- [x] **Step 1: Write the failing test**

在 `scripts/test_chat_stream_agent_config.py` 增加源码契约断言，要求本地和 Vercel 综合流入口显式传递 `max_size`：

```python
def test_synthesis_readers_use_shared_request_limit():
    for relative in ("server.py", "api/chat/stream.py"):
        source = (ROOT / relative).read_text(encoding="utf-8")
        assert "_read_json_body(self, max_size=AGENT_SYNTHESIS_MAX_REQUEST_BYTES)" in source, (
            f"{relative} must pass the shared Agent synthesis request limit to _read_json_body"
        )
```

- [x] **Step 2: Run the test to verify it fails**

Run: `python scripts/test_chat_stream_agent_config.py`

Expected: FAIL because both handlers currently call `_read_json_body(self)` without `max_size`。

- [x] **Step 3: Write minimal implementation**

将 `server.py` 和 `api/chat/stream.py` 的综合流读取调用改为：

```python
body = _read_json_body(self, max_size=AGENT_SYNTHESIS_MAX_REQUEST_BYTES)
```

- [x] **Step 4: Run the test to verify it passes**

Run: `python scripts/test_chat_stream_agent_config.py`

Expected: PASS。

---

### Task 2: 将超过 4 个工具调用拆成批次并暴露超限目标

**Files:**
- Modify: `public/app.js:13844-13866,14930-15080`
- Test: `scripts/test_chat_agent.mjs`

**Interfaces:**
- Consumes: `normalizeAgentToolCalls()` 的完整规划结果、`AGENT_MAX_TOOLS_PER_ROUND = 4`、`AGENT_MAX_TOOL_CALLS = 6`。
- Produces: `runChatAgent()` 返回 `partial`、`omittedTargets`、`executedToolCalls` 和 `plannedToolCalls`，并在综合上下文、执行时间线和最终回答中声明未执行目标。

- [x] **Step 1: Write the failing test**

在 `scripts/test_chat_agent.mjs` 增加 6 调用和 7 调用场景：6 个调用必须全部执行；7 个调用只能执行 6 个，并返回部分执行元数据及未执行目标。

```javascript
// 6 个规划调用应按 4 + 2 两批全部执行
assertEqual(monthlyCalls, 6, "six planned tool calls should all execute in 4+2 batches");

// 超过总预算时不能静默丢弃
assertEqual(partialOutcome.partial, true, "seventh tool call should mark the outcome partial");
assertEqual(partialOutcome.executedToolCalls, 6, "tool budget should execute six calls");
assertEqual(partialOutcome.omittedTargets.length, 1, "one target should be explicitly omitted");
assertIncludes(partialOutcome.fullResponse, "未执行", "partial answer should disclose omitted target");
```

- [x] **Step 2: Run the test to verify it fails**

Run: `node scripts/test_chat_agent.mjs`

Expected: FAIL because `plannedCalls.slice(0, AGENT_MAX_TOOLS_PER_ROUND)` executes only the first 4 calls and `runChatAgent()` does not return omission metadata。

- [x] **Step 3: Write minimal implementation**

执行逻辑按以下行为实现：

```javascript
var executableCalls = plannedCalls.slice(0, AGENT_MAX_TOOL_CALLS - toolCallsTotal);
var omittedCalls = plannedCalls.slice(executableCalls.length);
while (executableCalls.length) {
  var batch = executableCalls.splice(0, AGENT_MAX_TOOLS_PER_ROUND);
  var batchResults = await Promise.all(batch.map(executeOneAgentTool));
  // 保存所有结果，继续下一批；失败时在所有已规划批次完成后再请求修正规划
}
```

删除 `normalizeAgentToolCalls()` 中对 merchant/trend 展开的 4 项切片；在综合消息、时间线和最终回答中加入超出总预算的目标及 `partial` 状态。

- [x] **Step 4: Run the test to verify it passes**

Run: `node scripts/test_chat_agent.mjs`

Expected: PASS，且 6 个调用按 4+2 执行，7 个调用明确报告 1 个目标未执行。

---

### Task 3: 更新文档并完成验证

**Files:**
- Modify: `docs/chat-agent-optimization-roadmap.md`
- Modify: `docs/chatbot-feature-report.md`

- [x] **Step 1: 更新路线图状态**

将 P0.1 和 P0.2 从“待修复建议”改为已完成实现，记录实际行为、回归测试和仍未处理的后续 P0/P1 项。

- [x] **Step 2: 更新 Chatbot 架构说明**

补充综合请求大小边界、工具批处理规则、总预算和部分执行返回字段。

- [x] **Step 3: 运行验证**

Run:

```text
node --check public/app.js
python scripts/test_chat_stream_agent_config.py
node scripts/test_chat_agent.mjs
python scripts/test_agent_http.py
```

Expected: 全部 PASS。
