# Report Mode 商户信息月份切换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Report Mode 商户信息的两处展示位置（左侧上下文面板统计卡片 + 聊天区概览卡片）加入月份下拉选择器，支持查看近 12 个月各月数据。

**Architecture:** 纯前端改造。复用现有 `fetchMerchantMetrics`（`/api/ui/db/merchant`，返回 `monthlyAmazonMetrics`，SQL 已 `ORDER BY month DESC`）。新增一批纯函数（月份行→虚拟 offer 合并、月份格式化、下拉 HTML、月度指标行），用 `data-card="context|overview"` 区分两张卡片的重渲染目标；聊天区卡片用「先同步渲染降级、后异步增强」模式（`data-monthly-state="pending"` + 事件后 `enhanceMerchantCards` 就地升级），与现有 `loadDbMerchantInsight` 的渐进增强先例一致，保证 `answerPrompt` 保持同步（测试依赖它同步返回 HTML）。

**Tech Stack:** Vanilla JS（`public/app.js` IIFE）、Node.js vm sandbox 测试（`scripts/test_merchant_monthly.mjs`）、GitHub Actions（`.github/workflows/ci.yml`）。

## Global Constraints

- **不要读取整个 `public/app.js`**（约 19000 行 IIFE）。只读任务指定的行区间，改动只触及 `renderMerchantStats`（7128-7159）、`renderContextPanel`（7248-7287）、`merchantOverviewHtml`/`fieldRows`（7514-7546）、`addMessage`（9016-9022）、chat 流程（10270-10293）、hooks（19142-19150）、helper 插入点（1139 后）、init 事件区（18263+）。
- **新增纯函数必须暴露到 `OFFER_INTELLIGENCE_TEST_HOOKS`**（app.js 19015-19151 的 `window.OFFER_INTELLIGENCE_TEST_HOOKS` 对象）。
- 月份范围：**近 12 个月**（`fetchMerchantMetrics(merchantId, 12)`）。默认选中月度序列**最新月**（`monthlyRows[0]`，SQL 已降序）。
- 月份显示名：zh「2026年8月」/ en「Aug 2026」。概览卡片标签走 `chatLabelText`，需在 `chatbot_i18n.js` 的 `LABELS_ZH` 增加 `"All Commission": "总佣金"`、`"Aff Commission": "联盟佣金"`。
- `mergeMonthIntoOffer` 字段映射（唯一映射表）：`salesAmount=row.revenue`、`aov=row.aov`、`conversionRate=row.conversionRate`、`payout=row.payout`（All Commission）、`affCommission=row.affiliatePayout`（Aff Commission）、`orders=row.orders`、`clicks=row.clicks`、`dpv=row.dpv`、`atc=row.atc`。offer 级属性（tier/network/category/commissionRate/payment 等）保留。
- 下拉选择器结构（唯一约定）：`<select class="merchant-month-picker" data-merchant-id="…" data-card="context|overview">`；每项 `<option value="2026-08" [selected]>显示名</option>`。
- 聊天区概览卡片容器（唯一约定）：`<div class="merchant-card" data-merchant-card="merchant-card-<seq>" data-merchant-id="…" data-extra="…" data-language="…" data-monthly-state="pending">`。`<seq>` 来自模块级递增计数器 `let merchantCardSeq = 0`。
- **降级规则**：`monthlyRows` 为 null/空数组时，两处都按现状渲染（offer 字段），不显示下拉。
- **测试数据驱动**：不硬编码 Shokz 的具体数值（缓存会刷新）。月度行用例用合成 fixture，offer 用例从 `protected_data/db_offers_cache.json` 动态取（沿用 `test_commission_all_aff.mjs` 模式）。
- 不改后端、不改 `public/index.html`、`public/styles.css`、不动 `recommendationExportColumns`/导出列。
- 任务完成后务必关闭本地服务器（`http://127.0.0.1:8765/`），用 `netstat -ano | grep 8765 | grep LISTEN` + `taskkill //F //PID <PID>`。

## File Structure

| 文件 | 责任 |
|------|------|
| `public/app.js` | 新增纯函数 + 两处渲染改造 + 事件绑定 + hooks 暴露（主改动） |
| `public/chatbot_i18n.js` | `LABELS_ZH` 增加 2 个标签键（概览卡片 zh 标签） |
| `scripts/test_merchant_monthly.mjs` | 新建，vm sandbox 测试（纯函数 + 两处渲染） |
| `.github/workflows/ci.yml` | 测试步骤增加一行 |
| `CLAUDE.md` | 测试命令节增加一行 |

`public/app.js` 内新增/改动的函数清单（按定义顺序）：

