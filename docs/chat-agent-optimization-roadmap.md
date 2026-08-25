# Chat Agent 优化与扩展方案

> 审查日期：2026-08-21
> 审查范围：Agent 规划、工具执行、综合、上下文、趋势图、历史、中止、日志、反馈、测试和 Dashboard 交互
> 当前状态：审查结论与实施建议；截至 2026-08-25，P0.1 综合请求读取上限、P0.2 工具调用批处理、P0.3 可验证数据来源边界和 P0.4 实体/过滤失败关闭已完成实现并通过定向回归测试

## 1. 当前能力基线

当前 Chat Agent 已经具备可用的双阶段 Agent 流程：

1. 前端整理问题、历史和上下文，调用 `/api/chat/agent` 进行规划。
2. 浏览器执行只读工具，并压缩工具结果。
3. 调用 `/api/chat/stream` 流式生成最终回答。
4. Agent 页面展示规划、工具查询、综合和最终状态。

目前已经实现的能力包括：

- 7 个只读工具：商户分析、品类分析、商户对比、Tier 分析、品类对比、付款查询和趋势查询。
- 规划最多 2 轮，总计最多 6 个工具调用；每批最多并行 4 个工具，超过 4 个时继续分批执行。
- 规划上下文和综合上下文分离，并对历史、记忆和工具结果进行裁剪。
- 商户输入包含 ID 和名称时优先按 ID 查询。
- 失败或中止时不把本轮用户消息写入正式历史。
- 综合失败时保留已完成的工具数据，并提供确定性降级回答。
- Agent 生成期间发送按钮切换为蓝色中止按钮。
- Agent 趋势结果支持月度 SVG 折线图、数据来源标识和指标切换。
- Agent 提问写入日志，成功回答支持“不满意”反馈。

相关架构说明见 [`docs/chatbot-feature-report.md`](chatbot-feature-report.md) 和 [`docs/superpowers/specs/2026-08-14-chat-mode-agent-design.md`](superpowers/specs/2026-08-14-chat-mode-agent-design.md)。

## 2. 结论摘要

当前 Agent 已经可以支持日常查询。本轮已完成请求大小和工具调用截断修复；继续增加工具前仍应优先处理以下问题：

- 已完成：综合请求配置与实际读取限制统一。
- 已完成：超过单批并行上限的查询按批次执行，并对超过总预算的目标显式提示。
- 已完成：具体数据问题在没有可验证来源时不再直接采用模型文本；已有上下文、用户提供的数据和工具失败结果仍可用于说明。
- 已完成：模糊实体和非法过滤条件统一失败关闭，不再静默放大查询范围。
- 品类/Tier 趋势存在浏览器端 N+1 查询和部分数据覆盖率不透明问题。
- 日志缺少阶段、工具、耗时、数据来源和 Token 等运行指标。
- 一部分 Agent 回归测试没有进入 CI，且源码字符串测试对 Windows 换行格式敏感。

这些问题的共同风险是：回答表面上正常，但用户无法发现数据不完整、范围错误或结果来自不同数据快照。

## 3. P0：扩展前必须处理

### 3.1 修复 128KB 综合请求实际只有 64KB 的问题（已完成）

根因是 `chat_agent_http.py` 定义了 `AGENT_SYNTHESIS_MAX_REQUEST_BYTES = 128 * 1024`，但 `auth._read_json_body()` 默认仍为 65,536 字节；本地 `server.py` 和 Vercel `api/chat/stream.py` 的综合入口没有把共享上限传入读取函数。

已实现：

- 规划请求继续使用 64KB 上限。
- `server.py:268` 和 `api/chat/stream.py:50` 显式使用 `max_size=AGENT_SYNTHESIS_MAX_REQUEST_BYTES`。
- 保留入口层对超过 128KB 请求的拒绝。
- `scripts/test_chat_stream_agent_config.py` 增加本地/Vercel 综合读取契约回归断言，并继续校验 64KB/128KB 配置值。

仍可在后续测试专项中补充真实 64KB 以下、64–128KB、超过 128KB 请求体的端到端边界测试；本次修复已消除实际读取函数仍停留在 64KB 的问题。

### 3.2 防止工具调用被静默截断（已完成）

原逻辑只执行：

- `plannedCalls.slice(0, AGENT_MAX_TOOLS_PER_ROUND)`

