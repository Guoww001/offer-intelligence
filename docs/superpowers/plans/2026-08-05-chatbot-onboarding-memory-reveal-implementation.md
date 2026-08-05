# Chatbot Onboarding Memory Reveal Implementation Plan / 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** 让新手引导在“加入对话”步骤中等待用户最小化 Deep Window，确认记忆栏显示刚加入的报告卡片后，才允许点击“下一步”进入 Chat Mode 引导。

**Architecture:** 保持正式引导步骤及业务流程不变，只在 `public/onboarding_tour.js` 的既有 `add-to-chat` 步骤内部增加三个阶段：`await-add`、`await-minimize`、`memory-revealed`。`chat-add` 事件只把高光转移到最新 Deep Window 的最小化按钮；通过现有 `MutationObserver` 监听 `.deep-window.minimized`，再把高光转移到 `#chatMemoryBar` 并开放 Next。新增 CSS 仅作用于引导期间临时添加的类，用一次性动效强调最新记忆卡片。

**Tech Stack:** Vanilla JavaScript IIFE、DOM `MutationObserver`、Node `vm` 沙箱测试、`node --check`、作用域限定的 CSS 动画。

## Global Constraints

- 不改变现有“加入对话”业务行为、记忆数据结构或 Chat Mode 注入逻辑。
- 正式引导步骤数量和 ID 必须保持不变：`intro|report-ask|deep-window|add-to-chat|chat-ask`。
- `TOUR_COPY.zh` 与 `TOUR_COPY.en` 的文案键必须一一对应。
- 只修改 `public/onboarding_tour.js`、`scripts/test_onboarding_tour.mjs` 和 `public/styles.css` 中与本功能直接相关的局部规则；不要覆盖工作区中已有的 `public/index.html`、缓存文件或其他 CSS 改动。
- `public/app.js` 已在加入对话后发出 `ONBOARDING_TOUR.notify("chat-add")`；不得为了本功能重复修改该业务路径。
- 最小化完成以当前最新 `.deep-window` 的 `classList.contains("minimized")` 为准；不要依赖新的业务事件或新的数据字段。
- 不创建 Git commit；执行计划时保留用户已有的未提交改动。

## 文件职责与接口

| 文件 | 职责 | 本计划中的接口 |
|---|---|---|
| `public/onboarding_tour.js` | 引导步骤、内部阶段、目标重定位、Popover 按钮状态和最小化观察 | `notify("chat-add")`、`notify("panel-minimized")`、`advance()`、`goBack()`、`_test.phase()`、`_test.canAdvance()` |
| `scripts/test_onboarding_tour.mjs` | 在无浏览器环境中验证步骤契约、阶段转换、双语文案和手动推进守卫 | 使用 `window.ONBOARDING_TOUR._test`，不依赖真实 DOM 或业务数据 |
| `public/styles.css` | 记忆栏和最新记忆卡片的一次性引导动效 | `.onboarding-memory-reveal`、`.onboarding-memory-chip-reveal` |

不新增文件，不修改 `public/app.js`、`public/chatbot_welcome.js`、`public/index.html` 或记忆数据生产逻辑。

## 阶段与事件契约

| 正式步骤 | 内部阶段 | 触发条件 | 高光目标 | Next 状态 |
|---|---|---|---|---|
| `add-to-chat`（索引 3） | `await-add` | 刚进入该步骤 | `.deep-window-chat-add` | 禁用，仅显示“点击加入对话”提示 |
| `add-to-chat`（索引 3） | `await-minimize` | `notify("chat-add")`，且当前仍是 `await-add` | 最新 `.deep-window` 内的 `.deep-window-minimize` | 禁用，仅显示“请先最小化”提示 |
| `add-to-chat`（索引 3） | `memory-revealed` | 最新 Deep Window 被观察到拥有 `minimized` 类，或测试直接调用 `notify("panel-minimized")` | `#chatMemoryBar` | 开放普通 Next |
| `chat-ask`（索引 4） | 无内部阶段 | 手动 Next 或最终 `sent` | 沿用现有逻辑 | 沿用现有逻辑 |

