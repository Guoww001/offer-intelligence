# Chatbot 完整档案

> 更新日期：2026-08-17 · 分支：`main`

## 1. 概述

YeahPromos Offer Intelligence 内建了一个对话式 AI 助手，支持中英双语，覆盖商户查询、品类搜索、推荐排名、支付追踪、Tier 管理和数据分析。系统采用 **LLM 意图分类 + 规则引擎回答生成** 的混合架构，所有数据在页面加载时一次性载入前端内存，回答生成零网络延迟。

> Chat Mode Agent（工具调用）设计与实现见 `docs/superpowers/specs/2026-08-14-chat-mode-agent-design.md` 与 `docs/superpowers/plans/2026-08-14-chat-mode-agent.md`。

> Phase 2（2026-08-14）：Agent 工具扩展至 5 个 —— `merchant_comparison`/`tier_analysis`/`category_comparison`/`payment_status`/`trend`（多 Tier 对比未纳入）。

> Agent v1 稳定化（2026-08-17）：对比工具保留多实体差异，品类和付款工具拒绝不完整匹配，规划端限制为 7 个只读工具；自然语言综合失败时保留已完成工具数据。

> Agent 商户月度数据迁移（2026-08-17）：`merchant_analysis` 复用 Report Mode 的 `/api/ui/db/merchant` 月度接口，返回最近 12 个月真实 `monthly` 明细；数据库月度数据不可用时保留当前缓存汇总并返回空月度数组。

> Agent Tier 商家列表迁移（2026-08-17）：`tier_analysis` 保留 `analyzeTier()` 的概览，同时复用 Report Mode `tiers.length` 路径的 `offersInTier()` + `compareRecommendationOffers()` 排序，返回默认最多 100 个 `merchants` 行和 `merchantList` 分页元数据；较大的 Tier 通过 `offset/limit` 继续查询。

> Dashboard 子页面拆分（2026-08-17）：Dashboard 下提供独立的 `Chatbot` 和 `Agent` 子页面。`Chatbot` 保留原有 Report/Chat Mode 与 Deep Window 流程；`Agent` 使用独立聊天记录，只复用 `runChatAgent()` 的只读工具链。

> Agent 执行过程时间线（2026-08-17）：独立 Agent 页面以可折叠的执行摘要展示规划、工具查询、月度范围、结果整理和最终状态；不展示模型原始 Chain-of-Thought。执行中的请求支持通过 `AbortController` 停止，成功完成后时间线默认折叠，失败或停止时保持展开。

> Chat Mode 商户分析的当前相对比较口径单独记录在 [Chat Mode 商户分析相对比较规则](chatbot-analysis-comparison-rules.md)，包括比较范围、指标公式、百分位阈值和已知口径问题。
>
> Chat Mode 面对商户、品类、Tier、趋势和媒体等不同分析类型的内容与边界，见 [Chat Mode 不同分析类型说明](chat-mode-analysis-types.md)。

---

## 2. 完整请求流程

> 本节描述 Report Mode 的意图分类和结构化回答主流程。Chat Mode 进入 `runChatAgent()` 后，先对问题做轻量分流：方法论、能力说明和闲聊追问直接调用 `/api/chat/stream`，不规划取数；需要具体数据的问题才调用 `/api/chat/agent` 规划工具，在浏览器执行工具，再调用 `/api/chat/stream` 综合；规划不可用时回退到原有单发流式路径。

```
用户输入
    │
    ▼
┌─ Step 0: 快速跳过检查 ──────────────────────────────────────────┐
│  canSkipLLMClassify() — ASIN/商户ID/简单Tier名可跳过LLM          │
│  跳过条件满足 → state.llmClassifyResult = null，走全正则路径      │
└──────────────────────┬───────────────────────────────────────┘
                       │ (未跳过)
                       ▼
┌─ Step 1: 意图分类（LLM优先，正则兜底）──────────────────────────┐
│  POST /api/chat/classify  (20s 超时，有缓存)                    │
│  → server.py handle_llm_classify()                              │
│    → llm_classify.classify_intent(prompt, categories)            │
│      → llm_provider.call_llm() → DeepSeek / Claude              │
│      → skills/ 注册表组装system prompt                          │
│      → 返回 { intent, params }                                  │
│  LLM失败 → 返回 null → 前端降级到 detectQueryIntent() 正则匹配   │
│  相同prompt有内存缓存，不重复调用                                  │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌─ Step 2: 路由与回答生成（纯前端，毫秒级）────────────────────────┐
│  applyPrompt() → answerPrompt(prompt)                            │
│    1. tierOfferPlan → recommendationBundleAnswer()               │
│    2. 排除/替换 → recommendationBundleExclusion/Replacement      │
│    3. detectQueryIntent() 确定意图 (LLM结果优先 → 正则兜底)       │
│    4. 按意图路由:                                                │
│       - asin          → asinAnswer()                             │
│       - merchant      → merchantOverview() / merchantOverviewHtml│
│       - payment       → paymentAnswer()                          │
│       - recommendation→ 排序/过滤/推荐流程                        │
│       - category      → categoryAnswer()                         │
│       - tier          → tierAnswer()                             │
│       - analysis      → analysisAnswer()                         │
│    5. contextFollowup → 追问处理（EPC/AOV/订单快速问答）          │
│  数据来源：window.CHATBOT_DATA.offers[]                          │
│  全部在浏览器内存中计算                                           │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌─ Step 3: 侧载补充（异步，不阻塞主回答）──────────────────────────┐
│  dbMerchantOfferForPrompt() → 精确匹配到商户ID                    │
│    → GET /api/ui/db/merchant?merchantId=xxx                      │
│    → loadDbMerchantInsight() 追加产品明细卡片                     │
│  未匹配:                                                         │
│    → GET /api/ui/db/search?q=xxx                                 │
│    → loadDbSearchInsight() 追加DB搜索结果                         │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌─ Step 4: 分析文字（仅 analysis 意图）────────────────────────────┐
│  analysisAnswer() → 同步渲染表格HTML                             │
│  → setTimeout → fetchAnalysisText(summary, language)              │
│    → POST /api/chat/analyze                                      │
│      → llm_classify.generate_analysis_text()                      │
│        → AnalysisTextSkill.generate()                             │
│        → call_llm() → DeepSeek / Claude                          │
│  LLM失败 → fallbackAnalysisText() 模板降级文字                    │
└───────────────────────────────────────────────────────────────────┘
```

