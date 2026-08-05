# Chatbot 欢迎引导气泡（Welcome Guide Bubble）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将欢迎指南从左侧网格卡片改为聊天面板右下角悬浮气泡，新用户默认展开 + 强调态，老用户默认收起为圆钮，并持久化收起状态。

**Architecture:** `chatbot_welcome.js` 的挂载容器从 `.main-grid.dashboard-page` 改为 `#chatPanel`，渲染 `.welcome-float` 包裹层（展开卡片 `.welcome-panel` + 收起圆钮 `.welcome-float-dot`）；新老用户判定与收起持久化走 localStorage（`oi_onboarding_done` / `oi_welcome_collapsed`）；Tour 激活隐藏通过 MutationObserver 监听 body 中的 `.onboarding-mask-piece` / `.onboarding-popover` 实现。

**Tech Stack:** Vanilla JS IIFE（无框架）、Node vm 沙箱测试（`scripts/test_chatbot_welcome.mjs`）、Node `--check`、Python `server.py` + headless Chrome 本地验证。

## Global Constraints

- 所有中文注释与交流（AGENTS.md 语言要求）。
- `public/app.js` 零改动（仅 `chatbot_welcome.js` / `styles.css` / `index.html` / 测试 / 文档）。
- `WELCOME_COPY` 的 zh/en 键必须一一对应；新增键 `newBadge` / `collapse` / `showGuide`。
- localStorage 键：`oi_onboarding_done`（沿用）、`oi_welcome_collapsed`（新增，值 `"1"` 表示收起）。
- 动效尊重 `prefers-reduced-motion`；深浅双主题都需覆盖。
- CI 命令：`node --check public/chatbot_welcome.js`、`node scripts/test_chatbot_welcome.mjs`、`node scripts/test_onboarding_tour.mjs` 必须 PASS。
- 所有 git commit 均需用户显式授权（AGENTS.md）；执行前向用户确认一次，确认后按各任务提交步骤执行。提交信息使用双语格式。
- 完成后必须关闭本地服务器（AGENTS.md）。

---

### Task 1: 重写欢迎气泡测试（scripts/test_chatbot_welcome.mjs）

**Files:**
- Modify: `scripts/test_chatbot_welcome.mjs`（整文件替换）

**Interfaces:**
- Produces: 测试依赖的 `window.CHATBOT_WELCOME._test` 新 API：
  - `defaultCollapsed()` → boolean（新用户/老用户默认收起判定）
  - `tourDone()` → boolean
  - `isCollapsed()` → boolean（当前 `_collapsed`）
  - `tourHidden()` → boolean（当前 `_tourHidden`）
  - `setCollapsed(collapsed, persist)` → void
  - `resetCollapsed()` → void
  - `resetAutoCollapse()` → void
  - `refreshTourHidden()` → void
  - `wrapElement()` → 当前 `.welcome-float` 元素（测试断言 classList）
  - `panelElement()` → 当前 `.welcome-panel` 元素（测试断言强调态 class）

- [ ] **Step 1: 整文件替换为以下内容（包含旧用例更新 + 新用例 24-29）**

````js
import fs from "node:fs";
import vm from "node:vm";

function runScript(file, sandbox) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}
function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function assertTruthy(value, label) {
  if (!value) throw new Error(`${label}: expected a truthy value, got ${JSON.stringify(value)}`);
}
function assertMatch(actual, pattern, label) {
  if (!pattern.test(actual)) throw new Error(`${label}: expected ${JSON.stringify(actual)} to match ${pattern}`);
}

const elementStub = {
  nodeType: 1,
  addEventListener() {}, dataset: {},
  appendChild() {}, removeChild() {}, insertBefore() {},
  querySelectorAll() { return []; }, querySelector() { return null; },
  setAttribute() {}, removeAttribute() {}, style: {}, innerHTML: "", value: "",
  getBoundingClientRect() { return { left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 }; }
};

// 可写 localStorage stub
const store = {};
const localStorageStub = {
  getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
  setItem(key, value) { store[key] = String(value); },
  removeItem(key) { delete store[key]; }
};

// 真实 classList stub（className 同步维护，供 collapsed/tour-hidden 断言）
function makeElement(className) {
  const el = { ...elementStub, className: className || "", children: [], parentNode: null };
  const set = new Set();
  el.classList = {
    add(cls) { set.add(cls); el.className = [...set].join(" "); },
    remove(cls) { set.delete(cls); el.className = [...set].join(" "); },
    toggle(cls, force) {
      const on = force === undefined ? !set.has(cls) : !!force;
      if (on) set.add(cls); else set.delete(cls);
      el.className = [...set].join(" ");
      return on;
    },
    contains(cls) { return set.has(cls); }
  };
  return el;
}

// #chatPanel 容器 stub（欢迎气泡挂载点）
function makeChatPanel() {
  let wrapper = null;
  const panelProbe = makeElement("welcome-panel");
  const chatPanel = {
    ...elementStub,
    querySelector(sel) {
      if (sel === ".welcome-float") return wrapper;
      if (sel === ".welcome-panel") return wrapper ? panelProbe : null;
      if (sel === ".welcome-float-dot") return wrapper ? makeElement("welcome-float-dot") : null;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === ".welcome-float") return wrapper ? [wrapper] : [];
      if (sel === ".welcome-panel") return wrapper ? [panelProbe] : [];
      return [];
    },
    appendChild(child) { wrapper = child; child.parentNode = chatPanel; return null; },
    insertBefore(child) { wrapper = child; child.parentNode = chatPanel; return null; },
    removeChild(child) { if (child === wrapper) wrapper = null; return null; },
    _welcomePresent() { return !!wrapper; }
  };
  return chatPanel;
}
const chatPanel = makeChatPanel();
const byIdMap = { chatPanel };

// 可控制 Chat Mode 提醒卡片存在性的 #chatLogChat stub
function makeChatLogChat() {
  let hasReminder = false;
  let reminderCard = null;
  const log = {
    ...elementStub,
    firstChild: null,
    querySelector(sel) { return sel === ".chat-reminder" ? (reminderCard || null) : null; },
    querySelectorAll(sel) {
      return sel === ".chat-reminder" ? (reminderCard ? [reminderCard] : []) : [];
    },
    insertBefore(card) { card.parentNode = log; reminderCard = card; hasReminder = true; return null; },
    removeChild(child) { if (child === reminderCard) { reminderCard = null; hasReminder = false; } return null; },
    _reminderPresent() { return hasReminder; }
  };
  return log;
}
const chatLogChat = makeChatLogChat();
byIdMap["chatLogChat"] = chatLogChat;

let tourMaskEls = [];
let observerCallbacks = [];

