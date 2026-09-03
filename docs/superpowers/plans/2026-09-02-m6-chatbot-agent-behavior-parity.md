# M6 Chatbot 与 Agent 行为等价迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在保留 Vue/TypeScript modern 页面承载能力的同时，使 Chatbot Report、数据来源、Deep Window、Chat Mode 和独立 Agent 的用户可见行为与当前 Legacy 版本等价。

**架构：** `public/app.js` 当前实现是行为基准，Vue 页面不再复制一套缩减版查询、分析、记忆或工具逻辑。Modern 页面通过受控 bridge 消费 Legacy 的同一会话状态、查询管道、SSE、Deep Window、反馈/日志和 Agent 工具执行结果；当前默认 Legacy-first，只有显式设置 `window.__OI_MODERN_CHATBOT_AGENT_PARITY__ = true` 才挂载 Modern 逐页对照。

> 状态修正（2026-09-02）：此前 Modern-first 放行因原版视觉和交互未对齐而撤回。当前 `dashboard`/`agent` 为 `dual`，Modern 已改为复用原版结构和样式类，最终浏览器视觉验收待用户完成。

**技术栈：** Vue 3、TypeScript、Vite、现有 `public/app.js` Legacy runtime、`/api/chat/*`、`/api/ui/db/*`、Vitest、Node `.mjs` 回归测试。

## 全局约束

- `public/app.js` 的 `applyPrompt()`、`answerPrompt()`、`runChatAgent()` 和 Deep Window 管道是行为基准；迁移不得删除或缩减其可用能力。
- Chatbot Report 必须继续支持 merchant、ASIN、category、Tier、recommendation、payment、trend/analysis、keyword、publisher 和 publisher profile 等已有路由。
- 数据来源必须继续遵守 Legacy 的缓存初始化、实时 chatbot DB 刷新、Tier Sheet/Payment/Monthly DB 接口和缺失数据提示；不得以 Vue 本地缓存模型替代实时刷新。
- Deep Window 必须保留实时分析、quick result、拖动、多窗口、置顶、最小化/恢复、关闭、取消、图表、clone/overlay、导出和加入 Chat 的行为。
- Chat Mode 必须保留 LLM/Agent fallback、逐 token SSE、历史、Report Memory、Memory recommendation、starter cards、停止、反馈、问题日志、帮助和 onboarding 事件。
- Agent 必须保留 planning、tool batch、retry、partial/omitted、synthesis、trend/table 补全、实时输出、停止/失败消息、反馈、问题日志、Trace 和结构化记忆隐私边界。
- 页面切换不能清空未结束的会话状态；登出、新对话和显式清空才按 Legacy 语义清理状态。
- `OI_AUTH_ENABLED=0` 只允许本地隔离验收，不能作为生产认证证据。
- 自动化测试不能代替真实浏览器验收；`test_chatbot_intent_flow.mjs` 的历史性超时继续单独记录，不能宣称通过。

---

### 任务 1：建立 Legacy 行为基准和失败回归

**文件：**

- 创建：`scripts/test_m6_chatbot_agent_behavior_parity.mjs`
- 修改：`frontend/src/features/chatbot/ChatbotPage.test.ts`
- 修改：`frontend/src/features/chatbot/chatbotReportModel.test.ts`
- 修改：`frontend/src/features/agent/AgentPage.test.ts`
- 修改：`docs/superpowers/plans/2026-09-01-m6-chatbot-agent-modern-migration.md`

**接口：**

- 测试读取当前 Modern factory、Legacy bridge 和静态入口，不读取或输出账号、Token、完整 prompt、完整回答、工具 JSON 或异常堆栈。
- 测试必须以用户行为和可观察结果断言：路由、请求端点、状态、可见控件、会话是否保留和数据来源标签。

- [x] **步骤 1：先写失败测试。** 增加以下行为断言：

```js
assert(modernReportRoutes.includes("payment"), "Modern Report 必须保留 payment 路由");
assert(modernReportRoutes.includes("analysis"), "Modern Report 必须保留 analysis/trend 路由");
assert(sourceRefreshesLiveData, "Modern Report 必须经过 Legacy live chatbot data 刷新边界");
assert(deepWindowFeatures.has("drag"), "Deep Window 必须保留拖动能力");
assert(deepWindowFeatures.has("export"), "Deep Window 必须保留导出能力");
assert(chatModeFeatures.has("memory-recommendation"), "Chat Mode 必须保留 Memory recommendation");
assert(agentFeatures.has("streaming"), "Agent 必须向可见页面传递流式回答");
assert(agentStateSurvivesNavigation, "页面切换不能清空 Agent 会话");
```