重复的 `chat-add`、`panel-minimized` 和最小化类变更必须幂等：不能跳过阶段、重复增加正式步骤或重复创建高光元素。回退到索引 3 时必须重新进入 `await-add`。

---

### Task 1: 为内部阶段补充失败测试

**Files:**
- Modify: `scripts/test_onboarding_tour.mjs:24-44, 80-105, 135-190, 218-265`
- Reference: `public/onboarding_tour.js` 的 `TOUR_STEPS`、`notify()`、`advance()` 和 `_test` 导出

**Interfaces:**
- Consumes: `window.ONBOARDING_TOUR._test.steps`、`copy`、`phase()`、`canAdvance()`、`currentStepIndex()`、`isAutoNextStep()`、`popoverHtml()`。
- Produces: 能在实现前失败、实现后通过的阶段转换回归测试；测试只通过公开测试辅助方法触发行为。

- [ ] **Step 1: 添加最小化按钮测试桩和阶段元数据断言**

在现有 `addToChatBtnStub` / `addToChatPanelStub` 后增加按钮桩，并把最小化按钮加入选择器映射：

```js
const addToChatBtnStub = { ...elementStub };
const addToChatPanelStub = { ...elementStub, querySelector() { return addToChatBtnStub; } };
const minimizeBtnStub = { ...elementStub };

const selectorMap = {
  "#chatInput": elementStub,
  ".deep-window": elementStub,
  '[data-mode="fast"]': elementStub,
  "#chatMemoryBar": elementStub,
  ".deep-window-minimize": minimizeBtnStub,
  "#chatModeToggle": elementStub
};
```

在原有步骤结构断言中，用下面的断言替换 `add-to-chat` 的 `autoNext: "chat-add"` 断言，并保留 5 步 ID 顺序断言：

```js
assertEqual(t.steps[3].autoNext, undefined, "add-to-chat should wait for the guided memory reveal");
assertEqual(t.steps[3].focusOn, "chat-add", "add-to-chat should react to chat-add as a focus transition");
assertEqual(t.steps[3].autoNextFocus, ".deep-window-minimize", "chat-add should focus the minimize button");
assertEqual(t.steps[3].nextPhaseOn, "panel-minimized", "add-to-chat should reveal memory after minimization");
assertEqual(t.steps.filter((s) => s.autoNext).length, 2, "2 steps should have autoNext (sent/sent)");
assertEqual(t.isAutoNextStep(3, "chat-add"), false, "add-to-chat should not autoNext on chat-add");
assertTruthy(t.copy.zh.step3MinimizeBody, "zh should explain minimizing the Deep Window");
assertTruthy(t.copy.en.step3MinimizeBody, "en should explain minimizing the Deep Window");
assertTruthy(t.copy.zh.step3MemoryBody, "zh should explain the memory card");
assertTruthy(t.copy.en.step3MemoryBody, "en should explain the memory card");
```

- [ ] **Step 2: 写入阶段转换、手动推进和幂等行为测试**

在最终 `console.log` 前加入以下测试块。它通过 `notify("panel-minimized")` 模拟 `MutationObserver` 的业务结果，使测试不依赖真实浏览器的异步 DOM 回调：

