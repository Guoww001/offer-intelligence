# Agent Chat DeepSeek Layout Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** 将独立 Agent 聊天区重构为更接近 DeepSeek 网页版的聚焦式对话布局，同时保留现有 Agent 工具执行、思考时间线、多月份数据和 Report/Chat Mode 的视觉边界。

**Architecture:** 只调整独立 Agent 页面：保留页面级标题、能力侧栏和现有 Agent 执行逻辑，把聊天面板内部改为“居中可读消息列 + 轻量 Agent 回复 + 右侧用户气泡 + 底部悬浮输入岛”。通过独立 CSS 变量和 data-agent-surface 作用域隔离样式，不改数据查询、SSE、工具调用和历史状态；仅对输入按钮补充可访问的图标结构。

**Tech Stack:** Vanilla HTML, CSS, JavaScript, Node.js contract tests, local server.py, browser runtime inspection.

## Global Constraints

- 所有交流、注释和文档使用简体中文；代码标识符保持现有英文命名。
- 只修改独立 Agent 页面相关的 public/index.html、public/app.js、public/styles.css 与契约测试，不改变原 Chatbot Report Mode / Chat Mode 的视觉边界。
- 保留现有蓝底白字用户消息、Agent 执行时间线、表格横向滚动和 reduced-motion 支持。
- 不使用 banned font、厚重图标、默认线性动画、top/left/width/height 动画或滚动容器上的大面积 backdrop blur。
- 完成后运行静态契约、语法检查和本地浏览器运行时验证；关闭本地服务。

---

### Task 1: 增加 DeepSeek 风格聊天区域结构契约

**Files:**
- Modify: public/index.html:481-497
- Modify: public/app.js:agent translation entries
- Modify: scripts/test_dashboard_chat_pages.mjs:20-27

**Interfaces:**
- Consumes: Existing #agentChatLog, #agentChatForm, #agentChatInput, and action.send translation.
- Produces: .agent-chat-context, .agent-input-meta, .agent-send-icon, and a send button with an accessible text label.

- [x] Step 1: Extend the failing contract assertions

在 scripts/test_dashboard_chat_pages.mjs 中增加以下断言：

~~~js
assert(html.includes('class="agent-chat-context"'), "Agent chat context bar is missing");
assert(html.includes('class="agent-input-meta"'), "Agent input meta row is missing");
assert(html.includes('class="agent-send-icon"'), "Agent send icon is missing");
assert(styles.includes(".dashboard-agent-page .agent-chat-context"), "Agent context bar styles are missing");
assert(styles.includes(".dashboard-agent-page .agent-input-meta"), "Agent input meta styles are missing");
assert(styles.includes(".dashboard-agent-page .agent-send-icon"), "Agent send icon styles are missing");
~~~

- [x] Step 2: Run the contract to verify it fails

Run: node scripts/test_dashboard_chat_pages.mjs

Expected: FAIL because the new Agent chat structure and selectors do not exist yet.

- [x] Step 3: Add the minimal HTML structure

在 .agent-page-chat-panel 内，将聊天日志前加入上下文栏，并将输入区域改为包含辅助提示和可访问的图标按钮：

~~~html
<div class="agent-chat-context">
  <span class="agent-chat-context-mark" aria-hidden="true"></span>
  <span data-i18n="agent.context">Read-only data workspace</span>
</div>
<div class="chat-log agent-chat-log" id="agentChatLog" aria-live="polite">...</div>
<form class="chat-input agent-page-input" id="agentChatForm">
  <div class="chat-input-field">...</div>
  <div class="agent-input-meta">
    <span data-i18n="agent.inputHint">Enter to send · multi-month data ready</span>
    <span class="agent-input-scope" data-i18n="agent.inputScope">Read-only</span>
  </div>
  <button type="submit" aria-label="Send">
    <span class="agent-send-label" data-i18n="action.send">Send</span>
    <span class="agent-send-icon" aria-hidden="true">↑</span>
  </button>
</form>
~~~

保持原有 id、输入框和事件绑定不变；不要加入未实现的附件、搜索或模型切换控件。

- [x] Step 4: Add translations

在 public/app.js 中中英文 Agent 文案表分别增加：

~~~text
agent.context: 只读数据工作区 / Read-only data workspace
agent.inputHint: 回车发送 · 支持多月份数据 / Enter to send · multi-month data ready
agent.inputScope: 只读 / Read-only
~~~

- [x] Step 5: Run the contract to verify it passes

Run: node scripts/test_dashboard_chat_pages.mjs

Expected: PASS.

---

### Task 2: Replace the card-heavy chat area with a focused message column

**Files:**
- Modify: public/styles.css:19812-end

**Interfaces:**
- Consumes: Existing .message, .chat-stream-text, .agent-run-timeline, .chat-input, and .agent-page-chat-panel DOM.
- Produces: DeepSeek-inspired centered reading column, quiet assistant output, compact user bubble, and a floating input island.

- [x] Step 1: Add the focused-layout CSS layer

Append a later scoped layer using only body.dashboard-mode .dashboard-agent-page selectors. Use these design decisions:

~~~css
body.dashboard-mode .dashboard-agent-page .agent-page-chat-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  border-radius: 28px;
  background: var(--agent-surface);
  box-shadow: var(--agent-shadow);
}

