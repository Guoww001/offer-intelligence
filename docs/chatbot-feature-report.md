# Chatbot 完整档案

> 更新日期：2026-07-13 · 分支：`main`

## 1. 概述

YeahPromos Offer Intelligence 内建了一个对话式 AI 助手，支持中英双语，覆盖商户查询、品类搜索、推荐排名、支付追踪、Tier 管理和数据分析。系统采用 **LLM 意图分类 + 规则引擎回答生成** 的混合架构，所有数据在页面加载时一次性载入前端内存，回答生成零网络延迟。

---

## 2. 完整请求流程

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

---

## 6. 前端代码结构 (app.js)

### 6.1 聊天核心行号索引

| Lines | Section | 关键函数 |
|-------|---------|---------|
| 3286–3320 | LLM 分类调用 | `classifyWithLLM()` — POST /api/chat/classify，20s 超时，内存缓存 |
| 3322–3377 | 分析计算 | `findOfferByMerchantName()`, `offersInCategory()`, `offersInTier()`, `globalAverages()` |
| 3378–3463 | 商户分析 | `analyzeMerchant()` — 指标、百分位排名、对比、强弱项、同行、支付风险 |
| 3465–3500+ | 品类分析 | `analyzeCategory()` — 聚合统计、Tier 分布、Top/Bottom 排名 |
| 3500+–3600+ | Tier 分析 | `analyzeTier()` — 层级概览、跨 Tier 对比、三段分化、异常值 |
| 3600+–3863 | 分析渲染 | `renderAnalysisTable()`, `fetchAnalysisText()`, `fallbackAnalysisText()` |
| 3864–3963 | 分析入口 | `analysisAnswer()` — 同步渲染表格 + 异步加载 LLM 文字 |
| 3965–3991 | 意图检测 | `detectQueryIntent()` — LLM 优先 → 正则兜底 |
| 3993–4041 | 推荐算法 | `recommendationScore()` — 综合评分公式 |
| 4043–4100+ | 排序比较 | `compareRecommendationOffers()` |
| 4100+–4385 | 聊天渲染 | `renderRecommendationStats()`, `renderMerchantStats()`, `renderASINStats()`, `renderPaymentStats()`, `renderCategoryStats()`, `renderKeywordStats()`, `renderContextPanel()` |
| 4386–4700 | 消息构建 | `fieldRows()`, `merchantOverviewHtml()`, `resultTable()`, `keywordSearchAnswer()`, `recommendationBundleAnswer()` 等 |
| 4701–5480 | DB 查询 + Dashboard | `dbMerchantProductRows()`, `dbMerchantInsightHtml()`, `dbLookupSkipPrompt()`, `dbSearchQueryForPrompt()`, `renderDashboardCategoryReport()` 等 |
| 5481–5840 | 路由分发 | `answerPrompt()` — 按意图路由的主分发函数 |
| 5840–5846 | 消息渲染 | `addMessage()` — 将 HTML 追加到聊天日志 |
| 5848–5883 | 入口 | `applyPrompt()` — 主入口：LLM 分类 → answerPrompt → DB 补充 |

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
call_llm()         → 统一调用入口 (OpenAI 兼容 / Anthropic SDK)
```

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
api/chat/classify.py  ← class handler: do_POST → classify_intent()
api/chat/analyze.py   ← class handler: do_POST → generate_analysis_text()
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
python -m py_compile api/chat/classify.py
python -m py_compile api/chat/analyze.py
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
llm_classify.py               ← 意图分类 + 分析文字生成编排层
server.py                     ← 本地服务器（/api/chat/* 路由）
auth.py                       ← 认证 + llmEnabled 状态
api/chat/
├── classify.py               ← /api/chat/classify Vercel handler
└── analyze.py                ← /api/chat/analyze Vercel handler
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

### 测试（2 个文件）

```
scripts/test_chatbot_intent_flow.mjs  ← 意图流测试
scripts/test_zh_chatbot.mjs           ← 中文 chatbot 测试
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
| `answerPrompt()` | 5481 | 主路由分发 |
| `addMessage()` | 5840 | 追加消息到聊天 |
| `applyPrompt()` | 5848 | 聊天主入口 |

---

## 15. 已知限制与后续方向

### 当前限制
- **无趋势分析**: 仅使用当前月份快照，不支持时间序列、环比/同比
- **无图表**: 未引入图表库，分析结果以表格呈现
- **无多轮对话记忆**: 每次提问独立处理（有基础追问支持但不持久）
- **数据有缓存 TTL**: `db_offers_cache.json` 使用 24h TTL + stale-while-revalidate
- **无支付维度分析**: 分析功能尚未覆盖支付维度
- **LLM 依赖网络**: 文字分析需要 API 调用，超时 15s

### 建议后续方向
1. **时间序列分析** — 接入 DB 历史数据，支持月度趋势、环比增长
2. **数据可视化** — 引入轻量图表库，为分析回答增加 SVG 图表
3. **多轮对话** — 利用 LLM 维护对话上下文，支持追问和深入分析
4. **支付分析** — 增加逾期率趋势、商户付款行为聚类
5. **自动洞察** — 定时推送异常检测报告（高价值商户流失预警、品类异动）
