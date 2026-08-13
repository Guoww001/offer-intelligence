# Chatbot 单媒体画像（Publisher Profile）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Report Mode 的 Chatbot 支持第 9 种提问类型 `publisherprofile:`——输入媒体名称或 ID（可选带站点），在 Deep Window 中输出该媒体的完整画像（KPI、品类偏好、AOV 区间、佣金画像、市场覆盖与合作商家明细表），内容完全对齐 Publishers 独立页选中媒体后的画像面板。

**Architecture:** 全部前端实现。新增意图 `publisherprofile`（菜单第 9 项 + 命令前缀），复用 Publishers 页面已有的 `_publishersCache` 基础数据与 `loadPublisherPortfolioData(userId)` 商家明细请求（后端 `publisher_portfolio_payload` 已存在，零后端改动）。画像渲染为纯函数返回 HTML 字符串，复用独立页的计算函数（`_publisherAffinitySummary` 等）与 styles.css 全局样式类（`.publisher-affinity-*` 等，Deep Window 内直接可用）。数据未加载时沿用现有 publisher records 的占位模式（唯一 ID + 异步替换 `innerHTML` + 同步 `_deepReportCache`）。

**Tech Stack:** 原生 JS（app.js IIFE 内函数）、无框架、无后端改动。

## Global Constraints

- 规格文档：`docs/superpowers/specs/2026-08-13-publisher-profile-chatbot-design.md`（本地文件，不提交 git；plans 正常提交）
- 注释使用简体中文；commit 信息双语（English / 中文）
- NEVER 完整读取 `public/app.js`（约 23700 行）——只读任务给出的行范围
- `REPORT_MODE_HELP_MD` / `_EN` 是模板字符串：文档内容不得包含未转义的反引号或 `${}`
- 缓存版本号三处必须一致：`public/index.html` 的 `styles.css?v=` 与 `auth.js?v=`、`public/auth.js` 的 `APP_SCRIPT`
- 测试遵循项目 vm 沙箱模式：`window.__OFFER_INTELLIGENCE_TEST__: true`、`window.OFFER_INTELLIGENCE_TEST_HOOKS`
- 完成后关闭本地服务器（任务后 `netstat -ano | grep 8765` 清理）
- 不修改 Publishers 独立页任何现有行为；`_publisherPortfolioRowsForState` 不修改也不复用（页面状态残留风险）

---

### Task 1: 菜单第 9 项 + 命令前缀注册 + i18n

**Files:**
- Modify: `public/index.html`（意图菜单，publisher 按钮 ~line 402-406 之后）
- Modify: `public/app.js`（`CHAT_INTENT_OPTIONS` line 11589-11598、`syncChatInputCommandOverlay` 正则 line 11611、`parseChatIntentPrefix` 正则 line 11761、i18n line 918-919 之后）
- Create: `scripts/test_chatbot_publisher_profile.mjs`（静态断言部分）
- Test: `scripts/test_chatbot_publisher_profile.mjs`

**Interfaces:**
- Consumes: 现有 `CHAT_INTENT_OPTIONS`（app.js line 11589）、`parseChatIntentPrefix`（app.js line 11759）
- Produces: 菜单第 9 项 `data-chat-intent="publisherprofile"`；`CHAT_INTENT_OPTIONS` 含 `{ key: "publisherprofile", intent: "publisherprofile" }`；两处命令正则含 `publisherprofile` 且位于 `publisher` **之前**；i18n 键 `chat.intent.publisherProfile` / `chat.intent.publisherProfileHint`（中英）

- [ ] **Step 1: 写失败测试**（新建 `scripts/test_chatbot_publisher_profile.mjs`，先放静态断言段）

```js
import fs from "node:fs";

function assertMatch(text, pattern, label) {
  if (!pattern.test(text)) throw new Error(`${label}: 未匹配 ${pattern}`);
}

const html = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const auth = fs.readFileSync("public/auth.js", "utf8");

// ── Task 1: 菜单第 9 项 + 命令前缀注册 ──
assertMatch(html, /data-chat-intent="publisherprofile"/, "提问类型菜单应包含 publisherprofile 选项");
assertMatch(html, /data-chat-intent="publisher"[\s\S]{0,400}data-chat-intent="publisherprofile"/, "publisherprofile 选项应位于 publisher 之后");
assertMatch(html, /data-chat-intent="publisherprofile"[\s\S]{0,200}>Publisher Profile</, "publisherprofile 选项显示应为 Publisher Profile");
assertMatch(app, /\{ key: "publisherprofile", intent: "publisherprofile" \}/, "CHAT_INTENT_OPTIONS 应注册 publisherprofile 意图");
assertMatch(app, /categorytier\|merchant\|category\|tier\|trend\|payment\|asin\|publisherprofile\|publisher/, "命令解析应支持 publisherprofile 前缀（且在 publisher 之前）");
assertMatch(app, /"chat\.intent\.publisherProfile": "媒体画像"/, "中文 i18n 应提供 publisherprofile 菜单文案");
assertMatch(app, /"chat\.intent\.publisherProfileHint": "媒体画像查询"/, "中文 i18n 应提供 publisherprofile 提示文案");

console.log("PASS: chatbot publisher profile contract tests (Task 1 static)");
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `node scripts/test_chatbot_publisher_profile.mjs`
Expected: 第一个断言 `未匹配 /data-chat-intent="publisherprofile"/` 抛错

- [ ] **Step 3: 实现菜单第 9 项**（index.html，publisher 按钮 `</button>` 之后、菜单 `</div>` 之前，~line 406 后）

```html
                  <button class="chat-intent-option" type="button" role="option" data-chat-intent="publisherprofile">
                    <span class="chat-intent-option-prefix" aria-hidden="true">:</span>
                    <span class="chat-intent-option-label" data-i18n="chat.intent.publisherProfile">Publisher Profile</span>
                    <span class="chat-intent-option-hint" data-i18n="chat.intent.publisherProfileHint">Publisher profile</span>
                  </button>
```

- [ ] **Step 4: 注册 CHAT_INTENT_OPTIONS**（app.js line 11597 `{ key: "publisher", intent: "publisher" }` 之后加一行）

```js
    { key: "publisher", intent: "publisher" },
    { key: "publisherprofile", intent: "publisherprofile" }
```

- [ ] **Step 5: 两处命令正则加 publisherprofile**（app.js line 11611 与 line 11761，`publisher` 之前插入 `publisherprofile|`）

line 11611 `syncChatInputCommandOverlay`：

```js
    const match = value.match(/^\s*(categorytier|merchant|category|tier|trend|payment|asin|publisherprofile|publisher)\s*[:：](?=\s|$)/i);
```

line 11761 `parseChatIntentPrefix`：

```js
    const match = String(prompt || "").match(/^\s*(categorytier|merchant|category|tier|trend|payment|asin|publisherprofile|publisher)\s*[:：]\s*([\s\S]*)?$/i);
```

- [ ] **Step 6: i18n 键**（app.js line 919 `"chat.intent.publisherHint": "媒体记录查询",` 之后加）

```js
      "chat.intent.publisherHint": "媒体记录查询",
      "chat.intent.publisherProfile": "媒体画像",
      "chat.intent.publisherProfileHint": "媒体画像查询",
```

（注意：`translations`（app.js:794）只有 `zh` 区——英文界面走 `data-i18n` 元素的 HTML 默认文本 fallback，与现有 `chat.intent.publisher` 键（仅有 zh 值）同一模式，**不需要**加英文键）

- [ ] **Step 7: 运行测试确认绿灯**

Run: `node scripts/test_chatbot_publisher_profile.mjs`
Expected: `PASS: chatbot publisher profile contract tests (Task 1 static)`

- [ ] **Step 8: 回归既有测试**

Run: `node scripts/test_chatbot_publisher_records.mjs && node scripts/test_chatbot_intent_picker.mjs`
Expected: 仍 PASS（publisher 前缀与菜单前 8 项不受影响）

- [ ] **Step 9: 提交**

```bash
git add public/index.html public/app.js scripts/test_chatbot_publisher_profile.mjs
git commit -m "Add Publisher Profile intent menu option and command prefix / 新增媒体画像意图菜单项与命令前缀"
```

---

### Task 2: publisherprofile 意图检测（hasPublisherProfileIntent + detectQueryIntent 分支）

**Files:**
- Modify: `public/app.js`（新函数插在 `hasPublisherIntent` 之后 ~line 7766；`detectQueryIntent` line 8125 与 8129 两处）
- Test: `scripts/test_chatbot_publisher_profile.mjs`（加 vm 行为段）

**Interfaces:**
- Consumes: 无（纯文本检测）
- Produces: `hasPublisherProfileIntent(prompt) → boolean`；`detectQueryIntent` 在两处 `hasPublisherIntent` 检查**之前**返回 `"publisherprofile"`；hooks 导出 `hasPublisherProfileIntent`

- [ ] **Step 1: 写失败测试**（`test_chatbot_publisher_profile.mjs` 末尾追加 vm 沙箱段）

```js
// ── Task 2: 意图检测（vm 沙箱） ──
import vm from "node:vm";

