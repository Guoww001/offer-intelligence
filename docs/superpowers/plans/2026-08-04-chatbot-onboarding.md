# Chatbot 新手引导（Onboarding Tour）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 首次进入 chatbot 时自动弹出交互式 5 步引导（遮罩 + 高亮 + 气泡），带新手完成"Report Mode 提问 → 浮窗生成 → 切 Chat Mode → 拖入记忆栏 → 对话"的完整核心流程。

**Architecture:** 新增独立文件 `public/onboarding_tour.js`（IIFE，挂 `window.ONBOARDING_TOUR`，零依赖），通过 DOM 选择器、localStorage、事件与 app.js 交互。app.js 仅两处侵入点：init() 尾部调 `maybeAutoStart()`、`_addMemoryFromPanel` 尾部调 `notify("memory-added")`。遮罩层由四块矩形 div 围出目标"开窗"（目标区域可点击，`mask:"pass"` 时全穿透）；引导层 z-index 高于所有 Deep Window 浮窗（`_deepMaxZIndex` 从 1000 递增）。

**Tech Stack:** 原生 JS（vanilla，无构建）、CSS、Node vm sandbox 测试（范式同 `scripts/test_merchant_monthly.mjs`）。

## Global Constraints

- **不读整个 public/app.js（约 19000 行 IIFE）**——只读/改本计划指定的行区间
- onboarding_tour.js 必须零依赖（不引库、不依赖 GSAP）、IIFE、导出 `window.ONBOARDING_TOUR`
- z-index 层级：遮罩 50000、高亮 50001、气泡 50002（高于 `_deepMaxZIndex` 起点 1000）
- localStorage 键固定为 `oi_onboarding_done`（"1" = 已完成/已跳过）
- 完成/跳过均写入 `oi_onboarding_done`，之后不再自动弹；Help 面板「🎓 新手引导」按钮可无条件重播
- 文案 zh/en 双语（`TOUR_COPY`），zh/en 键一一对应；语言读取顺序：`localStorage.getItem("offerLanguage")` → `document.documentElement.lang`
- `window.__OFFER_INTELLIGENCE_TEST__` 为真时（vm sandbox 测试）：不自动弹、不绑定重播按钮；测试通过 `window.ONBOARDING_TOUR` 直接驱动
- 测试范式：vm sandbox（同 `scripts/test_merchant_monthly.mjs`），数据驱动，不硬编码 Shokz 数值
- 完成后关闭本地服务器 http://127.0.0.1:8765/（`netstat -ano | grep 8765 | grep LISTEN` + `taskkill //F //PID <PID>`）

---

### Task 1: onboarding_tour.js 引导引擎 + 测试

**Files:**
- Create: `public/onboarding_tour.js`
- Create: `scripts/test_onboarding_tour.mjs`
- Modify: `.github/workflows/ci.yml`（"Run regression tests" 段内 `node scripts/test_merchant_monthly.mjs` 之后追加一行）
- Modify: `CLAUDE.md`（"Run tests" 段 `node scripts/test_merchant_monthly.mjs` 之后追加一行）

**Interfaces:**
- Consumes: 无（独立文件；运行时与 app.js 通过 DOM + 事件交互）
- Produces: `window.ONBOARDING_TOUR`，供 Task 2（HTML/CSS）与 Task 3（app.js 挂点）使用：
  - `maybeAutoStart()` — app.js init() 尾部调用；非测试模式 + 未完成标记时延迟 800ms 启动
  - `notify(eventName)` — app.js `_addMemoryFromPanel` 尾部调用；引导进行中且当前步骤 `autoNext === eventName` 时推进
  - `startTour()` / `stopTour()` / `skipTour()` / `finishTour()` / `isActive()`
  - `shouldShowTour(storage?)` / `markCompleted(storage?)` / `resetCompleted(storage?)` — storage 参数可注入（测试用）
  - `_test` 测试钩子：`steps`、`copy`、`currentLanguage`、`resolveTarget`、`isFinalStep`、`isAutoNextStep`、`currentStepIndex`、`stepCount`

- [ ] **Step 1: 写失败测试 `scripts/test_onboarding_tour.mjs`**

