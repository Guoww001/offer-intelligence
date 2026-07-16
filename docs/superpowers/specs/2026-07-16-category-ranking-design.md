# 推荐品类排名功能设计

> 日期：2026-07-16 · 分支：`main`

## 1. 概述

为 YeahPromos Offer Intelligence 聊天机器人增加「推荐品类排名」功能。当用户询问"recommended categories"或"推荐品类"等类似问题时，机器人按综合评分对品类进行排名，展示 Top 5 品类，每个品类下展示 Top 5 推荐 offer，并支持用户后续追问品类详情。

## 2. 检测机制

采用 **LLM 参数优先 + 正则降级** 的双层检测策略。

### 2.1 LLM 参数路由

在 `RecommendationSkill` 中新增参数 `recommendCategories`（`bool` 类型）。当 LLM 识别到用户想了解推荐品类排名时，返回：

```json
{"intent": "recommendation", "params": {"recommendCategories": true}}
```

LLM 的 few-shot 示例中增加对应样例，帮助模型准确识别"推荐品类"类查询。

### 2.2 正则降级兜底

当前端 LLM 分类失败或未返回 `recommendCategories` 参数时，在 `answerPrompt()` 中检测查询文本：

- `hasCategoryIntentText(text)` 为 true（包含 category/categories/品类/类别/类目 等）
- `wantsRecommendation` 为 true（有推荐意图）
- 未提取到具体品类名（`categories.length === 0`）
- 未指定 tier/无 metricFilter/无 metricSort

满足以上条件时，路由到品类排名路径。

### 2.3 优先级

```
answerPrompt() 路由顺序:
1. tierOfferPlan → recommendationBundleAnswer
2. 推荐包排除/替换
3. recommendCategories === true → recommendedCategoriesAnswer()
4. ASIN / merchant / paymentCycle / contextFollowup
5. analysis / keywordSearch / topMetric
6. payment
7. wantsRecommendation + 品类排名关键词 → recommendedCategoriesAnswer()
8. wantsRecommendation → 原有推荐路径
...
```

## 3. 品类综合评分公式

评分偏重**营收和佣金**，计算公式如下：

```
categoryScore(category):
  offers = offersInCategory(category)
  totalRevenue = sum(offers.salesAmount)
  totalCommission = sum(offers.affCommission)
  totalOrders = sum(offers.orders)
  offerCount = offers.length
  avgAov = totalRevenue / max(totalOrders, 1)
  blendedEpc = totalCommission / max(sum(offers.clicks), 1)
  tier1Count = count(offers where tier === "Tier 1")
  coreTier2Count = count(offers where tier === "Tier 2" AND highlightStatus !== "Optimization only")
  paymentRiskCount = count(offers where hasPaymentRisk)

  score =
    + log(totalRevenue + 1) * 25
    + log(totalCommission + 1) * 20
    + log(offerCount + 1) * 10
    + log(totalOrders + 1) * 8
    + min(avgAov, 500) / 15
    + min(blendedEpc, 5) * 20
    + (tier1Count + coreTier2Count) * 3
    - (paymentRiskCount / max(offerCount, 1)) * 15

  return round(score)
```

得分范围通常在 0-150 之间，用于品类间排序。

## 4. 渲染设计

### 4.1 聊天消息格式

按「分区标题 + Offer 列表」格式渲染：

```
━━━ 📊 推荐品类排名 Top 5 ━━━

🏆 1. Beauty（综合分: 92）
Offer数: 45 | 总营收: $1.2M | 总佣金: $180K | 平均AOV: $85 | Blended EPC: $1.20
Top 5 推荐:
├─ 1. Brand A (Tier 1) | AOV $120 | EPC $1.80 | CVR 12.0% | Orders 2.4K | Revenue $85K
├─ 2. Brand B (Tier 2) | AOV $95 | EPC $1.50 | CVR 8.5% | Orders 1.8K | Revenue $62K
└─ … (共5个)

🥈 2. Electronics（综合分: 78）
...

💡 提示: 输入「beauty 的更多推荐」或「展开 electronics」查看品类详情
```

### 4.2 渲染函数

| 函数 | 用途 |
|------|------|
| `categoryRankingScore(category)` | 计算单个品类的综合评分 |
| `computeCategoryRankings()` | 遍历所有品类，计算排名列表 |
| `renderCategoryRankingHtml(categoryRankings)` | 渲染品类排名列表 HTML |
| `renderCategoryOfferRow(offer, index)` | 渲染单个 offer 行 |
| `recommendedCategoriesAnswer(prompt)` | 主入口：计算排名 → 渲染 → 设置上下文 |

### 4.3 上下文设置

渲染品类排名后，保存 `state.lastCategoryRanking`，包含：
- `rankings`: 完整品类排名数组
- `topCategories`: Top 5 品类名
- `offersByCategory`: 每个品类的 offer 列表

### 4.4 统计卡片（上下文面板）

设置 `context.type = "recommendation"`，展示品类排名概览：
- Top 品类数
- 覆盖 offer 总数
- 总营收/总佣金
- 最佳品类名称

## 5. 追问支持

用户看到排名后可继续追问某个品类详情。

### 5.1 检测机制

在 `answerPrompt()` 中，当未命中其他路由且 `state.lastCategoryRanking` 存在时，用 `categoryForPrompt(text)` 检测用户是否提到了某个排名中的品类名。

### 5.2 回答生成

匹配到品类后，调用 `sortedForCategory([category], { includeTier4: true, includeBlack: true })` 获取该品类的排序 offer 列表，然后用 `recommendationHtml()` 渲染推荐结果。

### 5.3 追问示例

```
用户: "展开 beauty"
→ 检测到 state.lastCategoryRanking 存在，品类 "Beauty" 在排名中
→ sortedForCategory(["Beauty"]) → recommendationHtml()
→ 展示 Beauty 品类的详细推荐排名
```

## 6. 需要修改的文件

| 文件 | 改动说明 |
|------|----------|
| `skills/recommendation.py` | 新增 `recommendCategories` 参数定义；新增 few-shot 示例 |
| `public/app.js` | 新增 `categoryRankingScore()`, `computeCategoryRankings()`, `renderCategoryRankingHtml()`, `renderCategoryOfferRow()`, `recommendedCategoriesAnswer()`；修改 `answerPrompt()` 增加路由；增加追问支持 |
| `llm_classify.py` (可选) | 在全局规则中增加"推荐品类"的说明 |

## 7. 不涉及修改的文件

- `chatbot_i18n.js` — 无需新增翻译，复用现有 `COPY` 和 `LABELS_ZH`
- `styles.css` — 复用现有的 `.recommendation-answer`、`.context-stats`、`.mini-table` 等样式
- `server.py` / `api/chat/*` — 后端无改动
- `skills/base.py` / 其他 skill 文件 — 无改动
- 数据构建脚本 — 无改动

## 8. 边界情况处理

| 场景 | 处理方式 |
|------|----------|
| 品类数少于 5 个 | 展示所有品类，不填充 | 
| 某品类 offer 数少于 5 个 | 展示该品类所有 offer |
| 两个品类综合分相同 | 按品类名字母序排列 |
| 无任何品类数据 | 返回 "当前数据中没有找到品类信息" |
| LLM 返回 `recommendCategories` 但同时也指定了具体品类 | 忽略 `recommendCategories`，走原有品类推荐路径 |
| 追问时品类名不在排名中 | 仍然走正常的 `sortedForCategory` + `recommendationHtml` 路径 |
