# M6 Chatbot 与 Agent 现代化迁移实施计划

> 日期：2026-09-01
> 目标：在不改变现有数据口径、服务端 Agent 协议、隐私边界和 legacy 回退能力的前提下，将 Chatbot Report/Chat Mode 与独立 Chat Agent 迁移到 Vue/TypeScript modern runtime。
> 权威依据：`docs/chatbot-feature-report.md`、`docs/superpowers/plans/2026-08-27-frontend-framework-migration-roadmap.md`、当前 `public/app.js`、现有 Node/Python/Vitest 回归。
> 状态修正（2026-09-02）：用户反馈 Modern 与原版视觉和交互差异较大，当前已撤回 Modern-first 放行。Chatbot/Agent 恢复为 `dual` 与 Legacy-first；只有显式设置 `window.__OI_MODERN_CHATBOT_AGENT_PARITY__ = true` 才进入 Modern 逐页对照，最终视觉验收待用户完成。

## 现状与边界

- 当前 `frontend/src/entry.ts` 已具备 modern shell 和页面 factory 注册机制，但 `dashboard` 与 `agent` 尚未注册 factory。
- 当前 Chatbot 页面根节点是 `.dashboard-page`，Agent 页面根节点是 `#dashboardAgentPage`；两者仍由 `public/app.js` 的 `switchPage()`、`applyPrompt()`、`answerPrompt()`、`runChatAgent()` 等函数驱动。
- 现有 `/api/chat/classify`、`/api/chat/analyze`、`/api/chat/agent`、`/api/chat/stream`、问题日志、反馈和导出契约必须继续使用；modern 层不得绕过服务端校验或把模型文本当成数据事实。
- 旧文档引用的 `docs/superpowers/specs/2026-08-14-chat-mode-agent-design.md` 在当前工作区不存在。缺失文件不作为实现依据；若后续发现新的上游规范，必须先对比契约再实施。
- 浏览器登录、真实数据、视觉几何和 SSE 实际网络验收由用户负责；本计划中的自动化测试不能替代浏览器验收。
- 本轮未获得提交或推送授权；完成实现和验证后只保留本地改动，等待用户明确要求 GitHub 操作。

## 不可改变的契约

1. LLM 分类失败、超时或不可用时继续走现有规则后路由。
2. 搜索、统计、推荐、支付和趋势结论只能来自可验证数据；没有数据时显示缺失或不确定状态。
3. Agent 工具名称、参数归一化、`contractVersion: "v2"`、`agent-tools-v1`、`planProof`、结果白名单、服务端校验和最多工具调用边界保持不变。
4. Trace 是异步、可丢弃的观测；写入失败不能阻断回答，且不得记录 prompt、完整工具 JSON、工具结果正文、答案正文或异常堆栈。
5. SSE 必须保留 chunk 拼接、UTF-8 解码、`usage` 事件、`[DONE]`、中止、超时、非 2xx、fallback 和 stopped 语义。
6. 失败或停止的本轮用户消息不得写入正式历史；结构化记忆只保留现有 allowlist 信息，不保存完整问答、数值、详细行或工具 JSON。
7. Report Mode、Chat Mode、独立 Agent 页面和 Deep Window 的关系按照 `docs/chatbot-feature-report.md` 保持不变。

## 执行顺序

## 当前执行进度

- [x] 任务 0：完成迁移基线、现有契约和缺失规范核对。
- [x] 任务 1：完成首个 DOM-free Chatbot model 切片及 6 个 Vitest 回归。
- [x] 任务 2：共享 Markdown renderer。
- [x] 任务 3：共享 SSE parser。
- [x] 任务 4：Report Mode modern page（完整路由和数据来源通过 Legacy bridge 委托，结果、下载、反馈上下文和页面卸载边界已接入）。
- [x] 任务 5：Chat Mode streaming 与记忆栏（共享 SSE、逐 token、停止、结构化 Report Memory、Memory recommendation、反馈/日志入口已接入）。
- [x] 任务 6：Deep Window 生命周期（报告/Chat 快速结果、拖动、置顶、最小化/恢复、关闭/取消、图表控制、clone/overlay、导出、加入对话和卸载边界已接入）。
- [x] 任务 7：Agent modern page（现代工作区、可见流式回答、受控 planning/tool/synthesis 时间线、停止、失败状态、Trace bridge 和结构化记忆已接入；工具执行继续由 Legacy bridge 承担）。
- [x] 任务 8：onboarding、help、反馈和日志。
- [x] 任务 9：M6 dual runtime 收口与文档（factory、根节点、完整 bridge contract、卸载回退和 Legacy-safe parity 闸门已接入；当前保持 `dual` / Legacy-first，Modern 仅用于显式逐页对照）。

