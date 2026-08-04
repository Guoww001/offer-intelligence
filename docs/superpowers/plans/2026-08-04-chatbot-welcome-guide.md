# Chatbot 欢迎屏（Welcome Guide）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用欢迎屏（Empty State）取代 chatbot 的英文日志式欢迎消息——双栏工作台布局 + 点击即填的示例问题 + 贯穿"获取→分析"流程的提示条，让新用户打开即知能问什么、怎么问、下一步做什么。

**Architecture:** 新文件 `public/chatbot_welcome.js`（IIFE 零依赖，暴露 `window.CHATBOT_WELCOME`，范式同 onboarding_tour.js）。引擎分四层：数据层（示例/文案/语言/动态商户名）→ 决策层（纯函数判定）→ DOM 渲染层（欢迎屏 + tipbar + 面板提示条）→ 状态机层（notify 事件）。app.js 只加 6 处最小挂点调用，不动既有逻辑。

**Tech Stack:** 原生 JS（IIFE + vm sandbox 测试）、CSS（Ethereal Glass 深色玻璃拟态）、Node 脚本测试。

## Global Constraints

- 引擎零依赖 IIFE，暴露 `window.CHATBOT_WELCOME`，内部测试接口走 `_test`（同 `onboarding_tour.js` 范式）
- `WELCOME_COPY` zh/en 键集必须一一对应（测试强制）
- `window.__OFFER_INTELLIGENCE_TEST__` 为真时 `maybeRender` 不渲染 DOM（只返回判定）
- 所有 DOM 副作用包 `try { } catch (e) {}` 防御（同 onboarding_tour.js 风格）
- 动态商户名：取 offers 中 commission 最高的商户，取不到降级固定示例 `Shokz`
- 新样式类统一 `.welcome-*` 前缀；视觉基调 Ethereal Glass（复用 `.onboarding-*` 的色板：hairline `rgba(255,255,255,0.09)`、面板渐变 `rgba(30,37,62,0.88)→rgba(16,20,36,0.86)`、accent `#6ea8ff`、紫 `#9b7bff`）
- app.js 挂点只新增调用行，不改动既有逻辑；改 app.js 后必须 bump `public/auth.js:2` 的 `APP_SCRIPT` 版本号
- 每任务独立提交，消息前缀：`feat(chatbot)` / `test(chatbot)` / `style(chatbot)` / `docs(chatbot)`
- 测试范式：vm sandbox（`scripts/test_chatbot_welcome.mjs`，仿 `scripts/test_onboarding_tour.mjs`）

---

### Task 1: 引擎数据层——示例数据 + 双语文案 + 语言读取 + 动态商户名

**Files:**
- Create: `public/chatbot_welcome.js`
- Create: `scripts/test_chatbot_welcome.mjs`

**Interfaces:**
- Produces:
  - `WELCOME_EXAMPLES = { report: [...4 个], chat: [...3 个] }`（`{ text, dynamic? }`）
  - `WELCOME_COPY = { zh: {...}, en: {...} }`
  - `currentLanguage()` → `"zh" | "en"`（优先 `localStorage.offerLanguage`，兜底 `document.documentElement.lang` 以 "zh" 开头 → zh，否则 en）
  - `merchantForExample(offers)` → 商户名字符串或 `null`
  - `window.CHATBOT_WELCOME` 骨架（`maybeRender`/`notify`/`dismiss`/`isRendered` 占位 + `_test`）

- [ ] **Step 1: 写失败测试**（`scripts/test_chatbot_welcome.mjs` 完整创建）

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

const elementStub = {
  nodeType: 1,
  addEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  dataset: {}, appendChild() {}, removeChild() {}, insertBefore() {},
  querySelectorAll() { return []; }, querySelector() { return null; },
  setAttribute() {}, removeAttribute() {}, style: {}, innerHTML: "",
  getBoundingClientRect() { return { left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 }; }
};
const byIdMap = {};
const sandbox = {
  console, Date, Math, Number, String, RegExp, Array, Object, Set, Map, JSON,
  setTimeout, clearTimeout,
  window: { __OFFER_INTELLIGENCE_TEST__: true },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  document: {
    getElementById(id) { return byIdMap[id] || null; },
    querySelector(sel) { return null; },
    querySelectorAll(sel) { return []; },
    createElement() { return { ...elementStub }; },
    body: { appendChild() {}, removeChild() {} },
    documentElement: { lang: "zh-Hans" },
    readyState: "complete",
    addEventListener() {}, removeEventListener() {}
  },
  MutationObserver: class { observe() {} disconnect() {} }
};
sandbox.window.document = sandbox.document;

runScript("public/chatbot_welcome.js", sandbox);
const welcome = sandbox.window.CHATBOT_WELCOME;
assertTruthy(welcome, "chatbot_welcome should expose window.CHATBOT_WELCOME");
const t = welcome._test;

// ── 用例 1：示例数据结构 ──
assertEqual(t.examples.report.length, 4, "report examples should be 4");
assertEqual(t.examples.chat.length, 3, "chat examples should be 3");
assertEqual(t.examples.report[0].text, "查一下 {merchant} 这个月表现", "first report example should be the dynamic merchant query");
assertEqual(t.examples.report[0].dynamic, "merchant", "first report example should be dynamic");
assertEqual(t.examples.report[1].text, "这个月有哪些商户逾期？", "overdue example should use single status");
for (const ex of [...t.examples.report, ...t.examples.chat]) {
  assertTruthy(ex.text, "example text must be non-empty");
}
assertEqual(t.examples.chat[0].text, "根据记忆栏的报告，给我分析建议", "first chat example should reference memory bar");
assertEqual(t.examples.chat[0].dynamic, undefined, "chat examples must NOT be dynamic");

// ── 用例 2：文案键集 zh/en 一致 ──
const zhKeys = Object.keys(t.copy.zh).sort();
const enKeys = Object.keys(t.copy.en).sort();
assertEqual(enKeys.join("|"), zhKeys.join("|"), "zh/en copy keys must match exactly");

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