---

## 3. 技术栈

| 层级 | 技术 | 文件 |
|------|------|------|
| 前端 | Vanilla JS IIFE（无框架），~8,900 行 | `public/app.js` |
| 国际化 | `CHATBOT_I18N` 全局对象，中英双语 | `public/chatbot_i18n.js` |
| LLM Provider | DeepSeek Chat / Claude，统一 OpenAI 兼容接口 | `llm_provider.py` |
| LLM 编排 | 意图分类 + 分析文字生成 | `llm_classify.py` |
| 技能注册 | 8 个 IntentSkill + 1 个 AnalysisSkill | `skills/*.py` |
| 后端 | Python `http.server`（本地） / Vercel Serverless（生产） | `server.py`, `api/chat/*.py` |
| 数据构建 | Ruby 脚本聚合多数据源 | `scripts/build_offer_chatbot_data.rb` |
| DB | MySQL 只读，动态列映射 | `offer_db.py` |
| 样式 | 纯 CSS 变量系统 | `public/styles.css` |

---

## 4. 意图分类体系

### 4.1 七种意图

| 意图 | 触发场景 | 示例 | Skill 文件 |
|------|---------|------|-----------|
| `asin` | 10 位 ASIN（B 开头） | `B0D2HKCMBP` | `skills/asin.py` |
| `merchant` | 商户名/ID 查询，默认兜底 | `Shokz`、`362653` | `skills/merchant.py` |
| `payment` | 付款状态/周期/佣金 | `四月未付款有哪些` | `skills/payment.py` |
| `recommendation` | 推荐排名/筛选/排序 | `Tier 1 推荐 5 个 aov 高的` | `skills/recommendation.py` |
| `tier` | 查看某个 Tier（无推荐/分析词） | `Tier 2` | `skills/tier.py` |
| `category` | 品类查询 | `Electronics`、`美妆` | `skills/category.py` |
| `analysis` | 数据分析/诊断/升降级 | `分析 Shokz`、`哪些Tier2要升Tier1` | `skills/analysis.py` |

### 4.2 LLM 分类参数提取

LLM 不仅返回意图标签，还提取结构化参数，前端在回答生成时使用：

- **实体识别**: `asin`, `merchantName`, `merchantId`, `category`, `tier`
- **过滤条件**: `metricFilters`（AOV/EPC/CVR…）、`paymentCycleFilter`、`paymentStatus`, `month`
- **排序**: `metricSort`（按指标升/降序）
- **数量**: `count`, `tierOfferPlan`（多 Tier 各 N 个）
- **分析类型**: `analysisType`（merchant/category/tier）、`analysisTarget`
- **推荐配置**: `includeTier4`, `includeBlack`

### 4.3 分类模式

| 模式 | 配置 | 说明 |
|------|------|------|
| 单次调用（默认） | `OI_LLM_TWO_STAGE` 未设置 | 一个 prompt 包含所有 skill 定义 → 一次 LLM 返回 intent+params |
| 两阶段 | `OI_LLM_TWO_STAGE=1` | Stage1: 轻量路由 prompt 仅选 intent → Stage2: 用匹配 skill 的 prompt 提取 params |
| 全正则（降级） | `OI_LLM_ENABLED=0` 或 API 不可用 | 跳过 `/api/chat/classify`，全部走 `detectQueryIntent()` + `chatbot_i18n.detectIntent()` |

### 4.4 Skills 架构

```
skills/
├── __init__.py        ← 自动注册所有 skill 到 SkillRegistry 单例
├── base.py            ← IntentSkill / AnalysisSkill 抽象基类 + SkillRegistry
├── asin.py            ← AsinSkill
├── merchant.py        ← MerchantSkill
├── payment.py         ← PaymentSkill
├── recommendation.py  ← RecommendationSkill
├── tier.py            ← TierSkill
├── category.py        ← CategorySkill
├── analysis.py        ← AnalysisIntentSkill  (意图分类)
└── analysis_text.py   ← AnalysisTextSkill   (文字生成)
```

