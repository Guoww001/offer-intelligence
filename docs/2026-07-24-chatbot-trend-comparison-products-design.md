# Chatbot 三大新功能设计文档

> 日期：2026-07-24
> 分支：`main`

## 1. 概述

在现有 chatbot 的 7 种意图（asin/merchant/payment/recommendation/tier/category/analysis）基础上，新增三个功能：**商户直接对比**、**产品级洞察**、**历史趋势分析**。三者均复用现有后端 API，无需新增端点。

### 数据来源矩阵

| 功能 | 数据来源 | 是否需要新 API |
|------|---------|--------------|
| 商户对比 | In-memory `offers[]`（6279 条） | ❌ 纯前端 |
| 产品洞察 | `/api/ui/db/merchant?merchantId=xxx&limit=12&months=6`（已有） | ❌ |
| 趋势分析 | 同上 API 的 `monthlyAmazonMetrics`（12 个月） | ❌ |

---

## 2. 商户直接对比

### 2.1 用户场景

- "对比 Shokz 和 Soundcore"
- "Shokz 比 Soundcore 好在哪里"
- "比较 Beauty 和 Electronics 两个品类中 Tier 1 的商户"

### 2.2 LLM Skill 扩展

`skills/analysis.py` 的 `AnalysisIntentSkill`：

- `analysisType` 的 `enum` 不变（仍为 merchant/category/tier/trend）
- 商户对比通过 `analysisTargets` 参数触发：当 `analysisType === "merchant"` 且 `analysisTargets.length > 1`
- `analysisTargets` 参数已存在，当前仅用于 category/tier 多实体
- 新增示例对：

```python
ExamplePair(
    query="对比 Shokz 和 Soundcore",
    output={
        "intent": "analysis",
        "params": {
            "analysisType": "merchant",
            "analysisTargets": ["Shokz", "Soundcore"],
            "analysisTarget": "Shokz",
        },
    },
),
ExamplePair(
    query="compare beauty with electronics tier 2 merchants",
    output={
        "intent": "analysis",
        "params": {
            "analysisType": "category",
            "analysisTargets": ["Beauty", "Electronics"],
            "analysisTarget": "Beauty",
        },
    },
),
```

### 2.3 前端函数

#### `analyzeMerchantComparison(targets: string[])`

```
输入: ["Shokz", "Soundcore"]
流程:
  1. 对每个 target，调用 findOfferByMerchantName()
  2. 过滤掉未匹配的 target
  3. 当匹配数 < 2 时返回 null
  4. 计算每个商户的 8 个核心指标（epc/aov/cvr/orders/salesAmount/affCommission/clicks/commissionRate）
  5. 计算两两差异（绝对值 + 百分比）

输出:
{
  type: "merchant_comparison",
  entities: [
    { name, tier, category, metrics: { epc, aov, ... }, paymentRisk, visualStatusColor },
    { name, tier, category, metrics: { epc, aov, ... }, paymentRisk, visualStatusColor }
  ],
  targetCount: 2,
  deltas: {
    epc: { abs: 0.6, pct: 40, better: "Shokz" },
    aov: { abs: 23, pct: 37, better: "Shokz" },
    ...
  }
}
```

#### `renderMerchantComparisonTable(summary)`

渲染并排对比表（HTML）：

```
<div class="analysis-section">
  <h4>商户对比: Shokz vs Soundcore</h4>
  <table class="analysis-table">
    <thead>
      <tr><th>指标</th><th>Shokz</th><th>Soundcore</th><th>差异</th></tr>
    </thead>
    <tbody>
      <tr><td>EPC</td><td>$2.10</td><td>$1.50</td><td>+40% ↑</td></tr>
      <tr><td>AOV</td><td>$85.00</td><td>$62.00</td><td>+37% ↑</td></tr>
      ...
    </tbody>
  </table>
  <p>Shokz: Tier 1 · Sports & Outdoors | Soundcore: Tier 1 · Electronics</p>
</div>
```

差异值规则：
- `delta.abs === 0` → `"="`
- `delta.pct > 0` → `"+N% ↑"`
- `delta.pct < 0` → `"-N% ↓"`
- 非零但 `|pct| < 1%` → `"≈"`

### 2.4 路由逻辑

`analysisAnswer()` 中新增分支：

```javascript
if (analysisType === "merchant") {
  if (hasMultiTargets) {
    summary = analyzeMerchantComparison(entities);
    // 渲染并排表
  } else {
    summary = analyzeMerchant(analysisTarget);
    // 走现有单商户分析
  }
}
```

---

## 3. 产品级洞察

### 3.1 用户场景

- "Shokz 卖什么产品"
- "362653 的 ASIN 表现"
- 任何商户查询后自动附带产品详情

### 3.2 现有流程

