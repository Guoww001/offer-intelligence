# Tier Sheet Excel Number Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** 让 Tier Sheet 下载的 Excel 使用原生百分比格式，并将 Clicks、ATC、DPV 等计数字段显示为整数。

**Architecture:** 在 Tier Sheet 导出的列定义中携带格式元数据。通用 worksheet XML 生成器根据列元数据把百分比和整数值转换为 Excel 数值单元格，并引用对应的共享 cell style；其他下载继续使用默认格式。

**Tech Stack:** Vanilla JavaScript、手写 XLSX XML/ZIP 生成器、Node.js `.mjs` 前端测试。

## Global Constraints

- 所有回答、解释、代码注释、文档说明使用简体中文。
- 不改变金额、EPC、AOV、文本列的导出语义。
- 不提交 Git commit，除非用户明确授权。

---

### Task 1: 为 Tier Sheet 导出格式增加失败测试

**Files:**
- Modify: `scripts/test_tier_report_frontend.mjs`

**Interfaces:**
- Consumes: `window.OFFER_INTELLIGENCE_TEST_HOOKS.tierSheetExportColumns`、`worksheetXml`、`stylesXml`。
- Produces: 能验证百分比列、整数列和普通数值列的导出 XML 结果。

- [x] **Step 1: Write the failing test**

在现有 Tier Sheet 格式测试后加入：

```js
const exportRows = [{
  "Commission Rate": "27.0",
  "Conversion Rate": "0.125",
  Clicks: "18.0",
  ATC: "0.0",
  DPV: "14.0",
  Revenue: "154.489751"
}];
const exportHeaders = ["Commission Rate", "Conversion Rate", "Clicks", "ATC", "DPV", "Revenue"];
const exportColumns = hooks.tierSheetExportColumns(exportRows, exportHeaders);
const exportWorksheet = hooks.worksheetXml(exportRows, { columns: exportColumns });
const exportStyles = hooks.stylesXml();
assertEqual(exportWorksheet.includes('r="A2" s="1"'), true, "Commission Rate should use percentage style");
assertEqual(exportWorksheet.includes('r="B2" s="1"'), true, "Conversion Rate should use percentage style");
assertEqual(exportWorksheet.includes('r="C2" s="2"'), true, "Clicks should use integer style");
assertEqual(exportWorksheet.includes('r="D2" s="2"'), true, "ATC should use integer style");
assertEqual(exportWorksheet.includes('r="E2" s="2"'), true, "DPV should use integer style");
assertEqual(exportWorksheet.includes('r="F2" s='), false, "Revenue should keep the default style");
assertEqual(exportWorksheet.includes('<v>0.27</v>'), true, "whole-number percentage should be normalized to a fraction");
assertEqual(exportWorksheet.includes('<v>0.125</v>'), true, "fractional percentage should remain a fraction");
assertEqual(exportWorksheet.includes('<v>18</v>'), true, "Clicks should be exported as an integer");
assertEqual(exportWorksheet.includes('<v>0</v>'), true, "ATC should be exported as an integer");
assertEqual(exportWorksheet.includes('<v>14</v>'), true, "DPV should be exported as an integer");
assertEqual(exportStyles.includes('numFmtId="10"'), true, "styles should define the Excel percentage format");
assertEqual(exportStyles.includes('numFmtId="1"'), true, "styles should define the Excel integer format");
```

- [x] **Step 2: Run test to verify it fails**

Run: `node scripts/test_tier_report_frontend.mjs`

Expected: FAIL because the new export test hooks do not exist yet.

### Task 2: 实现 Tier Sheet Excel 原生数字格式

**Files:**
- Modify: `public/app.js:12434-12543`
- Modify: `public/app.js:12730-12773`
- Modify: `public/app.js:20323-20480`

**Interfaces:**
- Consumes: `isRateColumn`、`TIER_INTEGER_METRIC_HEADERS`、现有 `objectExportColumns` 和 worksheet XML 生成流程。
- Produces: `tierSheetExportColumns(rows, headers)`、带 style 的 `worksheetXml`、包含百分比和整数 cell styles 的 `stylesXml`。

- [x] **Step 1: Add centralized Tier Sheet column format metadata**

实现 `tierSheetExportColumns`，在每个列定义的第四项写入 `percentage`、`integer` 或空格式；百分比判断复用 `isRateColumn`，整数判断复用 `TIER_INTEGER_METRIC_HEADERS`。

- [x] **Step 2: Add numeric normalization for formatted cells**

在 worksheet XML 写入前：百分比值按现有展示规则归一化为 0–1 小数，整数值转换为整数；无法解析的空值或文本保持文本单元格。

- [x] **Step 3: Add shared Excel styles**

扩展 `stylesXml`：style 0 为默认格式，style 1 使用内置 `numFmtId=10`（`0.00%`），style 2 使用内置 `numFmtId=1`（整数）。

- [x] **Step 4: Apply format metadata to all three Tier Sheet workbook tabs**

主表、Category Summary、Offer List 均改用 `tierSheetExportColumns`；网格型旧 Sheet 保持现有导出路径。

- [x] **Step 5: Expose pure export helpers through test hooks**

暴露 `tierSheetExportColumns`、`worksheetXml` 和 `stylesXml`，仅在测试环境使用。

### Task 3: 验证导出行为

**Files:**
- No additional files.

- [x] **Step 1: Run focused frontend test**

Run: `node scripts/test_tier_report_frontend.mjs`

Expected: PASS。

- [x] **Step 2: Run syntax and related tests**

Run: `node --check public/app.js`

Run: `node scripts/test_chatbot_intent_flow.mjs`

Expected: 全部 PASS。

- [x] **Step 3: Inspect diff and confirm scope**

Run: `git diff -- public/app.js scripts/test_tier_report_frontend.mjs docs/superpowers/specs/2026-08-06-tier-sheet-excel-number-format-design.md docs/superpowers/plans/2026-08-06-tier-sheet-excel-number-format.md`

Expected: 仅包含 Tier Sheet Excel 格式、测试和设计文档变更；不执行 commit。