每个 IntentSkill 自描述：
- `intent` → 规范意图名
- `prompt_intent_section()` → 注入 system prompt 的意图定义
- `param_schema()` → `{参数名: ParamDef(type, required, enum, nested_schema, description)}` 驱动验证
- `examples()` → Few-shot 示例
- `fallback_keywords()` → 前端正则兜底关键词

---

## 5. 完整数据流

### 5.1 数据构建（离线）

```
CSV/JSON 数据源
    │
    ▼
scripts/build_offer_chatbot_data.rb
    ├── brand_epc_by_tier.csv         ← 商户指标表
    ├── tier_1_2_3_backend_epc.csv    ← 后端 EPC 数据
    ├── levanta_unpaid_invoice_items_*.csv  ← 未付款记录
    ├── levanta_brand_categories_api.csv    ← Levanta 品类
    ├── backend_epc_sheet_blocks/     ← Google Sheet 区块
    ├── levanta_invoice_items_*.json  ← 发票详情
    ├── feishu_merchant_categories.csv ← 飞书品类
    └── product_name_keywords_t1_t3.csv ← 产品关键词
    │
    ▼
protected_data/chatbot_data.js  (~4MB)
    window.CHATBOT_DATA = {
      summary: { offerCount, tiers, networks, categories, paymentSummary, ... },
      sources: { tiers, backendEpc, payments, ... },
      offers: [ { id, tier, merchantId, brand, network, region, category,
                  clicks, orders, salesAmount, epc, aov, conversionRate,
                  paymentCycle, paymentRisk, paymentStatus, topAsins,
                  productKeywords, ... }, ... ],
      paymentRecords: [ { id, merchantId, merchantName, reportMonth,
                          revenueMade, commissionMade, paymentStatus,
                          paymentCycle, expectedPaymentDate, ... }, ... ]
    }
```

### 5.2 运行时加载顺序

```
index.html
  ├── <script> chatbot_i18n.js      ← window.CHATBOT_I18N
  ├── <script> tier2_recommendation_rules.js
  ├── <script> auth.js              ← 检查 session，获取 window.__OI_LLM_ENABLED
  │     └── 登录成功后动态加载:
  │         ├── db_offers_cache.json ← /api/ui/db/offers → window.CHATBOT_DATA + SHEET_REPORT_DATA
  │         ├── db_keywords_cache.json ← /api/ui/db/keywords → window.PRODUCT_KEYWORDS
  │         └── app.js              ← 初始化，绑定事件
  └── GSAP CDN (async)
```

### 5.3 Report Memory 推荐与 View 导出数据流

Report Mode 的下载项在加入记忆栏时会被固定为独立的报告导出快照。Chat Mode 的推荐只从这个快照中选择商户，View 和 Excel 下载继续消费同一个推荐结果快照，数据流如下：

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

Chat Mode 的自然语言回复仍通过现有 `/api/chat/stream` 生成；View 中的导出列表来自前端保存的报告快照和本次推荐结果快照，不会从自由文本中解析商户名，也不会为了下载重新计算推荐。

导出与候选范围规则如下：

- 一次推荐只允许使用一个记忆中的 Tier 报告；明确指定 Tier 时只匹配该 Tier 的记忆报告。支持 Tier 1、Tier 2、Tier 3、Tier 4 和 BLACK TIER，不跨 Tier 或跨报告合并候选。
- 推荐数量按唯一 Merchant ID 计数；同一 Merchant ID 在原始报告中的所有相关行仍保留在 `selectedRows` 和过滤后的工作表中，重复源行不会被压缩掉。
- 请求数量大于实际匹配数时返回实际数量并标记 partial；没有匹配时返回 empty；有多个记忆报告无法唯一确定时返回 ambiguous；没有可用快照时返回 unavailable。后三种状态不注册下载按钮。
- 下载是 View-only：Chat 回复下方不直接放 Excel 按钮，只有进入报告 View 后才由 `renderMemoryRecommendationDownloadCard()` 注册并展示下载项。
- 过滤后的工作簿保留原报告的标签页顺序、字段、列顺序和加入记忆时的列显示状态；Category Summary 按过滤后的主工作表重建，固定说明类标签页保持原样。

---

## 6. 前端代码结构 (app.js)

### 6.1 聊天核心行号索引

