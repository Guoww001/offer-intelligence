# Chatbot Legacy-first Parity Gap Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (recommended). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保持 Chatbot 默认 Legacy-first 的前提下，补齐 Vue3 Modern 对照页与原版 Chatbot 在 Deep Window、结果交互、反馈、帮助/引导、输入指令、Memory 和实时上下文方面的功能与视觉差异。

**Architecture:** Legacy runtime 继续作为唯一的业务、数据和请求行为来源；Vue3 不复制意图路由、数据查询或 Agent/SSE 逻辑，而是通过扩展后的 screen-safe bridge 接收完整的页面状态和事件更新。Modern root 只在显式开启对照开关时挂载，负责渲染自己的可见 DOM；Legacy 默认路径、Legacy DOM 和服务端 API 保持不变。原版已有的 HTML 结果片段、帮助内容和下载注册表继续由 Legacy 生成，Vue3 只负责受控承载、交互转发和状态同步。

**Tech Stack:** Vue 3、TypeScript、Vitest、Node 静态契约测试、现有 Legacy runtime、现有 public/styles.css、现有 /api/chat/* 和 /api/ui/db/*。

## Global Constraints

- 默认行为必须保持 Legacy-first；只有 window.__OI_MODERN_CHATBOT_AGENT_PARITY__ === true 且 bridge 可用时才显示 Modern 对照页。
- 不修改 Chatbot 后端、LLM 意图分类、SSE 协议、Agent 工具、数据库查询公式、问题日志格式或反馈隐私契约。
- 不在 Vue3 中重写 merchant、ASIN、category、Tier、recommendation、payment、trend、keyword、publisher 和 publisher profile 路由。
- Bridge 只暴露渲染所需的白名单状态；不得暴露 Provider 密钥、planProof、完整工具 payload、完整 Trace、异常堆栈或新增的原始回答持久化数据。
- 保留 Legacy 的缓存/DB 来源标识、实时刷新、下载 ID、Report Memory 字符边界和停止/失败语义。
- Legacy DOM 仍可作为行为适配器，但 Modern 模式下所有用户可见帮助、引导、反馈、Deep Window 和 Chat answer action 必须由 Modern root 自己渲染。
- 不新增第三方依赖；优先扩展已有组件和 contract，只有在职责明确且有独立测试时才新增 Vue 文件。
- 保留工作区开始前已有的修改、未跟踪文件和缓存；执行本计划时不得覆盖 unrelated changes。
- 每个任务都先写针对当前差异的失败测试，再做最小实现；任务完成后只运行对应的目标测试。
- 本计划不包含 commit、push、merge 或 PR 操作；执行时是否提交由用户另行授权。
- 自动化测试、类型检查和构建不能替代真实浏览器验收；最终视觉、登录后真实数据、SSE 网络和完整手势验收交给用户。

## 现状基准与文件边界

权威行为基准是 docs/chatbot-feature-report.md、public/app.js、public/index.html 和 public/styles.css。当前 Modern 入口主要位于 frontend/src/features/chatbot/ChatbotPage.vue；它已经能消费 Legacy session/deep-window bridge，但 Chat view state 只保留当前结果，Deep Window view 也只有通用结果字段。

| 文件 | 本计划中的责任 |
| --- | --- |
| frontend/src/legacy/contracts.ts | 定义可渲染的 Chat answer、Deep Window、utility panel、command menu 和上下文交互契约。 |
| frontend/src/legacy/bridge.ts | 对 Legacy state 做长度、枚举和字段白名单归一化，并把按回答/按窗口的反馈与操作安全地绑定到 ID。 |
| public/app.js | 从现有 Legacy runtime 提供扩展后的快照和通知；继续调用现有 applyPrompt、answerPrompt、Deep Window、日志、帮助和反馈实现。 |
| frontend/src/features/chatbot/ChatbotPage.vue | 组合 Report、Chat、utility、onboarding、Deep Window 和单回答操作，负责订阅/卸载 bridge。 |
| frontend/src/features/chatbot/ChatbotReportView.vue | 渲染原版 Context Overview、空状态、结果操作、命令输入和 Report answer action。 |
| frontend/src/features/chatbot/ChatbotChatView.vue | 渲染原版 Chat log、每条回答操作、常驻 reminder、Memory dropzone 和 Chat composer。 |
| frontend/src/features/chatbot/DeepWindow.vue | 渲染完整 Deep Window 生命周期、骨架、内容、错误、反馈、拖拽和原版按钮可见性。 |
| frontend/src/features/chatbot/ChatbotResultView.vue | 只承载 Legacy 结果片段和无 HTML 时的明确状态，不再用简化表格冒充完整 Report 路由。 |
| frontend/src/features/chatbot/ChatAnswerActions.vue | 新增；承载每条 Chat answer 的 View/feedback 操作和已反馈状态。 |
| frontend/src/features/chatbot/AnswerFeedbackDialog.vue | 新增；复刻 Legacy feedback modal 的遮罩、焦点、Escape、校验和提交状态。 |
| frontend/src/features/chatbot/ChatbotCommandMenu.vue | 新增；复刻 / 意图菜单、命令高亮和键盘选择。 |
| frontend/src/features/chatbot/ChatbotUtilityPanels.vue | 新增；承载 Help、User Guide、Logs、Clear 和 onboarding 入口的 Modern 可见 UI。 |
| frontend/src/features/chatbot/ChatbotOnboarding.vue | 新增；承载 welcome/progress/reminder，并把 go-report 事件映射到 Vue mode。 |
| frontend/src/features/chatbot/chatbot.css | 使用 Legacy class/token 复刻 Modern root 内的尺寸、间距、层级、状态和响应式规则。 |
| frontend/src/features/chatbot/*.test.ts | 覆盖组件行为、事件转发、键盘操作、状态可见性和卸载清理。 |
| scripts/test_chatbot_legacy_first_parity_gap.mjs | 新增；阻止 Modern 回退到简化结构或重新隐藏 Modern 所需的可见功能。 |
| docs/chatbot-feature-report.md | 完成后记录 Modern 对照页的已覆盖边界和仍需用户浏览器验收的证据边界。 |

## 实现任务

### Task 1: 扩展 screen-safe bridge 契约并建立差异门禁

**Files:**

- Modify: frontend/src/legacy/contracts.ts:19-193
- Modify: frontend/src/legacy/bridge.ts:101-228,437-675
- Modify: public/app.js:34466-35090
- Modify: frontend/src/features/chatbot/ChatbotPage.vue:45-252
- Modify: frontend/src/features/chatbot/chatbotViewTypes.ts:19-59
- Test: frontend/src/legacy/bridge.test.ts
- Create: scripts/test_chatbot_legacy_first_parity_gap.mjs

**Interfaces:**

- Consumes: Legacy native panel state, Legacy chat history, existing answer feedback context registry and existing help/guide DOM snapshots.
- Produces: ChatbotPage、ChatbotChatView、DeepWindow 和后续 utility components 使用的类型安全 view model；所有按回答/按窗口的行为都以稳定 ID 调用。

- [x] **Step 1: 写失败的静态 parity gate。**

创建 scripts/test_chatbot_legacy_first_parity_gap.mjs，内容至少包含以下断言；当前代码应因缺少 answer action、完整 Deep Window 结构和 Modern utility state 而失败：

~~~js
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const contracts = read("frontend/src/legacy/contracts.ts");
const stage = process.env.CHATBOT_PARITY_STAGE || "bridge";

assert.match(contracts, /LegacyChatAnswerMessage/);
assert.match(contracts, /feedbackForAnswer/);
assert.match(contracts, /LegacyDeepWindowSkeletonStep/);
if (stage === "full") {
  const page = read("frontend/src/features/chatbot/ChatbotPage.vue");
  const chat = read("frontend/src/features/chatbot/ChatbotChatView.vue");
  const deep = read("frontend/src/features/chatbot/DeepWindow.vue");
  const utility = read("frontend/src/features/chatbot/ChatbotUtilityPanels.vue");
  assert.match(page, /ChatbotUtilityPanels/);
  assert.match(page, /ChatbotOnboarding/);
  assert.match(chat, /data-chat-answer-id/);
  assert.match(chat, /data-chatbot-action="open-chat-deep"/);
  assert.match(deep, /class="deep-window"/);
  assert.match(deep, /deep-window-skeleton/);
  assert.match(deep, /deep-window-feedback/);
  assert.match(utility, /data-chatbot-action="onboarding"/);
  assert.match(utility, /data-chatbot-action="clear"/);
}
console.log("Chatbot Legacy-first parity gap gate: PASS");
~~~

- [x] **Step 2: 运行 RED 测试。**

Run:

~~~powershell
node scripts/test_chatbot_legacy_first_parity_gap.mjs
npm --prefix frontend run test -- --run src/legacy/bridge.test.ts
~~~

Expected: bridge contract 静态 gate 因当前类型缺失而失败；bridge 测试保持可执行，不得出现测试 runner 配置错误。

- [x] **Step 3: 增加白名单类型。**

在 frontend/src/legacy/contracts.ts 中增加以下契约；按回答反馈和 Deep Window 反馈只通过方法取回已绑定的 bridge，不把回答正文以外的内部 context 暴露给 Vue：

~~~ts
export type LegacyAnswerFeedbackState = "available" | "submitted" | "unavailable";

export interface LegacyChatAnswerMessage extends LegacySessionMessage {
  readonly id: string;
  readonly answerId?: string;
  readonly contentHtml?: string;
  readonly deepWindowId?: string | null;
  readonly canOpenDeep?: boolean;
  readonly feedbackState?: LegacyAnswerFeedbackState;
}

export interface LegacyChatUtilityState {
  readonly helpOpen: boolean;
  readonly guideOpen: boolean;
  readonly helpHtml: string;
  readonly guideHtml: string;
  readonly guideLoading: boolean;
  readonly onboardingOpen: boolean;
  readonly onboardingStep: number;
  readonly onboardingTotal: number;
  readonly reminderVisible: boolean;
  readonly reminderCollapsed: boolean;
}

export interface LegacyDeepWindowSkeletonStep {
  readonly id: string;
  readonly label: string;
  readonly state: "pending" | "active" | "done";
}

export interface LegacyChatViewState {
  readonly mode: "report" | "chat";
  readonly language: UiLanguage;
  readonly contextTitle?: string;
  readonly contextSubtitle?: string;
  readonly contextHtml?: string;
  readonly hasMemory: boolean;
  readonly source: LegacyDataSource;
  readonly status: LegacySessionStatus;
  readonly history: readonly LegacyChatAnswerMessage[];
  readonly messages: readonly LegacyChatAnswerMessage[];
  readonly memory: readonly LegacyChatMemoryItem[];
  readonly starterCards?: readonly LegacyChatStarterCard[];
  readonly currentResult: LegacyChatViewResult | null;
  readonly utility: LegacyChatUtilityState;
  readonly supplementalHtml?: string;
  readonly errorCode?: string | null;
}

export interface LegacyDeepWindowView {
  readonly id: string;
  readonly mode: "report" | "chat";
  readonly status: LegacyDeepWindowStatus;
  readonly title: string;
  readonly prompt: string;
  readonly summary: string;
  readonly contentHtml?: string;
  readonly source: LegacyDataSource;
  readonly minimized: boolean;
  readonly pinned: boolean;
  readonly overlay: boolean;
  readonly position: { readonly x: number; readonly y: number };
  readonly canCancel: boolean;
  readonly canAddMemory: boolean;
  readonly addedToMemory: boolean;
  readonly skeletonSteps: readonly LegacyDeepWindowSkeletonStep[];
  readonly errorMessage?: string;
  readonly zIndex: number;
  readonly canExport: boolean;
  readonly canMinimize: boolean;
  readonly canClose: boolean;
  readonly feedbackState: LegacyAnswerFeedbackState;
}

export interface LegacyChatSessionBridge {
  getState(): LegacyChatViewState;
  setMode(mode: "report" | "chat"): void;
  submit(prompt: string, callbacks?: LegacyChatRunCallbacks): Promise<LegacyChatViewResult>;
  addMemory?(result: LegacyChatViewResult): boolean;
  removeMemory(memoryId: string): void;
  clearConversation(): void;
  feedbackForAnswer?(answerId: string): LegacyFeedbackBridge | null;
  feedbackForDeepWindow?(windowId: string): LegacyFeedbackBridge | null;
  openChatAnswer?(answerId: string): string | null;
  onChange(listener: (state: LegacyChatViewState) => void): () => void;
}
~~~

将新字段直接合并到现有 LegacyDeepWindowView 和 LegacyChatViewState；最终只保留一个导出的 Deep Window view 类型，避免新增 base/interface 与现有 contract 产生不一致。

- [x] **Step 4: 实现 bridge 归一化和通知。**

在 bridge.ts 中把缺失字符串截断、ID 截断、枚举回退和数组上限统一放进 normalizeChatState、normalizeDeepWindow；不要直接把 options.getState() 的对象返回给 Vue。按回答/按窗口的方法必须拒绝空 ID：

~~~ts
feedbackForAnswer(answerId) {
  const target = safeText(answerId, 120);
  return target ? options.feedbackForAnswer?.(target) || null : null;
},
feedbackForDeepWindow(windowId) {
  const target = safeText(windowId, 120);
  return target ? options.feedbackForDeepWindow?.(target) || null : null;
},
openChatAnswer(answerId) {
  const target = safeText(answerId, 120);
  return target ? options.openChatAnswer?.(target) || null : null;
}
~~~

每次 Legacy native state、异步 DB insight、帮助内容加载或 feedback 状态变化时，都调用同一个 session/deep-window listener 集合；listener 卸载后不得继续触发 Vue 更新。

- [x] **Step 5: 从 public/app.js 填充扩展快照。**

保留现有 applyPrompt、runChatAgent 和 feedback 注册流程，只在 legacyChatViewState、legacyDeepWindowViewState 和 notifyLegacyChatSession/notifyLegacyDeepWindows 中增加白名单字段：

~~~js
const answerId = String(message.answerId || message.id || "");
return {
  id: answerId,
  role: message.role === "assistant" ? "assistant" : "user",
  content: String(message.content || ""),
  contentHtml: message.role === "assistant" ? String(message.contentHtml || "") : "",
  deepWindowId: message.deepWindowId ? String(message.deepWindowId) : null,
  canOpenDeep: message.role === "assistant" && Boolean(message.deepWindowId),
  feedbackState: answerFeedbackContexts.has(answerId) ? "available" : "unavailable"
};
~~~

Deep Window 快照必须从现有 panel 的 skeletonEl、summaryEl、sectionsEl、errorEl、feedbackEl、zIndex 和按钮状态读取；不能从隐藏的 Modern DOM 反向生成 Legacy 状态。

- [x] **Step 6: 运行 GREEN 基础测试和 diff 检查。**

Run:

~~~powershell
npm --prefix frontend run test -- --run src/legacy/bridge.test.ts
node scripts/test_chatbot_legacy_first_parity_gap.mjs
git diff --check
~~~

Expected: bridge 归一化、listener 卸载和静态 parity gate PASS；Legacy-first gate 的默认行为不改变。

### Task 2: 重建完整 Deep Window 生命周期和视觉结构

**Files:**

- Modify: frontend/src/features/chatbot/DeepWindow.vue:9-175
- Modify: frontend/src/features/chatbot/ChatbotPage.vue:166-198,651-679
- Modify: frontend/src/features/chatbot/chatbot.css:566-632
- Modify: frontend/src/legacy/contracts.ts:145-200
- Modify: public/app.js:11920-11960,12144-12675,12753-13054,34466-34712
- Create: frontend/src/features/chatbot/deepWindowTestFixtures.ts
- Test: frontend/src/features/chatbot/DeepWindow.test.ts
- Test: frontend/src/features/chatbot/deepWindowStore.test.ts

**Interfaces:**

- Consumes: Task 1 的 LegacyDeepWindowView，包括 status、skeletonSteps、contentHtml、errorMessage、button capability、zIndex、position 和 feedbackState。
- Produces: 原版 class/data 属性、loading/content/error 三态、最小化 pill、拖动位置、趋势操作和 Deep Window feedback slot。

DeepWindow.vue 的 props 必须补齐 title、summary、contentHtml、errorMessage、skeletonSteps、zIndex、canExport、canMinimize、canClose 和 feedback；emits 必须新增 activate、drop-highlight，并继续保留现有 minimize、restore、close、add-memory、pin、export、clone、overlay、cancel、trend-interact、trend-columns、drop-memory 和 move。

- [x] **Step 1: 为三个生命周期状态写失败组件测试。**

在 frontend/src/features/chatbot/deepWindowTestFixtures.ts 放置以下 fixture，DeepWindow.test.ts 和后续拖拽测试共同 import；然后先断言当前实现缺失的结构：

~~~ts
const report: ChatbotReportViewResult = {
  intent: "merchant",
  status: "resolved",
  query: "Tapo",
  source: "db",
  rows: [],
  summary: { offerCount: 0, clicks: 0, orders: 0, revenue: 0, commission: 0, conversionRate: null },
  message: "Tapo report"
};

const baseWindowProps = {
  id: "deep-1",
  language: "zh" as const,
  result: report,
  title: "Tapo",
  summary: "Tapo report summary",
  contentHtml: "<section>Report sections</section>",
  errorMessage: "error",
  skeletonSteps: [
    { id: "fetch", label: "读取数据", state: "active" as const },
    { id: "analyze", label: "分析结果", state: "pending" as const },
    { id: "render", label: "整理报告", state: "pending" as const }
  ],
  zIndex: 10,
  position: { x: 200, y: 220 },
  minimized: false,
  pinned: false,
  overlay: false,
  canAddMemory: true,
  addedToMemory: false,
  canExport: true,
  canMinimize: true,
  canClose: true,
  feedbackState: "available" as const
};

const loadingWindowFixture = (overrides = {}) => ({ ...baseWindowProps, status: "loading" as const, ...overrides });
const readyWindowFixture = (overrides = {}) => ({ ...baseWindowProps, status: "content" as const, ...overrides });
const errorWindowFixture = (overrides = {}) => ({ ...baseWindowProps, status: "error" as const, ...overrides });

it("renders the Legacy skeleton while a report is loading", () => {
  const wrapper = mount(DeepWindow, { props: loadingWindowFixture() });
  expect(wrapper.find(".deep-window").exists()).toBe(true);
  expect(wrapper.find(".deep-window-skeleton").exists()).toBe(true);
  expect(wrapper.findAll("[data-deep-window-step]")).toHaveLength(3);
  expect(wrapper.find('[data-deep-window-action="add-memory"]').exists()).toBe(false);
  expect(wrapper.find('[data-deep-window-action="stop"]').exists()).toBe(true);
});

it("renders report sections, export and feedback when content is ready", () => {
  const wrapper = mount(DeepWindow, { props: readyWindowFixture() });
  expect(wrapper.find(".deep-report-title").exists()).toBe(true);
  expect(wrapper.find(".deep-report-summary").exists()).toBe(true);
  expect(wrapper.find(".deep-report-sections").exists()).toBe(true);
  expect(wrapper.find(".deep-window-feedback").exists()).toBe(true);
  expect(wrapper.find('[data-deep-window-action="export"]').exists()).toBe(true);
});

it("shows the error card and keeps the panel closable", () => {
  const wrapper = mount(DeepWindow, { props: errorWindowFixture() });
  expect(wrapper.find(".deep-window-error").text()).toContain("error");
  expect(wrapper.find('[data-deep-window-action="close"]').exists()).toBe(true);
});
~~~

- [x] **Step 2: 运行 Deep Window RED 测试。**

Run:

~~~powershell
npm --prefix frontend run test -- --run src/features/chatbot/DeepWindow.test.ts src/features/chatbot/deepWindowStore.test.ts
~~~

Expected: 当前根节点是 chatbot-deep-window，且没有 skeleton、report sections、error card 和 deep-window-feedback，因此新增断言失败；同时更新现有 DeepWindow.test.ts 中“loading 状态仍显示 export/clone/overlay”的旧断言，使它改为验证 loading 时只显示 stop、ready 时再显示可用操作。

- [x] **Step 3: 实现与 Legacy 一致的模板状态机。**

将 DeepWindow.vue 的根节点改为同时保留 data-deep-window 和 class deep-window；按 status 渲染以下结构：

~~~vue
<aside
  class="deep-window"
  :class="{ generating: status === 'loading', minimized, 'is-pinned': pinned, 'is-overlay': overlay, 'is-dragging': dragging }"
  :style="{ ...windowStyle, zIndex: zIndex }"
  data-deep-window
  :data-deep-window-id="id"
>
  <header class="deep-window-header" data-deep-window-header @pointerdown="startDrag">
    <div class="deep-window-heading">
      <span class="deep-window-eyebrow">DEEP WINDOW</span>
      <h3 class="deep-report-title">{{ title }}</h3>
    </div>
    <div class="deep-window-actions">
      <button v-if="minimized" type="button" data-deep-window-action="restore" @click="emit('restore')">↗</button>
      <button v-else-if="status === 'loading'" type="button" data-deep-window-action="stop" @click="emit('cancel')">停止</button>
      <button v-if="!minimized && status === 'content'" type="button" class="deep-window-chat-add" data-deep-window-action="add-memory" :disabled="!canAddMemory" @click="emit('add-memory')">{{ memoryActionLabel }}</button>
      <button v-if="!minimized && status === 'content'" type="button" data-deep-window-action="export" @click="emit('export')">导出</button>
      <button v-if="!minimized && status !== 'loading'" type="button" data-deep-window-action="minimize" @click="emit('minimize')">—</button>
      <button v-if="status !== 'loading'" type="button" data-deep-window-action="close" @click="emit('close')">×</button>
    </div>
  </header>
  <div v-if="minimized" class="deep-window-minimized-pill" data-deep-window-minimized @click="emit('restore')">
    <span>{{ title }}</span>
  </div>
  <div v-else-if="status === 'loading'" class="deep-window-skeleton" data-deep-window-skeleton>
    <div v-for="step in skeletonSteps" :key="step.id" data-deep-window-step :data-state="step.state">{{ step.label }}</div>
  </div>
  <div v-else-if="status === 'error'" class="deep-window-error" data-deep-window-error role="alert">{{ errorMessage }}</div>
  <div v-else class="deep-window-content" data-deep-window-content @click="handleChartClick" @change="handleChartChange">
    <p class="deep-report-summary">{{ summary }}</p>
    <div class="deep-report-sections" v-html="contentHtml"></div>
  </div>
  <div v-if="status === 'content' && !minimized" class="deep-window-feedback" data-deep-window-feedback>
    <slot name="feedback"></slot>
  </div>
</aside>
~~~

保留现有趋势事件转发，但将 cancel 只绑定到 loading 状态；content 状态隐藏 Stop，error 状态隐藏 Add to chat。按原版行为，在 loading 时隐藏 Export/Close/Minimize 的不可用状态，并在 ready/error 时恢复对应按钮。

- [x] **Step 4: 同步 Legacy panel 的状态和层级。**

在 legacyDeepWindowViewState 中返回 zIndex、skeletonSteps、errorMessage、canExport、canMinimize、canClose 和 feedbackState；在 _showPanelSkeleton、_renderPanelReport、_showPanelError、notifyDeepWindowContent 之后统一调用 notifyLegacyDeepWindows()。Modern 的 activeId 只作为回退，最终渲染使用快照中的 zIndex 和 active class。

- [x] **Step 5: 对齐拖拽、最小化和 drop 交互。**

拖动实现必须满足以下规则：

~~~ts
function startDrag(event: PointerEvent): void {
  if (event.button !== 0) return;
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (target?.closest("button, input, select, textarea, a")) return;
  dragOrigin = { x: event.clientX, y: event.clientY, left: props.position.x, top: props.position.y };
  dragging.value = true;
  emit("activate");
  emit("drop-highlight", true);
  window.addEventListener("pointermove", pointerMove);
  window.addEventListener("pointerup", pointerUp, { once: true });
}

function finishDrag(): void {
  dragging.value = false;
  dragOrigin = null;
  window.removeEventListener("pointermove", pointerMove);
  window.removeEventListener("pointerup", pointerUp);
  emit("drop-highlight", false);
}

function pointerUp(event: PointerEvent): void {
  const dropped = Boolean(dragOrigin && document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-chatbot-memory-bar]"));
  finishDrag();
  if (dropped && props.minimized) emit("drop-memory");
}
~~~

增加拖入期间的 drop-highlight class、边界 clamp、无拖动起点不触发 move/drop、双向拖动测试和最小化 pill 点击恢复；不要把普通 header click 误判成拖拽。

- [x] **Step 6: 对齐 Deep Window CSS 并运行测试。**

在 chatbot.css 中让 Modern Deep Window 使用原版宽度、最大高度、圆角、纸张色、顶部 source line、层级、header/body/skeleton/error/feedback 结构；Modern 专属选择器只放在 chatbot-modern-page 下，不修改 Legacy .deep-window 的已有规则。

Run:

~~~powershell
npm --prefix frontend run test -- --run src/features/chatbot/DeepWindow.test.ts src/features/chatbot/deepWindowStore.test.ts
npm --prefix frontend run typecheck
~~~

Expected: Deep Window 三态、拖动、最小化、恢复、趋势事件和卸载清理 PASS。

### Task 3: 恢复每条 Chat answer 的 View、Deep 和反馈行为

**Files:**

- Create: frontend/src/features/chatbot/ChatAnswerActions.vue
- Create: frontend/src/features/chatbot/AnswerFeedbackDialog.vue
- Modify: frontend/src/features/chatbot/ChatbotChatView.vue:14-44,101-216
- Modify: frontend/src/features/chatbot/ChatbotReportView.vue:98-113,130-140
- Modify: frontend/src/features/chatbot/DeepWindow.vue:32-47,170-174
- Modify: frontend/src/features/chatbot/ChatbotPage.vue:224-252,392-420,651-679
- Modify: frontend/src/features/chatbot/FeedbackForm.vue:9-177
- Modify: frontend/src/legacy/contracts.ts:19-145
- Modify: frontend/src/legacy/bridge.ts:172-228,437-508
- Modify: public/app.js:2078-2250,15660-15726,17019-17270,34714-34732
- Test: frontend/src/features/chatbot/ChatAnswerActions.test.ts
- Test: frontend/src/features/chatbot/AnswerFeedbackDialog.test.ts
- Test: frontend/src/features/chatbot/ChatbotChatView.test.ts

**Interfaces:**

- Consumes: Task 1 的 LegacyChatAnswerMessage、answerId、deepWindowId、feedbackState、feedbackForAnswer 和 openChatAnswer。
- Produces: 每条 assistant message 的独立 action bar；提交成功后只禁用对应 answer 的反馈按钮，不影响其他回答。

- [x] **Step 1: 写历史回答回归测试。**

~~~ts
it("renders View and feedback actions for every successful assistant answer", async () => {
  const wrapper = mount(ChatbotChatView, {
    props: {
      language: "zh",
      messages: [
        { id: "u1", role: "user", content: "查询 Tapo" },
        { id: "a1", role: "assistant", content: "第一个回答", answerId: "answer-1", canOpenDeep: true, deepWindowId: "deep-1", feedbackState: "available" },
        { id: "u2", role: "user", content: "再查 EPC" },
        { id: "a2", role: "assistant", content: "第二个回答", answerId: "answer-2", canOpenDeep: true, deepWindowId: "deep-2", feedbackState: "available" }
      ],
      memory: [],
      input: "",
      loading: false,
      error: ""
    }
  });
  expect(wrapper.findAll('[data-chat-answer-id="answer-1"] [data-chatbot-action="open-chat-deep"]')).toHaveLength(1);
  expect(wrapper.findAll('[data-chat-answer-id="answer-2"] [data-feedback-action="open"]')).toHaveLength(1);
});
~~~

- [x] **Step 2: 运行 RED 测试。**

Run:

~~~powershell
npm --prefix frontend run test -- --run src/features/chatbot/ChatAnswerActions.test.ts src/features/chatbot/AnswerFeedbackDialog.test.ts src/features/chatbot/ChatbotChatView.test.ts
~~~

Expected: 当前 ChatbotChatView 只有一个 currentResult 操作区，历史 assistant message 没有 answer ID、View 或 feedback action。

- [x] **Step 3: 创建 ChatAnswerActions 并绑定 answer ID。**

组件必须使用稳定的 answerId，不使用数组下标；事件接口固定为：

~~~ts
const emit = defineEmits<{
  (event: "open-deep", answerId: string): void;
  (event: "feedback-submitted", answerId: string): void;
}>();
~~~

组件 DOM 使用 data-chat-answer-id、data-chatbot-action="open-chat-deep"、data-feedback-action="open" 和 data-feedback-status="submitted"，View 点击向 ChatbotPage 发出 answerId，不能直接访问 window 或 Legacy DOM。

- [x] **Step 4: 将原版 feedback modal 迁移为可复用 Vue 对话框。**

AnswerFeedbackDialog 必须满足以下可观察行为：

~~~vue
<div v-if="open" class="answer-feedback-dialog" role="dialog" aria-modal="true" @click.self="emit('close')">
  <div class="answer-feedback-card-shell">
    <section class="answer-feedback-card" ref="card">
      <button type="button" data-feedback-action="close" @click="emit('close')">×</button>
      <fieldset>
        <legend>{{ copy.reason }}</legend>
        <label v-for="option in reasons" :key="option">
          <input v-model="reason" type="radio" name="answerFeedbackReason" :value="option">
          <span>{{ copy.labels[option] }}</span>
        </label>
      </fieldset>
      <textarea v-model="detail" maxlength="4000" data-feedback-detail></textarea>
      <p v-if="error" role="alert" data-feedback-error>{{ error }}</p>
      <button type="button" data-feedback-action="cancel" @click="emit('close')">{{ copy.cancel }}</button>
      <button type="button" data-feedback-action="submit" :disabled="pending" @click="submit">{{ copy.submit }}</button>
    </section>
  </div>
</div>
~~~

打开时保存触发按钮 ref 并 focus 第一个可聚焦控件；Escape、遮罩、Close、Cancel 都关闭并恢复触发按钮焦点；没有原因、超过 4096 UTF-8 bytes、网络失败分别显示原版对应错误；成功后调用绑定 answer bridge 并只把该 answer 标记为 submitted。

- [x] **Step 5: 修改 Legacy feedback bridge 为按上下文取值。**

public/app.js 必须保留 answerFeedbackContexts 的原有注册和 sendAnswerFeedback 调用；新增的 bridge 方法按 answerId/windowId 查找 context：

~~~js
function feedbackBridgeForAnswer(answerId) {
  var context = answerFeedbackContexts.get(String(answerId || ""));
  return legacyFeedbackBridgeFor(function () { return context; });
}
~~~

Modern 不允许用“当前最新结果”覆盖历史反馈 context；Report Deep Window 的 feedback 也必须从 panel 对应 context 读取。

- [x] **Step 6: 运行组件和反馈回归。**

Run:

~~~powershell
npm --prefix frontend run test -- --run src/features/chatbot/ChatAnswerActions.test.ts src/features/chatbot/AnswerFeedbackDialog.test.ts src/features/chatbot/ChatbotChatView.test.ts src/features/chatbot/ChatbotPage.test.ts
node scripts/test_chatbot_legacy_first_parity_gap.mjs
~~~

Expected: 两条历史回答各有自己的 action；一个反馈提交后只有对应按钮显示已反馈；Deep Window 和 Report answer 也能挂载同一对话框。

### Task 4: 在 Modern root 内恢复 Help、Guide、Logs、Clear 和 onboarding

**Files:**

- Create: frontend/src/features/chatbot/ChatbotUtilityPanels.vue
- Create: frontend/src/features/chatbot/ChatbotOnboarding.vue
- Modify: frontend/src/features/chatbot/ChatbotPage.vue:82-139,493-649
- Modify: frontend/src/features/chatbot/ChatbotChatView.vue:119-216
- Modify: frontend/src/features/chatbot/ChatbotReportView.vue:116-164
- Modify: frontend/src/legacy/contracts.ts:90-145
- Modify: frontend/src/legacy/bridge.ts:172-228,437-508
- Modify: public/app.js:3531-3744,33879-34040,34462-34805
- Modify: public/chatbot_welcome.js:228-380,746-821,914-972
- Modify: public/onboarding_tour.js:93-145
- Test: frontend/src/features/chatbot/ChatbotUtilityPanels.test.ts
- Test: frontend/src/features/chatbot/ChatbotOnboarding.test.ts
- Test: frontend/src/features/chatbot/ChatbotPage.test.ts

**Interfaces:**

- Consumes: Task 1 的 LegacyChatUtilityState、toggleHelp、toggleGuide、downloadLogs、startOnboarding 和 clearConversation。
- Produces: Modern root 自己拥有可见 utility panel、onboarding progress、Chat reminder 和 logs menu；Legacy 原有内容生成和下载方法继续复用。

- [x] **Step 1: 写 utility 和 onboarding 的失败测试。**

~~~ts
const utilityFixture = () => ({
  helpOpen: false,
  guideOpen: false,
  helpHtml: '<img data-help-image src="/help.png" alt="Help">',
  guideHtml: '<p data-guide-image>Guide</p>',
  guideLoading: false,
  onboardingOpen: false,
  onboardingStep: 0,
  onboardingTotal: 5,
  reminderVisible: true,
  reminderCollapsed: false
});

const utilityPanelProps = () => ({
  language: "zh" as const,
  utility: utilityFixture(),
  onToggleHelp: vi.fn(),
  onToggleGuide: vi.fn(),
  onStartOnboarding: vi.fn(),
  onDownloadLogs: vi.fn(),
  onClear: vi.fn()
});

it("keeps help and guide content inside the Modern root", async () => {
  const wrapper = mount(ChatbotUtilityPanels, {
    props: { language: "zh", utility: utilityFixture(), onToggleHelp: vi.fn(), onToggleGuide: vi.fn(), onStartOnboarding: vi.fn() }
  });
  await wrapper.get('[data-chatbot-action="help"]').trigger("click");
  expect(wrapper.find('[data-chatbot-panel="help"]').isVisible()).toBe(true);
  expect(wrapper.find('[data-chatbot-panel="help"] [data-help-image]').exists()).toBe(true);
});

it("renders the empty-memory reminder and routes Go generate a report to Vue mode", async () => {
  const wrapper = mount(ChatbotOnboarding, { props: { language: "zh", visible: true, step: 1, total: 5, reminderVisible: true } });
  await wrapper.get('[data-chatbot-action="go-report"]').trigger("click");
  expect(wrapper.emitted("go-report")).toHaveLength(1);
});

it("closes the logs menu on Escape and restores focus", async () => {
  const wrapper = mount(ChatbotUtilityPanels, { props: utilityPanelProps() });
  await wrapper.get('[data-chatbot-action="logs"]').trigger("click");
  await wrapper.get('[data-chatbot-action="logs"]').trigger("keydown", { key: "Escape" });
  expect(wrapper.find('[role="menu"]').attributes("hidden")).toBeDefined();
});
~~~

- [x] **Step 2: 运行 RED 测试。**

Run:

~~~powershell
npm --prefix frontend run test -- --run src/features/chatbot/ChatbotUtilityPanels.test.ts src/features/chatbot/ChatbotOnboarding.test.ts src/features/chatbot/ChatbotPage.test.ts
~~~

Expected: 当前 Help/Guide 只是调用隐藏的 Legacy sibling；Modern 没有 panel、onboarding、go-report 映射和完整 logs menu。

- [x] **Step 3: 让 Legacy bridge 提供 utility 快照。**

从现有 renderReportHelpContent、loadUserFlowGuide 生成的安全 HTML 读取内容；toggle 后立即通知，Guide 异步加载完成后再次通知。快照形状固定为：

~~~js
function legacyChatUtilityState() {
  return {
    helpOpen: Boolean(els.reportHelpPanel && !els.reportHelpPanel.classList.contains("hidden")),
    guideOpen: Boolean(els.userFlowGuidePanel && !els.userFlowGuidePanel.classList.contains("hidden")),
    helpHtml: String(els.reportHelpContent && els.reportHelpContent.innerHTML || "").slice(0, 160000),
    guideHtml: String(els.userFlowGuideContent && els.userFlowGuideContent.innerHTML || "").slice(0, 160000),
    guideLoading: Boolean(els.userFlowGuideContent && els.userFlowGuideContent.dataset.loading === "true"),
    onboardingOpen: Boolean(window.CHATBOT_WELCOME && window.CHATBOT_WELCOME.isOpen && window.CHATBOT_WELCOME.isOpen()),
    onboardingStep: Number(window.CHATBOT_WELCOME && window.CHATBOT_WELCOME.currentStep || 0),
    onboardingTotal: 5,
    reminderVisible: Boolean(state.reportMemory && state.reportMemory.length === 0 && !state.deepMode),
    reminderCollapsed: false
  };
}
~~~

如果原版帮助面板不暴露内容节点，则在现有 renderReportHelpContent 返回值处增加一个只读 getter；不要让 Modern 读取 document.getElementById 查找 Legacy panel。

- [x] **Step 4: 实现 Modern utility panel 和图片查看。**

ChatbotUtilityPanels 使用明确的 button/menu/tabpanel 语义；Help/Guide 内容使用 bridge 提供的已渲染 HTML，点击带 data-guide-image 的图片时在 Modern root 内打开 lightbox。Logs 菜单保留 questions/feedback 的 CSV/JSONL 四个下载按钮，支持点击外部关闭、Escape 关闭和触发按钮焦点恢复。Clear 调用 session.clearConversation 后清除 Vue 当前 message/result/memory 状态。

- [x] **Step 5: 实现 onboarding、reminder 和 go-report。**

ChatbotOnboarding 在 Chat Mode 无 Memory 时渲染原版 .chat-reminder 等价结构，在 Report Mode 渲染 welcome/progress 状态；按钮执行 emit("go-report")，父组件执行 setMode("report")，不得只派发给隐藏的 Legacy document listener。public/chatbot_welcome.js 保留 Legacy fallback，同时将 chatbot-mode-requested 和 chatbot-go-report 的状态通知接入 bridge。

修改 onboarding_tour.js，使每个旧 selector 都有 Modern selector fallback：

~~~js
const TOUR_TARGETS = {
  layout: ["#chatbotModernRoot .chatbot-report-layout", ".main-grid.dashboard-page"],
  reportInput: ['#chatbotModernRoot [data-chatbot-report-input]', "#chatInput"],
  reportReady: ['#chatbotModernRoot [data-deep-window][data-status="content"]', ".deep-window:not(.generating)"],
  addMemory: ['#chatbotModernRoot [data-deep-window-action="add-memory"]', ".deep-window-chat-add"],
  chatInput: ['#chatbotModernRoot [data-chatbot-input]', "#chatInput"]
};
~~~

优先选择 Modern target；Modern 未挂载时继续使用 Legacy target。

- [x] **Step 6: 运行 utility/onboarding 回归。**

Run:

~~~powershell
npm --prefix frontend run test -- --run src/features/chatbot/ChatbotUtilityPanels.test.ts src/features/chatbot/ChatbotOnboarding.test.ts src/features/chatbot/ChatbotPage.test.ts
node scripts/test_chatbot_welcome.mjs
node scripts/test_m6_modern_mount.mjs
~~~

Expected: Modern root 内 Help、Guide、Logs、Clear、welcome、reminder 和 tour target 全部有可观察 DOM；Legacy fallback 测试仍 PASS。

### Task 5: 恢复 / 指令菜单、Context Overview 实时交互和完整结果承载

**Files:**

- Create: frontend/src/features/chatbot/ChatbotCommandMenu.vue
- Modify: frontend/src/features/chatbot/ChatbotPage.vue:259-317,392-465
- Modify: frontend/src/features/chatbot/ChatbotReportView.vue:81-163
- Modify: frontend/src/features/chatbot/ChatbotChatView.vue:101-127,202-216
- Modify: frontend/src/features/chatbot/ChatbotResultView.vue:46-166
- Modify: frontend/src/features/chatbot/chatbotViewTypes.ts:19-69
- Modify: frontend/src/legacy/contracts.ts:90-145,170-200
- Modify: frontend/src/legacy/bridge.ts:437-508,563-675
- Modify: public/app.js:13080-13270,10263-10328,11760-11892,16944-17287,34784-35064
- Test: frontend/src/features/chatbot/ChatbotCommandMenu.test.ts
- Test: frontend/src/features/chatbot/ChatbotReportView.test.ts
- Test: frontend/src/features/chatbot/ChatbotResultView.test.ts
- Test: scripts/test_chatbot_legacy_first_parity_gap.mjs

**Interfaces:**

- Consumes: Legacy 的 CHAT_INTENT_OPTIONS、parseChatIntentPrefix、Report context interaction、live context snapshot 和 async insight notification。
- Produces: 九个原版命令选项、命令前缀归一化、Context Overview 的 trend/month/column 事件转发，以及不再用固定六列简化表格掩盖缺失数据的结果状态。

- [x] **Step 1: 写命令菜单和 Context 失败测试。**

~~~ts
it("offers all Legacy intent options and supports keyboard selection", async () => {
  const wrapper = mount(ChatbotCommandMenu, { props: { language: "en", value: "/" } });
  expect(wrapper.findAll('[role="option"]')).toHaveLength(9);
  await wrapper.get("input").trigger("keydown", { key: "ArrowDown" });
  await wrapper.get("input").trigger("keydown", { key: "Enter" });
  expect(wrapper.emitted("select")?.[0]).toEqual(["category"]);
});

it("emits Context interactions from copied Context HTML", async () => {
  const wrapper = mount(ChatbotReportView, {
    props: {
      language: "zh",
      prompt: "",
      result: null,
      contextHtml: '<button data-trend-metric="epc">EPC</button>',
      loading: false,
      error: "",
      autoFocus: false
    }
  });
  await wrapper.get("[data-trend-metric]").trigger("click");
  expect(wrapper.emitted("context-interact")?.[0]).toEqual(["trend-metric", "epc"]);
});
~~~

- [x] **Step 2: 运行 RED 测试。**

Run:

~~~powershell
npm --prefix frontend run test -- --run src/features/chatbot/ChatbotCommandMenu.test.ts src/features/chatbot/ChatbotReportView.test.ts src/features/chatbot/ChatbotResultView.test.ts
~~~

Expected: 当前输入框没有 command menu，Context HTML 没有交互 props，结果 fallback 只有固定六列表格。

- [x] **Step 3: 实现 ChatbotCommandMenu。**

使用原版固定顺序和 key：merchant、category、tier、categorytier、trend、payment、asin、publisher、publisherprofile。组件行为必须与原版一致：

~~~ts
const prefix = /^\s*(categorytier|category\s*&\s*tier|品类\s*[+＋]\s*tier|merchant|category|tier|trend|payment|asin|publisherprofile|publisher)\s*[:：]\s*/i;

