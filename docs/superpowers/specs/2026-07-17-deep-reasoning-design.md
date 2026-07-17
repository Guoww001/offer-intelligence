# 深度推理模式（Deep Reasoning）设计文档

> 日期：2026-07-17 · 状态：已批准设计 · 分支：`main`

---

## 1. 概述

在现有快速聊天机器人模式（Fast Mode）基础上，新增**深度推理模式（Deep Reasoning Mode）**，用于处理需要自然语言驱动的数据对比、趋势分析、多维交叉分析等复杂场景。快模式保持不动，深模式通过按钮切换独立使用。

---

## 2. 架构

```
用户选择"深度推理"模式 → 输入问题 → 发送
    │
    ▼ POST /api/chat/analyze { prompt, mode: "deep" }
    │
┌─ 后端 deep_reason.py ─────────────────────────────────┐
│                                                        │
│  Stage 1: 需求拆解 (LLM)                               │
│  分析用户问题 → 输出结构化查询计划 JSON                  │
│                                                        │
│  Stage 2: 数据执行 (Python)                             │
│  按查询计划执行数据获取                                  │
│  优先使用 JSON 缓存文件（无需历史趋势）                   │
│  需要历史数据时查询 MySQL                               │
│                                                        │
│  Stage 3: 报告生成 (LLM)                                │
│  读取数据 → 生成结构化分析报告 JSON                      │
│                                                        │
│  Stage 4: 返回前端                                      │
│  → { title, summary, sections: [...] }                 │
└────────────────────────┬──────────────────────────────┘
                         │
                         ▼
┌─ 前端 ─────────────────────────────────────────────────┐
│  全屏覆盖层渲染报告                                      │
│  关闭覆盖层 → 聊天流插入摘要消息                          │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 用户交互

### 3.1 模式切换

聊天框上方新增切换按钮：

```
[快速模式 ●]  [深度推理 ○]
```

- 默认选中"快速模式"
- 选中"深度推理"时输入框 placeholder 变为"输入复杂分析问题（支持对比、趋势、多维分析…）"
- 切换不丢失当前聊天内容

### 3.2 加载状态

发送后立即打开全屏覆盖层，显示骨架屏：
- "正在理解你的问题…"（~1-2s）
- "正在查询数据…"（~1-5s）
- "正在生成分析报告…"（~2-5s）

每个阶段完成后更新进度文本。

### 3.3 报告展示

全屏覆盖层内容结构：

```
┌─────────────────────────────────────────────┐
│ ✕ 关闭                            导出 PDF  │
├─────────────────────────────────────────────┤
│ 📊 标题行                                   │
│                                             │
│ ┌─ 核心结论 ────────────────────────────┐   │
│ │ 一句到两句话的关键发现                   │   │
│ └───────────────────────────────────────┘   │
│                                             │
│ ┌─ 分析章节（多个，按需）───────────────┐   │
│ │ 概览 / 对比 / 趋势 / 异常 / 建议        │   │
│ │ 每个章节包含：标题 + 要点列表 + 可选表格  │   │
│ └───────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### 3.4 关闭与历史

- 关闭方式：点击 ✕ 按钮 或 按 Esc
- 关闭后在聊天流中插入一条摘要消息，格式：

  ```
  📊 深度分析：「Shokz vs Anker 对比分析」
  结论：Shokz EPC 领先品类均值 35% 但 AOV 呈下降趋势
  ```

- 点击摘要可重新打开覆盖层查看完整报告

---

## 4. 后端 — Stage 1：需求拆解

### 4.1 接口

文件：`deep_reason.py` → `def parse_query(prompt: str) -> dict`

调用 LLM 分析用户问题，输出查询计划 JSON。

### 4.2 LLM Prompt

```
你是一个电商数据分析师，负责将用户的问题转化为结构化的数据查询计划。
输出 JSON 格式，只包含以下字段：

{
  "analysisType": string,       // 分析类型
  "entityType": "merchant" | "category" | "tier",
  "entities": [string],         // 需要分析的目标实体名称
  "metrics": [string],          // 指标列表
  "timeRange": { "months": int },  // 时间范围（月）
  "comparisonType": string | null, // "vs_category" / "vs_tier" / "vs_each_other"
  "filters": {},                // 可选过滤条件
  "analysisGoal": string        // 一句话描述分析目的
}

已知指标：epc, aov, orders, clicks, salesAmount, conversionRate,
          commissionRate, affCommission, dpv, atc, paymentCycle,
          paymentStatus

注意：禁止编造商户名或品类名，只使用用户提到的实体名称。
```