```js
queryAllMap[".deep-window"] = [
  {
    ...addToChatPanelStub,
    querySelector(sel) {
      if (sel === ".deep-window-chat-add") return addToChatBtnStub;
      if (sel === ".deep-window-minimize") return minimizeBtnStub;
      return null;
    }
  }
];

tour.startTour();
tour.advance();
tour.notify("sent");
tour.advance();
tour.advance();
assertEqual(t.currentStepIndex(), 3, "phase test should start on add-to-chat");
assertEqual(t.phase(), "await-add", "add-to-chat should start in await-add");
tour.advance();
assertEqual(t.currentStepIndex(), 3, "Next must be blocked before chat-add");

tour.notify("chat-add");
assertEqual(t.currentStepIndex(), 3, "chat-add must not advance to step 4");
assertEqual(t.phase(), "await-minimize", "chat-add should enter await-minimize phase");
assertMatch(t.popoverHtml(), /最小化|Minimize/, "popover should explain minimizing the window");
assertEqual(t.canAdvance(), false, "Next must stay unavailable before minimization");

tour.notify("chat-add");
assertEqual(t.phase(), "await-minimize", "duplicate chat-add must be idempotent");
tour.notify("panel-minimized");
assertEqual(t.phase(), "memory-revealed", "panel-minimized should reveal memory state");
assertEqual(t.canAdvance(), true, "Next should become available after memory reveal");
assertMatch(t.popoverHtml(), /下一步|Next/, "popover should offer Next after memory reveal");
tour.notify("panel-minimized");
assertEqual(t.phase(), "memory-revealed", "duplicate panel-minimized must be idempotent");

tour.advance();
assertEqual(t.currentStepIndex(), 4, "manual Next should enter the chat step");
tour.goBack();
assertEqual(t.currentStepIndex(), 3, "goBack should return to add-to-chat");
assertEqual(t.phase(), "await-add", "re-entering add-to-chat should reset the phase");
tour.stopTour();
delete queryAllMap[".deep-window"];
```

继续保留现有的中文/英文键集一致性、最终步骤完成、回退和动态目标测试；把所有原本“`chat-add` 直接到索引 4”的期望改为“停留在索引 3 → `panel-minimized` → 手动 Next 到索引 4”。

- [ ] **Step 3: 运行聚焦测试，确认它按预期失败**

Run:

```bash
node scripts/test_onboarding_tour.mjs
```

Expected: FAIL，错误应来自 `autoNext` 仍为 `"chat-add"`、`phase()` / `canAdvance()` 尚未导出，或阶段转换仍未实现；不能因为测试文件语法错误而失败。

---

### Task 2: 实现 `add-to-chat` 的三阶段引导状态机

**Files:**
- Modify: `public/onboarding_tour.js:14-150, 353-475, 478-575, 620-690`
- Reference: `public/app.js:9817-9824, 10646-10656`（最小化类变更和 `chat-add` 事件，不修改）

**Interfaces:**
- Consumes: 现有 `TOUR_STEPS`、`notify()`、`_renderStep()`、`_renderPopoverContent()`、`_retarget()` 和 body class `MutationObserver`。
- Produces: `_tourPhase` 内部状态、只读测试辅助 `phase()` / `canAdvance()`、最小化后的记忆栏高光和受守卫保护的 `advance()`。

- [ ] **Step 1: 增加双语阶段文案并修改步骤元数据**

在 `TOUR_COPY.zh` 和 `TOUR_COPY.en` 中各增加完全相同的三个键。中文使用：

```js
step3MinimizeBody: "先将 Deep Window 最小化，避免挡住记忆栏。点击窗口顶部的「─」按钮。",
step3MinimizeHint: "请先最小化 Deep Window",
step3MemoryBody: "记忆栏已经显示刚加入的记忆卡片。看清这个效果后，点击「下一步」进入 Chat Mode。",
step3MemoryNext: "下一步"
```

英文使用：

```js
step3MinimizeBody: "First minimize the Deep Window so it does not cover the memory bar. Click the “─” button in the window header.",
step3MinimizeHint: "Minimize the Deep Window first",
step3MemoryBody: "The memory bar now shows the report memory card. After seeing it, click Next to continue to Chat Mode.",
step3MemoryNext: "Next"
```

把 `add-to-chat` 步骤的 `autoNext: "chat-add"` 替换为：

```js
focusOn: "chat-add",
autoNextFocus: ".deep-window-minimize",
nextPhaseOn: "panel-minimized"
```