function selectIntent(key: string): void {
  const text = key === "categorytier" ? "Category & Tier: " : key + ": ";
  emit("select", key);
  emit("update:value", text);
}
~~~

输入 / 时打开 listbox；ArrowUp/ArrowDown 循环高亮；Enter 写入命令前缀并恢复输入焦点；Escape 和点击外部关闭；有已选前缀时渲染 command-token、command-rest 和 caret overlay，并同步 aria-expanded/aria-selected。

- [x] **Step 4: 让 Report/Chat composer 使用同一个命令组件。**

Report 和 Chat input 都保留原版 .chat-input-field，但把 input value、selection、scroll 和 keydown 传给 ChatbotCommandMenu；提交时如果菜单仍打开，只选择当前项而不发送半成品 prompt。Report Mode 才启用命令菜单，Chat Mode 与原版保持同一 state.deepMode 语义。

- [x] **Step 5: 增加 Context interaction bridge。**

在 contract 中增加以下有限动作，不允许 Vue 直接调用 Legacy native listener：

~~~ts
export type LegacyChatContextInteraction =
  | "trend-metric"
  | "trend-category"
  | "trend-column-toggle"
  | "trend-column-core"
  | "trend-column-all"
  | "payment-month";

export interface LegacyChatSessionBridge {
  interactContext?(action: LegacyChatContextInteraction, value?: string): boolean;
  setContextTrendColumns?(columns: readonly string[]): boolean;
}
~~~