因此用户要求分别查询 5 个以上商户时，第 5 个及之后的调用会被丢弃；如果前 4 个成功，流程会直接进入综合，不会提示遗漏。

已实现：

- `normalizeAgentToolCalls()` 不再在 merchant/trend 展开阶段按 4 个截断。
- `runChatAgent()` 保留全部规划调用，按每批最多 4 个执行，直到达到 `AGENT_MAX_TOOL_CALLS = 6` 的总预算。
- 6 个调用会按 4+2 批次全部执行；超过 6 个时返回 `partial=true`、`executedToolCalls`、`plannedToolCalls` 和 `omittedTargets`。
- 综合上下文会收到未执行目标约束，最终回答和 Agent 时间线会明确显示结果不完整及未执行目标。
- `scripts/test_chat_agent.mjs` 增加 6 调用和 7 调用回归场景。

当前约束：总工具调用预算仍为 6；超过 6 个目标不会被假装完成，而是显式进入部分执行状态。

### 3.3 数据问题不能在没有可验证数据来源时直接成功回答（已完成）

原问题不是“数据问题必须每次都发起新的工具调用”，而是不能让模型在没有任何可验证来源时凭空给出具体数据结论。来源可以是：

- 本轮工具执行结果，包括明确的失败或“未找到”结果；
- 已加载的结构化报告、记忆或历史数据上下文；
- 用户在当前问题中直接提供的指标值、表格或数据片段。

问候、能力说明、指标定义、推荐方法论和基于已有结果的追问不要求重新取数；只有具体数据问题在上述来源全部缺失时才需要阻止模型直答。

已实现：

- `agentPromptRequiresVerifiableData()` 对当前问题做确定性数据边界判断，并排除定义和方法论问题。
- `agentHasVerifiableContext()` 检查用户输入、记忆和近期历史中是否已有可识别的数据上下文。
- `runChatAgent()` 在具体数据问题没有工具结果或可验证上下文时返回缺少数据来源的安全提示；无论规划返回无工具文本、规划失败还是工具调用无有效结果，都不把模型文本作为数据结论。
- 工具失败或未找到结果仍会进入综合/直接说明路径，避免把“查询失败”误判成“完全没有结果”。
- `scripts/test_chat_agent.mjs` 覆盖无来源拦截、已有上下文和用户提供指标值的回归场景。

实现成本：S–M（已完成）。

### 3.4 统一实体和过滤条件的失败关闭策略（已完成）

> 实施状态：已完成（2026-08-25）

原问题是商户名称子串匹配会直接返回第一项，付款状态、月份或趋势过滤条件无法识别时也可能被忽略或恢复默认值，导致查询范围扩大。现在 Agent 工具边界统一先解析实体和过滤条件，只有明确成功时才执行数据查询。

统一状态契约如下：

| 状态 | 行为 |
| --- | --- |
| `resolved` | 唯一匹配，继续查询 |
| `ambiguous` | 返回候选 ID、名称、Tier 和品类，请用户选择 |
| `not_found` | 明确提示未找到 |
| `invalid_filter` | 明确提示状态、月份或指标非法 |

已实现：

- `agentResolveMerchant()` 按“商户 ID → 标准化完整名称 → 唯一名称子串”依次匹配；输入同时含 ID 和名称时只按 ID 查询。子串命中多个候选时返回 `ambiguous`，最多返回 5 个候选的 `merchantId`、名称、Tier 和品类；没有候选时返回 `not_found`。
- 商户分析、商户对比、商户趋势和付款商户过滤共用同一解析器。`ambiguous`、`not_found` 不进入后续查询，也不回退到第一项或扩大范围。
- 付款状态仅接受 `paid`、`pending`、`unpaid`、`overdue`、`partial` 及现有中文别名；月份必须是有效 `YYYY-MM` 或用户原话中的 1–12 月；Tier 必须能归一化为现有 Tier。无法识别时返回带 `field`、`value` 和 `allowed` 的 `invalid_filter`。
- 趋势的显式 `months` 必须是 2–24 的整数，显式 `metric` 必须属于 `TREND_METRIC_DEFS`；非法值不再静默改成 12 个月或展示全部指标。
- `scripts/test_chat_agent.mjs` 覆盖歧义商户跨工具失败、候选字段、未找到商户、非法付款过滤和非法趋势过滤。

