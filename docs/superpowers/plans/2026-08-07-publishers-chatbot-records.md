# Chatbot Publishers Records 查询实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Report Mode 的 Chatbot 能按站点/联盟/商家/经理筛选 Publishers 数据，并在 Deep Window 中输出 publishers records 表格。

**Architecture:** 全部前端实现。新增第 8 个意图 publisher（`/` 菜单第 8 项 + `publisher:` 前缀），复用 Publishers 页面已有的 `loadPublishersData()` / `_publishersCache` 数据与 Deep Window 渲染机制（`answerPrompt` 返回 HTML → `_showQuickResultInDeepPanel` 自动填窗）。数据未加载时采用 trend 占位模式（唯一 ID + 异步替换 `innerHTML`）。

**Tech Stack:** 原生 JS（app.js IIFE 内函数）、无框架、无后端改动。

## Global Constraints

- 规格文档：`docs/superpowers/specs/2026-08-07-publishers-chatbot-records-design.md`（按规格实施，不得新增后端端点、不得用 LLM 抽取筛选条件、不修改数据管道）
- 注释使用简体中文；commit 信息双语（English / 中文）
- NEVER 完整读取 `public/app.js`（约 22300 行）——只读任务给出的行范围
- `REPORT_MODE_HELP_MD` / `_EN` 是模板字符串：文档内容不得包含未转义的反引号或 `${}`
- 缓存版本号三处必须一致：`public/index.html` 的 `styles.css?v=` 与 `auth.js?v=`、`public/auth.js` 的 `APP_SCRIPT` 版本
- 测试遵循项目 vm 沙箱模式：`window.__OFFER_INTELLIGENCE_TEST__: true`、`window.OFFER_INTELLIGENCE_TEST_HOOKS`
- 完成后关闭本地服务器（任务后 `netstat -ano | grep 8765` 清理）

---

### Task 1: 意图菜单第 8 项 Publisher + 命令前缀注册

**Files:**
- Modify: `public/index.html`（意图菜单，asin 按钮 ~line 391-395 之后）
- Modify: `public/app.js`（`CHAT_INTENT_OPTIONS` line 11054-11062、`parseChatIntentPrefix` line 11223、`syncChatInputCommandOverlay` line 11075、`translations.zh` line 787 之后）
- Create: `scripts/test_chatbot_publisher_records.mjs`（静态断言部分）
- Test: `scripts/test_chatbot_publisher_records.mjs`

**Interfaces:**
- Consumes: 现有 `CHAT_INTENT_OPTIONS`（app.js line 11054）、`parseChatIntentPrefix`（app.js line 11223）
- Produces: 菜单第 8 项 `data-chat-intent="publisher"`；`CHAT_INTENT_OPTIONS` 含 `{ key: "publisher", intent: "publisher" }`；两处命令正则含 `publisher`；i18n 键 `chat.intent.publisher` / `chat.intent.publisherHint`（中文）

- [ ] **Step 1: 写失败测试**（新建 `scripts/test_chatbot_publisher_records.mjs`，先放静态断言段）

```js
import fs from "node:fs";

function assertMatch(text, pattern, label) {
  if (!pattern.test(text)) throw new Error(`${label}: 未匹配 ${pattern}`);
}

const html = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");

// ── Task 1: 菜单第 8 项 + 命令前缀注册 ──
assertMatch(html, /data-chat-intent="publisher"/, "提问类型菜单应包含 publisher 选项");
assertMatch(html, /data-chat-intent="asin"[\s\S]{0,300}data-chat-intent="publisher"/, "publisher 选项应位于 asin 之后");
assertMatch(html, /data-chat-intent="publisher"[\s\S]{0,120}>Publisher</, "publisher 选项显示应首字母大写");
assertMatch(app, /\{ key: "publisher", intent: "publisher" \}/, "CHAT_INTENT_OPTIONS 应注册 publisher 意图");
assertMatch(app, /categorytier\|merchant\|category\|tier\|trend\|payment\|asin\|publisher/, "命令解析应支持 publisher 前缀");
assertMatch(app, /"chat\.intent\.publisher": "媒体"/, "中文 i18n 应提供 publisher 菜单文案");

console.log("PASS: chatbot publisher records contract tests (Task 1 static)");
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `node scripts/test_chatbot_publisher_records.mjs`
Expected: 第一个断言 `未匹配 /data-chat-intent="publisher"/` 抛错

- [ ] **Step 3: 实现菜单第 8 项**（index.html，asin 按钮 `</button>` 之后、菜单 `</div>` 之前，~line 395）

```html
                  <button class="chat-intent-option" type="button" role="option" data-chat-intent="publisher">
                    <span class="chat-intent-option-prefix" aria-hidden="true">:</span>
                    <span class="chat-intent-option-label" data-i18n="chat.intent.publisher">Publisher</span>
                    <span class="chat-intent-option-hint" data-i18n="chat.intent.publisherHint">Publisher records</span>
                  </button>
```

- [ ] **Step 4: 注册 CHAT_INTENT_OPTIONS**（app.js line 11061 `{ key: "asin", intent: "asin" }` 之后加一行）

```js
    { key: "asin", intent: "asin" },
    { key: "publisher", intent: "publisher" }
```

- [ ] **Step 5: 两处命令正则加 publisher**（app.js line 11075 与 line 11225，把 `(categorytier|merchant|category|tier|trend|payment|asin)` 改为）

```js
(categorytier|merchant|category|tier|trend|payment|asin|publisher)
```

（line 11225 是 `parseChatIntentPrefix` 的正则，line 11075 是 `syncChatInputCommandOverlay` 的正则，两处都要改）

- [ ] **Step 6: 中文 i18n 键**（app.js line 787 `"chat.intent.asinHint": "ASIN 查询",` 之后加）

```js
      "chat.intent.asinHint": "ASIN 查询",
      "chat.intent.publisher": "媒体",
      "chat.intent.publisherHint": "媒体记录查询",