### 当前实现状态（2026-09-02）

- `#chatbotModernRoot` 与 `#agentModernRoot` 已由 `frontend/src/entry.ts` 注册；`public/app.js:switchPage()` 默认显示 Legacy 页面。仅当 `window.__OI_MODERN_CHATBOT_AGENT_PARITY__ === true` 且 Modern factory/bridge 可用时显示 Modern 对照页，挂载失败时仍恢复 Legacy。
- Chatbot 已通过受控 bridge 复用 `applyPrompt()`、`loadLiveChatbotData()`、完整 Report 路由、来源刷新、共享 Markdown/SSE、逐 token、停止、报告记忆、Memory recommendation、反馈/日志/onboarding 和 Deep Window 全部交互；Agent 已接入可见流式回答、planning/tool/synthesis 摘要时间线、partial/omitted、停止、Trace bridge 和结构化记忆。
- 为保持现有协议，Chat Mode/Agent 的服务端调用、问题日志和 Agent Trace 继续通过受控 `OI_LEGACY_BRIDGE` 复用既有 `runChatAgent()` 与 SSE 链路；Vue 层不复制 `planProof`、工具参数校验或 Trace 敏感字段，Memory snapshot/event 经过字段白名单。
- 自动化覆盖现代组件、原版结构类、挂载/卸载、完整 bridge contract、Legacy fallback 和行为 parity；当前 `dashboard`/`agent` 标记为 `dual`，真实浏览器登录、数据、视觉、SSE 网络和完整操作由用户最终验收。`test_chatbot_intent_flow.mjs` 仍为历史性超时，不能计为通过。

### 任务 0：迁移基线和 modern 挂载边界

**目标**：先固定当前行为和 dual runtime 边界，不改变业务逻辑。

**检查项**：

- 阅读 `docs/chatbot-feature-report.md` 与当前 `public/app.js` 目标函数索引。
- 为 `dashboard` 和 `agent` 约定独立 roots：`#chatbotModernRoot`、`#agentModernRoot`；保留现有 legacy DOM 作为 fallback。
- 为 modern page factory 增加 `dashboard`、`agent` 注册位，但在页面实现未完成前不能让入口默认为空白页面。
- 为测试增加“modern factory 不可用时 legacy 仍可用”的边界断言。

**验证**：

```powershell
git status --short --branch
rg -n "dashboard|agent|OI_MODERN_APP|chatbotModernRoot|agentModernRoot" frontend/src public/index.html public/app.js scripts
npm --prefix frontend run typecheck
npm --prefix frontend run test -- --run frontend/src/legacy/bridge.test.ts frontend/src/shell/AppShell.test.ts
```

### 任务 1：迁移 DOM-free Chatbot model

**目标**：先把不依赖 DOM 的搜索、分类、Tier、意图和结果压缩逻辑迁移到 TypeScript，保持 legacy wrapper 可调用。

**新增文件**：

- `frontend/src/features/chatbot/chatbotModel.ts`
- `frontend/src/features/chatbot/chatbotModel.test.ts`
- `frontend/src/features/chatbot/chatbotTypes.ts`

**接口约定**：