参考实现：`public/app.js` 中的 `agentResolveMerchant()`、`agentInvalidFilterResolution()`、`agentExecuteTool()` 和 `agentRunTrendTool()`。

实现成本：M（已完成）。

### 3.5 解决趋势聚合的 N+1 查询和不透明覆盖率

品类和 Tier 趋势当前会在浏览器中按商户批量请求月度数据，再进行前端聚合。

参考位置：

- `public/app.js:7126`
- `public/app.js:7190`
- `public/app.js:14014`

主要问题：

- 大品类会产生大量请求。
- `timeoutPromise()` 只停止等待，不会取消底层请求。
- 只要部分商户成功就继续聚合。
- 最终可能被标记为完整真实趋势，但没有覆盖率信息。

建议优先增加服务端聚合接口，直接按品类/Tier和月份执行数据库聚合。返回结果应包含：

```json
{
  "requestedMerchants": 120,
  "successfulMerchants": 112,
  "monthlyCoverage": {
    "2026-07": 0.94,
    "2026-08": 0.91
  },
  "partial": true,
  "dataSource": "database",
  "asOf": "2026-08-21T00:00:00Z"
}
```

覆盖率不足时，应明确显示“部分数据”或降级为估算，不应继续使用“完整数据库趋势”的表述。

实现成本：L。

### 3.6 服务端真正执行 Agent 和 LLM 开关

`OI_AGENT_ENABLED` 和 `OI_LLM_ENABLED` 目前主要影响前端状态，后端入口仍可能被已认证客户端直接调用。

参考位置：

- `auth.py:42`
- `auth.py:47`
- `server.py:186`
- `api/chat/actions.py:80`
- `api/chat/stream.py:41`

建议在 `/api/chat/agent` 和 Agent 综合流入口统一检查开关，关闭时返回明确的 503 或功能关闭错误，并覆盖本地和 Vercel 两条路径。

实现成本：S。

## 4. P1：可靠性、可维护性和体验优化

### 4.1 建立 Agent Trace 和运行指标

当前提问日志主要保存问题、模式、意图和成功/失败状态。缺少以下信息：

- 规划耗时和综合耗时。
- 实际调用了哪些工具。
- 工具成功率、失败原因和重试次数。
- 数据来源、数据快照时间和是否为估算。
- 规划与综合请求大小。
- Provider、模型、输入 Token、输出 Token。
- 用户点击中止还是自然失败。

建议新增 `agent_runs` / `agent_steps` 结构，使用 `questionEventId` 关联，但默认不保存完整工具 JSON，避免日志膨胀和数据泄露。

建议字段：

```text
questionEventId
phase                 planning | tool | synthesis
toolName
status                success | failed | stopped | timeout
durationMs
provider
model
inputBytes
outputTokens
dataSource
dataAsOf
estimated
errorCode
retryCount
```

