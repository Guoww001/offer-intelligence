# Chat Mode 不同分析类型说明

> 更新日期：2026-08-17
>
> 适用范围：Chat Mode 的多轮数据问答，以及由 Report Mode 生成并加入记忆栏的结构化分析报告。

本文档说明 Chat Mode 面对不同分析问题时，能够看到哪些内容、使用什么数据、可以做什么比较，以及当前有哪些边界。

## 1. 先理解 Chat Mode 的数据边界

### 1.1 Chat Mode 与 Report Mode 的职责边界

Chat Mode 现在是一个只读数据分析 Agent。它会先由 LLM 规划是否需要取数，再在浏览器内执行允许的分析工具，最后由 LLM 综合工具结果。Report Mode 仍然负责完整结构化报告、Deep Window 和 Excel 导出。

当前 Agent 支持 7 个工具：单商户分析、单品类分析、多商户对比、单 Tier 分析、多品类对比、付款状态和趋势分析。ASIN、推荐、关键词、媒体、媒体画像、多 Tier 对比和写入型操作暂不属于 Agent 工具。

页面入口：Dashboard 下的 `Chatbot` 子页面保留原有 Report/Chat Mode、Deep Window 和记忆栏流程；Dashboard 下的 `Agent` 子页面提供独立的只读 Agent 对话，并维护独立的多轮会话历史。

独立 Agent 页面还会在每轮回复前展示可折叠的执行过程：规划查询、显示月份范围、执行数据工具、整理结果和最终状态。该区域只展示用户可理解的执行摘要与数据范围，不展示模型原始 Chain-of-Thought；成功后默认折叠，失败或用户停止时保持展开。

它的请求主要包含：

```text
用户问题
  + 对话历史 history
  + 记忆栏 memory（从 Report Mode 面板拖入的报告内容）
  -> 方法论/闲聊追问：/api/chat/stream（直接回答，不规划取数）
  -> 数据问题：/api/chat/agent（规划工具调用）
  -> 浏览器执行只读工具
  -> /api/chat/stream（基于工具结果综合）
```

因此：

- 没有记忆栏数据时，Agent 仍可以对当前缓存中的商户、品类、Tier 和付款数据执行支持的只读工具；记忆栏是已有 Report Mode 报告和多轮讨论的补充上下文，不再是取数前提。
- 商户 `merchant_analysis` 会在当前缓存汇总之外，复用 Report Mode 的月度接口读取最近 12 个月真实数据；其他静态工具主要使用页面加载的数据库缓存。趋势工具优先读取月度 DB 数据，无法取得真实月度数据时会返回 `estimated=true` 的估算结果。
- 商户月度数据不可用时，Agent 仍返回当前缓存分析，结果中的 `monthly` 为空且 `monthlyDataSource` 为 `unavailable`；这不代表当前汇总数据也不可用。
- `tier_analysis` 在 Tier 概览之外复用 Report Mode 的 Tier 行排序，返回 `merchants` 当前页和 `merchantList` 分页元数据；默认最多返回 100 个商户，`hasMore=true` 时必须通过下一页继续查询，不能把当前页当作完整 Tier 列表。
- 记忆栏传给 `/api/chat/stream` 的主要是面板 `textContent`，每份记忆最多截取 8000 个字符。它不是完整的结构化 summary，也不是完整 HTML 或完整数据库快照。
- 如果报告带有下载项，前端会额外保存 `reportSnapshot`，但这个快照主要用于本地推荐筛选和 View/Excel 导出，不会作为完整 JSON 直接发送给流式 LLM。
- 工具中的百分位、均值、差异和状态由现有前端分析函数计算，LLM 只负责选择工具和表述，不应重新计算或外推排名。
- “你是按什么指标推荐的”“推荐依据是什么”“你能做什么”等方法论、能力说明和礼貌追问直接走 `/api/chat/stream`，复用已有历史/记忆回答，不调用 `/api/chat/agent`；只有包含具体数据、商户、Tier、趋势、统计或列表请求时才进入规划。
- 如果 Agent 规划失败，系统会回退到原有单发流式路径；如果综合失败但工具已经成功，Chat Mode 会保留工具结果并显示确定性的 JSON 数据摘要。
- Agent 数据问题当前是固定的“规划 → 并行执行 → 综合”流程，不是无限 ReAct 循环；非数据追问走直接流式回答，也没有跨会话工具记忆或写入确认流程。

