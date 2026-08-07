# Chat Memory Recommendation Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Chat Mode 基于记忆栏中的任意单个 Tier 报告生成推荐结果，并在转为 View 后下载只包含本次推荐商户、同时保留原报告结构的 Excel。

**Architecture:** 在 Report Mode 面板加入记忆栏时，从现有 `state.recommendationDownloads` 保存完整的原始导出快照，包括所有工作表、列定义和原始行。Chat Mode 对推荐请求使用该快照作为唯一候选池，按唯一 Merchant ID 生成独立推荐结果快照；View 只消费这份快照并注册一个按 Merchant ID 过滤后的多工作表下载项。现有 `/api/chat/stream` 继续负责自然语言回复，不新增后端接口。

**Tech Stack:** Vanilla JavaScript IIFE、浏览器端状态、现有 `classifyWithLLM()`/指标筛选/推荐排序逻辑、现有前端 XLSX ZIP 生成器、Node `vm` 测试脚本。

## Global Constraints

- 候选范围严格限定为加入记忆栏时的单个 Tier 报告快照，覆盖 Tier 1、Tier 2、Tier 3、Tier 4 和 BLACK TIER，不从全量商户补充。
- 不跨 Tier 或跨报告合并候选池；明确提到某个 Tier 时只使用该 Tier 的记忆报告。
- 按 Merchant ID 计数；同一商户的全部相关原始行都保留。
- View 和 Excel 必须消费同一个推荐结果快照，点击下载时不得重新计算。
- 原 Excel 的标签页、字段、列顺序和加入记忆栏时的列显示状态保持不变。
- Chat 回复下方不直接显示 Excel 下载按钮；下载按钮只出现在转为 View 后的浮层中。
- 匹配少于请求数量时导出实际数量；无匹配或无法得到结构化商户列表时不显示下载按钮。
- 标准模糊时使用现有指标做最佳判断，并在回复或 View 中说明实际采用的标准。
- 不修改 Report Mode 现有报告生成和原始导出行为。
- Chatbot 工作前必须参考 `docs/chatbot-feature-report.md`；`public/app.js` 只读取相关函数范围，不读取整个文件。
- 不修改后端 API，除非实现验证证明前端现有数据无法完成快照和推荐结果闭环。
- 不执行 Git 提交；只有用户明确授权提交时，才按仓库要求使用英中双语提交信息。

---

## 文件结构与职责

| 文件 | 变更职责 |
| --- | --- |
| `public/app.js` | 保存报告导出快照、从记忆报告解析推荐候选、按 Merchant ID 过滤工作表、把推荐快照传入 Chat View、注册 View 专属下载项、暴露测试钩子。 |
| `public/chatbot_i18n.js` | 新增 View 下载卡片、数量不足、无匹配、无法导出等中英文文案。 |
| `scripts/test_chatbot_intent_flow.mjs` | 使用现有 VM 测试夹具覆盖快照隔离、记忆范围、Merchant ID 去重、工作表过滤和推荐结果独立性。 |
| `docs/chatbot-feature-report.md` | 更新 Chat Mode 记忆报告、推荐快照和 View 导出的架构说明及函数索引。 |
| `docs/superpowers/specs/2026-08-07-chat-memory-recommendation-export-design.md` | 已确认的设计规格；实施时只在发现实现与规格不一致时回写，不重新定义需求。 |

不创建新的运行时模块，不修改 `api/chat/stream.py`、`server.py` 或数据库数据文件。

## 推荐结果接口

实现中统一使用以下对象，避免 View 和下载逻辑各自重新推导结果：

```js
{
  status: "ready" | "empty" | "ambiguous" | "unavailable",
  sourceMemoryId: "mem-...",
  sourceSnapshot: reportSnapshot,
  criteriaSummary: "EPC highest, selected Tier memory only",
  requestedCount: 10,
  matchedCount: 10,
  selectedMerchantIds: ["1001", "1002"],
  selectedOffers: [/* 每个商户一个用于排序的代表 offer */],
  selectedRows: [/* 主工作表中这些商户的全部原始行 */],
  filteredSheets: [/* 可直接传给 createRecommendationWorkbook() */],
  isPartial: false,
  gap: 0
}
```

`status !== "ready"` 时，View 不注册下载按钮。`isPartial` 只表示实际数量少于请求数量，不表示错误。

---

### Task 1: 先补充纯函数测试夹具和结果契约