const storageValues = new Map();
const requests = [];
const publishersCache = JSON.parse(fs.readFileSync("protected_data/db_publishers_cache.json", "utf8"));
const fetchImpl = async (url) => {
  requests.push(String(url));
  if (String(url).indexOf("/api/ui/db/publishers?userId=") !== -1) {
    return { ok: true, async json() { return { ok: true, merchants: [] }; } };
  }
  return { ok: true, async json() { return publishersCache; } };
};
const elementStub = {
  addEventListener() {}, appendChild() {}, insertBefore() {}, remove() {}, click() {}, focus() {},
  replaceChildren() {},
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  dataset: {}, style: {}, querySelector() { return null; }, querySelectorAll() { return []; },
  setAttribute() {}, removeAttribute() {}, closest() { return null; }, reset() {},
  getAttribute() { return null; }, innerHTML: "", textContent: "", outerHTML: "", isConnected: true
};
const sandbox = {
  console: { ...console, warn() {} }, Date, Math, Number, String, RegExp, Array, Object, Set, Map, JSON,
  Uint8Array, TextDecoder, TextEncoder, clearInterval, setInterval, clearTimeout, setTimeout,
  fetch: fetchImpl,
  localStorage: {
    getItem(key) { return storageValues.get(key) || null; },
    setItem(key, value) { storageValues.set(key, value); },
    removeItem(key) { storageValues.delete(key); }
  },
  document: {
    body: { ...elementStub },
    getElementById() { return { ...elementStub }; },
    querySelectorAll() { return []; },
    querySelector() { return { ...elementStub }; },
    createElement() { return { ...elementStub }; },
    addEventListener() {}
  },
  window: {
    __OFFER_INTELLIGENCE_TEST__: true,
    crypto: { randomUUID() { return "00000000-0000-4000-8000-000000000000"; } }
  }
};
sandbox.window.document = sandbox.document;
sandbox.window.localStorage = sandbox.localStorage;
const offersCache = JSON.parse(fs.readFileSync("protected_data/db_offers_cache.json", "utf8"));
sandbox.window.CHATBOT_DATA = {
  summary: offersCache.summary || {}, offers: offersCache.offers || [],
  paymentRecords: offersCache.paymentRecords || [], sources: { mode: "db", month: offersCache.month }
};
sandbox.window.SHEET_REPORT_DATA = {
  sheets: offersCache.sheets || [], tierSheets: ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"]
};
sandbox.window.PRODUCT_KEYWORDS = JSON.parse(fs.readFileSync("protected_data/db_keywords_cache.json", "utf8"));
vm.runInNewContext(fs.readFileSync("public/chatbot_i18n.js", "utf8"), sandbox);
vm.runInNewContext(fs.readFileSync("public/tier2_recommendation_rules.js", "utf8"), sandbox);
vm.runInNewContext(fs.readFileSync("public/app.js", "utf8"), sandbox);

const hooks = sandbox.window.OFFER_INTELLIGENCE_TEST_HOOKS;
if (!hooks) throw new Error("应暴露测试 hooks");

// ── Task 2: 意图检测 ──
// 测试 ID 用真实缓存中存在的 1022（4 位）与 26（2 位短 ID，覆盖短 ID 解析）
assertMatch(String(hooks.hasPublisherProfileIntent("publisherprofile: 1022")), /^true$/, "publisherprofile 前缀应触发画像意图");
assertMatch(String(hooks.hasPublisherProfileIntent("媒体画像 1022")), /^true$/, "中文媒体画像表述应触发画像意图");
assertMatch(String(hooks.hasPublisherProfileIntent("publisher: amazon.de Amazon")), /^false$/, "publisher 前缀不应触发画像意图");
assertMatch(String(hooks.hasPublisherProfileIntent("分析媒体 shokz 的表现")), /^false$/, "分析语句不应触发画像意图");
assertMatch(String(hooks.hasPublisherProfileIntent("Shokz 的销售如何")), /^false$/, "普通商户查询不应误判为画像意图");
if (hooks.detectQueryIntent("publisherprofile: 1022") !== "publisherprofile") throw new Error("detectQueryIntent 应返回 publisherprofile");
if (hooks.detectQueryIntent("publisher: 1022") !== "publisher") throw new Error("publisher 前缀仍应路由到 publisher 意图");
if (hooks.parseChatIntentPrefix("publisherprofile: 1022")?.intent !== "publisherprofile") throw new Error("parseChatIntentPrefix 应解析 publisherprofile");
if (hooks.parseChatIntentPrefix("publisher: 1022")?.intent !== "publisher") throw new Error("parseChatIntentPrefix 不应破坏 publisher");
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `node scripts/test_chatbot_publisher_profile.mjs`
Expected: 在 vm 段抛错（`hooks.hasPublisherProfileIntent is not a function` 或类似）

- [ ] **Step 3: 实现 hasPublisherProfileIntent**（插在 `hasPublisherIntent` 函数结束后，~line 7766）

```js
  // Publisher 画像意图检测：publisherprofile 前缀或中文「媒体画像」表述触发。
  // 不做分析词让位（前缀显式、语义明确），但须在 hasPublisherIntent 之前检查
  // （publisherprofile 文本同时含 publisher 触发词）。
  function hasPublisherProfileIntent(prompt) {
    const lower = String(prompt || "").toLowerCase();
    if (/publisherprofile/i.test(lower)) return true;
    if (/媒体画像/.test(String(prompt || ""))) return true;
    return false;
  }
```

- [ ] **Step 4: detectQueryIntent 两处加分支**（line 8125 与 line 8129 的 `hasPublisherIntent` 检查**之前**各加一行）

line 8125 前（LLM 结果分支内）：

```js
      // 媒体画像前缀在 publisher 列表意图之前检查：publisherprofile 文本同时含 publisher 触发词。
      if (hasPublisherProfileIntent(userMessage)) return "publisherprofile";
      // Publishers 尚未纳入旧版 LLM 意图集合时，仍以本地规则保证媒体查询进入专用路由。
      if (hasPublisherIntent(userMessage)) return "publisher";
```

line 8129 前（正则兜底分支内）：

```js
    if (hasPublisherProfileIntent(userMessage)) return "publisherprofile";
    if (hasPublisherIntent(userMessage)) return "publisher";
```

- [ ] **Step 5: hooks 导出**（app.js line 23569 `hasPublisherIntent,` 后加）

```js
      hasPublisherIntent,
      hasPublisherProfileIntent,
```

- [ ] **Step 6: 运行测试确认绿灯**

Run: `node scripts/test_chatbot_publisher_profile.mjs`
Expected: `PASS: chatbot publisher profile contract tests`

- [ ] **Step 7: 提交**

```bash
git add public/app.js scripts/test_chatbot_publisher_profile.mjs
git commit -m "Add publisher profile intent detection / 新增媒体画像意图检测"
```

---

### Task 3: parsePublisherProfileQuery 媒体匹配解析器

**Files:**
- Modify: `public/app.js`（新函数插在 Task 2 的 `hasPublisherProfileIntent` 之后）
- Test: `scripts/test_chatbot_publisher_profile.mjs`（加 Task 3 vm 断言段）

**Interfaces:**
- Consumes: `_publisherById`（app.js:14742，同 IIFE 作用域）、`PUBLISHER_MARKET_ALIASES`、`publisherAliasMatches`（app.js:7802）、`_publishersCache` 结构（publishers 数组）
- Produces: `parsePublisherProfileQuery(prompt, data) → { mode: "id"|"name"|"none", publisher, candidates[], market, queryText }`

- [ ] **Step 1: 写失败测试**（vm 段 Task 2 断言之后追加）