`step3Body`、正式步骤 ID、`chat-ask` 的最终行为均保持不变。

- [ ] **Step 2: 增加阶段状态、进入/离开重置逻辑和测试接口**

在 `_stepIndex` 附近添加状态和定时器：

```js
var _stepIndex = -1;
var _tourPhase = null;
var _memoryRevealTimer = null;
```

添加下面的纯逻辑函数。`add-to-chat` 重渲染时保留合法阶段，首次进入或从其他步骤返回时重置为 `await-add`；其他正式步骤不保留内部阶段：

```js
function phase() { return _tourPhase; }
function canAdvance() {
  return _stepIndex !== 3 || _tourPhase === "memory-revealed";
}
function _syncStepPhase(step) {
  if (step && step.id === "add-to-chat") {
    if (_tourPhase !== "await-add" &&
        _tourPhase !== "await-minimize" &&
        _tourPhase !== "memory-revealed") {
      _tourPhase = "await-add";
    }
  } else {
    _tourPhase = null;
  }
}
```

在 `_renderStep()` 获取 `step` 后调用 `_syncStepPhase(step)`，并在清理 `_bodyKeyOverride` 后按阶段恢复文案覆盖，避免中英文切换时阶段说明丢失：

```js
_syncStepPhase(step);
_bodyKeyOverride = null;
if (step.id === "add-to-chat") {
  if (_tourPhase === "await-minimize") _bodyKeyOverride = "step3MinimizeBody";
  if (_tourPhase === "memory-revealed") _bodyKeyOverride = "step3MemoryBody";
}
```

在 `advance()` 离开索引 3 前将 `_tourPhase` 清为 `null`；在 `goBack()` 离开索引 3 前同样清空；`_clearTimers()` 清理 `_memoryRevealTimer`，`stopTour()` 额外把 `_tourPhase` 清为 `null`。这样回退重新进入索引 3 时一定得到 `await-add`，不会复用旧的 `memory-revealed`。

在 `window.ONBOARDING_TOUR._test` 中导出：

```js
phase: phase,
canAdvance: canAdvance,
```

- [ ] **Step 3: 让最小化按钮高光始终命中最新面板**

在 `_retargetTo(el)` 解析 `_focusSelector` 的分支中，为 `.deep-window-minimize` 使用最新 `.deep-window` 的子查询，替换直接 `document.querySelector(_focusSelector)` 的单一查询：

```js
if (!el) {
  try {
    if (_focusSelector === ".deep-window-minimize") {
      var panels = document.querySelectorAll(".deep-window");
      var lastPanel = panels && panels.length ? panels[panels.length - 1] : null;
      el = lastPanel && lastPanel.querySelector ? lastPanel.querySelector(_focusSelector) : null;
    } else {
      el = document.querySelector(_focusSelector);
    }
  } catch (e) {}
}
```

保留 `_retarget()` 现有的遮罩、高亮、Popover 和 ResizeObserver 更新逻辑；不能改变 `resolveTarget(step)` 对正式步骤目标的动态解析规则。

- [ ] **Step 4: 添加短重定位和记忆栏揭示 helper**

在 `_renderPopoverContent()` 前添加下面两个函数。`_queueRetarget()` 用已有的 `_focusTimer` 做最多 4 次、每次 120ms 的短重试；`_revealMemoryPhase()` 在阶段仍为 `await-minimize` 时才生效，因而重复事件安全：