| 函数 | 位置 | 说明 |
|------|------|------|
| `mergeMonthIntoOffer(offer, row)` | 1139 后 | 纯函数：月度行→虚拟 offer |
| `selectedMonthRow(monthlyRows, selectedMonth)` | 1139 后 | 取所选月行，缺省最新月 |
| `formatMonthLabel(month, language)` | 1139 后 | 月份显示名格式化 |
| `merchantMonthPickerHtml(offer, months, selectedMonth, scope, language)` | 1139 后 | 下拉 HTML（scope=context\|overview） |
| `monthlyMetricRows(active, language)` | 1139 后 | 概览卡片月度指标行（[label, value] 对） |
| `offerByMerchantId(merchantId)` | 1139 后 | `offersByMerchantId` Map 直接查找 |
| `fetchMerchantMonthlyRows(offer)` | 1139 后 | 异步：复用 `fetchMerchantMetrics(id, 12)`，返回数组或 null |
| `let merchantCardSeq = 0` | 1139 后 | 模块级计数器 |
| `renderMerchantStats(offer, monthlyRows, selectedMonth)` | 7128-7159 改造 | 统计卡片；有月度数据→注入下拉 + 所选月虚拟 offer |
| `_contextRenderSeq` + `renderMerchantStatsPanel(offer, renderSeq)` | 7248 前 | 异步渲染 recBox + 竞态守卫 |
| `renderContextPanel` merchant 分支 | 7265-7266 改造 | 调 `renderMerchantStatsPanel` |
| `merchantOverviewCardInner(offer, monthlyRows, selectedMonth, extra, language)` | 7532 前 | 概览卡片内容（h4+下拉+ul） |
| `merchantOverviewHtml(offer, extra, language, monthlyRows)` | 7532-7546 改造 | 外层容器带 `data-merchant-card` + 下载卡 |
| `addMessage` 返回 `msg` | 9016-9022 改造 | 供 chat 流程捕获消息元素 |
| `enhanceMerchantCards(container)` | 9016 后 | 异步就地升级 pending 概览卡片 |
| chat 流程 10277/10279 捕获元素并调 `enhanceMerchantCards` | 10270-10280 改造 | |
| init() `document` 级 change 委托 | 18263+ 追加 | `.merchant-month-picker` change 重渲染 |
| hooks 新增条目 | 19149 后追加 | 全部新纯函数 + 渲染函数 |

---

### Task 1: 月度纯函数 + hooks + 测试脚本

**Files:**
- Modify: `public/app.js:1139`（`offerAffEpc` 后插入 helper 块；`merchantCardSeq`）
- Modify: `public/app.js:19149`（hooks 增加新函数条目）
- Create: `scripts/test_merchant_monthly.mjs`
- Modify: `.github/workflows/ci.yml:56`（回归测试步骤）
- Modify: `CLAUDE.md:51`（测试命令节）

**Interfaces:**
- Consumes: 现有 `offerAllEpc`/`offerAffEpc`/`offerAllCommission`/`offerAffCommission`（app.js:1119-1139）、`offerAllCommission` 用 `offer.payout`/`offer.affCommission`；`escapeHtml`（871-1120 区间）、`money`/`epc`/`pct`/`countValue`（472-719 区间）、`fetchMerchantMetrics(merchantId, months)`（5486）。
- Produces（Task 2/3 依赖）:
  - `mergeMonthIntoOffer(offer, row) → offer`（浅拷贝，仅覆写月度字段）
  - `selectedMonthRow(monthlyRows, selectedMonth) → row|null`
  - `formatMonthLabel(month, language) → string`
  - `merchantMonthPickerHtml(offer, months, selectedMonth, scope, language) → string`
  - `monthlyMetricRows(active, language) → [label, value][]`
  - `offerByMerchantId(merchantId) → offer|null`
  - `fetchMerchantMonthlyRows(offer) → Promise<array|null>`
  - `let merchantCardSeq = 0`（模块级）

- [ ] **Step 1: 写失败测试** `scripts/test_merchant_monthly.mjs`

仿照 `scripts/test_commission_all_aff.mjs`（vm sandbox，`window.__OFFER_INTELLIGENCE_TEST__`）。断言：

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
function assertMatch(actual, pattern, label) {
  if (!pattern.test(actual)) throw new Error(`${label}: expected ${JSON.stringify(actual)} to match ${pattern}`);
}
function assertNotMatch(actual, pattern, label) {
  if (pattern.test(actual)) throw new Error(`${label}: expected ${JSON.stringify(actual)} to NOT match ${pattern}`);
}

const elementStub = {
  addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} },
  dataset: {}, appendChild() {}, querySelectorAll() { return []; },
  querySelector() { return null; }, setAttribute() {}, removeAttribute() {}, style: {}
};
const sandbox = {
  console, Date, Math, Number, String, RegExp, Array, Object, Set, Map, JSON,
  window: { __OFFER_INTELLIGENCE_TEST__: true },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  document: {
    getElementById() { return elementStub; },
    querySelectorAll() { return []; },
    querySelector() { return elementStub; },
    createElement() { return { ...elementStub }; }
  }
};
sandbox.window.document = sandbox.document;

const _offersCache = JSON.parse(fs.readFileSync("protected_data/db_offers_cache.json", "utf8"));
sandbox.window.CHATBOT_DATA = {
  summary: _offersCache.summary || {},
  offers: _offersCache.offers || [],
  paymentRecords: _offersCache.paymentRecords || [],
  sources: { mode: "db", month: _offersCache.month }
};
sandbox.window.SHEET_REPORT_DATA = {
  sheets: _offersCache.sheets || [],
  tierSheets: ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"]
};
const _kwCache = JSON.parse(fs.readFileSync("protected_data/db_keywords_cache.json", "utf8"));
sandbox.window.PRODUCT_KEYWORDS = _kwCache;
runScript("public/chatbot_i18n.js", sandbox);
runScript("public/tier2_recommendation_rules.js", sandbox);
runScript("public/app.js", sandbox);

const hooks = sandbox.window.OFFER_INTELLIGENCE_TEST_HOOKS;
assertTruthy(hooks, "app should expose test hooks in test mode");
assertTruthy(hooks.mergeMonthIntoOffer && hooks.formatMonthLabel && hooks.merchantMonthPickerHtml &&
  hooks.selectedMonthRow && hooks.monthlyMetricRows && hooks.offerByMerchantId && hooks.fetchMerchantMonthlyRows,
  "monthly helpers should be exposed in hooks");