| Lines | Section | 关键函数 |
|-------|---------|---------|
| 3286–3320 | LLM 分类调用 | `classifyWithLLM()` — POST /api/chat/classify，20s 超时，内存缓存 |
| 3322–3377 | 分析计算 | `findOfferByMerchantName()`, `offersInCategory()`, `offersInTier()`, `globalAverages()` |
| 3378–3463 | 商户分析 | `analyzeMerchant()` — 指标、百分位排名、对比、强弱项、同行、支付风险 |
| 3465–3500+ | 品类分析 | `analyzeCategory()` — 聚合统计、Tier 分布、Top/Bottom 排名 |
| 3500+–3600+ | Tier 分析 | `analyzeTier()` — 层级概览、跨 Tier 对比、三段分化、异常值；Agent 另由 `offersInTier()` 返回排序后的分页商家行 |
| 3600+–3863 | 分析渲染 | `renderAnalysisTable()`, `fetchAnalysisText()`, `fallbackAnalysisText()` |
| 3864–3963 | 分析入口 | `analysisAnswer()` — 同步渲染表格 + 异步加载 LLM 文字 |
| 3965–3991 | 意图检测 | `detectQueryIntent()` — LLM 优先 → 正则兜底 |
| 3993–4041 | 推荐算法 | `recommendationScore()` — 综合评分公式 |
| 4043–4100+ | 排序比较 | `compareRecommendationOffers()` |
| 4100+–4385 | 聊天渲染 | `renderRecommendationStats()`, `renderMerchantStats()`, `renderASINStats()`, `renderPaymentStats()`, `renderCategoryStats()`, `renderKeywordStats()`, `renderContextPanel()` |
| 4386–4700 | 消息构建 | `fieldRows()`, `merchantOverviewHtml()`, `resultTable()`, `keywordSearchAnswer()`, `recommendationBundleAnswer()` 等 |
| 4701–5480 | DB 查询 + Dashboard | `dbMerchantProductRows()`, `dbMerchantInsightHtml()`, `dbLookupSkipPrompt()`, `dbSearchQueryForPrompt()`, `renderDashboardCategoryReport()` 等 |
| 9441–9899 | 路由分发 | `answerPrompt()` — 按意图路由的主分发函数 |
| 9902–10000+ | 消息渲染 | `addMessage()` — 将 HTML 追加到聊天日志 |
| 11166–11400+ | 入口 | `applyPrompt()` — 主入口：LLM 分类 → answerPrompt → DB 补充 |

记忆推荐与 View 导出函数（以当前 `public/app.js` 为准）：

| 函数 | 行号 | 用途 |
|------|------|------|
| `_extractPanelMemory()` | 10954 | 从 Report Mode 面板提取文本、HTML 和下载项，并写入 `reportSnapshot` |
| `buildReportExportSnapshot()` | 12521 | 深拷贝原始下载项的行、工作表、列定义，并生成唯一 Merchant ID 的排序代表行 |
| `filterReportWorkbookSnapshot()` | 12662 | 按选中的 Merchant ID 过滤原工作簿；保留重复行、重建 Category Summary |
| `buildMemoryRecommendationResult()` | 12757 | 限定单个记忆 Tier，按指标/品类排序，返回 `selectedMerchantIds`、`selectedRows` 和 `filteredSheets` |
| `registerReportRecommendationDownload()` | 12925 | 将 View 推荐结果注册为独立的多工作表下载项 |
| `renderMemoryRecommendationDownloadCard()` | 12937 | ready 结果渲染 View-only 下载卡片；empty、ambiguous、unavailable 显示原因说明 |
| `createRecommendationWorkbook()` | 13335 | 使用已注册的过滤快照生成 XLSX 工作簿 |

### 6.2 answerPrompt() 路由优先级

1. `tierOfferPlan` → `recommendationBundleAnswer()`
2. 推荐包排除/替换 → `recommendationBundleExclusionAnswer()` / `recommendationBundleReplacementAnswer()`
3. `intent === "asin"` → `asinAnswer()`
4. 精确 merchant ID → `merchantOverview()`
5. 付款周期过滤 → `paymentCycleOfferAnswer()`
6. 追问（contextFollowup） → 快速 EPC/AOV/订单回答
7. `intent === "analysis"` → `analysisAnswer()`
8. 关键词搜索意图 → `keywordSearchAnswer()`
9. top metric 请求 → `topMetricOfferAnswer()`
10. `intent === "payment"` → `paymentAnswer()`
11. `intent === "recommendation"` → 排序/过滤/排名路径
12. `intent === "category"` → 品类路径
13. `intent === "tier"` → Tier 查看路径
14. 默认 → 商户名模糊搜索

---

## 7. 国际化 (chatbot_i18n.js)

### 7.1 全局对象

`window.CHATBOT_I18N` 暴露以下方法：

| 方法 | 用途 |
|------|------|
| `hasChinese(value)` | 检测是否包含中文字符 |
| `responseLanguage(prompt, currentLanguage)` | 根据 prompt 和当前语言决定回答语言 |
| `detectIntent(prompt)` | 前端正则意图检测（LLM 降级兜底） |
| `tierFromPrompt(prompt)` | 从文本提取 Tier（中英文） |
| `monthNameFromText(prompt)` | 中英文月份名 → 英文月份名 |
| `categoryForPrompt(prompt, knownCategories)` | 从文本提取品类（中英文别名） |
| `requestedRecommendationCount(prompt, fallback, max)` | 提取推荐数量 |
| `copy(language)` | 获取当前语言的 UI 文案 |
| `format(template, values)` | `{key}` 模板替换 |
| `label(text, language)` | 中文标签映射 |

### 7.2 翻译覆盖

- **UI 文案** (COPY): 推荐预览、支付概览、未找到、下载 Excel 等 30+ 条
- **字段标签** (LABELS_ZH): Merchant→商家, EPC→EPC, Payment cycle→付款周期 等 30+ 条
- **品类别名** (CATEGORY_ALIASES_ZH/EN): 美妆→beauty, skincare→beauty 等 10 个大类
- **月份映射** (MONTHS_ZH/EN): 四月→April, jan→January 等

