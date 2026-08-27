# Agent Trace 与运行指标实现方案

> **执行说明：** 实施时按任务顺序执行，每个任务先补充回归测试，再修改生产代码；不要把 3.5、3.6 或 4.2 的内容混入本方案。

**目标：** 为 Agent 建立以 `questionEventId` 关联、以 `runId` 聚合的运行追踪，记录规划、工具、综合三个阶段的耗时、状态、来源和 LLM usage；同时修正前端把 SSE 数据块数量误显示为 Token 的问题。

**架构：** 新增 `cnpscy_oi_agent_runs` 与 `cnpscy_oi_agent_steps` 两张轻量 MySQL 表。浏览器为每次 Agent 回合生成 `runId`，通过现有 `/api/chat/stream?operation=agent_trace` 异步写入运行摘要和经过白名单校验的步骤元数据。规划端点返回 Provider/模型/usage 元数据；综合 SSE 在 `[DONE]` 前发送独立的 `usage` 事件。完整工具参数、工具结果、Prompt、模型响应和异常堆栈均不写入 Trace 表。

**技术栈：** Python 3.12、PyMySQL、现有 `server.py` 与 Vercel 合并入口、原生 JavaScript、Node 静态回归测试、现有 CI。

## 范围和约束

- [ ] 本方案只覆盖 4.1；3.5、3.6、4.2、4.3 不在本次实现范围内。
- [ ] 保留现有 `cnpscy_oi_chatbot_question_logs` 和 `cnpscy_oi_chatbot_answer_feedback` 的生命周期；Trace 写入失败不得阻断回答、回退回答、问题日志或反馈。
- [ ] `questionEventId` 是逻辑关联键，不新增跨表外键。这样即使问题日志被关闭或先写 Trace，Trace 仍可保存。
- [ ] 所有状态、阶段、来源和错误码都由后端白名单校验；MySQL 5.6 不依赖 `CHECK` 约束。
- [ ] Trace 接口只接受小型元数据；单次追加请求限制为 64 个步骤、16 KB，拒绝任意 JSON、Prompt、工具参数和结果正文。
- [ ] Provider usage 不可用时保存 `usageAvailable=false`、Token 字段为 `NULL`，前端显示“响应片段数”，不得把片段数称为 Token。
- [ ] Trace 是运行诊断数据，不是计费或数据真实性证明；客户端上报的工具来源在 4.2 服务端工具注册表落地后再提升为可信审计信息。

---

## 任务 1：先定义 Trace 合同、校验器和数据库结构

**涉及文件：**

- 新增 `agent_trace.py`
- 新增 `scripts/prune_agent_trace.py`
- 新增 `scripts/test_agent_trace.py`
- 修改 `scripts/ensure_oi_schema.py`
- 修改 `docs/offer-db-reporting-contract.sql`

### 1.1 先写失败测试

- [ ] 在 `scripts/test_agent_trace.py` 中覆盖合法和非法枚举：
  - `phase` 只能是 `planning`、`tool`、`synthesis`；
  - `status` 只能是 `success`、`failed`、`stopped`、`timeout`；
  - `dataSource` 只能是 `cache`、`database`、`mixed`、`unknown`；
  - `errorCode`、`provider`、`model`、`toolName` 和 `dataAsOf` 必须经过长度限制。
- [ ] 覆盖 `runId`、`questionEventId`、`sessionId` 的 UUID/会话 ID 校验，以及 `mode=agent`、语言、非负耗时、非负 Token、非负重试次数校验。
- [ ] 覆盖禁止字段：`prompt`、`messages`、`arguments`、`toolResult`、`response`、`rawJson` 出现在 payload 时必须拒绝，而不是静默保存。
- [ ] 覆盖步骤去重：同一 `runId + sequence` 重复写入不产生第二条记录。
- [ ] 断言 DDL 包含两张表、主键、`questionEventId` 索引、`runId + sequence` 唯一键和运行状态索引。
- [ ] 断言清理脚本默认保留 90 天、支持 `--dry-run`，且删除顺序为 steps 后 runs。
- [ ] 先运行 `python scripts/test_agent_trace.py`，确认新测试在实现前失败。

### 1.2 实现领域模块和 DDL

