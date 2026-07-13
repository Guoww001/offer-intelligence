# Chatbot 数据分析 Plan

## 架构概览

改动涉及 4 层：

```
用户输入
    │
    ▼
┌── 意图分类层（llm_classify.py）────────────────────────┐
│  新增 analysis 意图 + analysisType/analysisTarget 参数    │
│  更新 system prompt 教会 LLM 识别分析类提问              │
└────────────────────────────────────────────────────────┘
    │  intent = "analysis"
    ▼
┌── 路由层（app.js: answerPrompt）───────────────────────┐
│  新增 analysis 分支 → analysisAnswer()                  │
└────────────────────────────────────────────────────────┘
    │
    ▼
┌── 分析计算层（app.js: 纯前端）─────────────────────────┐
│  analyzeMerchant() / analyzeCategory() / analyzeTier()  │
│  从 window.CHATBOT_DATA 计算统计 → 渲染表格             │
│  构造统计摘要 JSON → 调用 /api/chat/analyze             │
└────────────────────────────────────────────────────────┘
    │  POST /api/chat/analyze
    ▼
┌── LLM 分析文字层（llm_classify.py + api/chat/analyze.py）┐
│  接收统计摘要 JSON → 构建分析 prompt → 调用 LLM          │
│  返回 LLM 生成的自然语言分析文字                         │
│  失败时前端降级为模板文字                                │
└────────────────────────────────────────────────────────┘
```

核心原则：
- **分析计算完全在前端**——所有统计、排名、对比均由 JS 基于 `window.CHATBOT_DATA` 在浏览器中完成，不创建新的后端数据查询 API
- **LLM 只负责「说人话」**——它收到的是一份结构化的统计摘要 JSON，任务是把它转成自然语言叙述和建议
- **表格先渲染，文字后追加**——用户始终能立即看到结构化数据；LLM 生成的文字是增强，不是必需

## 核心数据结构

### AnalysisResult（前端计算产出，也是发给 LLM 的摘要）

```javascript
// 商户分析结果
{
  type: "merchant",
  target: { name: "Shokz", id: "12345", tier: "Tier 2", category: "Electronics" },
  metrics: {
    epc: 2.35, aov: 45.20, conversionRate: 8.3,
    orders: 1250, clicks: 15060, affCommission: 2937.50,
    salesAmount: 56500, commissionRate: 5.2
  },
  ranks: {
    epc: { value: 2.35, percentile: 72, totalInCategory: 45 },
    conversionRate: { value: 8.3, percentile: 85, totalInCategory: 45 }
  },
  comparisons: {
    vsCategory: { epc: { self: 2.35, avg: 1.80, delta: "+30.6%" } },
    vsTier: { epc: { self: 2.35, avg: 2.10, delta: "+11.9%" } },
    vsGlobal: { epc: { self: 2.35, avg: 1.65, delta: "+42.4%" } }
  },
  strengths: ["conversionRate", "epc"],
  weaknesses: ["aov"],
  paymentRisk: { hasOverdue: false, status: "Paid" },
  peers: [{ name: "PeerA", metrics: {...} }]
}

// 品类分析结果
{
  type: "category",
  target: { name: "Electronics", merchantCount: 45, tierDistribution: {...} },
  aggregates: {
    totalRevenue: 250000, avgEpc: 1.80, avgCvr: 6.5,
    totalOrders: 15000, avgCommissionRate: 4.8
  },
  vsGlobal: { avgEpc: { self: 1.80, global: 1.65, delta: "+9.1%" } },
  topMerchants: [{ name: "Shokz", metrics: {...} }],
  bottomMerchants: [{ name: "BrandX", metrics: {...} }]
}

// Tier 分析结果
{
  type: "tier",
  target: { name: "Tier 2", merchantCount: 120 },
  aggregates: { totalRevenue: 500000, avgEpc: 2.10, avgCvr: 7.2 },
  vsOtherTiers: {
    "Tier 1": { avgEpc: { self: 2.10, other: 2.80, delta: "-25%" } },
    "Tier 3": { avgEpc: { self: 2.10, other: 1.50, delta: "+40%" } }
  },
  segments: {
    head: { count: 24, avgRevenue: 15000 },
    mid: { count: 60, avgRevenue: 5000 },
    tail: { count: 36, avgRevenue: 1200 }
  },
  outliers: [{ name: "TopPerformer", reason: "EPC 远超同级均值" }]
}
```

