# 商户指标 COMMISSION 拆分 ALL/AFF（含 EPC）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在商户级展示位置（chatbot 商户统计卡片、上下文/结果表格、品类/Tier/对比分析 Top Brands 硬编码表格、Excel 导出列）将 COMMISSION 拆为 All/Aff 两个口径，并新增两种口径下的 EPC。

**Architecture:** 在 `public/app.js` 新增 4 个纯前端辅助函数（`offerAllCommission`/`offerAffCommission`/`offerAllEpc`/`offerAffEpc`），复用现有 `isAvailable`/`number`/`money()`/`shortMoney()`/`epc()`/`shortEpc()`；4 处展示位置替换单值为双列；新增独立测试文件 `scripts/test_commission_all_aff.mjs` 覆盖设计文档 7 项用例；更新受影响的 `contextColumnLabels` 断言。

**Tech Stack:** 原生 JS（`public/app.js`，IIFE 内 function 声明，无构建步骤）；Node vm sandbox 测试（`scripts/*.mjs`）；CI 为 GitHub Actions（`.github/workflows/ci.yml`）。

## Global Constraints

- 全程使用简体中文交流；任务完成后关闭 `http://127.0.0.1:8765/` 服务器。
- 禁止整文件读取 `public/app.js`（~19000 行），只读本计划指定的行段。
- 辅助函数复用现有 `isAvailable`（app.js:1047）、`number`（app.js:1042）与 `money()`/`shortMoney()`/`epc()`/`shortEpc()`，不重复实现格式化。格式化函数 null 行为：`money(null)`→"not available in current data"、`shortMoney(null)`/`shortEpc(null)`→"-"、`epc(null)`→"not available in current data"。
- **不改**：聚合汇总（`totalCommission`=ΣaffCommission，app.js:3184）、排序（按 affCommission）、LLM 字段映射、目标页 All/Aff Comm、支付相关 "Commission made"（`fieldRows`/`merchantOverviewHtml`/`renderPaymentStats`）、`offer.epc` 字段本身、`chatOverviewColumns`、`extractTopMetricRequest`。
- 默认语言：`state.language` 默认 zh（`localStorage.getItem("offerLanguage") === "en" ? "en" : "zh"`，app.js:334）。测试 sandbox 中 localStorage 恒为 null，故默认 zh。
- i18n 键命名（app.js `translations.zh`）：`label.All Commission`→"总佣金"、`label.Aff Commission`→"联盟佣金"、`label.EPC(All)`→"EPC(All)"、`label.EPC(Aff)`→"EPC(Aff)"。英文界面 `labelText(label)` fallback 返回原文。
- 测试命令追加到 `.github/workflows/ci.yml`（第 55 行 `node scripts/test_chatbot_intent_flow.mjs` 之后）与 CLAUDE.md "Run tests (same as CI)" 节。
- `test_chatbot_intent_flow.mjs` 有已知偶发挂起（payment 段，纯 HEAD 也复现，见 memory）。跑它时用 `timeout 60` 包裹；若超时，用截断法验证（`head -c <N> scripts/test_chatbot_intent_flow.mjs > /tmp/t.mjs && node /tmp/t.mjs`）或用 `node --check` + 新测试文件替代。

---

### Task 1: 辅助函数 + hooks + i18n 键 + 新测试文件骨架

**Files:**
- Create: `scripts/test_commission_all_aff.mjs`
- Modify: `public/app.js`（辅助函数、hooks、translations.zh）

**Interfaces:**
- Consumes: `isAvailable`（app.js:1047）、`number`（app.js:1042）
- Produces: 4 个纯函数 `offerAllCommission(offer)` / `offerAffCommission(offer)` / `offerAllEpc(offer)` / `offerAffEpc(offer)`，均返回 `number | null`。后续任务 2/3/4/5 调用它们；hooks 暴露后测试直接访问。

- [ ] **Step 1: 写失败测试文件（含骨架 + 用例 1/2/3/4a/7）**

创建 `scripts/test_commission_all_aff.mjs`，完整内容如下：