// ── 用例 1：月份行→offer 映射 ──
const base = { merchantId: "362653", brand: "Shokz", tier: "Tier 1", network: "Awin",
  category: "Audio", commissionRate: 0.2, paymentStatus: "Paid", linkStatus: "ok" };
const aug = { month: "2026-08", orders: 120, revenue: 9600, payout: 1440, affiliatePayout: 960,
  clicks: 2400, dpv: 2600, atc: 400, aov: 80, conversionRate: 0.05 };
const merged = hooks.mergeMonthIntoOffer(base, aug);
assertEqual(merged.salesAmount, 9600, "merged salesAmount should come from row.revenue");
assertEqual(merged.payout, 1440, "merged payout should come from row.payout");
assertEqual(merged.affCommission, 960, "merged affCommission should come from row.affiliatePayout");
assertEqual(merged.orders, 120, "merged orders should come from row.orders");
assertEqual(merged.clicks, 2400, "merged clicks should come from row.clicks");
assertEqual(merged.dpv, 2600, "merged dpv should come from row.dpv");
assertEqual(merged.atc, 400, "merged atc should come from row.atc");
assertEqual(merged.aov, 80, "merged aov should come from row.aov");
assertEqual(merged.conversionRate, 0.05, "merged conversionRate should come from row.conversionRate");
assertEqual(merged.tier, "Tier 1", "offer-level tier should be preserved");
assertEqual(merged.network, "Awin", "offer-level network should be preserved");
assertEqual(merged.category, "Audio", "offer-level category should be preserved");
assertEqual(merged.brand, "Shokz", "offer-level brand should be preserved");
assertNotEqual(merged, base, "mergeMonthIntoOffer should return a shallow copy, not mutate the input");

// ── 用例 2：EPC 公式复用（映射后 offerAllEpc/offerAffEpc 直接成立）──
assertEqual(hooks.offerAllEpc(merged), 1440 / 2400, "All EPC should be payout/clicks on merged offer");
assertEqual(hooks.offerAffEpc(merged), 960 / 2400, "Aff EPC should be affiliatePayout/clicks on merged offer");
assertEqual(hooks.offerAllCommission(merged), 1440, "All Commission should be payout on merged offer");
assertEqual(hooks.offerAffCommission(merged), 960, "Aff Commission should be affCommission on merged offer");

// ── 用例 3：月份格式化 ──
assertEqual(hooks.formatMonthLabel("2026-08", "zh"), "2026年8月", "zh month label format");
assertEqual(hooks.formatMonthLabel("2026-08", "en"), "Aug 2026", "en month label format");
assertEqual(hooks.formatMonthLabel("2026-12", "en"), "Dec 2026", "en December format");
assertEqual(hooks.formatMonthLabel("2026-01", "zh"), "2026年1月", "zh January format");

// ── 用例 4：下拉 HTML ──
const rows4 = [
  { month: "2026-08", revenue: 9600, payout: 1440, affiliatePayout: 960, clicks: 2400, aov: 80, orders: 120, conversionRate: 0.05 },
  { month: "2026-07", revenue: 8000, payout: 1200, affiliatePayout: 800, clicks: 2000, aov: 80, orders: 100, conversionRate: 0.05 },
  { month: "2026-06", revenue: 7200, payout: 1080, affiliatePayout: 720, clicks: 1800, aov: 80, orders: 90, conversionRate: 0.05 }
];
const pickerZh = hooks.merchantMonthPickerHtml(base, rows4, "2026-07", "context", "zh");
assertMatch(pickerZh, /merchant-month-picker/, "picker should have merchant-month-picker class");
assertMatch(pickerZh, /data-merchant-id="362653"/, "picker should carry data-merchant-id");
assertMatch(pickerZh, /data-card="context"/, "picker should carry data-card=context");
assertMatch(pickerZh, /2026年8月/, "picker zh should list 2026年8月");
assertMatch(pickerZh, /2026年7月/, "picker zh should list 2026年7月");
assertMatch(pickerZh, /<option value="2026-07" selected>/, "selected month option should be marked selected");
assertEqual((pickerZh.match(/<option/g) || []).length, 3, "picker should have 3 month options");
const pickerOverview = hooks.merchantMonthPickerHtml(base, rows4, null, "overview", "en");
assertMatch(pickerOverview, /data-card="overview"/, "picker overview should carry data-card=overview");
assertMatch(pickerOverview, /Aug 2026/, "en picker should show Aug 2026");
assertMatch(pickerOverview, /<option value="2026-08" selected>/, "default selected should be latest month");

// ── 用例 5：selectedMonthRow ──
assertEqual(hooks.selectedMonthRow(rows4, "2026-06").month, "2026-06", "selectedMonthRow should pick requested month");
assertEqual(hooks.selectedMonthRow(rows4, "2026-07").month, "2026-07", "selectedMonthRow should pick requested month");
assertEqual(hooks.selectedMonthRow(rows4, null).month, "2026-08", "selectedMonthRow default should be latest month");
assertEqual(hooks.selectedMonthRow([], "2026-08"), null, "empty rows should return null");
assertEqual(hooks.selectedMonthRow(null, "2026-08"), null, "null rows should return null");

