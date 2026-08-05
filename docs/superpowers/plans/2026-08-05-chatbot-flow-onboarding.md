# Chatbot 流程引导（Flow Onboarding）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让新用户无脑走通「Report 提问 → 一键加入对话 → Chat 对话」主路径，并在每一步关键时刻获得就地提示。

**Architecture:** 方案 B（Deep Window 头部新增「加入对话」按钮，点击后加入记忆栏并自动切 Chat Mode）叠加方案 A（欢迎屏内维护流程状态机 `noReport → reportReady → memoryReady → chatActive`，渲染 3 步进度条 + 关键时刻提示；首次引导 Tour 精简为 5 步与主路径一致）。拖拽最小化路径保留为高级用法。

**Tech Stack:** Vanilla JS IIFE（无框架）、Node vm 沙箱测试（`scripts/test_chatbot_welcome.mjs` / `scripts/test_onboarding_tour.mjs`）、Node `--check` 语法校验、Python `server.py` 本地验证。

**Spec:** `docs/2026-08-05-chatbot-flow-onboarding-design.md`

## Global Constraints

- 所有 zh/en 文案键必须一一对应（`WELCOME_COPY` / `TOUR_COPY` / app.js `translations.zh` + `t()` 英文 fallback）。
- 推荐、对比、分析、关键词四项能力本期不动；最小化 + 拖拽高级路径保留。
- 修改 `public/app.js` 时遵守 AGENTS.md 行号索引：只读相关行区间，不整文件读取。
- 每次任务结束必须提交，提交信息中英双语（英文在前，中文在后，` / ` 分隔）。
- 本地验证完成后必须关闭 `http://127.0.0.1:8765`（AGENTS.md 要求）。
- CI 命令保持现有风格：`node --check ...` 与 `node scripts/test_*.mjs ...`。

---

### Task 1: 欢迎屏流程状态机纯函数 + 新增文案键

**Files:**
- Modify: `public/chatbot_welcome.js`（`WELCOME_COPY` 键集、新增 `flowStage()`、状态变量 `_hasReport` / `_hasPill`、`_test` 导出）
- Test: `scripts/test_chatbot_welcome.mjs`（文件末尾 `console.log("PASS: ...")` 前追加用例 17/18）

**Interfaces:**
- Produces: `flowStage({ hasReport, hasPill, hasMemory, isChat }) -> "noReport" | "reportReady" | "memoryReady" | "chatActive"`；`window.CHATBOT_WELCOME._test.flowStage`；`_test.flowState()` 返回当前状态对象。

- [ ] **Step 1: 写失败测试（追加到 `scripts/test_chatbot_welcome.mjs` 末尾，`console.log` 之前）**

```js
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
for (const key of ["progressStep1", "progressStep2", "progressStep3", "progressAdvanced", "minimizedTip", "goReport"]) {
  assertTruthy(t.copy.zh[key], `zh missing ${key}`);
  assertTruthy(t.copy.en[key], `en missing ${key}`);
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/test_chatbot_welcome.mjs`
Expected: 在用例 17 第一行报 `t.flowStage is not a function`（或类似 TypeError）。

- [ ] **Step 3: 实现 `public/chatbot_welcome.js`**

3a. 在 `WELCOME_COPY.zh` 的 `panelTip` 之后追加键（同时把 `panelTip` 文案改成主路径引导）：

```js
      panelTip: "点「加入对话」一键带进对话；或点 ─ 最小化后拖入记忆栏（高级用法）",
      progressStep1: "① 在 Report 提问",
      progressStep2: "② 点「加入对话」",
      progressStep3: "③ 在 Chat 对话",
      progressAdvanced: "高级用法：最小化后拖入记忆栏",
      minimizedTip: "已最小化：切到 Chat Mode，把药丸拖到记忆栏",
      goReport: "去生成报告"
```

3b. 在 `WELCOME_COPY.en` 的 `panelTip` 之后追加对应键：

```js
      panelTip: "Click “Add to chat” to start instantly, or click – to minimize and drag into the memory bar (advanced)",
      progressStep1: "① Ask in Report Mode",
      progressStep2: "② Click Add to chat",
      progressStep3: "③ Chat in Chat Mode",
      progressAdvanced: "Advanced: minimize, then drag into the memory bar",
      minimizedTip: "Minimized: switch to Chat Mode and drag the pill into the memory bar",
      goReport: "Go generate a report"
```

3c. 在 `_mode` / `_offers` 等状态变量声明处（`var _hasMemory = false;` 附近）追加：

```js
  var _hasReport = false;
  var _hasPill = false;
```

3d. 在 `currentCopy(key)` 函数之后新增纯函数：

```js
  // ── 流程状态机：主路径 3 步（① Report 提问 → ② 加入对话 → ③ Chat 对话）──
  function flowStage(state) {
    state = state || {};
    var hasReport = !!state.hasReport;
    var hasMemory = !!state.hasMemory;
    var isChat = !!state.isChat;
    if (hasMemory && isChat) return "chatActive";
    if (hasMemory) return "memoryReady";
    if (hasReport) return "reportReady";
    return "noReport";
  }
```

3e. 在 `window.CHATBOT_WELCOME` 的 `_test` 对象中追加导出（现有 `_test` 对象末尾 `renderChatReminder` 之后加逗号并追加）：

```js
      flowStage: flowStage,
      flowState: function () {
        return { hasReport: _hasReport, hasPill: _hasPill, hasMemory: _hasMemory, isChat: _mode === "chat" };
      }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node scripts/test_chatbot_welcome.mjs`
Expected: `PASS: welcome logic` 且用例 17/18 通过。

- [ ] **Step 5: 提交**

```bash
git add public/chatbot_welcome.js scripts/test_chatbot_welcome.mjs
git commit -m "Add welcome flow stage machine / 添加欢迎屏流程状态机"
```

---

### Task 2: 欢迎屏进度条、状态事件处理、提醒卡片按钮、fillInput API

**Files:**
- Modify: `public/chatbot_welcome.js`（`progressHtml()` / `_refreshProgress()` / `_anyMinimizedPanel()` / `fillInput()` / `_goReportFromReminder()`、`notify()` 扩展、`_renderChatReminder()` 扩展、`_renderPanel()` 替换 flow 为 progress、`_test` 导出）
- Test: `scripts/test_chatbot_welcome.mjs`（用例 19-23；测试沙箱 `document.querySelectorAll` 增加 `.deep-window.minimized` 映射、`document.dispatchEvent` 记录、`byIdMap["chatInput"]` 复用 elementStub）