- [ ] 在 `agent_trace.py` 定义表名、DDL、常量和公开函数：
  - `start_agent_run(payload, connection_factory=db_connection)`；
  - `append_agent_steps(payload, connection_factory=db_connection)`；
  - `complete_agent_run(payload, connection_factory=db_connection)`；
  - `normalize_trace_step(payload)`；
  - `trace_error_code(error)`，只返回白名单错误码，不返回异常正文。
- [ ] `cnpscy_oi_agent_runs` 至少包含：
  - `runId`、`questionEventId`、`anonymousSessionId`、`mode`、`language`；
  - `status`、`startedAt`、`completedAt`、`durationMs`；
  - `planningBypassed`、`partial`、`fallbackDelivered`、`stoppedByUser`；
  - `plannedToolCalls`、`executedToolCalls`、`failedToolCalls`、`errorCode`；
  - `createdAt`，并建立 `questionEventId`、`status + startedAt`、`anonymousSessionId + startedAt` 索引。
- [ ] `cnpscy_oi_agent_steps` 至少包含：
  - `stepId`、`runId`、`questionEventId`、`sequence`；
  - `phase`、`toolName`、`status`、`startedAt`、`completedAt`、`durationMs`；
  - `provider`、`model`、`inputBytes`、`inputTokens`、`outputTokens`、`totalTokens`、`usageAvailable`、`outputChunks`；
  - `dataSource`、`dataAsOf`、`estimated`、`errorCode`、`retryCount`；
  - `UNIQUE(runId, sequence)` 和 `runId + phase + status` 索引。
- [ ] `inputTokens`、`outputTokens`、`totalTokens` 和 `dataAsOf` 必须允许为空；没有 Provider usage 或来源时间时保存 `NULL`，不能用估算值冒充真实值。
- [ ] 时间统一按 UTC 无时区 `DATETIME(6)` 写入，API 返回 ISO-8601 UTC 字符串。
- [ ] `append_agent_steps` 使用幂等插入；重复 sequence 只返回已存在状态，不覆盖首条诊断结果。
- [ ] `complete_agent_run` 允许相同终态重复提交，但拒绝把已完成的 `success` 改成 `failed` 或把 `stopped` 改成 `success`。
- [ ] 在 `scripts/ensure_oi_schema.py` 中以现有问题日志的方式接入建表，缺表创建、已存在跳过，不在应用启动时自动执行迁移。
- [ ] 在 `docs/offer-db-reporting-contract.sql` 同步增加不带 `cnpscy_` 前缀的合同 DDL，说明生产运行时由 `scripts/ensure_oi_schema.py` 创建前缀表。
- [ ] 新增 `scripts/prune_agent_trace.py`，默认按 `OI_AGENT_TRACE_RETENTION_DAYS=90` 清理；先删除过期 `agent_steps`，再删除过期 `agent_runs`，并支持显式 `--days` 覆盖。清理脚本只输出删除数量，不输出 Prompt、工具参数或数据库凭据。

### 1.3 验证

- [ ] 运行 `python scripts/test_agent_trace.py`。
- [ ] 运行 `python scripts/prune_agent_trace.py --dry-run`，确认清理范围只涉及两张 Trace 表。
- [ ] 运行 `python -m py_compile agent_trace.py scripts/ensure_oi_schema.py`。

---

## 任务 2：增加受保护的 Trace 写入 HTTP 合同

**涉及文件：**

- 新增 `agent_trace_http.py`
- 修改 `server.py`
- 修改 `api/chat/stream.py`
- 修改 `scripts/test_vercel_chat_routes.py`
- 新增 `scripts/test_agent_trace_http.py`

### 2.1 先写失败测试

- [ ] 在 `scripts/test_agent_trace_http.py` 中用 FakeTarget 覆盖：
  - `start` 创建运行并返回 `runId`；
  - `append` 接收最多 64 个步骤；
  - `complete` 更新终态；
  - 缺少 `runId`、错误 session、超大 body、超出步骤数量、非法阶段/状态返回 400；
  - 未认证返回认证错误；
  - `OI_AGENT_TRACE_ENABLED=0/false/off` 时返回 `{ok:true, disabled:true}`，且不触发 DB 写入；
  - DB 异常只返回受控错误，不泄露连接信息、SQL 或异常堆栈。
- [ ] 在 `scripts/test_vercel_chat_routes.py` 增加 `agent_trace` operation 的路由分发断言。
- [ ] 先运行两个测试，确认实现前失败。