// ── 用例 6：月度指标行 ──
const metricRows = hooks.monthlyMetricRows(merged, "zh");
const metricByLabel = Object.fromEntries(metricRows);
assertEqual(metricByLabel["EPC(All)"], hooks.epc(1440 / 2400), "metric rows EPC(All) should use epc format");
assertEqual(metricByLabel["EPC(Aff)"], hooks.epc(960 / 2400), "metric rows EPC(Aff) should use epc format");
assertEqual(metricByLabel["CVR"], hooks.pct(0.05), "metric rows CVR should use pct format");
assertEqual(metricByLabel["Revenue"], hooks.money(9600), "metric rows Revenue should use money format");
assertEqual(metricByLabel["All Commission"], hooks.money(1440), "metric rows All Commission should use money format");
assertEqual(metricByLabel["Aff Commission"], hooks.money(960), "metric rows Aff Commission should use money format");
assertEqual(metricByLabel["Orders"], hooks.countValue(120), "metric rows Orders should use countValue format");
assertEqual(metricByLabel["Clicks"], hooks.countValue(2400), "metric rows Clicks should use countValue format");

// ── 用例 7：offerByMerchantId ──
const shokz = (_offersCache.offers || []).find((o) => String(o.merchantId) === "362653");
assertTruthy(shokz, "Shokz 362653 offer should exist in cache");
assertEqual(hooks.offerByMerchantId("362653").merchantId, "362653", "offerByMerchantId should find by id");
assertEqual(hooks.offerByMerchantId("999999"), null, "offerByMerchantId should return null for unknown id");

console.log("PASS: merchant monthly pure helpers");
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/test_merchant_monthly.mjs`
Expected: FAIL（`hooks.mergeMonthIntoOffer` undefined 等）。

- [ ] **Step 3: 实现纯函数**（`public/app.js`，`offerAffEpc` 结束后、`function countValue` 之前插入）

在 `public/app.js:1139`（`offerAffEpc` 函数体结束）之后插入：

```js
  let merchantCardSeq = 0; // 聊天区概览卡片容器唯一 id 计数器

  function mergeMonthIntoOffer(offer, row) {
    return Object.assign({}, offer, {
      salesAmount: row.revenue,            // Revenue made
      aov: row.aov,
      conversionRate: row.conversionRate,
      payout: row.payout,                  // All Commission
      affCommission: row.affiliatePayout,  // Aff Commission（映射后 offerAffEpc/offerAffCommission 直接复用）
      orders: row.orders,
      clicks: row.clicks,
      dpv: row.dpv,
      atc: row.atc
    });
  }

  function selectedMonthRow(monthlyRows, selectedMonth) {
    if (!monthlyRows || !monthlyRows.length) return null;
    if (selectedMonth) {
      const found = monthlyRows.find((r) => r.month === selectedMonth);
      if (found) return found;
    }
    return monthlyRows[0]; // SQL ORDER BY month DESC → [0] 为最新月
  }

  function formatMonthLabel(month, language) {
    const parts = String(month || "").split("-");
    const year = parts[0];
    const num = parseInt(parts[1], 10);
    if (!year || !num || isNaN(num)) return month || "";
    if (language === "zh") return year + "年" + num + "月";
    const enMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return enMonths[num - 1] + " " + year;
  }

  function merchantMonthPickerHtml(offer, months, selectedMonth, scope, language) {
    const options = (months || []).map((m) => {
      const value = String(m.month || "");
      const sel = value && value === selectedMonth ? " selected" : "";
      return `<option value="${escapeHtml(value)}"${sel}>${escapeHtml(formatMonthLabel(value, language))}</option>`;
    }).join("");
    return `<select class="merchant-month-picker" data-merchant-id="${escapeHtml(String(offer.merchantId || ""))}" data-card="${escapeHtml(scope)}">${options}</select>`;
  }

  function monthlyMetricRows(active, language) {
    return [
      ["EPC(All)", epc(offerAllEpc(active))],
      ["EPC(Aff)", epc(offerAffEpc(active))],
      ["CVR", pct(active.conversionRate)],
      ["Revenue", money(active.salesAmount)],
      ["All Commission", money(offerAllCommission(active))],
      ["Aff Commission", money(offerAffCommission(active))],
      ["Orders", countValue(active.orders)],
      ["Clicks", countValue(active.clicks)]
    ];
  }

  function offerByMerchantId(merchantId) {
    const id = String(merchantId || "").trim();
    return id ? offersByMerchantId.get(id) || null : null;
  }

  async function fetchMerchantMonthlyRows(offer) {
    if (!offer) return null;
    const merchantId = String(offer.merchantId || "").trim();
    if (!merchantId) return null;
    const payload = await fetchMerchantMetrics(merchantId, 12);
    const rows = payload && Array.isArray(payload.monthlyAmazonMetrics) ? payload.monthlyAmazonMetrics : null;
    return rows && rows.length ? rows : null;
  }
```

注意：这些函数用到的 `escapeHtml`/`money`/`epc`/`pct`/`countValue`/`offerAll*`/`fetchMerchantMetrics`/`offersByMerchantId` 均在 IIFE 作用域内（函数声明提升，位置无关）。

- [ ] **Step 4: hooks 暴露**（`public/app.js`，在 `renderMerchantStats,` 一行后追加）

在 `public/app.js:19149` 的 `renderMerchantStats,` 后追加（`money`/`shortEpc`/`labelText` 已在 hooks 中，无需重复；`epc`/`pct`/`countValue` 是新测试需要，一并补上）：

```js
      epc,
      pct,
      countValue,
      formatMonthLabel,
      mergeMonthIntoOffer,
      selectedMonthRow,
      merchantMonthPickerHtml,
      monthlyMetricRows,
      offerByMerchantId,
      fetchMerchantMonthlyRows,
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node scripts/test_merchant_monthly.mjs`
Expected: PASS。再 `node --check public/app.js` 通过。

- [ ] **Step 6: 接入 CI + CLAUDE.md**

`.github/workflows/ci.yml:56`（`node scripts/test_commission_all_aff.mjs` 之后）追加：

```yaml
          node scripts/test_merchant_monthly.mjs