```ts
export type ChatbotIntent =
  | "asin" | "merchant" | "payment" | "recommendation"
  | "tier" | "category" | "analysis";

export interface ChatbotSearchOptions {
  readonly tier?: string | null;
  readonly includeTier4?: boolean;
  readonly includeBlack?: boolean;
  readonly metricFilters?: readonly ChatbotMetricFilter[];
}

export interface ChatbotSearchMatch {
  readonly offer: Readonly<Record<string, unknown>>;
  readonly score: number;
  readonly matchType: "merchant" | "asin" | "keyword" | "category";
  readonly matchedTerms: readonly string[];
}

export interface ChatbotMerchantResolution {
  readonly status: "resolved" | "ambiguous" | "not_found";
  readonly matches: readonly ChatbotSearchMatch[];
}

export function detectChatbotIntent(prompt: string, options?: Readonly<Record<string, unknown>>): ChatbotIntent;
export function resolveChatbotCategory(prompt: string, categories: readonly string[]): string | null;
export function resolveChatbotMerchant(prompt: string, offers: readonly Readonly<Record<string, unknown>>[]): ChatbotMerchantResolution;
export function searchChatbotOffers(offers: readonly Readonly<Record<string, unknown>>[], prompt: string, options?: ChatbotSearchOptions): ChatbotSearchMatch[];
export function compactChatbotResult(value: unknown, limits?: Readonly<Record<string, number>>): unknown;
```

**TDD 步骤**：

1. 先写 fixture：同一品牌的 merchant ID/name、Tier 1–4、BLACK TIER、ASIN、category 和关键词字段。
2. 先运行目标 Vitest，确认缺少 module 或行为断言失败（RED）。
3. 只实现纯函数和不可变结果，运行目标 Vitest 至少达到 GREEN。
4. 与 `scripts/test_chatbot_intent_flow.mjs`、`scripts/test_zh_chatbot.mjs` 的边界逐项对照，补充中文 Tier/category/merchant 路由、别名、黑名单排除和缺失数据测试。
5. 在 `public/app.js` 中只增加兼容性调用入口或 bridge 适配；未完成全页面替换前，不删除 legacy 函数。

**必须覆盖**：

- category source precedence、别名和模糊阈值；
- Tier 1–4 与 BLACK TIER 的默认排除/显式包含规则；
- merchant ID 优先于名称、无结果和歧义结果不得强行选择；
- ASIN、关键词、category、merchant 查询的匹配类型和排序稳定性；
- 数值、月度行、payment/trend 结果压缩不得泄漏未 allowlist 字段。

### 任务 2：共享 Markdown renderer

**新增文件**：

- `frontend/src/shared/markdown/markdown.ts`
- `frontend/src/shared/markdown/markdown.test.ts`

**接口**：

```ts
export interface MarkdownRenderOptions {
  readonly allowTables?: boolean;
  readonly allowLinks?: boolean;
}

export function renderMarkdownToHtml(markdown: string, options?: MarkdownRenderOptions): string;
```

**要求**：复用现有 `markdownToHtml()` 的标题、段落、列表、表格、代码 fence 和链接安全语义；所有文本先转义，禁止任意 HTML 注入。测试覆盖跨 chunk 文本不会被截断、恶意标签被转义、帮助文档表格和列表可渲染。Report/Agent 先通过 adapter 使用 shared renderer，legacy helper 保留到 M7 删除。

### 任务 3：共享 SSE parser

**新增文件**：

- `frontend/src/shared/stream/sse.ts`
- `frontend/src/shared/stream/sse.test.ts`

**接口**：

```ts
export interface SseEvent {
  readonly event: string;
  readonly data: string;
  readonly id?: string;
}

export interface SseStreamOptions {
  readonly signal?: AbortSignal;
  readonly onEvent: (event: SseEvent) => void | Promise<void>;
}

export function parseSseChunk(parser: SseParser, chunk: Uint8Array | string): void;
export function createSseParser(options: SseStreamOptions): SseParser;
export async function consumeSseResponse(response: Response, options: SseStreamOptions): Promise<void>;
```

**行为**：非 2xx 先抛出不包含 response body 敏感内容的错误；使用 `TextDecoder` 的 streaming 模式处理 UTF-8；事件以空行分隔；识别 `type: usage` 和 `[DONE]`；AbortError 由调用方识别为 stopped，不改写成普通失败；结束时 flush decoder 和未完成行。测试覆盖每个边界：半个 JSON、半个 UTF-8 字符、usage、done、中止、网络错误、非 2xx、重复 done。