另外，前端当前在每收到一个 SSE 数据块时递增 `tokenCount`，显示的并不是真实 Token。[public/app.js:14217](../public/app.js#L14217) 应改为 Provider 返回真实 usage，或将文案改为“响应片段数”。

实现成本：M。

### 4.2 服务端维护规范工具注册表

当前规划端允许客户端提交工具描述和参数 Schema，综合端也接受任意 `messages`。正常页面会进行字段压缩，但服务端无法验证这些数据是否来自真实工具。

参考位置：

- `chat_agent_http.py:81`
- `api/chat/stream.py:59`
- `llm_provider.py:246`

建议：

- 服务端维护规范工具名称、描述和 Schema。
- 规划请求只提交问题、语言和需要启用的工具集合。
- 综合请求改为结构化的 `question + context + toolResults`。
- 服务端校验工具名、字段白名单和结果来源后再组装 LLM 消息。
- 工具结果增加 `runId` 或签名，避免客户端伪造数据结果。

实现成本：M。

### 4.3 统一回合生命周期、超时、重试和异常处理

当前 Agent 页面有 `AbortController`，但普通 Chat Mode 没有完整的提交锁；聚合趋势也没有贯穿同一个 `AbortSignal`。此外，单次回合可能经历两轮规划、工具查询和综合，没有统一总时限。

参考位置：

- `public/app.js:15035`
- `public/app.js:7112`
- `chat_agent_http.py:14`
- `llm_provider.py:57`

建议：

- 为每个用户回合生成 `turnId`。
- 同一会话串行提交，或用 turn 版本号避免旧请求覆盖新历史。
- 设置总回合预算，并为综合阶段预留时间。
- 规划、每个工具和综合分别设置超时。
- 只对尚未产生输出的 429、502、503 做一次有限重试。
- 使用 `Promise.allSettled()`，单个工具异常时保留其他成功结果。
- 对相同工具和参数进行回合内去重。

实现成本：M–L。

### 4.4 数据来源和新鲜度必须进入回答和图表

当前商户汇总可能来自缓存，月度趋势来自数据库，两者可能不是同一数据快照。建议所有工具结果统一返回：

- `dataSource`：cache / database / estimate
- `asOf`
- `period`
- `partial`
- `coverage`

图表顶部应展示“数据库月度数据”“估算趋势”或“部分数据”，并在估算趋势中使用虚线、浅色填充或明显的“仅供方向参考”提示，避免用户把估算点当作真实月度值。

### 4.5 对话记忆从文本历史升级为结构化状态

目前 Agent 页面历史只保存成功问答文本，页面刷新后丢失；传给模型时还会按字符截断。[public/app.js:453](../public/app.js#L453)、[public/app.js:13369](../public/app.js#L13369)

建议额外保存：

- 最近解析出的商户 ID 和标准名称。
- 当前品类、Tier、日期范围和指标。
- 最近一次工具结果摘要。
- 数据来源和快照时间。
- 用户已确认或拒绝的候选实体。

长期可以增加会话列表、恢复、删除、分享和跨设备继续对话。

### 4.6 Agent 页面交互和可访问性

建议优化：

- 顶部独立中止按钮与输入框内中止按钮二选一，避免出现两个相同操作。[public/index.html:464](../public/index.html#L464)
- 给输入框增加明确的 `aria-label`，不要只依赖 placeholder。[public/index.html:514](../public/index.html#L514)
- 将聊天区从持续 `aria-live` 改为完成后播报，避免流式 Token 逐片段触发读屏更新。[public/index.html:492](../public/index.html#L492)
- 用户向上滚动查看历史时暂停自动滚底。
- 失败和中止状态增加“重试本轮”按钮。
- 支持编辑上一条问题后重新执行。
- 支持复制表格、下载 CSV、下载图表 PNG/SVG。
- 对估算趋势、部分趋势和数据库趋势使用不同视觉状态。

### 4.7 测试和 CI

当前核心 Agent 测试通过，但以下独立 UI 契约测试在 Windows CRLF 工作树中失败：

- `scripts/test_agent_execution_timeline.mjs`
- `scripts/test_agent_stop_button.mjs`
- `scripts/test_dashboard_chat_pages.mjs`

失败原因主要是测试依赖固定换行和源码片段匹配，不能稳定代表运行时功能。与此同时，这些测试没有全部加入 `.github/workflows/ci.yml`，当前 CI 主要运行 Agent 核心测试。

建议：

- 测试读取文件后统一换行，或改为更稳定的 AST/DOM/行为断言。
- 将时间线、中止按钮、Dashboard、日志和反馈测试全部加入 CI。
- 增加真实 SSE 分片、Abort、超时、5 个以上工具调用、64–128KB 综合请求和部分趋势覆盖率测试。
- 增加本地 `server.py` 与 Vercel handler 的等价契约测试。

## 5. P2：产品能力扩展

### 5.1 实体和数据工具

建议按业务价值逐步加入：

1. 商户搜索与消歧：返回 ID、标准名称、Tier、品类和候选列表。
2. ASIN/产品分析：产品销售、订单、CVR、EPC、商户内贡献和产品趋势。
3. Publisher/媒体分析：媒体表现、流量、转化和收入贡献。
4. 新商户分析：新入驻商户、首月表现和后续留存。
5. Offer Tracker 查询：Offer 状态、变化和异常。
6. Target 差距分析：实际值、目标值、差距和优先行动项。
7. 数据质量查询：更新时间、缺失月份、覆盖率和指标口径。

### 5.2 趋势和可视化

- 多商户、多品类和多 Tier 多线对比。
- 日粒度趋势。
- 同比、环比和自定义起止日期。
- 目标线、异常点和大促事件标记。
- 异常检测和简单预测，但必须明确区分预测与真实数据。
- 点击图表节点后展示该月明细和数据来源。
- 图表与表格联动、导出和生成 View 报告。

### 5.3 主动式 Agent

- 高价值商户收入骤降预警。
- CVR、EPC、AOV 异常预警。
- 付款逾期和未付款提醒。
- 品类整体异动提醒。
- 定时生成日报或周报。

主动式能力需要配套用户订阅、通知渠道、去重、静默时间和审计记录，建议在 Trace 基础稳定后再做。

### 5.4 反馈闭环与质量评估

当前反馈主要是“不满意”原因和补充说明。下一步可以：

- 增加“有帮助”反馈。
- 将反馈关联到具体工具、数据来源和图表指标。
- 按错误类型统计：实体错误、指标错误、数据缺失、解释不清、图表问题。
- 从真实日志抽取高频问题，建立固定回归集。
- 对确定性工具结果做数值一致性校验。
- 用真实反馈持续改进规划提示词和回答模板。

## 6. 推荐实施顺序

### Phase 1：正确性与边界（优先实施）

- 已完成：修复综合请求 128KB 读取上限。
- 已完成：修复工具调用批处理和超限提示。
- 增加数据问题的工具结果门槛。
- 已完成：统一 Agent 商户、付款和趋势过滤条件解析；歧义实体和非法值失败关闭。
- 服务端执行 Agent/LLM 开关。
- 补齐关键 CI 测试。

本次已验收：6 个工具调用按 4+2 批次完整执行；超过总预算的目标带有 partial/omittedTargets 标识并进入回答提示；综合流入口实际读取上限与 128KB 配置一致；歧义商户、未找到商户和非法付款/趋势过滤均在工具查询前失败关闭。Phase 1 其余边界项仍待后续实施。

### Phase 2：规模化和可观测性

- 增加数据库聚合趋势接口。
- 增加覆盖率、数据来源和快照时间。
- 增加 Agent Trace 和错误分类。
- 增加统一回合超时、有限重试、取消和去重。
- 抽取本地/Vercel 共享的流式 HTTP 处理逻辑。

验收标准：能够回答一次 Agent 请求“调用了什么、用了多久、数据来自哪里、是否完整、失败在哪里”。

### Phase 3：记忆与交互

- 结构化多轮记忆。
- 会话保存、恢复和删除。
- 失败重试、问题编辑、复制和导出。
- 完善可访问性、移动端和中英双语。

验收标准：刷新或长对话后，Agent 仍能准确理解当前商户、指标和时间范围，并且用户可以复用或导出结果。

### Phase 4：业务扩展和主动分析

- ASIN、Publisher、Offer、目标和数据质量工具。
- 多序列图表、同比、目标线和异常检测。
- 反馈闭环、质量评估集和主动式预警。

验收标准：新增工具不会破坏已有工具契约，所有数值均可追溯到明确数据来源和快照时间。

## 7. 审查验证记录

本次实施已修改本地/Vercel 综合流入口、Agent 工具执行逻辑、回归测试、CI 和相关文档；未提交或推送 Git。

已通过的核心检查包括：

- `node --check public/app.js`
- `python scripts/test_llm_agent.py`
- `python scripts/test_agent_http.py`
- `python scripts/test_agent_config.py`
- `node scripts/test_chat_agent.mjs`
- 日志、反馈和流式配置相关测试
- `python scripts/test_chat_stream_agent_config.py`
- `node scripts/test_chatbot_intent_flow.mjs`
- `node scripts/test_zh_chatbot.mjs`
- `python -m py_compile auth.py server.py chat_agent_http.py api/chat/stream.py`

本次新增回归结果：Agent 测试共 32 个场景通过；6 个工具调用按 4+2 批次完整执行；7 个工具调用执行 6 个并明确返回 1 个 `omittedTargets`；歧义商户统一返回候选，非法付款/趋势过滤统一返回 `invalid_filter`。综合请求配置测试同时确认规划上限为 64KB、综合上限为 128KB，且两个综合入口均传入共享读取上限。

当前发现的 3 个独立 UI 契约测试失败，主要与 Windows CRLF 和固定源码字符串匹配有关；它们尚未全部纳入 CI，建议在 Phase 1 一并修复测试方式和 CI 配置。