```

`CLAUDE.md:51`（`node scripts/test_commission_all_aff.mjs` 之后）追加：

```
node scripts/test_merchant_monthly.mjs
```

- [ ] **Step 7: 提交**

```bash
git add public/app.js scripts/test_merchant_monthly.mjs .github/workflows/ci.yml CLAUDE.md
git commit -m "feat(chatbot): 商户月度指标纯函数（mergeMonthIntoOffer/formatMonthLabel/下拉/月度行）+ hooks + 测试"
```

---

### Task 2: 左侧上下文面板统计卡片（renderMerchantStats + 异步渲染 + context 切换）

**Files:**
- Modify: `public/app.js:7128-7159`（`renderMerchantStats`）
- Modify: `public/app.js:7248`（`renderContextPanel` 顶部 + merchant 分支）
- Modify: `public/app.js`（init() 增加 document 级 change 委托的 `data-card="context"` 分支）
- Modify: `scripts/test_merchant_monthly.mjs`（追加渲染断言）

**Interfaces:**
- Consumes（Task 1 产物）: `mergeMonthIntoOffer`、`selectedMonthRow`、`merchantMonthPickerHtml`、`fetchMerchantMonthlyRows`、`offerByMerchantId`。
- Consumes（现有）: `statCards`（7050）、`textValue`、`tierGroup`、`displayCategory`、`paymentByMonthText`、`recommendedAction`、`els.recBox`。
- Produces:
  - `renderMerchantStats(offer, monthlyRows, selectedMonth) → string`（monthlyRows/selectedMonth 可选；无月度数据→现状渲染，不显示下拉）
  - `_contextRenderSeq`（模块级 let）+ `renderMerchantStatsPanel(offer, renderSeq)`（async）
  - `renderContextPanel` 顶部 `const renderSeq = ++_contextRenderSeq;`，merchant 分支改调 `renderMerchantStatsPanel`

- [ ] **Step 1: 追加渲染测试**（`scripts/test_merchant_monthly.mjs` 末尾，Task 1 用例之后）

```js
// ── 用例 8：统计卡片（有月度数据 → 下拉 + 所选月虚拟 offer）──
const statsWithRows = hooks.renderMerchantStats(shokz, rows4);
assertMatch(statsWithRows, /merchant-month-picker/, "stats card should render month picker with rows");
assertMatch(statsWithRows, /data-card="context"/, "stats card picker should be context scope");
assertMatch(statsWithRows, /2026年8月/, "stats card picker should show zh month labels");
assertMatch(statsWithRows, /总佣金/, "stats card should keep All Commission zh label");
assertMatch(statsWithRows, /\$9,600/, "stats card Revenue made should reflect merged revenue 9600 (money format $9,600)");
assertMatch(statsWithRows, /\$0\.600/, "stats card EPC(All) should be payout/clicks of latest month");
// 指定所选月（7 月）
const statsJul = hooks.renderMerchantStats(shokz, rows4, "2026-07");
assertMatch(statsJul, /<option value="2026-07" selected>/, "stats card selected month should follow selectedMonth arg");
assertMatch(statsJul, /\$8,000/, "stats card Revenue made should reflect July revenue");

// ── 用例 9：统计卡片（无月度数据 → 降级，无下拉）──
const statsNoRows = hooks.renderMerchantStats(shokz, null);
assertNotMatch(statsNoRows, /merchant-month-picker/, "no monthly rows should not render picker");
assertMatch(statsNoRows, /总佣金/, "degraded stats card should keep All Commission zh label");
```

注意：`rows4` 已在 Task 1 用例 4 中定义（含 revenue 等）。`shokz` 已在 Task 1 用例 7 定义。`hooks.pct`/`hooks.money`/`hooks.epc`/`hooks.countValue` 已在 hooks（19146-19148）暴露。

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/test_merchant_monthly.mjs`
Expected: FAIL（`renderMerchantStats` 不接受第二参数，无下拉输出）。

- [ ] **Step 3: 改造 `renderMerchantStats`**（`public/app.js:7128-7159` 整体替换）

原签名 `function renderMerchantStats(offer)` → 新签名 `function renderMerchantStats(offer, monthlyRows, selectedMonth)`：