**Files:**
- Modify: `scripts/test_chatbot_intent_flow.mjs`（在现有推荐包和下载测试附近追加）
- Modify: `public/app.js:20457-20510`（为新纯函数增加测试钩子，先让测试可以调用目标接口）

**Interfaces:**
- Produces: `buildReportExportSnapshot(downloadItem, metadata)`、`buildMemoryRecommendationResult(prompt, memories, options)`、`filterReportWorkbookSnapshot(snapshot, merchantIds)` 三个可测试接口。
- Consumes: 现有 `requestedRecommendationCount()`、`extractMetricFilters()`、`extractMetricSortIntent()`、`rankedRecommendations()` 和 XLSX sheet descriptors。

- [ ] **Step 1: 添加最小测试断言和固定夹具**

在 `scripts/test_chatbot_intent_flow.mjs` 中添加 `assertDeepEqual`，并创建包含重复 Merchant ID 和三张工作表的确定性 Tier 2 夹具；Tier 1 的专用字段和标签页在 Task 4 增加独立夹具：

```js
function assertDeepEqual(actual, expected, label) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label}: expected ${expectedJson}, got ${actualJson}`);
  }
}

const memoryDownloadFixture = {
  rows: [
    { merchantId: "1001", brand: "Alpha", tier: "Tier 2", epc: 1.8, orders: 80 },
    { merchantId: "1001", brand: "Alpha", tier: "Tier 2", epc: 1.8, orders: 80, asin: "A-2" },
    { merchantId: "1002", brand: "Beta", tier: "Tier 2", epc: 1.4, orders: 60 },
    { merchantId: "1003", brand: "Gamma", tier: "Tier 3", epc: 2.4, orders: 90 }
  ],
  context: {
    tier: "Tier 2",
    sheets: [
      { sheetName: "Tier 2", rows: [
        { "Merchant ID": "1001", "Merchant Name": "Alpha", Tier: "Tier 2" },
        { "Merchant ID": "1001", "Merchant Name": "Alpha", Tier: "Tier 2", ASIN: "A-2" },
        { "Merchant ID": "1002", "Merchant Name": "Beta", Tier: "Tier 2" }
      ], columns: [["Merchant ID", row => row["Merchant ID"]], ["Merchant Name", row => row["Merchant Name"]]] },
      { sheetName: "Category Summary", rows: [{ Category: "Audio", "Merchant Count": 2 }], columns: [["Category", row => row.Category]] },
      { sheetName: "Offer List", rows: [
        { "Merchant ID": "1001", "Merchant Name": "Alpha" },
        { "Merchant ID": "1001", "Merchant Name": "Alpha", ASIN: "A-2" },
        { "Merchant ID": "1002", "Merchant Name": "Beta" }
      ], columns: [["Merchant ID", row => row["Merchant ID"]], ["Merchant Name", row => row["Merchant Name"]]] }
    ]
  }
};
```

- [ ] **Step 2: 写入预期行为测试，使其先失败**

```js
const memorySnapshot = hooks.buildReportExportSnapshot(memoryDownloadFixture, {
  id: "mem-tier2",
  title: "Tier 2 Report",
  tier: "Tier 2"
});
const recommendation = hooks.buildMemoryRecommendationResult(
  "recommend 2 Tier 2 offers with highest EPC",
  [{ id: "mem-tier2", title: "Tier 2 Report", reportSnapshot: memorySnapshot }]
);
assertEqual(recommendation.status, "ready", "memory recommendation should be exportable");
assertDeepEqual(recommendation.selectedMerchantIds, ["1001", "1002"], "recommendation should rank unique merchants");
assertEqual(recommendation.selectedRows.length, 3, "all rows for selected merchants should be retained");
assertEqual(recommendation.filteredSheets.length, 3, "filtered workbook should retain all source sheets");
```

Run: `node scripts/test_chatbot_intent_flow.mjs`

Expected: FAIL because the three new test hooks/functions do not exist yet.

- [ ] **Step 3: 暴露纯函数测试钩子，不暴露 DOM 或异步流状态**

在 `window.OFFER_INTELLIGENCE_TEST_HOOKS` 中增加：

```js
buildReportExportSnapshot,
buildMemoryRecommendationResult,
filterReportWorkbookSnapshot,
```

保持现有测试钩子名称不变，避免影响其他测试。

- [ ] **Step 4: 运行测试确认仍只失败于新功能**

Run: `node scripts/test_chatbot_intent_flow.mjs`

Expected: 现有断言继续通过；新增断言报告缺少目标函数或返回值不完整。

---

### Task 2: 在加入记忆栏时保存原始 Excel 快照

**Files:**
- Modify: `public/app.js:12372-12400`（下载项的行和工作表快照）
- Modify: `public/app.js:10842-10910`（`_extractPanelMemory()` 和 `_addMemoryFromPanel()`）
- Test: `scripts/test_chatbot_intent_flow.mjs`

**Interfaces:**
- Consumes: `state.recommendationDownloads[downloadId]` 的 `rows`、`context.columns`、`context.sheets`、`sheetName` 和 `filename`。
- Produces: `memory.reportSnapshot`，其中包含独立复制的 `rows`、`sheets`、`tier`、`title` 和用于推荐排序的唯一商户代表行。

- [ ] **Step 1: 添加快照隔离测试**

在测试中验证快照不引用原始行数组：

```js
const isolatedSnapshot = hooks.buildReportExportSnapshot(memoryDownloadFixture, {
  id: "mem-isolated",
  title: "Tier 2 Report",
  tier: "Tier 2"
});
memoryDownloadFixture.rows[0].brand = "Mutated after memory";
memoryDownloadFixture.context.sheets[0].rows[0]["Merchant Name"] = "Mutated sheet row";
assertEqual(isolatedSnapshot.rows[0].brand, "Alpha", "memory rows must be immutable after capture");
assertEqual(isolatedSnapshot.sheets[0].rows[0]["Merchant Name"], "Alpha", "memory sheet rows must be immutable after capture");
```

Run: `node scripts/test_chatbot_intent_flow.mjs`

Expected: FAIL until the snapshot function deep-copies row objects and each sheet descriptor.

- [ ] **Step 2: 实现工作簿快照复制**

在 `public/app.js` 的下载注册附近新增 `cloneExportRows()`、`cloneExportSheets()` 和 `buildReportExportSnapshot()`。实现要点：

```js
function cloneExportRows(rows) {
  return (rows || []).map((row) => (
    row && typeof row === "object" && !Array.isArray(row) ? { ...row } : row
  ));
}