```js
import fs from "node:fs";
import vm from "node:vm";

function runScript(file, sandbox) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTruthy(value, label) {
  if (!value) throw new Error(`${label}: expected a truthy value, got ${JSON.stringify(value)}`);
}

function assertMatch(actual, pattern, label) {
  if (!pattern.test(actual)) {
    throw new Error(`${label}: expected ${JSON.stringify(actual)} to match ${pattern}`);
  }
}

const elementStub = {
  addEventListener() {},
  classList: { add() {}, remove() {}, toggle() {} },
  dataset: {},
  appendChild() {},
  querySelectorAll() { return []; },
  querySelector() { return null; },
  setAttribute() {},
  removeAttribute() {},
  style: {}
};

const sandbox = {
  console,
  Date,
  Math,
  Number,
  String,
  RegExp,
  Array,
  Object,
  Set,
  Map,
  JSON,
  window: { __OFFER_INTELLIGENCE_TEST__: true },
  localStorage: {
    getItem() { return null; },
    setItem() {},
    removeItem() {}
  },
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

// 用例 1：真实商户映射（Shokz 362653）
const shokz = (_offersCache.offers || []).find((o) => String(o.merchantId) === "362653");
assertTruthy(shokz, "Shokz 362653 offer should exist in cache");
assertEqual(hooks.offerAllCommission(shokz), 26, "Shokz All Commission should use payout");
assertEqual(hooks.offerAffCommission(shokz), 19.5, "Shokz Aff Commission should use affCommission");

// 用例 2：EPC 计算
const epcFixture = { payout: 100, affCommission: 80, clicks: 200 };
assertEqual(hooks.offerAllEpc(epcFixture), 0.5, "All EPC = payout / clicks");
assertEqual(hooks.offerAffEpc(epcFixture), 0.4, "Aff EPC = affCommission / clicks");

// 用例 3：缺失 / 零点击
assertEqual(hooks.offerAllEpc({ clicks: 0 }), null, "zero clicks should make All EPC null");
assertEqual(hooks.offerAffEpc({ clicks: 0 }), null, "zero clicks should make Aff EPC null");
assertEqual(hooks.offerAllCommission({}), null, "missing payout should make All Commission null");
assertEqual(hooks.offerAffCommission({}), null, "missing affCommission should make Aff Commission null");

// 用例 4a：格式化函数对 null 的行为
assertEqual(hooks.money(null), "not available in current data", "money(null) should show not available");
assertEqual(hooks.shortEpc(null), "-", "shortEpc(null) should show dash");

// 用例 7：i18n 键
assertEqual(hooks.labelText("All Commission"), "总佣金", "zh label All Commission should translate");
assertEqual(hooks.labelText("Aff Commission"), "联盟佣金", "zh label Aff Commission should translate");
assertEqual(hooks.labelText("EPC(All)"), "EPC(All)", "zh label EPC(All) should stay EPC(All)");
assertEqual(hooks.labelText("EPC(Aff)"), "EPC(Aff)", "zh label EPC(Aff) should stay EPC(Aff)");

console.log("PASS: commission All/Aff helpers, formatting, i18n");
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/test_commission_all_aff.mjs`
Expected: FAIL，`hooks.offerAllCommission is not a function`（TypeError，辅助函数与 hooks 均未定义）。

- [ ] **Step 3: 实现辅助函数 + hooks + i18n 键**

**3a. `public/app.js` — 新增 4 个辅助函数**。插在 `epc()` 定义（app.js:1110-1113）之后、`countValue()`（app.js:1115）之前：

```js
  function offerAllCommission(offer) {
    return isAvailable(offer && offer.payout) ? Number(offer.payout) : null;
  }

  function offerAffCommission(offer) {
    return isAvailable(offer && offer.affCommission) ? Number(offer.affCommission) : null;
  }

  function offerAllEpc(offer) {
    const clicks = Number(offer && offer.clicks);
    if (!(clicks > 0)) return null;
    const all = offerAllCommission(offer);
    return all === null ? null : all / clicks;
  }

  function offerAffEpc(offer) {
    const clicks = Number(offer && offer.clicks);
    if (!(clicks > 0)) return null;
    const aff = offerAffCommission(offer);
    return aff === null ? null : aff / clicks;
  }
```