```js
function _queueRetarget() {
  _retarget();
  var retryCount = 0;
  (function retryFocus() {
    if (!_active) return;
    if (retryCount++ >= 4) return;
    _retarget();
    _focusTimer = setTimeout(retryFocus, 120);
  })();
}

function _revealMemoryPhase() {
  if (!_active || _stepIndex !== 3 || _tourPhase !== "await-minimize") return;
  _tourPhase = "memory-revealed";
  _focusSelector = "#chatMemoryBar";
  _bodyKeyOverride = "step3MemoryBody";

  var bar = null;
  var chip = null;
  try {
    bar = document.querySelector("#chatMemoryBar");
    if (bar && bar.classList) bar.classList.add("onboarding-memory-reveal");
    if (bar && bar.querySelector) {
      chip = bar.querySelector(".chat-memory-chip:last-child");
      if (chip && chip.classList) chip.classList.add("onboarding-memory-chip-reveal");
    }
  } catch (e) {}

  if (_memoryRevealTimer) clearTimeout(_memoryRevealTimer);
  if (bar || chip) {
    _memoryRevealTimer = setTimeout(function () {
      _memoryRevealTimer = null;
      try {
        if (bar && bar.classList) bar.classList.remove("onboarding-memory-reveal");
        if (chip && chip.classList) chip.classList.remove("onboarding-memory-chip-reveal");
      } catch (e) {}
    }, 1800);
  }
  _queueRetarget();
  _refreshActionButtons();
}
```

如果 Chat Mode 布局尚未挂载 `#chatMemoryBar`，阶段仍应变为 `memory-revealed`，但通过 `_queueRetarget()` 等待目标出现；不得阻塞 Next 或改变记忆数据。

- [ ] **Step 5: 在 `notify()` 中实现两个阶段转换**

在既有通用 `isAutoNext` / `isFocusEvent` 判断之前加入：

```js
if (_stepIndex === 3 && eventName === "chat-add") {
  if (_tourPhase !== "await-add") return;
  _tourPhase = "await-minimize";
  _focusSelector = step.autoNextFocus;
  _bodyKeyOverride = "step3MinimizeBody";
  _queueRetarget();
  _refreshActionButtons();
  return;
}
if (_stepIndex === 3 && eventName === step.nextPhaseOn) {
  _revealMemoryPhase();
  return;
}
```

第一段保持正式步骤索引为 3，不调用 `advance()`；第二段既支持测试直接调用 `notify("panel-minimized")`，也让 observer 复用同一个 helper。不要让通用 `autoNext` 分支再次处理 `chat-add`。

- [ ] **Step 6: 让 MutationObserver 监听最小化并切换记忆栏高光**

在现有 body class observer 确认 mutation target 是当前 `.deep-window` 后，先确认它是页面中最新的面板，再优先加入：

```js
var panels = document.querySelectorAll(".deep-window");
var latestPanel = panels && panels.length ? panels[panels.length - 1] : null;
if (t === latestPanel && _stepIndex === 3 && _tourPhase === "await-minimize" &&
    t.classList && t.classList.contains("minimized")) {
    _revealMemoryPhase();
    return;
}
```

保留原有 `requireMinimized` 按钮刷新和 `_focusSelector` 重定位逻辑，且只在上述阶段条件满足时调用揭示 helper。由于 helper 会检查 `_tourPhase`，最小化动画产生多次 class mutation 时不会重复播放逻辑或重复计时器。

- [ ] **Step 7: 保护手动 Next 并渲染阶段对应的按钮**

在 `advance()` 最前面、现有 `requireMinimized` 守卫之前加入：

```js
if (_stepIndex === 3 && _tourPhase !== "memory-revealed") return;
```

在 `_renderPopoverContent()` 中把原有的 `if (step.autoNext) ... else if ...` 分支替换为：