function cloneExportSheets(sheets) {
  return (sheets || []).map((sheet) => ({
    ...sheet,
    rows: cloneExportRows(sheet.rows || []),
    columns: Array.isArray(sheet.columns) ? sheet.columns.slice() : sheet.columns
  }));
}
```

`buildReportExportSnapshot()` 必须：

- 从 `downloadItem.rows` 复制主数据行。
- 从 `downloadItem.context.sheets` 复制所有工作表；没有 `sheets` 时用 `rows`、`columns` 和 `sheetName` 创建单一工作表回退结构。
- 保留加入记忆栏时的列 getter，不在后续下载时重新调用当前 Report Mode 的列选择状态。
- 从每个有 Merchant ID 的源行生成唯一商户 ID 集合。
- 为每个唯一商户保存一条用于推荐排序的代表 offer；优先使用下载行中的 normalized offer，无法使用时按 Merchant ID 从当前 offer 索引生成当时的浅拷贝。
- 记录 `sourceDownloadId`、`sourceFilename`、`tier`、`title` 和 `panelId`。

- [ ] **Step 3: 让下载注册项保存完整工作表快照**

扩展 `registerRecommendationDownload()` 的保存对象，使 `state.recommendationDownloads[id]` 内部的 `context.sheets` 使用 `cloneExportSheets()` 的结果，而不是引用原始数组。现有单表下载仍然只生成一个工作表，现有 Report Mode 下载文件名和字段不变。

- [ ] **Step 4: 将快照写入记忆项**

在 `_extractPanelMemory(panel)` 找到 `downloadId` 后，读取完整下载项并写入：

```js
memory.reportSnapshot = buildReportExportSnapshot(downloadItem, {
  id: memory.id,
  title,
  tier: downloadItem.context && downloadItem.context.tier,
  panelId: panel.id
});
```

保留现有 `textContent`、`html` 和 `extraText` 生成逻辑，让 `/api/chat/stream` 继续收到文本上下文；结构化快照只供前端推荐导出使用。

- [ ] **Step 5: 运行快照测试**

Run: `node scripts/test_chatbot_intent_flow.mjs`

Expected: 快照隔离、单工作表回退和多工作表保留测试 PASS；推荐结果测试仍可能因 Task 3 尚未实现而失败。

---

### Task 3: 实现限定记忆报告的自然语言推荐解析

**Files:**
- Modify: `public/app.js:4363-4495`（沿用现有指标解析，不改变既有函数）
- Modify: `public/app.js:4713-4750`（Tier 解析复用）
- Modify: `public/app.js:7381-7445`、`8773-8815`（排序、数量和身份规则附近新增辅助函数）
- Modify: `scripts/test_chatbot_intent_flow.mjs`

**Interfaces:**
- Consumes: `reportSnapshot.rankingOffers`、`prompt`、可选 `options.llmParams`。
- Produces: `buildMemoryRecommendationResult(prompt, memories, options = {})`，返回本计划“推荐结果接口”定义的对象。

- [ ] **Step 1: 添加候选范围、去重和缺口测试**

追加以下断言：

```js
const tier3Memory = hooks.buildReportExportSnapshot({
  rows: [{ merchantId: "9001", brand: "Outside", tier: "Tier 3", epc: 9 }],
  context: { tier: "Tier 3", sheets: [{ sheetName: "Tier 3", rows: [], columns: [] }] }
}, { id: "mem-tier3", title: "Tier 3 Report", tier: "Tier 3" });