**3b. `public/app.js` — translations.zh 新增 4 个键**。加在 `"label.Commission made": "产生佣金",`（app.js:781）之后：

```js
      "label.All Commission": "总佣金",
      "label.Aff Commission": "联盟佣金",
      "label.EPC(All)": "EPC(All)",
      "label.EPC(Aff)": "EPC(Aff)",
```

**3c. `public/app.js` — hooks 暴露 4 个辅助函数 + `money` + `shortEpc` + `labelText`**。在 hooks 区域末尾 `publisherPortfolioRowsForState: ... }`（app.js:19099-19100）之后、`};`（app.js:19101）之前追加：

```js
      offerAllCommission,
      offerAffCommission,
      offerAllEpc,
      offerAffEpc,
      money,
      shortEpc,
      labelText,
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node scripts/test_commission_all_aff.mjs`
Expected: PASS，输出 `PASS: commission All/Aff helpers, formatting, i18n`。

- [ ] **Step 5: 提交**

```bash
git add public/app.js scripts/test_commission_all_aff.mjs
git commit -m "feat(chatbot): 新增 All/Aff 佣金与 EPC 辅助函数及 i18n 键"
```

---

### Task 2: chatbot 商户统计卡片拆分（renderMerchantStats）

**Files:**
- Modify: `public/app.js:7091-7111`（renderMerchantStats 的 statCards）、hooks
- Test: `scripts/test_commission_all_aff.mjs`

**Interfaces:**
- Consumes: `offerAllCommission`/`offerAffCommission`/`offerAllEpc`/`offerAffEpc`（Task 1）；`money()`/`epc()`（现有）
- Produces: `renderMerchantStats(offer)` 输出双口径佣金与双 EPC 统计卡；hooks 暴露 `renderMerchantStats`

- [ ] **Step 1: 写失败测试（追加用例 4b + 5）**

在 `scripts/test_commission_all_aff.mjs` 的 `// 用例 4a` 块之后追加：

```js
// 用例 5：统计卡片渲染（默认 zh 界面）
const merchantStatsHtml = hooks.renderMerchantStats(shokz);
assertMatch(merchantStatsHtml, /总佣金/, "merchant stats should show All Commission zh label");
assertMatch(merchantStatsHtml, /联盟佣金/, "merchant stats should show Aff Commission zh label");
assertMatch(merchantStatsHtml, /EPC\(All\)/, "merchant stats should show EPC(All) label");
assertMatch(merchantStatsHtml, /EPC\(Aff\)/, "merchant stats should show EPC(Aff) label");
// Shokz clicks=0 → 两种 EPC 均 null → epc(null) 显示 not available
assertMatch(merchantStatsHtml, /not available in current data/, "Shokz zero clicks EPC should render not available");
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/test_commission_all_aff.mjs`
Expected: FAIL，`hooks.renderMerchantStats is not a function`。

- [ ] **Step 3: 实现 renderMerchantStats 拆分**

`public/app.js:7099-7103`（原）：

```js
        ["AOV", money(offer.aov)],
        ["EPC", epc(offer.epc)],
        ["CVR", pct(offer.conversionRate)],
        ["Revenue made", money(offer.salesAmount)],
        ["Commission made", money(offer.affCommission)],
```

改为（替换两行，不保留旧单值）：

```js
        ["AOV", money(offer.aov)],
        ["EPC(All)", epc(offerAllEpc(offer))],
        ["EPC(Aff)", epc(offerAffEpc(offer))],
        ["CVR", pct(offer.conversionRate)],
        ["Revenue made", money(offer.salesAmount)],
        ["All Commission", money(offerAllCommission(offer))],
        ["Aff Commission", money(offerAffCommission(offer))],
```

hooks 追加 `renderMerchantStats,`（Task 1 Step 3c 的同一位置，`labelText,` 之后）：

