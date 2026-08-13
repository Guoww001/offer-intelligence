# Chatbot Analysis Metric Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一 Chat Mode 商户分析中的 Affiliate EPC、Affiliate Commission Rate、样本量资格和平均值/百分位统计口径。

**Architecture:** 在 `public/app.js` 增加分析专用的指标定义、归一化值、样本量规则和同一可比样本集合；商户分析、全站/品类/Tier 对比都消费这些 helper。百分位和基准平均值使用同一指标值、同一可比记录集合；样本不足的商户保留数值但不标记为亮点/短板。

**Tech Stack:** Vanilla JavaScript、Node.js ESM 测试、现有 `OFFER_INTELLIGENCE_TEST_HOOKS`。

## Global Constraints

- 所有说明、测试名称和代码注释使用简体中文；代码标识符保持英文。
- Chatbot 工作必须参考 `docs/chatbot-feature-report.md`，不得读取或重写整个 `public/app.js`。
- Affiliate EPC 统一为 `affCommission / clicks`，展示标签明确为 `EPC(Aff)`。
- Affiliate Commission Rate 统一为百分比数值，例如 `7.5` 表示 `7.5%`。
- 质量指标的样本门槛：EPC/CVR 至少 100 clicks；AOV/Commission Rate 至少 10 orders；数量指标不因样本不足隐藏。
- 不修改用户已有的无关工作区改动，不提交、不推送、不创建 PR。

---

### Task 1: 增加失败回归测试和测试 hook

**Files:**
- Add: `scripts/test_chatbot_analysis_comparison_rules.mjs`
- Modify: `public/app.js`（仅增加测试 hook，先不改生产计算行为）

**Interfaces:**
- `OFFER_INTELLIGENCE_TEST_HOOKS.analyzeMerchant(name)` 返回当前商户分析 summary。
- `OFFER_INTELLIGENCE_TEST_HOOKS.analysisMetricValueForOffer(offer, field)` 返回归一化分析值。
- `OFFER_INTELLIGENCE_TEST_HOOKS.analysisMetricSampleSize(offer, field)` 返回样本量。
- `OFFER_INTELLIGENCE_TEST_HOOKS.analysisMetricSampleEligible(offer, field)` 返回布尔值。
- `OFFER_INTELLIGENCE_TEST_HOOKS.analysisAverage(list, field)` 返回与百分位相同可比集合上的算术平均值。

- [x] **Step 1: 暴露分析 hook**

在 `public/app.js` 测试 hook 对象中增加上述 5 个函数。暂时让 `analyzeMerchant` 仍使用现有逻辑，以便后续断言能够捕获当前缺陷。

- [x] **Step 2: 写 EPC 和 Commission Rate 的失败测试**

在 `scripts/test_chatbot_analysis_comparison_rules.mjs` 加入基于 Shokz 缓存数据的断言：

```js
const shokz = _offersCache.offers.find((offer) => String(offer.merchantId) === "362653");
assertTruthy(shokz, "fixture requires Shokz");
const shokzAnalysis = hooks.analyzeMerchant("Shokz");
const expectedAffEpc = Number(shokz.affCommission) / Number(shokz.clicks);
const expectedAffRate = Number(shokz.affCommission) / Number(shokz.salesAmount) * 100;
assertApprox(shokzAnalysis.metrics.epc, expectedAffEpc, "analysis EPC must use Affiliate EPC", 1e-9);
assertApprox(shokzAnalysis.metrics.commissionRate, expectedAffRate, "analysis Commission Rate must use AFF percent", 1e-9);
```

- [x] **Step 3: 写同口径平均值/百分位测试**

使用真实 Electronics 同品类 rows 计算每个商户的归一化 Affiliate EPC，断言 `vsCategory.epc.avg` 等于这些值的算术平均；对 Commission Rate 做同样断言。当前实现应因使用 `salesAmount / clicks` 和比例值而失败。

- [x] **Step 4: 写样本量失败测试**

加入以下纯 helper 断言：