### 2.2 实现接口

- [ ] `agent_trace_http.py` 暴露 `handle_agent_trace(target, method)`，沿用现有 `require_auth`、`_read_json_body`、`send_json` 和 `public_error_payload`。
- [ ] POST payload 合同固定为：
  - `action=start`：`runId`、`questionEventId`、`sessionId`、`mode`、`language`；
  - `action=append`：`runId`、`sessionId`、`steps`；
  - `action=complete`：`runId`、`sessionId`、`status`、运行摘要字段。
- [ ] `start`、`append`、`complete` 都要求同一 `sessionId`；Trace 不接受浏览器传入的 Prompt 或回答正文。
- [ ] 默认开启 `OI_AGENT_TRACE_ENABLED`，关闭开关只影响 Trace 写入，不影响现有问题日志开关。
- [ ] `server.py` 和 `api/chat/stream.py` 在 `operation=agent_trace` 分支中先处理 Trace，再进入普通 SSE body 读取逻辑；不能让 Trace 请求被当成 128 KB 综合请求。
- [ ] 保持现有 Vercel 函数数量，不新增 `/api/chat/agent-trace.py`；继续复用 `/api/chat/stream` 的 operation 分流。
- [ ] 前端写入采用异步、短超时、失败吞掉的方式；回答主流程不得 `await` DB 写入，也不得因 Trace 503 进入回答 fallback。

### 2.3 验证

- [ ] 运行 `python scripts/test_agent_trace.py`。
- [ ] 运行 `python scripts/test_agent_trace_http.py`。
- [ ] 运行 `python scripts/test_vercel_chat_routes.py`。
- [ ] 运行 `python scripts/test_vercel_function_budget.py`，确认没有新增 Vercel Function。
- [ ] 运行 `python -m py_compile agent_trace_http.py server.py api/chat/stream.py`。

---

## 任务 3：让 Provider 返回结构化 usage，并通过规划 JSON/SSE 传递

**涉及文件：**

- 修改 `llm_provider.py`
- 修改 `chat_agent_http.py`
- 修改 `server.py`
- 修改 `api/chat/stream.py`
- 新增 `scripts/test_llm_usage.py`
- 修改 `scripts/test_llm_agent.py`
- 修改 `scripts/test_chat_stream_agent_config.py`

### 3.1 先写失败测试

- [ ] 在 `scripts/test_llm_usage.py` 中 mock OpenAI-compatible response 和 Anthropic response，验证统一输出：
  - `provider`、`model`；
  - `usageAvailable`；
  - `inputTokens`、`outputTokens`、`totalTokens`。
- [ ] 覆盖没有 usage 的响应：Token 为 `None`，`usageAvailable=false`，不能由字符数或 SSE 块数填充。
- [ ] 覆盖规划 Provider 异常、超时和缺少 API key，验证只返回 `llm_unavailable`、`llm_timeout`、`provider_error` 等有限错误码。
- [ ] 覆盖 `call_llm_tools(..., return_metadata=False)` 保持旧返回结构，已有调用方仍可读取 `content` 和 `tool_calls`。
- [ ] 覆盖 `stream_chat(..., on_complete=callback)` 在成功、无 usage、超时和异常结束时最多回调一次。
- [ ] 修改 `scripts/test_chat_stream_agent_config.py`，先断言综合 SSE 存在 `type=usage` 事件路径和无 usage 的响应片段降级文案。
- [ ] 先运行新增/修改测试，确认实现前失败。

### 3.2 实现 Provider 元数据

- [ ] 在 `llm_provider.py` 增加私有 usage 归一化函数，兼容对象属性和字典字段；不把完整 Provider response 放进返回值。
- [ ] 为 `call_llm_tools` 增加可选 `return_metadata` 参数：
  - 默认值保持现有兼容行为；
  - Agent 规划使用 `return_metadata=True`，获得成功/失败、Provider、模型、usage 和错误码。
- [ ] 为 `stream_chat` 增加 `on_complete` 回调；回调参数包含 Provider、模型、usage、`usageAvailable`、`finishReason` 和受控错误码。
- [ ] DeepSeek/OpenAI 流式请求尝试启用 Provider 的 usage 回传并读取最终 usage chunk；不支持时不重试第二次请求，直接回调 `usageAvailable=false`。
- [ ] Claude 流式请求在 stream final message/usage 位置读取 input/output token；无 final usage 时同样降级为不可用。
- [ ] 不修改现有非 Agent `call_llm` 的默认字符串返回合同；如需要复用 usage，只新增可选元数据路径。