```js
      renderMerchantStats,
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node scripts/test_commission_all_aff.mjs`
Expected: PASS，输出两行 `PASS:`。

- [ ] **Step 5: 提交**

```bash
git add public/app.js scripts/test_commission_all_aff.mjs
git commit -m "feat(chatbot): 商户统计卡片拆分 All/Aff 佣金与 EPC"
```

---

### Task 3: 上下文/结果表格拆分（contextColumns）

**Files:**
- Modify: `public/app.js:7029-7041`（contextColumns 数组）
- Test: `scripts/test_commission_all_aff.mjs`、`scripts/test_chatbot_intent_flow.mjs:137-141`

**Interfaces:**
- Consumes: 4 个辅助函数（Task 1）；`shortMoney()`/`shortEpc()`（现有）
- Produces: `contextColumns` 由 11 列变 13 列；`contextColumnLabels()` 返回新列标签集合

- [ ] **Step 1: 更新既有断言 + 写失败测试**

**1a.** `scripts/test_chatbot_intent_flow.mjs:137-141` 更新为（列拆分后 13 列，标签为英文原文）：

```js
assertEqual(
  hooks.contextColumnLabels().join("|"),
  "Merchant|Tier|Highlight|Category|AOV|EPC(All)|EPC(Aff)|CVR|Orders|Revenue|All Commission|Aff Commission|Payment cycle",
  "right-side overview should split EPC and Commission into All/Aff columns"
);
```

**1b.** `scripts/test_commission_all_aff.mjs` 末尾（`// 用例 7` 块之后）追加：

```js
// 用例 8：contextColumns 拆分
const contextCols = hooks.contextColumnLabels().join("|");
assertMatch(contextCols, /EPC\(All\)\|EPC\(Aff\)/, "context columns should split EPC into All/Aff");
assertMatch(contextCols, /All Commission\|Aff Commission/, "context columns should split Commission into All/Aff");
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/test_commission_all_aff.mjs`
Expected: FAIL，用例 8 断言不匹配（`contextColumns` 尚未拆分）。
Run: `node scripts/test_chatbot_intent_flow.mjs`
Expected: FAIL，137-141 断言失败（实际仍是旧 11 列）。

- [ ] **Step 3: 实现 contextColumns 拆分**

`public/app.js:7035`（原）：

```js
    { label: "EPC", render: (o) => shortEpc(o.epc) },
```

改为：

```js
    { label: "EPC(All)", render: (o) => shortEpc(offerAllEpc(o)) },
    { label: "EPC(Aff)", render: (o) => shortEpc(offerAffEpc(o)) },
```

`public/app.js:7039`（原）：

```js
    { label: "Commission made", render: (o) => shortMoney(o.affCommission) },
```

改为：

```js
    { label: "All Commission", render: (o) => shortMoney(offerAllCommission(o)) },
    { label: "Aff Commission", render: (o) => shortMoney(offerAffCommission(o)) },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node scripts/test_commission_all_aff.mjs` → Expected: PASS
Run: `node scripts/test_chatbot_intent_flow.mjs` → Expected: PASS（若偶发挂起，用截断法验证，见 Global Constraints；`contextColumnLabels` 断言必过）

- [ ] **Step 5: 提交**

```bash
git add public/app.js scripts/test_chatbot_intent_flow.mjs scripts/test_commission_all_aff.mjs
git commit -m "feat(chatbot): 上下文/结果表格拆分 All/Aff 佣金与 EPC 列"
```

---

### Task 4: 品类/Tier/对比分析 Top Brands 硬编码表格拆分

**Files:**
- Modify: `public/app.js:4934-4943`（briefOffer）、`public/app.js:5085-5094`（对比分析 topBrands 构造）、`public/app.js:5158-5166`（Tier topBrands 构造）、`public/app.js:5937-5940`（品类 Top 5 表头与单元格）、`public/app.js:6072-6075`（对比 Top Brands 表头与单元格）、`public/app.js:6174-6177`（Tier Top Brands 表头与单元格）