```js
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
function assertNotEqual(actual, expected, label) {
  if (actual === expected) throw new Error(`${label}: expected ${JSON.stringify(actual)} to differ from ${JSON.stringify(expected)}`);
}

const elementStub = {
  addEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  dataset: {}, appendChild() {}, querySelectorAll() { return []; },
  querySelector() { return null; }, setAttribute() {}, removeAttribute() {},
  style: {}, getBoundingClientRect() { return { left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 }; }
};

// 可控查询：selectorMap 供 querySelector，byIdMap 供 getElementById（动态 target 测试用）
const selectorMap = {
  "#chatInput": elementStub,
  ".deep-window": elementStub,
  '[data-mode="fast"]': elementStub,
  "#chatMemoryBar": elementStub
};
const byIdMap = {};
const sandbox = {
  console, Date, Math, Number, String, RegExp, Array, Object, Set, Map, JSON,
  setTimeout, clearTimeout,
  window: { __OFFER_INTELLIGENCE_TEST__: true, innerWidth: 1920, innerHeight: 1080 },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  document: {
    getElementById(id) { return byIdMap[id] || null; },
    querySelector(sel) { return selectorMap[sel] || null; },
    querySelectorAll() { return []; },
    createElement() { return { ...elementStub, innerHTML: "" }; },
    body: { appendChild() {}, removeChild() {} },
    documentElement: { lang: "zh-Hans" },
    readyState: "complete"
  },
  ResizeObserver: class { observe() {} disconnect() {} }
};
sandbox.window.document = sandbox.document;

runScript("public/onboarding_tour.js", sandbox);
const tour = sandbox.window.ONBOARDING_TOUR;
assertTruthy(tour, "onboarding_tour should expose window.ONBOARDING_TOUR");
const t = tour._test;

// ── 用例 1：步骤结构完整性 ──
assertEqual(t.stepCount(), 5, "should have exactly 5 steps");
const ids = t.steps.map((s) => s.id);
assertEqual(new Set(ids).size, ids.length, "step ids must be unique");
assertEqual(ids.join("|"), "report-ask|deep-window|switch-chat|drag-memory|chat-ask", "step ids order");
for (const s of t.steps) {
  assertTruthy(s.target, `step ${s.id} target must be a selector or function`);
  assertTruthy(s.copyKey, `step ${s.id} copyKey must be set`);
  assertEqual(["block", "pass"].includes(s.mask), true, `step ${s.id} mask must be block|pass`);
}
assertEqual(t.steps[3].autoNext, "memory-added", "drag-memory step should autoNext on memory-added");
assertEqual(t.steps.filter((s) => s.autoNext).length, 1, "only drag-memory should have autoNext");
assertEqual(t.steps[4].final, true, "chat-ask step should be final");
assertEqual(t.steps.filter((s) => s.final).length, 1, "only chat-ask should be final");
assertEqual(typeof t.steps[3].target, "function", "drag-memory target should be a dynamic function");
assertEqual(typeof t.resolveTarget(t.steps[0]), "object", "resolveTarget should resolve selector strings via document.querySelector");

// ── 用例 2：i18n 键集一致 ──
const zhKeys = Object.keys(t.copy.zh).sort();
const enKeys = Object.keys(t.copy.en).sort();
assertEqual(zhKeys.join("|"), enKeys.join("|"), "zh/en copy keys must match exactly");
for (const s of t.steps) {
  assertTruthy(t.copy.zh[s.copyKey + "Title"] !== undefined, `zh missing ${s.copyKey}Title`);
  assertTruthy(t.copy.zh[s.copyKey + "Body"] !== undefined, `zh missing ${s.copyKey}Body`);
  assertTruthy(t.copy.en[s.copyKey + "Title"] !== undefined, `en missing ${s.copyKey}Title`);
  assertTruthy(t.copy.en[s.copyKey + "Body"] !== undefined, `en missing ${s.copyKey}Body`);
}
assertTruthy(t.copy.zh.step4NeedSwitchBody, "zh missing step4NeedSwitchBody");
assertTruthy(t.copy.en.step4NeedSwitchBody, "en missing step4NeedSwitchBody");
assertEqual(t.currentLanguage(), "zh", "documentElement lang zh-Hans should resolve to zh");

// ── 用例 3：完成状态（localStorage 可注入）──
const memStorage = {};
assertEqual(tour.shouldShowTour({ getItem: () => null }), true, "no marker should show tour");
assertEqual(tour.shouldShowTour({ getItem: () => "1" }), false, "done marker should hide tour");
tour.markCompleted(memStorage);
assertEqual(memStorage["oi_onboarding_done"], "1", "markCompleted should write oi_onboarding_done");
assertEqual(tour.shouldShowTour({ getItem: (k) => memStorage[k] || null }), false, "after markCompleted shouldShowTour false");
tour.resetCompleted(memStorage);
assertEqual(memStorage["oi_onboarding_done"], undefined, "resetCompleted should remove marker");

// ── 用例 4：推进 / 回退 / 边界 ──
tour.startTour();
assertEqual(t.isActive(), true, "startTour should activate");
assertEqual(t.currentStepIndex(), 0, "startTour should begin at step 0");
tour.goBack();
assertEqual(t.currentStepIndex(), 0, "goBack at first step should stay");
tour.advance();
assertEqual(t.currentStepIndex(), 1, "advance should move to step 1");
tour.advance();
tour.advance();
assertEqual(t.currentStepIndex(), 3, "advance x3 should reach drag-memory");
tour.goBack();
assertEqual(t.currentStepIndex(), 2, "goBack should return to step 2");
tour.advance();
assertEqual(t.currentStepIndex(), 3, "advance should return to drag-memory");
assertEqual(t.isFinalStep(4), true, "index 4 should be final");
assertEqual(t.isFinalStep(3), false, "index 3 should not be final");

// ── 用例 5：autoNext 判定 ──
assertEqual(t.isAutoNextStep(3, "memory-added"), true, "step 3 should autoNext on memory-added");
assertEqual(t.isAutoNextStep(3, "other"), false, "step 3 should not autoNext on other events");
assertEqual(t.isAutoNextStep(0, "memory-added"), false, "step 0 should not autoNext");

// ── 用例 6：notify 推进 + 完成 ──
tour.notify("memory-added");
assertEqual(t.currentStepIndex(), 4, "notify memory-added should advance to final step");
tour.advance();
assertEqual(t.isActive(), false, "advance on final step should finish tour");
assertEqual(tour.shouldShowTour({ getItem: () => "1" }), false, "finished tour should stay hidden");

// ── 用例 7：skip ──
tour.startTour();
tour.skipTour();
assertEqual(t.isActive(), false, "skipTour should deactivate");

// ── 用例 8：测试模式不自动弹 ──
tour.maybeAutoStart();
assertEqual(t.isActive(), false, "maybeAutoStart should no-op in test mode");

// ── 用例 9：目标动态解析（drag-memory 记忆栏缺失时指向切换按钮）──
byIdMap["chatMemoryBar"] = null;                             // 记忆栏不存在 → 回退到切换按钮
assertTruthy(t.resolveTarget(t.steps[3]), "dynamic target should fall back to fast-mode button");
byIdMap["chatMemoryBar"] = elementStub;                      // 记忆栏存在（contains=false = 未隐藏）→ 指向记忆栏
assertEqual(t.resolveTarget(t.steps[3]) !== null, true, "dynamic target should point at memory bar when visible");
delete byIdMap["chatMemoryBar"];

console.log("PASS: onboarding tour logic");
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/test_onboarding_tour.mjs`
Expected: FAIL —— `Cannot find module ... onboarding_tour.js`（文件不存在）