---

## 8. 后端代码结构

### 8.1 llm_provider.py — Provider 抽象层

```
_provider()        → 读取 OI_LLM_PROVIDER (deepseek/claude)
_model_name()      → 读取对应模型名
_api_key()         → 读取对应 API Key
_default_timeout() → OI_LLM_TIMEOUT (默认 15s)
stream_timeout()   -> OI_LLM_STREAM_TIMEOUT (default 50s, max 50s)
call_llm()         → 统一调用入口 (OpenAI 兼容 / Anthropic SDK)
call_llm_tools()   → Agent 规划调用，归一化 DeepSeek/Claude 工具结果
```

`chat_agent_http.py` 负责 Agent 规划端点的请求大小、消息角色、工具名称和双语提示词校验；工具执行仍在浏览器 `public/app.js` 中完成。

`merchant_analysis` 的 `metrics` 是当前缓存商户汇总，`monthly` 是按最新月份在前排列的真实 DB 月度数据。月度数据由 `fetchMerchantMonthlyRows()` → `fetchMerchantMetrics()` → `/api/ui/db/merchant?months=12&minimal=1` 获取，并使用 `mergeMonthIntoOffer()` 保持与 Report Mode 月份概览相同的 EPC、AOV、CVR、Commission、Orders、Clicks、DPV 和 ATC 口径；月度接口不可用时 `monthly=[]`、`monthlyDataSource="unavailable"`，不伪造月度值。综合模型若只引用最新月份，`runChatAgent()` 会从已完成的工具结果中补回完整月度表。

`tier_analysis` 的 `merchantCount` 是整个 Tier 的商户总数；`merchants` 是按 Report Mode Tier 查询顺序返回的当前页，`merchantList` 的 `hasMore` 表示是否还有后续页。Agent 综合不能把有 `hasMore` 的当前页表述为完整 Tier 列表；Report Mode 仍保留完整 Deep Window/Excel 行快照。

### 8.2 llm_classify.py — 编排层

| 函数 | 用途 |
|------|------|
| `classify_intent(prompt, categories, timeout)` | **主入口**: 意图分类 + 参数提取 |
| `generate_analysis_text(summary, language, timeout)` | **分析入口**: 结构化摘要 → 自然语言 |
| `_build_system_prompt(categories)` | 组装单次调用 system prompt |
| `_build_router_prompt()` | 组装两阶段 Stage1 路由 prompt |
| `_build_skill_prompt(skill, categories)` | 组装两阶段 Stage2 参数提取 prompt |
| `_parse_response(text)` | 解析 LLM 返回的 JSON（含 schema 验证） |
| `_validate_param_value(key, value, param_def)` | 按 ParamDef 递归验证参数 |

### 8.3 server.py — 路由处理

| 路由 | 方法 | Handler | 说明 |
|------|------|---------|------|
| `/api/chat/classify` | POST | `handle_llm_classify()` | body ≤2KB，调用 `classify_intent()` |
| `/api/chat/analyze` | POST | `handle_llm_analyze()` | body ≤8KB，调用 `generate_analysis_text()` |

### 8.4 api/chat/ — Vercel Serverless

```
api/chat/actions.py   -> class handler: trusted route header -> classify/analyze/agent
api/chat/stream.py    -> class handler: SSE stream (50s graceful deadline)
```

---

## 9. 环境变量一览

### LLM 配置

| 环境变量 | 用途 | 默认值 |
|------|------|------|
| `OI_LLM_PROVIDER` | LLM 提供商 | `deepseek` |
| `DEEPSEEK_API_KEY` | DeepSeek API Key | — |
| `ANTHROPIC_API_KEY` | Claude API Key | — |
| `OI_LLM_MODEL_DEEPSEEK` | DeepSeek 模型 | `deepseek-chat` |
| `OI_LLM_MODEL_CLAUDE` | Claude 模型 | `claude-haiku-3-5-latest` |
| `OI_LLM_TIMEOUT` | API 超时（秒） | `15` |
| `OI_LLM_STREAM_TIMEOUT` | SSE streaming timeout in seconds (bounded to 5-50) | `50` |
| `OI_LLM_TWO_STAGE` | 启用两阶段分类 | 关闭 |

### 功能开关

| 环境变量 | 用途 |
|------|------|
| `OI_LLM_ENABLED` | `0` → 禁用 LLM，全正则 |
| `OI_AUTH_ENABLED` | `0` → 跳过登录 |
| `OI_SESSION_SECRET` | Session Cookie 签名密钥 |
| `OI_ADMIN_USERNAME` | 管理员用户名 |
| `OI_ADMIN_PASSWORD_HASH` | 管理员密码哈希 |

---

## 10. 用户界面

### 10.1 HTML 结构 (index.html)