**Interfaces:**
- Consumes: 4 个辅助函数（Task 1）
- Produces: 三处表格各输出 EPC(All)/EPC(Aff) 与 All/Aff 佣金 4 列（替代原 EPC/佣金 2 列）

> 注：设计文档第 3 节以为 6075/6177 的数据源是 `briefOffer`，实现核对后发现对比/Tier 分析的 topBrands 实际在 5085/5158 行单独构造（结构含 `orders` 字段，`briefOffer` 含 `conversionRate` 字段）。三处数据源都要加字段，渲染才可用新列。目标与设计一致，仅数据源位置不同。

- [ ] **Step 1: 实现 briefOffer 与两处 topBrands 构造加字段**

**1a.** `public/app.js:4938-4942`（briefOffer 返回对象，原）：

```js
        epc: o.epc || 0,
        aov: o.aov || 0,
        conversionRate: (o.conversionRate || 0) * 100,
        affCommission: o.affCommission || 0
```

改为：

```js
        epc: o.epc || 0,
        aov: o.aov || 0,
        conversionRate: (o.conversionRate || 0) * 100,
        affCommission: o.affCommission || 0,
        allCommission: o.payout || 0,
        allEpc: offerAllEpc(o),
        affEpc: offerAffEpc(o)
```

**1b.** `public/app.js:5088-5092`（对比分析 topBrands 构造，原）：

```js
          epc: o.epc || 0,
          aov: o.aov || 0,
          orders: o.orders || 0,
          affCommission: o.affCommission || 0
```

改为：

```js
          epc: o.epc || 0,
          aov: o.aov || 0,
          orders: o.orders || 0,
          affCommission: o.affCommission || 0,
          allCommission: o.payout || 0,
          allEpc: offerAllEpc(o),
          affEpc: offerAffEpc(o)
```

**1c.** `public/app.js:5161-5164`（Tier topBrands 构造，原）：

```js
          epc: o.epc || 0,
          aov: o.aov || 0,
          orders: o.orders || 0,
          affCommission: o.affCommission || 0
```

改为：

```js
          epc: o.epc || 0,
          aov: o.aov || 0,
          orders: o.orders || 0,
          affCommission: o.affCommission || 0,
          allCommission: o.payout || 0,
          allEpc: offerAllEpc(o),
          affEpc: offerAffEpc(o)
```

- [ ] **Step 2: 实现三处表格表头与单元格拆分**

**2a.** `public/app.js:5937`（品类 Top 5 表头，原）：

```js
      html += "<table class=\"analysis-table\"><thead><tr><th>#</th><th>" + (zh ? "商户" : "Merchant") + "</th><th>Tier</th><th>EPC</th><th>CVR</th><th>" + (zh ? "佣金" : "Commission") + "</th></tr></thead><tbody>";
```

改为：

```js
      html += "<table class=\"analysis-table\"><thead><tr><th>#</th><th>" + (zh ? "商户" : "Merchant") + "</th><th>Tier</th><th>EPC(All)</th><th>EPC(Aff)</th><th>CVR</th><th>" + (zh ? "总佣金" : "All Commission") + "</th><th>" + (zh ? "联盟佣金" : "Aff Commission") + "</th></tr></thead><tbody>";
```

**2b.** `public/app.js:5940`（品类 Top 5 单元格，原）：

```js
        html += "<tr><td>" + (i + 1) + "</td><td>" + escapeHtml(m.name) + "</td><td>" + escapeHtml(m.tier) + "</td><td>" + epc(m.epc) + "</td><td>" + pct(m.conversionRate / 100) + "</td><td>" + money(m.affCommission) + "</td></tr>";
```

改为：

```js
        html += "<tr><td>" + (i + 1) + "</td><td>" + escapeHtml(m.name) + "</td><td>" + escapeHtml(m.tier) + "</td><td>" + epc(m.allEpc) + "</td><td>" + epc(m.affEpc) + "</td><td>" + pct(m.conversionRate / 100) + "</td><td>" + money(m.allCommission) + "</td><td>" + money(m.affCommission) + "</td></tr>";
```

**2c.** `public/app.js:6072`（对比 Top Brands 表头，原）：