**Interfaces:**
- Consumes: Task 1 的 `flowStage()`、`WELCOME_COPY` 新键、`_test.flowState()`。
- Produces: `window.CHATBOT_WELCOME.fillInput(text) -> boolean`；`notify("panel-minimized")` / `notify("panel-expanded")` / `notify("chat-add")`；`_test.progressHtml(state)` / `_test.chatReminderHtml()` / `_test.triggerGoReport()`。

- [ ] **Step 1: 写失败测试（继续追加到 `scripts/test_chatbot_welcome.mjs` 末尾）**

1a. 在测试沙箱 `document` 对象中加查询映射与事件记录（修改现有 sandbox 定义）：

```js
let minimizedPanels = [];
let dispatchedEvents = [];
const documentWithFlow = {
  ...sandbox.document,
  querySelectorAll(sel) {
    if (sel === ".deep-window.minimized") return minimizedPanels;
    if (sel === ".welcome-panel") return mainGrid.querySelectorAll(sel);
    return [];
  },
  dispatchEvent(evt) { dispatchedEvents.push(evt && evt.type); return true; }
};
sandbox.document = documentWithFlow;
sandbox.window.document = documentWithFlow;
```

注意：原 sandbox 的 `document` 是对象字面量，直接替换 `sandbox.document` 即可；`mainGrid` 的 `querySelectorAll` 仍由原 stub 提供。

1b. 追加用例：

```js
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
```

若测试文件顶部没有 `assertMatch` 辅助函数，先补一个（与 `test_onboarding_tour.mjs` 同款）：

```js
function assertMatch(actual, pattern, label) {
  if (!pattern.test(actual)) throw new Error(`${label}: expected ${JSON.stringify(actual)} to match ${pattern}`);
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/test_chatbot_welcome.mjs`
Expected: 用例 19 报 `t.progressHtml is not a function`。

- [ ] **Step 3: 实现 `public/chatbot_welcome.js`**

3a. 新增 `_flowState()` / `_anyMinimizedPanel()` / `_refreshProgress()` / `progressHtml()`（放在 `flowStage` 之后）：

```js
  function _flowState() {
    return { hasReport: _hasReport, hasPill: _hasPill, hasMemory: _hasMemory, isChat: _mode === "chat" };
  }
  function _anyMinimizedPanel() {
    try { return document.querySelectorAll(".deep-window.minimized").length > 0; } catch (e) { return false; }
  }
  function _refreshProgress() {
    try {
      var container = containerFor(_mode);
      if (!container) return;
      var panel = container.querySelector(".welcome-panel");
      var box = panel && panel.querySelector(".welcome-progress");
      if (box) box.outerHTML = progressHtml(_flowState());
    } catch (e) {}
  }
  function progressHtml(state) {
    var stage = flowStage(state);
    var steps = [
      { key: "progressStep1", state: "active" },
      { key: "progressStep2", state: "" },
      { key: "progressStep3", state: "" }
    ];
    if (stage === "reportReady") { steps[0].state = "done"; steps[1].state = "active"; }
    else if (stage === "memoryReady") { steps[0].state = "done"; steps[1].state = "done"; steps[2].state = "active"; }
    else if (stage === "chatActive") { steps[0].state = "done"; steps[1].state = "done"; steps[2].state = "done"; }
    return '<div class="welcome-progress" data-stage="' + escapeHtml(stage) + '">' +
      steps.map(function (s, i) {
        var cls = "welcome-progress-step" + (s.state ? " " + s.state : "");
        var icon = s.state === "done" ? "✓" : String(i + 1);
        return '<div class="' + cls + '"><span class="welcome-progress-num">' + escapeHtml(icon) + '</span>' +
          '<span class="welcome-progress-label">' + escapeHtml(currentCopy(s.key)) + '</span></div>';
      }).join('<span class="welcome-progress-arrow">→</span>') +
      '<div class="welcome-progress-advanced">' + escapeHtml(currentCopy("progressAdvanced")) + '</div></div>';
  }
```

3b. `_renderPanel()` 中把 `headHtml() + flowHtml()` 替换为 `headHtml() + progressHtml(_flowState())`；同时删除不再使用的 `flowHtml()` 函数（含 `flow1Title/flow2Title/flow3Title/flow1Sub/flow2Sub/flow3Sub` 文案键可保留，避免破坏键集一致性测试）。

3c. `notify()` 中扩展事件处理（在 `report-ready` 分支前插入，并修改现有分支）：

```js
    if (eventName === "report-ready") {
      _hasReport = true;
      _refreshProgress();
      if (_panelTipShown || !payload.panelEl) return;
      _panelTipShown = true;
      _insertPanelTip(payload.panelEl);
      return;
    }
    if (eventName === "panel-minimized") {
      _hasPill = true;
      _showTipbar("minimizedTip");
      return;
    }
    if (eventName === "panel-expanded") {
      _hasPill = _anyMinimizedPanel();
      if (!_hasPill) _clearTipbar();
      return;
    }
    if (eventName === "chat-add") {
      _hasReport = true;
      if (payload.hasMemory !== undefined) _hasMemory = !!payload.hasMemory;
      _refreshProgress();
      _clearTipbar();
      _pulseSend(false);
      return;
    }
```

并把 `mode-switched` / `memory-added` 分支改为：

```js
    if (eventName === "mode-switched") {
      if (payload.hasMemory !== undefined) _hasMemory = !!payload.hasMemory;
      var mode = payload.mode === "chat" ? "chat" : "report";
      _mode = mode;
      _refreshProgress();
      _syncChatReminder(mode);
      return;
    }
    if (eventName === "memory-added") {
      _hasMemory = true;
      _hasReport = true;
      _refreshProgress();
      return;
    }
```

3d. `_renderChatReminder()` 改为带「去生成报告」按钮，并新增 `_goReportFromReminder()` / `fillInput()`：

