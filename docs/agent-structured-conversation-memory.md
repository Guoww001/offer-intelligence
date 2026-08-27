# Agent 结构化对话记忆实现说明

> 更新日期：2026-08-27
> 适用范围：Dashboard → Agent 独立对话页面
> 关联实现：`fix/revenue-flow-tooltip-hover` 分支中的 4.5 首期实现

本文单独说明路线图 4.5“对话记忆从文本历史升级为结构化状态”的实现方式、数据边界和使用效果。

## 1. 功能概述

Agent 原来主要依赖当前页面内的成功问答文本。页面刷新后，这些文本历史会丢失；即使没有刷新，继续把整段历史发送给模型也会受到字符长度限制。

4.5 首期将这部分上下文改造成一个版本化的结构化状态。它保存的是“后续查询需要知道的业务上下文”，而不是完整聊天记录。

保存后的上下文可以帮助 Agent 继续理解：

- 最近查询的是哪个商户；
- 商户的标准 ID 和标准名称是什么；
- 当前关注的品类和 Tier；
- 最近使用的月份范围和指标名称；
- 最近一次工具查询的数据来源和快照时间；
- 歧义商户候选中哪些已确认、哪些已拒绝。

结构化记忆只用于指代消解和查询范围补全。EPC、订单、收入、付款金额等当前数值不会从记忆中直接复用，相关问题仍必须重新调用数据工具。

## 2. 首期实现范围

### 已实现

- 页面刷新后恢复一个活动 Agent 上下文；
- 同一轮多个工具结果合并；
- 新一轮成功查询替换上一轮活动焦点；
- 歧义商户候选进入 `pending`，用户明确选择后转为 `confirmed/rejected`；
- 结构化状态的版本校验、7 天过期、长度限制和存储异常降级；
- 新对话清除页面内存和本地存储；
- 退出登录前清除 Agent 结构化记忆；
- 欢迎区显示“已恢复上下文”；
- 中文和英文的受控记忆文本；
- 新增独立回归测试并接入 CI。

### 暂未实现

- 会话列表；
- 完整历史消息恢复；
- 多个独立会话并行保存；
- 跨设备同步；
- 分享和独立会话删除；
- 将 Agent 记忆保存到数据库或服务端。

## 3. 架构和数据流

```text
页面加载
  -> agent_memory_state.js
  -> load(localStorage)
  -> state.agentPage.memory
  -> Agent 欢迎区显示恢复提示

提交问题
  -> handleAgentPageSubmit()
  -> agentPageMemoryText()
  -> runChatAgent(memoryText + 当前问题)
  -> 浏览器执行只读工具
  -> agentMemoryEventsFromToolResults()
  -> 返回安全 memoryEvents
  -> 成功 outcome 后 commitAgentPageMemory()
  -> applyEvents()
  -> save(localStorage)

下一轮问题
  -> 读取结构化上下文
  -> 解析“它/这个商户/同一 Tier”等指代
  -> 重新调用数据工具获取当前数据

新对话 / 退出登录
  -> clear()
  -> 删除页面内存和 localStorage 状态
```

实现分为两层：

1. `public/agent_memory_state.js` 负责状态合同、归一化、存储、过期和文本投影；
2. `public/app.js` 负责从工具结果提取业务上下文，并在回合成功后提交事件。

这样可以把“哪些字段允许持久化”集中在一个小模块中，避免 `app.js` 将完整工具结果或回答正文直接写入浏览器存储。

## 4. 状态模块

### 4.1 文件和公开接口

文件：`public/agent_memory_state.js`

模块通过 `window.AGENT_MEMORY_STATE` 暴露以下函数：

| 函数 | 作用 |
| --- | --- |
| `empty()` | 创建完整的空状态 |
| `normalize()` | 按 schema 和字段白名单重建状态 |
| `applyEvents()` | 应用工具成功事件和候选事件 |
| `hasMeaningfulContext()` | 判断是否存在可保存的上下文 |
| `load()` | 读取并校验 `localStorage` 状态 |
| `save()` | 限制长度后保存状态 |
| `clear()` | 删除结构化记忆 |
| `toPromptText()` | 生成给 Agent 使用的中英文上下文 |
| `toDisplayText()` | 生成欢迎区的恢复提示 |

存储键为：

```text
oi_agent_memory_v1
```

当前 schema 版本为 `1`，默认有效期为 7 天，序列化状态上限为 12000 字符。

### 4.2 状态 schema

下面是说明用示例，不代表真实业务数据：

```json
{
  "version": 1,
  "updatedAt": "2026-08-27T08:00:00.000Z",
  "focus": {
    "merchants": [
      { "id": "398679", "name": "Tapo" }
    ],
    "categories": ["Electronics"],
    "tiers": ["Tier 1"]
  },
  "query": {
    "startMonth": "2026-01",
    "endMonth": "2026-08",
    "months": 8,
    "metrics": ["epc", "conversionRate"]
  },
  "lastTool": {
    "toolName": "merchant_analysis",
    "headline": "Tapo overview",
    "dataSource": "database",
    "dataAsOf": "2026-08-27T07:40:00Z",
    "estimated": false,
    "partial": false
  },
  "candidates": {
    "pending": [],
    "confirmed": [
      { "type": "merchant", "id": "398679", "name": "Tapo" }
    ],
    "rejected": []
  }
}
```