```js
        html += "<table class=\"analysis-table\"><thead><tr><th>#</th><th>" + (zh ? "品牌" : "Brand") + "</th><th>" + (zh ? "Tier" : "Tier") + "</th><th>EPC</th><th>AOV</th><th>" + (zh ? "订单" : "Orders") + "</th><th>" + (zh ? "佣金" : "Commission") + "</th></tr></thead><tbody>";
```

改为：

```js
        html += "<table class=\"analysis-table\"><thead><tr><th>#</th><th>" + (zh ? "品牌" : "Brand") + "</th><th>" + (zh ? "Tier" : "Tier") + "</th><th>EPC(All)</th><th>EPC(Aff)</th><th>AOV</th><th>" + (zh ? "订单" : "Orders") + "</th><th>" + (zh ? "总佣金" : "All Commission") + "</th><th>" + (zh ? "联盟佣金" : "Aff Commission") + "</th></tr></thead><tbody>";
```

**2d.** `public/app.js:6075`（对比 Top Brands 单元格，原）：

```js
          html += "<tr><td>" + (b + 1) + "</td><td>" + escapeHtml(brand.name) + "</td><td>" + escapeHtml(brand.tier) + "</td><td>" + epc(brand.epc) + "</td><td>" + money(brand.aov) + "</td><td>" + number(brand.orders).toLocaleString() + "</td><td>" + money(brand.affCommission) + "</td></tr>";
```

改为：

```js
          html += "<tr><td>" + (b + 1) + "</td><td>" + escapeHtml(brand.name) + "</td><td>" + escapeHtml(brand.tier) + "</td><td>" + epc(brand.allEpc) + "</td><td>" + epc(brand.affEpc) + "</td><td>" + money(brand.aov) + "</td><td>" + number(brand.orders).toLocaleString() + "</td><td>" + money(brand.allCommission) + "</td><td>" + money(brand.affCommission) + "</td></tr>";
```

**2e.** `public/app.js:6174`（Tier Top Brands 表头，原）：

```js
        html += "<table class=\"analysis-table\"><thead><tr><th>#</th><th>" + (zh ? "品牌" : "Brand") + "</th><th>EPC</th><th>AOV</th><th>" + (zh ? "订单" : "Orders") + "</th><th>" + (zh ? "佣金" : "Commission") + "</th></tr></thead><tbody>";
```

改为：

```js
        html += "<table class=\"analysis-table\"><thead><tr><th>#</th><th>" + (zh ? "品牌" : "Brand") + "</th><th>EPC(All)</th><th>EPC(Aff)</th><th>AOV</th><th>" + (zh ? "订单" : "Orders") + "</th><th>" + (zh ? "总佣金" : "All Commission") + "</th><th>" + (zh ? "联盟佣金" : "Aff Commission") + "</th></tr></thead><tbody>";
```

**2f.** `public/app.js:6177`（Tier Top Brands 单元格，原）：

```js
          html += "<tr><td>" + (b + 1) + "</td><td>" + escapeHtml(brand.name) + "</td><td>" + epc(brand.epc) + "</td><td>" + money(brand.aov) + "</td><td>" + number(brand.orders).toLocaleString() + "</td><td>" + money(brand.affCommission) + "</td></tr>";
```

改为：

```js
          html += "<tr><td>" + (b + 1) + "</td><td>" + escapeHtml(brand.name) + "</td><td>" + epc(brand.allEpc) + "</td><td>" + epc(brand.affEpc) + "</td><td>" + money(brand.aov) + "</td><td>" + number(brand.orders).toLocaleString() + "</td><td>" + money(brand.allCommission) + "</td><td>" + money(brand.affCommission) + "</td></tr>";
```

> 注：这三处表格渲染函数（`renderCategoryAnalysisTable`/`renderCompareAnalysisTable`/`renderMultiTierAnalysisTable`）未暴露到 hooks，设计文档测试方案也未覆盖，故本任务不新增单元断言，以 `node --check` + 既有测试回归保证不破坏。可选手动启动 server 验证（用毕关闭）。