```js
  function _renderChatReminder(force) {
    try {
      var log = _chatLogChatElement();
      if (!log) return;
      if (force) _removeChatReminder();
      if (log.querySelector && log.querySelector(".chat-reminder")) return;
      var card = makeEl("chat-reminder",
        '<span class="chat-reminder-icon">📌</span>' +
        '<span class="chat-reminder-text">' + escapeHtml(currentCopy("chatReminder")) + '</span>' +
        '<button type="button" class="chat-reminder-action">' + escapeHtml(currentCopy("goReport")) + '</button>');
      var actionBtn = card.querySelector(".chat-reminder-action");
      if (actionBtn) actionBtn.addEventListener("click", _goReportFromReminder);
      if (log.insertBefore) log.insertBefore(card, log.firstChild || null);
    } catch (e) {}
  }
  function _goReportFromReminder() {
    try { document.dispatchEvent(new CustomEvent("chatbot-go-report")); } catch (e) {}
    _fillFirstReportExample();
  }
  function _fillFirstReportExample() {
    var ex = WELCOME_EXAMPLES.report[0];
    if (!ex) return;
    fillInput(resolveExampleText(ex, exampleMerchant(_offers)));
  }
  function fillInput(text) {
    var input = null;
    try { input = document.getElementById("chatInput"); } catch (e) {}
    if (!input) return false;
    input.value = text;
    _lastFillValue = text;
    _tipFromExample = true;
    _pulseSend(true);
    return true;
  }
```

3e. `window.CHATBOT_WELCOME` 公共 API 追加 `fillInput: fillInput`；`_test` 追加：

```js
      progressHtml: progressHtml,
      chatReminderHtml: function () {
        var log = _chatLogChatElement();
        if (!log || !log.querySelector) return "";
        var card = log.querySelector(".chat-reminder");
        return card && card.innerHTML ? card.innerHTML : "";
      },
      triggerGoReport: _goReportFromReminder
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node scripts/test_chatbot_welcome.mjs`
Expected: `PASS: welcome logic`，用例 19-23 通过。

- [ ] **Step 5: 提交**

```bash
git add public/chatbot_welcome.js scripts/test_chatbot_welcome.mjs
git commit -m "Add welcome flow progress and one-click guidance / 添加欢迎屏流程进度与一键引导"
```

---

### Task 3: 新手引导 Tour 精简为 5 步（主路径一致）

**Files:**
- Modify: `public/onboarding_tour.js`（`TOUR_STEPS`、`TOUR_COPY`、点击事件委托、删除 drag-memory 相关代码）
- Test: `scripts/test_onboarding_tour.mjs`（用例 1/2/5/6/9/10/13/14/16/17 更新）

**Interfaces:**
- Consumes: 无前置依赖。
- Produces: `notify("chat-add")` 自动推进第 4 步；`TOUR_STEPS` 5 步 id：`intro|report-ask|deep-window|add-to-chat|chat-ask`。

- [ ] **Step 1: 更新失败测试（按下列断言改写 `scripts/test_onboarding_tour.mjs`）**

1a. 用例 1 替换为：

```js
assertEqual(t.stepCount(), 5, "should have exactly 5 steps");
const ids = t.steps.map((s) => s.id);
assertEqual(new Set(ids).size, ids.length, "step ids must be unique");
assertEqual(ids.join("|"), "intro|report-ask|deep-window|add-to-chat|chat-ask", "step ids order");
for (const s of t.steps) {
  assertTruthy(s.target, `step ${s.id} target must be a selector or function`);
  assertTruthy(s.copyKey, `step ${s.id} copyKey must be set`);
  assertEqual(["block", "pass"].includes(s.mask), true, `step ${s.id} mask must be block|pass`);
}
assertEqual(t.steps[0].id, "intro", "step0 should be the layout intro");
assertEqual(t.steps[0].autoNext, undefined, "intro step should have no autoNext");
assertEqual(t.steps[1].autoFillFocus, '#chatForm button[type="submit"]', "report-ask should focus send button after autofill");
assertEqual(t.steps[1].autoNext, "sent", "report-ask should autoNext on sent");
assertEqual(t.steps[2].id, "deep-window", "step2 should wait for report");
assertEqual(typeof t.steps[2].target, "function", "deep-window target should be a dynamic function");
assertEqual(t.steps[3].id, "add-to-chat", "step3 should be add-to-chat");
assertEqual(t.steps[3].autoNext, "chat-add", "add-to-chat should autoNext on chat-add");
assertEqual(typeof t.steps[3].target, "function", "add-to-chat target should be a dynamic function");
assertEqual(t.steps[4].id, "chat-ask", "step4 should be chat-ask");
assertEqual(t.steps[4].autoFillFocus, '#chatForm button[type="submit"]', "chat-ask should focus send button after autofill");
assertEqual(t.steps[4].autoNext, "sent", "chat-ask should autoNext on sent");
assertEqual(t.steps[4].final, true, "chat-ask should be final");
assertEqual(t.steps.filter((s) => s.autoNext).length, 3, "3 steps should have autoNext (sent/chat-add/sent)");
assertEqual(t.steps.filter((s) => s.final).length, 1, "only chat-ask should be final");
assertEqual(t.steps[3].autoFill, undefined, "add-to-chat should not have autoFill");
```

1b. 用例 2 中删除 `step5NeedSwitchBody` / `dropzoneTip` 断言，改为：

```js
assertTruthy(t.copy.zh.step3NextHint, "zh missing step3NextHint");
assertTruthy(t.copy.en.step3NextHint, "en missing step3NextHint");
assertTruthy(t.copy.zh.step4NextHint, "zh missing step4NextHint");
assertTruthy(t.copy.en.step4NextHint, "en missing step4NextHint");
```

1c. 用例 5（autoNext 判定）替换为：

```js
assertEqual(t.isAutoNextStep(0, "sent"), false, "intro should not autoNext on sent");
assertEqual(t.isAutoNextStep(1, "sent"), true, "report-ask should autoNext on sent");
assertEqual(t.isAutoNextStep(1, "other"), false, "report-ask should not autoNext on other events");
assertEqual(t.isAutoNextStep(3, "chat-add"), true, "add-to-chat should autoNext on chat-add");
assertEqual(t.isAutoNextStep(3, "memory-added"), false, "add-to-chat should not autoNext on memory-added");
assertEqual(t.isAutoNextStep(4, "sent"), true, "chat-ask should autoNext on sent");
```

1d. 用例 6（notify 推进 + 完成）替换为：

```js
tour.startTour();
tour.advance(); // 1
tour.notify("sent"); // 2 -> deep-window
tour.advance(); // 3 -> add-to-chat
assertEqual(t.currentStepIndex(), 3, "advance should reach add-to-chat");
tour.notify("chat-add");
assertEqual(t.currentStepIndex(), 4, "notify chat-add should auto-advance to chat-ask");
tour.notify("sent");
assertEqual(tour.isActive(), false, "notify sent on final step should finish tour");
assertEqual(tour.shouldShowTour({ getItem: () => "1" }), false, "finished tour should stay hidden");
```