```js
// ── Task 3: 媒体匹配解析 ──
const pubData = publishersCache;
const q1 = hooks.parsePublisherProfileQuery("publisherprofile: 1022", pubData);
if (q1.mode !== "id" || !q1.publisher) throw new Error("ID 查询应精确匹配媒体");
if (String(q1.publisher.userId) !== "1022") throw new Error("ID 匹配的媒体不正确");
const q1b = hooks.parsePublisherProfileQuery("publisherprofile: 26", pubData);
if (q1b.mode !== "id" || String(q1b.publisher.userId) !== "26") throw new Error("短 ID（2 位）也应精确匹配");
const q2 = hooks.parsePublisherProfileQuery("publisherprofile: 1022 amazon.de", pubData);
if (q2.market !== "amazon.de") throw new Error("应解析出站点 amazon.de");
const q3 = hooks.parsePublisherProfileQuery("publisherprofile: 不存在的媒体xyz", pubData);
if (q3.mode !== "none") throw new Error("无匹配应返回 mode=none");
if (!q3.queryText.includes("不存在的媒体xyz")) throw new Error("应回显查询词");
const q4 = hooks.parsePublisherProfileQuery("publisherprofile:", pubData);
if (q4.mode !== "empty") throw new Error("空查询应返回 mode=empty");
const someName = pubData.publishers[0].userName;
const q5 = hooks.parsePublisherProfileQuery("publisherprofile: " + someName, pubData);
if (q5.mode !== "id" && q5.mode !== "name") throw new Error("名称查询应返回 id 或 name 模式");
if (!q5.publisher && !(q5.candidates || []).length) throw new Error("名称匹配应有结果");
// 名称多匹配 → 候选模式（构造 3 个共享前缀的媒体）
const multiData = { publishers: pubData.publishers.slice(0, 3).map(function (p, i) {
  return { ...p, userId: 1000 + i, userName: "TestMedia 媒体" + (i + 1), total: { ...(p.total || {}), sales: 1000 - i * 100 } };
}), merchantNameMap: pubData.merchantNameMap, networks: pubData.networks };
const q6 = hooks.parsePublisherProfileQuery("publisherprofile: TestMedia", multiData);
if (q6.mode !== "name") throw new Error("名称多匹配应返回 mode=name");
if (q6.publisher !== null) throw new Error("多匹配时 publisher 应为 null");
if (q6.candidates.length !== 3) throw new Error("多匹配应返回全部 3 个候选");
if (q6.candidates[0].userName !== "TestMedia 媒体1") throw new Error("候选应按销售额降序（媒体1 销售额最高）");
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `node scripts/test_chatbot_publisher_profile.mjs`
Expected: `parsePublisherProfileQuery is not a function` 抛错

- [ ] **Step 3: 实现解析器**（插在 `hasPublisherProfileIntent` 之后；完整代码）

```js
  // 解析 publisherprofile 查询：去前缀文本 → 媒体 ID / 名称匹配 + 可选站点。
  // 返回 { mode: "id"|"name"|"empty"|"none", publisher, candidates, market, queryText }。
  // mode=id: 数字精确匹配；mode=name: 名称包含匹配（唯一→publisher，多个→candidates）；
  // mode=empty: 前缀后无文本；mode=none: 无任何匹配。
  function parsePublisherProfileQuery(prompt, data) {
    const text = String(prompt || "").replace(/^\s*publisherprofile\s*[:：]\s*/i, "").trim();
    const source = data || {};
    const publishers = Array.isArray(source.publishers) ? source.publishers : [];
    const base = { market: null, queryText: text };

    // 站点解析（复用 PUBLISHER_MARKET_ALIASES 与 publisherAliasMatches）
    for (const entry of PUBLISHER_MARKET_ALIASES) {
      if (entry.aliases.some(function (alias) { return publisherAliasMatches(text, alias); })) {
        base.market = entry.key;
        break;
      }
    }

    if (!text) return Object.assign({ mode: "empty", publisher: null, candidates: [] }, base);

    // 数字 → 精确 ID 匹配（真实数据 ID 长度 1-4 位，逐 token 精确匹配，失败则回落名称匹配）
    const idMatches = text.match(/\b\d{1,10}\b/g) || [];
    if (idMatches.length) {
      for (const idStr of idMatches) {
        const publisher = _publisherById(source, idStr);
        if (publisher) return Object.assign({ mode: "id", publisher: publisher, candidates: [] }, base);
      }
    }

    // 名称 → 忽略大小写包含匹配
    const lowered = text.toLowerCase();
    const matches = publishers.filter(function (pub) {
      return String(pub.userName || "").toLowerCase().indexOf(lowered) !== -1;
    });
    if (matches.length === 1) {
      return Object.assign({ mode: "name", publisher: matches[0], candidates: [] }, base);
    }
    if (matches.length > 1) {
      matches.sort(function (a, b) {
        return Number((b.total || {}).sales || 0) - Number((a.total || {}).sales || 0);
      });
      return Object.assign({ mode: "name", publisher: null, candidates: matches }, base);
    }
    return Object.assign({ mode: "none", publisher: null, candidates: [] }, base);
  }
```

- [ ] **Step 4: hooks 导出**（Task 2 加的 `hasPublisherProfileIntent,` 后加）

```js
      hasPublisherProfileIntent,
      parsePublisherProfileQuery,
```

- [ ] **Step 5: 运行测试确认绿灯**

Run: `node scripts/test_chatbot_publisher_profile.mjs`
Expected: Task 3 断言全过

- [ ] **Step 6: 提交**

```bash
git add public/app.js scripts/test_chatbot_publisher_profile.mjs
git commit -m "Add publisher profile query parser / 新增媒体画像查询解析器"
```

---

### Task 4: 画像计算层 marketOverride + 纯行构建函数

**Files:**
- Modify: `public/app.js`（`_publisherAffinitySummary` line 15048 加可选参数；新函数 `publisherProfileRowsForMarket` 插在 `_publisherPortfolioRowsForState` 之后 ~line 15038）
- Test: `scripts/test_chatbot_publisher_profile.mjs`（加 Task 4 vm 断言段）
- 回归: `scripts/test_publisher_manager_tier_frontend.mjs`

**Interfaces:**
- Consumes: `_publisherMetricForMarket`（app.js:14917）、`_publisherMetricIsActive`（app.js:14953）、`_publisherAffinitySummary`（app.js:15048）
- Produces: `_publisherAffinitySummary(rows, marketOverride)`（第二参可选，独立页行为不变）；`publisherProfileRowsForMarket(merchants, market) → [{merchant, metrics}]`

- [ ] **Step 1: 写失败测试**（vm 段 Task 3 断言之后追加）

```js
// ── Task 4: marketOverride 与纯行构建 ──
const merchantsFixture = [
  {
    merchantId: 1001, merchantName: "测试商家A", category: "Beauty", network: "Archer", tier: "Tier 2",
    markets: {
      "amazon.com": { clicks: 100, dpv: 50, atc: 20, orders: 10, sales: 500, allCommission: 40, affCommission: 30, aov: 50, epc: 0.3, conversionRate: 0.1, effectiveCommissionRate: 8 },
      "amazon.de": { clicks: 10, dpv: 5, atc: 2, orders: 1, sales: 50, allCommission: 4, affCommission: 3, aov: 50, epc: 0.3, conversionRate: 0.1, effectiveCommissionRate: 8 }
    },
    total: { clicks: 110, dpv: 55, atc: 22, orders: 11, sales: 550, allCommission: 44, affCommission: 33, aov: 50, epc: 0.3, conversionRate: 0.1, effectiveCommissionRate: 8 }
  },
  {
    merchantId: 1002, merchantName: "测试商家B", category: "Electronics", network: "Levanta", tier: "Tier 3",
    markets: {
      "amazon.com": { clicks: 50, dpv: 25, atc: 10, orders: 5, sales: 1000, allCommission: 80, affCommission: 60, aov: 200, epc: 1.2, conversionRate: 0.1, effectiveCommissionRate: 8 }
    },
    total: { clicks: 50, dpv: 25, atc: 10, orders: 5, sales: 1000, allCommission: 80, affCommission: 60, aov: 200, epc: 1.2, conversionRate: 0.1, effectiveCommissionRate: 8 }
  }
];
const rowsAll = hooks.publisherProfileRowsForMarket(merchantsFixture, "all");
if (rowsAll.length !== 2) throw new Error("all 口径应返回全部活跃商家行");
const rowsDe = hooks.publisherProfileRowsForMarket(merchantsFixture, "amazon.de");
if (rowsDe.length !== 1 || rowsDe[0].merchant.merchantId !== 1001) throw new Error("站点口径应只返回该站点有活跃指标的商家");
if (rowsDe[0].metrics.clicks !== 10) throw new Error("站点口径指标应取该市场数值");
// marketOverride：state.publisherMarket 被污染时显式参数应生效
const allSummary = hooks.publisherAffinitySummary(rowsAll, "all");
if (allSummary.markets.length !== 2) throw new Error("all 口径应统计 2 个市场");
const deSummary = hooks.publisherAffinitySummary(rowsAll, "amazon.de");
if (deSummary.markets.length !== 1 || deSummary.markets[0].market !== "amazon.de") throw new Error("marketOverride 应限定市场统计");
if (deSummary.sales !== 50) throw new Error("marketOverride 应按站点口径汇总销售额");
if (!(deSummary.categories.length === 1 && deSummary.categories[0].category === "Beauty")) throw new Error("marketOverride 品类聚合应按站点口径");
// 不传第二参行为不变（回归现有 hooks 用法）
const legacySummary = hooks.publisherAffinitySummary(rowsAll);
if (legacySummary.sales !== 550) throw new Error("不传 marketOverride 时应按 all 口径汇总");
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `node scripts/test_chatbot_publisher_profile.mjs`
Expected: `publisherProfileRowsForMarket is not a function` 抛错