### 3.3 修改规划和综合 API 合同

- [ ] `chat_agent_http.py` 记录规划请求的真实 `Content-Length` 为 `inputBytes`，响应增加非原始数据的 `telemetry`：Provider、模型、usage、`inputBytes`、错误码。
- [ ] 规划成功响应继续保留 `ok`、`content`、`toolCalls`、`finishReason`；只增加字段，不改变前端现有字段含义。
- [ ] `server.py` 与 `api/chat/stream.py` 的 `_chat_stream_messages` 接收 `requestBytes` 和可选 Trace 上下文，调用 `stream_chat` 回调收集 usage。
- [ ] 综合 SSE 在 `[DONE]` 前发送一条：
  - `data: {"type":"usage","provider":...,"model":...,"usageAvailable":...,"inputTokens":...,"outputTokens":...,"totalTokens":...}`；
  - 若 Provider 没有 usage，Token 字段为 `null`，仍发送 `usageAvailable:false`。
- [ ] Agent 直通规划的普通 `/api/chat/stream` 路径也读取可选 Trace 上下文；只有带 `tracePhase=synthesis` 时发送同样的 `usage` 事件，普通 Chat 请求保持现有协议兼容。
- [ ] SSE 连接断开、超时或异常时不得伪造 usage；前端根据中断信号和错误码记录 `stopped`/`timeout`/`failed`。

### 3.4 验证

- [ ] 运行 `python scripts/test_llm_usage.py`。
- [ ] 运行 `python scripts/test_llm_agent.py`。
- [ ] 运行 `python scripts/test_agent_http.py`。
- [ ] 运行 `python scripts/test_chat_stream_agent_config.py`。
- [ ] 运行 `python -m py_compile llm_provider.py chat_agent_http.py server.py api/chat/stream.py`。

---

## 任务 4：在前端汇合 Agent 规划、工具、综合三阶段 Trace

**涉及文件：**

- 修改 `public/auth.js`
- 修改 `public/app.js`
- 新增 `scripts/test_agent_trace.mjs`
- 修改 `scripts/test_agent_question_logging.mjs`
- 修改 `scripts/test_chat_agent.mjs`

### 4.1 先写失败测试

- [ ] 在 `scripts/test_agent_trace.mjs` 中静态断言：
  - `handleAgentPageSubmit` 和 `applyPrompt` 都把同一个 `questionEventId` 传给 Agent Trace；
  - `runChatAgent` 存在 planning/tool/synthesis 三类步骤记录；
  - Trace payload 不包含 `prompt`、`messages`、工具 arguments 或结果正文；
  - Trace 写入失败不会抛出到回答主流程；
  - 停止、Provider timeout、工具失败、综合失败分别映射到规定状态和错误码；
  - 同一运行只完成一次，避免多条终态记录。
- [ ] 断言工具来源元数据使用 `dataSource`、`dataAsOf`、`estimated`，不把估算趋势记录成真实数据库来源。
- [ ] 断言 `streamAssistantReply` 解析 `type=usage`，usage 可用时显示真实 output Token；usage 不可用时显示“响应片段数/response chunks”，源码中不再把 `tokenCount` 文案称为 tokens。
- [ ] 先运行测试，确认实现前失败。

### 4.2 实现 Trace 客户端

- [ ] 在 `public/app.js` 问题日志辅助函数附近新增 Agent Trace 客户端：
  - `createAgentTraceContext(questionEventId, language)`；
  - `startAgentTrace(context)`；
  - `appendAgentTraceSteps(context, steps)`；
  - `completeAgentTrace(context, summary)`；
  - `normalizeAgentTraceError(error)`；
  - `agentTraceDataMeta(result)`。
