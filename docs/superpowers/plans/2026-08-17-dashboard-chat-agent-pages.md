# Dashboard Chatbot and Agent Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 Chatbot 和 Chat Mode Agent 拆分为 Dashboard 下的两个独立子页面，保留原 Chatbot 功能并新增独立 Agent 对话工作区。

**Architecture:** 复用现有 Dashboard 主内容作为 `Chatbot` 子页，通过 Dashboard 父级导航下的 `Chatbot / Agent` 子导航切换。新增 Agent 页面只复用既有 `runChatAgent()`、`streamAssistantReply()` 和 Agent 数据工具，不复制 Report Mode 逻辑；Agent 使用独立的 DOM、历史记录和提交处理，避免与原 Chatbot 会话互相污染。

**Tech Stack:** Vanilla JavaScript SPA、`public/index.html`、`public/app.js`、`public/styles.css`、Node 静态结构测试。

## Global Constraints

- Dashboard 父级导航必须保留；原有 Dashboard 主内容、Report Mode、Deep Window、Chat Mode 行为不得回归。
- `Chatbot` 子页继续使用现有 `chatForm`、`chatLog`、Report/Chat 模式切换和 `applyPrompt()`。
- `Agent` 子页只调用已有 `runChatAgent()`，不新增后端接口、不复制工具实现、不改变 Agent 数据契约。
- Agent 子页维护独立的 `agentPage.history` 和 `agentChatLog`，切换页面不清空已有对话。
- 页面文案同时支持简体中文和英文；不提交、不推送、不创建 Pull Request。
- 保留工作区中已有的 Agent、文档和 `protected_data` 用户改动。

---

### Task 1: Add a failing dashboard subpage contract test

**Files:**
- Create: `scripts/test_dashboard_chat_pages.mjs`

**Interfaces:**
- Consumes: `public/index.html`, `public/app.js`, `public/styles.css` as source contracts.
- Produces: static assertions for Dashboard parent navigation, Chatbot child, Agent child, Agent page DOM, page routing, and responsive styles.

- [ ] **Step 1: Write the failing test**

Create a Node test that asserts the new contract:

```js
const html = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const styles = fs.readFileSync("public/styles.css", "utf8");

assert(html.includes('id="dashboardSubnav"'), "Dashboard must expose a child navigation");
assert(html.includes('id="chatbotNav"'), "Chatbot child navigation is missing");
assert(html.includes('id="agentNav"'), "Agent child navigation is missing");
assert(html.includes('id="dashboardAgentPage"'), "Agent page shell is missing");
assert(html.includes('id="agentChatForm"'), "Agent page form is missing");
assert(app.includes('switchPage("agent")'), "Agent navigation must route to the Agent page");
assert(app.includes('state.page === "agent"'), "Agent page state must be handled");
assert(styles.includes(".dashboard-agent-page"), "Agent page styles are missing");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/test_dashboard_chat_pages.mjs`

Expected: FAIL because the current Dashboard has no `dashboardSubnav`, `agentNav`, or `dashboardAgentPage`.

---

### Task 2: Turn Dashboard into a parent navigation and add page routing

**Files:**
- Modify: `public/index.html:102-108, before payments-page section`
- Modify: `public/app.js:state/els block, 24550-24735, init navigation bindings`
- Test: `scripts/test_dashboard_chat_pages.mjs`

**Interfaces:**
- Consumes: existing `state.page`, `switchPage()`, `reportsOpen`, and `updateReportsNavState()` patterns.
- Produces: `state.dashboardOpen`, `els.dashboardSubnav`, `els.chatbotNav`, `els.agentNav`, `els.dashboardAgentPage`, `pageBelongsToDashboard()`, and `updateDashboardNavState()`.

- [ ] **Step 1: Add Dashboard child navigation markup**

Replace the standalone Dashboard button with a `nav-group` containing `dashboardNav`, `dashboardSubnav`, `chatbotNav`, and `agentNav`. `chatbotNav` is active for the existing `dashboard` route; `agentNav` routes to `agent`.

- [ ] **Step 2: Add route state and page visibility handling**

Add `dashboardOpen: true` to `state`, cache the new DOM elements in `els`, and update routing with:

```js
function pageBelongsToDashboard(page) {
  return page === "dashboard" || page === "agent";
}

function updateDashboardNavState() {
  if (els.dashboardNav) els.dashboardNav.setAttribute("aria-expanded", state.dashboardOpen ? "true" : "false");
  if (els.dashboardSubnav) els.dashboardSubnav.classList.toggle("collapsed", !state.dashboardOpen);
}
```