`applyPrompt()` 中已有侧载逻辑（`app.js:7239-7249`）：

```javascript
const dbMerchantOffer = dbMerchantOfferForPrompt(prompt);
addMessage("assistant", answerPrompt(prompt));  // 主回答
if (dbMerchantOffer) loadDbMerchantInsight(dbMerchantOffer);  // 侧载
```

`loadDbMerchantInsight()` 调 `/api/ui/db/merchant?merchantId=xxx&limit=8&months=6`，通过 `dbMerchantInsightHtml()` 渲染产品卡片。

### 3.3 增强点

#### 3.3.1 API limit 增加

当前传 `limit=8&months=6` → 改为 `limit=12&months=6`，展示更多产品。

#### 3.3.2 `dbMerchantProductRows()` 行增强

```javascript
// 当前: 仅显示 ASIN + 产品名 + BSR
// 改为:
function dbMerchantProductRows(products = [], monthlyMetrics = []) {
  // 构建 ASIN → 月指标映射
  // 显示: ASIN | 产品名 | BSR | 月订单 | 月Revenue
}
```

#### 3.3.3 产品触发优化

当前 `dbMerchantOfferForPrompt()` 只在精确匹配时才触发 side-load。增强为：
- 当 prompt 含 `"产品"` / `"ASIN"` / `"product"` / `"asin"` / `"卖"` 等词且已有商户匹配时，**确保**触发产品加载
- 即使 `dbLookupSkipPrompt()` 返回 true（如 "shokz products"），也检查是否有明确的商户+产品关键词组合

### 3.4 数据格式

`merchant_payload()` 返回的 `products` 数组每项：
```json
{
  "asin": "B0XXXXX",
  "productName": "Product Name",
  "price": "29.99",
  "bsr": "1500",
  "subCategoryBsr": "120",
  "category": "Electronics",
  "commissionRate": "10.0"
}
```

`monthlyAmazonMetrics` 按月聚合的产品级数据用于显示近期订单/revenue。

---

## 4. 历史趋势分析

### 4.1 用户场景

- "Shokz 过去 3 个月的 revenue 趋势"
- "Tier 2 的 EPC 趋势怎么样"
- "这个商户的订单量在增长还是下降"
- "哪些指标在变好"

### 4.2 LLM Skill 扩展

`skills/analysis.py`：

```python
_VALID_ANALYSIS_TYPES = ["merchant", "category", "tier", "trend"]

# 新增参数
"trendMetric": ParamDef(
    type="str",
    enum=["revenue", "orders", "epc", "aov", "conversionRate", "clicks", "commission"],
    required=False,
    description="Specific metric to show trend for, or omit for all key metrics",
),
```

新增示例对：

```python
ExamplePair(
    query="Shokz 过去3个月的revenue趋势",
    output={
        "intent": "analysis",
        "params": {"analysisType": "trend", "analysisTarget": "Shokz", "trendMetric": "revenue"},
    },
),
ExamplePair(
    query="Tier 2 这个季度的订单趋势",
    output={
        "intent": "analysis",
        "params": {"analysisType": "trend", "analysisTarget": "Tier 2", "trendMetric": "orders"},
    },
),
ExamplePair(
    query="这个商户的EPC在涨还是跌",
    output={
        "intent": "analysis",
        "params": {"analysisType": "trend", "analysisTarget": "Shop name", "trendMetric": "epc"},
    },
),
```

`analysis_text.py` 的 `AnalysisTextSkill` 新增 trend 场景的 fallback 文字模板。

### 4.3 异步数据加载

当前 `analysisAnswer()` 是同步函数。趋势分析需要异步 fetch，采用与 `fetchAnalysisText()` 相同的模式：

```javascript
function analysisAnswer(prompt, params, extra) {
  if (params.analysisType === "trend") {
    return renderTrendLoadingPlaceholder(prompt, params);
  }
  // ... 现有同步逻辑
}

async function renderTrendLoadingPlaceholder(prompt, params) {
  var html = "<div class=\"analysis-section\"><h4>Trend Analysis</h4><p><em>Loading trend data…</em></p></div>";
  setTimeout(async function() {
    // 1. 查找商户
    var offer = findOfferByMerchantName(params.analysisTarget);
    if (!offer) return showError();
    
    // 2. 取数据（从缓存或 API）
    var payload = await fetchMerchantMetrics(offer.merchantId);
    
    // 3. 计算趋势
    var summary = computeTrend(payload.monthlyAmazonMetrics, params.trendMetric);
    
    // 4. 替换占位内容
    replacePlaceholder(htmlId, renderTrendTable(summary));
  }, 0);
  
  return html;
}
```

### 4.4 趋势计算

`computeTrend(monthlyMetrics, trendMetric?)`：