### 任务 4：Report Mode modern page

**新增文件**：

- `frontend/src/features/chatbot/ChatbotPage.vue`
- `frontend/src/features/chatbot/ChatbotReportView.vue`
- `frontend/src/features/chatbot/ChatbotResultView.vue`
- `frontend/src/features/chatbot/useChatbotReport.ts`
- 对应 `*.test.ts`、`chatbot.css`

**修改文件**：`frontend/src/entry.ts`、`frontend/src/legacy/contracts.ts`、`public/index.html`、`public/app.js`。

**实施**：

1. 用 `getLegacySnapshot()` 读取 chatbotData、sheetReportData、productKeywords、language 和 llmEnabled；不能在 Vue 中直接读取 `window.CHATBOT_DATA`。
2. Report composable 只负责 prompt/session/loading/error/currentContext/deep report；model 负责路由和结果；API 通过现有 bridge 或共享 client 调用。
3. 先复现现有 fixture 的统计卡、结果表、下载上下文和 no-data 状态，再让 Vue 输出相同语义和字段顺序。
4. modern mount 成功时隐藏 legacy dashboard 内容；mount 失败时恢复 legacy 并给出受控 console warning。
5. LLM classify 失败必须执行同一规则 fallback；具体结果仍由数据 model 生成。

**测试**：Report/Chat Mode 切换、分类失败 fallback、merchant/category/tier/payment/ASIN/analysis 路由、统计卡、结果表、导出上下文、语言切换和页面卸载清理。

### 任务 5：Chat Mode streaming 与记忆栏

**新增/修改**：

- `frontend/src/features/chatbot/ChatbotChatView.vue`
- `frontend/src/features/chatbot/useChatbotChat.ts`
- `frontend/src/features/chatbot/chatbotChatModel.ts` 及测试
- `frontend/src/shared/stream/sse.ts`
- `public/agent_memory_state.js`（仅在需要共享已有 schema adapter 时修改）

**要求**：

- 使用任务 3 的 parser，逐事件更新 assistant message；保留 usage 可用/不可用状态，不把缺失 usage 显示成 0。
- 流式期间保持滚动策略、停止按钮、超时和 retry/fallback 语义；停止后不写正式历史。
- 记忆栏只消费结构化 allowlist snapshot；拖入/移除上下文、清空、新会话、logout 清理行为与现有实现一致。
- 反馈、问题日志和导出继续走现有 endpoint/bridge，不在前端保存 prompt 或 answer 的非必要副本。

### 任务 6：Deep Window 生命周期

**新增文件**：

- `frontend/src/features/chatbot/DeepWindow.vue`
- `frontend/src/features/chatbot/useDeepWindows.ts`
- 对应测试和 scoped CSS

**要求**：迁移最小化、恢复、关闭、页面切换自动最小化、非推理状态清理、图表控制和 clone/overlay 行为。不能重新执行会改变数据口径的查询；Deep Window 使用已有 report snapshot 和 rows。测试需断言切换离开 dashboard 后没有遗留 AbortController、监听器或可见 overlay。

### 任务 7：Agent modern page

**新增文件**：

- `frontend/src/features/agent/AgentPage.vue`
- `frontend/src/features/agent/AgentTimeline.vue`
- `frontend/src/features/agent/agentModel.ts`
- `frontend/src/features/agent/agentModel.test.ts`
- `frontend/src/features/agent/useAgent.ts`
- `frontend/src/features/agent/useAgent.test.ts`
- `frontend/src/features/agent/agent.css`

**实施**：