`switchPage("dashboard")` must keep the existing Chatbot content visible; `switchPage("agent")` hides `.dashboard-page` and shows `#dashboardAgentPage`. The Dashboard parent remains active for both child routes.

- [ ] **Step 3: Wire navigation events and mobile labels**

Dashboard parent click toggles only its subnav; Chatbot calls `switchPage("dashboard")`; Agent calls `switchPage("agent")`. Add localized mobile labels for `dashboard` → Chatbot and `agent` → Agent.

- [ ] **Step 4: Run the contract and syntax checks**

Run: `node scripts/test_dashboard_chat_pages.mjs` and `node --check public/app.js`.

Expected: the new static contract passes and JavaScript syntax is valid.

---

### Task 3: Add the independent Agent page and isolated conversation state

**Files:**
- Modify: `public/index.html` near the existing Dashboard main grid
- Modify: `public/app.js` near state, `els`, `switchPage()`, and `init()`
- Test: `scripts/test_dashboard_chat_pages.mjs`

**Interfaces:**
- Consumes: `runChatAgent(prompt, opts)`, `streamAssistantReply(request, opts)`, `responseLanguageFor()`, and existing `agentStep` rendering.
- Produces: `state.agentPage`, `handleAgentPageSubmit()`, `resetAgentPageConversation()`, and independent `#agentChatLog` output.

- [ ] **Step 1: Add the Agent page DOM**

Insert `#dashboardAgentPage` with a page header, independent `#agentChatLog`, `#agentChatForm`, `#agentChatInput`, and `#agentNewConversation`. The welcome copy must explain that Agent directly handles merchant/category/tier/payment/trend questions.

- [ ] **Step 2: Add independent Agent state**

Add:

```js
agentPage: {
  history: [],
  submitting: false
}
```

Do not reuse `state.chatHistory` or `state.chatLogChat`; those belong to the original Chatbot page.

- [ ] **Step 3: Implement Agent page submission**

`handleAgentPageSubmit(event)` must prevent empty or concurrent submits, append the user message, call `runChatAgent(prompt, { language, chatLogEl: els.agentChatLog, history: state.agentPage.history.slice(0, -1), memoryText: "", viewContext: null })`, append direct/fallback output when needed, and store the assistant response in `state.agentPage.history`.

- [ ] **Step 4: Add reset behavior and bindings**

`resetAgentPageConversation()` clears only `state.agentPage.history` and `#agentChatLog`, then restores the Agent welcome card. Bind `agentChatForm` submit and `agentNewConversation` click in `init()`.

- [ ] **Step 5: Run the Agent and page tests**

Run: `node scripts/test_dashboard_chat_pages.mjs` and `node scripts/test_chat_agent.mjs`.

Expected: both page structure and existing Agent behavior pass.

---

### Task 4: Style the page hierarchy and verify responsive behavior

**Files:**
- Modify: `public/styles.css` near navigation styles and Dashboard-specific styles
- Modify: `public/app.js` bilingual translation maps and mobile/page labels
- Modify: `docs/chatbot-feature-report.md` and `docs/chat-mode-analysis-types.md`
- Test: `scripts/test_dashboard_chat_pages.mjs`

**Interfaces:**
- Consumes: existing `.nav-group`, `.nav-subnav`, `.chat-panel`, `body.dashboard-mode`, and light/dark theme selectors.
- Produces: responsive `.dashboard-agent-page`, `.agent-page-layout`, `.agent-page-rail`, and `.agent-page-chat-panel` styles with bilingual UI labels.

- [ ] **Step 1: Add layout styles**

Use the existing navigation spacing and chat-panel tokens. The Agent page should use a two-column desktop layout (context rail + conversation panel), collapse to one column under the existing 1000px breakpoint, and keep the composer reachable on mobile.

- [ ] **Step 2: Add bilingual copy and update documentation**

Add `nav.chatbot`, `nav.agent`, and `agent.*` translations. Document Dashboard → Chatbot and Dashboard → Agent, and state that Chatbot behavior is preserved while Agent has an isolated conversation history.

- [ ] **Step 3: Run final verification**

Run:

```text
node --check public/app.js
node scripts/test_dashboard_chat_pages.mjs
node scripts/test_chat_agent.mjs
node scripts/test_zh_chatbot.mjs
node scripts/test_chatbot_welcome.mjs
node scripts/test_report_mode_guide.mjs
git diff --check
```

Expected: all listed tests pass; `git diff --check` emits no errors; no commit or push is performed.