- [ ] **Step 3: 实现 publisherProfileRowsForMarket**（插在 `_publisherPortfolioRowsForState` 结束之后、`_publisherAovBand` 之前，~line 15038）

```js
  // 画像商家行构建：仅按站点口径取指标 + 活跃过滤。
  // 不复用 _publisherPortfolioRowsForState——它读取 state.publisherNetwork / state.publisherMerchantSearch，
  // 页面残留状态会污染 chatbot 画像；画像场景不需要这些页面级筛选。
  function publisherProfileRowsForMarket(merchants, market) {
    return (merchants || []).map(function (merchant) {
      return { merchant: merchant, metrics: _publisherMetricForMarket(merchant, market) };
    }).filter(function (row) {
      return _publisherMetricIsActive(row.metrics);
    });
  }
```

- [ ] **Step 4: _publisherAffinitySummary 加 marketOverride 参数**（line 15048 与 line 15116-15117 两处）

line 15048 签名：

```js
  function _publisherAffinitySummary(rows, marketOverride) {
```

line 15116-15117 市场统计（原代码读 `state.publisherMarket`）：

```js
      const marketKey = marketOverride !== undefined ? marketOverride : state.publisherMarket;
      var marketNames = marketKey && marketKey !== "all"
        ? [marketKey]
        : Object.keys(merchant.markets || {});
```

（`_publisherPortfolioRowsForState` 内部读 `state.publisherMarket` 的地方**不要动**，独立页行为保持不变）

- [ ] **Step 5: hooks 导出**（Task 3 加的 `parsePublisherProfileQuery,` 后加）

```js
      parsePublisherProfileQuery,
      publisherProfileRowsForMarket,
```

（`publisherAffinitySummary: _publisherAffinitySummary` 已在 line 23690 导出，无需改动）

- [ ] **Step 6: 运行测试确认绿灯 + 回归独立页测试**

Run: `node scripts/test_chatbot_publisher_profile.mjs && node scripts/test_publisher_manager_tier_frontend.mjs`
Expected: 两者全过（`publisherAffinitySummary` 不传第二参行为不变）

- [ ] **Step 7: 提交**

```bash
git add public/app.js scripts/test_chatbot_publisher_profile.mjs
git commit -m "Add marketOverride to affinity summary and pure portfolio row builder / 新增画像汇总站点覆盖参数与纯商家行构建"
```

---

### Task 5: 画像渲染纯函数（renderPublisherProfileHtml + 候选/未找到/用法）

**Files:**
- Modify: `public/app.js`（4 个新纯函数插在 `renderPublisherRecordsHtml` 之后、`publisherRecordsPlaceholderCounter` 之前，~line 8066）
- Test: `scripts/test_chatbot_publisher_profile.mjs`（加 Task 5 vm 断言段）

**Interfaces:**
- Consumes: Task 3 `parsePublisherProfileQuery`、Task 4 `publisherProfileRowsForMarket` / `_publisherAffinitySummary(rows, market)`；现有 `_publisherMetricAffCommissionRate`、`_publisherMetricAffCommission`、`_publisherMetricAffEpc`、`_publisherMetricConversionRate`、`_publisherAovBand`、`_publisherAovText`、`_publisherRateText`、`_publisherTierTone`、`PUBLISHER_KPI_METRICS`、`escapeHtml`/`number`/`money`/`shortMoney`/`shortEpc`/`shortPct`（同 IIFE 作用域，运行时均已完成初始化）
- Produces: `renderPublisherProfileHtml(query, pub, merchants, language) → string`；`renderPublisherProfileCandidatesHtml(candidates, queryText, language)`；`renderPublisherProfileNotFoundHtml(queryText, language)`；`renderPublisherProfileUsageHtml(language)`

- [ ] **Step 1: 写失败测试**（vm 段 Task 4 断言之后追加）