- [ ] **Step 3: 实现 `public/onboarding_tour.js`**

```js
(function () {
  // ── Chatbot 新手引导（Onboarding Tour）────────────────────────────
  // 独立引导引擎：全屏遮罩（四块矩形围出目标开窗）+ 高亮圈 + 步骤气泡。
  // 零依赖，挂 window.ONBOARDING_TOUR。与 app.js 的交互点：
  //   1. app.js init() 尾部: window.ONBOARDING_TOUR.maybeAutoStart()
  //   2. app.js _addMemoryFromPanel() 尾部: window.ONBOARDING_TOUR.notify("memory-added")
  // 样式类 .onboarding-*（见 styles.css），z-index: 遮罩 50000 / 高亮 50001 / 气泡 50002，
  // 高于 Deep Window 浮窗（_deepMaxZIndex 从 1000 递增）。

  var DONE_KEY = "oi_onboarding_done";
  var TEST_MODE = !!(window.__OFFER_INTELLIGENCE_TEST__);

  // ── 双语文案（键集 zh/en 必须一一对应）──
  var TOUR_COPY = {
    zh: {
      welcomeTitle: "👋 欢迎使用 YeahPromos 助手",
      step1Title: "第 1 步：在 Report Mode 提问",
      step1Body: "在输入框输入商户名 / Merchant ID / ASIN 或品类，就能获取后台数据分析报告。试试看：",
      step2Title: "第 2 步：认识分析浮窗",
      step2Body: "分析报告在浮窗中打开。浮窗可以随意拖动，也能最小化，还支持一键导出 Excel。",
      step3Title: "第 3 步：切换到 Chat Mode",
      step3Body: "点击上方「Chat Mode」按钮，聊天区上方会出现记忆栏——这是把数据带进对话的入口。",
      step4Title: "第 4 步：把数据拖入记忆栏",
      step4Body: "先点击浮窗头部的「─」把它最小化，再把最小化后的面板拖入记忆栏，报告就会成为聊天上下文。",
      step4NeedSwitchBody: "记忆栏只在 Chat Mode 显示，请先点击上方「Chat Mode」按钮切换。",
      step5Title: "第 5 步：与 Chat Mode 对话",
      step5Body: "记忆栏里已经有刚才的报告了，现在可以自由提问。试试：",
      completeTitle: "🎉 完成！",
      completeBody: "你已经掌握了核心用法：Report Mode 获取数据 → 拖入记忆栏 → Chat Mode 对话。随时点击 Help 可重播本引导。",
      fillExample: "帮我填入示例",
      prev: "上一步",
      next: "下一步",
      skip: "跳过",
      finish: "完成 🎉",
      stepCounter: "第 {n} 步 / 共 {total} 步",
      waitReport: "等待报告生成…"
    },
    en: {
      welcomeTitle: "👋 Welcome to the YeahPromos Assistant",
      step1Title: "Step 1: Ask in Report Mode",
      step1Body: "Type a merchant name / ID / ASIN or category to get a data analysis report. Try it:",
      step2Title: "Step 2: Meet the report window",
      step2Body: "Reports open in a floating window you can drag around, minimize, or export to Excel.",
      step3Title: "Step 3: Switch to Chat Mode",
      step3Body: "Click the Chat Mode button above; a memory bar appears above the chat area — the way to bring data into the conversation.",
      step4Title: "Step 4: Drag data into the memory bar",
      step4Body: "Minimize the panel with the “–” button, then drag the minimized panel into the memory bar — the report becomes chat context.",
      step4NeedSwitchBody: "The memory bar only shows in Chat Mode — click the Chat Mode button above first.",
      step5Title: "Step 5: Chat with context",
      step5Body: "The report is now in your memory bar. Ask freely. Try:",
      completeTitle: "🎉 Done!",
      completeBody: "You've learned the core flow: get data in Report Mode → drag into memory → chat in Chat Mode. Click Help anytime to replay this guide.",
      fillExample: "Fill example for me",
      prev: "Back",
      next: "Next",
      skip: "Skip",
      finish: "Finish 🎉",
      stepCounter: "Step {n} of {total}",
      waitReport: "Waiting for the report…"
    }
  };

  // ── 步骤数据（纯数据；target 可为选择器字符串或返回选择器的函数）──
  var TOUR_STEPS = [
    {
      id: "report-ask",
      target: "#chatInput",
      copyKey: "step1",
      mask: "block",
      autoFill: "Shokz"
    },
    {
      id: "deep-window",
      target: ".deep-window",
      copyKey: "step2",
      mask: "block",
      appear: true
    },
    {
      id: "switch-chat",
      target: '[data-mode="fast"]',
      copyKey: "step3",
      mask: "block"
    },
    {
      id: "drag-memory",
      target: function () {
        var bar = document.getElementById("chatMemoryBar");
        return bar && bar.classList.contains("hidden") ? '[data-mode="fast"]' : "#chatMemoryBar";
      },
      copyKey: "step4",
      mask: "pass",
      autoNext: "memory-added"
    },
    {
      id: "chat-ask",
      target: "#chatInput",
      copyKey: "step5",
      mask: "block",
      autoFill: "根据刚才的报告，给我分析建议",
      final: true
    }
  ];

  // ── 状态 ──
  var _active = false;
  var _stepIndex = -1;
  var _maskEls = [];
  var _highlightEl = null;
  var _popoverEl = null;
  var _resizeObserver = null;
  var _targetEl = null;
  var _locateTimer = null;
  var _autoStartTimer = null;
  var _bodyKeyOverride = null;

  // ── 语言 ──
  function currentLanguage() {
    var stored = null;
    try { stored = localStorage.getItem("offerLanguage"); } catch (e) {}
    if (stored === "zh" || stored === "en") return stored;
    return (document.documentElement.lang || "en").indexOf("zh") === 0 ? "zh" : "en";
  }

  function copy(lang) { return TOUR_COPY[lang === "zh" ? "zh" : "en"]; }

  // ── 完成状态（storage 可注入以便测试）──
  function storageOf(storage) { return storage || (function () { try { return localStorage; } catch (e) { return null; } })(); }
  function shouldShowTour(storage) {
    var s = storageOf(storage);
    if (!s) return true;
    try { return !s.getItem(DONE_KEY); } catch (e) { return true; }
  }
  function markCompleted(storage) {
    var s = storageOf(storage);
    if (!s) return;
    try { s.setItem(DONE_KEY, "1"); } catch (e) {}
  }
  function resetCompleted(storage) {
    var s = storageOf(storage);
    if (!s) return;
    try { s.removeItem(DONE_KEY); } catch (e) {}
  }

  // ── 纯逻辑（可测试）──
  function resolveTarget(step) {
    var selector = typeof step.target === "function" ? step.target() : step.target;
    try { return document.querySelector(selector); } catch (e) { return null; }
  }
  function isFinalStep(index) { return !!TOUR_STEPS[index] && !!TOUR_STEPS[index].final; }
  function isAutoNextStep(index, eventName) {
    var step = TOUR_STEPS[index];
    return !!step && !!step.autoNext && step.autoNext === eventName;
  }
  function currentStepIndex() { return _stepIndex; }
  function stepCount() { return TOUR_STEPS.length; }
  function isActive() { return _active; }

  // ── DOM 层 ──
  function _ensureDom() {
    if (_maskEls.length) return;
    for (var i = 0; i < 4; i++) {
      var m = document.createElement("div");
      m.className = "onboarding-mask-piece";
      _maskEls.push(m);
      document.body.appendChild(m);
    }
    _highlightEl = document.createElement("div");
    _highlightEl.className = "onboarding-highlight";
    document.body.appendChild(_highlightEl);
    _popoverEl = document.createElement("div");
    _popoverEl.className = "onboarding-popover";
    document.body.appendChild(_popoverEl);
    _popoverEl.addEventListener("click", function (e) {
      var actionBtn = e.target.closest("[data-tour-action]");
      if (actionBtn) {
        var action = actionBtn.getAttribute("data-tour-action");
        if (action === "next") advance();
        else if (action === "prev") goBack();
        else if (action === "skip") skipTour();
        else if (action === "finish") finishTour();
        return;
      }
      var fillBtn = e.target.closest(".onboarding-fill-btn");
      if (fillBtn && TOUR_STEPS[_stepIndex] && TOUR_STEPS[_stepIndex].autoFill) {
        var input = document.querySelector("#chatInput");
        if (input) {
          input.value = TOUR_STEPS[_stepIndex].autoFill;
          input.focus();
        }
      }
    });
    _resizeObserver = new ResizeObserver(function () {
      if (_active && _targetEl) _reposition();
    });
  }

  function _positionMask(step, el) {
    var rect = el.getBoundingClientRect();
    if (step.mask === "pass") {
      for (var i = 0; i < 4; i++) _maskEls[i].style.display = "none";
      return;
    }
    var pad = 14;
    var left = Math.max(0, rect.left - pad);
    var top = Math.max(0, rect.top - pad);
    var right = Math.min(window.innerWidth, rect.right + pad);
    var bottom = Math.min(window.innerHeight, rect.bottom + pad);
    var pos = [
      { l: 0, t: 0, w: window.innerWidth, h: top },
      { l: 0, t: bottom, w: window.innerWidth, h: window.innerHeight - bottom },
      { l: 0, t: top, w: left, h: bottom - top },
      { l: right, t: top, w: window.innerWidth - right, h: bottom - top }
    ];
    for (var i = 0; i < 4; i++) {
      var p = pos[i];
      var m = _maskEls[i];
      m.style.display = p.w > 0 && p.h > 0 ? "block" : "none";
      m.style.left = p.l + "px";
      m.style.top = p.t + "px";
      m.style.width = p.w + "px";
      m.style.height = p.h + "px";
    }
  }

  function _positionHighlight(el) {
    var rect = el.getBoundingClientRect();
    _highlightEl.style.display = "block";
    _highlightEl.style.left = (rect.left - 6) + "px";
    _highlightEl.style.top = (rect.top - 6) + "px";
    _highlightEl.style.width = (rect.width + 12) + "px";
    _highlightEl.style.height = (rect.height + 12) + "px";
  }

  function _positionPopover(el) {
    var rect = el.getBoundingClientRect();
    var pw = 360;
    var left = Math.min(Math.max(12, rect.left + rect.width / 2 - pw / 2), window.innerWidth - pw - 12);
    var below = rect.bottom + 16;
    var above = Math.max(12, rect.top - 16 - 220);
    var top = below <= window.innerHeight - 240 ? below : above;
    _popoverEl.style.left = left + "px";
    _popoverEl.style.top = top + "px";
  }

  function _reposition() {
    if (!_targetEl) return;
    var step = TOUR_STEPS[_stepIndex];
    if (!step) return;
    _positionMask(step, _targetEl);
    _positionHighlight(_targetEl);
    _positionPopover(_targetEl);
  }

  function _renderPopoverContent(step, c) {
    var bodyKey = step.copyKey + "Body";
    if (_bodyKeyOverride) bodyKey = _bodyKeyOverride;
    var html = "";
    html += '<div class="onboarding-popover-title">' + c[step.copyKey + "Title"] + '</div>';
    html += '<div class="onboarding-popover-body">' + c[bodyKey] + '</div>';
    if (step.autoFill) {
      html += '<button class="onboarding-fill-btn" type="button">' + c.fillExample + '</button>';
    }
    html += '<div class="onboarding-step-counter">' +
      c.stepCounter.replace("{n}", String(_stepIndex + 1)).replace("{total}", String(TOUR_STEPS.length)) +
      '</div>';
    html += '<div class="onboarding-popover-actions">';
    if (_stepIndex > 0) {
      html += '<button class="onboarding-btn" data-tour-action="prev" type="button">' + c.prev + '</button>';
    }
    html += '<button class="onboarding-btn onboarding-btn-skip" data-tour-action="skip" type="button">' + c.skip + '</button>';
    html += '<button class="onboarding-btn onboarding-btn-primary" data-tour-action="' +
      (step.final ? "finish" : "next") + '" type="button">' + (step.final ? c.finish : c.next) + '</button>';
    html += '</div>';
    _popoverEl.innerHTML = html;
  }

  function _renderStep() {
    var step = TOUR_STEPS[_stepIndex];
    if (!step) { stopTour(); return; }
    var c = copy(currentLanguage());
    _bodyKeyOverride = null;
    if (step.id === "drag-memory") {
      var bar = null;
      try { bar = document.getElementById("chatMemoryBar"); } catch (e) {}
      if (bar && bar.classList.contains("hidden")) _bodyKeyOverride = "step4NeedSwitchBody";
    }
    _locateTarget(step, function (el) {
      if (!_active) return;
      _targetEl = el;
      _positionMask(step, el);
      _positionHighlight(el);
      _positionPopover(el);
      _renderPopoverContent(step, c);
      if (_resizeObserver) {
        try { _resizeObserver.disconnect(); } catch (e) {}
        try { _resizeObserver.observe(el); } catch (e) {}
      }
    });
  }

  // 目标定位：元素不存在时轮询（appear 步骤最长 15s，其余 3s），仍失败则跳过该步
  function _locateTarget(step, done) {
    var maxTries = step.appear ? 50 : 10;
    var tries = 0;
    var interval = 300;
    function probe() {
      var el = resolveTarget(step);
      if (el) { done(el); return; }
      tries++;
      if (tries >= maxTries) { advance(); return; } // 找不到 → 跳过
      _locateTimer = setTimeout(probe, interval);
    }
    probe();
  }

  // ── 公开推进 API ──
  function advance() {
    if (!_active) return;
    var step = TOUR_STEPS[_stepIndex];
    if (!step) return;
    if (step.final) { finishTour(); return; }
    if (_stepIndex < TOUR_STEPS.length - 1) {
      _stepIndex++;
      _renderStep();
    }
  }
  function goBack() {
    if (!_active) return;
    if (_stepIndex > 0) {
      _stepIndex--;
      _renderStep();
    }
  }
  function notify(eventName) {
    if (!_active) return;
    if (isAutoNextStep(_stepIndex, eventName)) advance();
  }

  function _clearTimers() {
    if (_locateTimer) { clearTimeout(_locateTimer); _locateTimer = null; }
    if (_autoStartTimer) { clearTimeout(_autoStartTimer); _autoStartTimer = null; }
  }

  function stopTour() {
    _active = false;
    _clearTimers();
    if (_resizeObserver) { try { _resizeObserver.disconnect(); } catch (e) {} _resizeObserver = null; }
    for (var i = 0; i < _maskEls.length; i++) {
      var m = _maskEls[i];
      if (m.parentNode) m.parentNode.removeChild(m);
    }
    _maskEls = [];
    if (_highlightEl && _highlightEl.parentNode) _highlightEl.parentNode.removeChild(_highlightEl);
    _highlightEl = null;
    if (_popoverEl && _popoverEl.parentNode) _popoverEl.parentNode.removeChild(_popoverEl);
    _popoverEl = null;
    _targetEl = null;
    _stepIndex = -1;
    _bodyKeyOverride = null;
  }
  function finishTour() { stopTour(); markCompleted(); }
  function skipTour() { markCompleted(); stopTour(); }

  function startTour() {
    if (_active) return;
    _active = true;
    _stepIndex = 0;
    _ensureDom();
    _renderStep();
  }

  // 首次进入自动弹（app.js init() 尾部调用）；完成/跳过过则不再弹
  function maybeAutoStart() {
    if (TEST_MODE) return;
    if (_active) return;
    if (!shouldShowTour()) return;
    _clearTimers();
    _autoStartTimer = setTimeout(function () {
      if (!_active && shouldShowTour()) startTour();
    }, 800);
  }

  // 重播入口（Help 面板工具栏「🎓 新手引导」按钮）
  function bindReplayButton() {
    if (TEST_MODE) return;
    var btn = document.getElementById("reportHelpTourBtn");
    if (btn) btn.addEventListener("click", startTour);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindReplayButton);
  } else {
    bindReplayButton();
  }

  window.ONBOARDING_TOUR = {
    startTour: startTour,
    stopTour: stopTour,
    skipTour: skipTour,
    finishTour: finishTour,
    notify: notify,
    maybeAutoStart: maybeAutoStart,
    shouldShowTour: shouldShowTour,
    markCompleted: markCompleted,
    resetCompleted: resetCompleted,
    isActive: isActive,
    _test: {
      steps: TOUR_STEPS,
      copy: TOUR_COPY,
      currentLanguage: currentLanguage,
      resolveTarget: resolveTarget,
      isFinalStep: isFinalStep,
      isAutoNextStep: isAutoNextStep,
      currentStepIndex: currentStepIndex,
      stepCount: stepCount
    }
  };
})();
```