// ── 用例 4：语言读取 ──
assertEqual(t.currentLanguage(), "zh", "html lang zh-Hans -> zh");
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/test_chatbot_welcome.mjs`
Expected: FAIL（`public/chatbot_welcome.js` 不存在 / `window.CHATBOT_WELCOME` undefined）

- [ ] **Step 3: 实现引擎数据层**（`public/chatbot_welcome.js`）

```js
(function () {
  // ── Chatbot 欢迎屏（Welcome Guide）────────────────────────────
  // 空聊天区的能力地图 + 流程示意 + 示例问题：双栏工作台布局（左「① 先获取数据」/
  // 右「③ 再深度分析」），示例点击即填 + 提示条贯穿「获取→分析」流程。
  // 零依赖，挂 window.CHATBOT_WELCOME。与 app.js 的交互点：
  //   1. init 尾部: window.CHATBOT_WELCOME.maybeRender("report", { offers })
  //   2. chatForm submit: window.CHATBOT_WELCOME.notify("chat-sent")
  //   3. 模式切换: window.CHATBOT_WELCOME.notify("mode-switched", { mode, hasMemory })
  //   4. _renderPanelReport 尾部: window.CHATBOT_WELCOME.notify("report-ready", { panelEl })
  //   5. _addMemoryFromPanel 尾部: window.CHATBOT_WELCOME.notify("memory-added", { hasMemory: true })
  // 样式类 .welcome-*（见 styles.css）。

  var TEST_MODE = !!(window.__OFFER_INTELLIGENCE_TEST__);
  var FALLBACK_MERCHANT = "Shokz";

  // ── 双语文案（键集 zh/en 必须一一对应）──
  var WELCOME_COPY = {
    zh: {
      helloTitle: "我是你的运营分析助手",
      helloBody: "查商户、看风险、找机会、出建议 —— 先从左边获取数据，再拖入记忆栏到右边深度分析",
      flow1Title: "Report 提问",
      flow1Sub: "获取数据",
      flow2Title: "面板最小化",
      flow2Sub: "拖入记忆栏",
      flow3Title: "Chat 对话",
      flow3Sub: "深度分析",
      colLeftTitle: "① 先获取数据",
      colLeftTag: "REPORT",
      colRightTitle: "③ 再深度分析",
      colRightTag: "CHAT",
      colRightNote: "需先拖入记忆栏",
      tipReport: "发送后，报告生成时可点 ─ 最小化，拖入记忆栏继续深度分析",
      chatHelloTitle: "记忆栏已就绪，开始分析吧",
      chatHelloBody: "先拖入 1 份报告，再点下面的示例，我会基于它给出建议",
      chatEmptyMemory: "请先拖入报告到记忆栏",
      panelTip: "点 ─ 最小化，拖入记忆栏后可在 Chat Mode 深度分析",
      close: "关闭",
      memoryHint: "将面板拖入此处作为上下文"
    },
    en: {
      helloTitle: "I'm your operations analysis assistant",
      helloBody: "Check merchants, spot risks, find opportunities, get advice — fetch data on the left first, then drag it into memory for deep analysis on the right",
      flow1Title: "Ask in Report Mode",
      flow1Sub: "Get data",
      flow2Title: "Minimize the panel",
      flow2Sub: "Drag into memory",
      flow3Title: "Chat in Chat Mode",
      flow3Sub: "Deep analysis",
      colLeftTitle: "① Fetch data first",
      colLeftTag: "REPORT",
      colRightTitle: "③ Then analyze deeply",
      colRightTag: "CHAT",
      colRightNote: "Drag reports into memory first",
      tipReport: "After sending, click – to minimize the panel and drag it into the memory bar for deep analysis",
      chatHelloTitle: "Memory ready — start analyzing",
      chatHelloBody: "Drag in a report first, then pick an example — I'll analyze based on it",
      chatEmptyMemory: "Drag a report into the memory bar first",
      panelTip: "Click – to minimize, then drag into memory for Chat Mode analysis",
      close: "Close",
      memoryHint: "Drag the panel here as context"
    }
  };

  // ── 示例数据（纯数据；dynamic 字段渲染时替换占位符）──
  var WELCOME_EXAMPLES = {
    report: [
      { text: "查一下 {merchant} 这个月表现", dynamic: "merchant" },
      { text: "这个月有哪些商户逾期？" },
      { text: "Tier 2表现" },
      { text: "品类趋势" }
    ],
    chat: [
      { text: "根据记忆栏的报告，给我分析建议" },
      { text: "对比记忆栏里的两个商户，谁更值得重点投入" },
      { text: "总结记忆栏的数据，提出下个月的运营重点" }
    ]
  };

  // ── 语言 ──
  function currentLanguage() {
    try {
      var stored = localStorage.getItem("offerLanguage");
      if (stored === "zh" || stored === "en") return stored;
    } catch (e) {}
    try {
      return /^zh/i.test(document.documentElement.lang) ? "zh" : "en";
    } catch (e) {}
    return "zh";
  }
  function currentCopy(key) {
    var lang = currentLanguage();
    return (WELCOME_COPY[lang] && WELCOME_COPY[lang][key]) || WELCOME_COPY.zh[key] || key;
  }

  // ── 动态商户名：取 commission 最高的商户 ──
  function merchantForExample(offers) {
    if (!Array.isArray(offers) || !offers.length) return null;
    var ranked = offers.slice().sort(function (a, b) {
      return (Number(b.commission) || 0) - (Number(a.commission) || 0);
    });
    for (var i = 0; i < ranked.length; i++) {
      var name = ranked[i] && (ranked[i].merchantName || ranked[i].merchant);
      if (name) {
        var clean = String(name).trim();
        if (clean) return clean;
      }
    }
    return null;
  }

  // ── 公共 API 骨架（后续任务填充实现）──
  function maybeRender(mode, opts) {
    if (TEST_MODE) return false;
    return false;
  }
  function notify(eventName, payload) {}
  function dismiss(mode) {}
  function isRendered(mode) { return false; }

  window.CHATBOT_WELCOME = {
    maybeRender: maybeRender,
    notify: notify,
    dismiss: dismiss,
    isRendered: isRendered,
    _test: {
      examples: WELCOME_EXAMPLES,
      copy: WELCOME_COPY,
      currentLanguage: currentLanguage,
      merchantForExample: merchantForExample
    }
  };
})();
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node scripts/test_chatbot_welcome.mjs`
Expected: PASS（用例 1-4 全部通过）

- [ ] **Step 5: 提交**

```bash
git add public/chatbot_welcome.js scripts/test_chatbot_welcome.mjs
git commit -m "feat(chatbot): 欢迎屏引擎数据层——示例数据 + 双语文案 + 语言读取 + 动态商户名（vm 测试）"
```

---

### Task 2: 引擎决策层——渲染判定与示例交互决策（纯函数）

**Files:**
- Modify: `public/chatbot_welcome.js`
- Modify: `scripts/test_chatbot_welcome.mjs`

**Interfaces:**
- Consumes: `WELCOME_COPY`、`currentLanguage()`（Task 1）
- Produces:
  - `shouldRenderFor(mode)` → `boolean`（容器存在 + 无 `.welcome-panel` + 无 `.message` 才渲染）
  - `containerFor(mode)` → `#chatLogChat`（chat）或 `#chatLog`（report）
  - `tipStateFor(kind, hasMemory)` → `"report-tip" | "empty-memory" | null`
  - `fillAllowedFor(kind, hasMemory)` → `boolean`（chat 示例且无记忆 → false，拦截不填充）
  - `shouldClearTipOnInput(currentValue, lastFillValue)` → `boolean`