const sandbox = {
  console, Date, Math, Number, String, RegExp, Array, Object, Set, Map, JSON,
  setTimeout, clearTimeout,
  window: { __OFFER_INTELLIGENCE_TEST__: true },
  localStorage: localStorageStub,
  document: {
    getElementById(id) { return byIdMap[id] || null; },
    querySelector() { return null; },
    querySelectorAll(sel) {
      if (sel === ".onboarding-mask-piece, .onboarding-popover") return tourMaskEls;
      return [];
    },
    createElement() { return makeElement(""); },
    body: { appendChild() {}, removeChild() {} },
    documentElement: { lang: "zh-Hans" },
    readyState: "complete",
    addEventListener() {}, removeEventListener() {}
  },
  MutationObserver: class { constructor(cb) { observerCallbacks.push(cb); } observe() {} disconnect() {} }
};
sandbox.window.document = sandbox.document;

// 流程引导测试：.deep-window.minimized 查询映射 + 事件派发记录 + CustomEvent
let minimizedPanels = [];
let dispatchedEvents = [];
const documentWithFlow = {
  ...sandbox.document,
  querySelectorAll(sel) {
    if (sel === ".deep-window.minimized") return minimizedPanels;
    return sandbox.document.querySelectorAll(sel);
  },
  dispatchEvent(evt) { dispatchedEvents.push(evt && evt.type); return true; }
};
sandbox.document = documentWithFlow;
sandbox.window.document = documentWithFlow;
sandbox.CustomEvent = class { constructor(type) { this.type = type; } };

runScript("public/chatbot_welcome.js", sandbox);
const welcome = sandbox.window.CHATBOT_WELCOME;
assertTruthy(welcome, "chatbot_welcome should expose window.CHATBOT_WELCOME");
const t = welcome._test;

// ── 用例 1：示例数据结构（Report Mode 直接输入：商户名/品类名/Tier + 趋势分析）──
assertEqual(t.examples.report.length, 4, "report examples should be 4");
assertEqual(t.examples.chat.length, 3, "chat examples should be 3");
assertEqual(t.examples.report[0].text, "{merchant}", "first report example should be direct merchant name input");
assertEqual(t.examples.report[0].dynamic, "merchant", "first report example should be dynamic");
assertEqual(t.examples.report[1].text, "Beauty 品类", "second report example should be direct category input");
assertEqual(t.examples.report[2].text, "Tier 2", "third report example should be direct tier input");
assertEqual(t.examples.report[3].text, "{merchant}趋势分析", "fourth report example should be direct trend analysis");
assertEqual(t.examples.report[3].dynamic, "merchant", "trend example should use the dynamic merchant");
for (const ex of [...t.examples.report, ...t.examples.chat]) {
  assertTruthy(ex.text, "example text must be non-empty");
}
assertEqual(t.examples.chat[0].text, "根据记忆栏的报告，给我分析建议", "first chat example should reference memory bar");
assertEqual(t.examples.chat[0].dynamic, undefined, "chat examples must NOT be dynamic");

// ── 用例 2：文案键集 zh/en 一致（新增气泡键）──
const zhKeys = Object.keys(t.copy.zh).sort();
const enKeys = Object.keys(t.copy.en).sort();
assertEqual(enKeys.join("|"), zhKeys.join("|"), "zh/en copy keys must match exactly");
assertEqual(zhKeys.includes("barTitle"), false, "bar keys removed (no collapsed bar)");
assertEqual(zhKeys.includes("collapse"), true, "collapse key added for bubble collapse button");
assertEqual(zhKeys.includes("newBadge"), true, "newBadge key added for new-user emphasis");
assertEqual(zhKeys.includes("showGuide"), true, "showGuide key added for collapsed dot label");

// ── 用例 3：动态商户名 ──
assertEqual(t.merchantForExample(null), null, "no offers -> null");
assertEqual(t.merchantForExample([]), null, "empty offers -> null");
assertEqual(
  t.merchantForExample([
    { merchantName: "Low", commission: 1 },
    { merchantName: "TopBrand", commission: 99 },
    { merchantName: "Mid", commission: 50 }
  ]),
  "TopBrand",
  "should pick the highest-commission merchant"
);
assertEqual(
  t.merchantForExample([{ commission: 5 }, { merchantName: "OnlyName" }]),
  "OnlyName",
  "should fall back to any merchant with a name"
);
assertEqual(
  t.merchantForExample([
    { merchantName: "TopBrand", commission: 99, knownKeyword: true },
    { merchantName: "OnlyName", commission: 50 }
  ]),
  "OnlyName",
  "should skip known-keyword merchants and pick the top non-keyword merchant"
);
assertEqual(
  t.merchantForExample([
    { merchantName: "TopBrand", commission: 99, knownKeyword: true },
    { merchantName: "OnlyName", commission: 50, knownKeyword: true }
  ]),
  null,
  "all known-keyword merchants -> null (welcome falls back to fixed Shokz example)"
);

// ── 用例 4：语言读取 ──
assertEqual(t.currentLanguage(), "zh", "html lang zh-Hans -> zh");

// ── 用例 5：渲染判定（气泡挂 #chatPanel）──
assertEqual(t.shouldRenderFor("report"), true, "empty chat panel -> should render");
assertEqual(t.shouldRenderFor("chat"), true, "mode is ignored — same persistent bubble");
t.renderPanel("report", { offers: [], hasMemory: false });
assertEqual(t.shouldRenderFor("report"), false, "bubble already rendered -> no re-render");
assertTruthy(welcome.isRendered("report"), "bubble should be present after render");

// ── 用例 6：示例交互决策 ──
assertEqual(t.tipStateFor("report", false), "tipReport", "report example always shows report tip");
assertEqual(t.tipStateFor("chat", false), "chatEmptyMemory", "chat example without memory -> empty-memory tip");
assertEqual(t.tipStateFor("chat", true), null, "chat example with memory -> no tip");
assertEqual(t.fillAllowedFor("report", false), true, "report example always fills");
assertEqual(t.fillAllowedFor("chat", false), false, "chat example without memory -> blocked");
assertEqual(t.fillAllowedFor("chat", true), true, "chat example with memory -> fills");

// ── 用例 7：手动输入清除提示 ──
assertEqual(t.shouldClearTipOnInput("abc", "abc"), false, "unchanged value -> keep tip");
assertEqual(t.shouldClearTipOnInput("abcX", "abc"), true, "user edited value -> clear tip");
assertEqual(t.shouldClearTipOnInput("", "abc"), true, "cleared value -> clear tip");