```js
  function renderMerchantStats(offer, monthlyRows, selectedMonth) {
    const row = selectedMonthRow(monthlyRows, selectedMonth);
    const active = row ? mergeMonthIntoOffer(offer, row) : offer;
    const picker = monthlyRows && monthlyRows.length
      ? merchantMonthPickerHtml(offer, monthlyRows, row ? row.month : null, "context", state.language)
      : "";
    return `<div class="merchant-focus">
      <h4>${escapeHtml(offer.brand || "Merchant")}</h4>
      ${picker}
      ${statCards([
        ["Merchant ID", textValue(active.merchantId)],
        ["Tier", tierGroup(active)],
        ["Network", textValue(active.network)],
        ["Category", textValue(displayCategory(active))],
        ["AOV", money(active.aov)],
        ["EPC(All)", epc(offerAllEpc(active))],
        ["EPC(Aff)", epc(offerAffEpc(active))],
        ["CVR", pct(active.conversionRate)],
        ["Revenue made", money(active.salesAmount)],
        ["All Commission", money(offerAllCommission(active))],
        ["Aff Commission", money(offerAffCommission(active))],
        ["Orders", countValue(active.orders)],
        ["Clicks", countValue(active.clicks)],
        ["DPV", countValue(active.dpv)],
        ["ATC", countValue(active.atc)],
        ["Commission rate", (Number(active.commissionRate) || 0).toFixed(2) + "%"],
        ["Payment", textValue(active.paymentStatus)],
        ["Link status", textValue(active.linkStatus || active.recommendedLink)]
      ])}
      <div class="context-note">
        <strong>CPC:</strong> ${escapeHtml(textValue(offer.cpc))}<br>
        <strong>Discount/deal:</strong> ${escapeHtml(textValue(offer.dealInfo || offer.discountInfo))}<br>
        <strong>Payment by month:</strong> ${escapeHtml(paymentByMonthText(offer))}<br>
        <strong>Recommended action:</strong> ${escapeHtml(recommendedAction(offer))}<br>
        <strong>Notes:</strong> ${escapeHtml(textValue(offer.recommendation || offer.reason))}
      </div>
    </div>`;
  }
```

注意：`mergeMonthIntoOffer` 保留 offer 级字段，故非月度 statCards 行用 `active` 渲染与用原 `offer` 等价；context-note 仍用原 `offer`（设计明确非月度部分不随月份变）。`renderASINStats`（7173）单参调用 → 降级，不变。

- [ ] **Step 4: 改造 `renderContextPanel` + 异步渲染 + 竞态守卫**（`public/app.js:7248` 前插入辅助，7265-7266 改分支）

在 `function renderContextPanel` 之前插入：

```js
  let _contextRenderSeq = 0;

  async function renderMerchantStatsPanel(offer, renderSeq) {
    const monthlyRows = await fetchMerchantMonthlyRows(offer);
    if (renderSeq !== _contextRenderSeq) return; // 已被更新的上下文覆盖
    els.recBox.innerHTML = renderMerchantStats(offer, monthlyRows);
  }
```

`renderContextPanel` 开头（`const query = ...` 之前）插入：

```js
    const renderSeq = ++_contextRenderSeq;
```

merchant 分支（原 7265-7266）替换为：

```js
    if (context.type === "merchant") {
      renderMerchantStatsPanel(context.items[0], renderSeq);
    } else if (context.type === "asin") {
```

（其余分支不变。降级：无 DB 时 `fetchMerchantMonthlyRows` 返回 null → `renderMerchantStats(offer, null)` 现状渲染。）

- [ ] **Step 5: init() 增加 context 分支的 change 委托**（`public/app.js`，init() 内、`els.dashboardCategoryTierPicker.addEventListener`（18305）之后追加）

```js
    // 商户信息月份切换：事件委托捕获 context/overview 下拉
    document.addEventListener("change", async function (e) {
      const picker = e.target && e.target.closest ? e.target.closest(".merchant-month-picker") : null;
      if (!picker) return;
      const offer = offerByMerchantId(picker.getAttribute("data-merchant-id"));
      if (!offer) return;
      const cardType = picker.getAttribute("data-card");
      const month = picker.value;
      if (cardType === "context") {
        const monthlyRows = await fetchMerchantMonthlyRows(offer);
        if (!monthlyRows) return;
        els.recBox.innerHTML = renderMerchantStats(offer, monthlyRows, month);
      } else if (cardType === "overview") {
        const container = picker.closest(".merchant-card");
        if (!container) return;
        const monthlyRows = await fetchMerchantMonthlyRows(offer);
        if (!monthlyRows) return;
        container.innerHTML = merchantOverviewCardInner(offer, monthlyRows, month,
          container.getAttribute("data-extra") || "",
          container.getAttribute("data-language") || responseLanguageFor());
      }
    });
```

（`merchantOverviewCardInner` 在 Task 3 实现；本任务完成后该 overview 分支不会触发——概览卡片尚无下拉，但代码就位、无副作用。）

- [ ] **Step 6: 运行测试 + 语法检查**