```js
assertEqual(hooks.analysisMetricSampleSize({ clicks: 99 }, "epc"), 99, "EPC sample size uses clicks");
assertEqual(hooks.analysisMetricSampleEligible({ clicks: 99 }, "epc"), false, "EPC needs minimum clicks");
assertEqual(hooks.analysisMetricSampleEligible({ clicks: 100 }, "epc"), true, "EPC passes minimum clicks");
assertEqual(hooks.analysisMetricSampleEligible({ orders: 9 }, "aov"), false, "AOV needs minimum orders");
assertEqual(hooks.analysisMetricSampleEligible({ orders: 10 }, "aov"), true, "AOV passes minimum orders");
```

- [x] **Step 5: 运行测试确认 RED**

Run: `node scripts/test_chatbot_analysis_comparison_rules.mjs`

Expected: FAIL at the new metric-alignment assertions, not at parsing or missing hook errors.

### Task 2: 实现统一分析指标和样本资格

**Files:**
- Modify: `public/app.js:5210-5265`
- Modify: `public/app.js:5498-5645`

**Interfaces:**
- `analysisMetricValueForOffer(offer, field)` returns Affiliate EPC and Affiliate Commission Rate in display units.
- `analysisMetricSampleSize(offer, field)` returns clicks for EPC/CVR, orders for AOV/Commission Rate, and null for volume metrics.
- `analysisMetricSampleEligible(offer, field)` gates only quality/rate metrics.
- `analysisComparableOffers(list, field)` returns rows with finite values and eligible samples.
- `analysisAverage(list, field)` averages the same normalized values returned by `analysisComparableOffers`.
- `percentileRank(value, values)` keeps its numeric behavior; caller supplies the aligned comparable values.

- [x] **Step 1: 添加分析定义常量**

在分析 utility 区域增加：

```js
const ANALYSIS_MIN_CLICKS = 100;
const ANALYSIS_MIN_ORDERS = 10;
const ANALYSIS_FIELDS = ["epc", "aov", "conversionRate", "orders", "clicks", "affCommission", "commissionRate", "salesAmount"];
```

`analysisMetricSampleSize()` 使用：EPC/CVR → clicks；AOV/Commission Rate → orders；orders/clicks/affCommission/salesAmount → null。

- [x] **Step 2: 添加归一化分析值**

`analysisMetricValueForOffer()` 的关键规则：

```js
if (field === "epc") return offerAffEpc(offer) || 0;
if (field === "commissionRate") {
  const revenue = Number(offer.salesAmount);
  const commission = offerAffCommission(offer);
  if (revenue > 0 && commission !== null) return commission / revenue * 100;
  const fallback = Number(offer.affCommissionRate ?? offer.commissionRate);
  return Number.isFinite(fallback) ? (Math.abs(fallback) <= 1 ? fallback * 100 : fallback) : 0;
}
if (field === "conversionRate") return Number(offer.conversionRate || 0) * 100;
return Number(offer[field] || 0);
```

不再用 `offer.commissionRate` 直接作为分析值，也不再用 `salesAmount / clicks` 作为 EPC。

- [x] **Step 3: 添加同一可比集合的平均值 helper**

`analysisComparableOffers()` 过滤非空、有限值和样本资格；`analysisAverage()` 对 `analysisMetricValueForOffer()` 的结果做算术平均，包含合法的 0 值。这样平均值和百分位都基于同一 rows 和同一字段值。

- [x] **Step 4: 运行新增测试确认 GREEN**

Run: `node scripts/test_chatbot_analysis_comparison_rules.mjs`

Expected: Task 1 的 helper、EPC、Commission Rate、aligned-average 断言通过；商户 summary 的百分位资格断言在 Task 3 完成前可能仍失败。

### Task 3: 改造商户分析并明确样本不足状态

**Files:**
- Modify: `public/app.js:5498-5645`
- Modify: `public/app.js:6230-6285`
- Modify: `public/app.js:7392-7560`
- Modify: `scripts/test_chatbot_analysis_comparison_rules.mjs`