### 1.2 Chat Mode 的一个特殊路径：基于记忆报告的推荐

普通 Chat Mode 问答走 `/api/chat/stream`。但当用户提出“推荐、Top、筛选、导出”等列表型请求时，如果记忆栏中存在带导出快照的报告，前端会额外执行一次本地记忆推荐逻辑：

```text
记忆报告 reportSnapshot
  -> 仅在该报告快照内筛选
  -> 应用指标过滤、品类/Tier 条件和推荐排序
  -> 将选中的商户 ID 和顺序附加到 LLM 上下文
```

这条路径仍然不读取新的完整数据库，也不会把多个记忆报告合并成一个跨报告候选池。没有可用导出快照时，推荐状态可能是 `unavailable`、`ambiguous` 或 `empty`，不应把普通 LLM 文本回答当作已完成的结构化推荐。

相关实现：`api/chat/stream.py`、`public/app.js` 中的记忆栏提交逻辑和记忆推荐逻辑。`skills/analysis_text.py` 主要服务于 Report Mode 的结构化 summary → 分析文字流程，不是 Chat Mode `/api/chat/stream` 的强制规则引擎。

## 2. 分析类型总览

| 类型 | 典型问题 | Report Mode 结构化来源 | Chat Mode 可继续讨论的内容 |
| --- | --- | --- | --- |
| 单商户分析 | “分析 Shokz 表现” | `analyzeMerchant()` + 月度商户接口 | 指标、同品类百分位、均值对比、亮点/短板、Peer、付款风险、最近 12 个月真实月度明细（DB 可用时） |
| 多商户对比 | “Shokz 和 Soundcore 谁更好” | `analyzeMerchantComparison()` | 两个或多个商户的指标并列和差异 |
| 单品类分析 | “分析 Electronics 品类” | `analyzeCategory()` | 品类汇总、全站对比、Tier 分布、Top/Bottom 商户 |
| 多品类对比 | “比较 Electronics 和 Beauty” | `analyzeMultiCategory()` | 品类之间的总量、商户级平均值和差异 |
| 单 Tier 分析 | “Tier 2 整体表现如何 / Tier 2 有哪些商家” | `analyzeTier()` + `offersInTier()` | Tier 汇总、跨 Tier 对比、分段统计、异常值、按 Report Mode 排序的分页商家列表 |
| 多 Tier 对比 | “比较 Tier 1 和 Tier 2” | `analyzeMultiTier()` | Tier 之间的总量、平均值、商户数和品类分布 |
| 趋势分析 | “Shokz 最近三个月趋势” | `computeTrend()` + 月度数据 | 月度值、环比、首末期变化和趋势叙述 |
| 媒体记录 | “销售最高的 5 个媒体” | `renderPublisherRecordsHtml()` | 筛选结果、排序结果、完整筛选集合合计 |
| 媒体画像 | “查看媒体 1022 的画像” | `renderPublisherProfileHtml()` | 媒体 KPI、合作商家、品类偏好、AOV 和市场覆盖 |
| 推荐/筛选 | “推荐 Tier 2 的高 EPC 商户” | 推荐排序路径 | 过滤、排序、Top N 和下载结果 |
| 付款分析 | “哪些商户逾期未付款” | Payment 查询路径 | 付款状态、金额、月份和风险 |

表中的“结构化来源”表示 Report Mode 和 Agent 当前复用的前端分析路径。对于已接入 Agent 的 7 类工具，Chat Mode 会主动取数；媒体、ASIN、推荐等未接入工具仍需要 Report Mode 报告或记忆栏上下文，推荐列表请求另有“基于记忆导出快照的本地筛选”例外，见第 1.2 节。

## 3. 单商户分析

### 3.1 分析范围

单商户分析会找到一个目标 offer，并建立三组基准：

- 同品类商户：品类优先取 `mainCategory`，否则取 `category`。
- 同 Tier 商户：使用完全相同的 Tier 名称。
- 全站商户：当前前端 `offers` 集合中的全部商户。