const tier2Only = hooks.buildMemoryRecommendationResult(
  "recommend 10 Tier 2 offers",
  [
    { id: "mem-tier2", title: "Tier 2 Report", reportSnapshot: memorySnapshot },
    { id: "mem-tier3", title: "Tier 3 Report", reportSnapshot: tier3Memory }
  ]
);
assertEqual(tier2Only.selectedMerchantIds.includes("9001"), false, "recommendation must not borrow merchants from another tier memory");
assertEqual(tier2Only.isPartial, true, "fewer matches should be marked partial");

const tier1Memory = hooks.buildReportExportSnapshot({
  rows: [{ merchantId: "1101", brand: "Tier One", tier: "Tier 1", epc: 2.2, orders: 100 }],
  context: {
    tier: "Tier 1",
    sheets: [{ sheetName: "Tier 1", rows: [{ "Merchant ID": "1101", "Merchant Name": "Tier One" }], columns: [] }]
  }
}, { id: "mem-tier1", title: "Tier 1 Report", tier: "Tier 1" });
const tier1Result = hooks.buildMemoryRecommendationResult(
  "recommend 1 Tier 1 offer",
  [{ id: "mem-tier1", title: "Tier 1 Report", reportSnapshot: tier1Memory }]
);
assertEqual(tier1Result.sourceSnapshot.tier, "Tier 1", "the same resolver should support Tier 1");

const emptyResult = hooks.buildMemoryRecommendationResult(
  "recommend 10 Tier 2 offers with orders above 999999",
  [{ id: "mem-tier2", title: "Tier 2 Report", reportSnapshot: memorySnapshot }]
);
assertEqual(emptyResult.status, "empty", "no matching merchants should be non-exportable");
```

Run: `node scripts/test_chatbot_intent_flow.mjs`

Expected: FAIL until candidate selection, Merchant ID grouping and partial/empty statuses are implemented.

- [ ] **Step 2: 实现记忆报告选择和身份归一化**

新增内部辅助函数：

```js
function normalizedMemoryMerchantId(row) {
  return String(row && (row.merchantId || row["Merchant ID"] || row.MerchantID || row.ID) || "")
    .trim()
    .replace(/\.0$/, "");
}