Run: `node scripts/test_merchant_monthly.mjs` + `node --check public/app.js`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add public/app.js scripts/test_merchant_monthly.mjs
git commit -m "feat(chatbot): 左侧上下文面板统计卡片月份切换（renderMerchantStats 异步渲染 + 竞态守卫 + change 委托）"
```

---

### Task 3: 聊天区概览卡片（merchantOverviewHtml + 异步增强 + overview 切换 + i18n）

**Files:**
- Modify: `public/app.js:7514-7546`（`fieldRows` 不动；`merchantOverviewHtml` 前插入 `merchantOverviewCardInner`，整体改造 `merchantOverviewHtml`）
- Modify: `public/app.js:9016-9022`（`addMessage` 返回 `msg`，其后插入 `enhanceMerchantCards`）
- Modify: `public/app.js:10270-10280`（chat 流程捕获消息元素并调 `enhanceMerchantCards`）
- Modify: `public/app.js:19149`（hooks 增加 `merchantOverviewHtml`/`merchantOverviewCardInner`/`enhanceMerchantCards`）
- Modify: `public/chatbot_i18n.js:162`（`LABELS_ZH` 加 2 键）
- Modify: `scripts/test_merchant_monthly.mjs`（追加概览卡片断言）

**Interfaces:**
- Consumes（Task 1/2 产物）: `mergeMonthIntoOffer`、`selectedMonthRow`、`merchantMonthPickerHtml`、`monthlyMetricRows`、`offerByMerchantId`、`fetchMerchantMonthlyRows`、`renderMerchantStats`；`fieldRows`（7514）、`downloadCardHtml`（11265）、`chatLabelText`（954）、`chatCopy`（945）、`responseLanguageFor`（940）。
- Produces:
  - `merchantOverviewCardInner(offer, monthlyRows, selectedMonth, extra, language) → string`
  - `merchantOverviewHtml(offer, extra, language, monthlyRows) → string`（容器带 `data-merchant-card`/`data-monthly-state="pending"`）
  - `enhanceMerchantCards(container) → Promise<void>`（就地升级 pending 概览卡片）
  - `addMessage(role, html) → Element`

- [ ] **Step 1: 追加概览卡片测试**（`scripts/test_merchant_monthly.mjs` 末尾）

```js
// ── 用例 10：概览卡片内容（有月度数据 → 下拉 + 月度指标行）──
const overviewInner = hooks.merchantOverviewCardInner(shokz, rows4, null, "", "zh");
assertMatch(overviewInner, /merchant-month-picker/, "overview card should render month picker with rows");
assertMatch(overviewInner, /data-card="overview"/, "overview picker should be overview scope");
assertMatch(overviewInner, /2026年8月/, "overview picker should show zh month labels");
assertMatch(overviewInner, /总佣金/, "overview card should show All Commission zh label (via chatLabelText/LABELS_ZH)");
assertMatch(overviewInner, /EPC\(All\)/, "overview card should show EPC(All) row");
assertMatch(overviewInner, /EPC\(Aff\)/, "overview card should show EPC(Aff) row");
assertMatch(overviewInner, /联盟佣金/, "overview card should show Aff Commission zh label");
assertMatch(overviewInner, /\$9,600/, "overview card Revenue row should reflect merged revenue 9600 (money format $9,600)");

// ── 用例 11：概览卡片 HTML（容器标识 + pending 状态）──
const overviewHtml = hooks.merchantOverviewHtml(shokz, "(ASIN match)", "zh", rows4);
assertMatch(overviewHtml, /data-merchant-card="merchant-card-\d+"/, "overview html should carry unique merchant-card id");
assertMatch(overviewHtml, /data-merchant-id="362653"/, "overview html should carry merchant id");
assertMatch(overviewHtml, /data-monthly-state="pending"/, "overview html should be pending for async enhancement");
assertMatch(overviewHtml, /\(ASIN match\)/, "overview html should keep extra text");
assertMatch(overviewHtml, /download-xlsx-button/, "overview html should keep download card");

// ── 用例 12：概览卡片内容（无月度数据 → 降级，无下拉、无月度行）──
const overviewNoRows = hooks.merchantOverviewCardInner(shokz, null, null, "", "zh");
assertNotMatch(overviewNoRows, /merchant-month-picker/, "no monthly rows should not render picker in overview");
assertNotMatch(overviewNoRows, /EPC\(All\)/, "no monthly rows should not render EPC(All) row");
```

注意：`hooks.merchantOverviewHtml`/`merchantOverviewCardInner`/`enhanceMerchantCards` 需在 Task 3 Step 7 暴露到 hooks。`money(9600)` 输出 `$9,600`（`toLocaleString` 千分位、无强制小数，见 app.js:1061-1064）。

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/test_merchant_monthly.mjs`
Expected: FAIL（`hooks.merchantOverviewCardInner` undefined / 概览无下拉）。

- [ ] **Step 3: 实现 `merchantOverviewCardInner` + 改造 `merchantOverviewHtml`**（`public/app.js`，`merchantOverviewHtml` 定义处整体替换，`merchantOverviewCardInner` 定义在它之前）

```js
  function merchantOverviewCardInner(offer, monthlyRows, selectedMonth, extra, language) {
    const row = selectedMonthRow(monthlyRows, selectedMonth);
    const active = row ? mergeMonthIntoOffer(offer, row) : offer;
    const picker = monthlyRows && monthlyRows.length
      ? merchantMonthPickerHtml(offer, monthlyRows, row ? row.month : null, "overview", language)
      : "";
    const rows = fieldRows(active, language);
    const extras = monthlyRows && monthlyRows.length ? monthlyMetricRows(active, language) : [];
    const listItems = rows.concat(extras).map(([label, value]) =>
      `<li><strong>${escapeHtml(chatLabelText(label, language))}:</strong> ${escapeHtml(value)}</li>`
    ).join("");
    return `<h4>${escapeHtml(offer.brand || chatCopy(language).merchantOverview || "Merchant")} ${extra}</h4>${picker}<ul>${listItems}</ul>`;
  }

  function merchantOverviewHtml(offer, extra = "", language = responseLanguageFor(), monthlyRows) {
    const cardId = "merchant-card-" + (++merchantCardSeq);
    const content = merchantOverviewCardInner(offer, monthlyRows, null, extra, language);
    return `<div class="merchant-card" data-merchant-card="${cardId}" data-merchant-id="${escapeHtml(String(offer.merchantId || ""))}" data-extra="${escapeHtml(extra)}" data-language="${escapeHtml(language)}" data-monthly-state="pending">${content}</div>` +
      downloadCardHtml([offer], {
        downloadType: "offers",
        filePrefix: "merchant_offer",
        exportScope: offer.brand || offer.merchantId || "merchant",
        sheetName: "Merchant"
      }, {
        title: "Merchant file",
        description: "1 offer row with compact merchant metrics."
      });
  }
```