1e. 用例 9 中删除 minimize / drag-memory 相关分支，替换为 add-to-chat 目标解析：

```js
const addBtnStub = { ...elementStub };
const addPanelStub = { ...elementStub, querySelector() { return addBtnStub; } };
queryAllMap[".deep-window"] = [addPanelStub];
assertEqual(t.resolveTarget(t.steps[3]), addBtnStub, "add-to-chat should target the LAST panel's chat-add button");
delete queryAllMap[".deep-window"];
```

1f. 用例 10 替换为 5 步推进序列：

```js
tour.startTour();
tour.advance(); // 1
tour.notify("sent"); // 2
tour.advance(); // 3
assertEqual(t.currentStepIndex(), 3, "advance should reach add-to-chat");
tour.notify("chat-add");
assertEqual(t.currentStepIndex(), 4, "notify chat-add should reach chat-ask");
tour.notify("sent");
assertEqual(tour.isActive(), false, "final sent should finish tour");
```

1g. 用例 11 文案断言改为 `Step 1 of 5`：

```js
assertMatch(t.popoverHtml(), /Step 1 of 5/, "popover should re-render with en copy after lang change");
```

1h. 用例 12 改为断言第 4 步（add-to-chat）渲染置灰提示「点击「加入对话」按钮继续」：

```js
queryAllMap[".deep-window:not(.generating)"] = [{ ...elementStub, nodeType: 1 }];
tour.startTour();
tour.advance(); // 1
tour.advance(); // 2
assertEqual(t.currentStepIndex(), 2, "advance should reach deep-window");
assertMatch(t.popoverHtml(), /data-tour-action="next"/, "deep-window should render Next button");
queryAllMap[".deep-window"] = [{ ...elementStub, querySelector() { return { ...elementStub }; } }];
tour.advance(); // 3 -> add-to-chat（target 函数依赖 queryAllMap[.deep-window]，推进前必须先建映射）
assertMatch(t.popoverHtml(), /onboarding-btn-hint/, "add-to-chat should render disabled hint");
assertMatch(t.popoverHtml(), /点击「加入对话」按钮继续/, "hint should show zh action hint");
assertMatch(t.popoverHtml(), /disabled/, "hint should be disabled");
assertEqual(t.popoverHtml().indexOf('data-tour-action="next"'), -1, "autoNext step should not render Next");
tour.stopTour();
delete queryAllMap[".deep-window"];
delete queryAllMap[".deep-window:not(.generating)"];
```

1i. 删除用例 13（dropzone）、用例 16（drag-memory 高光转移）、用例 17（requireMinimized 守卫）；用例 14 的 `t.steps[6]` 全部改为 `t.steps[4]`。

1j. 用例 15（重播切回 Report Mode）保持不变。

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/test_onboarding_tour.mjs`
Expected: 用例 1 报 `should have exactly 5 steps`（当前 7）。

- [ ] **Step 3: 实现 `public/onboarding_tour.js`**

3a. `TOUR_STEPS` 整体替换为：

```js
  var TOUR_STEPS = [
    {
      id: "intro",
      target: "#chatModeToggle",
      copyKey: "intro",
      mask: "block"
    },
    {
      id: "report-ask",
      target: "#chatInput",
      copyKey: "step1",
      mask: "block",
      autoFill: "Shokz",
      autoFillFocus: '#chatForm button[type="submit"]',
      autoNext: "sent"
    },
    {
      id: "deep-window",
      target: function () {
        try {
          var list = document.querySelectorAll(".deep-window:not(.generating)");
          return (list && list.length) ? list[list.length - 1] : null;
        } catch (e) { return null; }
      },
      copyKey: "step2",
      mask: "block",
      appear: true
    },
    {
      id: "add-to-chat",
      target: function () {
        try {
          var list = document.querySelectorAll(".deep-window");
          if (!list || !list.length) return null;
          var last = list[list.length - 1];
          return last.querySelector ? last.querySelector(".deep-window-chat-add") : null;
        } catch (e) { return null; }
      },
      copyKey: "step3",
      mask: "block",
      autoNext: "chat-add"
    },
    {
      id: "chat-ask",
      target: "#chatInput",
      copyKey: "step4",
      mask: "block",
      autoFill: "根据刚才的报告，给我分析建议",
      autoFillEn: "Based on the report, give me some analysis suggestions",
      autoFillFocus: '#chatForm button[type="submit"]',
      autoNext: "sent",
      final: true
    }
  ];
```

3b. `TOUR_COPY.zh` 更新（删除 step5/step6/dropzoneTip/minimizeRequired 键，新增/改写如下）：

```js
      introTitle: "👋 欢迎使用 YeahPromos 助手",
      introBody: "先认识整体布局：聊天区顶部可切换 Report Mode（提问获取数据报告）与 Chat Mode（带着数据对话），输入商户名 / Merchant ID / ASIN 或品类即可查询；报告以浮窗展示，点击「加入对话」即可把报告带进 Chat Mode。下面我们实际操作一遍。",
      step1Title: "第 1 步：在 Report Mode 提问",
      step1Body: "在输入框输入商户名 / Merchant ID / ASIN 或品类，就能获取后台数据分析报告。填好后点击右侧「发送」按钮发起查询。试试看：",
      step2Title: "第 2 步：等待分析报告",
      step2Body: "报告在浮窗中打开。生成完成后，浮窗头部会出现「加入对话」按钮。",
      step3Title: "第 3 步：点「加入对话」",
      step3Body: "点击浮窗头部的「加入对话」按钮，报告会自动加入记忆栏并切换到 Chat Mode。",
      step4Title: "第 4 步：与 Chat Mode 对话",
      step4Body: "记忆栏里已经有刚才的报告了，现在可以自由提问。填好后点击「发送」按钮。试试：\n（高级用法：也可以点「─」最小化浮窗，再拖入记忆栏。）",
      completeTitle: "🎉 完成！",
      completeBody: "你已经掌握了核心用法：Report 提问 → 点「加入对话」→ Chat 对话。随时点击 Help 可重播本引导。",
      fillExample: "帮我填入示例",
      prev: "上一步",
      next: "下一步",
      skip: "跳过",
      finish: "完成 🎉",
      stepCounter: "第 {n} 步 / 共 {total} 步",
      waitReport: "等待报告生成…",
      step1NextHint: "点击「发送」按钮继续",
      step3NextHint: "点击「加入对话」按钮继续",
      step4NextHint: "点击「发送」按钮完成"