function selectMemoryReportForPrompt(prompt, memories) {
  const available = (memories || []).filter((memory) => memory && memory.reportSnapshot);
  const promptedTier = tierFromPrompt(prompt);
  const matches = promptedTier
    ? available.filter((memory) => canonicalTierName(memory.reportSnapshot.tier) === canonicalTierName(promptedTier))
    : available;
  return matches.length === 1 ? matches[0] : null;
}
```

规则：明确提到某个 Tier 时只匹配该 Tier；没有明确 Tier 且只有一份记忆报告时使用该报告；有多份无法唯一确定时返回 `ambiguous`，不生成下载按钮。不得使用全局 `offers` 作为候选补集。

- [ ] **Step 3: 实现指标筛选、排序和唯一商户选取**

`buildMemoryRecommendationResult()` 按以下顺序执行：

1. 调用 `selectMemoryReportForPrompt()`；无法唯一确定时返回 `status: "ambiguous"`。
2. 使用 `options.llmParams` 中的 `metricFilters`、`metricSort`，缺失部分回退到 `extractMetricFilters(prompt)` 和 `extractMetricSortIntent(prompt)`。
3. 从 `rankingOffers` 按 Merchant ID 去重，每个 Merchant ID 只保留一个代表 offer。
4. 将 Tier、类别和指标条件应用到代表 offer；不得把不在快照中的全局 offer 加回候选池。
5. 使用现有 `rankedRecommendations()`/`compareRecommendationOffers()` 排序；没有显式指标排序时沿用当前默认推荐排序。
6. 取 `requestedRecommendationCount(prompt, 5)` 个唯一商户。
7. 用 `filterReportWorkbookSnapshot()` 把选中 Merchant ID 映射回原始工作表全部相关行。
8. 返回 `criteriaSummary`、`selectedMerchantIds`、`selectedOffers`、`selectedRows`、`filteredSheets`、`matchedCount`、`isPartial` 和 `gap`。

数量规则：`requestedCount` 为 10 且只找到 3 个时返回 3 个和 `isPartial: true`；0 个时返回 `status: "empty"`；`selectedMerchantIds` 为空时绝不创建下载项。

- [ ] **Step 4: 运行推荐解析测试**

Run: `node scripts/test_chatbot_intent_flow.mjs`

Expected: 记忆范围、跨 Tier 隔离、唯一 Merchant ID、重复行保留、数量不足和空结果测试 PASS。

---

### Task 4: 实现原工作簿的 Merchant ID 过滤与汇总重建

**Files:**
- Modify: `public/app.js:12491-12515`、`17001-17045`（沿用 Tier 工作表列定义和 Category Summary 计算）
- Modify: `public/app.js:12739-12870`（多工作表下载上下文）
- Modify: `scripts/test_chatbot_intent_flow.mjs`

**Interfaces:**
- Consumes: `reportSnapshot.sheets`、`selectedMerchantIds`、`tierCategorySummaryExportRows()`、`tierOfferListExportRows()`。
- Produces: `filterReportWorkbookSnapshot(snapshot, selectedMerchantIds)`，返回可直接传给 `createRecommendationWorkbook()` 的 `{ primaryRows, sheets }`。

- [ ] **Step 1: 添加 Tier 1 和通用工作表过滤测试**

```js
const filtered = hooks.filterReportWorkbookSnapshot(memorySnapshot, ["1001"]);
assertDeepEqual(
  filtered.sheets[0].rows.map(row => row["Merchant ID"]),
  ["1001", "1001"],
  "primary sheet should keep all rows for selected merchant"
);
assertDeepEqual(
  filtered.sheets[2].rows.map(row => row["Merchant ID"]),
  ["1001", "1001"],
  "offer list should keep all related rows"
);
assertEqual(filtered.sheets[1].rows.length, 1, "category summary should be recalculated from filtered rows");