### 4.3 字段限制

| 字段 | 保存内容 | 限制 |
| --- | --- | --- |
| `focus.merchants` | 商户 ID 和标准名称 | 最多 5 个 |
| `focus.categories` | 品类名称 | 最多 4 个 |
| `focus.tiers` | Tier 名称 | 最多 5 个 |
| `query.startMonth/endMonth` | 起止月份 | 必须是合法 `YYYY-MM` |
| `query.months` | 月份数量 | 1–24 |
| `query.metrics` | 指标名称 | 最多 12 个 |
| `lastTool.toolName` | 最近工具名 | 长度受限 |
| `lastTool.headline` | 受控摘要 | 最多 240 字符 |
| `lastTool.dataSource` | 数据来源 | `cache/database/mixed/unknown` |
| `lastTool.dataAsOf` | 数据快照时间 | 长度受限，没有则为 `null` |
| `candidates.*` | 候选实体决策状态 | 每组最多 10 个 |

所有字符串都会经过裁剪、去重和白名单归一化。版本不匹配、JSON 损坏、状态过期或状态过长时，模块会删除坏值并返回空状态。

## 5. 工具结果到 memory event 的转换

`app.js` 不会把原始 `toolResults` 直接交给页面状态，而是通过以下步骤进行投影：

1. 从工具结果中识别工具名和业务实体；
2. 商户通过统一的 `agentResolveMerchant()` 获取标准 ID 和名称；
3. 只提取指标名称，例如 `epc`、`aov`、`conversionRate`、`orders`；
4. 从真实月度数据、过滤条件或最新月份提取时间范围；
5. 从 Trace 元数据读取来源、快照时间和估算标识；
6. 生成不包含原始结果对象的安全 event。

### 5.1 各工具保存的焦点

| 工具 | 保存的上下文 |
| --- | --- |
| `merchant_analysis` | 当前商户，以及商户的品类和 Tier |
| `merchant_comparison` | 对比结果中所有已解析商户 |
| `category_analysis` | 当前品类 |
| `category_comparison` | 对比品类和可选 Tier 过滤 |
| `tier_analysis` | 当前 Tier |
| `payment_status` | 付款过滤中的商户和 Tier |
| `trend` | 根据 `entityType` 保存商户、品类或 Tier |

### 5.2 同轮合并和跨轮替换

- 同一轮有多个成功工具结果时，先清除上一轮活动焦点，再合并本轮所有实体、范围和指标；
- 新一轮只有候选事件时，不会覆盖上一份有效焦点；
- 新一轮出现成功工具结果时，活动焦点切换到新一轮查询；
- 最后一个有效工具成为 `lastTool`；
- 重复实体按 `type + id` 去重，没有 ID 时按 `type + name` 去重。

这一规则可以避免用户连续查询不同商户后，记忆中的商户集合无限增长，也避免新的查询继续误用旧商户范围。

### 5.3 歧义候选状态

当商户名称匹配多个候选时，Agent 不会选择第一项。安全 event 只包含候选实体：

```json
{
  "kind": "candidates",
  "candidates": [
    { "type": "merchant", "id": "1001", "name": "Alpha" },
    { "type": "merchant", "id": "1002", "name": "Alpha Home" }
  ]
}
```

用户随后通过商户 ID 或完整名称明确查询后：

- 选中的候选进入 `confirmed`；
- 其他候选进入 `rejected`；
- `pending` 清空；
- 后续追问可以使用已确认的标准实体。

## 6. Agent 页面生命周期

### 6.1 页面加载和刷新

`public/index.html` 在 `auth.js` 之前加载 `agent_memory_state.js`。`app.js` 初始化 Agent 状态时调用 `load(localStorage)`。

如果读取到有效状态，Agent 欢迎区显示类似：

```text
已恢复上下文：Tapo (ID 398679) · Electronics · Tier 1 · 2026-01–2026-08 · epc / conversionRate
```

刷新页面不会清理状态。

### 6.2 提交问题

页面提交时，`agentPageMemoryText(language)` 将状态投影为受控文本，并传给 `runChatAgent()`。该文本可以进入规划阶段和综合阶段，但不会包含完整聊天历史或工具明细。

### 6.3 成功和失败处理

只有满足以下条件时，页面才提交新的 memory event：

```js
outcome && outcome.handled && outcome.ok === true
```

具体行为如下：

| 场景 | 是否更新结构化记忆 |
| --- | --- |
| 正常工具查询和综合成功 | 是 |
| 工具完成、自然语言综合失败但生成受控 fallback | 是，可保存已完成工具上下文 |
| 无工具的直接回答 | 否，返回空事件 |
| 规划失败 | 否 |
| 网络异常 | 否 |
| 用户中止 | 否 |

