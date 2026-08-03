# Report Mode 商户信息月份切换设计文档

日期：2026-08-03
状态：已批准

## 背景与目标

Report Mode 输出的商户信息目前展示的是**当月**（offer 汇总字段）的数据，无法查看历史各月。缓存数据显示 offer 的 `salesAmount` 等字段大多为 0/缺失（Shokz salesAmount=0，真实月度收入在 juneRevenue/mayRevenue 字段），说明"当月"offer 汇总本身并不完整。

目标：在 Report Mode 商户信息展示处增加**月份下拉选择器**，支持查看**近 12 个月**中各月的数据。

## 决策汇总（已与用户确认）

| 决策点 | 结论 |
|--------|------|
| 展示范围 | 两处都加：左侧上下文面板统计卡片（`renderMerchantStats`）+ 聊天区概览卡片（`merchantOverviewHtml`） |
| 交互形式 | 下拉选择器（`<select>`） |
| 月份范围 | 近 12 个月 |
| 聊天区概览卡片 | 扩展展示月度指标（AOV、EPC(All)/EPC(Aff)、CVR、Revenue、All/Aff Commission、Orders、Clicks），与统计卡片口径一致 |
| 默认选中月份 | 月度序列最新月（`monthlyAmazonMetrics[0]`，SQL 已 `ORDER BY month DESC`） |
| 数据来源 | 复用 `fetchMerchantMetrics` → `monthlyAmazonMetrics`，无后端改动 |

## 数据现状与口径

- `monthlyAmazonMetrics` 由 `merchant_amazon_metrics`（offer_db.py:1293）构造，查询 `cnpscy_amazon_order` 明细按月聚合，**与 renderMerchantStats 现有指标同口径、与趋势分析同源**。
- 每行字段：`month`（如 "2026-08"）、`orders`、`revenue`、`payout`、`affiliatePayout`、`clicks`、`dpv`、`atc`、`directSales`、`haloSales` + 计算字段 `epc`（=revenue/clicks）、`aov`（=revenue/orders）、`conversionRate`（=orders/clicks）。
- `payout` 对应 All Commission（= offer.payout 口径）、`affiliatePayout` 对应 Aff Commission（= offer.affCommission 口径），与已实现的 All/Aff 佣金拆分完全一致。
- offer 的 `salesAmount`/`clicks`/`payout` 等"当月"汇总字段大多为 0/缺失，月度序列是更可靠的各月数据源。

## 核心辅助函数（新增，app.js）

```js
// 1. 异步获取商户近 12 个月月度行（带缓存，复用 dbMerchantCache）
async function fetchMerchantMonthlyRows(offer) {
  // fetchMerchantMetrics(offer.merchantId, 12) → payload.monthlyAmazonMetrics（可能 null/空数组）
}

// 2. 月度行 → 虚拟 offer（合并月度指标，offer 级属性保持）
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

// 3. 月份显示名格式化：zh「2026年8月」/ en「Aug 2026」（复用趋势面板 monthStr 拆分思路）
function formatMonthLabel(month, language) { /* month="2026-08" → 显示名 */ }

// 4. 月份下拉 HTML
//    scope ∈ {"context", "overview"}：决定 data-card 值，供 change 事件区分重渲染目标
function merchantMonthPickerHtml(offer, months, selectedMonth, scope, language) {
  // <select class="merchant-month-picker" data-merchant-id="…" data-card="context|overview">
  //   每项 <option value="2026-08" [selected]>2026年8月</option>
  // </select>
}
```

- `offerAllEpc`/`offerAffEpc`/`offerAllCommission`/`offerAffCommission`（已实现，app.js:1119 附近）**直接复用**：`mergeMonthIntoOffer` 之后，`offerAllEpc(virtualOffer)` = row.payout/row.clicks、`offerAffEpc(virtualOffer)` = row.affiliatePayout/row.clicks。
- 上述新增函数均暴露到 `OFFER_INTELLIGENCE_TEST_HOOKS` 以便测试。

## 展示位置改动明细

### 1. 左侧上下文面板统计卡片（`renderMerchantStats`，app.js:7128）

- 卡片顶部（`<h4>` 后）注入月份下拉（当且有月度数据时）。
- 月度 statCards（AOV、EPC(All)、EPC(Aff)、CVR、Revenue made、All/Aff Commission、Orders、Clicks、DPV、ATC）用**所选月的虚拟 offer** 渲染。
- 非月度部分（Merchant ID、Tier、Network、Category、Commission rate、Payment、Link status、CPC、Discount/deal、推荐建议）仍用原始 offer，不随月份变。
- 渲染前需异步获取月度行；无月度数据时按现状渲染（offer 字段），不显示下拉。