品类匹配当前允许忽略大小写，并支持完全匹配或文本包含匹配。它可能把名称相近的扩展品类纳入比较，尚未完全切换到规范化 Category ID。

### 3.2 指标内容

结构化结果包含：

- EPC(Aff)
- AOV
- CVR
- Orders
- Clicks
- Aff Commission
- AFF Comm %
- Sales

当前分析口径：

```text
EPC(Aff) = affCommission / clicks
AFF Comm % = affCommission / salesAmount * 100
CVR = conversionRate * 100
```

### 3.3 比较与判断

- 质量指标会先应用样本门槛：EPC/CVR 至少 100 clicks；AOV/AFF Comm % 至少 10 orders。
- 百分位和平均值使用相同的商户级归一化值、相同的合格商户集合。
- 百分位达到 70 及以上时进入亮点；30 及以下时进入短板。
- 样本不足时仍展示当前值，但不计算百分位，也不进入亮点或短板。
- Peer 是同品类、同 Tier 中按 `affCommission` 降序取前 3 个商户。
- 付款风险单独展示，不混入综合健康分。
- Agent 结果中的 `metrics` 仍是当前缓存商户汇总；`monthly` 是按最新月份在前排列的真实 DB 月度行，包含 Revenue、AOV、EPC(All)、EPC(Aff)、CVR、Commission、Orders、Clicks、DPV 和 ATC。
- 如果自然语言综合只引用最新月份，Agent 会从同一份工具结果中补回完整 `monthly` 表，避免最终回答退化为当月快照。
- `monthly` 为空时不生成估算月度值；估算只属于独立的 `trend` 工具降级路径。

详细口径见：[Chat Mode 商户分析相对比较规则](chatbot-analysis-comparison-rules.md)。

### 3.4 Chat Mode 可以继续追问什么

在报告加入记忆栏后，可以继续询问：

- “它的 EPC 为什么低于品类均值？”
- “这个商户更适合提升订单还是提升转化？”
- “它和 Peer 的差距主要在哪里？”
- “样本量是否足以支持这个判断？”

Chat Mode 会依据记忆栏中的 summary、表格和对比字段回答；如果记忆中没有完整 Peer 列表或原始商户集合，不能保证重新计算出新的排名。

## 4. 多商户对比

### 4.1 当前内容

明确提到两个或多个商户时，系统会生成并列对比：

- EPC(Aff)
- AOV
- CVR
- Orders
- Clicks
- Aff Commission
- AFF Comm %
- Sales

两商户场景会计算第一参考商户与第二商户的差异百分比，并标记上升、下降或持平。

### 4.2 与单商户分析的差异

当前多商户对比主要是目标商户之间的直接比较：

- 不自动增加同品类平均值。
- 不自动增加同品类百分位。
- 不自动增加同品类样本分布。
- 不会自动判断谁更适合升 Tier。

如果用户需要“相对各自品类表现”，需要分别生成两个单商户分析报告，或后续扩展多商户对比 summary。

实现核查补充：多商户结构化 summary 还保留 `Clicks` 和 `Sales`，但当前可见对比表主要渲染 EPC、AOV、CVR、Orders、Aff Commission 和 AFF Comm %；因此“结构化结果包含的字段”和“用户当前能看到的字段”并不完全相同。

## 5. 单品类分析

### 5.1 分析范围

单品类分析使用该品类下的 offer 集合，默认包含所有 Tier。输出包括：

- 商户数量
- 总 Sales
- 总 Aff Commission
- 总 Orders
- 平均 EPC(Aff)
- 平均 AOV
- 平均 CVR
- 平均 AFF Comm %
- 各 Tier 商户数量分布
- 品类与全站平均值的差异
- 按 Aff Commission 排序的 Top 5 商户
- 按 Aff Commission 排序的 Bottom 3 商户

### 5.2 统计规则

- EPC、CVR、AOV 和 AFF Comm % 的平均值复用统一分析 helper。
- 质量指标平均值会应用 100 clicks 或 10 orders 的样本资格。
- 总 Sales、总 Commission、总 Orders 是数量汇总，不因质量样本门槛隐藏。
- Top/Bottom 的排序指标是 `affCommission`，不是 EPC 或销售额。
- 单品类分析没有商户级百分位，也没有品类健康总分。