```
输入: 按 month DESC 排序的月度指标数组
      每项: { month, orders, revenue, clicks, epc, aov, conversionRate, affiliatePayout }
      
处理:
  1. 按 month ASC 重新排序（旧 → 新）
  2. 如果 trendMetric 指定，只筛选该指标
  3. 对每个指标计算环比:
     - 当前月值 vs 上个月值
     - Δ绝对值 = current - previous
     - Δ百分比 = (current - previous) / previous * 100
  4. 标注方向: >0 → ↑, <0 → ↓, =0 → →
  5. 如果 trendMetric 未指定，显示 6 个核心指标

输出:
{
  type: "trend",
  target: "Shokz",
  months: [
    { month: "2026-05", revenue: 10000, orders: 1200, epc: 1.20, aov: 50, ... },
    { month: "2026-06", revenue: 12000, orders: 1500, epc: 1.10, aov: 48, ... },
    { month: "2026-07", revenue: 11000, orders: 1400, epc: 1.15, aov: 49, ... },
  ],
  deltas: {
    "2026-06": { revenue: { abs: 2000, pct: 20, dir: "up" }, ... },
    "2026-07": { revenue: { abs: -1000, pct: -8.3, dir: "down" }, ... },
  },
  summary: { /* 首尾对比: 整体趋势方向, 增幅/降幅 */ }
}
```

### 4.5 渲染

`renderTrendTable(summary)`：

```
<div class="analysis-section">
  <h4>趋势分析: Shokz</h4>
  <table class="analysis-table">
    <thead>
      <tr>
        <th>月份</th>
        <th>Revenue</th><th>Δ</th>
        <th>Orders</th><th>Δ</th>
        <th>EPC</th><th>Δ</th>
        <th>AOV</th><th>Δ</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>2026-05</td>
        <td>$10,000</td><td>–</td>
        <td>1,200</td><td>–</td>
        <td>$1.20</td><td>–</td>
        <td>$50</td><td>–</td>
      </tr>
      <tr>
        <td>2026-06</td>
        <td>$12,000</td><td class="up">+20% ↑</td>
        <td>1,500</td><td class="up">+25% ↑</td>
        <td>$1.10</td><td class="down">-8% ↓</td>
        <td>$48</td><td class="down">-4% ↓</td>
      </tr>
      ...
    </tbody>
  </table>
  <p class="trend-summary">
    Overall: Revenue +10% ↑, Orders +17% ↑, EPC -4% ↓, AOV -2% ↓
  </p>
</div>
```

CSS 新增 `.up`（绿色）、`.down`（红色）样式类。

### 4.6 降级策略

- 如果目标未找到 → 返回 "未找到 X 的数据"
- 如果 `monthlyAmazonMetrics` 为空或不足 2 个月 → 返回 "数据不足以分析趋势（需要至少 2 个月的数据）"
- 如果 API 调用失败 → 用 `mayRevenue`/`juneRevenue`（已在内存中）作 3 个月的 mini 趋势
- LLM 不可用时 → 前端正则检测趋势关键词（"趋势"、"trend"、"涨"、"跌"、"变化"、"增长"、"下降" 等）路由到 trend 路径

---

## 5. 实现清单

### 5.1 文件改动

| 文件 | 改动类型 | 预计行数 |
|------|---------|---------|
| `skills/analysis.py` | 修改 | ~15 行 |
| `skills/analysis_text.py` | 修改 | ~10 行 |
| `public/app.js` | 修改 | ~250 行 |
| `public/styles.css` | 修改 | ~15 行 |

### 5.2 不动的文件

- `offer_db.py` — 无需后端改动
- `api/db/index.py` — 无需新路由
- `server.py` — 无需新路由
- `llm_classify.py` / `llm_provider.py` — 无需改动
- `scripts/test_chatbot_intent_flow.mjs` — 等待实现完成后更新断言

---

## 6. 边界情况

| 场景 | 处理方式 |
|------|---------|
| 商户对比：其中一个未找到 | 只显示找到的那个，提示另一个未匹配 |
| 商户对比：两个都没找到 | 返回 "未找到指定商户" |
| 产品洞察：商户无产品数据 | 显示 "该商户暂无产品数据" 而不是空白 |
| 趋势分析：API 返回空数组 | 降级到内存数据（mayRevenue/juneRevenue）做 mini 趋势（3 个月） |
| 趋势分析：目标不是商户（品类/Tier） | 使用内存中每个 offer 的 mayRevenue/juneRevenue/salesAmount 聚合计算品类/Tier 级的合计趋势，仅覆盖 3 个月窗口 |
| 趋势分析：指定指标的商户没有该数据 | 跳过该指标，显示 "无数据" |
| 所有功能：LLM 不可用 | 前端正则检测触发，走降级路由 |