1. 使用当前 `buildAgentPlanningRequest()`、`agentExecuteTool()`、`buildAgentSynthesisRequest()` 所需的 bridge contract；不在 Vue 中复制服务端 `planProof` 或工具参数校验。
2. timeline 显示 planning、tool batch、partial/omitted、synthesis、usage、stopped/error 的受控元数据，不显示 prompt、完整工具 JSON、结果正文、答案正文或异常堆栈以外的敏感 Trace 内容。
3. 工具批次最多 4 个、总量最多 6 个；按服务端计划的 call ID 关联结果；`hasMore` 的 tier 分页必须显式显示未完整加载。
4. merchant/category/payment/trend 的 ambiguous/not_found/invalid_filter 保持 fail-closed，不自动改成全量查询。
5. stop 使用 AbortController；成功才写正式历史和结构化记忆；失败/停止保持现有 fallback history 语义。
6. modern mount 成功时隐藏 `#dashboardAgentPage` legacy 内容；卸载时中止请求、移除监听器、清理 timeline。

**测试**：使用现有 `scripts/test_chat_agent.mjs` 的 planner/tool/synthesis fixture，补充 Vitest 对时间线状态机、批次/partial、stop、memory privacy、Trace metadata 和 language 的验证。

### 任务 8：onboarding、help、反馈和日志

**修改文件**：`public/chatbot_i18n.js`、`public/chatbot_welcome.js`、`public/onboarding_tour.js`、`public/agent_memory_state.js`、modern feature i18n/CSS、对应 Node tests。

**要求**：保持中英文 copy、cache version、`.welcome-progress-step.active`、`report-ready → memory-ready → chat-active` 事件顺序和当前 help markdown 内容；反馈/问题日志下载按钮在 modern view 中有稳定 data hooks；不改变已有日志脱敏规则。旧 Node 回归继续运行，新增 modern component test 覆盖关键状态。

### 任务 9：M6 modern-first 收口与文档

**修改文件**：`frontend/src/entry.ts`、`public/index.html`、`public/app.js`、`docs/chatbot-feature-report.md`、`docs/frontend-migration-inventory.md`、Roadmap。

**收口步骤**：

1. 为 `dashboard` 和 `agent` 注册 factory，统一 mount/unmount/fallback 处理；在行为 parity 完成前由 `modernChatbotAgentParityEnabled()` 保持 Legacy-first。
2. 用 `rg` 确认 `public/app.js` 不再作为默认 modern 页面执行 Chatbot 问答、Agent 工具、分析和 stream rendering；legacy 函数只能保留在明确 fallback/bridge 范围。
3. 只有行为 parity、完整回归和浏览器验收都通过后，inventory 才能将 `dashboard`、`agent` 状态改为 `modern`；在此之前保持 `dual` 并记录 Legacy-first 闸门。
4. 添加静态 M6 cutover contract test，防止 dashboard/agent factory 注册缺失、现代根节点缺失或意外重新启用 legacy 默认渲染。
5. 不删除 `public/app.js`、legacy DOM 或 bridge；删除属于 M7，必须有独立引用审计和用户授权。

## 分阶段验证命令

每个任务先运行目标测试，再运行受影响的旧回归。完整 M6 收口至少运行：

```powershell
npm --prefix frontend ci
npm --prefix frontend run typecheck
npm --prefix frontend run test -- --run
npm --prefix frontend run build
node --check public/app.js
node --check public/chatbot_i18n.js
node --check public/chatbot_welcome.js
node --check public/onboarding_tour.js
node scripts/test_chatbot_intent_flow.mjs
node scripts/test_zh_chatbot.mjs
node scripts/test_chat_agent.mjs
node scripts/test_agent_memory_state.mjs
node scripts/test_agent_trace.mjs
node scripts/test_agent_execution_timeline.mjs
node scripts/test_agent_stop_button.mjs
node scripts/test_agent_question_logging.mjs
node scripts/test_chatbot_welcome.mjs
node scripts/test_onboarding_tour.mjs
python scripts/test_chat_stream_agent_config.py
python scripts/test_agent_contract.py
python scripts/test_agent_planning_contract.py
python scripts/test_agent_synthesis_contract.py
python scripts/test_agent_trace.py
python scripts/test_agent_trace_http.py
python scripts/test_llm_usage.py
python -m py_compile auth.py server.py offer_db.py api/chat/actions.py api/chat/stream.py api/tier_moves.py
git diff --check
git status --short
```