- [ ] **Step 3: 语法检查**

Run: `node --check public/app.js`
Expected: 无输出（exit 0）。

- [ ] **Step 4: 回归测试**

Run: `node scripts/test_commission_all_aff.mjs` → Expected: PASS
Run: `node scripts/test_category_drilldown.mjs` → Expected: PASS
Run: `node scripts/test_sheet_categories.mjs` → Expected: PASS
Run: `node scripts/test_tier2_recommendation_rules.mjs` → Expected: PASS
Run: `timeout 60 node scripts/test_chatbot_intent_flow.mjs` → Expected: PASS（若超时，用截断法验证 Task 3 已覆盖的 `contextColumnLabels` 断言）

- [ ] **Step 5: 提交**

```bash
git add public/app.js
git commit -m "feat(chatbot): Top Brands 表格拆分 All/Aff 佣金与 EPC 列"
```

---

### Task 5: Excel 导出列拆分（recommendationExportColumns）

**Files:**
- Modify: `public/app.js:11253`、`public/app.js:11261`（recommendationExportColumns）、hooks
- Test: `scripts/test_commission_all_aff.mjs`

**Interfaces:**
- Consumes: 4 个辅助函数（Task 1）；`number()`（现有）
- Produces: `recommendationExportColumns()` 表头含 "All Commission"/"Aff Commission"/"EPC(All)"/"EPC(Aff)"；hooks 暴露 `recommendationExportColumns`

> 注：设计文档第 4 节标题写作 `objectExportColumns`，实际该处是 `recommendationExportColumns`（app.js:11241-11275，推荐导出列，被 `worksheetXml` 等消费）。`objectExportColumns`（app.js:11299）是通用动态表头生成器，无需改。

- [ ] **Step 1: 写失败测试（追加用例 6）**

在 `scripts/test_commission_all_aff.mjs` 的 `// 用例 8` 块之后追加：

```js
// 用例 6：导出列拆分
const exportHeaders = hooks.recommendationExportColumns().map(([header]) => header);
assertMatch(exportHeaders.join("|"), /All Commission\|Aff Commission/, "export columns should include All and Aff Commission");
assertMatch(exportHeaders.join("|"), /EPC\(All\)\|EPC\(Aff\)/, "export columns should include EPC(All) and EPC(Aff)");
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/test_commission_all_aff.mjs`
Expected: FAIL，`hooks.recommendationExportColumns is not a function`。

- [ ] **Step 3: 实现导出列拆分 + hooks 暴露**

**3a.** `public/app.js:11253`（原）：

```js
      ["EPC", (offer) => number(offer.epc)],
```

改为：

```js
      ["EPC(All)", (offer) => number(offerAllEpc(offer))],
      ["EPC(Aff)", (offer) => number(offerAffEpc(offer))],
```

**3b.** `public/app.js:11261`（原）：

```js
      ["Commission", (offer) => number(offer.affCommission)],
```

改为：

```js
      ["All Commission", (offer) => number(offerAllCommission(offer))],
      ["Aff Commission", (offer) => number(offerAffCommission(offer))],
```

**3c.** hooks 追加（`renderMerchantStats,` 之后）：

```js
      recommendationExportColumns,
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node scripts/test_commission_all_aff.mjs`
Expected: PASS，全部用例通过。

- [ ] **Step 5: 提交**

```bash
git add public/app.js scripts/test_commission_all_aff.mjs
git commit -m "feat(chatbot): Excel 导出列拆分 All/Aff 佣金与 EPC"
```

---

### Task 6: CI/文档接入 + 全量验证

**Files:**
- Modify: `.github/workflows/ci.yml`、`CLAUDE.md`、`docs/2026-08-03-commission-all-aff-design.md`

- [ ] **Step 1: ci.yml 追加新测试命令**

`.github/workflows/ci.yml` 第 55 行 `node scripts/test_chatbot_intent_flow.mjs` 之后追加：

```yaml
          node scripts/test_commission_all_aff.mjs
```

- [ ] **Step 2: CLAUDE.md 追加新测试命令**