现有 3 参调用（`merchantOverviewHtml(offer, "(ASIN match)", language)`，8545/8548）→ `monthlyRows` undefined → 降级渲染（同现状），随后被 `enhanceMerchantCards` 异步升级。`merchantOverview`（7527）不变。

- [ ] **Step 4: `addMessage` 返回元素 + `enhanceMerchantCards`**（`public/app.js:9016-9022`）

```js
  function addMessage(role, html) {
    const msg = document.createElement("div");
    msg.className = `message ${role}`;
    msg.innerHTML = html;
    els.chatLog.appendChild(msg);
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
    return msg;
  }

  async function enhanceMerchantCards(container) {
    if (!container || !container.querySelectorAll) return;
    const cards = container.querySelectorAll('[data-merchant-card][data-monthly-state="pending"]');
    for (const card of cards) {
      card.setAttribute("data-monthly-state", "done");
      const offer = offerByMerchantId(card.getAttribute("data-merchant-id"));
      if (!offer) continue;
      const monthlyRows = await fetchMerchantMonthlyRows(offer);
      if (!monthlyRows) continue; // 无月度数据 → 保持降级渲染
      const language = card.getAttribute("data-language") || responseLanguageFor();
      const extra = card.getAttribute("data-extra") || "";
      card.innerHTML = merchantOverviewCardInner(offer, monthlyRows, null, extra, language);
    }
  }
```

- [ ] **Step 5: chat 流程捕获消息元素并增强**（`public/app.js:10272-10280`）

```js
      var html = answerPrompt(prompt);
      var addedMsg;
      if (isDeep && panel) {
        _showQuickResultInDeepPanel(panel, html, prompt);
        // 同步左侧 Overview 内容到 Deep Window，使信息一致
        _syncContextOverviewToDeepPanel(panel, html);
        addedMsg = addMessage("assistant", _deepQuickSummaryHtml(panel, prompt, html));
      } else {
        addedMsg = addMessage("assistant", html);
      }
      if (addedMsg) enhanceMerchantCards(addedMsg);
```

- [ ] **Step 6: i18n**（`public/chatbot_i18n.js:162`，`"Notes / recommendation"` 行后、`};` 前）

```js
    "All Commission": "总佣金",
    "Aff Commission": "联盟佣金",
```

- [ ] **Step 7: hooks 追加**（`public/app.js:19149` 后）

```js
      merchantOverviewHtml,
      merchantOverviewCardInner,
      enhanceMerchantCards,
```

- [ ] **Step 8: 运行测试 + 语法检查**

Run: `node scripts/test_merchant_monthly.mjs` + `node --check public/app.js` + `node --check public/chatbot_i18n.js`
Expected: PASS。若用例 10 的 Revenue 断言与实际 `money` 格式不符，按实际输出微调断言（数据驱动原则，不硬编码 Shokz 数值）。

- [ ] **Step 9: 提交**

```bash
git add public/app.js public/chatbot_i18n.js scripts/test_merchant_monthly.mjs
git commit -m "feat(chatbot): 聊天区概览卡片月份切换（异步增强 + overview change 委托 + i18n 标签）"
```

---

## 验证（全部任务完成后）

1. `node --check public/app.js`、`node --check public/chatbot_i18n.js`
2. `node scripts/test_merchant_monthly.mjs` → PASS
3. 回归：`node scripts/test_commission_all_aff.mjs`（确认既有 All/Aff 断言不受影响）、`python scripts/test_auth_helpers.py`
4. 手动验证（可选，本地）：`python server.py` 打开 `http://127.0.0.1:8765/`，Report Mode 提问商户名，确认：左侧统计卡片 + 聊天区概览卡片出现月份下拉，默认选中最新月，切换月份后月度指标（AOV/EPC(All)/EPC(Aff)/CVR/Revenue/All/Aff Commission/Orders/Clicks）随之变化，非月度字段不变。**用毕务必关闭服务器**（`netstat -ano | grep 8765 | grep LISTEN` + `taskkill //F //PID <PID>`）。

## Self-Review（对照 spec）

| spec 需求 | 对应任务 |
|-----------|----------|
| 两处都加（renderMerchantStats + merchantOverviewHtml） | Task 2（统计卡片）、Task 3（概览卡片） |
| 下拉选择器 | Task 1 `merchantMonthPickerHtml` + Task 2/3 注入 |
| 近 12 个月 | Task 1 `fetchMerchantMonthlyRows` 用 `fetchMerchantMetrics(id, 12)` |
| 默认最新月 | Task 1 `selectedMonthRow` 缺省 `rows[0]` + `formatMonthLabel` |
| 概览卡片扩展月度指标（AOV/EPC/CVR/Revenue/Commission/Orders/Clicks） | Task 3 `monthlyMetricRows`（AOV 由 `fieldRows(active)` 承担） |
| 事件绑定区分 data-card | Task 2/3 change 委托 |
| 无月度数据降级 | 每处 `monthlyRows` null/空 → 现状渲染 |
| i18n 标签 | Task 3 chatbot_i18n LABELS_ZH 2 键 |
| 测试（数据驱动、vm sandbox、接入 CI+CLAUDE.md） | Task 1 Step 1/6 |
| 不改后端 / 不读全 app.js | Global Constraints |