注意：测试中调用了 `tour.advance()` / `tour.goBack()` / `tour.skipTour()` —— 这些在公开 API 里（Task 3 不需要它们，但保留供测试与重播按钮逻辑用）。

- [ ] **Step 4: 运行测试确认通过**

Run: `node scripts/test_onboarding_tour.mjs`
Expected: PASS —— `PASS: onboarding tour logic`

- [ ] **Step 5: 语法检查**

Run: `node --check public/onboarding_tour.js && node --check scripts/test_onboarding_tour.mjs`
Expected: 无输出（通过）

- [ ] **Step 6: CI 与 CLAUDE.md 接入**

`.github/workflows/ci.yml` —— "Run regression tests" 段，在 `node scripts/test_merchant_monthly.mjs` 行后追加：

```yaml
          node scripts/test_onboarding_tour.mjs
```

`CLAUDE.md` —— "Run tests" 段，在 `node scripts/test_merchant_monthly.mjs` 行后追加：

```bash
node scripts/test_onboarding_tour.mjs
```

- [ ] **Step 7: 提交**

```bash
git add public/onboarding_tour.js scripts/test_onboarding_tour.mjs .github/workflows/ci.yml CLAUDE.md
git commit -m "feat(chatbot): 新手引导引擎（5 步 Tour：Report 提问→浮窗→切 Chat→拖入记忆栏→对话）+ 测试"
```