实现核查补充：`analyzeCategory()` 会计算 `bottomMerchants`，但当前 `renderCategoryAnalysisTable()` 只渲染 Top 5，Bottom 3 尚未出现在可见报告表格中。除非后续补充渲染逻辑，否则不应把 Bottom 3 描述为当前用户一定能看到的输出。

### 5.3 Chat Mode 的适合追问

- “这个品类的主要问题是流量、转化还是订单？”
- “Top 商户和 Bottom 商户差在哪里？”
- “这个品类是否集中在某个 Tier？”
- “这个品类相对于全站的优势是什么？”

回答仍然受记忆栏中报告内容的限制。如果只拖入一个品类摘要，没有拖入完整商户明细，Chat Mode 只能做摘要层面的解释。

## 6. 多品类对比

### 6.1 内容

比较多个品类时，每个品类分别计算：

- 商户数量
- 总 Sales
- 总 Commission
- 总 Orders
- 平均 EPC(Aff)
- 平均 AOV
- 平均 CVR
- 平均 AFF Comm %
- Top 5 商户

如果问题中指定 Tier，会先把每个品类限制在该 Tier 内。

### 6.2 重点差异

当前渲染层重点突出：

- 订单量差异
- 平均 EPC(Aff) 差异
- 平均 AOV 差异
- 商户数量差异

多品类对比没有品类百分位，也没有把不同指标合成为综合分数。平均值是商户级算术平均，不是将所有品类的收入或点击直接混合后计算一个加权指标。

## 7. 单 Tier 分析

### 7.1 内容

单 Tier 分析使用该 Tier 下的商户集合，输出：

- 商户数量
- 总 Sales、总 Commission、总 Orders
- 平均 EPC(Aff)、AOV、CVR、AFF Comm %
- 与其他 Tier 的指标对比
- 按 Aff Commission 的 Head/Mid/Tail 分段统计
- EPC 或 CVR 明显高于 Tier 均值的异常商户

### 7.2 分段与异常规则

- Head：按 Aff Commission 从高到低的前 20%。
- Tail：最后 20%。
- Mid：中间商户。
- EPC 异常：商户 EPC 大于 Tier 平均 EPC 的 3 倍。
- CVR 异常：商户 CVR 大于 Tier 平均 CVR 的 2 倍。
- 异常结果最多展示 5 个。

Agent 的 `tier_analysis` 还返回：

- `merchants`：当前页的商家名、Merchant ID、Tier、品类和核心指标。
- `merchantList`：`total`、`offset`、`limit`、`returned`、`hasMore`，用于说明当前页是否已经覆盖整个 Tier。
- 默认页大小为 100，最大页大小为 100；Tier 1/2 等规模较小的层级通常可以一页返回，较大的 Tier 需要按 `offset` 继续查询。

异常规则是诊断提示，不是升 Tier 或降 Tier 的正式决策规则。

实现核查补充：当前异常值判断没有额外应用 EPC 的 100 Clicks 或 CVR 的 100 Clicks 样本门槛；低样本商户仍可能触发异常提示。Head/Mid/Tail 在商户数量很少时也不是严格的 20%/60%/20%，因为实现会保证 Head 和 Tail 至少各有 1 个商户。单 Tier 概览结构化结果包含平均 AFF Comm %，但当前可见 Tier 概览表没有单独展示该字段。

## 8. 多 Tier 对比

### 8.1 内容

比较多个 Tier 时，每个 Tier 分别计算：

- 商户数量
- 总 Sales、总 Commission、总 Orders
- 平均 EPC(Aff)、AOV、CVR、AFF Comm %
- Top 5 商户
- Tier 内部的品类分布

也可以附加品类过滤，只比较某个品类下的多个 Tier。

### 8.2 限制

- 当前重点是描述 Tier 之间的数据差异，不是自动生成 Tier 迁移结论。
- Tier 之间的比较不包含商户级百分位。
- “Tier 1 指标更高”不等于系统自动建议所有商户升到 Tier 1。
- 是否升降 Tier 仍需结合 Tier Sheet 的业务规则、人工判断和视觉状态。

