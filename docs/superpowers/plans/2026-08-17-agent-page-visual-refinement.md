# Agent Page Visual Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Dashboard Agent 页面和对话内容升级为商务、优雅、易读的独立数据工作台，并修复用户蓝色消息中的黑字问题。

**Architecture:** 保留现有 Agent HTML 结构、运行链路和原 Chatbot 样式边界；通过 Agent 页面专属 DOM 标记和末端 CSS 主题层重塑视觉，不修改数据查询、LLM 或月度数据逻辑。用户消息使用深海军蓝渐变与白字，Agent 回复使用白色数据卡片，执行时间线、表格和输入区共享同一套视觉 token。

**Tech Stack:** Vanilla HTML, scoped CSS, existing Plus Jakarta Sans/CJK fallbacks, Node static contract tests, browser runtime inspection.

## Global Constraints

- 只修改 Agent 页面及其对话呈现，不改变原 Chatbot Report Mode / Chat Mode 的行为和视觉边界。
- 用户蓝色消息必须保持白字，包括 Markdown 生成的 `p`、`strong`、标题、列表和链接。
- 视觉方向采用 Executive Data Studio：矿物灰工作区、深海军蓝结构、钴蓝交互强调、白色数据面板。
- 桌面双栏布局，`768px` 以下单列；保留键盘焦点和 `prefers-reduced-motion`。
- 不提交、不推送；保留工作区现有未提交修改。

---

### Task 1: 固定 Agent 视觉契约

**Files:**
- Modify: `public/index.html:440-488`
- Modify: `scripts/test_dashboard_chat_pages.mjs`

- [x] **Step 1: Write the failing visual contract assertions**

断言 Agent 页面存在标题状态区、独立对话工作台标记、用户消息白字覆盖选择器和响应式 Agent 主题层。

- [x] **Step 2: Run the focused contract test and verify it fails**

Run: `node scripts/test_dashboard_chat_pages.mjs`

Expected: FAIL because the new Agent visual markers/selectors are not present.

- [x] **Step 3: Add semantic Agent page markers**

在 Agent header 增加标题行和数据层状态 chip，在聊天面板增加 `data-agent-surface="workspace"`，让 CSS 可精确作用于 Agent，不污染原 Chatbot。

- [x] **Step 4: Run the focused contract test and verify it passes**

Run: `node scripts/test_dashboard_chat_pages.mjs`

Expected: `PASS: Dashboard Chatbot/Agent page contract`。

### Task 2: 重塑 Agent 页面壳层和对话气泡

**Files:**
- Modify: `public/styles.css:2867-3245` and append the scoped visual refinement layer

- [x] **Step 1: Build the scoped Executive Data Studio theme**

为 `.dashboard-agent-page` 增加矿物灰背景、深海军蓝 rail、白色对话工作台、标题状态 chip、柔和双层阴影、明确的桌面/移动间距和非线性 cubic-bezier 过渡。

- [x] **Step 2: Style conversation hierarchy**

为 Agent 的 `.message.user` 使用深蓝渐变与白字；为 `.message.assistant` 使用白色内容卡片；覆盖 `.chat-stream-text` 的 Markdown 标题、段落、表格、代码、引用和链接，保证结果可扫描。

- [x] **Step 3: Refine timeline, welcome state, input and stop/new buttons**

让执行时间线成为低干扰的状态摘要，让欢迎卡片和输入区形成明确的起始/结束边界；按钮使用 pill/内层光泽/active scale 与可见 focus。

- [x] **Step 4: Add responsive and reduced-motion rules**

在 `max-width: 1000px` 和 `max-width: 600px` 下收敛布局；在 `prefers-reduced-motion: reduce` 下关闭 Agent 页面入场和浮动动效。

### Task 3: Runtime and regression verification

**Files:**
- Test: `scripts/test_dashboard_chat_pages.mjs`
- Test: `scripts/test_agent_execution_timeline.mjs`
- Test: `scripts/test_chat_agent.mjs`

- [x] **Step 1: Run static checks**

Run: `node scripts/test_dashboard_chat_pages.mjs`, `node scripts/test_agent_execution_timeline.mjs`, `node scripts/test_chat_agent.mjs`, `node --check public/app.js`, `git diff --check`。

- [x] **Step 2: Inspect the rendered Agent page in the local browser**

验证 Agent 页面默认状态、用户提问蓝底白字、Agent 回复 Markdown、时间线展开/折叠、停止按钮和移动端宽度；确认原 Chatbot 页面仍显示 Recommendation Chatbot、Report Mode 和 Chat Mode。

- [x] **Step 3: Clean up and report**

关闭本地服务，确认 `8765` 端口已释放，汇报浏览器证据和未验证项，不提交或推送。