```

3c. `TOUR_COPY.en` 对应更新（删除 step5/step6/dropzoneTip/minimizeRequired 键）：

```js
      introTitle: "👋 Welcome to the YeahPromos Assistant",
      introBody: "Here's the layout: the top of the chat area toggles between Report Mode (ask for data reports) and Chat Mode (chat with context); type a merchant name / ID / ASIN or category to query. Reports open in a floating window — click “Add to chat” to bring the report into Chat Mode. Let's walk through it.",
      step1Title: "Step 1: Ask in Report Mode",
      step1Body: "Type a merchant name / ID / ASIN or category to get a data analysis report. Click the Send button on the right to submit. Try it:",
      step2Title: "Step 2: Wait for the report",
      step2Body: "Reports open in a floating window. Once ready, an “Add to chat” button appears in the header.",
      step3Title: "Step 3: Click Add to chat",
      step3Body: "Click “Add to chat” in the window header — the report is added to memory and you're switched to Chat Mode automatically.",
      step4Title: "Step 4: Chat with context",
      step4Body: "The report is now in your memory bar. Ask freely. Click Send to submit. Try:\n(Advanced: you can also click “–” to minimize the window, then drag it into the memory bar.)",
      completeTitle: "🎉 Done!",
      completeBody: "You've learned the core flow: ask in Report Mode → click Add to chat → chat in Chat Mode. Click Help anytime to replay this guide.",
      fillExample: "Fill example for me",
      prev: "Back",
      next: "Next",
      skip: "Skip",
      finish: "Finish 🎉",
      stepCounter: "Step {n} of {total}",
      waitReport: "Waiting for the report…",
      step1NextHint: "Click Send to continue",
      step3NextHint: "Click “Add to chat” to continue",
      step4NextHint: "Click Send to finish"
```

3d. 删除 drag-memory 专属代码：状态变量 `_dropzoneTip` / `_pendingPillEl`，函数 `_addDropzoneHint()` / `_positionDropzoneTip()` / `_removeDropzoneHint()` / `_retargetToPill()`，以及 `_renderStep()` 中 `if (step.id === "drag-memory") { ... }` 块、`advance()` / `goBack()` / `stopTour()` 中的 `_removeDropzoneHint()` 调用、`notify()` 中 `focusOn` / `autoNextFocus` 的 pill 跟随分支（保留 `_retarget()` / `_focusSelector` 通用机制）。

3e. 模块级事件委托替换为：

```js
  try {
    document.addEventListener("submit", function (e) {
      if (e.target && e.target.id === "chatForm") notify("sent");
    });
    document.addEventListener("click", function (e) {
      if (e.target && e.target.closest && e.target.closest(".deep-window-chat-add")) notify("chat-add");
    });
  } catch (e) {}
```

（删除 `.deep-window-minimize` 与 `[data-mode="fast"]` 的 notify 委托。）

3f. `_renderStep()` 中保留 `_bodyKeyOverride` 机制但不再赋值（删除 `step5NeedSwitchBody` 分支）；`_ensureReportMode()` 保持不变。

- [ ] **Step 4: 运行测试确认通过**

Run: `node scripts/test_onboarding_tour.mjs`
Expected: `PASS: onboarding tour logic`，全部用例通过。

- [ ] **Step 5: 提交**

```bash
git add public/onboarding_tour.js scripts/test_onboarding_tour.mjs
git commit -m "Simplify onboarding tour to one-click flow / 精简新手引导为一键主路径"
```

---

### Task 4: app.js 深窗「加入对话」按钮 + 最小化/展开事件通知

**Files:**
- Modify: `public/app.js`（`translations.zh` 约 907-933 区、`_deepPanelTemplate()` 约 9554-9576、`_bindPanelEvents()` 约 9622-9649、`_showPanelSkeleton()` 约 10005-10021、`_renderPanelReport()` 约 10063-10072、`_showQuickResultInDeepPanel()` 约 10188-10198、`_showPanelError()` 约 10085-10089、`_showDeepPanel()` 约 9943-9953、`_settleMin()` 约 9795-9810、`_settleExp()` 约 9875-9892）

**Interfaces:**
- Consumes: Task 2 的 `fillInput`（Task 5 使用）。
- Produces: `.deep-window-chat-add` 按钮（初始 hidden）；`notify("panel-minimized")` / `notify("panel-expanded")`；`panel._addedToMemory` 标记（Task 5 使用）。

**测试策略：** app.js 内部 DOM 函数无现有单测沙箱，本任务验证用 `node --check public/app.js` + 现有回归测试；交互正确性由 Task 7 手动清单覆盖。

- [ ] **Step 1: 新增 i18n 中文键（`translations.zh`，`"tour.button"` 之后）**

```js
      "tour.button": "🎓 新手引导",
      "deep.chatAdd": "加入对话",
      "deep.chatAdded": "已加入",
      "chat.addedMessage": "报告「{title}」已加入对话，试试问：",
      "chat.goReport": "去生成报告",
      "chat.starterAsk": "根据记忆栏的报告，给我分析建议",
      "chat.starterPlan": "总结记忆栏的数据，分析下个月的运营方向"
```

英文文案走 `t()` 的 fallback 参数（见后续各步）。

- [ ] **Step 2: `_deepPanelTemplate()` 头部动作区追加按钮（Export 按钮行之后）**

```js
        '<button class="deep-window-export" type="button">' + t("deep.export", "Export") + '</button>' +
        '<button class="deep-window-chat-add hidden" type="button">' + t("deep.chatAdd", "Add to chat") + '</button>' +
```

- [ ] **Step 3: `_bindPanelEvents()` 绑定点击（Export 绑定之后）**

```js
    el.querySelector(".deep-window-chat-add").addEventListener("click", function () {
      _addToChat(panel);
    });
```

- [ ] **Step 4: 按钮可见性四处分叉**

4a. `_showPanelSkeleton()` 按钮状态块（`deep-window-export` 行之后）追加：

```js
    panel.el.querySelector(".deep-window-chat-add")?.classList.add("hidden");