### LLM 分析 API 契约

```
POST /api/chat/analyze
Request:  { summary: <AnalysisResult>, language: "en" | "zh" }
Response: { ok: true, text: "<LLM 生成的分析叙述>" }
Error:    { ok: false, error: "..." }
```

## 模块设计

### 模块 A: `llm_classify.py`（扩展现有模块）

**职责：** 意图分类 + 分析文字生成

**变更：**
- `VALID_INTENTS` 新增 `"analysis"`
- `_EXPECTED_PARAM_KEYS` 新增 `analysisType`（值：`"merchant"`/`"category"`/`"tier"`）、`analysisTarget`（实体名称）
- `_VALID_ANALYSIS_TYPES` 新增校验常量
- 更新 `_build_system_prompt()`——新增 analysis 意图的描述和参数规则，含中英文触发词（分析/评估/诊断/趋势/表现/怎么样/健康度）
- 新增 `generate_analysis_text(summary: dict, language: str, timeout: float | None) -> str | None`——构建分析 prompt（系统提示词 + 统计摘要），调用 LLM 返回自然语言分析文字

**依赖：** 现有 `_provider()`、`_model_name()`、`_api_key()` 配置

### 模块 B: `api/chat/analyze.py`（新建 Vercel handler）

**职责：** `/api/chat/analyze` 的 serverless handler

**对外接口：** `POST /api/chat/analyze`，session 认证，接收 `{ summary, language }`，调用 `generate_analysis_text()`，返回 `{ ok, text }`

**依赖：** `llm_classify.generate_analysis_text`、`auth.require_auth`

### 模块 C: `server.py`（新增本地路由）

**变更：** 新增 `POST /api/chat/analyze` 路由，逻辑与 handler 一致（~20 行）

### 模块 D: 前端分析引擎（`public/app.js`）

**职责：** 分析计算 + 表格渲染 + LLM 调用 + 降级处理

**新增函数（约 400-500 行）：**

| 函数 | 职责 |
|------|------|
| `analyzeMerchant(name)` | 查找商户，计算百分位、对比、强弱项，返回 AnalysisResult |
| `analyzeCategory(name)` | 聚合品类统计，排名，全站对比，返回 AnalysisResult |
| `analyzeTier(name)` | 聚合 Tier 统计，跨 Tier 对比，分段，返回 AnalysisResult |
| `analysisAnswer(prompt, params)` | 分析意图的入口路由，根据 analysisType 分发 |
| `renderAnalysisTable(summary)` | 将 AnalysisResult 渲染为结构化表格 |
| `fetchAnalysisText(summary, lang)` | 异步调 `/api/chat/analyze`，15s 超时 |
| `renderAnalysisNarrative(text)` | 将 LLM 文字渲染到回答下方 |
| `fallbackAnalysisText(summary, lang)` | 模板降级——根据数据特征生成简要结论 |
| `percentileRank(value, values)` | 计算百分位排名 |
| `segmentedStats(offers, field)` | 计算 head/mid/tail 分段统计 |

**变更函数：**

| 函数 | 变更 |
|------|------|
| `detectQueryIntent()` | LLM 路径已通过 `state.llmClassifyResult` 返回 analysis，正则路径新增 analysis 关键词检测作为兜底 |
| `answerPrompt()` | 在现有路由中新增 analysis 分支（在 keyword search 之前） |

## 模块交互

