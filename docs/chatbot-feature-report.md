# Chatbot 功能报告

> 生成日期：2026-07-09 · 分支：`feat/add-category-tables`

## 1. 概述

YeahPromos Offer Intelligence 内建了一个对话式 AI 助手，支持中英双语，覆盖商户查询、品类搜索、推荐排名、支付追踪、Tier 管理和数据分析。系统采用 **LLM 意图分类 + 规则引擎回答生成** 的混合架构，所有数据在页面加载时一次性载入前端内存，回答生成零网络延迟。

---

## 2. 架构

```
用户输入
    │
    ▼
┌─ 意图分类层 ──────────────────────────────────────────┐
│  POST /api/chat/classify                             │
│  后端 llm_classify.py → DeepSeek / Claude             │
│  返回 { intent, params }                              │
│  失败时透明降级到前端正则匹配                           │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌─ 路由与回答层（纯前端）───────────────────────────────┐
│  answerPrompt() → 按意图路由到对应回答函数              │
│  数据来源：window.CHATBOT_DATA / SHEET_REPORT_DATA    │
│  全部在浏览器内存中计算，毫秒级响应                     │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌─ 侧载补充层（异步，不阻塞主回答）─────────────────────┐
│  GET /api/ui/db/merchant → MySQL 月度指标、产品明细    │
│  GET /api/ui/db/search   → 商户名模糊搜索              │
└───────────────────────────────────────────────────────┘
```

### 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vanilla JS IIFE（无框架），~9,400 行 |
| LLM | DeepSeek Chat / Claude Haiku，通过 `llm_classify.py` 统一调用 |
| 后端 | Python + `http.server`（本地） / Vercel Serverless（生产） |
| 数据库 | MySQL（只读），通过 `offer_db.py` 动态列映射访问 |
| 样式 | 纯 CSS（变量系统、响应式） |
| 国际化 | 中英双语，`chatbot_i18n.js` 管理翻译和别名 |

---

## 3. 意图分类

系统支持 **7 种意图**，LLM 优先匹配，正则兜底。

| 意图 | 触发场景 | 示例 |
|------|---------|------|
| `asin` | 10 位 ASIN（B 开头） | `B0D2HKCMBP` |
| `merchant` | 商户名/ID 查询 | `Shokz`、`362653` |
| `payment` | 付款状态/周期/佣金 | `四月未付款有哪些` |
| `recommendation` | 推荐排名/筛选/排序 | `Tier 1 推荐 5 个 aov 高的` |
| `tier` | 查看某个 Tier | `Tier 2` |
| `category` | 品类查询 | `Electronics`、`美妆` |
| `analysis` | 数据分析/诊断/升降级 | `分析 Shokz`、`哪些 Tier 2 要升 Tier 1` |

### LLM 分类参数提取

LLM 不仅返回意图标签，还提取结构化参数，前端在回答生成时使用。支持提取的参数包括：

- **实体识别**：asin、merchantName、merchantId、category、tier
- **过滤条件**：metricFilters（AOV/EPC/CVR…）、paymentCycleFilter、paymentStatus、month
- **排序**：metricSort（按指标升/降序）
- **数量**：count、tierOfferPlan（多 Tier 组合）
- **分析类型**：analysisType（merchant/category/tier）、analysisTarget

---

## 4. 数据来源

### 静态数据（页面加载时一次性下载）

| 文件 | 大小 | 内容 | 对应变量 |
|------|------|------|---------|
| `protected_data/chatbot_data.js` | ~4MB | 所有商户指标、Tier、品类、支付记录 | `window.CHATBOT_DATA` → `offers[]` |
| `protected_data/sheet_report_data.js` | ~2.8MB | Tier Sheet 数据、目标值 | `window.SHEET_REPORT_DATA` |
| `protected_data/product_keywords.js` | ~2.9MB | 产品名关键词索引 | `window.PRODUCT_KEYWORDS` |

### 动态数据（每次对话异步补充）

| 端点 | 用途 | 触发条件 |
|------|------|---------|
| `GET /api/ui/db/merchant?merchantId=xxx` | 商户的 MySQL 月度指标和产品明细 | 精确匹配到商户 ID |
| `GET /api/ui/db/search?q=xxx` | 商户名模糊搜索 | 未匹配到商户 ID |

**关键特性**：主回答（第 2 步）100% 使用前端内存数据，DB 查询作为独立消息追加，不阻塞主回答渲染。

### 回答生成不传输原始数据

分析回答发送给 LLM 的是结构化的统计摘要（~2KB），而非原始 offer 数据。例如：