const tier1Snapshot = hooks.buildReportExportSnapshot({
  rows: [{ merchantId: "1101", brand: "Tier One", tier: "Tier 1", epc: 2.2 }],
  context: {
    tier: "Tier 1",
    sheets: [
      { sheetName: "Tier 1", rows: [{ "Merchant ID": "1101", "Merchant Name": "Tier One", Tier: "Tier 1", "Tier Reason": "Keep" }], columns: [] },
      { sheetName: "Tier 1 Management", rows: [{ "Merchant ID": "1101", Status: "Active" }], columns: [] },
      { sheetName: "Category Summary", rows: [{ Category: "Audio", "Merchant Count": 1 }], columns: [] },
      { sheetName: "Offer List", rows: [{ "Merchant ID": "1101", "Merchant Name": "Tier One" }], columns: [] }
    ]
  }
}, { id: "mem-tier1", title: "Tier 1 Report", tier: "Tier 1" });
const tier1Filtered = hooks.filterReportWorkbookSnapshot(tier1Snapshot, ["1101"]);
assertEqual(tier1Filtered.sheets.length, 4, "Tier 1 export should preserve its extra source sheet");
assertEqual(tier1Filtered.sheets[1].rows[0]["Merchant ID"], "1101", "Tier 1 merchant management rows should filter by Merchant ID");
```

Run: `node scripts/test_chatbot_intent_flow.mjs`

Expected: FAIL until the filter distinguishes detail, summary and offer-list sheets.

- [ ] **Step 2: 实现按 Merchant ID 过滤通用工作表**

对普通数据工作表执行：

```js
const selected = new Set(selectedMerchantIds.map((id) => String(id).trim()));
const rows = (sheet.rows || []).filter((row) => selected.has(normalizedMemoryMerchantId(row)));
```

保留原 sheet descriptor、sheetName、columns 和原始行顺序。无 Merchant ID 的工作表行不得被错误地全部保留到筛选结果中。

- [ ] **Step 3: 重建 Tier 相关派生工作表**

根据快照记录的 sheet role，并先读取现有 `SHEET_REPORT_DATA.sheets` 中对应 Tier 的实际标签页和列定义：

- 主 Tier 表：直接按 Merchant ID 过滤。
- `Category Summary`：从过滤后的主 Tier 行调用现有 `tierCategorySummaryExportRows()` 和 `tierCategorySummaryExportHeaders()` 重新生成。
- `Offer List`：从过滤后的主 Tier 行调用现有 `tierOfferListExportRows()` 和 `tierOfferListExportHeaders()` 重新生成。
- 单表 Chatbot 报告或未知工作表：只按 Merchant ID 过滤，不擅自增加其他标签页。

Tier 1 可能包含额外的管理字段或管理标签页，必须保留这些原始标签页和字段；只有能够从 Merchant ID 关联到商户的行才过滤，无法关联的固定说明/配置标签页按快照原样保留。Tier 3、Tier 4 和 BLACK TIER 同样走角色识别和通用回退，不复制 Tier 2 的列模板。

将派生 sheet 的 `columns` 从原快照保留；如果原 sheet 是由当前 Tier 导出器创建的，使用其原始 Tier 数字格式，而不是 `recommendationExportColumns()` 的紧凑字段。

- [ ] **Step 4: 将过滤后的 sheets 接入下载注册**

扩展 `registerRecommendationDownload()` 的 `context.sheets` 快照逻辑，并确保 `createRecommendationWorkbook()` 的多工作表分支收到过滤后的 sheets。新增 `registerReportRecommendationDownload(result, language)`，其职责是：

```js
function registerReportRecommendationDownload(result, language) {
  return registerRecommendationDownload(result.selectedRows, {
    downloadType: "sheet",
    filePrefix: "filtered_recommendations",
    exportScope: result.sourceSnapshot.tier || "memory_report",
    sheetName: result.filteredSheets[0].sheetName,
    requestedCount: result.requestedCount,
    sheets: result.filteredSheets,
    reportSnapshot: result.sourceSnapshot
  }, result.requestedCount);
}
```

下载项的 `rows` 和 `context.sheets` 都要再次复制，确保旧 View 不受新推荐或 Report Mode 变化影响。

- [ ] **Step 5: 运行工作簿测试**

Run: `node scripts/test_chatbot_intent_flow.mjs`

Expected: 三个标签页的名称、字段和列结构保留；主表/Offer List 只保留选中 Merchant ID；Category Summary 只按过滤后的行统计。

---

### Task 5: 把结构化推荐结果接入 Chat Mode 的 View

**Files:**
- Modify: `public/app.js:11043-11235`（Chat Mode 流式回复和“转为 View”按钮）
- Modify: `public/app.js:10474-10525`（`_showQuickResultInDeepPanel()` 支持 View 下载卡片）
- Modify: `public/app.js:12399-12420`（复用下载卡片渲染）
- Modify: `public/chatbot_i18n.js:35-110`（中英文文案）
- Modify: `scripts/test_chatbot_intent_flow.mjs`

**Interfaces:**
- Consumes: `buildMemoryRecommendationResult()` 的异步前置分类结果和结构化推荐对象。
- Produces: `viewBtn._recommendationResult`、View 内的本地化下载卡片，以及每个 View 独立的 download ID。

- [ ] **Step 1: 添加 View 卡片的无结果/部分结果测试**

在测试中调用纯 HTML 辅助函数并验证按钮条件：

```js
const partialCard = hooks.renderMemoryRecommendationDownloadCard(
  { ...tier2Only, matchedCount: 2, requestedCount: 10, isPartial: true },
  "zh"
);
assertMatch(partialCard, /下载 Excel/, "partial result should show a localized download button");
const emptyCard = hooks.renderMemoryRecommendationDownloadCard({ status: "empty" }, "zh");
assertEqual(emptyCard, "", "empty result should not render a download button");
```

Run: `node scripts/test_chatbot_intent_flow.mjs`

Expected: FAIL until the View-only card renderer and hook exist.

- [ ] **Step 2: 在 Chat Mode 中准备结构化推荐结果**

在 `/api/chat/stream` 请求开始前，只对 `wantsRecommendationList(prompt)` 或明确识别为 recommendation 的问题启动本地结果准备：

```js
const chatRecommendationPromise = prepareChatMemoryRecommendation(prompt);
```

`prepareChatMemoryRecommendation()` 的流程：

1. 如果没有带 `reportSnapshot` 的记忆项，返回 `unavailable`。
2. 对推荐请求调用现有 `classifyWithLLM(prompt, collectCategories())` 获取结构化 `params`；调用失败时只使用现有正则解析结果。
3. 调用 `buildMemoryRecommendationResult(prompt, state.reportMemory, { llmParams: params })`。
4. 保持当前 Chat Mode 的 `memoryText` POST 字段和流式文本回复不变。

为避免自然语言回复和导出范围产生歧义，将 `criteriaSummary`、选中商户名称和 Merchant ID 作为仅供回复模型参考的附加上下文拼入本次 memory text；导出本身仍只使用前端结构化快照，不解析模型自由文本。

- [ ] **Step 3: 将结果绑定到 View 按钮而非 Chat 回复**

流式回复完成后等待 `chatRecommendationPromise`，在现有 View 按钮上保存：

```js
viewBtn._recommendationResult = chatRecommendationResult;
```

保留 Chat 回复下方只有“转为 View”按钮的行为。点击 View 时将结果传入：

```js
_showQuickResultInDeepPanel(panel, html, prompt, {
  recommendationResult: btn._recommendationResult
});
```

重复点击同一 View 按钮时复用原 panel；新回复使用新的结果对象，不修改旧 panel。

- [ ] **Step 4: 在 View 中渲染唯一下载卡片**

扩展 `_showQuickResultInDeepPanel(panel, html, prompt, options = {})`：

- 先渲染现有 Markdown 回复。
- 当 `options.recommendationResult.status === "ready"` 时调用 `registerReportRecommendationDownload()`，把按钮放在 View 内容底部。
- `matchedCount < requestedCount` 时使用本地化部分结果文案。
- `status` 为 `empty`、`ambiguous` 或 `unavailable` 时只显示说明，不生成按钮。
- 不把下载卡片注入 Chat Log，避免 Chat 回复直接出现下载入口。

新增 `renderMemoryRecommendationDownloadCard(result, language)`，只负责生成卡片 HTML；下载项注册只发生一次，并把生成的 ID 存入当前 View 的结果快照。

- [ ] **Step 5: 增加中英文文案**

在 `public/chatbot_i18n.js` 为 `zh` 和 `en` 增加同一组键：

```js
memoryRecommendationExportTitle
memoryRecommendationExportDescription
memoryRecommendationExportPartial
memoryRecommendationExportNoMatch
memoryRecommendationExportAmbiguous
memoryRecommendationExportUnavailable
```

中文文案必须明确“只包含本次推荐商户”和“当前找到 X 个”；英文文案保持同义，不在 Excel 字段中增加推荐信息。

- [ ] **Step 6: 运行 View 测试**

Run: `node scripts/test_chatbot_intent_flow.mjs`

Expected: View 卡片显示条件、部分数量文案、空结果不显示按钮和每个结果独立 download ID 的测试 PASS；原有 Chatbot 推荐下载测试仍 PASS。

---

### Task 6: 更新 Chatbot 架构文档和测试索引

**Files:**
- Modify: `docs/chatbot-feature-report.md`（记忆、推荐快照、View 导出和函数索引章节）
- Modify: `scripts/test_chatbot_intent_flow.mjs`（在文件末尾保留新测试的说明性注释）

**Interfaces:**
- Consumes: 已实现的函数名和最终测试命令。
- Produces: 后续 Chatbot 维护者可查阅的结构化导出说明。

- [ ] **Step 1: 在 Chatbot 架构文档增加数据流**

补充以下数据流说明：

```text
Report Mode download item
  -> _extractPanelMemory()
  -> reportMemory.reportSnapshot
  -> buildMemoryRecommendationResult()
  -> selectedMerchantIds + filteredSheets
  -> Chat View
  -> registerReportRecommendationDownload()
  -> createRecommendationWorkbook()
