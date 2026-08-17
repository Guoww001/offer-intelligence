# Agent Execution Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 Dashboard Agent 的散落步骤提示升级为可折叠、可解释、可取消的执行过程时间线，并保留原 Chatbot 的现有展示行为。

**Architecture:** `runChatAgent()` 增加可选的 `executionTimeline` 运行上下文。只有独立 Agent 页面传入该开关，创建一个包含规划、工具执行、结果整理和最终状态的 `<details>` 时间线；原 Chatbot 不传开关，继续使用现有步骤卡片。Agent 页面通过 `AbortController` 中止规划/综合请求，并在工具执行边界显示停止状态。

**Tech Stack:** Vanilla JavaScript IIFE、原生 DOM、CSS 变量、SSE、Node.js 测试脚本。

## Global Constraints

- 不展示模型原始 Chain-of-Thought，只展示用户可理解的执行摘要、查询范围和结果摘要。
- 原 Chatbot、Report Mode、Deep Window 的路由和行为保持不变。
- Agent 的月度查询必须在执行过程里显式展示月份范围或“月度数据不可用”。
- 中英文 UI 文案保持同步，所有新增说明使用简体中文。
- 不新增依赖，不修改数据库接口契约。
- 保留当前工作区已有未提交修改，不执行 reset、stash、commit 或 push。

---

### Task 1: 建立执行时间线和取消流程的失败测试

**Files:**
- Modify: `scripts/test_chat_agent.mjs`
- Create: `scripts/test_agent_execution_timeline.mjs`

**Interfaces:**
- Expected hook: `createAgentExecutionTimeline(log, language)` returns `{ root, addStep, updateStep, finish }`.
- Expected `runChatAgent()` option: `executionTimeline: true`, `signal`.
- Expected result state: `{ handled: true, stopped: true }` when the supplied signal is aborted.

- [ ] **Step 1: Write the failing test**

在 `scripts/test_agent_execution_timeline.mjs` 中加载测试模式的 `app.js`，断言测试 hook 暴露执行时间线工厂，并验证它能创建规划、工具和完成状态；同时断言源码包含 Agent 页面停止按钮契约。

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/test_agent_execution_timeline.mjs`

Expected: FAIL because `createAgentExecutionTimeline` and the Agent stop control do not exist yet.

---

### Task 2: 实现可折叠执行时间线组件

**Files:**
- Modify: `public/app.js:12889-12915`
- Modify: `public/styles.css:4190-4208`
- Test: `scripts/test_agent_execution_timeline.mjs`

**Interfaces:**
- `agentExecutionCopy(language)` returns localized title, phase labels, status labels and stop text.
- `createAgentExecutionTimeline(chatLogEl, language)` creates a `<details>` root and exposes `addStep(payload)`, `updateStep(step, payload)`, and `finish(status, elapsedMs)`.
- `agentToolScopeText(name, args, data, language)` returns a safe summary such as `最近 12 个月 · 数据库月度数据` or `2026-04 · 付款状态筛选`.

- [ ] **Step 1: Implement the minimal timeline DOM helpers**

使用 `details/summary`、状态图标、步骤标题、摘要和耗时字段；执行中展开，成功完成后折叠，失败或停止时保持展开。

- [ ] **Step 2: Add the timeline CSS**

使用现有 `--panel`、`--line`、`--ink`、`--muted`、`--accent` 变量，增加 running/done/error/stopped 状态，不依赖颜色 alone，状态同时显示文本或图标。

- [ ] **Step 3: Run the focused test**

Run: `node scripts/test_agent_execution_timeline.mjs`

Expected: PASS with timeline lifecycle assertions.

---

### Task 3: 接入 Agent 规划、工具、综合和月度范围

**Files:**
- Modify: `public/app.js:13712-13820`
- Test: `scripts/test_chat_agent.mjs`
- Test: `scripts/test_agent_execution_timeline.mjs`

**Interfaces:**
- `runChatAgent(prompt, opts)` only creates the new timeline when `opts.executionTimeline === true`.
- Planning step remains visible after the plan returns and reports the number of planned tool calls.
- Each tool step reports action, scope, success/error, headline, monthly row count or estimate flag.
- A synthesis step starts before `streamAssistantReply()` and ends on final response, deterministic fallback, or error.

- [ ] **Step 1: Add execution timeline test coverage**

Run Agent with a mocked `merchant_analysis` plan and assert the timeline contains planning, database monthly scope, and synthesis completion. Add an aborted fetch scenario and assert `stopped` is returned.

- [ ] **Step 2: Wire timeline steps into `runChatAgent()`**

Keep the current non-timeline path unchanged for original Chatbot calls. In the timeline path, do not remove the planning step; update it in place and add a final synthesis step.

- [ ] **Step 3: Pass abort signals through planning and synthesis**

Add `signal` to `/api/chat/agent` and `/api/chat/stream` fetch options. Treat `AbortError` as a stopped run rather than a network error or fallback synthesis.

- [ ] **Step 4: Run Agent regression tests**

Run: `node scripts/test_agent_execution_timeline.mjs` and `node scripts/test_chat_agent.mjs`

Expected: both PASS; existing 19 Agent scenarios remain green.

---

### Task 4: 接入 Agent 页面停止按钮和双语文案

**Files:**
- Modify: `public/index.html:441-450`
- Modify: `public/app.js:438-445,13825-13910,25930-25945`
- Modify: `public/styles.css:2875-3079`
- Modify: `docs/chatbot-feature-report.md`
- Modify: `docs/chat-mode-analysis-types.md`

**Interfaces:**
- `state.agentPage.abortController` stores only the active Agent page run.
- `stopAgentPageConversation()` aborts the active controller and leaves a localized stopped status.
- The stop button is visible only during an active Agent run; New conversation remains disabled while running.

- [ ] **Step 1: Add the stop button and localized labels**

Add `agent.stop`, `agent.stopped`, `agent.execution.title`, `agent.execution.planning`, `agent.execution.synthesis`, and scope labels in Chinese/English fallback HTML.

- [ ] **Step 2: Connect AbortController to the Agent page**

Create the controller on submit, pass its signal to `runChatAgent()`, expose the stop click handler, and clean it in `finally`.

- [ ] **Step 3: Update documentation**

Document the timeline as a user-facing execution summary and explicitly state that it does not expose raw model chain-of-thought.

- [ ] **Step 4: Run frontend checks**

Run: `node --check public/app.js`, `node scripts/test_agent_execution_timeline.mjs`, `node scripts/test_dashboard_chat_pages.mjs`.

Expected: all PASS.

---

### Task 5: Runtime and regression verification

**Files:**
- Test: `scripts/test_agent_execution_timeline.mjs`
- Test: existing chatbot and Agent regression suites

- [ ] **Step 1: Run the focused and existing tests**

Run the Agent, Chatbot, Report Mode, HTTP and syntax checks from `AGENTS.md` that cover the touched code.

- [ ] **Step 2: Run a local browser check**

Start the local server with authentication disabled only for local verification, open Dashboard → Agent, submit a multi-month trend question, verify the timeline is visible and collapses after completion, then click Stop during a delayed request if available.

- [ ] **Step 3: Verify scope and cleanup**

Run `git diff --check`, inspect `git status --short`, and close all local server processes before reporting results. Do not commit or push.