```json
{
  "type": "merchant",
  "target": { "name": "Shokz", "tier": "Tier 2", "category": "Electronics" },
  "metrics": { "epc": 2.35, "aov": 45.2, "conversionRate": 8.3 },
  "ranks": { "epc": { "percentile": 72, "totalInCategory": 45 } },
  "comparisons": { "vsCategory": { "epc": { "self": 2.35, "avg": 1.8, "delta": "+30.6%" } } }
}
```

---

## 5. 功能详情

### 5.1 商户查询（merchant）

- 通过商户名/ID 精确或模糊匹配
- 回答包含：Tier、品类、区域、佣金率、付款周期、AOV、EPC、CVR、订单量
- 附带推荐行为建议（`recommendedAction`）
- 自动加载 MySQL 产品明细（异步追加）

### 5.2 品类查询（category）

- 按主品类分组展示商户
- 支持主品类（Electronics）和子品类（Open-Ear Headphones）
- 品类优先级链：Google Sheet → mainCategory → Feishu → Levanta → Uncategorized

### 5.3 推荐排名（recommendation）

系统最复杂的意图，支持多维度组合：

| 能力 | 示例 |
|------|------|
| 按 Tier 推荐 | `Tier 1 推荐 10 个` |
| 按品类推荐 | `美妆品类推荐 5 个` |
| 指标过滤 | `epc > 2 aov > 100 推荐` |
| 指标排序 | `转化率最高的 5 个` |
| 多 Tier 组合 | `Tier 1 2个 Tier 2 3个` |
| 推荐包管理 | 排除/替换某个 offer，支持增量替换 |
| Excel 下载 | 每次推荐附带下载按钮 |

推荐算法（`recommendationScore`）综合考虑：
- Tier 优先级（Tier 1 > 2 > 3 > 4，BLACK TIER 排除）
- 订单量（`log10(orders + 1) × 12`）
- 点击量（`log10(clicks + 1) × 3`）
- 转化率（`CVR × 260 × confidence`）
- EPC（`min(EPC, 5) × 8 × confidence`）
- 收入（`min(sales, 100000) / 12000`）

### 5.4 支付查询（payment）

- 按月份/Tier/状态筛选
- 支持付款周期过滤（`付款周期少于 30 天`）
- 支付状态：Paid / Pending / Unpaid / Overdue / Partial
- 零收入+零佣金的占位记录自动过滤
- Excel 导出

### 5.5 关键词搜索（keyword）

- ASIN 级别产品关键词模糊匹配
- 基于 `window.PRODUCT_KEYWORDS` 索引
- 支持中英文关键词、同义词组
- 返回匹配商户及推荐排名

### 5.6 数据分析（analysis）

支持**商户**、**品类**、**Tier** 三个维度的描述性分析：

**商户分析**
- 核心指标表 + 品类内百分位排名
- 横向对比（vs 品类均值 / vs Tier 均值 / vs 全站均值）
- 强弱项识别（百分位 > 70 = 亮点，< 30 = 短板）
- 同类商户对比表（Top 3 peers）
- 支付风险评估
- LLM 生成的自然语言分析 + 行动建议

**品类分析**
- 品类概览（商户数、总收入/佣金/订单、平均指标）
- 与全站均值对比
- 品类内 Top 5 / Bottom 3 排名
- Tier 分布
- LLM 生成品类健康度评估

**Tier 分析**
- 层级概览（聚合统计）
- 跨 Tier 对比（与每个其他 Tier 的指标差异）
- 三段分化（头部 20% / 中部 60% / 尾部 20%）
- 异常值识别（EPC/CVR 远超同级均值）
- LLM 生成升降级建议

**触发方式**
- 显式：`分析 Shokz`、`评估 Tier 2`
- 隐式：`Shokz 最近怎么样`、`美妆什么趋势`
- 升降级：`哪些 Tier 2 要升 Tier 1`

**降级机制**：LLM API 不可用时，表格正常渲染，文字部分降级为基于数据特征的模板结论。

---

## 6. 用户界面

### 聊天区域
- 消息气泡（用户/助手）
- 加载状态提示（`正在理解你的问题…`）
- 分析回答中表格即时渲染，LLM 文字异步追加

### 上下文面板
- 右侧信息面板，根据当前对话上下文展示：
  - 商户详情（指标、Tier、品类…）
  - 品类概览（聚合统计、排名…）
  - Tier 概览
  - 关键词搜索结果汇总
  - 推荐包摘要

### Excel 导出

