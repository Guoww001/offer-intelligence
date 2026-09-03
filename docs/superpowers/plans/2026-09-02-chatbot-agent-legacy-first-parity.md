# Chatbot 与 Agent Legacy-first 及视觉等价实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Chatbot 与 Agent 恢复为默认 Legacy 渲染，同时保留显式 Modern 预览，并让 Modern 页面复用原版结构、类名、主题变量和交互位置。

**Architecture:** `public/app.js` 继续负责页面选择和 Legacy bridge；Modern 只有在 `window.__OI_MODERN_CHATBOT_AGENT_PARITY__ === true` 时挂载。Vue 页面保留现有 session/bridge 行为，但模板改为复用 Legacy 的 `insight-panel`、`chat-panel`、`message`、`chat-input`、`agent-page-*` 和 `agent-run-*` 样式体系，不新增运行时或 CopilotKit 依赖。

**Tech Stack:** Vue 3、TypeScript、Vitest、Node 静态契约测试、现有 `public/styles.css`。

## Global Constraints

- 不修改 Agent v2、LLM、SSE、Trace、数据来源、日志、反馈或隐私契约。
- 保留 Modern factory、根节点和 Legacy fallback；默认必须为 Legacy-first。
- 不删除或覆盖现有未提交的 M7 文件和缓存。
- 本轮不提交、不推送；最终真实浏览器视觉验收由用户执行。

---

### Task 1: Legacy-first 默认切换

**Files:**
- Modify: `scripts/test_m6_chatbot_agent_behavior_parity.mjs`
- Modify: `scripts/test_modern_page_cutover.mjs`
- Modify: `public/app.js`

- [x] **Step 1: 写失败测试**

将静态契约改为要求 `modernChatbotAgentParityEnabled()` 只有在显式 `=== true` 且 bridge 可用时返回 true，同时禁止 `!== false` 的 Modern-first 逻辑。

- [x] **Step 2: 运行测试确认 RED**

Run: `node scripts/test_m6_chatbot_agent_behavior_parity.mjs` 与 `node scripts/test_modern_page_cutover.mjs`

Expected: 因当前仍为 `!== false` 而失败。

- [x] **Step 3: 最小实现**

把 gate 改为：

```js
return window.__OI_MODERN_CHATBOT_AGENT_PARITY__ === true
  && modernChatbotAgentBridgeAvailable();
```

- [x] **Step 4: 运行测试确认 GREEN**

Run: 上述两个 Node 测试。

---

### Task 2: Agent 原版结构与交互位置对齐

**Files:**
- Modify: `frontend/src/features/agent/AgentPage.test.ts`
- Modify: `frontend/src/features/agent/AgentTimeline.test.ts`
- Modify: `frontend/src/features/agent/AgentPage.vue`
- Modify: `frontend/src/features/agent/AgentTimeline.vue`
- Modify: `frontend/src/features/agent/agent.css`

- [x] **Step 1: 写失败测试**

要求 Modern Agent 使用 `agent-page-header`、`agent-page-layout`、`agent-page-rail panel`、`chat-panel agent-page-chat-panel`、`chat-log agent-chat-log`、`message user|assistant`、`chat-input agent-page-input` 和 `agent-run-timeline`；停止按钮位于原版头部操作区，发送输入使用原版 input 结构。

- [x] **Step 2: 运行测试确认 RED**

Run: `npm --prefix frontend run test -- --run src/features/agent/AgentPage.test.ts src/features/agent/AgentTimeline.test.ts`

Expected: 缺少 Legacy 结构类名而失败。

- [x] **Step 3: 最小实现**

只调整 Vue 模板和 Modern 兼容 CSS；保留所有现有 props、data hooks、事件、session、停止、日志、反馈和记忆逻辑。

- [x] **Step 4: 运行测试确认 GREEN**

Run: 上述 Agent Vitest。

---

### Task 3: Chatbot 原版双栏、模式切换与输入区对齐

**Files:**
- Modify: `frontend/src/features/chatbot/ChatbotPage.test.ts`
- Modify: `frontend/src/features/chatbot/ChatbotChatView.test.ts`
- Modify: `frontend/src/features/chatbot/ChatbotPage.vue`
- Modify: `frontend/src/features/chatbot/ChatbotReportView.vue`
- Modify: `frontend/src/features/chatbot/ChatbotChatView.vue`
- Modify: `frontend/src/features/chatbot/chatbot.css`
- Modify: `public/styles.css`