- [x] **步骤 2：运行测试确认是预期失败。**

```powershell
node scripts/test_m6_chatbot_agent_behavior_parity.mjs
npm --prefix frontend run test -- --run frontend/src/features/chatbot/ChatbotPage.test.ts frontend/src/features/chatbot/chatbotReportModel.test.ts frontend/src/features/agent/AgentPage.test.ts
```

预期：新建的 parity 脚本因当前 Modern Report 为缓存首切片、Deep Window 为简化实现、Agent 通过隐藏 DOM 提取时间线而失败；现有测试不得因为测试语法错误失败。

- [x] **步骤 3：记录当前差异。** 在 M6 计划中明确 `dashboard`/`agent` 仍为 `dual`，并把“Modern-first 只能在行为 parity 通过后启用”列为收口条件。

### 任务 2：扩展受控 Legacy bridge，统一会话和数据来源

**文件：**

- 修改：`frontend/src/legacy/contracts.ts`
- 修改：`frontend/src/legacy/bridge.ts`
- 修改：`public/app.js:34150-34240`
- 修改：`public/auth.js:191-215`
- 测试：`frontend/src/legacy/bridge.test.ts`
- 测试：`scripts/test_m6_chatbot_agent_behavior_parity.mjs`

**接口：** bridge 只暴露受控的行为数据和回调，不暴露 Provider 密钥、planProof、完整工具 payload 或完整 Trace 内容：

```ts
interface LegacyChatSessionBridge {
  getState(): {
    mode: "report" | "chat";
    language: "zh" | "en";
    hasMemory: boolean;
    source: "cache" | "db" | "unavailable";
  };
  setMode(mode: "report" | "chat"): void;
  submit(prompt: string): Promise<LegacyChatViewResult>;
  removeMemory(memoryId: string): void;
  clearConversation(): void;
  onChange(listener: (state: LegacyChatViewState) => void): () => void;
}

interface LegacyAgentSessionBridge {
  getState(): LegacyAgentViewState;
  submit(request: LegacyAgentRunRequest, callbacks: LegacyAgentRunCallbacks): Promise<LegacyAgentRunResult>;
  stop(): void;
  newConversation(): void;
  onChange(listener: (state: LegacyAgentViewState) => void): () => void;
}
```

- [x] **步骤 1：先增加 contract 测试。** 断言 bootstrap 数据、语言、模式、来源、listener 卸载和错误 fallback 的类型边界；断言 bridge 不返回 `planProof`、完整工具 JSON、完整答案或异常堆栈。
- [x] **步骤 2：运行目标测试确认失败。**

```powershell
npm --prefix frontend run test -- --run frontend/src/legacy/bridge.test.ts
```

- [x] **步骤 3：实现最小 bridge。** 由 `public/app.js` 内部继续调用现有 `applyPrompt()`、`runChatAgent()`、`_switchToChatMode()`、`_switchToReportMode()`、`_removeReportMemory()` 和 Legacy 状态；Vue 不直接读取 `window.CHATBOT_DATA`，也不复制 Legacy 路由。
- [x] **步骤 4：运行 contract 测试和静态测试。**

```powershell
npm --prefix frontend run test -- --run frontend/src/legacy/bridge.test.ts
node scripts/test_m6_chatbot_agent_behavior_parity.mjs
```

### 任务 3：恢复 Chatbot Report 全量路由和真实数据来源

**文件：**

- 修改：`frontend/src/features/chatbot/ChatbotPage.vue`
- 修改：`frontend/src/features/chatbot/ChatbotReportView.vue`
- 修改：`frontend/src/features/chatbot/ChatbotResultView.vue`
- 修改：`frontend/src/features/chatbot/useChatbotReport.ts`
- 修改：`frontend/src/features/chatbot/chatbotViewTypes.ts`
- 修改：`public/app.js` 的 Chatbot bridge
- 测试：`frontend/src/features/chatbot/ChatbotPage.test.ts`
- 测试：`scripts/test_m6_chatbot_agent_behavior_parity.mjs`

**行为要求：**