```

明确说明 Chat Mode 的自然语言回复仍来自 `/api/chat/stream`，而导出列表来自前端固定的报告快照和推荐结果快照，不从自由文本解析商户名。

- [ ] **Step 2: 更新 app.js 函数索引**

在文档索引中加入 `buildReportExportSnapshot`、`buildMemoryRecommendationResult`、`filterReportWorkbookSnapshot`、`renderMemoryRecommendationDownloadCard` 和 `registerReportRecommendationDownload`，并用实际实现后的行号替换旧索引中受影响的范围。

- [ ] **Step 3: 运行文档相关回归测试**

Run: `node scripts/test_chatbot_intent_flow.mjs`

Expected: PASS，且文档中不存在未完成条目或未定义函数名。

---

### Task 7: 完整验证和浏览器验收

**Files:**
- Test: `scripts/test_chatbot_intent_flow.mjs`
- Test: `public/app.js`, `public/chatbot_i18n.js`
- Verify: `docs/chatbot-feature-report.md`

- [ ] **Step 1: 运行前端语法和 Chatbot 回归**

Run:

```powershell
node --check public/app.js
node --check public/chatbot_i18n.js
node scripts/test_chatbot_intent_flow.mjs
node scripts/test_zh_chatbot.mjs
```

Expected: 每条命令退出码为 0；测试输出不包含 `FAIL` 或未捕获异常。

- [ ] **Step 2: 启动本地服务器进行手工验证**

Run: `python server.py`

在 `http://127.0.0.1:8765/` 完成：