- [x] **Step 1: 写失败测试**

要求 Modern Chatbot 使用原版 `insight-panel` + `chat-panel` 双栏、`chart-header`、`context-panel`、`chat-log`、`chat-memory-bar`、`chat-mode-toggle`、`mode-btn`、`chat-input` 和 `message` 类；Modern 模式不得隐藏原版 topbar 标题。

- [x] **Step 2: 运行测试确认 RED**

Run: `npm --prefix frontend run test -- --run src/features/chatbot/ChatbotPage.test.ts src/features/chatbot/ChatbotChatView.test.ts` 与 `node scripts/test_m6_modern_mount.mjs`

Expected: 当前新设计结构与 topbar 隐藏规则导致失败。

- [x] **Step 3: 最小实现**

重排模板但不改业务逻辑；Modern 专属 CSS 仅补 Vue 容器、响应式和无 ID 选择器兼容，颜色、边框、阴影、消息和输入区统一继承 `public/styles.css`。

- [x] **Step 4: 运行测试确认 GREEN**

Run: 上述 Chatbot Vitest 与 Modern mount 测试。

---

### Task 4: 状态文档回到 dual / Legacy-first

**Files:**
- Modify: `docs/chatbot-feature-report.md`
- Modify: `docs/frontend-migration-inventory.md`
- Modify: `docs/superpowers/plans/2026-08-27-frontend-framework-migration-roadmap.md`
- Modify: `docs/superpowers/plans/2026-09-01-m6-chatbot-agent-modern-migration.md`
- Modify: `docs/superpowers/plans/2026-09-02-m6-chatbot-agent-behavior-parity.md`
- Modify: `docs/superpowers/plans/2026-09-02-m6-copilotkit-agent-migration-plan.md`

- [x] **Step 1: 更新状态**

将 `dashboard`、`agent` 从 `modern` 改为 `dual`，说明默认 Legacy-first、显式 true 才进入 Modern 对照，自动化覆盖行为而真实视觉验收待用户完成。

- [x] **Step 2: 校验文档与代码一致**

Run: `node scripts/test_modern_page_cutover.mjs` 与 `git diff --check`。

---

### Task 5: 完整自动化验证

**Files:**
- Verify only.

- [x] **Step 1: 前端检查**

Run: `npm --prefix frontend run typecheck`、目标 Vitest、`npm --prefix frontend run build`。

- [x] **Step 2: Legacy 与桥接回归**

Run: `node --check public/app.js`、`node scripts/test_m6_chatbot_agent_behavior_parity.mjs`、`node scripts/test_m6_modern_mount.mjs`、`node scripts/test_modern_page_cutover.mjs`、`node scripts/test_dashboard_chat_pages.mjs`、`node scripts/test_chatbot_mode_navigation.mjs`、`node scripts/test_agent_stop_button.mjs`、`node scripts/test_agent_execution_timeline.mjs`。

- [x] **Step 3: 差异与工作区边界**

Run: `git diff --check`、`git status --short`；确认 M7 未跟踪文件及缓存保持原状。

- [x] **Step 4: 用户视觉验收交接**

提供 Legacy 默认路径及 `window.__OI_MODERN_CHATBOT_AGENT_PARITY__ = true` 的 Modern 对照方式；不代替用户声明视觉通过。

## 执行结果（2026-09-02）

- Legacy-first 闸门、Modern 显式预览、factory/bridge 回退与 `dual` 清单状态已通过 M6 静态契约。
- Agent 与 Chatbot 目标测试先 RED 后 GREEN；最终相关 Vitest 为 12 个文件、52 项通过。
- Vite 生产构建、`public/app.js` 语法、Chatbot/Agent 页面、模式导航、欢迎/引导、Agent 停止/时间线/记忆/问题日志及 Chat Agent 33 场景通过。
- `npm --prefix frontend run typecheck` 已执行；本次模板产生的 4 项错误已修复，剩余错误仅来自任务开始前已有的未跟踪 M7 `agentSession.ts`、`chatbotSession.ts` 及其测试缺失契约，未改动这些文件。
- 未运行浏览器视觉验收；最终视觉、真实数据和实际 SSE 网络验证交给用户。