实现核查补充：多 Tier summary 会计算平均 AFF Comm %，但当前可见多 Tier 对比表没有单独展示 Commission Rate；这与单 Tier 和多 Tier 结构化结果字段完整、界面字段不完全完整的情况一致。

## 9. 趋势分析

### 9.1 支持的实体

趋势支持：

- 商户趋势
- 品类趋势
- Tier 趋势

趋势请求可以指定时间范围和单一指标，例如“最近 3 个月的 revenue 趋势”。如果不指定指标，默认显示多个核心指标：Revenue、Orders、EPC、AOV、Clicks、Affiliate Payout、DPV、ATC 和 CVR。

### 9.2 数据来源

趋势优先从 DB 获取月度数据：

- 商户：按 Merchant ID 查询月度数据。
- 品类：获取该品类全部商户的月度数据后按月份聚合。
- Tier：获取该 Tier 全部商户的月度数据后按月份聚合。

品类趋势默认排除 Tier 4 和 BLACK TIER；这与单品类静态分析的全 Tier 口径不同。

### 9.3 计算内容

每个月计算：

- Revenue
- Orders
- Clicks
- Affiliate Payout
- Affiliate EPC
- AOV

然后计算：

- 月环比变化
- 首月到末月的绝对变化
- 首月到末月的百分比变化
- Up / Down / Flat 方向

趋势 EPC 使用 Affiliate Payout / Clicks，趋势 AOV 使用 Revenue / Orders。

### 9.4 数据不足时

- 至少需要 2 个月数据才能形成趋势。
- DB 月度数据不可用时，商户和聚合趋势可能使用当前汇总数据平均分配到月份的估算结果。
- 估算趋势不是真实月度表现，只能作为方向性参考，界面会标记为估算或提示数据不足。
- 趋势本身比较时间变化，不计算同品类百分位。

实现核查补充：商户趋势可以从月度数据取得 DPV、ATC 和 CVR 等字段；但当前品类/Tier 聚合函数主要聚合 Revenue、Orders、Clicks、Payout 和 Affiliate Payout，DPV、ATC、CVR 不一定有真实的聚合月度值。趋势界面虽然有这些指标选项，实际显示前应确认数据源是否提供了对应字段。

## 10. 媒体记录分析

媒体记录查询使用 `publisher:` 路径，重点是筛选和排序，而不是媒体健康评分。

### 10.1 支持的筛选

- 市场
- 联盟
- 商家
- 经理

### 10.2 支持的排序

- Sales
- All Commission
- Aff Commission
- Orders
- Clicks
- CVR
- DPV
- ATC
- Gross Profit

其中：

```text
CVR = orders / clicks
Gross Profit = allCommission - affCommission
```

筛选后的完整结果会用于合计，前 N 条只限制明细展示。当前没有媒体百分位、同类媒体平均值、样本门槛或综合健康分。

## 11. 媒体画像分析

媒体画像使用 `publisherprofile:` 路径，分析一个媒体合作商家的组合特征。

### 11.1 输出内容

- 媒体级 Clicks、DPV、ATC、Orders、Sales、Commission
- 活跃商家数
- AOV：总 Sales / 总 Orders
- Top 品类及销售占比
- 按销售额加权的 AFF Commission Rate
- 典型 AOV 区间
- 品类集中度
- 市场覆盖数量
- 合作商家明细：品类、Tier、AOV、EPC、CVR、Rate、Orders、Sales、AFF Commission 和销售份额

### 11.2 当前口径限制

- 活跃商家只要 Clicks、DPV、ATC、Orders、Sales、All Commission 或 Aff Commission 中任一项大于 0 即纳入。
- 品类偏好按销售额排序，不是按商户数量排序。
- 合作商家明细设计上希望按 Sales 降序；但当前 Chat Mode 媒体画像的 `publisherProfileRowsForMarket()` 只做活跃过滤，没有显式按 Sales 排序，因此实际顺序不能保证。
- 当前 Publisher 数据路径使用 `75% × All Commission` 推算 Affiliate Commission；这与商户分析直接使用 `affCommission` 的路径不同。
- 媒体画像没有媒体之间的百分位或 Peer 对比。