ChatbotReportView 只 emit context-interact，不接收 bridge 函数作为 prop：

~~~ts
const emit = defineEmits<{
  (event: "context-interact", action: LegacyChatContextInteraction, value?: string): void;
  (event: "context-columns", columns: readonly string[]): void;
}>();
~~~

public/app.js 在 context root 上复用现有 trend/month handler 的实际函数；操作成功后更新 recBox snapshot 并通知 session。Modern Context HTML 的事件代理只提取 data 属性和选中值，限制字符串长度后调用 bridge。月份选择器更新不得只写入隐藏的 Legacy recBox。

- [x] **Step 6: 修正结果承载和异步 DB insight。**

当 Legacy result 带 contentHtml/recommendationHtml 时，Modern 继续显示完整 HTML 和 download ID；当 HTML 缺失时只显示明确的 loading/error/empty 状态，不生成看似完整但字段不等价的固定六列表格。ChatbotResultView 的格式化函数不得替代 Legacy epc、money、pct、payment status 和表格字段顺序。

为 loadDbMerchantInsight/loadDbSearchInsight 增加 Modern bridge callback：异步 card 生成后把受限的 supplementalHtml 或新的 context snapshot 写入 runtime 并调用 notify，不得只追加到隐藏的 els.chatLog。失败时发送可见的不可用状态，不吞掉异常后静默丢结果。