---

### Task 2: index.html 引入 + Help 重播按钮 + styles.css 样式

**Files:**
- Modify: `public/index.html`（script 引入 + Help 工具栏按钮 + styles.css link 版本号）
- Modify: `public/styles.css`（末尾追加 .onboarding-* 样式）

**Interfaces:**
- Consumes: Task 1 的 `window.ONBOARDING_TOUR.startTour`（重播按钮点击回调）
- Produces: `#reportHelpTourBtn` 按钮（Task 1 的 `bindReplayButton` 会查找它）；`.onboarding-*` 样式类（Task 1 引擎创建的遮罩/高亮/气泡依赖）

- [ ] **Step 1: index.html 引入脚本**

在 `public/index.html` 第 1104 行 `<script src="./chatbot_i18n.js?v=20260626-zh1"></script>` 之后插入：

```html
    <script src="./onboarding_tour.js?v=20260804-onboarding1"></script>
```

并将第 10 行 stylesheet link 的版本号更新：

```html
    <link rel="stylesheet" href="./styles.css?v=20260804-onboarding1" />
```

- [ ] **Step 2: index.html 加重播按钮**

在 `public/index.html` 第 300 行 `<button class="report-help-lang-btn" id="reportHelpLangBtn" ...>English</button>` 之后追加：