因此，媒体画像适合回答“这个媒体偏好什么样的商家和品类”，不适合直接回答“这个媒体相对其他媒体处于第几名”。

## 12. 推荐、付款和 ASIN：相关但不是同一套分析

### 12.1 推荐/筛选

推荐路径用于“推荐、Top、最佳、重点投入”等请求，使用 Tier、Orders、Clicks、CVR、EPC、Sales、ATC、Discount、ASIN、付款风险和 Tracking Issue 等信号排序。

推荐排序不是商户健康分，也不等同于商户分析中的百分位规则。推荐结果适合回答“优先看谁”，不适合解释“这个商户在同品类中的统计位置”。

### 12.2 付款

付款分析关注：

- Paid、Pending、Unpaid、Overdue、Partial
- 付款月份
- 应付金额和未付金额
- 付款周期

付款月份未指定年份时按当前日历年解释，例如当前年份为 2026 时，“6月份”对应 `2026-06`；只有用户明确写出 `2025年6月` 等历史年份时才查询历史月份。

付款风险可以作为商户分析的独立关注项，但不会直接改变 EPC、CVR 或百分位。

### 12.3 ASIN

ASIN 查询主要用于定位商品所属商户、商品信息和相关 offer，不属于商户/品类/Tier 的统计比较分析。

## 13. Chat Mode 如何使用这些分析结果

推荐使用以下两种流程：

```text
直接数据问题
  -> 切换 Chat Mode
  -> Agent 规划并执行只读工具
  -> 查看流式综合回答或 View

已有报告的深度追问
Report Mode 生成结构化报告
  -> 点击“加入对话”或将最小化面板拖入记忆栏
  -> 切换 Chat Mode
  -> 针对记忆中的报告追问
```

适合的追问方式：

- 解释：为什么这个指标高/低？
- 对比：两个报告中的商户或品类有什么差异？
- 决策：下一步应该优先优化什么？
- 复盘：哪些结论有足够样本，哪些需要谨慎？
- 规划：根据当前表现制定下个月的运营重点。

Chat Mode 可以综合多张记忆报告，也可以对 Agent 已支持的当前缓存数据执行工具。Tier 商家列表现在可以直接由 Agent 分页获取；记忆栏仍适合保存 Report Mode 的完整报告、补充 Agent 未覆盖的领域，或作为后续追问的明确依据。

## 14. 当前最重要的口径差异

| 场景 | 当前主要口径 | 需要注意 |
| --- | --- | --- |
| 商户/品类/Tier 静态分析 | 商户级归一化平均值 | 质量指标有样本门槛 |
| 商户单体百分位 | 同品类可比商户集合 | 样本不足不判强弱 |
| 多商户对比 | 目标商户直接并列 | 不自动附加同品类基准 |
| 品类趋势 | 月度数据聚合 | 排除 Tier 4/BLACK |
| 媒体记录 | 筛选后排序和合计 | 没有媒体健康分 |
| 媒体画像 | 合作组合画像 | Affiliate Commission 当前存在 75% 推算口径 |
| 推荐 | 多信号排序 | 不是健康分或百分位 |
| Chat Mode | Agent 工具 + 记忆栏 + 对话历史 | 工具范围受限，静态数据通常来自缓存，趋势可能是估算 |

## 15. 后续调整建议

如果要让所有分析类型使用一致的比较体系，建议按以下顺序处理：

1. 将 Publisher Profile 的 Affiliate Commission 改为直接使用真实 `affCommission`，取消固定 75% 推算。
2. 为媒体增加同市场、同网络或同时间范围的比较基准、样本量和百分位。
3. 为多商户对比增加各自品类均值、百分位和样本状态。
4. 明确品类静态分析与品类趋势的 Tier 范围，避免一个默认全量、一个默认排除 Tier 4/BLACK。
5. 将所有比较规则集中到独立配置或 helper，避免商户、品类、Tier、媒体各自维护一套公式。
6. 在 Chat Mode 记忆栏中显示数据时间、样本量、比较范围和口径标签，让 LLM 能明确知道结论的适用范围。