```

4b. `_renderPanelReport()` 恢复按钮块追加：

```js
    panel.el.querySelector(".deep-window-chat-add")?.classList.remove("hidden");
```

4c. `_showQuickResultInDeepPanel()` 恢复按钮块追加：

```js
    panel.el.querySelector(".deep-window-chat-add")?.classList.remove("hidden");
```

4d. `_showPanelError()` 恢复按钮块追加：

```js
    panel.el.querySelector(".deep-window-chat-add")?.classList.add("hidden");
```

- [ ] **Step 5: `_showDeepPanel()` 恢复按钮状态（现有 `deep-window-export` 恢复之后追加）**

```js
    var chatAddBtn = el.querySelector(".deep-window-chat-add");
    if (chatAddBtn) {
      if (panel.state === "content") {
        chatAddBtn.classList.remove("hidden");
        chatAddBtn.disabled = !!panel._addedToMemory;
        chatAddBtn.textContent = panel._addedToMemory
          ? t("deep.chatAdded", "Added")
          : t("deep.chatAdd", "Add to chat");
      } else {
        chatAddBtn.classList.add("hidden");
      }
    }
```

- [ ] **Step 6: `_settleMin()` 与 `_settleExp()` 通知欢迎屏**

6a. `_settleMin()` 中 `_bringPanelToFront(p);` 之后追加：

```js
      if (window.CHATBOT_WELCOME) {
        window.CHATBOT_WELCOME.notify("panel-minimized", { panelEl: el });
      }
```

6b. `_settleExp()` 中 `_bringPanelToFront(p);` 之后追加：

```js
      if (window.CHATBOT_WELCOME) {
        window.CHATBOT_WELCOME.notify("panel-expanded", { panelEl: el });
      }
```

- [ ] **Step 7: 回归验证**

Run:
```bash
node --check public/app.js
node scripts/test_chatbot_intent_flow.mjs
node scripts/test_chatbot_welcome.mjs
node scripts/test_onboarding_tour.mjs
```
Expected: `node --check` 无输出退出码 0；三个测试文件均 `PASS`。

（本任务结束时不单独提交，`_addToChat` 尚未定义会导致运行时错误，与 Task 5 合并提交。）

---

### Task 5: app.js 一键加入对话 + 模式切换重构 + 空记忆引导事件

**Files:**
- Modify: `public/app.js`（新增 `_switchToChatMode()` / `_switchToReportMode()` / `_addToChat()` / `_injectChatStarter()`；替换模式切换监听约 19804-19833；init 新增 `chatbot-go-report` 监听；`OFFER_INTELLIGENCE_TEST_HOOKS` 追加可选导出）

**Interfaces:**
- Consumes: Task 2 `window.CHATBOT_WELCOME.fillInput(text)`；Task 4 的按钮/标记/事件。
- Produces: `_addToChat(panel)`（点击按钮 → 记忆 + 自动切 Chat + 注入 starter + notify）；`_switchToChatMode()` / `_switchToReportMode()`；`document` 自定义事件 `chatbot-go-report` 监听。

- [ ] **Step 1: 新增 `_switchToChatMode()` / `_switchToReportMode()`（放在 `_syncChatLogVisibility()` 之后）**

```js
  function _switchToChatMode() {
    state.deepMode = false;
    if (els.modeFastBtn) els.modeFastBtn.classList.add("active");
    if (els.modeDeepBtn) els.modeDeepBtn.classList.remove("active");
    if (els.chatInput) els.chatInput.placeholder = t("chat.placeholder", "Ask about EPC, tiers, AOV, conversion, unpaid offers...");
    _syncChatLogVisibility();
    _renderMemoryBar();
    if (window.CHATBOT_WELCOME) {
      window.CHATBOT_WELCOME.notify("mode-switched", {
        mode: "chat",
        hasMemory: !!(state.reportMemory && state.reportMemory.length)
      });
    }
  }
  function _switchToReportMode() {
    state.deepMode = true;
    if (els.modeDeepBtn) els.modeDeepBtn.classList.add("active");
    if (els.modeFastBtn) els.modeFastBtn.classList.remove("active");
    if (els.chatInput) els.chatInput.placeholder = t("deep.placeholder", "View analysis results in Deep Window…");
    _syncChatLogVisibility();
    _renderMemoryBar();
    if (window.CHATBOT_WELCOME) {
      window.CHATBOT_WELCOME.notify("mode-switched", {
        mode: "report",
        hasMemory: !!(state.reportMemory && state.reportMemory.length)
      });
    }
  }
```

- [ ] **Step 2: 替换两个模式切换监听为公共函数**

```js
    els.modeFastBtn?.addEventListener("click", _switchToChatMode);
    els.modeDeepBtn?.addEventListener("click", _switchToReportMode);
```

（删除原 19805-19833 的两个匿名箭头函数体。）

- [ ] **Step 3: 新增 `_addToChat()` / `_injectChatStarter()`（放在 `_addMemoryFromPanel()` 之后）**

```js
  function _addToChat(panel) {
    if (!panel || panel.state === "loading" || panel._addedToMemory) return;
    panel._addedToMemory = true;
    _addMemoryFromPanel(panel);
    var btn = panel.el && panel.el.querySelector(".deep-window-chat-add");
    if (btn) {
      btn.disabled = true;
      btn.textContent = t("deep.chatAdded", "Added");
    }
    _switchToChatMode();
    _injectChatStarter(panel.title || panel.prompt || "Report");
    if (window.ONBOARDING_TOUR) window.ONBOARDING_TOUR.notify("chat-add");
    if (window.CHATBOT_WELCOME) {
      window.CHATBOT_WELCOME.notify("chat-add", {
        hasMemory: true,
        title: panel.title || panel.prompt || ""
      });
    }
  }
  function _injectChatStarter(title) {
    try {
      var log = els.chatLogChat;
      if (!log || log.querySelector(".chat-memory-starter")) return;
      var starter = document.createElement("div");
      starter.className = "chat-memory-starter";
      var p = document.createElement("p");
      p.textContent = t("chat.addedMessage", "Report “{title}” added to chat — try asking:").replace("{title}", title);
      starter.appendChild(p);
      var wrap = document.createElement("div");
      wrap.className = "chat-memory-starter-chips";
      var chips = [
        t("chat.starterAsk", "Analyze the report and give me suggestions"),
        t("chat.starterPlan", "Summarize the data and plan next month's direction")
      ];
      chips.forEach(function (text) {
        var chip = document.createElement("button");
        chip.type = "button";
        chip.className = "welcome-chip";
        chip.textContent = text;
        chip.addEventListener("click", function () {
          if (window.CHATBOT_WELCOME && window.CHATBOT_WELCOME.fillInput) {
            window.CHATBOT_WELCOME.fillInput(text);
          }
        });
        wrap.appendChild(chip);
      });
      starter.appendChild(wrap);
      var reminder = log.querySelector(".chat-reminder");
      if (reminder && reminder.nextSibling) log.insertBefore(starter, reminder.nextSibling);
      else log.insertBefore(starter, log.firstChild || null);
    } catch (e) {}
  }