- [x] **Step 7: 运行命令、Context 和结果回归。**

Run:

~~~powershell
npm --prefix frontend run test -- --run src/features/chatbot/ChatbotCommandMenu.test.ts src/features/chatbot/ChatbotReportView.test.ts src/features/chatbot/ChatbotResultView.test.ts src/features/chatbot/ChatbotPage.test.ts
node scripts/test_chatbot_intent_flow.mjs
node scripts/test_chatbot_legacy_first_parity_gap.mjs
~~~

Expected: 九个命令项、键盘操作、Context trend/month/column 更新、完整 Legacy HTML 和 async DB insight bridge 更新 PASS；历史性 intent-flow 超时如仍存在，单独记录为既有风险，不改测试结论。

### Task 6: 对齐 Memory bar、拖放高亮、日志语义和页面卸载

**Files:**

- Modify: frontend/src/features/chatbot/ChatbotChatView.vue:119-176
- Modify: frontend/src/features/chatbot/DeepWindow.vue:49-139
- Modify: frontend/src/features/chatbot/ChatbotPage.vue:301-379,471-490
- Modify: frontend/src/features/chatbot/chatbot.css:400-632
- Modify: frontend/src/features/chatbot/deepWindowStore.ts
- Test: frontend/src/features/chatbot/ChatbotChatView.test.ts
- Test: frontend/src/features/chatbot/deepWindowStore.test.ts
- Test: frontend/src/features/chatbot/DeepWindow.test.ts