| 导出类型 | 触发方式 |
|------|------|
| 推荐结果下载 | 推荐回答附带的下载按钮 |
| 支付数据下载 | 支付页面导出 |
| Tier Sheet 下载 | Tier 管理页面导出 |
| 目标数据下载 | 目标页面导出 |
| 品类报告下载 | Dashboard 品类报告导出 |

### 多语言
- 界面语言切换（中/英），影响所有回答模板和 UI 文本
- LLM 分析文字根据当前语言生成

---

## 7. 配置文件

### LLM 配置

| 环境变量 | 用途 | 默认值 |
|------|------|------|
| `OI_LLM_PROVIDER` | LLM 提供商（`deepseek` / `claude`） | `deepseek` |
| `DEEPSEEK_API_KEY` | DeepSeek API key | — |
| `ANTHROPIC_API_KEY` | Claude API key | — |
| `OI_LLM_MODEL_DEEPSEEK` | DeepSeek 模型名 | `deepseek-chat` |
| `OI_LLM_MODEL_CLAUDE` | Claude 模型名 | `claude-haiku-3-5-latest` |
| `OI_LLM_TIMEOUT` | API 超时（秒） | `15` |

### 功能开关

| 环境变量 | 用途 |
|------|------|
| `OI_LLM_ENABLED` | `0` 时禁用 LLM，全部走正则意图匹配 |
| `OI_AUTH_ENABLED` | `0` 时跳过登录验证 |

---

## 8. API 端点

| 端点 | 方法 | 认证 | 用途 |
|------|------|------|------|
| `/api/auth/login` | POST | 无 | 管理员登录 |
| `/api/auth/session` | GET | Session | 检查登录状态 |
| `/api/auth/logout` | POST | Session | 登出 |
| `/api/auth/data` | GET | Session | 获取受保护数据 |
| `/api/chat/classify` | POST | Session | LLM 意图分类（≤2KB body） |
| `/api/chat/analyze` | POST | Session | LLM 分析文字生成（≤8KB body） |
| `/api/ui/db/merchant` | GET | Session | DB 商户月度指标查询 |
| `/api/ui/db/search` | GET | Session | DB 商户名搜索 |
| `/api/ui/db/status` | GET | Session | DB 迁移状态 |
| `/api/levanta/payments` | GET/POST | Token | Levanta 付款数据同步 |
| `/api/tier_moves` | POST | Session | Tier 变更（→ Google Apps Script） |

---

## 9. 文件清单

```
public/
├── app.js                   ← 主应用（~9,400 行）：意图路由、回答生成、分析引擎
├── auth.js                  ← 登录认证、Session 管理、LLM 开关
├── chatbot_i18n.js          ← 中英双语：翻译、别名、意图模式
├── tier2_recommendation_rules.js ← Tier 2 推荐规则
├── styles.css               ← 全局样式（~4,600 行）+ 分析表格样式
├── index.html               ← 入口页面
└── protected_data/
    ├── chatbot_data.js      ← 商户数据快照
    ├── sheet_report_data.js ← Sheet 数据快照
    └── product_keywords.js  ← 产品关键词快照

llm_classify.py              ← LLM 调用层：意图分类 + 分析文字生成
server.py                    ← 本地开发服务器（所有路由）
api/
├── chat/
│   ├── classify.py          ← /api/chat/classify Vercel handler
│   └── analyze.py           ← /api/chat/analyze Vercel handler
├── auth/
│   ├── login.py / session.py / logout.py / data.py
└── db/
    ├── status.py / merchant.py / search.py

specs/
├── 001-llm-intent-classifier/  ← LLM 意图分类 Spec
└── 002-chatbot-data-analysis/  ← Chatbot 数据分析 Spec
```

---

## 10. 已知限制与后续方向

### 当前限制
- **无趋势分析**：仅使用当前月份快照，不支持时间序列、环比/同比
- **无图表**：未引入图表库，分析结果以表格呈现
- **无多轮对话记忆**：每次提问独立处理，不支持"还有吗？"等追问
- **数据为静态快照**：需定期重新构建 `protected_data/` 文件以更新数据
- **无支付维度分析**：分析功能尚未覆盖支付维度
- **LLM 依赖网络**：分析文字生成需要 API 调用，超时 15 秒

### 建议后续方向
1. **时间序列分析**——接入 DB 历史数据，支持月度趋势、环比增长
2. **数据可视化**——引入轻量图表库，为分析回答增加 SVG 图表
3. **多轮对话**——利用 LLM 维护对话上下文，支持追问和深入分析
4. **支付分析**——为支付维度增加分析能力（逾期率趋势、商户付款行为聚类）
5. **自动洞察**——定时推送异常检测报告（高价值商户流失预警、品类异动）