```

- [ ] **Step 4: init 中新增空记忆「去生成报告」事件监听（模式切换监听附近）**

```js
    document.addEventListener("chatbot-go-report", function () {
      _switchToReportMode();
    });
```

- [ ] **Step 5: 回归验证**

Run:
```bash
node --check public/app.js
node scripts/test_chatbot_intent_flow.mjs
node scripts/test_zh_chatbot.mjs
node scripts/test_chatbot_welcome.mjs
node scripts/test_onboarding_tour.mjs
```
Expected: `node --check` 无输出退出码 0；四个测试文件均 `PASS`。

- [ ] **Step 6: 提交（含 Task 4 的未提交改动）**

```bash
git add public/app.js
git commit -m "Add one-click add-to-chat flow / 添加一键加入对话流程"
```

---

### Task 6: 新样式（进度条、加入对话按钮、提醒卡片按钮、Chat starter）

**Files:**
- Modify: `public/styles.css`（文件末尾追加；浅色主题覆盖追加在 `body.dashboard-mode[data-dash-theme="light"]` 相关区块之后）

- [ ] **Step 1: 追加深色主题样式（文件末尾）**

```css
/* ── Chatbot 流程引导（Flow Onboarding）── */
.welcome-progress {
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
  margin-bottom: 12px; padding: 8px 10px;
  background: linear-gradient(180deg, rgba(156, 199, 255, 0.06) 0%, rgba(156, 199, 255, 0.02) 100%);
  border: 1px solid rgba(156, 199, 255, 0.10);
  border-radius: 10px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
.welcome-progress-step {
  display: flex; align-items: center; gap: 5px; flex: 1;
  font-size: 10.5px; color: #7b87a3; min-width: 0;
}
.welcome-progress-step.active { color: #eef2f8; }
.welcome-progress-step.done { color: #9fc5ff; }
.welcome-progress-num {
  width: 17px; height: 17px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 9.5px; font-weight: 700;
  background: rgba(156, 199, 255, 0.12); color: #9aa7bd;
  border: 1px solid rgba(156, 199, 255, 0.18);
}
.welcome-progress-step.active .welcome-progress-num {
  background: linear-gradient(135deg, #6ea8ff, #9b7bff);
  color: #0b0e14; border-color: transparent;
  box-shadow: 0 0 10px rgba(110, 168, 255, 0.45);
}
.welcome-progress-step.done .welcome-progress-num {
  background: rgba(110, 168, 255, 0.20); color: #bcd8ff;
  border-color: rgba(110, 168, 255, 0.35);
}
.welcome-progress-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.welcome-progress-arrow { color: #5d6b84; font-size: 11px; flex-shrink: 0; }
.welcome-progress-advanced {
  width: 100%; margin-top: 5px; font-size: 9.5px; color: #7b87a3;
}
.deep-window-chat-add {
  border: 1px solid rgba(110, 168, 255, 0.38);
  background: linear-gradient(180deg, rgba(110, 168, 255, 0.18) 0%, rgba(110, 168, 255, 0.08) 100%);
  color: #dceaff; border-radius: 999px; padding: 4px 12px;
  font-size: 11px; font-weight: 650; cursor: pointer; font-family: inherit;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.10), 0 0 12px rgba(110, 168, 255, 0.18);
  transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1), background 0.3s, border-color 0.3s;
}
.deep-window-chat-add:hover {
  transform: translateY(-1px);
  background: linear-gradient(180deg, rgba(110, 168, 255, 0.28) 0%, rgba(110, 168, 255, 0.12) 100%);
  border-color: rgba(110, 168, 255, 0.6);
}
.deep-window-chat-add:disabled,
.deep-window-chat-add.added {
  opacity: 0.65; cursor: default; transform: none;
  background: rgba(110, 168, 255, 0.08); border-color: rgba(110, 168, 255, 0.18);
}
.deep-window.generating .deep-window-chat-add,
.deep-window.minimized .deep-window-chat-add { display: none; }
.chat-reminder-action {
  margin-left: auto; flex-shrink: 0;
  border: 1px solid rgba(110, 168, 255, 0.42);
  background: linear-gradient(180deg, rgba(110, 168, 255, 0.20) 0%, rgba(110, 168, 255, 0.08) 100%);
  color: #dceaff; border-radius: 999px; padding: 3px 10px;
  font-size: 10.5px; font-weight: 650; cursor: pointer; font-family: inherit;
}
.chat-reminder-action:hover {
  background: linear-gradient(180deg, rgba(110, 168, 255, 0.30) 0%, rgba(110, 168, 255, 0.12) 100%);
  border-color: rgba(110, 168, 255, 0.65);
}
.chat-memory-starter {
  margin: 0 0 8px; padding: 10px 12px;
  background: linear-gradient(180deg, rgba(155, 123, 255, 0.12) 0%, rgba(155, 123, 255, 0.05) 100%);
  border: 1px solid rgba(155, 123, 255, 0.30);
  border-radius: 12px; font-size: 11px; color: #e7e2ff; line-height: 1.5;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}
.chat-memory-starter-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
```

- [ ] **Step 2: 追加浅色主题覆盖（文件末尾继续追加）**

```css
body.dashboard-mode[data-dash-theme="light"] .welcome-progress {
  background: linear-gradient(180deg, rgba(76, 130, 205, 0.05) 0%, rgba(76, 130, 205, 0.02) 100%);
  border-color: rgba(26, 86, 168, 0.12);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
}
body.dashboard-mode[data-dash-theme="light"] .welcome-progress-step { color: #7a86a3; }
body.dashboard-mode[data-dash-theme="light"] .welcome-progress-step.active { color: #16294f; }
body.dashboard-mode[data-dash-theme="light"] .welcome-progress-step.done { color: #1a4fa0; }
body.dashboard-mode[data-dash-theme="light"] .welcome-progress-num {
  background: rgba(76, 130, 205, 0.10); color: #7a86a3;
  border-color: rgba(26, 86, 168, 0.16);
}
body.dashboard-mode[data-dash-theme="light"] .welcome-progress-arrow { color: #8da0c2; }
body.dashboard-mode[data-dash-theme="light"] .welcome-progress-advanced { color: #7a86a3; }
body.dashboard-mode[data-dash-theme="light"] .chat-reminder-action {
  background: linear-gradient(180deg, #ffffff 0%, #eaf2ff 100%);
  border-color: rgba(26, 86, 168, 0.28); color: #1a4fa0;
}
body.dashboard-mode[data-dash-theme="light"] .chat-memory-starter {
  background: linear-gradient(180deg, rgba(124, 92, 255, 0.08) 0%, rgba(124, 92, 255, 0.03) 100%);
  border-color: rgba(124, 92, 255, 0.24); color: #3c2f7d;
}
```

- [ ] **Step 3: 验证**

Run: `node --check public/app.js`（确保无 CSS 相关脚本引用错误；CSS 本身无编译步骤）
Expected: 退出码 0。

- [ ] **Step 4: 提交**

```bash
git add public/styles.css
git commit -m "Style flow onboarding UI / 添加流程引导界面样式"
```

---

### Task 7: CI、文档与全量验证

**Files:**
- Modify: `.github/workflows/ci.yml`、`docs/chatbot-feature-report.md`、`CLAUDE.md`

- [ ] **Step 1: CI 追加语法检查（`Check JavaScript syntax` run 块中 `tier2_recommendation_rules.js` 之后）**

```yaml
          node --check public/chatbot_welcome.js
          node --check public/onboarding_tour.js
```

- [ ] **Step 2: `docs/chatbot-feature-report.md` 追加新章节（文件末尾）**

```markdown
## 16. 新手流程引导（Flow Onboarding）

主路径：**Report Mode 提问 → 报告浮窗点「加入对话」→ 自动切到 Chat Mode → 直接对话**。

- 报告生成完成后，Deep Window 头部出现「加入对话」按钮：点击后报告自动加入记忆栏、自动切换到 Chat Mode，并在聊天区顶部注入引导消息（含 2 个示例 chips）。同一报告重复点击会变为「已加入」并禁用。
- 欢迎屏（`chatbot_welcome.js`）维护流程状态机 `noReport → reportReady → memoryReady → chatActive`，以 3 步进度条展示「① 在 Report 提问 → ② 点「加入对话」→ ③ 在 Chat 对话」，并在关键时刻就地提示：报告完成提示点「加入对话」；最小化后提示切 Chat Mode 拖入记忆栏；Chat Mode 空记忆时提醒卡片提供「去生成报告」按钮。
- 首次新手引导（`onboarding_tour.js`）为 5 步：布局介绍 → Report 提问 → 等待报告 → 点「加入对话」→ Chat 提问。最小化 + 拖拽保留为高级用法（见 Chat Mode 使用说明）。
```

- [ ] **Step 3: `CLAUDE.md` 的 `public/app.js` 导航索引表追加一行（表格末尾）**

```markdown
| 8902+ | **Flow onboarding** | `_switchToChatMode()`, `_switchToReportMode()`, `_addToChat()`, `_injectChatStarter()` — 一键「加入对话」与模式切换公共函数 |
```

- [ ] **Step 4: 全量回归（AGENTS.md 命令节）**

Run:
```bash
node --check public/auth.js
node --check public/app.js
node --check public/chatbot_i18n.js
node --check public/tier2_recommendation_rules.js
node --check public/chatbot_welcome.js
node --check public/onboarding_tour.js
python scripts/test_auth_helpers.py
node scripts/test_chatbot_intent_flow.mjs
node scripts/test_tier2_recommendation_rules.mjs
node scripts/test_sheet_categories.mjs
node scripts/test_category_drilldown.mjs
node scripts/test_tier_visual_status.mjs
node scripts/test_zh_chatbot.mjs
node scripts/test_onboarding_tour.mjs
node scripts/test_chatbot_welcome.mjs
python -m scripts.test_payment_placeholders
```
Expected: 全部 `PASS`，`node --check` 均无输出退出码 0。

- [ ] **Step 5: 手动验证清单（本地 `python server.py`，http://127.0.0.1:8765）**

1. 主路径：Report 提问（如 `Shokz`）→ 报告完成出现「加入对话」→ 点击 → 自动切 Chat + 引导消息 + 欢迎屏进度条完成 → 点 starter 示例提问；
2. 高级路径：最小化 → 切 Chat → 拖入记忆栏 → 进度条完成；
3. 空记忆 Chat：提醒卡片有「去生成报告」，点击切回 Report 并填入 `Shokz`；
4. 重复点击「加入对话」→ 按钮变「已加入」禁用；
5. 中英切换后新文案同步；首次进入 tour 为 5 步；重播正常；
6. 验证完成后关闭本地服务器（`netstat -ano | grep 8765` 后 `taskkill //F //PID <进程ID>`，或前台 `Ctrl+C`）。

- [ ] **Step 6: 提交**

```bash
git add .github/workflows/ci.yml docs/chatbot-feature-report.md CLAUDE.md
git commit -m "Update CI and docs for flow onboarding / 更新 CI 与文档以覆盖流程引导"
```

---

## Self-Review

- **Spec coverage:** §2 主/高级路径 → Task 4/5；§4 按钮与可见性 → Task 4；§5 状态机/进度条/就地提示 → Task 1/2/5；§6 Tour 5 步 → Task 3；§7 i18n → Task 1/3/4；§8 边界 → Task 2/4/5（重复加入、loading/error、幂等、语言跟随沿用现有 observer）；§9 测试与 CI → Task 1/2/3/7；§10 文件清单 → Task 1-7。
- **Placeholder scan:** 所有代码步骤均给出完整代码或精确插入位置；无 TBD/TODO。
- **Type consistency:** `flowStage` 返回 4 个字符串常量在 Task 1/2 一致；`notify("chat-add")`、`notify("panel-minimized")`、`notify("panel-expanded")` 事件名在 Task 2/4/5 一致；`panel._addedToMemory` 在 Task 4/5 一致；`window.CHATBOT_WELCOME.fillInput(text)` 在 Task 2/5 一致。