### 4.3 校验规则

| 字段 | 校验 |
|------|------|
| `entities` | 非空，最多 10 个 |
| `metrics` | 只含已知指标名 |
| `timeRange.months` | 1-24 |
| `entityType` | 只允许三个值 |

校验失败 → 返回错误提示并要求用户重新描述（附带示例）。

---

## 5. 后端 — Stage 2：数据执行

### 5.1 数据源优先级

```
查询计划
    │
    ▼
是否需要历史趋势数据（timeRange.months > 2）？
    │
    ├─ 否 → JSON 缓存文件
    │        ├─ db_offers_cache.json → 商户/品类/Tier 当前快照
    │        └─ db_keywords_cache.json → 产品关键词关联
    │
    └─ 是 → MySQL 查询
             ├─ oi_offer_monthly_amazon_metrics → 月度历史指标
             ├─ oi_offer_monthly_aggregate_metrics → 聚合指标
             └─ oi_levanta_monthly_metrics → 付款历史
```

### 5.2 JSON 缓存能覆盖的场景

| 场景 | 使用缓存 |
|------|---------|
| "Shokz 当前 EPC 在品类中的排名" | ✅ |
| "Tier 2 中美妆商户 AOV 对比" | ✅ |
| "各品类在 Tier 1-3 的分布" | ✅ |
| "美妆品类中 EPC 最高的 3 个商户" | ✅ |
| "对比 Anker 和 Shokz 的 EPC" | ✅ |
| "Shokz 和 Anker 过去 6 个月的 EPC 趋势" | ❌ 需 MySQL |
| "Tier 2中有逾期付款记录的商户占比趋势" | ❌ 需 MySQL |

### 5.3 JSON 缓存使用方式

```python
def load_offers_cache() -> list:
    """加载 db_offers_cache.json，返回 offers 列表"""
    ...

def analyze_snapshot(offers: list, plan: dict) -> dict:
    """在内存中做过滤、分组、聚合、排序，返回结构化结果"""
    ...
```

### 5.4 MySQL 查询方式

```python
def query_merchant_history(merchant_ids, metrics, months) -> dict:
    """查询商户历史月度指标"""
    ...

def query_category_history(categories, metrics, months) -> dict:
    """查询品类历史聚合指标"""
    ...

def query_tier_history(tiers, metrics, months) -> dict:
    """查询 Tier 历史聚合指标"""
    ...
```

### 5.5 数据量控制

- 返回给 LLM 的数据总量控制在 ~5KB
- 商户级别：最多 24 个月 + Top 5 对比实体
- 聚合计算在 SQL 中完成，不传输原始行

### 5.6 错误处理

- DB 超时（10s）→ 返回部分数据 + 标记"部分结果"
- 无数据 → 返回空，Stage 3 生成"数据不足以分析"
- DB 连接失败 → 直接返回错误给前端

---

## 6. 后端 — Stage 3：报告生成

### 6.1 接口

```python
def generate_report(data: dict, plan: dict, language: str) -> dict:
    """将结构化数据 + 查询计划送入 LLM，返回分析报告"""
```

### 6.2 LLM Prompt

```
你是一个电商数据分析师。你将收到一组结构化数据，请基于这些数据生成分析报告。

输出 JSON 格式：
{
  "title": "分析标题（<50字）",
  "summary": "核心结论（1-2句话）",
  "sections": [
    {
      "type": "overview" | "comparison" | "trend" | "anomaly" | "recommendation",
      "title": "章节标题",
      "findings": ["关键发现1", "关键发现2", ...],
      "table": {                   // 可选
        "headers": ["列名1", "列名2"],
        "rows": [["值1", "值2"], ...]
      },
      "severity": "high" | "medium" | "low"  // 仅 anomaly 类型
    }
  ]
}

规则：
- 只使用提供的数据，不要编造数字
- 每个 finding 要包含具体数值
- findings 数量 2-5 条
- 中文输出
```