```html
                <button class="report-help-lang-btn report-help-tour-btn" id="reportHelpTourBtn" type="button" aria-label="Start onboarding tour">🎓 新手引导</button>
```

- [ ] **Step 3: styles.css 追加引导样式**

在 `public/styles.css` **末尾**追加以下样式（深色主题适配，随 Dashboard 深浅主题均可用）：

```css
/* ── Chatbot 新手引导 Onboarding Tour（类名 .onboarding-*，z-index 高于 Deep Window 浮窗）── */
.onboarding-mask-piece {
  position: fixed;
  background: rgba(8, 10, 18, 0.62);
  z-index: 50000;
  pointer-events: auto;
  transition: opacity 0.18s ease;
}
.onboarding-highlight {
  position: fixed;
  z-index: 50001;
  pointer-events: none;
  border: 2px solid #6d8cff;
  border-radius: 12px;
  box-shadow: 0 0 0 4px rgba(109, 140, 255, 0.22), 0 0 28px rgba(109, 140, 255, 0.45);
  box-sizing: border-box;
  transition: left 0.18s ease, top 0.18s ease, width 0.18s ease, height 0.18s ease;
}
.onboarding-popover {
  position: fixed;
  z-index: 50002;
  width: 360px;
  max-width: calc(100vw - 24px);
  background: linear-gradient(160deg, #1e2436 0%, #171c2b 100%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  padding: 16px 18px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.5), 0 2px 10px rgba(0, 0, 0, 0.35);
  color: #e8ecf6;
  font-size: 13px;
  line-height: 1.55;
  box-sizing: border-box;
  animation: onboarding-fade-in 0.22s ease;
}
@keyframes onboarding-fade-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.onboarding-popover-title {
  font-size: 15px;
  font-weight: 600;
  color: #ffffff;
  margin-bottom: 6px;
}
.onboarding-popover-body {
  color: #c6cde0;
  margin-bottom: 10px;
}
.onboarding-fill-btn {
  display: block;
  width: 100%;
  padding: 8px 12px;
  margin-bottom: 10px;
  background: rgba(109, 140, 255, 0.14);
  border: 1px solid rgba(109, 140, 255, 0.45);
  border-radius: 8px;
  color: #b9c7ff;
  font-size: 12.5px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.onboarding-fill-btn:hover {
  background: rgba(109, 140, 255, 0.26);
}
.onboarding-step-counter {
  font-size: 11.5px;
  color: #7d869e;
  margin-bottom: 10px;
}
.onboarding-popover-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.onboarding-btn {
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: #d4daf0;
  font-size: 12.5px;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.onboarding-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}
.onboarding-btn-skip {
  margin-left: auto;
  color: #8b93ab;
}
.onboarding-btn-primary {
  background: linear-gradient(135deg, #6d8cff 0%, #8f6dff 100%);
  border: none;
  color: #ffffff;
  font-weight: 600;
}
.onboarding-btn-primary:hover {
  filter: brightness(1.1);
}
```