```js
if (step.id === "add-to-chat" && _tourPhase !== "memory-revealed") {
  var phaseHint = _tourPhase === "await-minimize" ? c.step3MinimizeHint : c.step3NextHint;
  html += '<button class="onboarding-btn onboarding-btn-primary onboarding-btn-hint" type="button" disabled>' +
    phaseHint + '</button>';
} else if (step.autoNext) {
  var hintKey = step.copyKey + "NextHint";
  if (c[hintKey]) {
    html += '<button class="onboarding-btn onboarding-btn-primary onboarding-btn-hint" type="button" disabled>' +
      c[hintKey] + '</button>';
  }
} else if (step.requireMinimized && !minimizeGatePassed()) {
  html += '<button class="onboarding-btn onboarding-btn-primary onboarding-btn-hint" type="button" disabled>' +
    c.minimizeRequired + '</button>';
} else {
  var nextLabel = step.id === "add-to-chat" && c.step3MemoryNext ? c.step3MemoryNext :
    (step.final ? c.finish : c.next);
  html += '<button class="onboarding-btn onboarding-btn-primary" data-tour-action="' +
    (step.final ? "finish" : "next") + '" type="button">' + nextLabel + '</button>';
}
```

`await-add` 和 `await-minimize` 必须没有 `data-tour-action="next"`；只有 `memory-revealed` 才显示可点击的 Next。现有最终步骤 `chat-ask` 的 Finish、Skip 和语言切换行为保持不变。

- [ ] **Step 8: 运行实现后的聚焦验证**

Run:

```bash
node --check public/onboarding_tour.js
node scripts/test_onboarding_tour.mjs
```

Expected: 两条命令均退出码 0，测试输出 `PASS: onboarding tour logic`，且测试覆盖正式步骤仍为 5 步、双语键集一致、重复 `chat-add` 不推进、最小化前 Next 被阻止、记忆揭示后 Next 可用。

---

### Task 3: 添加记忆栏一次性揭示动效

**Files:**
- Modify: `public/styles.css`，在现有 `.onboarding-*` 区块（`HEAD` 约 13725 行，当前工作区约 13870 行）中 `.onboarding-dropzone-*` 规则之后、`.welcome-*` 区块之前插入

**Interfaces:**
- Consumes: Task 2 在 `#chatMemoryBar` 和最后一个 `.chat-memory-chip` 上添加的两个类。
- Produces: 不改变基础记忆栏外观的 1.8 秒提示；用户偏好减少动效时改为静态轮廓。

- [ ] **Step 1: 添加局部 keyframes 和 reduced-motion 回退**

插入以下完整 CSS；不要修改同一区块已有的 `.onboarding-highlight`、`.onboarding-dropzone-*` 或 `.welcome-*` 规则：

```css
.onboarding-memory-reveal {
  animation: onboarding-memory-bar-pulse 1.8s ease-out;
}
.onboarding-memory-chip-reveal {
  animation: onboarding-memory-chip-in 0.75s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes onboarding-memory-bar-pulse {
  0%, 100% { box-shadow: inherit; }
  35% { box-shadow: 0 0 0 4px rgba(110, 168, 255, 0.28), 0 0 24px rgba(110, 168, 255, 0.32); }
}
@keyframes onboarding-memory-chip-in {
  0% { transform: translateY(6px) scale(0.94); opacity: 0.35; }
  65% { transform: translateY(-2px) scale(1.04); opacity: 1; }
  100% { transform: translateY(0) scale(1); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .onboarding-memory-reveal,
  .onboarding-memory-chip-reveal {
    animation: none;
    outline: 2px solid rgba(110, 168, 255, 0.65);
  }
}
```

- [ ] **Step 2: 验证 CSS 接入不会影响脚本和引导测试**

Run:

```bash
node --check public/onboarding_tour.js
node scripts/test_onboarding_tour.mjs
git diff --check -- public/onboarding_tour.js public/styles.css scripts/test_onboarding_tour.mjs
```

Expected: 两个 Node 命令退出码为 0；`git diff --check` 不输出空白错误。CSS 无独立编译步骤，类名必须与 Task 2 的字符串完全一致。

---

### Task 4: 执行回归检查并核对工作区边界

**Files:**
- Test only: `public/onboarding_tour.js`、`public/styles.css`、`scripts/test_onboarding_tour.mjs` 及项目既有聊天机器人回归测试