**Interfaces:**
- `analyzeMerchant()` 的 `metrics`、`ranks`、`comparisons` 统一使用 Task 2 helper。
- 每个 `ranks[field]` 增加 `sampleSize`, `sampleEligible`, `comparisonCount`, `status`。
- `status` 为 `"ok"` 或 `"insufficient_sample"`。

- [x] **Step 1: 改造 `analyzeMerchant()`**

对每个 field：

1. 用 `analysisMetricValueForOffer()` 计算当前值。
2. 用 `analysisComparableOffers(categoryOffers, field)` 得到同一可比集合。
3. 用该集合的 normalized values 计算 percentile。
4. 用 `analysisAverage(categoryOffers, field)` 计算 `vsCategory.avg`；Tier 和 Global 也使用相同 helper。
5. 当前商户不满足样本门槛时，percentile 设为 `null`，status 为 `insufficient_sample`；仍保留 value 和 sampleSize。

- [x] **Step 2: 改造亮点/短板判断**

只在 `rank.sampleEligible === true` 时应用 70/30 阈值；样本不足不进入 strengths 或 weaknesses。

- [x] **Step 3: 改造表格展示**

将商户分析表头的 `EPC` 改为 `EPC(Aff)`，`Comm %` 改为 `AFF Comm %`；样本不足的排名单元格显示“样本不足”/“Insufficient sample”，不显示伪造的 Top 百分比。

- [x] **Step 4: 改造 fallback 分析文案**

当 summary 含有 `insufficient_sample` 时，追加“部分指标样本量不足，未将其判定为亮点或短板”的中英文说明；不得让 LLM 将缺失 percentile 当成弱项。

- [x] **Step 5: 增加 RED/GREEN 断言**

断言 Shokz 的 summary 中 EPC、Commission Rate 与同品类平均值口径一致；构造低样本 offer 的 rank 后断言 status 为 `insufficient_sample`，且不出现在 strengths/weaknesses。

- [x] **Step 6: 运行测试确认 GREEN**

Run: `node scripts/test_chatbot_analysis_comparison_rules.mjs`

Expected: 新增分析规则测试通过。

### Task 4: 对齐其他分析汇总、文档和回归验证

**Files:**
- Modify: `public/app.js:5843-6018`（品类/Tier 分析中的 EPC、Commission Rate 平均值）
- Modify: `public/app.js:6033-6175`（多品类/多 Tier 的 Affiliate EPC/Rate 单位）
- Modify: `docs/chatbot-analysis-comparison-rules.md`
- Modify: `docs/chatbot-feature-report.md`（如需补充入口说明）

**Interfaces:**
- 品类、Tier、跨实体分析中的 Affiliate EPC 和 Commission Rate 与商户分析使用相同单位。

- [x] **Step 1: 对齐品类/Tier `avgField()`**

删除 `salesAmount / clicks` EPC 和小数 commission rate 的局部公式，改为 `analysisAverage(list, field)`；渲染层继续按百分比格式化。

- [x] **Step 2: 对齐多实体分析**

`avgEpc` 统一使用 AFF commission / clicks；`avgCommRate` 统一乘以 100，或改用同一 `analysisAverage()`，确保渲染 `pct(value / 100)` 时输入为百分比数值。

- [x] **Step 3: 更新规则文档**

记录最终决策：Affiliate EPC、AFF Commission Rate 百分比、100 clicks / 10 orders 门槛、质量指标样本不足不判强弱、平均值和百分位共用同一可比集合与算术平均。

- [x] **Step 4: 运行静态检查和专项测试**

Run:

```powershell
node --check public/app.js
node scripts/test_chatbot_analysis_comparison_rules.mjs
git diff --check
```

Expected: `node --check` exit 0，专项测试 exit 0，`git diff --check` 无输出。若完整 intent 测试超时，记录为既有测试环境问题，不把超时误报为规则改造失败。

- [x] **Step 5: 检查差异范围**

Run: `git status --short; git diff --stat`

确认只包含本次分析规则改造、测试和文档；不覆盖工作区中原有的无关变更。