**Interfaces:**

- Consumes: Legacy memory items、Deep Window position/active state、addToChat/removeMemory、window lifecycle callbacks。
- Produces: 始终存在的 dropzone、原版 drag/drop visual feedback、正确的 minimized panel restore、日志菜单关闭语义和卸载时的 Abort/订阅清理。

- [x] **Step 1: 写 Memory/drag 失败测试。**

~~~ts
const chatProps = () => ({
  language: "zh" as const,
  messages: [],
  input: "",
  loading: false,
  error: ""
});

it("keeps the memory dropzone visible when memory already exists", () => {
  const wrapper = mount(ChatbotChatView, { props: { ...chatProps(), memory: [{ id: "m1", title: "Tapo", text: "report" }] } });
  expect(wrapper.find("[data-chatbot-memory-bar]").exists()).toBe(true);
  expect(wrapper.find(".chat-memory-dropzone").exists()).toBe(true);
});

it("does not emit a drop when pointerup happens without a drag start", () => {
  const wrapper = mount(DeepWindow, readyWindowFixture());
  window.dispatchEvent(new PointerEvent("pointerup", { clientX: 20, clientY: 20 }));
  expect(wrapper.emitted("drop-memory")).toBeUndefined();
});

it("supports dragging in both directions and highlights the memory target", async () => {
  const wrapper = mount(DeepWindow, readyWindowFixture({ minimized: true, position: { x: 200, y: 220 } }));
  await wrapper.get("[data-deep-window-header]").trigger("pointerdown", { button: 0, clientX: 200, clientY: 200 });
  window.dispatchEvent(new PointerEvent("pointermove", { clientX: 120, clientY: 150 }));
  expect(wrapper.emitted("move")?.at(-1)).toEqual([120, 170]);
});
~~~