**Interfaces:**
- Consumes: Tasks 1–3 的实现和测试。
- Produces: 可复现的验证证据、只包含本功能目标文件的最终差异检查；不产生 commit、不启动本地服务器。

- [ ] **Step 1: 运行本功能和相邻 Chatbot 测试**

Run:

```bash
node --check public/onboarding_tour.js
node --check public/chatbot_welcome.js
node --check public/app.js
node scripts/test_onboarding_tour.mjs
node scripts/test_chatbot_welcome.mjs
node scripts/test_chatbot_intent_flow.mjs
node scripts/test_zh_chatbot.mjs
```

Expected: 所有 `node --check` 无输出并退出码为 0；所有测试输出各自的 `PASS` 标记。`chatbot_welcome.js` 和 `app.js` 只做回归检查，不应出现为本功能新增的差异。

- [ ] **Step 2: 运行仓库 AGENTS.md 要求的其余静态检查**

Run:

```bash
node --check public/auth.js
node --check public/chatbot_i18n.js
node --check public/tier2_recommendation_rules.js
python scripts/test_auth_helpers.py
node scripts/test_tier2_recommendation_rules.mjs
node scripts/test_sheet_categories.mjs
node scripts/test_category_drilldown.mjs
node scripts/test_tier_visual_status.mjs
python -m scripts.test_payment_placeholders
python -m py_compile auth.py server.py offer_db.py api/auth/login.py api/auth/session.py api/auth/logout.py api/db/status.py api/db/merchant.py api/db/search.py scripts/validate_db_migration.py
```

Expected: 所有命令退出码为 0；任何与本功能无关的既有失败都必须在交付时明确列出，不能把失败声称为通过。

- [ ] **Step 3: 检查目标差异并保留用户已有改动**

Run:

```bash
git diff -- public/onboarding_tour.js public/styles.css scripts/test_onboarding_tour.mjs
git diff --check -- public/onboarding_tour.js public/styles.css scripts/test_onboarding_tour.mjs
git status --short
```

Expected: 目标文件的差异只包含阶段状态机、阶段测试和记忆揭示样式；`protected_data/*`、`public/index.html` 以及 CSS 中用户原有的其他主题改动保持原样。不得执行 `git reset --hard`、`git checkout --` 或任何会覆盖用户改动的操作。

- [ ] **Step 4: 按验收条件报告结果，不提交代码**

确认以下行为后报告精确命令和退出结果：

```text
1. 引导仍显示 5 个正式步骤，ID 顺序未变。
2. 点击“加入对话”后仍停留在第 3 步，高光转移到最新 Deep Window 的“─”按钮。
3. 最小化前点击 Next 不会推进；重复点击“加入对话”不会改变阶段。
4. 最小化完成后高光转移到 #chatMemoryBar，最新记忆卡片获得一次性提示，Next 才可用。
5. Next 进入原有 Chat Mode 第 4 步；最终发送、跳过、回退和中英切换行为未回归。
6. 未创建 Git commit，也未让本地服务器在任务结束后继续运行。
```

## 自检

- **需求覆盖：** 设计文档的步骤数量与 ID 由 Task 1/2 覆盖；三阶段与事件顺序由 Task 1/2 覆盖；高光重定位与缺失 DOM 短重试由 Task 2 覆盖；双语键集由 Task 1/2 覆盖；一次性记忆栏动效和 reduced-motion 由 Task 3 覆盖；回归、差异边界和不提交约束由 Task 4 覆盖。
- **占位符扫描：** 未发现未定义步骤或待补充内容；每个代码变更步骤都给出了目标文件、插入位置、接口或完整代码片段。
- **接口一致性：** `focusOn: "chat-add"`、`nextPhaseOn: "panel-minimized"`、`_tourPhase` 的三个字符串、`phase()`、`canAdvance()`、`.onboarding-memory-reveal` 和 `.onboarding-memory-chip-reveal` 在任务之间保持同名；正式步骤索引 3 和 4 与测试断言一致。