### 6.3 降级策略

| 情况 | 行为 |
|------|------|
| LLM 超时/失败 | 纯数据表格展示，无分析文字 |
| 数据不足 | LLM 返回"当前数据不足以分析" + 已有数据概览 |
| 返回 JSON 格式错误 | 解析失败时降级为纯数据展示 |
| 部分数据可用 | 使用可用数据生成"部分分析"并标记局限性 |

---

## 7. 前端

### 7.1 文件修改

| 文件 | 变更 |
|------|------|
| `public/index.html` | 新增模式切换按钮 HTML、全屏覆盖层容器 |
| `public/app.js` | 新增 `state.deepMode`、覆盖层渲染逻辑、请求分发、摘要插入 |
| `public/styles.css` | 覆盖层样式、切换按钮样式、骨架屏动画 |

### 7.2 关键状态

```javascript
state.deepMode = false;          // 是否处于深度推理模式
state.deepReport = null;         // 当前深度分析报告
state.deepHistory = [];          // 历史深度分析摘要列表
```

### 7.3 请求流程

用户消息先追加到聊天流（与快模式一致），再打开覆盖层。

```javascript
async function submitDeepReasoning(prompt) {
  // 1. 打开全屏覆盖层，显示骨架屏
  openOverlay();
  updateOverlayProgress("正在理解你的问题…");
  
  // 2. 发送请求
  const response = await fetch("/api/chat/analyze", {
    method: "POST",
    body: JSON.stringify({ prompt, mode: "deep", language })
  });
  
  if (!response.ok) {
    showOverlayError("分析失败，请稍后重试");
    return;
  }
  
  // 3. 渲染报告
  const report = await response.json();
  renderDeepReport(report);
  
  // 4. 插入聊天摘要
  addMessage("assistant", deepSummaryHtml(report));
}

function closeOverlay() {
  // 关闭覆盖层，聊天流中已有摘要
}
```

### 7.4 覆盖层渲染

```javascript
function renderDeepReport(report) {
  overlayTitle.textContent = report.title;
  overlaySummary.textContent = report.summary;
  overlayBody.innerHTML = report.sections.map(renderSection).join("");
  // 每个 section 根据 type 渲染不同的 HTML 卡片
}
```

### 7.5 导出功能

- 覆盖层提供"导出"按钮
- 将报告内容导出为 PDF（通过 `window.print()` 或 HTML 转 PDF）

---

## 8. 后端文件清单

| 文件 | 状态 | 说明 |
|------|------|------|
| `deep_reason.py` | **新增** | 编排器：Stage 1→2→3 主逻辑 |
| `server.py` | **修改** | 在 `/api/chat/analyze` 处理分支增加 `mode === "deep"`；不新增路由 |
| `api/chat/analyze.py` | **修改** | `do_POST` 中增加 `mode === "deep"` 分支 |
| `llm_provider.py` | 复用 | LLM 调用共享 |
| `offer_db.py` | 复用 | MySQL 查询共享 |

**不修改的文件**（快模式保持完整）：

- `llm_classify.py`
- `skills/*.py`
- `public/chatbot_i18n.js`
- `public/auth.js`

---

## 9. 测试计划

| 测试 | 方式 |
|------|------|
| `parse_query()` prompt 输出格式验证 | 单元测试：mock LLM 返回各种 JSON |
| JSON 缓存加载 + 内存分析正确性 | 使用现有 `db_offers_cache.json` 测试 |
| MySQL 查询正确性 | 集成测试（需要 DB 连接） |
| 端到端流程 | `POST /api/chat/analyze {mode:"deep"}` 全链路 |
| 降级路径 | mock LLM 失败 → 验证纯数据展示 |
| 前端覆盖层 | 打开/关闭/摘要插入/重新查看 |

---

## 10. 排除范围（明确不做）

- **多轮对话**：深模式每次请求独立，不维护上下文
- **数据可视化图表**：覆盖层仅用表格 + 文本，无 SVG 图表
- **定时推送**：不实现自动洞察推送
- **支付分析**：本期不覆盖付款维度的时间序列分析（可后续扩展）