1. 分别打开 Report Mode，生成包含多个 Tier 1 和 Tier 2 商户的报告。
2. 分别下载原始 Tier 1、Tier 2 Excel，确认各自标签页和列结构；对 Tier 3、Tier 4、BLACK TIER 做至少一次范围烟测。
3. 将同一面板加入记忆栏。
4. 切换 Chat Mode，输入“按照 EPC 最高推荐 10 个”。
5. 确认 Chat 回复下方只有“转为 View”。
6. 转为 View，确认下载卡片只出现在 View 中。
7. 下载 Excel，检查主表、Category Summary、Offer List 的 Merchant ID 集合和行数。
8. 确认所有导出商户都来自当前记忆报告；同一商户的重复行全部保留，且 Tier 1 的专用标签页和字段没有丢失。
9. 修改 Report Mode 筛选条件，再下载旧 View，确认旧文件不变。
10. 再生成一次不同标准的推荐，确认新旧 View 的 download ID 和内容互不影响。
11. 用一个只能匹配少量商户的标准，确认导出实际数量并显示不足提示。
12. 用一个没有匹配的标准，确认 View 不显示下载按钮。
13. 切换中英文界面，确认按钮和提示同步切换。

- [ ] **Step 3: 关闭本地服务器**

完成浏览器验收后，确认 `8765` 没有残留监听进程：

```powershell
netstat -ano | Select-String ':8765'
```

如果仍有监听，使用已确认的进程 ID 执行：

```powershell
taskkill //F //PID <进程ID>
```

Expected: 任务完成后 `8765` 不再有 `LISTENING` 进程。

- [ ] **Step 4: 汇总验证证据**

记录语法检查、自动化测试、Excel 标签页/行数检查和浏览器流程结果。只有当这些结果全部通过，才可声称功能完成。

---

## 实施顺序与审查点

1. Task 1 先建立纯函数契约和失败测试。
2. Task 2 完成快照隔离，审查是否真正保存了加入记忆栏时的工作簿结构。
3. Task 3 完成记忆范围、自然语言标准和 Merchant ID 推荐结果，审查是否存在全局候选池回退。
4. Task 4 完成多工作表过滤和 Category Summary 重建，审查是否保留原列定义。
5. Task 5 接入 Chat View，审查下载按钮是否只出现在 View，以及旧 View 是否保持不变。
6. Task 6 更新架构文档。
7. Task 7 运行完整回归和浏览器验收。

每个任务完成后先运行该任务列出的测试，再进入下一个任务。由于用户尚未授权 Git 操作，计划不包含实际提交步骤；如后续获得授权，再按仓库双语提交规则提交已验证的变更。

## 计划自检

- 规格覆盖：单个选定 Tier 范围、Tier 1 专用结构、自然语言标准、Merchant ID 去重、重复行保留、少量/空结果、View 专属下载、原工作簿结构、多 View 隔离、中英文文案和浏览器验收均有对应任务。
- 完整性检查：计划中没有未完成条目或“稍后补充”等未定义步骤。
- 接口一致性：Task 1 定义的 `buildReportExportSnapshot`、`buildMemoryRecommendationResult` 和 `filterReportWorkbookSnapshot` 在 Task 2-5 中使用同名接口；下载结果统一通过 `filteredSheets` 进入 `createRecommendationWorkbook()`。
- 变更边界：未安排后端 API、数据库缓存或 Report Mode 原始导出逻辑的修改。