CLAUDE.md "Run tests (same as CI)" 节，`node scripts/test_chatbot_intent_flow.mjs` 之后追加一行：

```bash
node scripts/test_commission_all_aff.mjs
```

- [ ] **Step 3: 设计文档状态更新**

`docs/2026-08-03-commission-all-aff-design.md` 第 4 行 `状态：已评审通过，待实现` 改为 `状态：已实现`，并在第 4 节标题 `### 4. Excel 导出列（objectExportColumns，约 11253-11261 行）` 下追加注记：`注：实际位置为 recommendationExportColumns（app.js:11241-11275）；objectExportColumns（app.js:11299）是通用动态表头生成器，无需改。`

- [ ] **Step 4: 全量验证**

Run（分步，每步确认 exit 0）：

```bash
node --check public/app.js
node --check public/auth.js
node scripts/test_commission_all_aff.mjs
node scripts/test_chatbot_intent_flow.mjs
node scripts/test_category_drilldown.mjs
node scripts/test_sheet_categories.mjs
node scripts/test_tier2_recommendation_rules.mjs
node scripts/test_zh_chatbot.mjs
```

Expected: 全部 PASS（`test_chatbot_intent_flow.mjs` 若偶发挂起按 Global Constraints 的截断法处理）。

**可选手动 UI 验证（用毕必须关闭服务器）**：

```bash
python server.py
# 打开 http://127.0.0.1:8765/，聊天输入 "Shokz"，确认统计卡显示 总佣金/联盟佣金 + EPC(All)/EPC(Aff)
# 完成后关闭服务器（见 CLAUDE.md 关闭方法）
```

- [ ] **Step 5: 提交**

```bash
git add .github/workflows/ci.yml CLAUDE.md docs/2026-08-03-commission-all-aff-design.md
git commit -m "chore: CI/文档接入 All/Aff 佣金与 EPC 拆分测试"
```

---

## Self-Review

**1. Spec coverage（对照设计文档）：**
- 核心辅助函数 → Task 1 ✓
- 展示位置 1 renderMerchantStats → Task 2 ✓
- 展示位置 2 contextColumns → Task 3 ✓
- 展示位置 3 Top Brands 硬编码表格（briefOffer + 实际数据源 5085/5158）→ Task 4 ✓
- 展示位置 4 导出列 → Task 5 ✓
- i18n 4 键 → Task 1 ✓
- 测试 7 项用例 → Task 1（1/2/3/4a/7）+ Task 2（5）+ Task 5（6）✓（用例 4 的格式化拆为 4a 在本任务、4b 并入用例 5）
- 不改位置清单 → Global Constraints 逐条落实 ✓

**2. Placeholder scan：** 无 TBD/TODO；所有代码块为完整可粘贴内容；测试文件给出完整骨架，无"类似 Task N"引用。✓

**3. Type consistency：**
- 辅助函数签名 `(offer) => number|null` 全计划一致；Task 2/3/4/5 的调用方式（`offerAllEpc(o)` / `offerAllEpc(offer)` / `offerAllEpc(o)`）均为单参数 ✓
- hooks 暴露顺序：Task 1 加 4 辅助 + money/shortEpc/labelText → Task 2 加 renderMerchantStats → Task 5 加 recommendationExportColumns，均在 19099-19101 之间追加 ✓
- 测试文件 hooks 访问名与暴露名逐一对应（offerAllCommission/offerAffCommission/offerAllEpc/offerAffEpc/money/shortEpc/labelText/renderMerchantStats/recommendationExportColumns/contextColumnLabels）✓
- `allEpc`/`affEpc`/`allCommission` 字段在 briefOffer 与两处 topBrands 构造均一致命名，三处渲染引用一致 ✓

**4. 边界修正记录：** 设计文档第 4 节将导出列位置写作 `objectExportColumns`，实为 `recommendationExportColumns`；第 3 节以为 6075/6177 数据源是 `briefOffer`，实为 5085/5158 独立构造。两者均在 Task 4/5 的注记中说明并在 Task 6 更新设计文档，不改变设计意图。