```

- [ ] **Step 7: 运行测试确认绿灯**

Run: `node scripts/test_chatbot_publisher_records.mjs`
Expected: `PASS: chatbot publisher records contract tests (Task 1 static)`

- [ ] **Step 8: 回归既有测试**

Run: `node scripts/test_chatbot_intent_picker.mjs`
Expected: 仍 PASS（line 28 断言 `/categorytier\|merchant\|category\|tier\|trend\|payment\|asin/` 是子串匹配，新正则包含该子串，不受影响）

- [ ] **Step 9: 提交**

```bash
git add public/index.html public/app.js scripts/test_chatbot_publisher_records.mjs
git commit -m "Add Publisher intent menu option and command prefix / 新增 Publisher 意图菜单项与命令前缀"
```

---

### Task 2: publisher 意图检测（hasPublisherIntent + detectQueryIntent 分支）

**Files:**
- Modify: `public/app.js`（`detectQueryIntent` line 7602-7648；新函数插在 `detectQueryIntent` 之前，~line 7601）
- Test: `scripts/test_chatbot_publisher_records.mjs`（加 vm 行为段）

**Interfaces:**
- Consumes: 无（纯文本检测）
- Produces: `hasPublisherIntent(prompt) → boolean`；`detectQueryIntent` 在 asin 检查前返回 `"publisher"`

- [ ] **Step 1: 写失败测试**（`test_chatbot_publisher_records.mjs` 末尾追加 vm 沙箱段）

```js
// ── Task 2: 意图检测（vm 沙箱） ──
import vm from "node:vm";