// ── 用例 8：渲染 smoke（stub DOM 下不抛异常）──
byIdMap["chatInput"] = elementStub;
byIdMap["chatForm"] = { ...elementStub, parentNode: { insertBefore() {} } };
t.renderSmoke();
assertEqual(t.tipActive(), false, "no tip after plain render");
t.showTipbar("tipReport");
assertEqual(t.tipActive(), true, "showTipbar should set tip state");
t.clearTipbar();
assertEqual(t.tipActive(), false, "clearTipbar should clear tip state");

// ── 用例 9：notify("report-ready") 一次性 ──
assertEqual(t.panelTipActive(), true, "panel tip should be available initially");
welcome.notify("report-ready", { panelEl: elementStub });
assertEqual(t.panelTipActive(), false, "panel tip should be consumed after first report");
welcome.notify("report-ready", { panelEl: elementStub });
assertEqual(t.panelTipActive(), false, "panel tip must NOT re-appear on second report");

// ── 用例 10：notify("memory-added") ──
assertEqual(t.hasMemory(), false, "hasMemory starts false");
welcome.notify("memory-added", { hasMemory: true });
assertEqual(t.hasMemory(), true, "memory-added should set hasMemory true");

// ── 用例 11：notify("mode-switched") 只同步状态，不重渲染、不切换气泡 ──
welcome.notify("mode-switched", { mode: "chat", hasMemory: false });
assertEqual(t.lastMode(), "chat", "mode-switched chat should record mode");
assertTruthy(welcome.isRendered("chat"), "bubble stays rendered across mode switch (no re-render swap)");
welcome.notify("mode-switched", { mode: "report", hasMemory: false });
assertEqual(t.lastMode(), "report", "mode-switched report should record mode");
assertTruthy(welcome.isRendered("report"), "bubble still present after switching back");

// ── 用例 12：notify("chat-sent") 首次发送自动收起 ──
t.showTipbar("tipReport");
assertEqual(t.tipActive(), true, "tip shown before send");
welcome.notify("chat-sent");
assertEqual(t.tipActive(), false, "chat-sent should clear tipbar");
assertTruthy(welcome.isRendered("report"), "chat-sent keeps the bubble mounted");
assertTruthy(t.isCollapsed(), "first chat-sent auto-collapses the bubble");
const wrapAfterSend = chatPanel.querySelector(".welcome-float");
assertTruthy(wrapAfterSend && wrapAfterSend.classList.contains("collapsed"), "wrapper should carry collapsed class");
assertEqual(store["oi_welcome_collapsed"], "1", "first chat-sent persists collapse");

// ── 用例 13：语言切换重渲染保持当前态 ──
function fireLangObserver() { if (observerCallbacks[0]) observerCallbacks[0](); }
assertTruthy(observerCallbacks.length >= 1, "lang observer should have registered during render");
welcome.notify("mode-switched", { mode: "report", hasMemory: false });
assertEqual(t.lastMode(), "report", "mode-switched report should set mode before lang observer fires");
fireLangObserver();
assertEqual(t.lastMode(), "report", "lang observer should re-render the bubble, keeping _mode");
assertTruthy(welcome.isRendered("report"), "bubble remains after language re-render");

// ── 用例 14：拦截路径提示条也随手动输入消失（M2 修复）──
t.handleChipClick("chat", "根据记忆栏的报告，给我分析建议"); // 无记忆 → 拦截
assertEqual(t.tipActive(), true, "blocked chat example should show empty-memory tipbar");
assertEqual(t.tipFromExampleActive(), true, "blocked chat example should set tipFromExample so typing clears the tipbar");

// ── 用例 15：点击监听绑定在每次新建的 panel 上，不累积在 #chatPanel 容器 ──
let containerListenerCalls = 0;
chatPanel.addEventListener = () => { containerListenerCalls++; };
t.renderSmoke();
t.renderSmoke();
assertEqual(containerListenerCalls, 0, "click listeners must bind to per-render elements, not the chat panel container");

// ── 用例 16：Chat Mode 聊天区顶部提醒卡片（常驻 sticky，提示先注入记忆栏）──
assertEqual(t.chatReminderActive(), false, "no reminder before entering Chat Mode");
welcome.notify("mode-switched", { mode: "chat", hasMemory: false });
assertEqual(t.chatReminderActive(), true, "Chat Mode should render the reminder card");
assertEqual(chatLogChat._reminderPresent(), true, "reminder card should live inside #chatLogChat");
welcome.notify("mode-switched", { mode: "report", hasMemory: false });
assertEqual(t.chatReminderActive(), false, "Report Mode should remove the reminder card");
welcome.notify("mode-switched", { mode: "chat", hasMemory: false });
assertEqual(t.chatReminderActive(), true, "re-entering Chat Mode should re-render the reminder card");
fireLangObserver();
assertEqual(t.chatReminderActive(), true, "lang switch keeps the reminder card in Chat Mode");

// ── 用例 17：流程状态机 flowStage（8 种布尔组合）──
assertEqual(t.flowStage({ hasReport: false, hasMemory: false, isChat: false }), "noReport", "all false -> noReport");
assertEqual(t.flowStage({ hasReport: true, hasMemory: false, isChat: false }), "reportReady", "report only -> reportReady");
assertEqual(t.flowStage({ hasReport: false, hasMemory: true, isChat: false }), "memoryReady", "memory only -> memoryReady");
assertEqual(t.flowStage({ hasReport: true, hasMemory: true, isChat: false }), "memoryReady", "report+memory -> memoryReady");
assertEqual(t.flowStage({ hasReport: false, hasMemory: false, isChat: true }), "noReport", "chat only -> noReport");
assertEqual(t.flowStage({ hasReport: true, hasMemory: false, isChat: true }), "reportReady", "chat+report -> reportReady");
assertEqual(t.flowStage({ hasReport: false, hasMemory: true, isChat: true }), "chatActive", "chat+memory -> chatActive");
assertEqual(t.flowStage({ hasReport: true, hasMemory: true, isChat: true }), "chatActive", "all true -> chatActive");
assertEqual(t.flowStage({ hasReport: true, hasPill: true, hasMemory: false, isChat: false }), "reportReady", "hasPill alone does not change stage");

// ── 用例 18：新增文案键存在（zh/en 键集一致性由用例 2 兜底）──
for (const key of ["progressStep1", "progressStep2", "progressStep3", "progressAdvanced", "minimizedTip", "goReport", "newBadge", "collapse", "showGuide"]) {
  assertTruthy(t.copy.zh[key], `zh missing ${key}`);
  assertTruthy(t.copy.en[key], `en missing ${key}`);
}