- [ ] **Step 1: 追加失败测试**（`scripts/test_chatbot_welcome.mjs` 末尾追加；`byIdMap` 提供 chatLog/chatLogChat stub）

```js
// ── 用例 5：渲染判定 ──
byIdMap["chatLog"] = { ...elementStub, querySelector() { return null; } };
byIdMap["chatLogChat"] = { ...elementStub, querySelector() { return null; } };
assertEqual(t.shouldRenderFor("report"), true, "empty chatLog -> should render");
assertEqual(t.shouldRenderFor("chat"), true, "empty chatLogChat -> should render");
assertEqual(t.shouldRenderFor("bogus"), false, "unknown mode -> never render");
byIdMap["chatLog"] = null;
assertEqual(t.shouldRenderFor("report"), false, "missing chatLog -> no render");
byIdMap["chatLog"] = { ...elementStub, querySelector() { return { className: "welcome-panel" }; } };
assertEqual(t.shouldRenderFor("report"), false, "welcome already rendered -> no re-render");
byIdMap["chatLog"] = { ...elementStub, querySelector() { return { className: "message" }; } };
assertEqual(t.shouldRenderFor("report"), false, "chat log has messages -> no render");
byIdMap["chatLog"] = { ...elementStub, querySelector() { return null; } };

// ── 用例 6：示例交互决策 ──
assertEqual(t.tipStateFor("report", false), "report-tip", "report example always shows report tip");
assertEqual(t.tipStateFor("chat", false), "empty-memory", "chat example without memory -> empty-memory tip");
assertEqual(t.tipStateFor("chat", true), null, "chat example with memory -> no tip");
assertEqual(t.fillAllowedFor("report", false), true, "report example always fills");
assertEqual(t.fillAllowedFor("chat", false), false, "chat example without memory -> blocked");
assertEqual(t.fillAllowedFor("chat", true), true, "chat example with memory -> fills");

// ── 用例 7：手动输入清除提示 ──
assertEqual(t.shouldClearTipOnInput("abc", "abc"), false, "unchanged value -> keep tip");
assertEqual(t.shouldClearTipOnInput("abcX", "abc"), true, "user edited value -> clear tip");
assertEqual(t.shouldClearTipOnInput("", "abc"), true, "cleared value -> clear tip");
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/test_chatbot_welcome.mjs`
Expected: FAIL（`t.shouldRenderFor` 等 undefined）

- [ ] **Step 3: 实现决策层**（`public/chatbot_welcome.js`，在 `merchantForExample` 之后加入）

```js
  // ── 渲染判定与示例交互决策（纯函数）──
  function containerFor(mode) {
    if (mode === "chat") return document.getElementById("chatLogChat");
    return document.getElementById("chatLog");
  }
  function shouldRenderFor(mode) {
    var container = containerFor(mode);
    if (!container) return false;
    if (container.querySelector(".welcome-panel")) return false;
    if (container.querySelector(".message")) return false;
    return true;
  }
  // kind: "report" | "chat"（示例所属分区）
  function tipStateFor(kind, hasMemory) {
    if (kind === "report") return "report-tip";
    if (!hasMemory) return "empty-memory";
    return null;
  }
  function fillAllowedFor(kind, hasMemory) {
    if (kind === "report") return true;
    return !!hasMemory;
  }
  function shouldClearTipOnInput(currentValue, lastFillValue) {
    return currentValue !== lastFillValue;
  }
```

并在 `_test` 中追加：

```js
      shouldRenderFor: shouldRenderFor,
      containerFor: containerFor,
      tipStateFor: tipStateFor,
      fillAllowedFor: fillAllowedFor,
      shouldClearTipOnInput: shouldClearTipOnInput
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node scripts/test_chatbot_welcome.mjs`
Expected: PASS（用例 1-7 全部通过）

- [ ] **Step 5: 提交**

```bash
git add public/chatbot_welcome.js scripts/test_chatbot_welcome.mjs
git commit -m "feat(chatbot): 欢迎屏决策层——渲染判定 + 示例交互决策纯函数（vm 测试）"
```

---

### Task 3: 引擎 DOM 渲染层——两屏渲染 + 示例点击 + 提示条 + 面板提示条 + dismiss

**Files:**
- Modify: `public/chatbot_welcome.js`
- Modify: `scripts/test_chatbot_welcome.mjs`

**Interfaces:**
- Consumes: `WELCOME_EXAMPLES`、`WELCOME_COPY`、`currentLanguage()`/`currentCopy()`、`merchantForExample()`、`shouldRenderFor()`、`tipStateFor()`、`fillAllowedFor()`、`shouldClearTipOnInput()`（Task 1-2）
- Produces:
  - `maybeRender(mode, opts)` 完整实现（非 TEST_MODE 下渲染；TEST_MODE 下只返回 `shouldRenderFor` 判定）
  - `_render(mode, opts)`：渲染欢迎屏 DOM（report 双栏 / chat 进度追踪）+ 事件委托
  - `dismiss(mode)`：移除容器内 `.welcome-panel` + tipbar + 清 `_tipFromExample`
  - `isRendered(mode)`：容器内存在 `.welcome-panel`
  - `_showTipbar(key)` / `_clearTipbar()`：tipbar 状态（`_tipShown`）
  - `_insertPanelTip(panelEl)`：报告面板提示条插入（挂在面板头部之后）
  - `_test` 追加：`renderSmoke()`、`tipActive()`、`showTipbar(key)`、`clearTipbar()`、`lastMode()`、`resolveExampleText(ex, merchant)`

**布局要点（已与用户视觉确认）：**
- report 屏结构：`.welcome-panel` > `.welcome-head`（头像+标题+描述）+ `.welcome-flow`（3 个 `.welcome-flow-step`，各含 `.welcome-flow-num` + `.welcome-flow-txt`（title + `<br>` + sub））+ `.welcome-cols`（左 `.welcome-col`（标题+tag+`.welcome-chips` 内 4 个 `.welcome-chip`）+ 中间 `.welcome-cols-arrow` + 右 `.welcome-col.right`（标题+tag+3 chips+`.welcome-note`））
- chat 屏结构：`.welcome-panel` > `.welcome-head` + `.welcome-flow.progress`（3 步，第 2 步渲染时带 `.done` 标记由 `notify("memory-added")` 补）+ `.welcome-col`（分析 chips）
- chip 元素：`<button type="button" class="welcome-chip" data-kind="report|chat" data-text="渲染后文本">`（`{merchant}` 渲染时替换为动态商户名或 `FALLBACK_MERCHANT`）
- tipbar：`.welcome-tipbar`（含文本 + `<button class="welcome-tip-close">✕</button>`），插入 `#chatForm` 之前（`chatForm.parentNode.insertBefore`）
- 面板提示条：`.welcome-panel-tip`（文本 + ✕），插入 `panelEl.querySelector(".deep-window-head")` 之后，兜底 `panelEl.appendChild`
- 语言跟随：MutationObserver 观察 `<html lang>`，欢迎屏存活期切换语言重渲染当前屏

