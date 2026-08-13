# Chat Mode 商户分析相对比较规则

> 状态：当前实现记录
>
> 更新日期：2026-08-13
>
> 适用范围：Chat Mode 中的商户分析，例如“分析 Shokz”“Shokz 表现怎么样”。

本文档记录当前代码实际使用的比较口径，方便后续调整。它不是未来业务标准，也不代表行业基准。

## 1. 结论

当前 Chat Mode 使用的是相对比较规则，而不是一个统一的综合健康分：

1. 将商户与同品类商户进行百分位比较。
2. 将商户与品类、Tier、全站的平均值进行比较。
3. 展示同品类、同 Tier 的高佣金 Peer。
4. 对 EPC、CVR、AOV、Commission Rate 等质量指标检查最小样本量。
5. 单独检查付款风险。
6. 由 LLM 将结构化结果改写成自然语言；LLM 不负责建立新的指标标准。

当前分析不会根据这些指标自动判定商户应该升 Tier 或降 Tier。

## 2. 分析流程

```text
用户问题
  -> analysisAnswer()
  -> analyzeMerchant()
  -> 生成结构化 summary
  -> 立即渲染分析表格
  -> POST /api/chat/analyze
  -> LLM 生成分析文字
```

主要代码位置：

| 函数 | 当前文件位置 | 作用 |
| --- | --- | --- |
| `analysisAnswer()` | `public/app.js` | 分析请求入口与路由 |
| `findOfferByMerchantName()` | `public/app.js` | 找到商户记录 |
| `globalAverages()` | `public/app.js` | 计算全站平均值 |
| `analyzeMerchant()` | `public/app.js` | 计算商户指标、百分位、横向比较和 Peer |
| `percentileRank()` | `public/app.js` | 计算同品类百分位 |
| `renderMerchantAnalysisTable()` | `public/app.js` | 渲染分析表格 |
| `fallbackAnalysisText()` | `public/app.js` | LLM 不可用时的模板文字 |
| `AnalysisTextSkill` | `skills/analysis_text.py` | 根据 summary 生成自然语言 |

当前核心分析使用页面加载时的 `offers` 数据集合。`loadLiveChatbotData()` 维护的 `_liveChatbotOffers` 主要用于实时商户上下文和趋势路径；后续如果需要保证商户分析也使用实时数据，应明确改造数据源。

## 3. 比较范围

### 3.1 当前商户

通过商户名称或 Merchant ID 查找第一个匹配的 offer。商户分析的目标记录来自 `findOfferByMerchantName()`。

### 3.2 同品类商户

品类取值优先级为：

```text
offer.mainCategory || offer.category
```

当前匹配规则是忽略大小写后：

- 完全相等，或
- 品类文本包含用户指定的品类文本。

因此，品类比较可能包含名称中带有目标文本的扩展品类，后续如需严格品类比较，应改为精确匹配或使用规范化的 Category ID。

### 3.3 同 Tier 商户

使用与当前记录完全相同的 Tier 名称，例如 `Tier 1`。

### 3.4 全站商户

使用当前前端 `offers` 数组中的全部商户记录。

## 4. 指标与公式

### 4.1 商户自身指标

商户分析使用以下 8 个字段：

```text
epc, aov, conversionRate, orders,
clicks, affCommission, commissionRate, salesAmount
```

其中：

| 指标 | 当前商户值 |
| --- | --- |
| EPC(Aff) | `affCommission / clicks`，统一为 Affiliate EPC |
| AOV | `offer.aov` |
| CVR | `offer.conversionRate * 100` |
| Orders | `offer.orders` |
| Clicks | `offer.clicks` |
| Commission | `offer.affCommission` |
| AFF Comm % | `affCommission / salesAmount * 100`，统一为百分比数值 |
| Sales | `offer.salesAmount` |

### 4.2 分组平均值

所有分组平均值都先将每个商户转换为分析专用的归一化值，再对满足该指标样本条件的可比商户做算术平均：

| 指标 | 品类 / Tier 分组平均值 | 全站平均值 |
| --- | --- | --- |
| EPC(Aff) | 对每个商户计算 `affCommission / clicks`，再对可比商户算术平均 | 同左 |
| AOV | 对每个商户使用 `offer.aov`，再对可比商户算术平均 | 同左 |
| CVR | 对每个商户使用 `conversionRate * 100`，再对可比商户算术平均 | 同左 |
| AFF Comm % | 对每个商户计算 `affCommission / salesAmount * 100`，再对可比商户算术平均 | 同左 |
| Orders / Clicks / Commission / Sales | 对每个商户使用归一化字段值算术平均，合法的 0 值保留 | 同左 |

平均值和百分位现在使用相同的归一化指标值、相同的样本资格和相同的可比商户集合。

### 4.3 差异百分比

当对比值不为 0 时：

```text
delta = (当前值 - 对比值) / abs(对比值) * 100%
```

当对比值为 0 时，显示 `N/A`。

## 5. 百分位与亮点/短板

百分位不是加权指标。质量指标会先检查最小样本量，样本不足时不生成百分位结论。

```text
countLower = 同一可比商户集合中小于当前值的记录数
percentile = round(countLower / 同一可比商户集合记录数 * 100)
```