const storageValues = new Map();
const requests = [];
const fetchImpl = async () => ({ ok: true, async json() { return { ok: true }; } });
const elementStub = {
  addEventListener() {}, appendChild() {}, insertBefore() {}, remove() {}, click() {}, focus() {},
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  dataset: {}, style: {}, querySelector() { return null; }, querySelectorAll() { return []; },
  setAttribute() {}, removeAttribute() {}, closest() { return null; }, reset() {}
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
    getElementById() { return { ...elementStub }; }, querySelectorAll() { return []; },
    querySelector() { return { ...elementStub }; }, createElement() { return { ...elementStub }; },
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
if (hooks.hasPublisherIntent("列一下媒体") !== true) throw new Error("「列一下媒体」应触发 publisher 意图");
if (hooks.hasPublisherIntent("amazon.de 市场的媒体") !== true) throw new Error("「amazon.de 市场的媒体」应触发 publisher 意图");
if (hooks.hasPublisherIntent("销售最高的 5 个媒体") !== true) throw new Error("「销售最高的 5 个媒体」应触发 publisher 意图");
if (hooks.hasPublisherIntent("publisher: amazon.de Amazon") !== true) throw new Error("publisher 前缀文本应触发 publisher 意图");
if (hooks.hasPublisherIntent("分析媒体 shokz 的表现") !== false) throw new Error("含分析词的媒体查询应让位给 analysis 意图");
if (hooks.hasPublisherIntent("Shokz 的销售如何") !== false) throw new Error("普通商户查询不应误判为 publisher");
if (hooks.detectQueryIntent("列一下媒体") !== "publisher") throw new Error("detectQueryIntent 应返回 publisher");
if (hooks.detectQueryIntent("amazon.de 市场的媒体有哪些") !== "publisher") throw new Error("带站点词的媒体查询应返回 publisher");
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `node scripts/test_chatbot_publisher_records.mjs`
Expected: 在 vm 段抛错（`hooks.hasPublisherIntent is not a function` 或类似）

- [ ] **Step 3: 实现 hasPublisherIntent**（插在 `detectQueryIntent` 之前，~line 7601）

```js
  // Publishers 意图检测：出现媒体词（publisher/publishers/媒体）时视为媒体查询；
  // 与趋势/分析词组合时让位给 analysis（如「分析媒体 X 的表现」→ 商户分析）。
  function hasPublisherIntent(prompt) {
    const lower = String(prompt || "").toLowerCase();
    if (!/(?:publisher|publishers|媒体)/i.test(lower)) return false;
    if (/趋势|trend|分析|analy|评估|诊断|表现|performance|health\s*check|怎么样/i.test(lower)) return false;
    return true;
  }
```

- [ ] **Step 4: detectQueryIntent 加分支**（line 7619 `const lower = ...` 之后、`if (findByAsin(...))` 之前）

```js
    const lower = userMessage.toLowerCase().trim();
    if (hasPublisherIntent(userMessage)) return "publisher";
    if (findByAsin(userMessage)) return "asin";
```

- [ ] **Step 5: hooks 导出**（app.js ~line 22327 `detectQueryIntent,` 后加）

```js
      detectQueryIntent,
      hasPublisherIntent,
```

- [ ] **Step 6: 运行测试确认绿灯**

Run: `node scripts/test_chatbot_publisher_records.mjs`
Expected: `PASS: chatbot publisher records contract tests`（两段全过）

- [ ] **Step 7: 提交**

```bash
git add public/app.js scripts/test_chatbot_publisher_records.mjs
git commit -m "Add publisher intent detection / 新增媒体查询意图检测"
```

---

### Task 3: parsePublisherFilters 筛选解析器

**Files:**
- Modify: `public/app.js`（新函数与两个别名表插在 Task 2 的 `hasPublisherIntent` 之后，~line 7615 附近）
- Test: `scripts/test_chatbot_publisher_records.mjs`（加 Task 3 vm 断言段）

**Interfaces:**
- Consumes: `hasPublisherIntent`（Task 2）
- Produces: `parsePublisherFilters(prompt, data) → { market, network, merchantIds[], manager, sortKey, limit, unrecognized[] }`；常量 `PUBLISHER_MARKET_ALIASES`、`PUBLISHER_SORT_ALIASES`

- [ ] **Step 1: 写失败测试**（vm 段 `hooks.detectQueryIntent(...)` 断言之后追加）

```js
// ── Task 3: 筛选解析器 ──
const pubData = JSON.parse(fs.readFileSync("protected_data/db_publishers_cache.json", "utf8"));
const f1 = hooks.parsePublisherFilters("列一下 amazon.de 市场、Amazon 联盟、经理张三的媒体", pubData);
if (f1.market !== "amazon.de") throw new Error("应解析出 amazon.de 站点");
if (f1.network !== "Amazon") throw new Error("应解析出 Amazon 联盟");
if (!Array.isArray(f1.merchantIds)) throw new Error("merchantIds 应为数组");
if (f1.limit !== 50) throw new Error("默认限额应为 50");
if (f1.sortKey !== "clicks") throw new Error("默认排序应为 clicks");

const f2 = hooks.parsePublisherFilters("销售最高的 5 个媒体", pubData);
if (f2.sortKey !== "sales") throw new Error("应解析出按销售排序");
if (f2.limit !== 5) throw new Error("应解析出限额 5");

const f3 = hooks.parsePublisherFilters("和 shokz 合作的媒体", pubData);
if (!f3.merchantIds.length) throw new Error("应按商家名称匹配出 merchantIds");

const f4 = hooks.parsePublisherFilters("商家 362135 的媒体", pubData);
if (f4.merchantIds.indexOf(362135) === -1) throw new Error("应按商家 ID 匹配出 362135");

const f5 = hooks.parsePublisherFilters("按佣金排序的媒体", pubData);
if (f5.sortKey !== "allCommission") throw new Error("应解析出按佣金排序");

const f6 = hooks.parsePublisherFilters("德国站的媒体", pubData);
if (f6.market !== "amazon.de") throw new Error("「德国站」应映射到 amazon.de");
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `node scripts/test_chatbot_publisher_records.mjs`
Expected: `parsePublisherFilters is not a function` 抛错

- [ ] **Step 3: 实现别名表与解析器**（插在 `hasPublisherIntent` 之后；完整代码）

```js
  // ── Publishers 查询解析 ──────────────────────────────
  // 站点别名表：市场 key → 别名（中英）。
  // 重要：按别名最长优先排列（amazon.com.mx 在 amazon.com 之前），
  // 否则 includes("amazon.com") 会误吞 "amazon.com.mx" 文本。
  const PUBLISHER_MARKET_ALIASES = [
    { key: "amazon.com.mx", aliases: ["amazon.com.mx", "墨西哥", "mx", "墨西哥站", "墨西哥市场"] },
    { key: "amazon.co.uk", aliases: ["amazon.co.uk", "英国", "uk", "英国站", "英国市场", "英区"] },
    { key: "amazon.com", aliases: ["amazon.com", "美国", "us", "美国站", "美国市场", "美区"] },
    { key: "amazon.de", aliases: ["amazon.de", "德国", "de", "德国站", "德国市场", "德区"] },
    { key: "amazon.fr", aliases: ["amazon.fr", "法国", "fr", "法国站", "法国市场"] },
    { key: "amazon.ca", aliases: ["amazon.ca", "加拿大", "ca", "加拿大站", "加拿大市场"] },
    { key: "amazon.it", aliases: ["amazon.it", "意大利", "it", "意大利站", "意大利市场"] },
    { key: "amazon.es", aliases: ["amazon.es", "西班牙", "es", "西班牙站", "西班牙市场"] },
    { key: "amazon.nl", aliases: ["amazon.nl", "荷兰", "nl", "荷兰站", "荷兰市场"] }
  ];

  // 排序指标别名表：指标 key → 别名（中英）
  const PUBLISHER_SORT_ALIASES = [
    { key: "sales", aliases: ["销售", "销售额", "sales", "revenue", "收入"] },
    { key: "allCommission", aliases: ["总佣金", "全部佣金", "佣金", "commission", "payout"] },
    { key: "affCommission", aliases: ["联盟佣金", "aff", "affiliate commission", "aff commission"] },
    { key: "orders", aliases: ["订单", "orders", "order", "单量", "出单"] },
    { key: "clicks", aliases: ["点击", "clicks", "click", "流量"] },
    { key: "cvr", aliases: ["转化率", "cvr", "conversion rate"] },
    { key: "dpv", aliases: ["dpv", "详情页", "detail page views"] },
    { key: "atc", aliases: ["atc", "加购", "add to cart"] },
    { key: "grossProfit", aliases: ["毛利", "gross profit"] }
  ];

  // 解析器停用词：这些词不参与「未识别」标注
  const PUBLISHER_STOP_WORDS = [
    "媒体", "publisher", "publishers", "列", "列举", "列出", "查", "查询", "找", "一下", "的", "哪些",
    "有哪些", "有", "看", "看看", "展示", "显示", "输出", "列表", "记录", "业绩", "数据", "排序", "排名",
    "市场", "站点", "联盟", "商家", "合作", "经理", "管理员", "前", "个", "条", "名", "最", "最高", "最大",
    "list", "show", "give", "find", "lookup", "for", "with", "in", "and", "the", "top", "only", "by"
  ];

  // 解析 publishers 查询的筛选条件（自然语言与 publisher: 前缀共用）。
  // 返回 { market, network, merchantIds, manager, sortKey, limit, unrecognized }。
  function parsePublisherFilters(prompt, data) {
    const text = String(prompt || "");
    const lower = text.toLowerCase();
    const publishers = (data && data.publishers) || [];
    const networks = (data && data.networks) || [];
    const merchantNameMap = (data && data.merchantNameMap) || {};

    // 站点/市场：别名包含匹配（顺序固定，精确域名优先在表前部）
    let market = null;
    for (const entry of PUBLISHER_MARKET_ALIASES) {
      if (entry.aliases.some(function (alias) { return lower.includes(alias.toLowerCase()); })) {
        market = entry.key;
        break;
      }
    }

    // 联盟：与 networks 列表值包含匹配
    let network = null;
    for (const net of networks) {
      if (lower.includes(String(net).toLowerCase())) {
        network = String(net);
        break;
      }
    }

    // 商家：先按 ID（4-8 位数字且在 merchantNameMap 中），再按名称包含匹配
    const merchantIds = [];
    const idMatches = text.match(/\b\d{4,8}\b/g) || [];
    for (const idStr of idMatches) {
      const mid = parseInt(idStr, 10);
      if (merchantNameMap[String(mid)]) merchantIds.push(mid);
    }
    if (!merchantIds.length) {
      for (const mid of Object.keys(merchantNameMap)) {
        if (lower.includes(String(merchantNameMap[mid]).toLowerCase())) merchantIds.push(parseInt(mid, 10));
      }
    }

    // 经理：先「经理」引导词提取，再全列表包含匹配
    const adminNames = Array.from(new Set(
      publishers.map(function (p) { return String(p.adminName || ""); }).filter(Boolean)
    ));
    let manager = null;
    const managerMatch = text.match(/(?:经理|管理员|manager)\s*[:：]?\s*([^\s,，、;；]+)/i);
    if (managerMatch) {
      const raw = managerMatch[1].trim();
      const exact = adminNames.find(function (n) { return n.toLowerCase() === raw.toLowerCase(); });
      const fuzzy = !exact && adminNames.find(function (n) { return n.toLowerCase().includes(raw.toLowerCase()); });
      if (exact) manager = exact;
      else if (fuzzy) manager = fuzzy;
    }
    if (!manager) {
      for (const name of adminNames) {
        if (name.toLowerCase() !== "unknown" && lower.includes(name.toLowerCase())) {
          manager = name;
          break;
        }
      }
    }

    // 排序：命中任一指标别名即取该指标（默认 clicks）
    let sortKey = "clicks";
    for (const entry of PUBLISHER_SORT_ALIASES) {
      if (entry.aliases.some(function (alias) { return lower.includes(alias.toLowerCase()); })) {
        sortKey = entry.key;
        break;
      }
    }

    // 限额：前 N / top N / 最多 N；否则「N 个/名/条」；默认 50
    let limit = 50;
    const limitMatch = lower.match(/(?:前|top|最多|只显示|只)\s*(\d{1,4})/i);
    if (limitMatch) {
      limit = parseInt(limitMatch[1], 10);
    } else {
      const plainMatch = lower.match(/\b(\d{1,4})\s*(?:个|条|名|publishers?)\b/i);
      if (plainMatch) limit = parseInt(plainMatch[1], 10);
    }

    // 未识别标注：剩余 token（非停用词、非已识别、非纯数字）
    const recognized = [market, network, manager].filter(Boolean)
      .concat(merchantIds.map(String));
    const unrecognized = [];
    for (const token of text.split(/[\s,，、;；]+/)) {
      const t = token.trim();
      if (!t || /^\d+$/.test(t)) continue;
      if (PUBLISHER_STOP_WORDS.some(function (w) { return w.length >= 2 && t.toLowerCase().includes(w.toLowerCase()); })) continue;
      if (recognized.some(function (r) { return r.toLowerCase() === t.toLowerCase(); })) continue;
      if (!/[a-z一-龥]/i.test(t)) continue;
      unrecognized.push(t);
    }

    return { market: market, network: network, merchantIds: merchantIds, manager: manager, sortKey: sortKey, limit: limit, unrecognized: unrecognized };
  }
```

- [ ] **Step 4: hooks 导出**（Task 2 加的 `hasPublisherIntent,` 后加）

```js
      hasPublisherIntent,
      parsePublisherFilters,
```

- [ ] **Step 5: 运行测试确认绿灯**

Run: `node scripts/test_chatbot_publisher_records.mjs`
Expected: Task 3 断言全过（注意：测试数据 `db_publishers_cache.json` 的 networks 值需包含 "Amazon"、merchantNameMap 需含 362135 与 shokz 相关名称——这些在真实缓存中存在；若断言失败先打印 f1 各字段核对数据，不要改解析逻辑去适配）

- [ ] **Step 6: 提交**

```bash
git add public/app.js scripts/test_chatbot_publisher_records.mjs
git commit -m "Add publisher filter parser / 新增媒体筛选解析器"
```

---

### Task 4: 渲染 + 回答函数 + 路由分支

**Files:**
- Modify: `public/app.js`（`publisherRecordsAnswer` / `renderPublisherRecordsHtml` 插在 `parsePublisherFilters` 之后；`answerPrompt` line 9738 `if (intent === "analysis")` 之前加分支；hooks 导出）
- Test: `scripts/test_chatbot_publisher_records.mjs`（加 Task 4 vm 断言段）

**Interfaces:**
- Consumes: `parsePublisherFilters`（Task 3）、`_publishersCache` / `loadPublishersData`（现有 line 14238）、`responseLanguageFor`、`escapeHtml` / `number` / `money` / `pct`（现有格式化）
- Produces: `renderPublisherRecordsHtml(prompt, data, language) → string`（12 列 HTML）；`publisherRecordsAnswer(prompt) → string`（懒加载占位或直接渲染）；`answerPrompt` 的 `intent === "publisher"` 路由

- [ ] **Step 1: 写失败测试**（vm 段 Task 3 断言之后追加）

```js
// ── Task 4: 渲染与回答 ──
const zhHtml = hooks.renderPublisherRecordsHtml("列一下媒体", pubData, "zh");
if (!zhHtml.includes("媒体业绩记录")) throw new Error("中文标题应显示媒体业绩记录");
if (!zhHtml.includes("媒体 ID") || !zhHtml.includes("毛利")) throw new Error("中文表格应含 12 列（含毛利）");
if (!zhHtml.includes('class="total-row"')) throw new Error("表格应含合计行");
if (!zhHtml.includes("共 ")) throw new Error("应显示总数");
if (zhHtml.includes("rank")) throw new Error("不应包含 rank 列");

const marketHtml = hooks.renderPublisherRecordsHtml("amazon.de 市场的媒体", pubData, "zh");
if (!marketHtml.includes("站点 amazon.de")) throw new Error("应回显站点筛选条件");

const enHtml = hooks.renderPublisherRecordsHtml("list publishers", pubData, "en");
if (!enHtml.includes("Publisher Records")) throw new Error("英文标题应显示 Publisher Records");
if (!enHtml.includes("Publisher ID") || !enHtml.includes("Gross Profit")) throw new Error("英文表格应含 12 列");

const noMatchHtml = hooks.renderPublisherRecordsHtml("经理不存在的经理甲 的媒体", pubData, "zh");
if (!noMatchHtml.includes("未找到匹配的媒体")) throw new Error("无匹配时应显示未找到提示");

const emptyHtml = hooks.renderPublisherRecordsHtml("列一下媒体", { publishers: [] }, "zh");
if (!emptyHtml.includes("未找到匹配的媒体")) throw new Error("空数据应显示未找到提示");

const sortedHtml = hooks.renderPublisherRecordsHtml("销售最高的 3 个媒体", pubData, "zh");
const salesRows = sortedHtml.match(/<td class="num">\$[\d,.]*<\/td>/g) || [];
if (salesRows.length < 3) throw new Error("按销售排序后应输出限额 3 行");
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `node scripts/test_chatbot_publisher_records.mjs`
Expected: `renderPublisherRecordsHtml is not a function` 抛错

- [ ] **Step 3: 实现 renderPublisherRecordsHtml**（插在 `parsePublisherFilters` 之后；完整代码）

```js
  // 渲染 publishers records 表格（12 列，去 rank；含合计行与总数）。
  // 有站点筛选时指标列显示该市场数值，否则显示 total。
  function renderPublisherRecordsHtml(prompt, data, language) {
    const zh = language === "zh";
    const filters = parsePublisherFilters(prompt, data);
    const publishers = (data && data.publishers) || [];

    // 四维 AND 组合筛选；商家多值 OR
    const filtered = publishers.filter(function (pub) {
      if (filters.market && !pub.markets[filters.market]) return false;
      if (filters.network && (!pub.networks || pub.networks.indexOf(filters.network) === -1)) return false;
      if (filters.merchantIds.length) {
        const ids = pub.merchantIds || [];
        if (!filters.merchantIds.some(function (mid) { return ids.indexOf(mid) !== -1; })) return false;
      }
      if (filters.manager && String(pub.adminName || "") !== filters.manager) return false;
      return true;
    });

    const metricFor = function (pub) {
      return (filters.market && pub.markets[filters.market]) || pub.total || {};
    };

    // 排序（默认 clicks 降序）；cvr 在原始数据中无字段，需按比率计算
    const sortValueFor = function (m, key) {
      if (key === "cvr") return m.clicks > 0 ? m.orders / m.clicks : 0;
      return m[key] || 0;
    };
    filtered.sort(function (a, b) {
      return sortValueFor(metricFor(b), filters.sortKey) - sortValueFor(metricFor(a), filters.sortKey);
    });

    const rows = filtered.slice(0, filters.limit);

    const colLabels = zh ? {
      userId: "媒体 ID", userName: "媒体名称", adminName: "经理", clicks: "点击", cvr: "转化率",
      dpv: "DPV", atc: "ATC", orders: "订单", sales: "销售额", allCommission: "总佣金",
      affCommission: "联盟佣金", grossProfit: "毛利"
    } : {
      userId: "Publisher ID", userName: "Publisher Name", adminName: "Manager", clicks: "Clicks", cvr: "CVR",
      dpv: "DPV", atc: "ATC", orders: "Orders", sales: "Sales", allCommission: "All Comm",
      affCommission: "Aff Comm", grossProfit: "Gross Profit"
    };

    // 条件回显
    const parts = [];
    if (filters.market) parts.push((zh ? "站点 " : "market ") + filters.market);
    if (filters.network) parts.push((zh ? "联盟 " : "network ") + filters.network);
    if (filters.merchantIds.length) {
      const names = filters.merchantIds.map(function (m) { return data.merchantNameMap[String(m)] || m; });
      parts.push((zh ? "商家 " : "merchant ") + names.join(", "));
    }
    if (filters.manager) parts.push((zh ? "经理 " : "manager ") + filters.manager);
    const conditionNote = parts.length ? parts.join(" · ") : "";

    if (!filtered.length) {
      return '<div class="analysis-section publisher-records-section"><h4>' + (zh ? "媒体业绩记录" : "Publisher Records") + '</h4>' +
        '<p class="warning">' + (zh ? "未找到匹配的媒体。" : "No matching publishers found.") + '</p>' +
        (conditionNote ? '<p><small>' + escapeHtml(conditionNote) + '</small></p>' : '') +
        '</div>';
    }

    // 合计行（按实际渲染行计算）
    const total = rows.reduce(function (acc, pub) {
      const m = metricFor(pub);
      acc.clicks += m.clicks || 0; acc.dpv += m.dpv || 0; acc.atc += m.atc || 0; acc.orders += m.orders || 0;
      acc.sales += m.sales || 0; acc.allCommission += m.allCommission || 0; acc.affCommission += m.affCommission || 0;
      return acc;
    }, { clicks: 0, dpv: 0, atc: 0, orders: 0, sales: 0, allCommission: 0, affCommission: 0 });

    const cell = function (m, key) {
      if (key === "cvr") return pct(m.clicks > 0 ? m.orders / m.clicks : 0);
      if (key === "sales" || key === "allCommission" || key === "affCommission" || key === "grossProfit") return money(m[key] || 0);
      return number(m[key] || 0);
    };

    const header = Object.keys(colLabels).map(function (k) { return "<th>" + colLabels[k] + "</th>"; }).join("");
    const rowHtml = rows.map(function (pub) {
      const m = metricFor(pub);
      const gross = (m.allCommission || 0) - (m.affCommission || 0);
      return "<tr>" +
        "<td>" + pub.userId + "</td>" +
        "<td>" + escapeHtml(pub.userName) + "</td>" +
        "<td>" + escapeHtml(pub.adminName || "Unknown") + "</td>" +
        "<td class=\"num\">" + number(m.clicks || 0) + "</td>" +
        "<td class=\"num\">" + pct(m.clicks > 0 ? m.orders / m.clicks : 0) + "</td>" +
        "<td class=\"num\">" + number(m.dpv || 0) + "</td>" +
        "<td class=\"num\">" + number(m.atc || 0) + "</td>" +
        "<td class=\"num\">" + number(m.orders || 0) + "</td>" +
        "<td class=\"num\">" + money(m.sales || 0) + "</td>" +
        "<td class=\"num\">" + money(m.allCommission || 0) + "</td>" +
        "<td class=\"num\">" + money(m.affCommission || 0) + "</td>" +
        "<td class=\"num\">" + money(gross) + "</td>" +
        "</tr>";
    }).join("");

    const totalGross = total.allCommission - total.affCommission;
    const totalRow = "<tr class=\"total-row\">" +
      "<td colspan=\"3\">" + (zh ? "合计" : "Total") + "</td>" +
      "<td class=\"num\">" + number(total.clicks) + "</td>" +
      "<td class=\"num\">" + pct(total.clicks > 0 ? total.orders / total.clicks : 0) + "</td>" +
      "<td class=\"num\">" + number(total.dpv) + "</td>" +
      "<td class=\"num\">" + number(total.atc) + "</td>" +
      "<td class=\"num\">" + number(total.orders) + "</td>" +
      "<td class=\"num\">" + money(total.sales) + "</td>" +
      "<td class=\"num\">" + money(total.allCommission) + "</td>" +
      "<td class=\"num\">" + money(total.affCommission) + "</td>" +
      "<td class=\"num\">" + money(totalGross) + "</td>" +
      "</tr>";

    const sortLabel = colLabels[filters.sortKey] || filters.sortKey;
    const note = (zh ? "共 " : "Total: ") + filtered.length.toLocaleString() +
      " · " + (zh ? "按 " + sortLabel + " 降序" : "ranked by " + sortLabel + " desc");

    return '<div class="analysis-section publisher-records-section"><h4>' + (zh ? "媒体业绩记录" : "Publisher Records") + '</h4>' +
      (conditionNote || filters.unrecognized.length
        ? '<p><small>' + escapeHtml(conditionNote) +
          (filters.unrecognized.length
            ? (conditionNote ? " · " : "") + (zh ? "未识别：" : "unrecognized: ") + escapeHtml(filters.unrecognized.join(", "))
            : "") +
          '</small></p>'
        : '') +
      '<div class="table-wrap"><table><thead><tr>' + header + '</tr></thead><tbody>' + totalRow + rowHtml + '</tbody></table></div>' +
      '<p><small>' + escapeHtml(note) + '</small></p>' +
      '</div>';
  }

  // 回答入口：数据已加载直接渲染；未加载返回占位并在后台加载后替换（trend 模式）。
  function publisherRecordsAnswer(prompt) {
    const language = responseLanguageFor(prompt);
    const zh = language === "zh";
    const data = _publishersCache;
    if (!data) {
      const placeholderId = "publisher-records-" + Date.now();
      setTimeout(function () {
        loadPublishersData()
          .then(function () {
            const container = document.getElementById(placeholderId);
            if (!container) return;
            const html = renderPublisherRecordsHtml(prompt, _publishersCache, language);
            container.innerHTML = html;
            // 同步深窗缓存，面板关闭后点击摘要重开显示完整表格
            for (const key in _deepReportCache) {
              if (String(_deepReportCache[key].html).indexOf(placeholderId) !== -1) {
                _deepReportCache[key].html = container.outerHTML;
                break;
              }
            }
          })
          .catch(function () {
            const container = document.getElementById(placeholderId);
            if (container) {
              container.innerHTML = '<div class="analysis-section publisher-records-section"><p class="warning">' +
                (zh ? "Publishers 数据暂时不可用。" : "Publisher data is temporarily unavailable.") + '</p></div>';
            }
          });
      }, 0);
      return '<div id="' + placeholderId + '" class="analysis-section publisher-records-section"><p><em>' +
        (zh ? "正在加载媒体数据…" : "Loading publisher data…") + '</em></p></div>';
    }
    return renderPublisherRecordsHtml(prompt, data, language);
  }
```

- [ ] **Step 4: answerPrompt 路由分支**（line 9738 `if (intent === "analysis") {` 之前插入）

```js
    if (intent === "publisher") {
      return publisherRecordsAnswer(prompt);
    }
```

- [ ] **Step 5: hooks 导出**（Task 3 加的 `parsePublisherFilters,` 后加）

```js
      parsePublisherFilters,
      renderPublisherRecordsHtml,
      publisherRecordsAnswer,
```

- [ ] **Step 6: 运行测试确认绿灯**

Run: `node scripts/test_chatbot_publisher_records.mjs`
Expected: Task 4 断言全过（若「站点 amazon.de」断言失败，检查 conditionNote 格式与断言文本一致：`站点 amazon.de` 由 `"站点 " + filters.market` 生成）

- [ ] **Step 7: 提交**

```bash
git add public/app.js scripts/test_chatbot_publisher_records.mjs
git commit -m "Add publisher records table rendering and answer route / 新增媒体记录表格渲染与回答路由"
```

---

### Task 5: 说明书 8 类型（中英）+ 同步既有测试

**Files:**
- Modify: `public/app.js`（`REPORT_MODE_HELP_MD` line 2266/2269/2279 与 2324 后；`REPORT_MODE_HELP_MD_EN` line 2388/2391/2401 与 2443 后）
- Modify: `scripts/test_chatbot_intent_picker.mjs`（line 20 循环、line 87、line 90）
- Test: `scripts/test_chatbot_publisher_records.mjs`（加 Task 5 静态断言）

**Interfaces:**
- Consumes: 无
- Produces: 说明书「提问类型命令」表格 8 行、标题 8 种；「支持的提问类型」新增媒体记录小节（中英）

- [ ] **Step 1: 写失败测试**（`test_chatbot_publisher_records.mjs` 顶部静态段追加）

```js
// ── Task 5: 说明书 8 类型 ──
assertMatch(app, /### 8 种提问类型/, "中文说明书应列出全部 8 种提问类型");
assertMatch(app, /### The 8 Question Types/, "英文说明书应列出全部 8 种提问类型");
assertMatch(app, /\| Publisher（媒体） \| publisher: \|/, "中文说明书应提供 Publisher 行");
assertMatch(app, /\| Publisher \| publisher: \|/, "英文说明书应提供 Publisher 行");
assertMatch(app, /publisher: amazon\.de Amazon 张三/, "说明书应提供 Publisher 示例");
assertMatch(app, /### 6\. 媒体记录查询/, "中文说明书应提供媒体记录查询小节");
assertMatch(app, /### 1\.6 Publisher Records/, "英文说明书应提供 Publisher Records 小节");
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `node scripts/test_chatbot_publisher_records.mjs`
Expected: 第一个新增断言 `未匹配 /### 8 种提问类型/` 抛错

- [ ] **Step 3: 修改中文说明书**（`REPORT_MODE_HELP_MD` 内，注意模板字符串内不得出现未转义反引号或 `${}`）

3a. line 2266 前缀列表 `**asin:**` 后加 `、**publisher:**`：
```
- 也可手动输入前缀：**merchant:**、**category:**、**tier:**、**categorytier:**、**trend:**、**payment:**、**asin:**、**publisher:**，支持半角与全角冒号（: 与 ：）。
```

3b. line 2269 标题 `### 7 种提问类型` → `### 8 种提问类型`

3c. line 2279 表格末行 `| ASIN | asin: | ASIN 查询 | asin: B0015S8FPI |` 之后加：
```
| Publisher（媒体） | publisher: | 按站点 / 联盟 / 商家 / 经理筛选媒体记录 | publisher: amazon.de Amazon 张三 |
```

3d. line 2324（`## 三、交互说明` 之前）插入新小节：
```
### 6. 媒体记录查询

| 标准提问 | 说明 |
| --- | --- |
| 列一下媒体 | 全部媒体列表 |
| amazon.de 市场的媒体 | 按站点筛选 |
| Amazon 联盟的媒体 | 按联盟筛选 |
| 和 Shokz 合作的媒体 | 按商家筛选 |
| 经理张三的媒体 | 按经理筛选 |
| 销售最高的 5 个媒体 | 排序 + 限额 |
```

- [ ] **Step 4: 修改英文说明书**（`REPORT_MODE_HELP_MD_EN` 内）

4a. line 2388 前缀列表 `**asin:**` 后加 `, **publisher:**`：
```
- You can also type a prefix manually: **merchant:**, **category:**, **tier:**, **categorytier:**, **trend:**, **payment:**, **asin:**, **publisher:**. Both half-width (:) and full-width (：) colons work.
```

4b. line 2391 标题 `### The 7 Question Types` → `### The 8 Question Types`

4c. line 2401 表格末行 `| ASIN | asin: | ASIN lookup | asin: B0015S8FPI |` 之后加：
```
| Publisher | publisher: | Filter publisher records by site / network / merchant / manager | publisher: amazon.de Amazon 张三 |
```

4d. 在 `## 3. Interactions`（~line 2445）之前插入（英文 1.5 Payment Queries 小节之后）：
```
### 1.6 Publisher Records

| Standard question | Description |
| --- | --- |
| List publishers | Full publisher list |
| Publishers in the amazon.de market | Filter by site |
| Publishers in the Amazon network | Filter by network |
| Publishers partnering with Shokz | Filter by merchant |
| Publishers managed by Zhang San | Filter by manager |
| Top 5 publishers by sales | Sort + limit |
```

- [ ] **Step 5: 同步 test_chatbot_intent_picker.mjs 的 7→8 断言**

5a. line 20 for 循环加 "publisher"：
```js
for (const intent of ["merchant", "category", "tier", "categorytier", "trend", "payment", "asin", "publisher"]) {
```

5b. line 87：`assertMatch(app, /7 种提问类型/, "中文说明书应列出全部 7 种提问类型");` → `/8 种提问类型/` 与文案 `8 种提问类型`

5c. line 90：`assertMatch(app, /The 7 Question Types/, "英文说明书应列出全部 7 种提问类型");` → `/The 8 Question Types/` 与文案 `8 种提问类型`

- [ ] **Step 6: 运行测试确认绿灯**

Run: `node scripts/test_chatbot_publisher_records.mjs && node scripts/test_chatbot_intent_picker.mjs && node --check public/app.js`
Expected: 三者全过

- [ ] **Step 7: 回归其他说明书相关测试**

Run: `node scripts/test_chatbot_intent_flow.mjs && node scripts/test_zh_chatbot.mjs && node scripts/test_chatbot_welcome.mjs && node scripts/test_chatbot_answer_feedback_frontend.mjs`
Expected: 全 PASS（若 test_chatbot_intent_flow.mjs 偶发挂起，属已知预存在问题 memory `test-chatbot-flow-flaky-hang`，重跑一次）

- [ ] **Step 8: 提交**

```bash
git add public/app.js scripts/test_chatbot_publisher_records.mjs scripts/test_chatbot_intent_picker.mjs
git commit -m "Document Publisher question type in help guide / 使用说明新增媒体查询类型说明"
```

---

### Task 6: 缓存版本 bump + 全量回归

**Files:**
- Modify: `public/index.html`（line 10 `styles.css?v=`；line ~1204 `auth.js?v=`）
- Modify: `public/auth.js`（line 2 `APP_SCRIPT`）
- Test: `scripts/test_chatbot_publisher_records.mjs`（加版本断言）

**Interfaces:**
- Consumes: 无
- Produces: 三处缓存版本一致为 `20260807-publisher1`

- [ ] **Step 1: 写失败测试**（`test_chatbot_publisher_records.mjs` 静态段追加）

```js
// ── Task 6: 缓存版本 ──
assertMatch(html, /styles\.css\?v=20260807-publisher1/, "样式应提升缓存版本");
assertMatch(html, /auth\.js\?v=20260807-publisher1/, "认证脚本应提升缓存版本");
assertMatch(app, /APP_SCRIPT\s*=\s*"\.\/app\.js\?v=20260807-publisher1"/, "app.js 缓存版本应与 auth.js 一致");
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `node scripts/test_chatbot_publisher_records.mjs`
Expected: 版本断言抛错

- [ ] **Step 3: bump 三处版本**

3a. `public/index.html` line 10：`styles.css?v=20260807-intent-picker11` → `styles.css?v=20260807-publisher1`

3b. `public/index.html` ~line 1204：`auth.js?v=20260807-intent-picker7` → `auth.js?v=20260807-publisher1`

3c. `public/auth.js` line 2：`const APP_SCRIPT = "./app.js?v=20260807-intent-picker7";` → `const APP_SCRIPT = "./app.js?v=20260807-publisher1";`

- [ ] **Step 4: 运行新测试确认绿灯**

Run: `node scripts/test_chatbot_publisher_records.mjs`
Expected: 全段 PASS（输出 `PASS: chatbot publisher records contract tests`）

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
node scripts/test_chatbot_answer_feedback_frontend.mjs
node scripts/test_chatbot_publisher_records.mjs
python -m scripts.test_payment_placeholders
python -m py_compile auth.py server.py offer_db.py levanta_payments.py api/auth/index.py api/chat/actions.py api/chat/stream.py api/db/index.py api/levanta/payments.py api/tier_moves.py scripts/validate_db_migration.py
```

Expected: 全部通过。已知豁免：`test_category_trend.mjs` 在 HEAD 上也失败（先前确认的预存在问题，与本次改动无关）；`test_chatbot_intent_flow.mjs` 偶发挂起属已知（memory），失败时重跑。

- [ ] **Step 6: 提交**

```bash
git add public/index.html public/auth.js scripts/test_chatbot_publisher_records.mjs
git commit -m "Bump cache versions for publisher records / 提升媒体记录功能缓存版本"
```

---

### Task 7: 浏览器验收（用户本地执行）

**Files:** 无（验证清单）

- [ ] **Step 1: 本地启动验证**

```bash
python server.py
# 打开 http://127.0.0.1:8765/
```

- [ ] **Step 2: 逐项验收**

1. Report Mode 输入「列一下 amazon.de 市场的媒体」→ Deep Window 弹出「媒体业绩记录」表格，站点列数值为 amazon.de 口径，合计行与总数正确。
2. 输入 `publisher: Amazon 张三`（或 `/` 菜单选 Publisher）→ 前缀解析生效，表格按联盟 + 经理筛选。
3. 输入「销售最高的 5 个媒体」→ 按销售额降序、仅 5 行。
4. 输入「和 shokz 合作的媒体」→ 商家筛选生效。
5. 输入「经理张三的媒体」→ 经理筛选生效。
6. 输入不存在的经理名 → 显示「未找到匹配的媒体」+ 条件回显。
7. 中英文界面各验证一遍表头与提示文案（右上角语言切换）。
8. `/` 菜单出现第 8 项 Publisher，选中写入 `publisher: ` 前缀；说明书（帮助面板）显示 8 种类型含媒体行。
9. 关闭 Deep Window 后点击聊天摘要卡片重开 → 显示完整表格（非占位）。
10. 首次提问（Publishers 页面未打开过）→ 先显示「正在加载媒体数据…」后自动替换为表格。

- [ ] **Step 3: 关闭本地服务器**

```bash
netstat -ano | grep 8765 | grep LISTEN
taskkill //F //PID <进程ID>
```

---

## Self-Review 记录（作者自查）

**Spec 覆盖**：菜单第 8 项（T1）✓ 意图检测（T2）✓ 四维解析与 AND/OR 语义（T3）✓ 12 列表格 + 合计 + 排序限额 + 无匹配提示 + 降级（T4）✓ 说明书中英 8 类型（T5）✓ hooks 导出与缓存版本（T2/T3/T4/T6）✓ 测试同步（T5）✓ 浏览器验收（T7）✓

**占位符扫描**：所有步骤含具体代码与命令；无 TBD/TODO。

**类型一致性**：`parsePublisherFilters` 返回字段名在 T3 定义、T4 消费（`filters.market/network/merchantIds/manager/sortKey/limit/unrecognized`）一致；`renderPublisherRecordsHtml(prompt, data, language)` 在 T4 定义与 hooks 导出一致；`hasPublisherIntent(prompt)` T2 定义 T2 测试一致。