- [ ] **Step 1: 追加失败测试**

```js
// ── 用例 8：渲染 smoke（stub DOM 下不抛异常）──
byIdMap["chatLog"] = { ...elementStub, querySelector() { return null; }, addEventListener() {} };
byIdMap["chatLogChat"] = { ...elementStub, querySelector() { return null; }, addEventListener() {} };
byIdMap["chatInput"] = elementStub;
byIdMap["chatForm"] = { ...elementStub, parentNode: { insertBefore() {} } };
t.renderSmoke();
assertEqual(t.tipActive(), false, "no tip after plain render");
t.showTipbar("report-tip");
assertEqual(t.tipActive(), true, "showTipbar should set tip state");
t.clearTipbar();
assertEqual(t.tipActive(), false, "clearTipbar should clear tip state");
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/test_chatbot_welcome.mjs`
Expected: FAIL（`t.renderSmoke` undefined）

- [ ] **Step 3: 实现 DOM 渲染层**（`public/chatbot_welcome.js`，替换 `maybeRender`/`notify`/`dismiss`/`isRendered` 骨架，新增渲染函数）

```js
  // ── 状态 ──
  var _mode = null;            // "report" | "chat" | null
  var _tipShown = false;
  var _tipFromExample = false;
  var _lastFillValue = "";
  var _hasMemory = false;
  var _panelTipShown = false;
  var _langObserver = null;

  // ── DOM 工具 ──
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function makeEl(className, html) {
    var el = document.createElement("div");
    el.className = className;
    if (html !== undefined) el.innerHTML = html;
    return el;
  }
  // 渲染时替换动态占位符（chip 的 data-text 存最终文本）
  function resolveExampleText(ex, merchant) {
    var text = ex.text;
    if (ex.dynamic === "merchant") {
      text = text.replace("{merchant}", merchant || FALLBACK_MERCHANT);
    }
    return text;
  }
  function exampleMerchant(offers) {
    return merchantForExample(offers) || FALLBACK_MERCHANT;
  }

  // ── 欢迎屏渲染 ──
  function flowHtml() {
    var keys = [["flow1Title", "flow1Sub"], ["flow2Title", "flow2Sub"], ["flow3Title", "flow3Sub"]];
    return '<div class="welcome-flow">' + keys.map(function (pair) {
      return '<div class="welcome-flow-step"><span class="welcome-flow-num">' +
        escapeHtml(currentCopy(pair[0]).charAt(0)) + '</span><span class="welcome-flow-txt">' +
        escapeHtml(currentCopy(pair[0])) + '<br>' + escapeHtml(currentCopy(pair[1])) + '</span></div>';
    }).join('<span class="welcome-flow-arrow">→</span>') + '</div>';
  }
  function chipsHtml(examples, kind, merchant) {
    return '<div class="welcome-chips">' + examples.map(function (ex) {
      var text = resolveExampleText(ex, merchant);
      return '<button type="button" class="welcome-chip" data-kind="' + kind + '" data-text="' +
        escapeHtml(text) + '">' + escapeHtml(text) + '</button>';
    }).join("") + '</div>';
  }
  function headHtml() {
    return '<div class="welcome-head"><div class="welcome-avatar">🤖</div><div>' +
      '<div class="welcome-hello">' + escapeHtml(currentCopy("helloTitle")) + '</div>' +
      '<div class="welcome-desc">' + escapeHtml(currentCopy("helloBody")) + '</div></div></div>';
  }
  function colHtml(kind, examples, merchant, extra) {
    var isRight = kind === "chat";
    var titleKey = isRight ? "colRightTitle" : "colLeftTitle";
    var tagKey = isRight ? "colRightTag" : "colLeftTag";
    var html = '<div class="welcome-col' + (isRight ? " right" : "") + '">' +
      '<div class="welcome-col-title"><span>' + escapeHtml(currentCopy(titleKey)) + '</span>' +
      '<span class="welcome-col-tag' + (isRight ? " alt" : "") + '">' + escapeHtml(currentCopy(tagKey)) + '</span></div>' +
      chipsHtml(examples, kind, merchant);
    if (isRight && currentCopy("colRightNote")) {
      html += '<div class="welcome-note">' + escapeHtml(currentCopy("colRightNote")) + '</div>';
    }
    return html + "</div>";
  }
  function _render(mode, opts) {
    opts = opts || {};
    var container = containerFor(mode);
    if (!container) return;
    var merchant = exampleMerchant(opts.offers);
    var html;
    if (mode === "chat") {
      html = '<div class="welcome-panel">' + headHtml() +
        flowHtml().replace('class="welcome-flow"', 'class="welcome-flow progress"') +
        colHtml("chat", WELCOME_EXAMPLES.chat, merchant) + "</div>";
    } else {
      html = '<div class="welcome-panel">' + headHtml() + flowHtml() +
        '<div class="welcome-cols">' + colHtml("report", WELCOME_EXAMPLES.report, merchant) +
        '<div class="welcome-cols-arrow">➜</div>' + colHtml("chat", WELCOME_EXAMPLES.chat, merchant) +
        "</div></div>";
    }
    var panel = makeEl("welcome-panel", html);
    container.appendChild(panel);
    _mode = mode;
    _hasMemory = !!opts.hasMemory;
    _bindContainer(container);
    _bindLangObserver();
  }
  function _bindContainer(container) {
    try {
      container.addEventListener("click", function (e) {
        var chip = e.target && e.target.closest && e.target.closest(".welcome-chip");
        if (!chip) return;
        var kind = chip.getAttribute("data-kind") || "report";
        _handleChipClick(kind, chip.getAttribute("data-text") || "");
      });
    } catch (err) {}
  }
  function _handleChipClick(kind, text) {
    if (!fillAllowedFor(kind, _hasMemory)) {
      _showTipbar("empty-memory");
      return;
    }
    var input = document.getElementById("chatInput");
    if (!input) return;
    input.value = text;
    _lastFillValue = text;
    _tipFromExample = true;
    var tipKey = tipStateFor(kind, _hasMemory);
    if (tipKey) _showTipbar(tipKey);
    _pulseSend(true);
  }
  function _pulseSend(on) {
    try {
      var form = document.getElementById("chatForm");
      var btn = form && form.querySelector('button[type="submit"]');
      if (btn) btn.classList.toggle("welcome-pulse", !!on);
    } catch (e) {}
  }
  function _showTipbar(key) {
    try {
      var form = document.getElementById("chatForm");
      if (!form || !form.parentNode) return;
      var tip = makeEl("welcome-tipbar",
        '<span>📌 ' + escapeHtml(currentCopy(key)) + '</span>' +
        '<button type="button" class="welcome-tip-close" aria-label="' + escapeHtml(currentCopy("close")) + '">✕</button>');
      form.parentNode.insertBefore(tip, form);
      _tipShown = true;
      _wireTipClose(tip);
    } catch (e) {}
  }
  function _wireTipClose(tip) {
    try {
      tip.addEventListener("click", function (e) {
        if (e.target && e.target.closest && e.target.closest(".welcome-tip-close")) {
          _clearTipbar();
        }
      });
    } catch (e) {}
  }
  function _clearTipbar() {
    try {
      var tips = document.querySelectorAll(".welcome-tipbar");
      for (var i = 0; i < tips.length; i++) tips[i].parentNode.removeChild(tips[i]);
    } catch (e) {}
    _tipShown = false;
  }
  function _insertPanelTip(panelEl) {
    try {
      var tip = makeEl("welcome-panel-tip",
        '<span>' + escapeHtml(currentCopy("panelTip")) + '</span>' +
        '<button type="button" class="welcome-panel-tip-close" aria-label="' + escapeHtml(currentCopy("close")) + '">✕</button>');
      tip.addEventListener("click", function (e) {
        if (e.target && e.target.closest && e.target.closest(".welcome-panel-tip-close")) {
          try { tip.parentNode.removeChild(tip); } catch (err) {}
        }
      });
      var head = panelEl.querySelector && panelEl.querySelector(".deep-window-head");
      if (head && head.parentNode) head.parentNode.insertBefore(tip, head.nextSibling);
      else if (panelEl.appendChild) panelEl.appendChild(tip);
    } catch (e) {}
  }
  function _bindLangObserver() {
    if (_langObserver) return;
    try {
      _langObserver = new MutationObserver(function () {
        if (isRendered(_mode)) {
          _clearTipbar();
          dismiss(_mode);
          maybeRender(_mode, { hasMemory: _hasMemory });
        }
      });
      _langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    } catch (e) {}
  }

  // ── 公共 API ──
  function maybeRender(mode, opts) {
    if (TEST_MODE) return shouldRenderFor(mode);
    if (!shouldRenderFor(mode)) return false;
    _render(mode, opts || {});
    return true;
  }
  function dismiss(mode) {
    try {
      var container = containerFor(mode);
      if (!container) return;
      var panels = container.querySelectorAll(".welcome-panel");
      for (var i = 0; i < panels.length; i++) panels[i].parentNode.removeChild(panels[i]);
    } catch (e) {}
    _clearTipbar();
    _tipFromExample = false;
    if (_mode === mode) _mode = null;
    _pulseSend(false);
  }
  function isRendered(mode) {
    var container = containerFor(mode);
    if (!container) return false;
    try { return !!container.querySelector(".welcome-panel"); } catch (e) { return false; }
  }
  function notify(eventName, payload) {} // Task 4 实现
```