- [x] **Step 2: 运行 RED 测试。**

Run:

~~~powershell
npm --prefix frontend run test -- --run src/features/chatbot/ChatbotChatView.test.ts src/features/chatbot/deepWindowStore.test.ts src/features/chatbot/DeepWindow.test.ts
~~~

Expected: 当前有 Memory 时不渲染 dropzone，drag 没有 drop-highlight/边界规则，最小化 drop 语义不完整。

- [x] **Step 3: 保持原版 Memory bar 结构。**

ChatbotChatView 无论 memory 数量都渲染 .chat-memory-dropzone；有 memory 时显示 chips 与 dropzone 并存，空 memory 时显示原版 reminder 文案。每个 chip 保留 remove button、title、source 和 report snapshot 边界；不要把 memory 转成只含 text.slice(0, 8000) 的新摘要后再保存。

- [x] **Step 4: 完善 Deep Window drop 交互。**

拖动过程中给 [data-chatbot-memory-bar] 加/移除 drop-highlight；只有 minimized panel 与 memory bar 碰撞时才执行 addToChat；pointerup 后无论是否 drop 都移除监听和 highlight。位置写回前 clamp 到可视窗口，active/zIndex 通过 bridge 更新，不能在 Modern 本地偷偷维护另一份位置。

- [x] **Step 5: 统一日志关闭和卸载清理。**