- [ ] `context` 保存 `runId`、`questionEventId`、`sequence`、开始时间、步骤缓存、重复工具调用计数和幂等完成 Promise；不保存完整工具数据。
- [ ] `start` 采用客户端生成 UUID 并异步发送；在回答结束、停止或异常时先 flush 步骤，再 complete。任何 Trace 网络错误只 `console.warn`，不得修改回答结果。
- [ ] 为每个阶段生成一条或多条摘要：
  - planning：每一轮 `/api/chat/agent` 一条，记录耗时、请求字节数、Provider、模型、usage、失败/超时错误码；
  - tool：每个实际调用一条，记录工具名、耗时、成功/失败、来源元数据、重试次数；
  - synthesis：`streamAssistantReply` 结束后记录耗时、请求字节数、Provider、模型、真实 usage 或 `outputChunks`。
- [ ] 工具重试次数按“相同工具名 + 规范化参数签名”在内存中累计；不把参数签名写入数据库。首次调用为 0，实际重复调用才递增。
- [ ] 工具来源标准化为：
  - 当前缓存汇总：`cache`；
  - `/api/ui/db/*` 月度/明细结果：`database`；
  - 同时使用缓存汇总和数据库月度结果：`mixed`；
  - 无法判断：`unknown`。
- [ ] 在 `public/auth.js` 把 `offersResp.checkedAt` 传入 `window.CHATBOT_DATA.sources.checkedAt`；月度 DB payload 的 `checkedAt` 沿工具上下文传入 `dataAsOf`。缺失时保持 `NULL`，不使用浏览器当前时间冒充数据快照时间。
- [ ] `compactAgentToolResult` 可以继续只给综合模型发送必要字段；Trace 元数据通过独立的内部 `trace` 对象传递，避免为了日志把完整结果放回请求体。

### 4.3 接入 Agent 生命周期

- [ ] `handleAgentPageSubmit` 在创建问题日志后创建 Trace context；`applyPrompt` 在 Agent 分支也创建 Trace context；两条路径共享同一 `runChatAgent` 记录逻辑。
- [ ] 给规划请求增加小型 Trace 上下文（`runId`、`questionEventId`、`phase`），给综合请求增加同样上下文；后端只用于元数据关联，不把上下文拼入模型 Prompt。
- [ ] `runChatAgent` 的所有提前返回路径都调用幂等 `finishAgentTrace`：直接绕过规划、缺少可验证来源、用户中止、规划失败、工具失败后回退、综合成功和综合失败。
- [ ] 用户点击停止：运行状态为 `stopped`，`stoppedByUser=true`；自然 Provider 超时：状态为 `timeout`；网络/校验/工具异常：状态为 `failed`，并设置有限 `errorCode`。
- [ ] 缺少可验证数据而返回安全提示时，运行仍记录为完成，但带 `errorCode=no_verifiable_source` 和 `fallbackDelivered=true`；这样不会把“安全拒答”混淆成工具失败。
- [ ] 综合失败但展示工具结果 fallback 时，综合 step 为 `failed`，运行摘要带 `fallbackDelivered=true` 和 `errorCode=synthesis_unavailable`；问题日志沿用现有用户回答成功/失败规则，不改 3.3 行为。
- [ ] `partial`、`plannedToolCalls`、`executedToolCalls`、`failedToolCalls` 与现有 `currentExecutionMeta()` 保持一致，尤其不能因为达到工具预算而静默减少计数。

### 4.4 修正响应状态文案

- [ ] `streamAssistantReply` 保留内部 `responseChunks` 计数，用于 Provider usage 缺失时的降级显示。
- [ ] 收到 `type=usage` 时保存 `usageAvailable` 和真实 Token；有真实 usage 时显示真实 `outputTokens`。
- [ ] 没有 usage 时显示“响应片段数”/“response chunks”，并将 `outputChunks` 写入 Trace；禁止显示 `tokenCount + " tokens"`。
- [ ] Agent 综合请求的 `inputBytes` 使用实际 `JSON.stringify(requestBody)` UTF-8 字节长度或服务端返回的 `Content-Length`；不能使用字符数估算。

### 4.5 验证

- [ ] 运行 `node --check public/auth.js`。
- [ ] 运行 `node --check public/app.js`。
- [ ] 运行 `node scripts/test_agent_trace.mjs`。
- [ ] 运行 `node scripts/test_agent_question_logging.mjs`。
- [ ] 运行 `node scripts/test_chat_agent.mjs`。

---

## 任务 5：文档、CI 和端到端验收

**涉及文件：**