浏览器验收清单交给用户执行：登录后打开 Chatbot 和 Agent；分别验证 Report/Chat 切换、真实数据、Markdown/表格/下载、Deep Window、记忆栏、停止、重试、Agent 时间线和中英文；再验证刷新与页面切换后没有重复请求或旧页面残留。需要真实 DB、LLM、SSE 或视觉证据的项目不能由静态测试代替。

## M6 退出门槛

- [x] Chatbot 与 Agent 的 Modern factory 已注册；默认使用 Legacy，显式 parity 开关设为 true 时可挂载 Modern 对照页，失败可回退 Legacy。
- [x] Chatbot Report/Chat、Deep Window 和 Agent 的核心路径有 Vitest/Node 回归；服务端 Agent/Trace/Python 回归保持通过。
- [x] `public/app.js` 保持 Legacy 默认执行入口；Modern 对照页通过受控 bridge 复用问答、工具、分析和流式渲染链路。
- [x] SSE parser 覆盖 chunk、UTF-8、usage、done、abort、timeout、retry 和非 2xx 的代码级边界。
- [x] memory、Trace、日志和反馈没有扩大隐私或敏感数据边界。
- [x] `docs/chatbot-feature-report.md`、`docs/frontend-migration-inventory.md`、Roadmap 与实际代码已同步当前状态。
- [ ] 本次 Legacy-first 对齐的相关 Vitest、构建和差异检查已通过；完整 typecheck 仅被任务开始前已有的未跟踪 M7 session 文件阻断。浏览器真实验收由用户完成；`test_chatbot_intent_flow.mjs` 的历史性超时继续单独记录。

## 本轮执行记录

- 已完成 `chatbotModel.ts`、`chatbotReportModel.ts`、`ChatbotResultView.vue` 的首批纯 model/结果 View 迁移，并用 fixture 覆盖中文/英文意图、ID 优先、category/Tier 默认过滤、空结果和安全结果压缩。
- 已完成共享 `markdown.ts` 与 `sse.ts` 基础实现；目标测试分别为 3/3 与 4/4，通过严格类型检查。
- 已完成 `ChatbotPage.vue`、`ChatbotReportView.vue`、`ChatbotChatView.vue`、`DeepWindow.vue`、`useDeepWindows.ts`、`AgentPage.vue`、`AgentTimeline.vue`、Agent model、Legacy bridge 和受控 Memory 白名单；未修改侧边栏视觉。
- `scripts/test_m6_modern_mount.mjs`、`scripts/test_m6_chatbot_agent_behavior_parity.mjs` 和 `scripts/test_modern_page_cutover.mjs` 通过；前端全量 Vitest 51 个测试文件/229 项通过，typecheck、Vite build、`node --check public/app.js`/`public/auth.js` 及 Agent v2/Trace/Python 回归通过。
- 本轮关键旧回归中 `test_chat_agent.mjs` 33 个场景、Agent memory、Agent timeline、Agent stop、question logging、welcome、onboarding、Chatbot mode navigation 和中文 Chatbot 均通过。
- `test_chatbot_answer_feedback_frontend.mjs` 与 `test_chatbot_intent_picker.mjs` 仍受现有 `styles.css` cache-version 断言影响（测试要求旧版本号，当前入口使用 `20260901`）；该基线断言未改生产版本，也未将其计入通过项。
- `test_chatbot_intent_flow.mjs` 本轮运行超过 60 秒无输出并留下高 CPU Node 进程；已确认是该测试进程并停止。该脚本仍记为未完成验证，不能作为 M6 通过证据。
- Agent timeline/stop 两个旧测试的失败根因是 Windows CRLF 与只匹配 LF 的测试正则；已在测试读取源码时统一换行，未修改生产 CSS 或 Agent 行为。
- 当前已撤回 Modern-first 放行并恢复 Legacy-first；Modern 复用原版结构与样式类作为显式对照页保留。浏览器登录、真实数据、视觉几何、SSE 实际网络和完整 Chatbot/Agent 操作由用户重新验收。