body.dashboard-mode .dashboard-agent-page .agent-chat-context {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 12px clamp(20px, 5vw, 58px) 0;
  color: var(--agent-muted);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

body.dashboard-mode .dashboard-agent-page .agent-chat-log {
  display: flex;
  flex-direction: column;
  padding: 38px clamp(20px, 7vw, 92px) 24px;
}

body.dashboard-mode .dashboard-agent-page .message {
  width: min(100%, 760px);
  max-width: 760px;
  margin: 0 auto 24px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

body.dashboard-mode .dashboard-agent-page .message.assistant {
  align-self: center;
  color: var(--agent-ink);
}

body.dashboard-mode .dashboard-agent-page .message.user {
  align-self: flex-end;
  width: fit-content;
  max-width: min(78%, 620px);
  margin-right: max(0px, calc((100% - 760px) / 2));
  padding: 13px 17px;
  border: 1px solid rgba(156, 199, 255, 0.24);
  border-radius: 20px 20px 7px 20px;
  background: linear-gradient(145deg, var(--agent-user-start), var(--agent-user-end));
  color: #ffffff;
  box-shadow: 0 12px 26px rgba(10, 37, 84, 0.18);
}

body.dashboard-mode .dashboard-agent-page .message.assistant::before,
body.dashboard-mode .dashboard-agent-page .message.user::before {
  display: none;
}

body.dashboard-mode .dashboard-agent-page .message.assistant .chat-stream-text {
  position: relative;
  padding-left: 42px;
}

body.dashboard-mode .dashboard-agent-page .message.assistant .chat-stream-text::before {
  content: "✦";
  position: absolute;
  margin-left: -38px;
  color: var(--agent-primary);
}
~~~

The implementation must keep assistant tables in a nested soft container and keep user Markdown descendants white.

- [x] Step 2: Style the execution timeline as a compact reasoning trace

Keep the timeline in the same centered column, but use a low-contrast shell:

~~~css
body.dashboard-mode .dashboard-agent-page .agent-run-timeline {
  width: min(100%, 760px);
  margin: 0 auto 22px;
  border: 1px solid var(--agent-line);
  border-radius: 16px;
  background: color-mix(in srgb, var(--agent-surface-soft) 72%, transparent);
  box-shadow: none;
}
~~~

Do not hide, remove, or rewrite the timeline DOM.

- [x] Step 3: Style the bottom input as a DeepSeek-like floating island

Use a double-bezel outer form and a circular arrow action:

~~~css
body.dashboard-mode .dashboard-agent-page .agent-page-input {
  position: relative;
  width: min(100% - 32px, 820px);
  margin: 0 auto 18px;
  grid-template-columns: minmax(0, 1fr) auto;
  padding: 7px 8px 7px 16px;
  border: 1px solid var(--agent-line-strong);
  border-radius: 22px;
  background: color-mix(in srgb, var(--agent-surface-soft) 92%, transparent);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.16), 0 12px 30px rgba(2,8,25,0.12);
}

body.dashboard-mode .dashboard-agent-page .agent-page-input > button {
  width: 42px;
  min-width: 42px;
  height: 42px;
  min-height: 42px;
  padding: 0;
  border-radius: 50%;
}

body.dashboard-mode .dashboard-agent-page .agent-send-label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

body.dashboard-mode .dashboard-agent-page .agent-send-icon {
  display: grid;
  place-items: center;
  font-size: 19px;
  line-height: 1;
  transform: translateY(-1px);
}
~~~

Add .agent-input-meta under the input field, keep the form’s effective input column stable, and move the responsive overrides to the same selector layer.

- [x] Step 4: Add mobile and reduced-motion rules

Below 768px, remove the desktop side offset, use width: calc(100% - 20px), reduce chat padding, and keep the send button at 40–42px. Add the new welcome/context/meta elements to the reduced-motion list. Do not animate layout properties.

- [x] Step 5: Run syntax and contract checks

Run:
- node scripts/test_dashboard_chat_pages.mjs
- node scripts/test_agent_execution_timeline.mjs
- node --check public/app.js
- git diff --check

Expected: all PASS / exit code 0.

---

### Task 3: Visual runtime verification and final polish

**Files:**
- Modify: public/styles.css only if screenshot inspection identifies a concrete contrast or overflow issue.
- Test: scripts/test_dashboard_chat_pages.mjs, scripts/test_agent_execution_timeline.mjs

**Interfaces:**
- Consumes: Task 1 and Task 2 layout contract.
- Produces: Verified desktop, light-theme, dark-theme, and mobile Agent chat layouts.

- [x] Step 1: Start the local server

Run with auth disabled:

~~~powershell
$env:OI_AUTH_ENABLED='0'
python server.py
~~~

Expected: Offer chatbot server listening on http://127.0.0.1:8765.

- [x] Step 2: Verify desktop Agent layout

Open /, navigate to Agent, and inspect:
- context bar is subtle and does not push the conversation below the fold;
- welcome state is centered and not a heavy card;
- assistant text reads as a clear document column;
- user bubble is right-aligned with white text;
- timeline is compact and readable;
- input island is centered and send action is circular.

- [x] Step 3: Verify a real multi-month Agent query

Submit Shokz 最近 2 个月趋势; verify the user bubble, timeline, assistant table, and both month labels remain visible without horizontal page overflow.

- [x] Step 4: Verify light theme and mobile width

Toggle light theme and inspect at approximately 390px width. Verify:
- no unreadable text;
- no clipped input island;
- user bubble stays within viewport;
- tables scroll inside their own container;
- original Chatbot page remains visually unchanged.

- [x] Step 5: Stop the local server and report evidence

Close server.py, verify port 8765 is not listening, then report modified files and exact command results.

---

## Self-review

- DeepSeek-inspired layout coverage: centered reading column, right-aligned compact user bubble, quiet assistant answer, bottom floating input island, context/mode hint.
- Existing Agent execution coverage: timeline DOM and classes remain untouched.
- Existing data coverage: no tool, DB, monthly, SSE, or history code is modified.
- Responsive coverage: desktop, <=1000px, <=767px, and reduced-motion rules are explicitly defined.
- Placeholder scan: no TODO/TBD/implement later steps are present.