// ── 用例 19：进度条渲染（progressHtml 纯函数）──
assertMatch(t.progressHtml({ hasReport: false, hasMemory: false, isChat: false }), /data-stage="noReport"/, "noReport progress stage");
assertMatch(t.progressHtml({ hasReport: true, hasMemory: false, isChat: false }), /data-stage="reportReady"/, "reportReady progress stage");
assertMatch(t.progressHtml({ hasReport: true, hasMemory: true, isChat: false }), /data-stage="memoryReady"/, "memoryReady progress stage");
assertMatch(t.progressHtml({ hasReport: true, hasMemory: true, isChat: true }), /data-stage="chatActive"/, "chatActive progress stage");
assertMatch(t.progressHtml({ hasReport: true, hasMemory: true, isChat: true }), /welcome-progress-step done/, "chatActive renders done steps");

// ── 用例 20：notify 状态事件 ──
welcome.notify("panel-minimized", {});
assertEqual(t.flowState().hasPill, true, "panel-minimized sets hasPill");
minimizedPanels = [];
welcome.notify("panel-expanded", {});
assertEqual(t.flowState().hasPill, false, "panel-expanded recomputes hasPill false when no minimized panels");
minimizedPanels = [{ className: "deep-window minimized" }];
welcome.notify("panel-expanded", {});
assertEqual(t.flowState().hasPill, true, "panel-expanded recomputes hasPill true when a minimized panel exists");
minimizedPanels = [];

// ── 用例 21：notify("chat-add") ──
welcome.notify("chat-add", { hasMemory: true });
assertEqual(t.flowState().hasReport, true, "chat-add sets hasReport");
assertEqual(t.flowState().hasMemory, true, "chat-add sets hasMemory");

// ── 用例 22：提醒卡片包含「去生成报告」按钮，点击 dispatch chatbot-go-report 并填入示例 ──
welcome.notify("mode-switched", { mode: "chat", hasMemory: false });
assertMatch(t.chatReminderHtml(), /chat-reminder-action/, "reminder card should include go-report action");
byIdMap["chatInput"] = { ...elementStub, value: "" };
dispatchedEvents = [];
t.triggerGoReport();
assertEqual(dispatchedEvents.includes("chatbot-go-report"), true, "goReport should dispatch chatbot-go-report");
assertEqual(byIdMap["chatInput"].value, "Shokz", "goReport should fill the first report example (fallback Shokz)");

// ── 用例 23：fillInput 公共 API ──
assertEqual(welcome.fillInput("Tier 2"), true, "fillInput should return true when input exists");
assertEqual(byIdMap["chatInput"].value, "Tier 2", "fillInput should set input value");

// ── 用例 24：新老用户默认收起判定（纯函数）──
delete store["oi_onboarding_done"];
delete store["oi_welcome_collapsed"];
assertEqual(t.defaultCollapsed(), false, "fresh user -> expanded by default");
store["oi_onboarding_done"] = "1";
assertEqual(t.defaultCollapsed(), true, "onboarding done -> collapsed by default");
delete store["oi_onboarding_done"];
assertEqual(t.defaultCollapsed(), false, "fresh user again -> expanded");
store["oi_welcome_collapsed"] = "1";
assertEqual(t.defaultCollapsed(), true, "explicit collapse wins even when onboarding not done");
store["oi_onboarding_done"] = "1";
assertEqual(t.defaultCollapsed(), true, "both markers -> collapsed");

// ── 用例 25：渲染默认态（新用户展开 + 强调 / 老用户收起）──
delete store["oi_onboarding_done"];
delete store["oi_welcome_collapsed"];
t.resetCollapsed();
t.renderPanel("report", { offers: [], hasMemory: false });
let wrap = chatPanel.querySelector(".welcome-float");
assertTruthy(wrap, "bubble wrapper should render");
assertEqual(wrap.classList.contains("collapsed"), false, "new user renders expanded");
assertMatch(t.panelElement().className, /welcome-emphasis/, "new user panel carries emphasis class");

store["oi_onboarding_done"] = "1";
t.resetCollapsed();
t.renderPanel("report", { offers: [], hasMemory: false });
wrap = chatPanel.querySelector(".welcome-float");
assertEqual(wrap.classList.contains("collapsed"), true, "returning user renders collapsed");
assertEqual(t.panelElement().className.includes("welcome-emphasis"), false, "returning user panel has no emphasis");

// ── 用例 26：收起/展开 + 持久化 ──
delete store["oi_onboarding_done"];
delete store["oi_welcome_collapsed"];
t.resetCollapsed();
t.renderPanel("report", { offers: [], hasMemory: false });
t.setCollapsed(true, true);
wrap = chatPanel.querySelector(".welcome-float");
assertEqual(wrap.classList.contains("collapsed"), true, "setCollapsed(true) collapses wrapper");
assertEqual(store["oi_welcome_collapsed"], "1", "collapse with persist writes storage");
t.setCollapsed(false, false);
wrap = chatPanel.querySelector(".welcome-float");
assertEqual(wrap.classList.contains("collapsed"), false, "setCollapsed(false) expands wrapper");
assertEqual(store["oi_welcome_collapsed"], "1", "manual expand does NOT clear persisted collapse");
assertMatch(t.panelElement().className, /welcome-emphasis/, "re-expanded fresh-user panel gets emphasis back");

// ── 用例 27：chat-sent 自动收起只发生一次 ──
t.resetAutoCollapse();
delete store["oi_onboarding_done"];
delete store["oi_welcome_collapsed"];
t.resetCollapsed();
t.renderPanel("report", { offers: [], hasMemory: false });
welcome.notify("chat-sent");
assertTruthy(t.isCollapsed(), "first chat-sent collapses");
t.setCollapsed(false, false);
welcome.notify("chat-sent");
assertEqual(t.isCollapsed(), false, "second chat-sent does NOT re-collapse (first send only)");

// ── 用例 28：chat-add 自动收起只发生一次 ──
t.resetAutoCollapse();
delete store["oi_onboarding_done"];
delete store["oi_welcome_collapsed"];
t.resetCollapsed();
t.renderPanel("report", { offers: [], hasMemory: false });
welcome.notify("chat-add", { hasMemory: true });
assertTruthy(t.isCollapsed(), "first chat-add collapses");
t.setCollapsed(false, false);
welcome.notify("chat-add", { hasMemory: true });
assertEqual(t.isCollapsed(), false, "second chat-add does NOT re-collapse");

// ── 用例 29：Tour 激活时隐藏气泡 ──
delete store["oi_onboarding_done"];
delete store["oi_welcome_collapsed"];
t.resetCollapsed();
t.renderPanel("report", { offers: [], hasMemory: false });
assertEqual(t.tourHidden(), false, "tour not active initially");
tourMaskEls = [{ className: "onboarding-mask-piece" }];
t.refreshTourHidden();
assertEqual(t.tourHidden(), true, "tour active -> hidden state true");
wrap = chatPanel.querySelector(".welcome-float");
assertEqual(wrap.classList.contains("tour-hidden"), true, "wrapper carries tour-hidden class");
tourMaskEls = [];
t.refreshTourHidden();
assertEqual(t.tourHidden(), false, "tour ended -> hidden state false");
assertEqual(wrap.classList.contains("tour-hidden"), false, "wrapper removes tour-hidden class");

