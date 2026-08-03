# 商户指标 COMMISSION 拆分 ALL/AFF（含 EPC）设计文档

日期：2026-08-03
状态：已实现

## 背景与目标

当前商户展示的 COMMISSION 指标只有一个口径（`offer.affCommission`，联盟佣金），没有区分 ALL Commission（总佣金，`offer.payout`）与 AFF Commission（联盟佣金）。EPC 也只有单一数据字段 `offer.epc`。

目标：在**商户级展示位置**统一拆分为 All/Aff 两个口径的 Commission，并区分两种口径下的 EPC（All/Aff）。聚合汇总（品类/Tier 统计卡）不在本次范围。

## 决策汇总（已与用户确认）

| 决策点 | 结论 |
|--------|------|
| 展示范围 | 全部统一处理：chatbot 商户统计卡片、结果表格、Excel 导出列 |
| ALL Commission 口径 | `offer.payout` 字段 |
| AFF Commission 口径 | `offer.affCommission` 字段 |
| EPC 计算 | 统一前端计算：EPC All = `payout/clicks`，EPC Aff = `affCommission/clicks`；clicks≤0 时 null |
| 缺失值处理 | `money()`/`epc()` 对 null 显示 "not available in current data"；`shortMoney()`/`shortEpc()` 显示 "-" |
| 标签 | 中英文 i18n：zh "总佣金/联盟佣金" + "EPC(All)/EPC(Aff)"；en "All Commission/Aff Commission" |

## 数据现状

- `offer.payout` 与 `offer.affCommission`：仅 59/6284 offer 有值；其中 43 个 payout==aff，16 个 payout>aff。
- `offer.epc`：数据源提供字段，口径未知（数据无 clicks>0 且有 commission 的样本，无法验证），本次不改动该字段本身。
- 目标页已有 DB 月度指标的 `allCommission`/`affCommission` 双字段（"All Comm"/"Aff Comm"），本次不动，仅作对照。

## 核心辅助函数

新增 4 个纯函数（app.js，复用 `isAvailable`/`number`）：

```js
offerAllCommission(offer)  → offer.payout 有效则数值，否则 null
offerAffCommission(offer)  → offer.affCommission 有效则数值，否则 null
offerAllEpc(offer)         → payout / clicks（clicks≤0 返回 null）
offerAffEpc(offer)         → affCommission / clicks（clicks≤0 返回 null）
```

- 均暴露为 `OFFER_INTELLIGENCE_TEST_HOOKS` 以便测试。
- null 不额外包装：各展示位置复用现有 `money()`（null→"not available in current data"）、`shortMoney()`/`shortEpc()`（null→"-"）、`epc()`（null→"not available"）。

## 展示位置改动明细

### 1. chatbot 商户统计卡片（`renderMerchantStats`，约 7091 行）

替换两行，不保留旧单值：

| 原 | 新 |
|----|----|
| `["Commission made", money(offer.affCommission)]` | `["All Commission", money(offerAllCommission(offer))]`<br>`["Aff Commission", money(offerAffCommission(offer))]` |
| `["EPC", epc(offer.epc)]` | `["EPC(All)", epc(offerAllEpc(offer))]`<br>`["EPC(Aff)", epc(offerAffEpc(offer))]` |

`statCards` 走 `labelText(label)`，标签键加到 zh 字典（见 i18n 节）。

### 2. chatbot 上下文/结果表格（`contextColumns`，约 7029-7041 行，`miniTable` 用）

- `"Commission made"` 列（`shortMoney(o.affCommission)`）→ 两列：`All Commission`（`shortMoney(offerAllCommission(o))`）+ `Aff Commission`（`shortMoney(offerAffCommission(o))`）。
- `"EPC"` 列（`shortEpc(o.epc)`）→ 两列：`EPC(All)`（`shortEpc(offerAllEpc(o))`）+ `EPC(Aff)`（`shortEpc(offerAffEpc(o))`）。

### 3. 品类/Tier/对比分析的 Top Brands 硬编码表格（5940/6075/6177 行）