```
.app-shell
├── aside.sidebar (导航)
│   ├── .language-toggle (中英切换按钮)
│   └── nav.page-nav (Dashboard/Payments/Reports/Tier 1-4/Black Tier)
└── main.workspace
    └── section.main-grid.dashboard-page
        ├── section.insight-panel (右侧上下文面板)
        │   ├── #contextTitle / #contextSubtitle
        │   └── #recommendationBox (context panel 内容)
        └── section.chat-panel (左侧聊天区域)
            ├── #chatLog (消息列表)
            └── form#chatForm (输入框 + 发送按钮)
```

### 10.2 上下文面板

根据当前对话上下文展示不同类型的内容：

| 上下文类型 | 渲染函数 | 内容 |
|------|------|------|
| `merchant` | `renderMerchantStats()` | 商户统计卡片 + 指标详情 |
| `asin` | `renderASINStats()` | ASIN 所属商户 + 产品明细 |
| `payment` | `renderPaymentStats()` | 付款摘要 + 记录列表 |
| `category` | `renderCategoryStats()` | 品类聚合统计 |
| `keyword` | `renderKeywordStats()` | 关键词搜索结果汇总 |
| `tier` | `renderRecommendationStats()` | Tier 概览 + 优先候选 |
| `recommendation` | `renderRecommendationStats()` | 推荐包摘要 + Top 列表 |
| `default` | `renderRecommendationStats()` | 全局过滤视图 |

### 10.3 CSS 聊天样式 (styles.css)

| 行号范围 | 内容 |
|------|------|
| 629–709 | `.chat-input` 输入框样式 |
| 729–789 | `.chat-input button` 发送按钮 |
| 873–894 | `.chat-panel`, `.chat-log` 聊天区域 |
| 959–1021 | `.db-chat-card` DB 查询结果卡片 |
| 1065–1123 | `.analysis-section`, `.analysis-table`, `.analysis-narrative` 分析表格 |

---

## 11. 数据构建脚本

### 11.1 build_offer_chatbot_data.rb

**输入**（9 个数据源）:
1. `outputs/brand_epc_by_tier.csv` — 商户 EPC 指标
2. `outputs/tier_1_2_3_backend_epc.csv` — 后端 EPC
3. `outputs/levanta_unpaid_invoice_items_*.csv` — 未付款
4. `work/levanta_brand_categories_api.csv` — Levanta 品类
5. `work/backend_epc_sheet_blocks/` — Google Sheet 区块
6. `outputs/levanta_invoice_items_*.json` — 发票
7. `work/feishu_merchant_categories.csv` — 飞书品类
8. `data/product_name_keywords_t1_t3.csv` — 产品关键词
9. 各 Tier Sheet TSV 文件

**输出**: `protected_data/db_offers_cache.json` → `/api/ui/db/offers` → `window.CHATBOT_DATA`

**核心逻辑**:
- 品类优先级链: Google Sheet → mainCategory → Feishu main → Feishu sub → Levanta → "Uncategorized"
- 支付状态计算: 基于实际收入/佣金、付款周期、当前日期
- 数据压缩: `compact_hash()` 移除 null/空/false 值减小文件体积

### 11.2 自动化更新

`.github/workflows/sync-levanta-payments.yml` 每日 02:00 UTC:
1. 同步 Levanta 付款数据
2. 刷新 DB 缓存（`offer_db.py` 自动处理，或由 `refresh-db-caches` workflow 触发）
3. Auto-commit 回 repo

---

## 12. 测试文件

### 12.1 Chatbot 专项测试

| 文件 | 内容 |
|------|------|
| `scripts/test_chatbot_intent_flow.mjs` | 意图分类流测试（VM 沙箱执行 app.js） |
| `scripts/test_zh_chatbot.mjs` | 中文 chatbot 测试：语言检测、意图识别、月份映射、品类匹配 |

### 12.2 CI 中相关测试

`.github/workflows/ci.yml`:
```bash
node --check public/chatbot_i18n.js
node --check public/app.js
node scripts/test_chatbot_intent_flow.mjs
node scripts/test_zh_chatbot.mjs
python -m py_compile llm_classify.py
python -m py_compile api/chat/actions.py
python -m py_compile api/chat/stream.py
```

---

## 13. 完整文件清单

### 前端（7 个文件）

```
public/
├── index.html                ← 聊天 UI 布局
├── app.js                    ← 主应用 (~8,900 行)：意图路由、回答生成、分析引擎
├── auth.js                   ← Session 管理、LLM 开关 (window.__OI_LLM_ENABLED)
├── chatbot_i18n.js           ← 中英双语：翻译、别名、正则意图检测
├── tier2_recommendation_rules.js ← Tier 2 推荐规则
├── styles.css                ← 聊天样式 + 分析表格样式
└── protected_data/
    ├── db_offers_cache.json   ← 主数据缓存 (offers + sheets + paymentRecords)
    ├── db_keywords_cache.json  ← 产品关键词缓存
```

### 后端 Python（12 个文件）