Modern logs 使用 button + role menu，不再依赖 details 默认行为；点击外部和 Escape 关闭，关闭后 focus 回到 logs button。ChatbotPage unmount 时 AbortController、session listener、Deep Window listener 和本地 fallback store 必须全部释放；Legacy bridge 拥有的已完成 panel 不因 Modern unmount 被 close。

- [x] **Step 6: 运行目标测试。**

Run:

~~~powershell
npm --prefix frontend run test -- --run src/features/chatbot/ChatbotChatView.test.ts src/features/chatbot/deepWindowStore.test.ts src/features/chatbot/DeepWindow.test.ts
npm --prefix frontend run typecheck
~~~

Expected: Memory bar、双向拖动、无起点 pointerup、drop highlight、日志 Escape/focus 和卸载清理 PASS。

### Task 7: 对齐视觉 token、文档状态和交付前验证

**Files:**

- Modify: frontend/src/features/chatbot/chatbot.css
- Modify: public/styles.css only when a shared Legacy selector needs a non-breaking Modern hook
- Modify: frontend/src/features/chatbot/ChatbotPage.vue
- Modify: docs/chatbot-feature-report.md
- Modify: scripts/test_chatbot_legacy_first_parity_gap.mjs
- Verify only: public/app.js, public/index.html, public/chatbot_welcome.js, public/onboarding_tour.js