- `briefOffer` 聚合对象（约 4934 行）新增字段：`allCommission: o.payout || 0`、`allEpc`、`affEpc`（复用 `offerAllEpc`/`offerAffEpc` 计算）。
- 表头与单元格：单列 "佣金"（`money(m.affCommission)`）→ 两列 All/Aff；单列 "EPC"（`epc(m.epc)`）→ 两列 EPC(All)/EPC(Aff)。涉及三处：品类 Top 5、对比分析 Top Brands、Tier Top Brands。

### 4. Excel 导出列（`objectExportColumns`，约 11253-11261 行）

注：实际位置为 recommendationExportColumns（app.js:11280-11316）；objectExportColumns（app.js:11340）是通用动态表头生成器，无需改。

| 原 | 新 |
|----|----|
| `["Commission", number(offer.affCommission)]` | `["All Commission", offerAllCommission]` + `["Aff Commission", offerAffCommission]` |
| `["EPC", number(offer.epc)]` | `["EPC(All)", offerAllEpc]` + `["EPC(Aff)", offerAffEpc]` |

## i18n 新增键（translations.zh）

```js
"label.All Commission": "总佣金",
"label.Aff Commission": "联盟佣金",
"label.EPC(All)": "EPC(All)",
"label.EPC(Aff)": "EPC(Aff)"
```

英文界面 `labelText(label)` fallback 返回原文（"All Commission"/"Aff Commission"/"EPC(All)"/"EPC(Aff)"），无需单独维护 en 字典。

## 明确不改的位置

| 位置 | 理由 |
|------|------|
| 品类/Tier 聚合汇总统计卡（totalCommission=ΣaffCommission，7080/7177/7198 行；aggregateRows 3184 行） | 聚合口径；6268/6284 缺 payout 导致 All 汇总几乎全空 |
| 排序逻辑（按 affCommission，4648/6732 行） | 聚焦展示，排序口径不变 |
| LLM 字段映射（4262 行 labels，`affCommission`→"Commission"） | 意图识别与解析不变 |
| 目标页 All Comm/Aff Comm（12782/12783 行） | 已区分，仅作对照 |
| 支付相关 "Commission made"（7151/7164/7788/11742 行） | 支付佣金，非商户 offer 佣金 |
| `offer.epc` 字段本身 | 保持数据源口径，仅展示层新增 EPC(All)/EPC(Aff) |

## 测试方案

新增 hooks：`offerAllCommission`/`offerAffCommission`/`offerAllEpc`/`offerAffEpc`。

测试断言（加至 `scripts/test_chatbot_intent_flow.mjs`）：

| 用例 | 断言 |
|------|------|
| 真实商户映射 | `offerAllCommission(Shokz 362653)` = `shokz.payout`；`offerAffCommission` = `shokz.affCommission`（数据驱动，适配缓存刷新） |
| EPC 计算 | `{payout:100, affCommission:80, clicks:200}` → All=0.5, Aff=0.4 |
| 缺失/零点击 | `{clicks:0}` → EPC 均 null；`{}` → commission 均 null |
| 格式化 | `money(null)` → "not available in current data"；`shortEpc(null)` → "-" |
| 统计卡片渲染 | `renderMerchantStats(Shokz)` 输出含 "总佣金"/"联盟佣金"（zh 界面） |
| 导出列 | `objectExportColumns` 含 All Commission/Aff Commission/EPC(All)/EPC(Aff) |
| i18n | zh 字典含 `label.All Commission`→总佣金、`label.Aff Commission`→联盟佣金 |

验证方式：`node --check` + 测试断言（沿用截断法规避 `test_chatbot_intent_flow.mjs` 既有偶发挂起）；可选手动启动服务器（`python server.py`，端口 8765）确认 UI，用毕关闭。

## 实施影响面

- 文件：`public/app.js`（辅助函数、统计卡片、contextColumns、briefOffer、导出列、hooks、i18n）、`scripts/test_chatbot_intent_flow.mjs`（断言）。
- 不改 `public/index.html`、`public/styles.css`（无新元素，仅列/卡片行变化）。
- 不涉及数据层（纯前端展示映射）。