```
llm_provider.py               ← LLM Provider 抽象（DeepSeek/Claude）
chat_agent_http.py            ← Chat Mode Agent 规划端点、工具白名单和双语提示词
llm_classify.py               ← 意图分类 + 分析文字生成编排层
server.py                     ← 本地服务器（/api/chat/* 路由）
auth.py                       ← 认证 + llmEnabled 状态
api/chat/
|-- actions.py                -> /api/chat/classify + /api/chat/analyze + /api/chat/agent Vercel handler
`-- stream.py                 -> /api/chat/stream Vercel SSE handler
skills/
├── __init__.py               ← Skill 自动注册
├── base.py                   ← IntentSkill / AnalysisSkill 基类 + SkillRegistry
├── asin.py                   ← ASIN 意图技能
├── merchant.py               ← 商户意图技能
├── payment.py                ← 支付意图技能
├── recommendation.py         ← 推荐意图技能
├── tier.py                   ← Tier 意图技能
├── category.py               ← 品类意图技能
├── analysis.py               ← 分析意图分类技能
└── analysis_text.py          ← 分析文字生成技能
```

### 数据构建（2 个文件）

```
scripts/build_offer_chatbot_data.rb   ← Ruby 主构建脚本 (~740 行)
scripts/build_db_static_snapshot.py   ← Python DB 快照（含 --chatbot-output）
```

### 测试（Agent 相关）

```
scripts/test_chatbot_intent_flow.mjs  ← 意图流测试
scripts/test_zh_chatbot.mjs           ← 中文 chatbot 测试
scripts/test_chat_agent.mjs           ← Agent 工具、规划、综合和降级测试
scripts/test_agent_http.py            ← Agent 请求校验与规划端点测试
scripts/test_llm_agent.py              ← Provider 工具调用与消息透传测试
```

### 文档（4 个目录）

```
docs/chatbot-feature-report.md              ← Chatbot 功能报告
specs/001-llm-intent-classifier/            ← LLM 意图分类器 Spec
specs/002-chatbot-data-analysis/            ← Chatbot 数据分析 Spec
CLAUDE.md                                   ← app.js 聊天相关行号索引
```

### CI/CD（2 个文件）

```
.github/workflows/ci.yml                    ← CI 测试 chatbot 文件
.github/workflows/sync-levanta-payments.yml ← 每日同步付款到 cnpscy_oi_payment_records
```

---

## 14. app.js 聊天函数速查表

| 函数 | 行号 | 用途 |
|------|------|------|
| `classifyWithLLM()` | 3286 | POST /api/chat/classify |
| `findOfferByMerchantName()` | 3324 | 商户名 → offer 对象 |
| `offersInCategory()` | 3345 | 品类 → offer 列表 |
| `offersInTier()` | 3354 | Tier → offer 列表 |
| `globalAverages()` | 3359 | 全站指标均值 |
| `analyzeMerchant()` | 3374 | 商户分析摘要 |
| `analyzeCategory()` | 3465 | 品类分析摘要 |
| `analyzeTier()` | ~3500 | Tier 分析摘要 |
| `renderAnalysisTable()` | ~3600 | 分析表格 HTML |
| `fetchAnalysisText()` | ~3700 | POST /api/chat/analyze |
| `fallbackAnalysisText()` | ~3750 | 模板降级文字 |
| `analysisAnswer()` | 3864 | 分析入口 |
| `detectQueryIntent()` | 3965 | 意图检测（LLM → 正则） |
| `recommendationScore()` | 3993 | 推荐评分 |
| `compareRecommendationOffers()` | 4043 | 推荐排序 |
| `setContext()` | ~4100 | 设置上下文 |
| `renderRecommendationStats()` | ~4100 | 推荐统计渲染 |
| `renderMerchantStats()` | ~4200 | 商户统计渲染 |
| `renderContextPanel()` | 4405 | 上下文面板路由 |
| `merchantOverviewHtml()` | 4469 | 商户概览卡片 |
| `resultTable()` | 4485 | 通用结果表格 |
| `answerPrompt()` | 9441 | 主路由分发 |
| `addMessage()` | 9902 | 追加消息到聊天 |
| `applyPrompt()` | 11166 | 聊天主入口 |
| `_extractPanelMemory()` | 10954 | Report 面板 → 记忆报告快照 |
| `buildReportExportSnapshot()` | 12521 | 保存可复用的报告导出快照 |
| `filterReportWorkbookSnapshot()` | 12663 | 按 Merchant ID 过滤原报告工作簿 |
| `buildMemoryRecommendationResult()` | 12758 | 从单个记忆 Tier 生成结构化推荐结果 |
| `registerReportRecommendationDownload()` | 12926 | 注册 View 专属过滤下载项 |
| `renderMemoryRecommendationDownloadCard()` | 12938 | 渲染 View-only 下载卡片 |
| `createRecommendationWorkbook()` | 13336 | 生成推荐 XLSX |

---

## 15. 已知限制与后续方向

### 当前限制
- **趋势依赖 DB 月度数据**: 趋势分析需要数据库中至少 2 个月的月度时间序列；无 DB 时自动降级为基于汇总历史的估算（结果标记为估算）
- **LLM 依赖网络**: 文字分析需要 API 调用，超时 15s
- **数据有缓存 TTL**: `db_offers_cache.json` 使用 24h TTL + stale-while-revalidate
- **多轮记忆有限**: Report Mode 每次提问独立处理（支持对上一商户的基础追问，不跨会话持久）

### 已实现（历史限制已落地）
- **时间序列趋势分析** — 支持 merchant / category / tier 三类实体的月度趋势、环比变化、指定指标与时间范围（如"近 3 个月"、"这个季度"）。对应 `renderTrendLoadingPlaceholder` 的三条取数路径（商户走 `fetchMerchantMetrics`，品类/Tier 走 `fetchAggregatedMonthlyMetrics` 聚合，无 DB 时 `estimateAggregatedTrend` 估算降级）+ 左栏趋势图表。
- **SVG 图表** — 趋势图（`trendTrendChartSvg`）、DB 状态趋势图、目标趋势图等均为内联 SVG，不依赖图表库。
- **支付维度分析** — 支付查询 / 状态 / 逾期 / 付款周期筛选（`paymentAnswer` 系列）。

### 建议后续方向
1. **自动洞察** — 定时推送异常检测报告（高价值商户流失预警、品类异动）
2. **更精细的趋势** — 日粒度趋势、同比对比、更长的历史窗口
3. **多轮对话记忆增强** — 跨提问持久上下文

## 16. 新手流程引导（Flow Onboarding）

主路径：**Report Mode 提问 → 报告浮窗点「加入对话」→ 自动切到 Chat Mode → 直接对话**。

- 报告生成完成后，Deep Window 头部出现「加入对话」按钮：点击后报告自动加入记忆栏、自动切换到 Chat Mode，并在聊天区顶部注入引导消息（含 2 个示例 chips）。同一报告重复点击会变为「已加入」并禁用。
- 欢迎屏（`chatbot_welcome.js`）维护流程状态机 `noReport → reportReady → memoryReady → chatActive`，以 3 步进度条展示「① 在 Report 提问 → ② 点「加入对话」→ ③ 在 Chat 对话」，并在关键时刻就地提示：报告完成提示点「加入对话」；最小化后提示切 Chat Mode 拖入记忆栏；Chat Mode 空记忆时提醒卡片提供「去生成报告」按钮。
- 首次新手引导（`onboarding_tour.js`）为 5 步：布局介绍 → Report 提问 → 等待报告 → 点「加入对话」→ Chat 提问。最小化 + 拖拽保留为高级用法（见 Chat Mode 使用说明）。

## 17. 提问日志与导出
- 本地可在 `.env` 中设置 `OI_CHATBOT_QUESTION_LOGGING=0`（也支持 `false`、`no`、`off`）关闭提问日志的 MySQL 写入；未设置时默认开启。关闭开关只影响提问日志 POST，回答流程继续执行，已有日志仍可只读导出。

- `applyPrompt()` 与独立 Agent 页的 `handleAgentPageSubmit()` 在用户提交时异步调用现有 `POST /api/chat/stream?operation=questions` 创建日志，回答结束后再异步更新为 `success` 或 `failed`；日志失败不阻断原有问答。Agent 的中止也会完成为 `failed`。
- 日志只保存提问及分析字段，不保存助手回答。字段包括匿名浏览器会话 ID、`report` / `chat` / `agent` 模式、语言、意图、状态与时间戳。
- MySQL 表为 `cnpscy_oi_chatbot_question_logs`，定义位于 `chatbot_question_logs.py`，建表入口位于 `scripts/ensure_oi_schema.py`。
- Chatbot 模式栏右侧的低调「日志 / Logs」菜单可通过带会话认证的 `GET /api/chat/stream?operation=questions&format=csv|jsonl` 导出全部记录，Agent 记录通过 `mode=agent` 区分。
- 不新增独立 API 端点：本地 `server.py` 与 Vercel 现有 `api/chat/stream.py` 根据 `operation=questions` 分流，共享日志 HTTP 处理位于 `chatbot_question_log_http.py`。

### 17.1 不满意反馈

- 每条成功回答仅提供一个低调的“不满意”按钮；Chat Mode 位于该回答底部，Report Mode 位于对应 Deep Window 底部。成功提交后按钮变为“已反馈”并禁用。
- 反馈必须单选一个原因（回答不准确、没有回答问题、数据不完整、内容难以理解、其他），补充说明可选。提交失败时保留表单并允许重试。
- Chat Mode 保存该次回答的原始 Markdown；Report Mode 在点击按钮时保存对应报告窗口当前可见文本。回答上限为 256 KB UTF-8，超出时安全截断并记录 `answerTruncated`。
- 反馈表为 `cnpscy_oi_chatbot_answer_feedback`，通过 `questionEventId` 与提问日志一对一关联，并区分 `report` / `chat` / `agent` 模式；独立 Agent 的成功直答、流式综合和 fallback 回答都复用同一反馈入口。
- 不满意反馈使用现有 `POST /api/chat/stream?operation=feedback` 写入；「日志 / Logs」菜单内与提问记录分组展示，分别通过 `GET /api/chat/stream?operation=feedback&format=csv|jsonl` 独立导出。
- 共享领域与 HTTP 处理分别位于 `chatbot_answer_feedback.py`、`chatbot_answer_feedback_http.py`；没有新增 Vercel 路由文件。
- 两张表的 `mode` 字段本身是 `VARCHAR(16)`，因此本次只扩展业务值，不新增表或执行 schema 迁移。