**Interfaces:**

- Consumes: Tasks 1-6 的组件 DOM 契约和原版 screenshots/DOM/CSS 基准。
- Produces: Modern preview 具备稳定的视觉回归选择器、Legacy-first 默认值和可交给用户执行的浏览器验收清单。

- [x] **Step 1: 先写视觉结构静态断言。**

在 parity gate 中加入以下稳定选择器和 cutover 断言：

~~~js
const css = read("frontend/src/features/chatbot/chatbot.css");
const app = read("public/app.js");
assert.match(page, /class="chatbot-modern-page"/);
assert.match(page, /class="insight-panel"/);
assert.match(page, /class="chat-panel/);
assert.match(chat, /class="chat-log/);
assert.match(chat, /class="chat-input/);
assert.match(deep, /class="deep-window/);
assert.match(css, /\\.chatbot-modern-page/);
assert.match(app, /__OI_MODERN_CHATBOT_AGENT_PARITY__\s*===\s*true/);
console.log("Chatbot visual contract: PASS");
~~~

- [x] **Step 2: 按原版基准修正 Modern CSS。**

只调整 Modern root 下的以下视觉维度：双栏宽度与间距、panel 圆角/阴影/背景、chart header、Context Overview 空状态、Report/Chat mode button、message spacing、input/button height、Deep Window width/max-height/header/body/skeleton/error/feedback、Memory bar、Logs menu 和移动端折叠。原版 class 继续作为语义锚点，不重新设计成另一套视觉。

- [x] **Step 3: 加入明确的空态和 loading 断言。**

Report 初始态必须显示原版“还没有报告/输入问题后显示在这里”的 icon、标题和说明；Chat 无 memory 必须显示 reminder；loading 必须显示 Deep Window skeleton 或 Chat streaming 状态；error/stopped 不能伪装成成功结果。

- [x] **Step 4: 更新权威文档状态。**

在 docs/chatbot-feature-report.md 的 M6 Legacy-first 与 Modern 对照边界后增加本计划覆盖范围：Deep Window 三态、answer-level action/feedback、utility/onboarding、command menu、Context live update、async DB insight、Memory drag/drop 和 logs accessibility。明确“组件测试/静态门禁通过不代表浏览器视觉通过”，Modern 仍不是默认生产视图。

- [x] **Step 5: 运行完整的代码验证。**

Run:

~~~powershell
npm --prefix frontend run typecheck
npm --prefix frontend run test -- --run src/features/chatbot src/legacy
npm --prefix frontend run build
node --check public/app.js
node --check public/chatbot_welcome.js
node --check public/onboarding_tour.js
$env:CHATBOT_PARITY_STAGE = "full"
node scripts/test_chatbot_legacy_first_parity_gap.mjs
Remove-Item Env:CHATBOT_PARITY_STAGE
node scripts/test_chatbot_welcome.mjs
node scripts/test_zh_chatbot.mjs
node scripts/test_chatbot_intent_flow.mjs
node scripts/test_m6_modern_mount.mjs
node scripts/test_modern_page_cutover.mjs
git diff --check
~~~

Expected: 目标 Vitest、typecheck、build、Node 语法检查和 parity gate PASS；若 intent-flow 仍出现既有历史性超时，只记录具体命令和状态，不把它改写为 PASS。

> 验证记录（2026-09-03）：本次 Chatbot/Legacy bridge 定向回归 9 个文件、38 个测试通过；全量 Vitest 为 59 个文件、258 个测试通过，唯一失败来自工作区原有缺失的 `frontend/src/shared/contracts/agentResult`。构建、`public/` 语法检查、中文 Chatbot、welcome、M6 mount、Modern cutover 和 full parity gate 均通过。全量 typecheck 同样只停在既有 Agent/Chatbot 迁移骨架类型缺失；`test_chatbot_answer_feedback_frontend.mjs` 与 `test_chatbot_intent_picker.mjs` 仍断言旧的 202608 缓存版本，而当前 `public/index.html` 使用 20260901 版本；`test_chatbot_intent_flow.mjs` 受当前工作区缓存数据排序影响（期望 Shokz Official，实际 BlitzRock）。

> 追加验证记录（2026-09-03）：针对本轮五张 Legacy 截图的定向回归为 6 个文件、27 个测试通过；`npm --prefix frontend run typecheck`、`npm --prefix frontend run build`、`node scripts/test_chatbot_legacy_first_parity_gap.mjs`（full）、`public/` 语法检查及 welcome/M6 mount/Modern cutover/onboarding 契约均通过。全量 Vitest 为 59 个文件通过、260 个测试通过，另有 1 个既有 Agent 迁移骨架 suite 因缺失 `frontend/src/shared/contracts/agentResult` 无法解析；本轮未启动浏览器，Step 6 仍由用户执行视觉验收。

- [ ] **Step 6: 交接浏览器验收，不替用户作视觉结论。**

给用户提供以下手动路径：

1. 默认打开 Chatbot：确认不设置 window.__OI_MODERN_CHATBOT_AGENT_PARITY__ 时仍为 Legacy。
2. 在控制台设置 window.__OI_MODERN_CHATBOT_AGENT_PARITY__ = true 后刷新：确认 Modern Chatbot 可见。
3. 分别验证 Report 初始空态、9 个 / 命令项、merchant/ASIN/payment/trend/keyword/publisher 查询、结果下载、Context 控件。
4. 验证 Deep Window loading/content/error、停止、导出、加入 Chat、反馈、拖动、最小化、恢复、clone/overlay、多个窗口。
5. 验证 Chat 历史回答逐条 View/feedback、Memory reminder/dropzone、starter chips、SSE 逐 token、停止、Logs、Help、Guide、onboarding。
6. 使用真实登录数据确认 DB insight、来源标签、月份/趋势更新和响应式几何。

## 完成判定

- Legacy-first 默认行为未改变；Modern 只作为显式对照页可见。
- Deep Window 具备 Legacy 的 loading/content/error 结构、按钮可见性、feedback、拖动/最小化/多窗口/趋势/导出/加入 Chat 行为。
- Chat 的每条成功 assistant answer 都有独立 View 和 feedback action；反馈提交只影响对应回答。
- Help、Guide、Logs、Clear、welcome、reminder、onboarding 和 / command menu 都在 Modern root 内真实可见且可操作。
- Context Overview 的趋势、月份、列控制和异步 DB insight 能通过 bridge 更新 Modern，而不是只更新隐藏 Legacy DOM。
- Memory dropzone、drag/drop highlight、日志 Escape/focus、Abort 和卸载清理均有自动化回归。
- 自动化验证和构建通过；文档准确区分代码证据与用户浏览器视觉验收。
- 用户完成浏览器验收前，不将 Chatbot Modern 标记为视觉 parity 完成，也不切换为 Modern-first。