- Report 提交必须经过现有 `applyPrompt()` → `classifyWithLLM()`/规则 fallback → `answerPrompt()` 路由；不得由 `buildChatbotReport()` 单独决定最终回答。
- merchant ID 优先、歧义候选、无结果、非法过滤、支付、趋势、关键字、Publisher 和推荐排序必须保持 Legacy 语义。
- Report 结果必须显示 Legacy 的报告摘要、完整字段顺序、结果表、下载入口、当前上下文和缺失数据说明；只改变 DOM 承载方式，不改变公式和字段。
- 数据来源显示 `cache`、`db` 或不可用状态，并在首次查询和后续查询遵守 `loadLiveChatbotData()` 的刷新边界。

- [x] **步骤 1：先增加失败回归。** 使用旧版已存在的测试 fixture，分别断言 payment、trend、keyword、publisher、publisher profile 和 recommendation 查询不会被标记为 `deferred` 或缩减为缓存表格。
- [x] **步骤 2：运行并确认失败。**

```powershell
npm --prefix frontend run test -- --run frontend/src/features/chatbot/ChatbotPage.test.ts frontend/src/features/chatbot/chatbotReportModel.test.ts
node scripts/test_m6_chatbot_agent_behavior_parity.mjs
```

- [x] **步骤 3：把 Report submit 改为 bridge 调用。** `ChatbotPage` 只提交 prompt、接收受控 view model 和 DOM event，不再直接调用 `buildChatbotReport()` 作为生产路由。
- [x] **步骤 4：补齐结果渲染、上下文、下载和错误状态。** HTML 必须使用现有安全 Markdown/escape 规则；下载必须继续调用现有 `downloadRecommendationXlsx()`。
- [x] **步骤 5：运行目标测试和全部 Chatbot 回归。**

```powershell
npm --prefix frontend run test -- --run frontend/src/features/chatbot/ChatbotPage.test.ts frontend/src/features/chatbot/chatbotReportModel.test.ts frontend/src/shared/markdown/markdown.test.ts
node scripts/test_chatbot_answer_feedback_frontend.mjs
node scripts/test_chatbot_welcome.mjs
node scripts/test_zh_chatbot.mjs
```

### 任务 4：恢复数据来源展示和 Deep Window 完整行为

**文件：**

- 修改：`frontend/src/features/chatbot/DeepWindow.vue`
- 修改：`frontend/src/features/chatbot/useDeepWindows.ts`
- 修改：`frontend/src/features/chatbot/chatbotViewTypes.ts`
- 修改：`public/app.js:11902-13055`
- 修改：`frontend/src/legacy/contracts.ts`
- 测试：`frontend/src/features/chatbot/DeepWindow.test.ts`
- 测试：`frontend/src/features/chatbot/useDeepWindows.test.ts`
- 测试：`scripts/test_m6_chatbot_agent_behavior_parity.mjs`

**行为要求：**

- Report Mode 的普通查询继续使用现有 quick-result/Deep Window 语义；深度分析继续调用 `/api/chat/analyze`，并保留 skeleton、错误、取消和重建。
- Deep Window 必须继续支持多个同时打开的 panel、拖动、置顶、最小化/恢复、Escape、关闭、导出、图表同步、clone/overlay 和 `加入对话`。
- 记忆栏必须继续使用 Legacy 的完整 report snapshot 和 8000 字符边界；不能只保存一条本地摘要文本。
- 任何页面卸载都必须取消进行中的请求并隐藏/清理 Modern overlay，但不应误删仍属于 Legacy 会话的已完成面板。

- [x] **步骤 1：先写 Deep Window 行为测试。** 覆盖两个 panel、drag、minimize/restore、export、cancel、clone、overlay、memory drop 和离开页面清理。
- [x] **步骤 2：运行目标测试确认当前简化实现失败。**
- [x] **步骤 3：由 bridge 调用现有 `_createDeepPanel()`、`submitDeepReasoning()`、`_showQuickResultInDeepPanel()`、`_addToChat()` 和 panel 生命周期；Vue 只负责可访问的控制面板和状态同步。
- [x] **步骤 4：运行 Deep Window 测试并核对 `/api/chat/analyze`、`/api/chat/stream` 请求状态。**

### 任务 5：恢复 Chat Mode、Memory、反馈、日志和 onboarding

**文件：**

- 修改：`frontend/src/features/chatbot/ChatbotChatView.vue`
- 修改：`frontend/src/features/chatbot/useChatbotChat.ts`
- 修改：`frontend/src/features/chatbot/ChatbotPage.vue`
- 修改：`public/app.js:13225-13550,16847-17000,18459-18540`
- 修改：`public/chatbot_welcome.js`
- 修改：`public/onboarding_tour.js`
- 修改：`public/chatbot_i18n.js`
- 测试：`frontend/src/features/chatbot/ChatbotChatView.test.ts`
- 测试：`scripts/test_m6_chatbot_agent_behavior_parity.mjs`