因此，一次失败或中止不会覆盖之前已经有效的 Agent 上下文。

### 6.4 新对话和退出登录

点击“新对话”会同时清除：

- `state.agentPage.history`；
- `state.agentPage.memory`；
- `localStorage.oi_agent_memory_v1`。

退出登录时，`auth.js` 会在页面 reload 前调用同一个 `clear()`。退出请求失败不会阻止本地记忆清理。

## 7. 持久化和隐私边界

### 7.1 会保存的内容

- 商户 ID、标准名称、品类和 Tier；
- 月份范围和指标名称；
- 最近工具名称和受控摘要；
- 数据来源、快照时间、估算状态和部分执行状态；
- 候选实体及其 `pending/confirmed/rejected` 状态。

### 7.2 明确不会保存的内容

- 原始用户 Prompt；
- 完整问答历史；
- 助手回答正文；
- 指标数值对象；
- 月度明细行和付款明细行；
- 完整工具参数；
- 完整工具结果和 Provider 原始 JSON；
- 异常正文和异常堆栈；
- Agent Trace 的原始载荷。

这意味着 4.5 不需要：

- 新增数据库表；
- 新增数据库字段或 DDL；
- 新增后端 API；
- 新增数据库权限；
- 修改 Agent Trace 表或 Trace payload。

## 8. 与其他上下文能力的区别

| 能力 | 用途 | 保存位置 | 与 4.5 的关系 |
| --- | --- | --- | --- |
| Agent 结构化记忆 | 跨刷新恢复实体和查询范围 | 浏览器 `localStorage` | 本文主题 |
| `state.agentPage.history` | 当前页面内保存成功问答配对 | 页面内存 | 保留原行为，不持久化 |
| Report Mode `reportSnapshot` | 复用报告、推荐和导出 | 现有 Report Mode 状态 | 不改动 |
| Agent Trace | 记录阶段、工具、耗时和来源 | Trace 数据库表 | 不复用、不改动 |
| 提问日志 | 记录提问事件、模式和完成状态 | 提问日志表 | 独立能力 |

4.5 不会把 Report Mode 的报告记忆快照误当作 Agent 当前查询上下文，也不会把 Agent 结构化状态写入 Trace 表。

## 9. 用户可观察的例子

### 例 1：刷新后追问趋势

1. 用户询问：“查询 Tapo 的 EPC 和转化率。”
2. Agent 成功查询后保存 Tapo 的标准 ID、指标名、月份和来源摘要。
3. 用户刷新页面，欢迎区显示“已恢复上下文”。
4. 用户追问：“那它最近 6 个月的 EPC 趋势呢？”
5. Agent 使用已恢复的 Tapo 上下文生成 `trend` 工具调用，并重新获取趋势数据。

### 例 2：歧义商户

1. 用户输入可能匹配多个商户的名称。
2. Agent 返回候选 ID 和名称，不擅自选择第一项。
3. 候选进入 `pending`。
4. 用户使用商户 ID 重新查询。
5. 选中商户进入 `confirmed`，未选候选进入 `rejected`。

### 例 3：新对话

用户点击“新对话”后，页面内存和本地存储都会清空。刷新后不再显示上一轮的恢复提示，下一次问题也不会继承旧商户。

## 10. 测试和验收

### 自动化测试

```powershell
node --check public/agent_memory_state.js
node --check public/auth.js
node --check public/app.js
node scripts/test_agent_memory_state.mjs
node scripts/test_chat_agent.mjs
node scripts/test_agent_trace.mjs
node scripts/test_agent_question_logging.mjs
```

结构化记忆测试覆盖：

- schema v1 和完整空状态；
- 同轮合并和跨轮替换；
- 商户、品类、Tier 和指标投影；
- 候选确认、拒绝和去重；
- Prompt、回答、数值、明细行和错误正文剔除；
- 7 天过期、版本失配和损坏 JSON；
- `localStorage` 读写异常；
- 中英文 Prompt 和恢复提示；
- 页面清除和 CI 加载顺序。

### 当前验证边界

自动化测试可以证明状态合同和页面接入逻辑，但不能替代真实浏览器中的登录、刷新和后端数据请求验证。BrowserAct 验收需要可用的浏览器会话和 BrowserAct API key；环境不具备这些条件时，不应宣称浏览器验收已通过。

## 11. 后续扩展建议

如果继续推进 4.5，建议按以下顺序扩展：

1. 为活动上下文增加会话 ID；
2. 支持多个会话的列表、切换和显式删除；
3. 为跨设备同步设计服务端数据合同和权限边界；
4. 再评估分享、审计和敏感信息处理规则。

无论后续是否迁移到服务端，都应继续采用白名单投影，不把完整 Prompt、回答正文、工具明细和异常堆栈作为长期记忆保存。