“同一可比商户集合”会同时应用指标值有效性和该指标的最小样本门槛；因此低点击或低订单商户不会进入相应质量指标的百分位分母。

当前样本门槛：

| 指标 | 样本字段 | 最小值 |
| --- | --- | ---: |
| EPC(Aff)、CVR | Clicks | 100 |
| AOV、AFF Comm % | Orders | 10 |
| Orders、Clicks、Commission、Sales | 无额外门槛 | — |

样本不足的指标仍会显示当前数值，但 `percentile` 为不可用状态，不会进入亮点或短板列表。

当前标签阈值：

| 条件 | 结果 |
| --- | --- |
| `percentile >= 70` | 亮点 / Strength |
| `percentile <= 30` | 短板 / Weakness |
| 31–69 | 不标记为亮点或短板 |

注意：百分位和平均值都按商户级归一化值计算，因此不会再因为“商户百分位”与“汇总加权平均”使用不同统计对象而产生口径冲突。

## 6. 商户分析展示内容

商户分析表格当前展示：

1. 核心指标：EPC(Aff)、AOV、CVR、Orders、Aff Commission、AFF Comm %。
2. 横向对比：当前值、品类均值、差异百分比。
3. 亮点和短板：根据同品类百分位阈值生成。
4. 付款状态：显示付款风险文字。
5. Peer Comparison：当前品类 + 当前 Tier 中，按 `affCommission` 降序取前 3 个商户。

结构化 summary 仍会保留 `vsCategory`、`vsTier` 和 `vsGlobal` 三组比较，LLM 可能使用这些数据生成文字，但当前表格主要展示 `vsCategory`。

## 7. LLM 的职责边界

`skills/analysis_text.py` 要求 LLM：

- 只使用传入的结构化 summary。
- 给出总体判断、亮点、关注点和 2–3 条建议。
- 使用实际数值和已有对比值。
- 缺少数据时跳过该判断。
- 不自行创建行业阈值或虚构数字。

因此，调整比较标准时，优先修改前端 summary 的计算逻辑；只修改 LLM 提示词不能真正改变比较结果。

## 8. 与推荐排序的区别

`recommendationScore()` 是另一条路径，用于“推荐、Top、最佳商户”等请求，不等同于商户分析标准。

推荐排序会额外考虑：

- Tier 优先级。
- Orders、Clicks、CVR、EPC、Sales、ATC。
- Discount、ASIN、Recommended Link 等数据完备性或可推广信号。
- 付款风险、Tracking Issue。
- 部分低样本量惩罚。

后续如果要建立“升 Tier / 降 Tier”标准，应单独定义决策规则，不应直接把推荐排序分数当作商户健康分。

## 9. 当前已知口径问题

### 9.1 EPC 口径

商户分析现在明确使用 Affiliate EPC：

```text
EPC(Aff) = affCommission / clicks
```

All EPC 仍可在其他商户卡片或 Top 表中单独展示，但不参与这条商户分析比较规则。

### 9.2 Commission Rate 单位

商户分析现在明确使用 Affiliate Commission Rate：

```text
AFF Comm % = affCommission / salesAmount * 100
```

显示和比较统一使用百分比数值，例如 `7.5` 表示 `7.5%`。数据缺少联盟佣金金额时，才从 `affCommissionRate` 或原有 `commissionRate` 字段归一化后作为回退值。

### 9.3 当前没有综合健康分

目前没有将 EPC、CVR、AOV、订单、佣金等指标按照权重合成一个总分，也没有固定的绝对阈值，例如“EPC 大于多少就是优秀”。

### 9.4 当前样本量处理

质量指标已经增加最小样本量门槛：EPC/CVR 至少 100 clicks，AOV/Commission Rate 至少 10 orders。该门槛用于避免低样本商户被直接标记为亮点或短板，但目前还不是统计置信区间或自动升降级规则。

## 10. 后续调整清单

每次调整比较标准时，应同步确认：

- [ ] 比较范围：同品类、同 Tier、全站是否仍然适用。
- [ ] 品类匹配：包含匹配还是规范化后的精确匹配。
- [x] 指标定义：EPC 使用 Affiliate EPC，Commission Rate 使用 Affiliate 百分比。
- [x] 平均值：与百分位使用同一商户级归一化值和同一可比集合。
- [ ] 零值处理：零点击、零订单和缺失值是否排除。
- [x] 百分位阈值：亮点和短板仍为 70 / 30。
- [x] 样本量：EPC/CVR 使用 100 clicks，AOV/Commission Rate 使用 10 orders。
- [ ] UI：核心指标表、亮点/短板、Peer 表是否需要同步调整。
- [ ] LLM：`skills/analysis_text.py` 是否仍能正确解释新的 summary 字段。
- [ ] 测试：为公式、边界值、缺失值和口径一致性补充回归测试。

## 11. 相关文件

- [Chatbot 完整档案](chatbot-feature-report.md)
- [`public/app.js`](../public/app.js)
- [`skills/analysis_text.py`](../skills/analysis_text.py)
- [`offer_db.py`](../offer_db.py)
- [`protected_data/db_offers_cache.json`](../protected_data/db_offers_cache.json)