`_test` 追加：

```js
      renderSmoke: function () {
        _render("report", { offers: [], hasMemory: false });
        _render("chat", { offers: [{ merchantName: "Shokz", commission: 1 }], hasMemory: false });
      },
      tipActive: function () { return _tipShown; },
      showTipbar: function (key) { _showTipbar(key); },
      clearTipbar: function () { _clearTipbar(); },
      lastMode: function () { return _mode; },
      resolveExampleText: resolveExampleText
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node scripts/test_chatbot_welcome.mjs`
Expected: PASS（用例 1-8 全部通过；`renderSmoke` 不抛异常）

- [ ] **Step 5: 提交**

```bash
git add public/chatbot_welcome.js scripts/test_chatbot_welcome.mjs
git commit -m "feat(chatbot): 欢迎屏 DOM 渲染层——双栏/进度追踪两屏 + 示例点击填充 + 提示条 + 面板提示条"
```

---

### Task 4: 引擎状态机层——notify 全事件（chat-sent / mode-switched / report-ready / memory-added）+ 输入监听

**Files:**
- Modify: `public/chatbot_welcome.js`
- Modify: `scripts/test_chatbot_welcome.mjs`

**Interfaces:**
- Consumes: Task 1-3 全部
- Produces:
  - `notify(eventName, payload)` 完整实现：
    - `"chat-sent"` → `dismiss(_mode)`（含 tipbar、脉冲清理）
    - `"mode-switched"` → 更新 `_hasMemory`（若传入），`maybeRender(目标模式)`
    - `"report-ready"` → `_panelTipShown` 一次性守卫后 `_insertPanelTip(payload.panelEl)`
    - `"memory-added"` → `_hasMemory = true`，Chat 欢迎屏流程条第 2 步补 `.done`
  - 模块级 `input` 监听：`#chatInput` 手动改动（≠ `_lastFillValue`）→ 清 tipbar + `_tipFromExample` + 去脉冲
  - `_test` 追加：`panelTipActive()`、`hasMemory()`、`tipFromExampleActive()`、`markMemoryStepDone()` 安全探针

- [ ] **Step 1: 追加失败测试**

```js
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

// ── 用例 11：notify("mode-switched") 驱动渲染 ──
welcome.notify("mode-switched", { mode: "chat", hasMemory: false });
assertEqual(t.lastMode(), "chat", "mode-switched chat should render chat welcome");
welcome.notify("mode-switched", { mode: "report", hasMemory: false });
assertEqual(t.lastMode(), "report", "mode-switched report should render report welcome");

// ── 用例 12：notify("chat-sent") 清理 ──
t.showTipbar("report-tip");
assertEqual(t.tipActive(), true, "tip shown before send");
welcome.notify("chat-sent");
assertEqual(t.tipActive(), false, "chat-sent should clear tipbar");
```

（注意：用例 9-12 依赖 Task 3 的 stub 环境；`panelTipActive`/`hasMemory` 初始值在 notify 触发前为 true/false——若用例顺序导致状态残留，在用例 9 前重置：`welcome.notify("chat-sent"); _test.clearTipbar();`）

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/test_chatbot_welcome.mjs`
Expected: FAIL（`t.panelTipActive` undefined / notify 无行为）

- [ ] **Step 3: 实现状态机层**（替换 `public/chatbot_welcome.js` 中的 `notify` 空实现，并加输入监听）

```js
  function notify(eventName, payload) {
    payload = payload || {};
    if (eventName === "chat-sent") {
      dismiss(_mode);
      return;
    }
    if (eventName === "mode-switched") {
      if (payload.hasMemory !== undefined) _hasMemory = !!payload.hasMemory;
      var mode = payload.mode === "chat" ? "chat" : "report";
      maybeRender(mode, { hasMemory: _hasMemory });
      return;
    }
    if (eventName === "report-ready") {
      if (_panelTipShown || !payload.panelEl) return;
      _panelTipShown = true;
      _insertPanelTip(payload.panelEl);
      return;
    }
    if (eventName === "memory-added") {
      _hasMemory = true;
      _markMemoryStepDone();
      return;
    }
  }
  // Chat 欢迎屏流程条第 2 步（拖入记忆栏）补 ✓
  function _markMemoryStepDone() {
    try {
      var container = containerFor("chat");
      if (!container) return;
      var steps = container.querySelectorAll(".welcome-flow.progress .welcome-flow-step");
      if (steps && steps[1]) steps[1].classList.add("done");
    } catch (e) {}
  }