- [ ] **Step 4: 语法检查 + 本地起服验证**

Run: `node --check public/onboarding_tour.js && python server.py`（前台或后台均可）

打开 `http://127.0.0.1:8765/` 验证：
1. 首次进入 chatbot 页（清掉 localStorage `oi_onboarding_done`）→ 约 1s 后自动弹出引导气泡，指向输入框
2. 点「帮我填入示例」→ 输入框自动填入 `Shokz`
3. 气泡按钮上一步/下一步/跳过可用；遮罩开窗内输入框可点击输入
4. 完成引导后 `localStorage.oi_onboarding_done === "1"`，刷新不再自动弹
5. Help 面板（📖）工具栏出现「🎓 新手引导」按钮，点击可无条件重播
6. 完成验证后**务必关闭服务器**：

```bash
netstat -ano | grep 8765 | grep LISTEN
taskkill //F //PID <进程ID>
```

- [ ] **Step 5: 提交**

```bash
git add public/index.html public/styles.css
git commit -m "feat(chatbot): 新手引导接入页面（脚本引入 + Help 重播按钮 + .onboarding-* 样式）"
```

---

### Task 3: app.js 挂点（自动弹出 + 记忆拖入通知）+ 回归

**Files:**
- Modify: `public/app.js:19389`（init() 尾部，`DB_STATUS_AUTO_REFRESH_MS` setInterval 之后、`}` 之前，追加 maybeAutoStart 调用）
- Modify: `public/app.js:10281-10286`（`_addMemoryFromPanel` 尾部追加 notify 调用）
- Modify: `public/auth.js:2`（bump `APP_SCRIPT` 的 `?v=` 版本号，破 app.js 缓存）