**行为要求：**

- Chat Mode 必须继续先处理 Report Memory recommendation，再调用 Agent/普通 SSE fallback；不能只把报告 message 拼成 `memoryText`。
- 保留 `/api/chat/stream` 的 UTF-8 chunk、usage、`[DONE]`、Abort、timeout、非 2xx 和 fallback 语义；可见 UI 逐 token 更新。
- 反馈按钮必须保留并继续走 `operation=feedback`；问题日志下载必须保留 CSV/JSONL；帮助、用户指南、语言切换和 onboarding 事件顺序必须不变。
- 停止和失败的本轮消息不得写入正式历史；成功回答才更新历史和允许的结构化 Memory。

- [x] **步骤 1：先写失败测试。** 断言有 report snapshot 时推荐问题会生成结构化 recommendation context；断言 feedback/log 控件存在；断言停止后的消息不进入下一轮 history。
- [x] **步骤 2：运行目标测试确认失败。**
- [x] **步骤 3：让 Chat Mode 通过 Legacy session bridge 使用 `state.chatHistory`、`state.reportMemory`、`prepareChatMemoryRecommendation()` 和 `appendChatMemoryRecommendationContext()`；Vue 仅订阅渲染状态。
- [x] **步骤 4：补齐 feedback、logs、help、guide 和 onboarding bridge 事件。
- [x] **步骤 5：运行 Chat Mode/feedback/welcome/intent 回归。**

### 任务 6：恢复独立 Agent 的可见流式行为和会话生命周期

**文件：**

- 修改：`frontend/src/features/agent/AgentPage.vue`
- 修改：`frontend/src/features/agent/AgentTimeline.vue`
- 修改：`frontend/src/features/agent/agentModel.ts`
- 修改：`frontend/src/legacy/contracts.ts`
- 修改：`public/app.js:13961-14110,16062-16580,16600-17100`
- 测试：`frontend/src/features/agent/AgentPage.test.ts`
- 测试：`frontend/src/features/agent/AgentTimeline.test.ts`
- 测试：`scripts/test_agent_execution_timeline.mjs`
- 测试：`scripts/test_agent_stop_button.mjs`
- 测试：`scripts/test_m6_chatbot_agent_behavior_parity.mjs`

**行为要求：**

- 工具协议、planProof、工具校验、最多每批 4 个/总量 6 个、retry、partial/omitted 和 Trace 继续由现有 `runChatAgent()` 负责。
- bridge 必须把 `onToken`、计划/工具/综合阶段的受控 timeline metadata 传给 Vue，不得通过隐藏 DOM 解析步骤，也不得在 Vue 中复制工具执行。
- 成功回答才写正式历史和结构化 Memory；停止时保留 Legacy 的停止提示语义；失败时保留 Legacy 的错误提示和可重试状态。
- 页面切换返回 Agent 时保留历史、当前 Memory 和会话状态；New conversation 才清除它们。
- 保留 Agent 回答反馈、问题日志、Trace 和中英文文案。

- [x] **步骤 1：先写失败测试。** 覆盖 token callback、timeline metadata、导航返回后 history、停止提示、失败重试、feedback hook 和 Memory privacy。
- [x] **步骤 2：运行目标测试确认当前 `runModernAgent()`/隐藏 host 方案失败。**
- [x] **步骤 3：扩展 `LegacyAgentRunCallbacks`，让 `runChatAgent()` 在不改变工具协议的前提下把受控事件推给 Vue。
- [x] **步骤 4：将 Agent 页面状态提升到 bridge/session 层，组件卸载只解除订阅，不清空成功历史。
- [x] **步骤 5：运行 Agent 全部 Node/Python/Vitest 回归。**

```powershell
node scripts/test_chat_agent.mjs
node scripts/test_agent_memory_state.mjs
node scripts/test_agent_trace.mjs
node scripts/test_agent_question_logging.mjs
npm --prefix frontend run test -- --run frontend/src/features/agent
```

### 任务 7：Modern-first 闸门、卸载清理和文档收口

**文件：**

- 修改：`frontend/src/entry.ts`
- 修改：`public/app.js`
- 修改：`public/index.html`
- 修改：`scripts/test_modern_page_cutover.mjs`
- 修改：`scripts/test_m6_modern_mount.mjs`
- 修改：`docs/frontend-migration-inventory.md`
- 修改：`docs/chatbot-feature-report.md`
- 修改：`docs/superpowers/plans/2026-08-27-frontend-framework-migration-roadmap.md`