```

模块级输入监听（在 `window.CHATBOT_WELCOME` 赋值之前注册）：

```js
  // ── 手动输入零打扰：用户改动输入框文本（≠ 示例填充值）→ 清 tipbar ──
  try {
    document.addEventListener("input", function (e) {
      if (!_tipFromExample) return;
      if (e.target && e.target.id === "chatInput" &&
          shouldClearTipOnInput(e.target.value, _lastFillValue)) {
        _clearTipbar();
        _tipFromExample = false;
        _pulseSend(false);
      }
    });
  } catch (e) {}
```

`_test` 追加：

```js
      panelTipActive: function () { return !_panelTipShown; },
      hasMemory: function () { return _hasMemory; },
      tipFromExampleActive: function () { return _tipFromExample; },
      markMemoryStepDone: function () { _markMemoryStepDone(); }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node scripts/test_chatbot_welcome.mjs`
Expected: PASS（用例 1-12 全部通过）

- [ ] **Step 5: 提交**

```bash
git add public/chatbot_welcome.js scripts/test_chatbot_welcome.mjs
git commit -m "feat(chatbot): 欢迎屏状态机——notify 四事件（发送收起/模式切换/报告一次性提示/记忆拖入）+ 手动输入清提示"
```

---

### Task 5: 样式——styles.css `.welcome-*` 全套（Ethereal Glass）

**Files:**
- Modify: `public/styles.css`（末尾追加，同 `.onboarding-*` 分区注释风格）

**Interfaces:**
- Consumes: Task 3-4 的 DOM 结构（`.welcome-panel/.welcome-head/.welcome-avatar/.welcome-hello/.welcome-desc/.welcome-flow(.progress)/.welcome-flow-step/.welcome-flow-num/.welcome-flow-txt/.welcome-flow-arrow/.welcome-cols/.welcome-col(.right)/.welcome-col-title/.welcome-col-tag(.alt)/.welcome-chips/.welcome-chip/.welcome-note/.welcome-tipbar/.welcome-tip-close/.welcome-panel-tip/.welcome-panel-tip-close/.welcome-pulse`）

- [ ] **Step 1: 追加样式**

```css
/* ── Chatbot 欢迎屏 Welcome Guide（类名 .welcome-*）──
   视觉基调与新手引导一致：Ethereal Glass 深色玻璃拟态（发丝 hairline + 内高光 + 柔辉光），
   动效走自定义贝塞尔曲线。欢迎屏位于聊天区内（非 fixed），z-index 不参与浮窗层级。 */