- 修改 `docs/chat-agent-optimization-roadmap.md`
- 修改 `docs/chatbot-feature-report.md`
- 修改 `.github/workflows/ci.yml`
- 修改 `.github/workflows/sync-levanta-payments.yml`
- 视测试需要修改 `scripts/test_vercel_function_budget.py`

### 5.1 文档更新

- [ ] 将路线图 4.1 标题标记为“已完成”，增加实施状态、表名、operation、SSE usage 事件和隐私边界。
- [ ] 在 `docs/chatbot-feature-report.md` 的 Agent 流程中补充：
  - `questionEventId -> runId -> agent_steps` 关联；
  - 浏览器工具执行与后端规划/综合 usage 的汇合方式；
  - `stopped` 与自然 `failed/timeout` 的区别；
  - usage 不可用时的“响应片段数”降级；
  - Trace 写入失败不阻断回答；
  - 不保存完整工具 JSON、Prompt、回答和异常堆栈。
- [ ] 在文档中明确 4.1 不解决 3.5、3.6、4.2、4.3，避免后续维护误以为已完成全部 P1 项。

### 5.2 CI 接入

- [ ] 将 `python scripts/test_agent_trace.py`、`python scripts/test_agent_trace_http.py`、`python scripts/test_llm_usage.py` 加入 `.github/workflows/ci.yml`。
- [ ] 将 `node scripts/test_agent_trace.mjs` 加入 Agent 前端回归测试。
- [ ] 保留并继续运行现有 Agent、问题日志、SSE、Vercel 路由和函数数量测试。

### 5.3 最终验证

- [ ] `python -m py_compile auth.py server.py agent_trace.py agent_trace_http.py chat_agent_http.py llm_provider.py api/chat/stream.py scripts/ensure_oi_schema.py scripts/prune_agent_trace.py`
- [ ] `node --check public/auth.js`
- [ ] `node --check public/app.js`
- [ ] `python scripts/test_agent_trace.py`
- [ ] `python scripts/test_agent_trace_http.py`
- [ ] `python scripts/test_llm_usage.py`
- [ ] `python scripts/test_llm_agent.py`
- [ ] `python scripts/test_agent_http.py`
- [ ] `python scripts/test_chat_stream_agent_config.py`
- [ ] `python scripts/test_vercel_chat_routes.py`
- [ ] `python scripts/test_vercel_function_budget.py`
- [ ] `node scripts/test_agent_trace.mjs`
- [ ] `node scripts/test_agent_question_logging.mjs`
- [ ] `node scripts/test_chat_agent.mjs`
- [ ] `node scripts/test_chatbot_intent_flow.mjs`
- [ ] `git diff --check`
- [ ] 在 staging 数据库执行 `python scripts/ensure_oi_schema.py`，用 `SHOW CREATE TABLE cnpscy_oi_agent_runs` 和 `SHOW CREATE TABLE cnpscy_oi_agent_steps` 确认结构；不在日志或命令输出中暴露数据库凭据。
- [ ] 在现有每日 DB 工作流中加入 `python scripts/prune_agent_trace.py`，复用已有 DB 连接变量；清理失败不得阻断支付同步，需单独输出 warning 并保留下一次重试机会。
- [ ] 使用一次成功 Agent、一次工具失败、一次用户中止、一次 Provider usage 缺失场景验收：问题日志仍正常完成，Trace 分别留下正确 run/step 状态，且前端没有把片段数显示为 Token。
- [ ] 本地验证完成后关闭 `http://127.0.0.1:8765/` 服务器，并确认 8765 端口无监听进程。

## 完成标准

- [ ] 任意 Agent 回合都能用 `questionEventId` 找到一个 `runId`，并按 planning/tool/synthesis 查看阶段状态和耗时。
- [ ] 工具调用数、成功/失败数、失败原因和重试次数可从 `agent_steps` 聚合得到，失败或 Trace 网络异常不会静默改变回答。
- [ ] 规划与综合都有实际请求字节数；Provider 有 usage 时记录真实 input/output/total Token，无 usage 时明确标记不可用。
- [ ] 数据来源、快照时间和估算标志来自工具元数据；未知值为空或 `unknown`，不猜测。
- [ ] 用户停止与自然失败/超时可区分。
- [ ] 数据库默认不保存完整工具 JSON、Prompt、回答和异常堆栈。
- [ ] 现有问题日志、反馈、Agent 工具、SSE、Vercel 合并入口和函数预算回归测试全部通过。