- [x] **步骤 1：在 parity 未通过前保持 `dashboard`/`agent` 的 `dual` 和 Legacy-safe fallback；Modern factory 失败、bridge 不可用或行为 contract 不完整时不得隐藏 Legacy 页面。
- [x] **步骤 2：增加挂载/卸载测试。** 断言不会重复绑定 chat submit、不会遗留 AbortController、不会丢失导航返回后的 session、不会留下 Deep Window overlay。
- [x] **步骤 3：保持 Legacy-first；更新清单状态和 M6 文档，Modern 只在显式 true 时用于逐页对照，并列出自动化覆盖与浏览器验收边界。
- [x] **步骤 4：运行完整验证。**

```powershell
npm --prefix frontend run typecheck
npm --prefix frontend run test -- --run
npm --prefix frontend run build
node --check public/app.js
node --check public/auth.js
node scripts/test_m6_chatbot_agent_behavior_parity.mjs
node scripts/test_m6_modern_mount.mjs
node scripts/test_modern_page_cutover.mjs
git diff --check
```

- [ ] **步骤 5：由用户执行浏览器验收。** 需要重新核对 Report 全路由、来源刷新、Deep Window 全交互、Chat Mode 流式/Memory/反馈/日志、Agent 流式/工具时间线/停止/导航返回/Memory，以及与原版的视觉和交互一致性；验收前保持 `dual`。

## 本轮执行记录（2026-09-02）

- 已完成 Chatbot Report/Chat/Deep Window 与独立 Agent 的受控 Legacy session bridge；Modern 只接收状态、可见 token、时间线元数据和白名单操作，不复制查询、Agent 工具协议、`planProof` 或 Trace 内容。
- Report 继续经 `applyPrompt()` 与 `loadLiveChatbotData()` 处理完整路由和来源刷新；Chat Mode 保留 Report Memory、Memory recommendation、SSE/fallback/停止、反馈、日志、帮助、指南和 onboarding；Deep Window 保留多窗口、拖动、置顶、最小化/恢复、关闭/取消、图表控制、clone/overlay、导出和加入对话；Agent 保留 planning/tool/synthesis、partial/omitted、可见流式回答、停止、失败状态、Trace 和结构化 Memory。
- 按 TDD 完成 bridge 字段白名单、Memory recommendation、Deep Window 图表代理、Chat/Agent 卸载中止和“只标记当前 assistant 流式状态”等 RED → GREEN 回归；Memory snapshot/event 不再透传 `planProof`、工具 payload 或 Trace 字段。
- 本次 Legacy-first 与原版结构对齐已通过 12 个相关 Vitest 文件/52 项、Vite build、M6 parity/mount/cutover、关键 Chatbot/Agent Node 回归及 Chat Agent 33 场景；完整 typecheck 仅被任务开始前已有的未跟踪 M7 session 文件阻断，本次模板自身类型错误已清零。
- 安全边界：`dashboard`/`agent` 当前保持 `dual` 与 Legacy-first；`modernChatbotAgentBridgeAvailable()` 仍是挂载前置条件，只有显式 `window.__OI_MODERN_CHATBOT_AGENT_PARITY__ = true` 才启用 Modern 对照页。本轮未删除 Legacy bridge、Legacy DOM 或旧业务逻辑。
- 未完成项：真实浏览器登录、数据、视觉、SSE 网络和完整用户操作由用户最终验收；`test_chatbot_intent_flow.mjs` 的历史性超时继续单独记录。

## 完成判定

M6 只有同时满足以下条件才算完成：

1. Modern 页面已挂载且不重复绑定 Legacy 事件。
2. 上述五个功能域的用户操作、请求链路、数据口径、错误/停止状态和会话生命周期与 Legacy 等价。
3. 所有新增 parity、现有 Vitest、Node/Python 回归和 build/typecheck 通过。
4. `test_chatbot_intent_flow.mjs` 若仍超时，必须继续单独标记为历史性未通过，不能用其他测试替代。
5. 浏览器视觉和真实接口验收由用户完成并明确确认。

当前判定：行为迁移和 Modern 对照能力保留，但生产视图未完成 Modern 放行；M6 Chatbot/Agent 当前为 `dual` / Legacy-first，待用户完成最终视觉与真实接口验收后再决定是否放行。