console.log("PASS: welcome logic");
````

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/test_chatbot_welcome.mjs`
Expected: FAIL（`t.defaultCollapsed is not a function` 或类似未实现 API 错误；Task 2 完成后转 PASS）

- [ ] **Step 3: Commit（需用户授权）**

```bash
git add scripts/test_chatbot_welcome.mjs
git commit -m "test(chatbot): Add welcome bubble state tests / 添加欢迎气泡状态测试"
```

---

### Task 2: 实现 `public/chatbot_welcome.js` 气泡挂载与状态

**Files:**
- Modify: `public/chatbot_welcome.js`

**Interfaces:**
- Consumes: Task 1 约定的 `_test` API（`defaultCollapsed` / `setCollapsed` / `resetCollapsed` / `resetAutoCollapse` / `refreshTourHidden` / `wrapElement` / `panelElement` / `tourDone` / `isCollapsed` / `tourHidden`）
- Produces: `window.CHATBOT_WELCOME`（现有 API 不变）+ 上述 `_test` 新导出

- [ ] **Step 1: 新增文案键（zh/en 各 3 个）**

在 zh 的 `chatReminder: "先将数据注入记忆栏，Chat才有数据可答",` 之后插入：

```js
      newBadge: "新手引导",
      collapse: "收起",
      showGuide: "查看使用引导",
```

在 en 的 `chatReminder: "Drag reports into memory first — Chat only answers with data in memory",` 之后插入：

```js
      newBadge: "First time?",
      collapse: "Collapse",
      showGuide: "Show guide",
```

- [ ] **Step 2: 新增持久化辅助函数**

在 `currentCopy(key)` 函数结束（`return (WELCOME_COPY[lang] && WELCOME_COPY[lang][key]) || WELCOME_COPY.zh[key] || key; }`）之后插入：

```js

  // ── 持久化与用户状态（新老用户判定 / 气泡收起）──
  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }
  function storageRemove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }
  function tourDone() { return !!storageGet("oi_onboarding_done"); }
  function collapsedPersisted() { return storageGet("oi_welcome_collapsed") === "1"; }
  function defaultCollapsed() { return collapsedPersisted() || tourDone(); }
```

- [ ] **Step 3: 新增状态变量**

在 `var _langObserver = null;` 之后插入：

```js
  var _collapsed = defaultCollapsed();
  var _tourHidden = false;
  var _wrapEl = null;
  var _panelEl = null;
  var _dotEl = null;
  var _bodyObserver = null;
  var _chatSentAutoCollapsed = false;
  var _chatAddAutoCollapsed = false;
```

- [ ] **Step 4: 替换 containerFor**

将：

```js
  // 独立卡片：挂在 dashboard 主网格（.main-grid.dashboard-page）左列顶部，
  // 作为 grid 第 1 行第 1 列子项，与聊天区（#chatLog/#chatLogChat）完全解耦。
  function containerFor() {
    return document.querySelector(".main-grid.dashboard-page");
  }
```

替换为：

```js
  // 悬浮气泡：挂在聊天面板 #chatPanel 内部右下角，随聊天面板隐藏而隐藏。
  function containerFor() {
    try { return document.getElementById("chatPanel"); } catch (e) { return null; }
  }
```

- [ ] **Step 5: 替换 headHtml**

将：

```js
  function headHtml() {
    return '<div class="welcome-head"><div class="welcome-avatar">🤖</div><div>' +
      '<div class="welcome-hello">' + escapeHtml(currentCopy("helloTitle")) + '</div>' +
      '<div class="welcome-desc">' + escapeHtml(currentCopy("helloBody")) + '</div></div></div>';
  }
```

替换为：

```js
  function headHtml(emphasis) {
    var badge = emphasis
      ? '<span class="welcome-new-badge">' + escapeHtml(currentCopy("newBadge")) + '</span>'
      : "";
    return '<div class="welcome-head"><div class="welcome-avatar">🤖</div>' +
      '<div class="welcome-head-main">' +
      '<div class="welcome-hello">' + escapeHtml(currentCopy("helloTitle")) + badge + '</div>' +
      '<div class="welcome-desc">' + escapeHtml(currentCopy("helloBody")) + '</div>' +
      '</div>' +
      '<button type="button" class="welcome-collapse-btn" aria-label="' + escapeHtml(currentCopy("collapse")) + '" title="' + escapeHtml(currentCopy("collapse")) + '">✕</button>' +
      '</div>';
  }
```

- [ ] **Step 6: 替换 _renderPanel 与 _clearWelcome，并新增气泡控制函数**

将：

```js
  // 渲染完整双栏工作台（常驻独立卡片）。挂载为 dashboard 主网格左列第一个 grid 子项，
  // 始终完整展开、不折叠；与聊天区内容解耦，对话不顶掉、不改变它。
  function _renderPanel(mode, opts) {
    opts = opts || {};
    var container = containerFor(mode);
    if (!container) return false;
    if (opts.offers) _offers = opts.offers;
    var merchant = exampleMerchant(opts.offers || _offers);
    var html = '<div class="welcome-panel">' + headHtml() + progressHtml(_flowState()) +
      '<div class="welcome-cols">' + colHtml("report", WELCOME_EXAMPLES.report, merchant) +
      colHtml("chat", WELCOME_EXAMPLES.chat, merchant) +
      "</div></div>";
    _clearWelcome(container);
    var panel = makeEl("welcome-panel", html);
    container.insertBefore(panel, container.firstChild);
    _mode = mode;
    if (opts.hasMemory !== undefined) _hasMemory = !!opts.hasMemory;
    _bindPanel(panel);
    _bindLangObserver();
    return true;
  }
  function _clearWelcome(container) {
    if (!container) return;
    var els = container.querySelectorAll(".welcome-panel");
    for (var i = 0; i < els.length; i++) els[i].parentNode.removeChild(els[i]);
  }