```js
// ── Task 5: 画像渲染 ──
const profilePub = pubData.publishers[0];
const zhHtml = hooks.renderPublisherProfileHtml("publisherprofile: " + profilePub.userId, profilePub, merchantsFixture, "zh");
if (!zhHtml.includes("媒体画像")) throw new Error("中文标题应显示媒体画像");
if (!zhHtml.includes("ID " + profilePub.userId)) throw new Error("头部应显示媒体 ID");
if (!zhHtml.includes("Clicks")) throw new Error("应含 6 个 publisher 级 KPI（Clicks 等）");
if (!zhHtml.includes("活跃商家")) throw new Error("应含画像指标卡（活跃商家）");
if (!zhHtml.includes("品类偏好")) throw new Error("应含品类偏好区块");
if (!zhHtml.includes("典型 AOV 区间")) throw new Error("应含偏好信号（典型 AOV 区间）");
if (!zhHtml.includes("商家")) throw new Error("应含合作商家表头");
if (!zhHtml.includes("测试商家A")) throw new Error("商家表应含商家名称");
if (!zhHtml.includes("publisher-category-row")) throw new Error("品类条应复用独立页样式类");
if (!zhHtml.includes("publisher-share-cell")) throw new Error("商家份额应复用独立页样式类");
if (!zhHtml.includes("共 2")) throw new Error("应显示商家数量统计");
const enHtml = hooks.renderPublisherProfileHtml("publisherprofile: " + profilePub.userId, profilePub, merchantsFixture, "en");
if (!enHtml.includes("Publisher Profile")) throw new Error("英文标题应显示 Publisher Profile");
if (!enHtml.includes("Typical AOV band")) throw new Error("英文信号文案应显示 Typical AOV band");
// 站点口径回显
const marketHtml = hooks.renderPublisherProfileHtml("publisherprofile: " + profilePub.userId + " amazon.de", profilePub, merchantsFixture, "zh");
if (!marketHtml.includes("站点 amazon.de")) throw new Error("应回显站点筛选条件");
// 空商家明细
const emptyMerchantsHtml = hooks.renderPublisherProfileHtml("publisherprofile: " + profilePub.userId, profilePub, [], "zh");
if (!emptyMerchantsHtml.includes("无商家数据")) throw new Error("空明细应显示无商家数据提示");
// 候选列表
const candHtml = hooks.renderPublisherProfileCandidatesHtml([profilePub, pubData.publishers[1]], "shokz", "zh");
if (!candHtml.includes("匹配到多个媒体")) throw new Error("候选列表应有多匹配提示");
if (!candHtml.includes(profilePub.userName)) throw new Error("候选列表应含媒体名称");
if (!candHtml.includes(String(profilePub.userId))) throw new Error("候选列表应含媒体 ID");
// 未找到
const notFoundHtml = hooks.renderPublisherProfileNotFoundHtml("不存在的媒体xyz", "zh");
if (!notFoundHtml.includes("未找到匹配的媒体")) throw new Error("未找到提示应显示未找到匹配的媒体");
if (!notFoundHtml.includes("不存在的媒体xyz")) throw new Error("未找到提示应回显查询词");
// 用法提示
const usageHtml = hooks.renderPublisherProfileUsageHtml("zh");
if (!usageHtml.includes("publisherprofile: 1022")) throw new Error("用法提示应含示例");
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `node scripts/test_chatbot_publisher_profile.mjs`
Expected: `renderPublisherProfileHtml is not a function` 抛错

- [ ] **Step 3: 实现 4 个渲染纯函数**（插在 `renderPublisherRecordsHtml` 结束之后，~line 8066；完整代码）

```js
  // ── 媒体画像渲染（publisherprofile 意图）──────────────────
  // 输出结构与 Publishers 独立页选中媒体后的画像面板对齐：
  // 头部 + 6 个 publisher 级 KPI + 4 个画像指标卡 + 品类偏好 + 偏好信号 + 合作商家明细表。
  // 纯函数：接收数据返回 HTML 字符串，复用独立页样式类（styles.css 全局类，Deep Window 内可用）。

  function publisherProfileMetricFor(pub, market) {
    return (market && pub.markets && pub.markets[market]) || pub.total || {};
  }

  function publisherProfileTitle(language) {
    return language === "zh" ? "媒体画像" : "Publisher Profile";
  }

  // 用法提示（前缀后为空）
  function renderPublisherProfileUsageHtml(language) {
    const zh = language === "zh";
    return '<div class="analysis-section publisher-profile-section"><h4>' + publisherProfileTitle(language) + '</h4>' +
      '<p class="warning">' + (zh ? "请提供媒体名称或 ID，例如：" : "Provide a publisher name or ID, e.g.: ") +
      '<code>publisherprofile: 1022</code>' + (zh ? " 或 " : " or ") +
      '<code>publisherprofile: ' + (zh ? "媒体名 amazon.de" : "name amazon.de") + '</code></p></div>';
  }

  // 未找到提示
  function renderPublisherProfileNotFoundHtml(queryText, language) {
    const zh = language === "zh";
    return '<div class="analysis-section publisher-profile-section"><h4>' + publisherProfileTitle(language) + '</h4>' +
      '<p class="warning">' + (zh ? "未找到匹配的媒体。" : "No matching publisher found.") + '</p>' +
      (queryText ? '<p><small>' + escapeHtml(queryText) + '</small></p>' : "") +
      '</div>';
  }

  // 名称多匹配候选列表（按销售降序）
  function renderPublisherProfileCandidatesHtml(candidates, queryText, language) {
    const zh = language === "zh";
    const rows = (candidates || []).map(function (pub) {
      return "<tr>" +
        "<td>" + escapeHtml(String(pub.userName || "")) + "</td>" +
        "<td>" + escapeHtml(String(pub.userId || "")) + "</td>" +
        "<td class=\"num\">" + money(Number((pub.total || {}).sales || 0)) + "</td>" +
        "</tr>";
    }).join("");
    const header = "<tr><th>" + (zh ? "媒体名称" : "Publisher Name") + "</th><th>" +
      (zh ? "媒体 ID" : "Publisher ID") + "</th><th>" + (zh ? "销售额" : "Sales") + "</th></tr>";
    return '<div class="analysis-section publisher-profile-section"><h4>' + publisherProfileTitle(language) + '</h4>' +
      '<p><small>' + escapeHtml(queryText || "") + (zh ? " · 匹配到多个媒体，请用媒体 ID 再次提问" : " · multiple matches, use the publisher ID instead") + '</small></p>' +
      '<div class="table-wrap"><table><thead>' + header + '</thead><tbody>' + rows + '</tbody></table></div>' +
      '</div>';
  }

  // 完整画像。第五参 degradedNote：商家明细加载失败时注入警告条（可选）。
  function renderPublisherProfileHtml(query, pub, merchants, language, degradedNote) {
    const zh = language === "zh";
    const parsed = parsePublisherProfileQuery(query, { publishers: [pub], merchantNameMap: {} });
    const market = parsed.market;
    const metric = publisherProfileMetricFor(pub, market);
    const rows = publisherProfileRowsForMarket(merchants, market || "all");
    const summary = _publisherAffinitySummary(rows, market || "all");

    // 头部
    const head = '<div class="publisher-profile-head">' +
      '<span class="publisher-profile-avatar">' + escapeHtml(String(pub.userName || pub.userId || "?").slice(0, 1).toUpperCase()) + '</span>' +
      '<div><strong>' + escapeHtml(String(pub.userName || pub.userId || "")) + '</strong>' +
      '<small>ID ' + escapeHtml(String(pub.userId)) + ' · ' + escapeHtml(String(pub.adminName || "Unknown")) + ' · ' +
      escapeHtml(Array.isArray(pub.networks) ? pub.networks.join(", ") : "Unknown") + '</small></div></div>';

    const conditionNote = market ? '<p><small>' + (zh ? "站点 " : "market ") + escapeHtml(market) + '</small></p>' : "";

    // 6 个 publisher 级 KPI（复用 PUBLISHER_KPI_METRICS 定义与 .metric 结构）
    const kpiCards = PUBLISHER_KPI_METRICS.map(function (m, index) {
      const val = metric[m.key] != null ? metric[m.key] : 0;
      return '<article class="metric" style="--i:' + index + '">' +
        '<div class="metric-icon ' + escapeHtml(m.tone) + '">' + escapeHtml(m.icon) + '</div>' +
        '<div class="metric-body">' +
          '<span class="metric-label">' + escapeHtml(m.label) + '</span>' +
          '<strong class="metric-value">' + m.format(val) + '</strong>' +
          '<span class="metric-full">' + escapeHtml(m.fullFormat(val)) + '</span>' +
        '</div></article>';
    }).join("");

    // 4 个画像指标卡（复用 .publisher-affinity-metric 结构）
    const topCategory = summary.categories[0] ? summary.categories[0].category : "N/A";
    const affinityCards = [
      {
        label: zh ? "活跃商家" : "Active merchants",
        value: String(summary.merchantCount),
        note: zh ? "当前口径" : "in current view",
      },
      {
        label: "AOV",
        value: _publisherAovText(summary.aov),
        note: String(summary.orders) + " " + (zh ? "订单" : "orders"),
      },
      {
        label: zh ? "Top 品类" : "Top category",
        value: topCategory,
        note: summary.categories[0]
          ? (summary.categories[0].salesShare * 100).toFixed(1) + "% " + (zh ? "销售占比" : "of sales")
          : (zh ? "无活跃数据" : "No activity"),
      },
      {
        label: zh ? "加权 AFF 佣金率" : "AFF weighted commission rate",
        value: _publisherRateText(summary.weightedCommissionRate),
        note: zh ? "按商家销售额加权" : "weighted by merchant sales",
      },
    ].map(function (card) {
      return '<article class="publisher-affinity-metric">' +
        '<span>' + escapeHtml(card.label) + '</span>' +
        '<strong title="' + escapeHtml(card.value) + '">' + escapeHtml(card.value) + '</strong>' +
        '<small>' + escapeHtml(card.note) + '</small></article>';
    }).join("");

    // 品类偏好 Top 6
    const categories = summary.categories.slice(0, 6);
    const categoryBlock = categories.length
      ? categories.map(function (item, index) {
          const share = summary.sales > 0
            ? item.salesShare
            : item.merchantCount / Math.max(1, summary.merchantCount);
          return '<div class="publisher-category-row">' +
            '<div class="publisher-category-copy">' +
              '<span class="publisher-category-rank">' + (index + 1) + '</span>' +
              '<strong title="' + escapeHtml(item.category) + '">' + escapeHtml(item.category) + '</strong>' +
              '<small>' + String(item.merchantCount) + ' ' + (zh ? "个商家" : "merchants") + '</small>' +
            '</div>' +
            '<div class="publisher-category-track" aria-label="' + escapeHtml(item.category) + ' ' + (share * 100).toFixed(1) + '%">' +
              '<span style="width:' + Math.max(2, share * 100).toFixed(1) + '%"></span>' +
            '</div>' +
            '<span class="publisher-category-share">' + (share * 100).toFixed(1) + '%</span>' +
          '</div>';
        }).join("")
      : '<div class="publisher-affinity-inline-empty">' +
        (zh ? "该口径下无品类活跃数据" : "No category activity in this view") + '</div>';

    // 偏好信号 4 行
    const topBand = summary.aovBands.filter(function (band) { return band.label !== "N/A"; })[0] || summary.aovBands[0] || null;
    const topMarket = summary.markets[0] || null;
    const signals = [
      {
        label: zh ? "典型 AOV 区间" : "Typical AOV band",
        value: topBand ? topBand.label : "N/A",
        note: topBand ? (topBand.salesShare * 100).toFixed(1) + "% " + (zh ? "销售占比" : "of sales") : (zh ? "无活跃数据" : "No activity"),
      },
      {
        label: zh ? "品类集中度" : "Category concentration",
        value: summary.categories[0] ? (summary.categories[0].salesShare * 100).toFixed(1) + "%" : "N/A",
        note: summary.categories[0] ? summary.categories[0].category : (zh ? "无活跃数据" : "No activity"),
      },
      {
        label: zh ? "AFF 佣金画像" : "AFF commission profile",
        value: _publisherRateText(summary.weightedCommissionRate),
        note: _publisherRateText(summary.effectiveCommissionRate) + " " + (zh ? "有效 AFF 费率" : "effective AFF rate"),
      },
      {
        label: zh ? "市场覆盖" : "Market reach",
        value: String(summary.markets.length),
        note: topMarket ? (zh ? "领跑市场 " : "Leads with ") + topMarket.market : (zh ? "无活跃数据" : "No activity"),
      },
    ].map(function (signal, index) {
      return '<div class="publisher-signal-row">' +
        '<span class="publisher-signal-index">0' + (index + 1) + '</span>' +
        '<div><small>' + escapeHtml(signal.label) + '</small><strong>' + escapeHtml(signal.value) + '</strong><p>' +
          escapeHtml(signal.note) + '</p></div></div>';
    }).join("");

    // 合作商家明细表（12 列，对齐独立页 _renderPublisherPortfolioTable 结构）
    const merchantHeader = "<tr>" +
      "<th>" + (zh ? "商家" : "Merchant") + "</th>" +
      "<th>" + (zh ? "联盟 / 市场" : "Network / Market") + "</th>" +
      "<th>" + (zh ? "品类" : "Category") + "</th>" +
      "<th>Tier</th>" +
      "<th>AOV</th><th>EPC</th><th>CVR</th>" +
      "<th>" + (zh ? "佣金率" : "Rate") + "</th>" +
      "<th>" + (zh ? "订单" : "Orders") + "</th>" +
      "<th>" + (zh ? "销售" : "Sales") + "</th>" +
      "<th>" + (zh ? "AFF 佣金" : "AFF Comm") + "</th>" +
      "<th>" + (zh ? "份额" : "Share") + "</th>" +
      "</tr>";
    const merchantBody = rows.length
      ? rows.map(function (row) {
          const merchant = row.merchant;
          const m = row.metrics;
          const marketNames = Object.keys(merchant.markets || {}).filter(function (marketName) {
            return _publisherMetricIsActive(merchant.markets[marketName]);
          });
          const visibleMarkets = market ? marketNames.filter(function (marketName) { return marketName === market; }) : marketNames;
          let marketText = visibleMarkets.slice(0, 2).join(" · ");
          if (visibleMarkets.length > 2) marketText += " +" + (visibleMarkets.length - 2);
          const share = summary.sales > 0 ? Number(m.sales || 0) / summary.sales : 0;
          return '<tr>' +
            '<td><div class="publisher-merchant-cell"><strong>' +
              escapeHtml(merchant.merchantName || String(merchant.merchantId)) +
            '</strong><small>ID ' + escapeHtml(String(merchant.merchantId)) + '</small></div></td>' +
            '<td><div class="publisher-network-market"><span>' +
              escapeHtml(merchant.network || "Unknown") +
            '</span><small>' + escapeHtml(marketText || "Unknown") + '</small></div></td>' +
            '<td><span class="publisher-category-pill">' + escapeHtml(merchant.category || "Uncategorized") + '</span></td>' +
            '<td><span class="publisher-tier-pill ' + _publisherTierTone(merchant.tier) + '">' +
              escapeHtml(merchant.tier || "Unknown") + '</span></td>' +
            '<td class="publisher-numeric publisher-aov-cell">' + escapeHtml(_publisherAovText(m.aov)) + '</td>' +
            '<td class="publisher-numeric">' + escapeHtml(shortEpc(_publisherMetricAffEpc(m))) + '</td>' +
            '<td class="publisher-numeric">' + escapeHtml(shortPct(_publisherMetricConversionRate(m))) + '</td>' +
            '<td class="publisher-numeric">' + escapeHtml(_publisherRateText(_publisherMetricAffCommissionRate(m))) + '</td>' +
            '<td class="publisher-numeric">' + String(Number(m.orders || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + '</td>' +
            '<td class="publisher-numeric">' + escapeHtml(shortMoney(m.sales)) + '</td>' +
            '<td class="publisher-numeric">' + escapeHtml(shortMoney(_publisherMetricAffCommission(m) || 0)) + '</td>' +
            '<td class="publisher-numeric publisher-share-column"><div class="publisher-share-cell"><span>' +
              (share * 100).toFixed(1) + '%</span><i><b style="width:' + Math.max(1, share * 100).toFixed(1) + '%"></b></i></div></td>' +
          '</tr>';
        }).join("")
      : '<tr><td colspan="12" class="publisher-portfolio-empty">' +
        (zh ? "无商家数据" : "No merchant data") + '</td></tr>';

    const degradedWarning = degradedNote ? '<p class="warning">' + escapeHtml(degradedNote) + '</p>' : "";

    return '<div class="analysis-section publisher-profile-section"><h4>' + publisherProfileTitle(language) + '</h4>' +
      conditionNote + degradedWarning + head +
      '<div class="publisher-profile-kpis">' + kpiCards + '</div>' +
      '<div class="publisher-affinity-metrics">' + affinityCards + '</div>' +
      '<h5>' + (zh ? "品类偏好" : "Category affinity") + '</h5>' + categoryBlock +
      '<h5>' + (zh ? "偏好信号" : "Affinity signals") + '</h5>' + signals +
      '<h5>' + (zh ? "合作商家（" : "Partner merchants (") + String(rows.length) + "）</h5>" +
      '<div class="table-wrap"><table><thead>' + merchantHeader + '</thead><tbody>' + merchantBody + '</tbody></table></div>' +
      '<p><small>' + (zh ? "共 " : "Total: ") + String(rows.length) + (zh ? " 个商家 · 按销售额降序" : " merchants · ranked by sales desc") + '</small></p>' +
      '</div>';
  }
```

- [ ] **Step 4: hooks 导出**（Task 4 加的 `publisherProfileRowsForMarket,` 后加）

```js
      publisherProfileRowsForMarket,
      renderPublisherProfileHtml,
      renderPublisherProfileCandidatesHtml,
      renderPublisherProfileNotFoundHtml,
      renderPublisherProfileUsageHtml,
```

- [ ] **Step 5: 运行测试确认绿灯**

Run: `node scripts/test_chatbot_publisher_profile.mjs`
Expected: Task 5 断言全过（若「共 2」断言失败，检查渲染输出中数量统计文案与断言一致）

- [ ] **Step 6: 提交**

```bash
git add public/app.js scripts/test_chatbot_publisher_profile.mjs
git commit -m "Add publisher profile rendering functions / 新增媒体画像渲染函数"
```

---

### Task 6: publisherProfileAnswer 回答入口 + answerPrompt 路由

**Files:**
- Modify: `public/app.js`（`publisherProfileAnswer` 插在 `publisherRecordsAnswer` 之后 ~line 8107；`answerPrompt` line 10150 附近加分支；hooks 导出）
- Test: `scripts/test_chatbot_publisher_profile.mjs`（加 Task 6 vm 断言段）

**Interfaces:**
- Consumes: Task 3 `parsePublisherProfileQuery`、Task 5 渲染函数、现有 `loadPublishersData`（app.js:14820）、`loadPublisherPortfolioData`（app.js:14797）、`updatePublisherRecordsDeepCache`（app.js:8069）、`responseLanguageFor`（app.js:1201）、`_publishersCache`
- Produces: `publisherProfileAnswer(prompt) → string`（同步渲染或占位 HTML）；`answerPrompt` 的 `intent === "publisherprofile"` 路由

- [ ] **Step 1: 写失败测试**（vm 段 Task 5 断言之后追加）

```js
// ── Task 6: 回答入口与路由 ──
// answerPrompt 路由断言用静态匹配（vm 沙箱缺少完整 DOM/state，不直接调用 answerPrompt）
assertMatch(app, /if \(intent === "publisherprofile"\) \{[\s\S]{0,80}return publisherProfileAnswer\(prompt\);/,
  "answerPrompt 应路由 publisherprofile 意图到 publisherProfileAnswer");
const answer = hooks.publisherProfileAnswer("publisherprofile: 1022");
if (!answer.includes("正在加载")) throw new Error("缓存未加载时应返回占位");
// 触发加载（fetch stub 返回真实缓存 → 唯一匹配 → portfolio 请求）
await new Promise(function (resolve) { setTimeout(resolve, 50); });
if (!requests.some(function (url) { return url === "/api/ui/db/publishers"; })) {
  throw new Error("应请求 publishers 数据");
}
if (!requests.some(function (url) { return url.indexOf("/api/ui/db/publishers?userId=1022") !== -1; })) {
  throw new Error("唯一匹配后应请求该媒体的商家明细");
}
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `node scripts/test_chatbot_publisher_profile.mjs`
Expected: `publisherProfileAnswer is not a function` 抛错

- [ ] **Step 3: 实现 publisherProfileAnswer**（插在 `publisherRecordsAnswer` 结束之后，~line 8107；完整代码）

```js
  let publisherProfilePlaceholderCounter = 0;

  // 媒体画像回答入口：
  // 缓存未加载 → 占位 + loadPublishersData + 重走匹配流程（trend 占位模式，复用 updatePublisherRecordsDeepCache）。
  // 已加载 → 解析匹配：空/无匹配/多匹配同步返回；唯一匹配 → 占位 + portfolio 请求 + 渲染替换。
  function publisherProfileAnswer(prompt) {
    const language = responseLanguageFor(prompt);
    const zh = language === "zh";
    const source = _publishersCache;

    const placeholderHtml = function (placeholderId, text) {
      return '<div id="' + placeholderId + '" class="analysis-section publisher-profile-section"><p><em>' + text + '</em></p></div>';
    };
    const replacePlaceholder = function (placeholderId, renderedHtml) {
      const container = document.getElementById(placeholderId);
      if (container) container.innerHTML = renderedHtml;
      updatePublisherRecordsDeepCache(placeholderId, container, renderedHtml);
    };
    const renderFromCache = function (cache) {
      const parsed = parsePublisherProfileQuery(prompt, cache);
      if (parsed.mode === "empty") return renderPublisherProfileUsageHtml(language);
      if (parsed.mode === "none") return renderPublisherProfileNotFoundHtml(parsed.queryText, language);
      if (parsed.mode === "name" && !parsed.publisher) {
        return renderPublisherProfileCandidatesHtml(parsed.candidates, parsed.queryText, language);
      }
      // 唯一匹配 → 需要 portfolio 商家明细（异步占位）
      const publisher = parsed.publisher;
      const placeholderId = "publisher-profile-" + Date.now() + "-" + (++publisherProfilePlaceholderCounter);
      setTimeout(function () {
        loadPublisherPortfolioData(publisher.userId)
          .then(function (portfolio) {
            const html = renderPublisherProfileHtml(prompt, publisher, (portfolio && portfolio.merchants) || [], language);
            replacePlaceholder(placeholderId, html);
          })
          .catch(function () {
            // 商家明细失败：头部 + KPI 正常渲染，商家表空 + 警告条（第五参 degradedNote）
            const html = renderPublisherProfileHtml(prompt, publisher, [], language,
              zh ? "媒体商家数据暂时不可用。" : "Publisher merchant data is temporarily unavailable.");
            replacePlaceholder(placeholderId, html);
          });
      }, 0);
      return placeholderHtml(placeholderId, zh ? "正在加载媒体画像…" : "Loading publisher profile…");
    };

    if (!source) {
      const placeholderId = "publisher-profile-" + Date.now() + "-" + (++publisherProfilePlaceholderCounter);
      setTimeout(function () {
        loadPublishersData()
          .then(function () { replacePlaceholder(placeholderId, renderFromCache(_publishersCache)); })
          .catch(function () {
            replacePlaceholder(placeholderId,
              '<div class="analysis-section publisher-profile-section"><p class="warning">' +
              (zh ? "Publishers 数据暂时不可用。" : "Publisher data is temporarily unavailable.") + '</p></div>');
          });
      }, 0);
      return placeholderHtml(placeholderId, zh ? "正在加载媒体数据…" : "Loading publisher data…");
    }
    return renderFromCache(source);
  }
```

- [ ] **Step 4: answerPrompt 路由分支**（line 10150 `if (intent === "publisher") {` 之前插入）

```js
    if (intent === "publisherprofile") {
      return publisherProfileAnswer(prompt);
    }
    if (intent === "publisher") {
      return publisherRecordsAnswer(prompt);
    }
```

- [ ] **Step 5: hooks 导出**（Task 5 加的 `renderPublisherProfileUsageHtml,` 后加）

```js
      renderPublisherProfileUsageHtml,
      publisherProfileAnswer,
      loadPublishersData,
```

- [ ] **Step 6: 运行测试确认绿灯**

Run: `node scripts/test_chatbot_publisher_profile.mjs`
Expected: Task 6 断言全过

- [ ] **Step 7: 提交**

```bash
git add public/app.js scripts/test_chatbot_publisher_profile.mjs
git commit -m "Add publisher profile answer entry and route / 新增媒体画像回答入口与路由"
```

---

### Task 7: 说明书 9 类型（中英）+ 同步既有测试

**Files:**
- Modify: `public/app.js`（`REPORT_MODE_HELP_MD` line 2387-2469；`REPORT_MODE_HELP_MD_EN` line 2521-2603）
- Modify: `scripts/test_chatbot_intent_picker.mjs`（line 20 循环、line 87、line 90）
- Test: `scripts/test_chatbot_publisher_profile.mjs`（加 Task 7 静态断言）

**Interfaces:**
- Consumes: 无
- Produces: 说明书「提问类型命令」表格 9 行、标题 9 种；「支持的提问类型」新增媒体画像小节（中英）

- [ ] **Step 1: 写失败测试**（`test_chatbot_publisher_profile.mjs` 顶部静态段追加）

```js
// ── Task 7: 说明书 9 类型 ──
assertMatch(app, /### 9 种提问类型/, "中文说明书应列出全部 9 种提问类型");
assertMatch(app, /### The 9 Question Types/, "英文说明书应列出全部 9 种提问类型");
assertMatch(app, /\| Publisher Profile（媒体画像） \| publisherprofile: \|/, "中文说明书应提供 Publisher Profile 行");
assertMatch(app, /\| Publisher Profile \| publisherprofile: \|/, "英文说明书应提供 Publisher Profile 行");
assertMatch(app, /publisherprofile: 1022/, "说明书应提供 publisherprofile 示例");
assertMatch(app, /### 7\. 媒体画像查询/, "中文说明书应提供媒体画像查询小节");
assertMatch(app, /### 1\.7 Publisher Profile/, "英文说明书应提供 Publisher Profile 小节");
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `node scripts/test_chatbot_publisher_profile.mjs`
Expected: 第一个新增断言 `未匹配 /### 9 种提问类型/` 抛错

- [ ] **Step 3: 修改中文说明书**（`REPORT_MODE_HELP_MD` 内，注意模板字符串内不得出现未转义反引号或 `${}`）

3a. line 2399 前缀列表 `**asin:**` 后加 `、**publisherprofile:**`：

```
- 也可手动输入前缀：**merchant:**、**category:**、**tier:**、**categorytier:**、**trend:**、**payment:**、**asin:**、**publisher:**、**publisherprofile:**，支持半角与全角冒号（: 与 ：）。
```

3b. line 2402 标题 `### 8 种提问类型` → `### 9 种提问类型`

3c. line 2413 表格 Publisher 行之后加：

```
| Publisher Profile（媒体画像） | publisherprofile: | 输入媒体名称或 ID 查看合作商家与偏好 | publisherprofile: 1022 |
```

3d. line 2469（媒体记录查询小节表格之后、`## 三、交互说明` 之前）插入新小节：

```
### 7. 媒体画像查询

| 标准提问 | 说明 |
| --- | --- |
| publisherprofile: 1022 | 按媒体 ID 查看画像 |
| publisherprofile: 媒体名称 | 按名称查看（多匹配时列出候选） |
| publisherprofile: 1022 amazon.de | 按站点口径查看画像 |
```

- [ ] **Step 4: 修改英文说明书**（`REPORT_MODE_HELP_MD_EN` 内）

4a. line 2533 前缀列表 `**asin:**` 后加 `, **publisherprofile:**`：

```
- You can also type a prefix manually: **merchant:**, **category:**, **tier:**, **categorytier:**, **trend:**, **payment:**, **asin:**, **publisher:**, **publisherprofile:**. Both half-width (:) and full-width (：) colons work.
```

4b. line 2536 标题 `### The 8 Question Types` → `### The 9 Question Types`

4c. line 2547 表格 Publisher 行之后加：

```
| Publisher Profile | publisherprofile: | View partner merchants and preferences by publisher name or ID | publisherprofile: 1022 |
```

4d. line 2603（`### 1.6 Publisher Records` 小节表格之后、`## 3. Interactions` 之前）插入：

```
### 1.7 Publisher Profile

| Standard question | Description |
| --- | --- |
| publisherprofile: 1022 | Profile by publisher ID |
| publisherprofile: publisher name | Profile by name (candidates listed on multiple matches) |
| publisherprofile: 1022 amazon.de | Profile scoped to a site |
```

- [ ] **Step 5: 同步 test_chatbot_intent_picker.mjs 的 8→9 断言**

5a. line 20 for 循环加 "publisherprofile"：

```js
for (const intent of ["merchant", "category", "tier", "categorytier", "trend", "payment", "asin", "publisher", "publisherprofile"]) {
```

5b. line 87：`assertMatch(app, /8 种提问类型/, "中文说明书应列出全部 8 种提问类型");` → `/9 种提问类型/` 与文案 `9 种提问类型`

5c. line 90：`assertMatch(app, /The 8 Question Types/, "英文说明书应列出全部 8 种提问类型");` → `/The 9 Question Types/` 与文案 `9 种提问类型`

- [ ] **Step 6: 运行测试确认绿灯**

Run: `node scripts/test_chatbot_publisher_profile.mjs && node scripts/test_chatbot_intent_picker.mjs && node --check public/app.js`
Expected: 三者全过

- [ ] **Step 7: 回归其他说明书相关测试**

Run: `node scripts/test_chatbot_publisher_records.mjs && node scripts/test_zh_chatbot.mjs && node scripts/test_chatbot_welcome.mjs`
Expected: 全 PASS

- [ ] **Step 8: 提交**

```bash
git add public/app.js scripts/test_chatbot_publisher_profile.mjs scripts/test_chatbot_intent_picker.mjs
git commit -m "Document Publisher Profile question type in help guide / 使用说明新增媒体画像查询类型说明"
```

---

### Task 8: 缓存版本 bump + 全量回归

**Files:**
- Modify: `public/index.html`（line 10 `styles.css?v=`；line 1530 `auth.js?v=`）
- Modify: `public/auth.js`（`APP_SCRIPT`）
- Test: `scripts/test_chatbot_publisher_profile.mjs`（加版本断言）

**Interfaces:**
- Consumes: 无
- Produces: 三处缓存版本一致为 `20260813-publisherprofile1`

- [ ] **Step 1: 写失败测试**（`test_chatbot_publisher_profile.mjs` 静态段追加）

```js
// ── Task 8: 缓存版本 ──
assertMatch(html, /styles\.css\?v=20260813-publisherprofile1/, "样式应提升缓存版本");
assertMatch(html, /auth\.js\?v=20260813-publisherprofile1/, "认证脚本应提升缓存版本");
assertMatch(auth, /APP_SCRIPT\s*=\s*"\.\/app\.js\?v=20260813-publisherprofile1"/, "app.js 缓存版本应与 auth.js 一致");
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `node scripts/test_chatbot_publisher_profile.mjs`
Expected: 版本断言抛错

- [ ] **Step 3: bump 三处版本**

3a. `public/index.html` line 10：`styles.css?v=20260807-publisher1` → `styles.css?v=20260813-publisherprofile1`

3b. `public/index.html` line 1530：`auth.js?v=20260807-publisher2` → `auth.js?v=20260813-publisherprofile1`

3c. `public/auth.js` 的 `APP_SCRIPT`：`"./app.js?v=20260807-publisher2"` → `"./app.js?v=20260813-publisherprofile1"`

- [ ] **Step 4: 运行新测试确认绿灯**

Run: `node scripts/test_chatbot_publisher_profile.mjs`
Expected: 全段 PASS

- [ ] **Step 5: 全量回归（与 CI 一致）**

```bash
node --check public/auth.js
node --check public/app.js
node --check public/chatbot_i18n.js
node --check public/tier2_recommendation_rules.js
python scripts/test_auth_helpers.py
node scripts/test_chatbot_intent_flow.mjs
node scripts/test_commission_all_aff.mjs
node scripts/test_merchant_monthly.mjs
node scripts/test_onboarding_tour.mjs
node scripts/test_chatbot_welcome.mjs
node scripts/test_tier2_recommendation_rules.mjs
node scripts/test_sheet_categories.mjs
node scripts/test_category_drilldown.mjs
node scripts/test_category_trend.mjs
node scripts/test_tier_visual_status.mjs
node scripts/test_zh_chatbot.mjs
node scripts/test_chatbot_intent_picker.mjs
node scripts/test_chatbot_publisher_records.mjs
node scripts/test_chatbot_publisher_profile.mjs
node scripts/test_publisher_manager_tier_frontend.mjs
python -m scripts.test_payment_placeholders
python -m py_compile auth.py server.py offer_db.py levanta_payments.py api/auth/index.py api/chat/actions.py api/chat/stream.py api/db/index.py api/levanta/payments.py api/tier_moves.py scripts/validate_db_migration.py
```

Expected: 全部通过。已知豁免：`test_category_trend.mjs` 在 HEAD 上也失败（先前确认的预存在问题，与本次改动无关）；`test_chatbot_intent_flow.mjs` 偶发挂起属已知（memory：test-chatbot-flow-flaky-hang），失败时重跑。

- [ ] **Step 6: 提交**

```bash
git add public/index.html public/auth.js scripts/test_chatbot_publisher_profile.mjs
git commit -m "Bump cache versions for publisher profile / 提升媒体画像功能缓存版本"
```

---

### Task 9: 浏览器验收（用户本地执行）

**Files:** 无（验证清单）

- [ ] **Step 1: 本地启动验证**

```bash
python server.py
# 打开 http://127.0.0.1:8765/
```

- [ ] **Step 2: 逐项验收**

1. Report Mode 输入 `/` 打开菜单 → 出现第 9 项「媒体画像 / Publisher Profile」，选中后输入框写入 `publisherprofile: ` 前缀。
2. 输入 `publisherprofile: 1022` → Deep Window 先显示「正在加载媒体画像…」，随后弹出完整画像：头部、KPI、画像指标卡、品类偏好、偏好信号、合作商家表。
3. 输入 `publisherprofile: <某个媒体名>` → 唯一匹配直接出画像；多匹配时列出候选（名称 + ID + 销售额）。
4. 输入 `publisherprofile: 1022 amazon.de` → 画像回显「站点 amazon.de」，商家表按该站点口径。
5. 输入 `publisherprofile:`（空）→ 用法提示；输入不存在的媒体名 → 「未找到匹配的媒体」+ 回显。
6. 先在 Publishers 页面选择一个站点筛选，再回 Report Mode 提问不带站点的画像 → 画像不受页面筛选残留影响（all 口径）。
7. 中英文界面各验证一遍（右上角语言切换）。
8. 关闭 Deep Window 后点击聊天摘要卡片重开 → 显示完整画像（非占位）。
9. 首次提问（Publishers 页面未打开过）→ 先「正在加载媒体数据…」后自动替换为画像。
10. 说明书（帮助面板）显示 9 种类型，含媒体画像行与示例。

- [ ] **Step 3: 关闭本地服务器**

```bash
netstat -ano | grep 8765 | grep LISTEN
taskkill //F //PID <进程ID>
```

---

## Self-Review 记录（作者自查）

**Spec 覆盖**：菜单第 9 项与命令前缀（T1）✓ 意图检测与双分支路由顺序（T2）✓ 媒体匹配解析（ID/名称/多候选/站点/空）（T3）✓ marketOverride 与纯行构建（T4）✓ 画像渲染四函数（T5）✓ 回答入口与路由（T6）✓ 说明书中英 9 类型（T7）✓ 缓存版本与全量回归（T8）✓ 浏览器验收（T9）✓

**规格偏差记录**：规格原写「商家行构建复用 `_publisherPortfolioRowsForState(merchants, false, marketOverride)`」，实施改用新纯函数 `publisherProfileRowsForMarket`（T4）——因 `_publisherPortfolioRowsForState` 还读取 `state.publisherNetwork` / `state.publisherMerchantSearch`，页面状态残留风险共三处。本地规格文档已同步修正。

**占位符扫描**：所有步骤含具体代码与命令；无 TBD/TODO。

**类型一致性**：`parsePublisherProfileQuery` 返回 `{mode, publisher, candidates, market, queryText}` 在 T3 定义、T5/T6 消费一致；`renderPublisherProfileHtml(query, pub, merchants, language)` T5 定义与 T6 调用一致；`publisherProfileRowsForMarket(merchants, market)` T4 定义 T5 消费一致；`_publisherAffinitySummary(rows, marketOverride)` T4 定义 T5 消费一致。