### 2. 聊天区概览卡片（`merchantOverviewHtml`，app.js:7532）

- 概览卡片顶部注入月份下拉。
- 原有 fieldRows（Merchant/Tier/Category/Region/Commission rate/Payment cycle）保留，其中 AOV 用所选月值。
- **新增**所选月的核心月度指标行：EPC(All)、EPC(Aff)、CVR、Revenue、All Commission、Aff Commission、Orders、Clicks（与统计卡片口径一致）。
- 外层容器加唯一标识：`<div class="merchant-card" data-merchant-card="merchant-card-<seq>">`（`<seq>` 由递增计数器 `merchantCardSeq++` 生成，同一商户多次提问时容器 id 不冲突），供月份切换时重渲染定位。

### 3. 事件绑定（init 区，app.js:8730+）

- 事件委托：`document.addEventListener("change", …)` 捕获 `.merchant-month-picker`。
- change 时读取 `data-merchant-id` + `data-card` + 所选 `value`：
  - `data-card="context"`：重新获取月度行 → `mergeMonthIntoOffer` → `renderMerchantStats` 渲染 recBox。
  - `data-card="overview"`：定位 `[data-merchant-card]` 容器 → 重渲染 `merchantOverviewHtml`。

## 默认与降级

| 场景 | 行为 |
|------|------|
| 有月度数据（部署环境，DB 正常） | 显示月份下拉，默认选中最新月；切换月份重渲染月度指标 |
| 无 DB / `monthlyAmazonMetrics` 为空（本地开发） | 不显示下拉，保持现有 offer 字段渲染（现状不变） |
| 月序列仅 1 个月 | 下拉仍显示（单选项），数据为该完整月 |

## 明确不改的位置

| 位置 | 理由 |
|------|------|
| 后端接口 `merchant_amazon_metrics` / `/api/ui/db/merchant` | 已返回 `months` 参数可用的月度序列，无需改动 |
| 品类/Tier/ASIN/支付/关键词等其他上下文面板 | 本次仅商户信息；品类/Tier 已有趋势分析按月维度 |
| offer 级属性（Tier/Network/Category/Commission rate/Payment/推荐等） | 非月度数据，不随月份切换 |
| 聚合汇总统计卡（品类/Tier 统计卡） | 聚合口径，不在本次范围 |

## 测试方案

新脚本 `scripts/test_merchant_monthly.mjs`（vm sandbox，沿用 `scripts/test_commission_all_aff.mjs` 模式，数据驱动）：

| 用例 | 断言 |
|------|------|
| 月份行→offer 映射 | `mergeMonthIntoOffer(offer, row)` 的 `salesAmount===row.revenue`、`payout===row.payout`、`affCommission===row.affiliatePayout`、`aov/clicks/orders/dpv/atc` 正确；offer 级属性（tier/network 等）不变 |
| EPC 公式复用 | `offerAllEpc(mergeMonthIntoOffer(o,row))` = payout/clicks、`offerAffEpc` = affiliatePayout/clicks |
| 下拉 HTML | 含近 12 个月 `<option>`、`data-merchant-id`、默认选中最新月 |
| 统计卡片渲染 | `renderMerchantStats(virtualOffer)` 输出含所选月指标值与下拉；无月度数据时不渲染下拉 |
| 概览卡片渲染 | `merchantOverviewHtml(virtualOffer)` 输出含月度指标行 |
| 月份格式化 | `formatMonthLabel("2026-08", zh/en)` → 「2026年8月」/「Aug 2026」 |

验证方式：`node --check` + `node scripts/test_merchant_monthly.mjs`（vm sandbox，不依赖 DB，用缓存数据或合成 fixture）。接入 CI（`.github/workflows/ci.yml`）+ CLAUDE.md 测试命令节。

## 实施影响面

- 文件：`public/app.js`（新增 4 个辅助函数、`renderMerchantStats`/`merchantOverviewHtml` 改造、init 事件绑定、hooks 暴露）、`scripts/test_merchant_monthly.mjs`（新建）、`.github/workflows/ci.yml`、`CLAUDE.md`。
- 不改 `public/index.html`、`public/styles.css`（复用现有 select/下拉样式，必要时仅微调）。
- 不涉及数据层与后端。