.welcome-panel {
  background: linear-gradient(165deg, rgba(30, 37, 62, 0.88) 0%, rgba(16, 20, 36, 0.86) 100%);
  -webkit-backdrop-filter: blur(24px) saturate(1.5);
  backdrop-filter: blur(24px) saturate(1.5);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 14px;
  padding: 14px;
  margin: 4px 0 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.06);
}
.welcome-head { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 10px; }
.welcome-avatar {
  width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
  background: linear-gradient(135deg, #6ea8ff, #9b7bff);
  display: flex; align-items: center; justify-content: center; font-size: 16px;
  box-shadow: 0 0 14px rgba(110, 168, 255, 0.35);
}
.welcome-hello { font-size: 13px; font-weight: 600; }
.welcome-desc { font-size: 11.5px; color: #9aa7bd; margin-top: 2px; line-height: 1.5; }

.welcome-flow { display: flex; align-items: center; gap: 4px; margin-bottom: 12px; }
.welcome-flow-step {
  flex: 1; display: flex; gap: 6px; align-items: flex-start;
  background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 10px; padding: 8px; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
.welcome-flow-num {
  width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0; margin-top: 1px;
  background: linear-gradient(135deg, #6ea8ff, #9b7bff);
  color: #0b0e14; font-size: 10px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.welcome-flow-txt { font-size: 10.5px; color: #9aa7bd; line-height: 1.35; }
.welcome-flow-arrow { color: #5d6b84; font-size: 12px; flex-shrink: 0; }
/* 进度追踪（Chat 态）：第 1/2 步 done（✓ 灰化），第 3 步高亮 */
.welcome-flow.progress .welcome-flow-step.done { opacity: 0.65; }
.welcome-flow.progress .welcome-flow-step.done .welcome-flow-num::after { content: "✓"; }
.welcome-flow.progress .welcome-flow-step.done .welcome-flow-num { background: rgba(110, 168, 255, 0.25); color: #9aa7bd; }
.welcome-flow.progress .welcome-flow-step:last-child {
  border-color: rgba(110, 168, 255, 0.5);
  box-shadow: 0 0 10px rgba(110, 168, 255, 0.35);
}
.welcome-flow.progress .welcome-flow-step:last-child .welcome-flow-num { background: #6ea8ff; }

.welcome-cols { display: flex; gap: 10px; align-items: stretch; }
.welcome-col {
  flex: 1; border: 1px solid rgba(255, 255, 255, 0.09); border-radius: 10px;
  padding: 10px; background: rgba(255, 255, 255, 0.03);
}
.welcome-col.right {
  border-color: rgba(155, 123, 255, 0.35);
  background: rgba(155, 123, 255, 0.06);
}
.welcome-cols-arrow {
  display: flex; align-items: center; color: #5d6b84; font-size: 14px; flex-shrink: 0;
}
.welcome-col-title {
  font-size: 11px; font-weight: 600; color: #9aa7bd;
  display: flex; align-items: center; gap: 6px; margin-bottom: 6px;
}
.welcome-col-tag {
  font-size: 9px; padding: 1px 7px; border-radius: 999px;
  background: #6ea8ff; color: #0b0e14; font-weight: 700;
}
.welcome-col-tag.alt {
  background: rgba(155, 123, 255, 0.18); color: #c4b5fd;
  border: 1px solid rgba(155, 123, 255, 0.35);
}
.welcome-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.welcome-chip {
  font-size: 11px; padding: 5px 11px; border-radius: 999px;
  background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.09);
  color: #eef2f8; cursor: pointer; font-family: inherit;
  transition: border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.welcome-chip:hover {
  border-color: #6ea8ff;
  box-shadow: 0 0 10px rgba(110, 168, 255, 0.35);
}
.welcome-note { font-size: 10px; color: #5d6b84; margin-top: 6px; }

/* 提示条：输入框上方浮出（#chatForm 前），可关闭 */
.welcome-tipbar {
  display: flex; align-items: center; gap: 6px;
  background: rgba(110, 168, 255, 0.10);
  border: 1px solid rgba(110, 168, 255, 0.35);
  border-radius: 10px; padding: 6px 10px; margin: 0 0 8px;
  font-size: 10.5px; color: #eef2f8;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.06);
}
.welcome-tip-close {
  margin-left: auto; background: none; border: none; color: #5d6b84;
  cursor: pointer; font-size: 11px; padding: 0 2px;
}
.welcome-tip-close:hover { color: #eef2f8; }
/* 报告面板顶部提示条（deep window 头部下方） */
.welcome-panel-tip {
  display: flex; align-items: center; gap: 6px;
  background: rgba(110, 168, 255, 0.10);
  border: 1px solid rgba(110, 168, 255, 0.35);
  border-radius: 10px; padding: 6px 10px; margin: 8px 10px 0;
  font-size: 10.5px; color: #eef2f8;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}
.welcome-panel-tip-close {
  margin-left: auto; background: none; border: none; color: #5d6b84;
  cursor: pointer; font-size: 11px; padding: 0 2px;
}
.welcome-panel-tip-close:hover { color: #eef2f8; }
/* 示例填充后发送按钮呼吸高亮 */
.welcome-pulse { animation: welcome-pulse 1.6s cubic-bezier(0.45, 0, 0.55, 1) infinite; }
@keyframes welcome-pulse {
  0%, 100% { box-shadow: 0 0 10px rgba(110, 168, 255, 0.35); }
  50% { box-shadow: 0 0 22px rgba(110, 168, 255, 0.6); transform: translateY(-1px); }
}
```

- [ ] **Step 2: 语法/加载检查**

Run: `node --check public/styles.css` 不适用（CSS 无语法检查器）——改为确认文件尾部追加成功且无截断：
```bash
tail -5 public/styles.css
```
Expected: 末尾为 `@keyframes welcome-pulse { ... }` 完整结束

- [ ] **Step 3: 手动视觉验证（用户本地执行）**

```bash
python server.py
# 打开 http://127.0.0.1:8765/ 进入 chatbot 页 → 确认欢迎屏布局与 mockup 一致、
# 深色玻璃质感、双栏对齐、hover 辉光、提示条与脉冲动画正常
# 验证完成后关闭服务器（netstat -ano | grep 8765 + taskkill）
```

- [ ] **Step 4: 提交**

```bash
git add public/styles.css
git commit -m "style(chatbot): 欢迎屏 Ethereal Glass 全套样式——双栏卡片/流程横条/示例 chips/提示条/脉冲动画"
```

---

### Task 6: app.js 挂点 + index.html 引入 + 版本号 bump

**Files:**
- Modify: `public/app.js`（5 处挂点 + 1 处删除，均为新增调用行或替换行）
- Modify: `public/index.html`（脚本引入）
- Modify: `public/auth.js:2`（APP_SCRIPT 版本号 bump）

**Interfaces:**
- Consumes: Task 4 的 `window.CHATBOT_WELCOME` API（`maybeRender`/`notify`）
- 挂点位置（已核实）：
  - `app.js:19591-19597` init 欢迎消息 → 替换为 `maybeRender("report", { offers })`；删除 Chat 区 addMessage 块
  - `app.js:19483-19489` chatForm submit → `notify("chat-sent")`
  - `app.js:19504-19521` 模式切换两个监听器 → `notify("mode-switched", { mode, hasMemory })`
  - `app.js:10036` `_renderPanelReport` 尾部 → `notify("report-ready", { panelEl: panel.el })`
  - `app.js:10514-10515` `_addMemoryFromPanel` 尾部 → `notify("memory-added", { hasMemory: true })`

- [ ] **Step 1: 挂点修改**

**1a. init 欢迎消息替换**（`public/app.js:19591-19597`）：

原：
```js
    addMessage("assistant", `Loaded <strong>${offers.length.toLocaleString()}</strong> internal offers. Search merchant name, merchant ID, ASIN, category, payment status, or ask for recommendations.`);
    if (els.chatLogChat) {
      var _welcomeChat = document.createElement("div");
      _welcomeChat.className = "message assistant";
      _welcomeChat.innerHTML = `Loaded <strong>${offers.length.toLocaleString()}</strong> internal offers.`;
      els.chatLogChat.appendChild(_welcomeChat);
    }
```

替换为：
```js
    // 欢迎屏取代英文欢迎消息：空聊天区的能力地图 + 示例问题（chatbot_welcome.js）
    if (window.CHATBOT_WELCOME) {
      window.CHATBOT_WELCOME.maybeRender("report", { offers: offers, hasMemory: false });
    }
```

**1b. chatForm submit**（`public/app.js:19483-19489`）：

原：
```js
    els.chatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const prompt = els.chatInput.value.trim();
      if (!prompt) return;
      els.chatInput.value = "";
      applyPrompt(prompt);
    });
```

替换为：
```js
    els.chatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const prompt = els.chatInput.value.trim();
      if (!prompt) return;
      els.chatInput.value = "";
      if (window.CHATBOT_WELCOME) window.CHATBOT_WELCOME.notify("chat-sent");
      applyPrompt(prompt);
    });
```

**1c. 模式切换**（`public/app.js:19504-19521`）：

原：
```js
    els.modeFastBtn?.addEventListener("click", () => {
      state.deepMode = false;
      els.modeFastBtn.classList.add("active");
      els.modeDeepBtn.classList.remove("active");
      els.chatInput.placeholder = t("chat.placeholder", "Ask about EPC, tiers, AOV, conversion, unpaid offers...");
      _syncChatLogVisibility();
      _renderMemoryBar();
    });

    els.modeDeepBtn?.addEventListener("click", () => {
      state.deepMode = true;
      els.modeDeepBtn.classList.add("active");
      els.modeFastBtn.classList.remove("active");
      els.chatInput.placeholder = t("deep.placeholder", "View analysis results in Deep Window…");
      _syncChatLogVisibility();
      _renderMemoryBar();
    });
```

替换为：
```js
    els.modeFastBtn?.addEventListener("click", () => {
      state.deepMode = false;
      els.modeFastBtn.classList.add("active");
      els.modeDeepBtn.classList.remove("active");
      els.chatInput.placeholder = t("chat.placeholder", "Ask about EPC, tiers, AOV, conversion, unpaid offers...");
      _syncChatLogVisibility();
      _renderMemoryBar();
      if (window.CHATBOT_WELCOME) {
        window.CHATBOT_WELCOME.notify("mode-switched", {
          mode: "chat",
          hasMemory: !!(state.reportMemory && state.reportMemory.length)
        });
      }
    });

    els.modeDeepBtn?.addEventListener("click", () => {
      state.deepMode = true;
      els.modeDeepBtn.classList.add("active");
      els.modeFastBtn.classList.remove("active");
      els.chatInput.placeholder = t("deep.placeholder", "View analysis results in Deep Window…");
      _syncChatLogVisibility();
      _renderMemoryBar();
      if (window.CHATBOT_WELCOME) {
        window.CHATBOT_WELCOME.notify("mode-switched", {
          mode: "report",
          hasMemory: !!(state.reportMemory && state.reportMemory.length)
        });
      }
    });
```

**1d. 报告就绪**（`public/app.js:10036`，`_renderPanelReport` 尾部）：

原（10032-10036）：
```js
    // 恢复按钮
    panel.el.querySelector(".deep-window-stop")?.classList.add("hidden");
    panel.el.querySelector(".deep-window-close")?.classList.remove("hidden");
    panel.el.querySelector(".deep-window-export")?.classList.remove("hidden");
    panel.el.classList.remove("generating");
  }
```

替换为：
```js
    // 恢复按钮
    panel.el.querySelector(".deep-window-stop")?.classList.add("hidden");
    panel.el.querySelector(".deep-window-close")?.classList.remove("hidden");
    panel.el.querySelector(".deep-window-export")?.classList.remove("hidden");
    panel.el.classList.remove("generating");

    // 欢迎屏：会话内首次报告生成 → 面板顶部提示「最小化拖入记忆栏」
    if (window.CHATBOT_WELCOME) {
      window.CHATBOT_WELCOME.notify("report-ready", { panelEl: panel.el });
    }
  }
```

**1e. 记忆拖入**（`public/app.js:10514-10515`）：

原：
```js
    if (window.ONBOARDING_TOUR) {
      window.ONBOARDING_TOUR.notify("memory-added");
    }
```

替换为：
```js
    if (window.ONBOARDING_TOUR) {
      window.ONBOARDING_TOUR.notify("memory-added");
    }
    if (window.CHATBOT_WELCOME) {
      window.CHATBOT_WELCOME.notify("memory-added", { hasMemory: true });
    }
```

**1f. index.html 引入**（`public/index.html:1106` 之后）：

```html
    <script src="./onboarding_tour.js?v=20260804-onboarding12"></script>
    <script src="./chatbot_welcome.js?v=20260804-welcome1"></script>
```

**1g. auth.js 版本号 bump**（`public/auth.js:2`）：

原：`const APP_SCRIPT = "./app.js?v=20260804-onboarding1";`
改：`const APP_SCRIPT = "./app.js?v=20260804-welcome1";`

- [ ] **Step 2: 语法检查**

Run:
```bash
node --check public/app.js
node --check public/auth.js
node --check public/chatbot_welcome.js
```
Expected: 全部无输出（语法通过）

- [ ] **Step 3: 全量回归测试**

Run:
```bash
node scripts/test_chatbot_welcome.mjs
node scripts/test_onboarding_tour.mjs
node scripts/test_zh_chatbot.mjs
node scripts/test_chatbot_intent_flow.mjs
```
Expected: 全部 PASS（欢迎屏新测试 + 引导/chatbot 相关回归不受影响）

- [ ] **Step 4: 手动验证（用户本地执行）**

```bash
python server.py
# 1) 首次进入：聊天区显示欢迎屏（不再是英文 Loaded 消息）；双栏布局正确
# 2) 点示例「查一下 {商户} 这个月表现」→ 输入框填入 + 发送按钮脉冲 + 提示条浮出
# 3) 手动改动输入框 → 提示条消失、脉冲停止
# 4) 点发送 → 欢迎屏收起；报告生成 → 面板顶部出现提示条（第二次报告不再出现）
# 5) 切 Chat Mode → Chat 欢迎屏（进度追踪）；拖入记忆栏 → 第 2 步打 ✓
# 6) 记忆栏空时点 Chat 分析示例 → 提示「请先拖入报告」且不填充
# 7) 中英文切换 → 欢迎屏立即重渲染
# 8) 新手引导重播 → 与欢迎屏无冲突
# 验证完成后关闭服务器（netstat -ano | grep 8765 + taskkill）
```

- [ ] **Step 5: 提交**

```bash
git add public/app.js public/index.html public/auth.js
git commit -m "feat(chatbot): 欢迎屏挂点——init 替换英文欢迎消息、发送收起、模式切换渲染、报告/记忆事件通知"
```

---

### Task 7: CI + CLAUDE.md + 收尾回归

**Files:**
- Modify: `.github/workflows/ci.yml:58`（`node scripts/test_onboarding_tour.mjs` 之后追加）
- Modify: `CLAUDE.md`（命令节 `node scripts/test_onboarding_tour.mjs` 之后追加）

**Interfaces:**
- Consumes: Task 6 全部

- [ ] **Step 1: CI 追加测试行**

`.github/workflows/ci.yml` 中 `node scripts/test_onboarding_tour.mjs` 行（第 58 行）之后插入：

```yaml
          node scripts/test_chatbot_welcome.mjs
```

- [ ] **Step 2: CLAUDE.md 追加测试行**

`CLAUDE.md` 命令节 `node scripts/test_onboarding_tour.mjs`（第 53 行）之后插入：

```text
node scripts/test_chatbot_welcome.mjs
```

- [ ] **Step 3: 全量测试验证**

Run:
```bash
node --check public/app.js
node --check public/auth.js
node --check public/chatbot_welcome.js
node scripts/test_chatbot_welcome.mjs
node scripts/test_onboarding_tour.mjs
node scripts/test_zh_chatbot.mjs
node scripts/test_chatbot_intent_flow.mjs
```
Expected: 全部 PASS

- [ ] **Step 4: 提交**

```bash
git add .github/workflows/ci.yml CLAUDE.md
git commit -m "docs(chatbot): 欢迎屏测试接入 CI 与 CLAUDE.md 命令节"
```

---

## 计划自审记录

- **Spec 覆盖核对**：设计文档每节 → 计划任务——§4.1 文件结构 → Task 1/5/6/7；§4.2 API → Task 1-4；§4.3 挂点 → Task 6；§4.4 渲染组件（report 双栏/Chat 进度/tipbar/面板提示条/填充反馈）→ Task 3-5；§4.5 示例数据 → Task 1；§5 数据流（四事件）→ Task 4；§6 i18n → Task 1+3（语言跟随）；§7 错误处理（降级/跳过/测试模式/手动输入清提示）→ Task 1-4；§8 测试用例 1-8 → Task 1-4 用例 1-12；§9 非目标无遗漏
- **占位符扫描**：无 TBD/TODO；所有步骤含可执行代码
- **类型一致性**：`notify` 事件名（`chat-sent`/`mode-switched`/`report-ready`/`memory-added`）在 Task 4 定义、Task 6 调用一致；`_test` 接口名在 Task 1-4 逐步追加且 Task 4 测试引用一致；`resolveExampleText` 在 Task 3 定义并测试
- **依赖方向**：Task 1（数据）→ 2（决策）→ 3（DOM，依赖 1-2）→ 4（状态机，依赖 1-3）→ 5（样式，依赖 3-4 结构）→ 6（挂点，依赖 4 API）→ 7（CI），无环