**Interfaces:**
- Consumes: Task 1 的 `window.ONBOARDING_TOUR.maybeAutoStart()` 与 `.notify("memory-added")`；Task 2 已引入的脚本
- Produces: 无（最终集成）

- [ ] **Step 1: init() 尾部挂自动启动**

在 `public/app.js` 第 19389 行（`}, DB_STATUS_AUTO_REFRESH_MS);` 之后）追加：

```js
    // 新手引导：首次进入自动弹出（onboarding_tour.js，未完成过才弹）
    if (window.ONBOARDING_TOUR) {
      window.ONBOARDING_TOUR.maybeAutoStart();
    }
```

- [ ] **Step 2: _addMemoryFromPanel 尾部挂记忆通知**

在 `public/app.js` 第 10281-10286 行的 `_addMemoryFromPanel` 函数中，`_renderMemoryBar();` 之后追加：

```js
    // 新手引导：拖入记忆栏成功 → 通知引导引擎自动进入下一步
    if (window.ONBOARDING_TOUR) {
      window.ONBOARDING_TOUR.notify("memory-added");
    }
```

- [ ] **Step 3: bump app.js 版本号**

`public/auth.js` 第 2 行：`const APP_SCRIPT = "./app.js?v=20260803-loading-progress1";` → 改为 `const APP_SCRIPT = "./app.js?v=20260804-onboarding1";`

- [ ] **Step 4: 全量回归**

Run（同 CI，逐条执行）：

```bash
node --check public/auth.js
node --check public/app.js
node --check public/chatbot_i18n.js
node --check public/tier2_recommendation_rules.js
node --check public/onboarding_tour.js
python scripts/test_auth_helpers.py
node scripts/test_chatbot_intent_flow.mjs
node scripts/test_commission_all_aff.mjs
node scripts/test_merchant_monthly.mjs
node scripts/test_onboarding_tour.mjs
node scripts/test_tier2_recommendation_rules.mjs
node scripts/test_sheet_categories.mjs
node scripts/test_category_drilldown.mjs
node scripts/test_zh_chatbot.mjs
python -m scripts.test_payment_placeholders
python -m py_compile auth.py server.py offer_db.py api/auth/login.py api/auth/session.py api/auth/logout.py api/db/status.py api/db/merchant.py api/db/search.py scripts/validate_db_migration.py
```

Expected: 全部通过，无失败输出（`test_chatbot_intent_flow.mjs` 已知偶发挂起属既有 flake，与本次改动无关——见 memory `test-chatbot-flow-flaky-hang`）

- [ ] **Step 5: 手动端到端验证 + 关闭服务器**

`python server.py` 起服，打开 `http://127.0.0.1:8765/`：

1. 清 `oi_onboarding_done`，刷新 → 自动弹引导
2. 第 1 步「帮我填入示例」→ 输入框填入 `Shokz` → 回车 → 浮窗出现
3. 第 2 步：浮窗出现后自动跳到第 2 步（轮询 `.deep-window` 命中）
4. 第 3 步：点击「Chat Mode」按钮 → 记忆栏出现
5. 第 4 步：最小化浮窗（「─」）→ 拖入记忆栏 → **自动推进**到第 5 步（notify 生效）
6. 第 5 步：填入示例 → 完成 🎉 → localStorage 写入
7. 刷新页面 → 不再自动弹；Help 工具栏「🎓 新手引导」可重播
8. 中英语言切换后重播，文案跟随语言

**完成后务必关闭本地服务器：**

```bash
netstat -ano | grep 8765 | grep LISTEN
taskkill //F //PID <进程ID>
```

- [ ] **Step 6: 提交**

```bash
git add public/app.js public/auth.js
git commit -m "feat(chatbot): 新手引导挂点（init 自动弹出 + 记忆拖入 notify 自动推进）"
```