```

替换为：

```js
  // 渲染完整双栏工作台（悬浮气泡）。挂载为 #chatPanel 内部右下角绝对定位层，
  // 新用户默认展开 + 强调态；老用户/已收起默认折叠为圆钮；Tour 激活时隐藏。
  function _renderPanel(mode, opts) {
    opts = opts || {};
    var container = containerFor(mode);
    if (!container) return false;
    if (opts.offers) _offers = opts.offers;
    var merchant = exampleMerchant(opts.offers || _offers);
    var emphasis = !tourDone() && !_collapsed;
    var panelHtml = headHtml(emphasis) + progressHtml(_flowState()) +
      '<div class="welcome-cols">' + colHtml("report", WELCOME_EXAMPLES.report, merchant) +
      colHtml("chat", WELCOME_EXAMPLES.chat, merchant) +
      "</div>";
    _clearWelcome(container);
    var wrap = makeEl("welcome-float", "");
    if (_collapsed) wrap.classList.add("collapsed");
    if (_tourHidden) wrap.classList.add("tour-hidden");
    var panel = makeEl("welcome-panel", panelHtml);
    if (emphasis) panel.classList.add("welcome-emphasis");
    var dot = makeEl("welcome-float-dot", "🤖");
    dot.setAttribute("aria-label", currentCopy("showGuide"));
    dot.setAttribute("aria-expanded", String(!_collapsed));
    wrap.appendChild(panel);
    wrap.appendChild(dot);
    _wrapEl = wrap;
    _panelEl = panel;
    _dotEl = dot;
    container.appendChild(wrap);
    _mode = mode;
    if (opts.hasMemory !== undefined) _hasMemory = !!opts.hasMemory;
    _bindPanel(panel);
    _bindBubbleControls(panel, dot);
    _bindLangObserver();
    _bindTourObserver();
    _applyTourHidden();
    return true;
  }
  function _clearWelcome(container) {
    if (!container) return;
    var els = container.querySelectorAll(".welcome-float");
    for (var i = 0; i < els.length; i++) els[i].parentNode.removeChild(els[i]);
    _wrapEl = null;
    _panelEl = null;
    _dotEl = null;
  }
  // 收起/展开：persist=true 写入 oi_welcome_collapsed（手动收起/自动收起），
  // persist=false 只改当前会话（手动展开不覆盖持久化，刷新仍按默认规则）。
  function setCollapsed(collapsed, persist) {
    _collapsed = !!collapsed;
    if (_wrapEl) _wrapEl.classList.toggle("collapsed", _collapsed);
    if (_dotEl) _dotEl.setAttribute("aria-expanded", String(!_collapsed));
    if (_panelEl) _panelEl.classList.toggle("welcome-emphasis", !tourDone() && !_collapsed);
    if (persist) {
      if (_collapsed) storageSet("oi_welcome_collapsed", "1");
      else storageRemove("oi_welcome_collapsed");
    }
  }
  function _bindBubbleControls(panel, dot) {
    try {
      if (panel) {
        var closeBtn = panel.querySelector(".welcome-collapse-btn");
        if (closeBtn) closeBtn.addEventListener("click", function () { setCollapsed(true, true); });
      }
    } catch (e) {}
    try {
      if (dot) dot.addEventListener("click", function () { setCollapsed(false, false); });
    } catch (e) {}
  }
  function _tourElementsPresent() {
    try {
      return document.querySelectorAll(".onboarding-mask-piece, .onboarding-popover").length > 0;
    } catch (e) { return false; }
  }
  function _applyTourHidden() {
    _tourHidden = _tourElementsPresent();
    if (_wrapEl) _wrapEl.classList.toggle("tour-hidden", _tourHidden);
  }
  function _bindTourObserver() {
    if (_bodyObserver) return;
    try {
      _bodyObserver = new MutationObserver(function () { _applyTourHidden(); });
      _bodyObserver.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  }
```

- [ ] **Step 7: 替换 notify 的 chat-sent 分支**

将：

```js
    if (eventName === "chat-sent") {
      // 面板常驻完整展开：发送消息只清提示条/脉冲，不折叠、不删除
      _clearTipbar();
      _tipFromExample = false;
      _pulseSend(false);
      return;
    }
```

替换为：

```js
    if (eventName === "chat-sent") {
      // 气泡：发送消息清提示条/脉冲；首次发送自动收起并持久化
      _clearTipbar();
      _tipFromExample = false;
      _pulseSend(false);
      if (!_chatSentAutoCollapsed) {
        _chatSentAutoCollapsed = true;
        setCollapsed(true, true);
      }
      return;
    }
```

- [ ] **Step 8: 替换 notify 的 chat-add 分支**

将：

```js
    if (eventName === "chat-add") {
      _hasReport = true;
      if (payload.hasMemory !== undefined) _hasMemory = !!payload.hasMemory;
      _refreshProgress();
      _clearTipbar();
      _pulseSend(false);
      return;
    }
```

替换为：

```js
    if (eventName === "chat-add") {
      _hasReport = true;
      if (payload.hasMemory !== undefined) _hasMemory = !!payload.hasMemory;
      _refreshProgress();
      _clearTipbar();
      _pulseSend(false);
      if (!_chatAddAutoCollapsed) {
        _chatAddAutoCollapsed = true;
        setCollapsed(true, true);
      }
      return;
    }
```

- [ ] **Step 9: 扩展 _test 导出**

在 `containerFor: containerFor,` 之后插入：

```js
      defaultCollapsed: defaultCollapsed,
      tourDone: tourDone,
      isCollapsed: function () { return _collapsed; },
      tourHidden: function () { return _tourHidden; },
      setCollapsed: setCollapsed,
      resetCollapsed: function () { _collapsed = defaultCollapsed(); },
      resetAutoCollapse: function () { _chatSentAutoCollapsed = false; _chatAddAutoCollapsed = false; },
      refreshTourHidden: _applyTourHidden,
      wrapElement: function () { return _wrapEl; },
      panelElement: function () { return _panelEl; },
```

- [ ] **Step 10: 语法检查**

Run: `node --check public/chatbot_welcome.js`
Expected: 无输出，退出码 0

- [ ] **Step 11: 运行欢迎气泡测试**

Run: `node scripts/test_chatbot_welcome.mjs`
Expected: `PASS: welcome logic`（Task 1 用例 1-29 全部通过）

- [ ] **Step 12: 运行引导回归测试**

Run: `node scripts/test_onboarding_tour.mjs`
Expected: `PASS: onboarding tour logic`（不受影响）

- [ ] **Step 13: Commit（需用户授权）**

```bash
git add public/chatbot_welcome.js scripts/test_chatbot_welcome.mjs
git commit -m "feat(chatbot): Move welcome guide into chat-panel bubble / 欢迎指南改为聊天面板悬浮气泡"
```

---

### Task 3: 样式与网格调整（styles.css）

**Files:**
- Modify: `public/styles.css`（主网格、窄屏复位、欢迎样式区三处）

**Interfaces:**
- Consumes: Task 2 渲染的 DOM（`.welcome-float` / `.welcome-float-dot` / `.welcome-collapse-btn` / `.welcome-new-badge` / `.welcome-emphasis`）
- Produces: 气泡视觉与浅色覆盖；左列洞察面板跨满

- [ ] **Step 1: 主网格与窄屏复位调整**

将：

```css
body.dashboard-mode .main-grid.dashboard-page {
  gap: 16px;
  grid-template-columns: minmax(380px, 1.04fr) minmax(0, 0.96fr);
  /* 左列两行：欢迎屏独立卡片（auto 高）+ 洞察面板（占剩余）；chat 面板跨满右列 */
  grid-template-rows: auto minmax(0, 1fr);
}
```

替换为：

```css
body.dashboard-mode .main-grid.dashboard-page {
  gap: 16px;
  grid-template-columns: minmax(380px, 1.04fr) minmax(0, 0.96fr);
  /* 左列洞察面板 + 右列聊天面板，各跨满整列 */
  grid-template-rows: minmax(0, 1fr);
}
```

删除以下整块（欢迎卡片 grid 占位）：

```css
/* 欢迎屏独立卡片：dashboard 主网格第 1 行第 1 列（左栏顶部），始终完整展开、不折叠。
   chat 面板跨满右列两行，insight 面板在左列第 2 行。 */
body.dashboard-mode .main-grid.dashboard-page > .welcome-panel {
  grid-column: 1;
  grid-row: 1;
  align-self: start;
}
```

将：

```css
body.dashboard-mode .main-grid.dashboard-page > .insight-panel {
  grid-column: 1;
  grid-row: 2;
}
```

替换为：

```css
body.dashboard-mode .main-grid.dashboard-page > .insight-panel {
  grid-column: 1;
  grid-row: 1 / -1;
}
```

将窄屏复位：

```css
  /* 窄屏单列：welcome 卡片 / 洞察 / 聊天按文档流上下堆叠（宽屏的显式 grid 定位复位） */
  body.dashboard-mode .main-grid.dashboard-page > .welcome-panel,
  body.dashboard-mode .main-grid.dashboard-page > .insight-panel,
  body.dashboard-mode .main-grid.dashboard-page > .chat-panel {
    grid-column: auto;
    grid-row: auto;
  }
```

替换为：

```css
  /* 窄屏单列：洞察 / 聊天按文档流上下堆叠（宽屏的显式 grid 定位复位） */
  body.dashboard-mode .main-grid.dashboard-page > .insight-panel,
  body.dashboard-mode .main-grid.dashboard-page > .chat-panel {
    grid-column: auto;
    grid-row: auto;
  }
```

- [ ] **Step 2: 追加气泡与强调态样式**

在 `.welcome-note { font-size: 10px; color: #7b87a3; margin-top: 7px; letter-spacing: 0.01em; }` 之后追加：

```css
/* ── 悬浮气泡容器（方案 C：聊天面板右下角）── */
.welcome-float {
  position: absolute;
  right: 14px;
  bottom: 76px;
  width: 350px;
  max-width: calc(100% - 28px);
  z-index: 40;
}
.welcome-float.tour-hidden { display: none; }
.welcome-float .welcome-float-dot { display: none; }
.welcome-float.collapsed .welcome-panel { display: none; }
.welcome-float.collapsed .welcome-float-dot { display: flex; }

.welcome-float-dot {
  width: 44px; height: 44px; margin-left: auto; border-radius: 50%;
  border: 1px solid rgba(110, 168, 255, 0.45);
  background: linear-gradient(135deg, #6ea8ff 0%, #9b7bff 100%);
  color: #0b0e14; font-size: 18px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  box-shadow:
    0 0 0 4px rgba(110, 168, 255, 0.12),
    0 8px 20px rgba(2, 8, 25, 0.35);
  transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1), box-shadow 0.3s cubic-bezier(0.32, 0.72, 0, 1);
}
.welcome-float-dot:hover {
  transform: translateY(-2px) scale(1.05);
  box-shadow:
    0 0 0 6px rgba(110, 168, 255, 0.18),
    0 10px 26px rgba(2, 8, 25, 0.4);
}
.welcome-float-dot:focus-visible {
  outline: 2px solid rgba(110, 168, 255, 0.8);
  outline-offset: 2px;
}

.welcome-head-main { flex: 1; min-width: 0; }
.welcome-hello { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.welcome-collapse-btn {
  flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%;
  border: 1px solid rgba(156, 199, 255, 0.18);
  background: rgba(156, 199, 255, 0.08); color: #cfe0fa;
  font-size: 11px; line-height: 1; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.25s ease, border-color 0.25s ease, transform 0.2s ease;
}
.welcome-collapse-btn:hover {
  background: rgba(110, 168, 255, 0.2);
  border-color: rgba(110, 168, 255, 0.5);
  transform: scale(1.05);
}
.welcome-collapse-btn:focus-visible { outline: 2px solid rgba(110, 168, 255, 0.8); outline-offset: 2px; }

.welcome-new-badge {
  display: inline-block; font-size: 9px; font-weight: 800; letter-spacing: 0.06em;
  padding: 2px 8px; border-radius: 999px; vertical-align: 2px;
  background: linear-gradient(135deg, #6ea8ff, #9b7bff); color: #0b0e14;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4), 0 0 10px rgba(110, 168, 255, 0.35);
}

/* 新用户强调态 */
.welcome-panel.welcome-emphasis {
  border-color: rgba(110, 168, 255, 0.55);
  background:
    radial-gradient(ellipse 90% 65% at 12% 0%, rgba(110, 168, 255, 0.20) 0%, transparent 60%),
    linear-gradient(180deg, #1a2a52 0%, #122048 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 0 0 1px rgba(110, 168, 255, 0.28),
    0 0 28px rgba(110, 168, 255, 0.28),
    0 18px 44px rgba(2, 8, 25, 0.4);
}
.welcome-panel.welcome-emphasis .welcome-hello { font-size: 16px; }
.welcome-panel.welcome-emphasis .welcome-desc { font-size: 12px; }
@media (prefers-reduced-motion: no-preference) {
  .welcome-panel.welcome-emphasis { animation: welcomeBubbleAttention 4s cubic-bezier(0.45, 0, 0.55, 1) 0.3s 1 both; }
}
@keyframes welcomeBubbleAttention {
  0%, 100% {
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.08),
      0 0 0 1px rgba(110, 168, 255, 0.28),
      0 0 28px rgba(110, 168, 255, 0.28),
      0 18px 44px rgba(2, 8, 25, 0.4);
  }
  25%, 60% {
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.1),
      0 0 0 1px rgba(110, 168, 255, 0.5),
      0 0 44px rgba(110, 168, 255, 0.5),
      0 18px 44px rgba(2, 8, 25, 0.45);
  }
}
```

注意：`.welcome-hello { display: flex; ... }` 是新增覆盖，会与同文件已有的 `.welcome-hello` 规则叠加（flex 布局不影响现有标题/描述排版，徽标与标题同行）。

- [ ] **Step 3: 追加浅色主题覆盖**

在 `body.dashboard-mode[data-dash-theme="light"] .welcome-note { color: #7a86a3; }` 之后追加：

```css
body.dashboard-mode[data-dash-theme="light"] .welcome-panel.welcome-emphasis {
  border-color: rgba(26, 86, 168, 0.42);
  background:
    radial-gradient(ellipse 90% 65% at 12% 0%, rgba(76, 130, 205, 0.14) 0%, transparent 60%),
    linear-gradient(180deg, #ffffff 0%, #edf5ff 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    0 0 0 1px rgba(26, 86, 168, 0.18),
    0 0 24px rgba(26, 86, 168, 0.18),
    0 16px 36px rgba(31, 61, 124, 0.12);
}
body.dashboard-mode[data-dash-theme="light"] .welcome-collapse-btn {
  border-color: rgba(26, 86, 168, 0.2);
  background: rgba(26, 86, 168, 0.06); color: #55688f;
}
body.dashboard-mode[data-dash-theme="light"] .welcome-collapse-btn:hover {
  background: rgba(26, 86, 168, 0.14);
  border-color: rgba(26, 86, 168, 0.45); color: #16294f;
}
body.dashboard-mode[data-dash-theme="light"] .welcome-new-badge {
  background: linear-gradient(135deg, #4c86ea, #3a72dc); color: #ffffff;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 0 10px rgba(26, 86, 168, 0.18);
}
body.dashboard-mode[data-dash-theme="light"] .welcome-float-dot {
  border-color: rgba(26, 86, 168, 0.4);
  box-shadow: 0 0 0 4px rgba(26, 86, 168, 0.1), 0 8px 20px rgba(31, 61, 124, 0.16);
}
```

- [ ] **Step 4: 回归测试**

Run: `node scripts/test_chatbot_welcome.mjs`
Expected: `PASS: welcome logic`

- [ ] **Step 5: 本地视觉验证（服务器在 Task 4 验证后关闭）**

Run:
```powershell
$proc = Start-Process -FilePath 'python' -ArgumentList 'server.py' -WorkingDirectory 'D:\Code\offer-intelligence-main' -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 5
$shot = 'C:\Users\yg\.codex\visualizations\2026\08\05\019fcff0-1c7a-7350-b38f-abc30ccd16d9\welcome-bubble.png'
$profile = Join-Path $env:TEMP ('chrome-profile-' + [guid]::NewGuid().ToString('N'))
& 'C:\Program Files\Google\Chrome\Application\chrome.exe' --headless=new --disable-gpu --disable-software-rasterizer --disable-gpu-sandbox --no-sandbox --disable-dev-shm-usage --hide-scrollbars --user-data-dir=$profile --window-size=1600,1000 --screenshot=$shot 'http://127.0.0.1:8765/'
```

Expected: 截图生成；检查 `.welcome-float` 出现在聊天面板右下角、新用户展开 + 强调态、左侧洞察面板跨满整列（若无法直接看图，通过 `--dump-dom` 检查 `welcome-float` / `welcome-emphasis` 类存在）。

- [ ] **Step 6: Commit（需用户授权）**

```bash
git add public/styles.css
git commit -m "style(chatbot): Add welcome bubble styles and grid adjustment / 添加欢迎气泡样式并调整主网格"
```

---

### Task 4: 缓存版本号、全量回归与文档收尾

**Files:**
- Modify: `public/index.html`（`chatbot_welcome.js` 版本号）
- Modify: `docs/2026-08-05-chatbot-welcome-bubble-design.md`（状态行）

**Interfaces:**
- Consumes: Task 1-3 的产物
- Produces: 可交付状态（CI 全绿 + 本地验证 + 文档状态更新）

- [ ] **Step 1: 更新版本号**

将：

```html
<script src="./chatbot_welcome.js?v=20260804-welcome9"></script>
```

替换为：

```html
<script src="./chatbot_welcome.js?v=20260805-bubble1"></script>
```

- [ ] **Step 2: 更新设计文档状态**

将 `docs/2026-08-05-chatbot-welcome-bubble-design.md` 第 3 行：

```text
状态：设计已获用户确认（方案 C：聊天区右下角悬浮气泡，新用户展开 / 老用户收起）；本文档待用户审阅
```

替换为：

```text
状态：设计已获用户确认并已实现（2026-08-05）；验证见实施计划
```

- [ ] **Step 3: 全量回归（CI 命令集）**

Run:
```bash
node --check public/chatbot_welcome.js
node --check public/onboarding_tour.js
node scripts/test_chatbot_welcome.mjs
node scripts/test_onboarding_tour.mjs
node scripts/test_zh_chatbot.mjs
node scripts/test_chatbot_intent_flow.mjs
```
Expected: 全部无错误 / 全部 PASS（`node --check` 无输出；测试脚本分别输出 `PASS: welcome logic` / `PASS: onboarding tour logic` 等）

- [ ] **Step 4: 本地服务器验证后关闭**

Run（若服务器已在 Task 3 启动则跳过启动）:
```powershell
$conn = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) { taskkill //F //PID $conn.OwningProcess }
```
Expected: 端口 8765 不再监听；确认 `Get-NetTCPConnection -LocalPort 8765 -State Listen` 无输出。

- [ ] **Step 5: Commit（需用户授权）**

```bash
git add public/index.html docs/2026-08-05-chatbot-welcome-bubble-design.md docs/superpowers/plans/2026-08-05-chatbot-welcome-bubble.md
git commit -m "docs(chatbot): Finalize welcome bubble plan and version bump / 收尾欢迎气泡计划与缓存版本号"
```

---

## 自查记录

- **Spec coverage**：设计文档 §4.1（位置/形态）→ Task 2/3；§4.2（新老用户/持久化）→ Task 2 用例 24-26；§4.3（强调态）→ Task 2/3；§4.4（交互时机）→ Task 2 用例 27-28；§4.5（布局）→ Task 3；§4.6（主题/可访问性）→ Task 3；§5 文件影响 → Task 1-4；§6 测试 → Task 1/2/4。
- **Placeholder scan**：无 TBD/TODO/“类似 Task N”占位；每个代码步骤均给出完整代码。
- **Type consistency**：`setCollapsed(collapsed, persist)` / `resetCollapsed()` / `resetAutoCollapse()` / `refreshTourHidden()` / `wrapElement()` / `panelElement()` 在 Task 1 测试与 Task 2 实现中的签名一致；`oi_welcome_collapsed` 读写键一致。