```
用户输入 "分析 Shokz"
    │
    ▼
applyPrompt()
    ├── classifyWithLLM() → POST /api/chat/classify
    │   └── llm_classify.classify_intent()
    │       └── 返回 { intent: "analysis", params: { analysisType: "merchant", analysisTarget: "Shokz" } }
    │
    └── answerPrompt()
        ├── detectQueryIntent() → consumes llm result → "analysis"
        ├── 【新增】intent === "analysis" → analysisAnswer(prompt, params)
        │   ├── analyzeMerchant("Shokz")           ← 前端计算，即时
        │   ├── renderAnalysisTable(summary)        ← 表格即时渲染
        │   ├── fetchAnalysisText(summary, lang)    ← 异步调 LLM
        │   │   └── POST /api/chat/analyze
        │   │       └── generate_analysis_text(summary, lang)
        │   │           └── LLM (DeepSeek/Claude)
        │   ├── renderAnalysisNarrative(text)       ← LLM 文字追加
        │   └── 失败 → fallbackAnalysisText(summary, lang)  ← 降级
        └── (其他 intent 保持不变)
```

## 文件组织

```
project/
├── llm_classify.py          ← 修改：新增 analysis intent + generate_analysis_text()
├── server.py                ← 修改：新增 /api/chat/analyze 路由
├── api/
│   └── chat/
│       ├── classify.py      ← 不变
│       └── analyze.py       ← 新建：Vercel handler
└── public/
    └── app.js               ← 修改：新增分析引擎 + 路由分支
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 分析计算在哪层做 | 前端（JS） | 数据已在内存中，前端计算零延迟；避免新建后端数据查询 API 的复杂度；符合 spec 的「仅用前端数据」约束 |
| 分析文字由谁生成 | LLM（通过后端代理） | LLM 能理解数据含义、发现模式、给出个性化建议；模板无法覆盖所有组合场景 |
| LLM 收到的数据量 | 仅统计摘要 JSON（≤1500 token） | 不发送原始 offer 列表，控制成本和隐私；摘要已包含所有分析所需的结构化指标 |
| LLM 分析端点 | 新建 POST /api/chat/analyze（独立于 classify） | 职责不同（分析 vs 分类），输入规模不同（8KB vs 2KB），超时不同（15s vs 5s），分开更清晰 |
| LLM provider 配置 | 复用 OI_LLM_PROVIDER / DEEPSEEK_API_KEY / ANTHROPIC_API_KEY | 与意图分类共享配置，减少运维复杂度；不引入新的环境变量 |
| 降级策略 | 表格始终渲染 + 文字降级为模板 | 分析的核心价值在结构化数据；模板文字虽简单但确保用户总能得到有用信息 |
| 分析意图的 LLM 参数提取 | 新增 analysisType 和 analysisTarget 字段 | 前端需要知道分析哪个维度和实体，LLM 最适合做这个抽取 |
| 正则 fallback 对 analysis 的支持 | 关键词检测（分析/评估/趋势/表现/怎么样） | 当 LLM 不可用时，简单关键词匹配作为兜底 |
| 图表库引入 | 不引入 | spec 明确不做可视化；保持前端零依赖；表格+文字足以满足描述性统计需求 |
| 国际化 | llm_classify 中通过 system prompt 指定输出语言 | 前端传 language 参数，后端在 prompt 中要求 LLM 输出中文或英文 |

## spec 需求覆盖检查

| spec 需求 | plan 覆盖 |
|-----------|----------|
| F1 新增 analysis 意图 | VALID_INTENTS + system prompt 更新 |
| F2 智能检测 | LLM system prompt 覆盖隐式触发词 + 正则 fallback |
| F3 商户分析 | analyzeMerchant() → AnalysisResult → 表格+Narrative |
| F4 品类分析 | analyzeCategory() → AnalysisResult → 表格+Narrative |
| F5 Tier 分析 | analyzeTier() → AnalysisResult → 表格+Narrative |
| F6 LLM 生成文字 | generate_analysis_text() + /api/chat/analyze |
| F7 混合呈现 | renderAnalysisTable() 即时 + renderAnalysisNarrative() 追加 |
| F8 LLM 降级 | fallbackAnalysisText() 模板生成 |
