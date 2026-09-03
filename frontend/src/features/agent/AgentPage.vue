<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";

import type { UiLanguage } from "../../shared/i18n";
import type { LegacyAgentSessionBridge, LegacyAgentViewState } from "../../legacy/contracts";
import { renderMarkdownToHtml } from "../../shared/markdown/markdown";
import type { AgentResultView as AgentResultViewModel } from "../../shared/contracts/agentResult";
import { normalizeAgentResultViews } from "../../shared/contracts/agentResult";
import FeedbackForm from "../chatbot/FeedbackForm.vue";
import ChatbotCommandMenu from "../chatbot/ChatbotCommandMenu.vue";
import ChatbotResultView from "../chatbot/ChatbotResultView.vue";
import type { ChatbotReportViewResult } from "../chatbot/chatbotViewTypes";
import AgentDiagnostics from "./AgentDiagnostics.vue";
import { AGENT_COMMANDS, parseAgentCommand } from "./agentCommands";
import { appendDiagnosticTurn, diagnosticTurn, type AgentDiagnosticTurn } from "./agentDiagnostics";
import AgentTimeline from "./AgentTimeline.vue";
import AgentResultView from "./AgentResultView.vue";
import {
  agentMemoryDisplayText,
  agentMemoryPromptText,
  applyAgentMemoryEvents,
  clearAgentMemory,
  emptyAgentMemory,
  loadAgentMemory,
  normalizeAgentMemory,
  normalizeAgentTimelineStep,
  saveAgentMemory,
  type AgentMemoryEvent,
  type AgentMemoryState,
  type AgentRunStatus,
  type AgentTimelineStep
} from "./agentModel";

export interface AgentRunRequest {
  readonly prompt: string;
  readonly language: UiLanguage;
  readonly history: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
  readonly memory: AgentMemoryState;
  readonly memoryText: string;
  readonly signal: AbortSignal;
  readonly onToken?: (token: string) => void;
  readonly onTimeline?: (step: AgentTimelineStep) => void;
  readonly onResultView?: (view: AgentResultViewModel) => void;
}

export interface AgentRunResult {
  readonly report?: ChatbotReportViewResult;
  readonly ok: boolean;
  readonly status: Exclude<AgentRunStatus, "idle" | "running">;
  readonly response: string;
  readonly steps: readonly unknown[];
  readonly partial?: boolean;
  readonly omittedTargets?: readonly string[];
  readonly memoryEvents?: readonly AgentMemoryEvent[];
  readonly resultViews?: readonly AgentResultViewModel[];
  readonly errorCode?: string | null;
}

export type AgentRunner = (request: AgentRunRequest) => Promise<AgentRunResult>;

const props = withDefaults(defineProps<{
  readonly language: UiLanguage;
  readonly run: AgentRunner;
  readonly storage?: Storage;
  readonly autoFocus?: boolean;
  readonly session?: LegacyAgentSessionBridge;
}>(), {
  storage: undefined,
  session: undefined,
  autoFocus: true
});

const input = ref("");
const messages = ref<Array<{ readonly id: string; readonly role: "user" | "assistant"; readonly content: string; readonly resultViews?: readonly AgentResultViewModel[]; readonly report?: ChatbotReportViewResult }>>([]);
const timeline = ref<AgentTimelineStep[]>([]);
const runStatus = ref<AgentRunStatus>("idle");
const response = ref("");
const partial = ref(false);
const omittedTargets = ref<string[]>([]);
const resultViews = ref<AgentResultViewModel[]>([]);
const memory = ref<AgentMemoryState>(emptyAgentMemory());
const error = ref("");
const feedbackRefreshKey = ref(0);
const inputRef = ref<HTMLTextAreaElement | null>(null);
const logRef = ref<HTMLElement | null>(null);
const detailsOpen = ref(true);
const diagnosticsOpen = ref(false);
const diagnostics = ref<AgentDiagnosticTurn[]>([]);
const replayTurn = ref<AgentDiagnosticTurn | null>(null);
const replayComparison = ref<{ original: string; current: string } | null>(null);
const commandMenu = ref<InstanceType<typeof ChatbotCommandMenu>>();
const commandHint = computed(() => { const parsed = parseAgentCommand(input.value); return parsed ? (props.language === "zh" ? parsed.command.zhHint : parsed.command.enHint) : ""; });
const composerCollapsed = ref(false);
const localSessionOverride = ref(false);
let lastScrollTop = 0;
const activity = window.OI_LEGACY_BRIDGE?.createAgentActivity?.();
const feedback = computed(() => !localSessionOverride.value && props.session ? props.session.feedback : activity?.feedback);
const hasLogDownloads = computed(() => Boolean(props.session?.downloadLogs || activity?.downloadLogs));
const followingLatest = ref(true);
const stopping = ref(false);
const lastPrompt = ref("");
const workspaceId = useId();
let resizeObserver: ResizeObserver | undefined;
let scrollFrame = 0;
let abortController: AbortController | null = null;
let stopSessionSubscription: (() => void) | null = null;
let idCounter = 0;

const copy = computed(() => props.language === "zh" ? {
  eyebrow: "YEAHPROMOS",
  title: "Agent 工作台",
  subtitle: "商户 · 媒体 · 趋势",
  readOnly: "只读数据工作区",
  newConversation: "新对话",
  stop: "停止",
  placeholder: "询问商户、品类、Tier、付款或趋势…",
  send: "发送",
  welcomeKicker: "从一个数据问题开始",
  welcomeTitle: "查什么？",
  welcomeBody: "输入问题，或用 / 选择查询类型。",
  example: "查询 Tapo（ID398679）的 EPC 和 conversion",
  exampleLabel: "示例问题",
  capabilities: "能力",
  dataAgent: "数据 Agent",
  merchantAnalysis: "商户分析",
  categoryTier: "品类与 Tier",
  comparisons: "对比分析",
  paymentTrends: "付款与趋势",
  railNote: "仅进行只读分析。原始 Report Mode 流程与 Deep Window 报告请使用 Chatbot。",
  restored: agentMemoryDisplayText(memory.value, "zh"),
  stopped: "本次 Agent 执行已停止。",
  failed: "本次查询未完成。可以重试，或调整问题后再次发送。",
  details: "查询详情", closeDetails: "收起详情", conversation: "当前对话", you: "你", answer: "Agent",
  ready: "准备就绪", running: "正在分析", done: "查询完成", stopping: "正在停止", stoppedLabel: "已停止", errorLabel: "查询未完成",
  planning: "理解问题", tool: "查询数据", synthesis: "整理答案", preparing: "正在准备查询", receiving: "正在生成回答",
  latest: "回到最新内容", composer: "向 Agent 提问", keyboard: "Enter 发送 · Shift + Enter 换行", draft: "可以先写下一个问题",
  retry: "重新编辑问题", taskHint: "选择一个示例，再按需修改", more: "更多查询", logs: "日志", questions: "问题记录", feedback: "回答反馈",
  context: "本轮上下文", contextEmpty: "暂无查询对象",
  results: "结果索引", resultsEmpty: "暂无结果", sourceHint: "来源与时间范围见各项结果。",
  guide: "提问小提示", guideBody: "写明商户名称或 ID，再补充指标和月份。例如：比较 Tapo 最近 3 个月的收入与 EPC。",
  viewResults: "查看结果", readOnlyHint: "只读分析 · 不会修改业务数据"
} : {
  eyebrow: "YEAHPROMOS",
  title: "Agent workspace",
  subtitle: "Merchants · Publishers · Trends",
  readOnly: "Read-only data workspace",
  newConversation: "New conversation",
  stop: "Stop",
  placeholder: "Ask about merchants, categories, tiers, payments, or trends…",
  send: "Send",
  welcomeKicker: "START WITH A DATA QUESTION",
  welcomeTitle: "What are you looking for?",
  welcomeBody: "Type a question, or / to choose a query.",
  example: "Look up EPC and conversion for Tapo (ID398679)",
  exampleLabel: "Example prompt",
  capabilities: "Capabilities",
  dataAgent: "Data Agent",
  merchantAnalysis: "Merchant analysis",
  categoryTier: "Category and tier",
  comparisons: "Comparisons",
  paymentTrends: "Payments and trends",
  railNote: "Read-only analysis. Use Chatbot for the original Report Mode workflow and Deep Window reports.",
  restored: agentMemoryDisplayText(memory.value, "en"),
  stopped: "This Agent run was stopped.",
  failed: "This query could not be completed. Try again, or adjust your question.",
  details: "Query details", closeDetails: "Close details", conversation: "Current conversation", you: "You", answer: "Agent",
  ready: "Ready", running: "Analyzing", done: "Query complete", stopping: "Stopping", stoppedLabel: "Stopped", errorLabel: "Query incomplete",
  planning: "Understand", tool: "Query data", synthesis: "Compose answer", preparing: "Preparing your query", receiving: "Writing the answer",
  latest: "Jump to latest", composer: "Ask the Agent", keyboard: "Enter to send · Shift + Enter for a new line", draft: "Draft your next question while you wait",
  retry: "Edit question again", taskHint: "Choose an example and make it yours", more: "More queries", logs: "Logs", questions: "Questions", feedback: "Feedback",
  context: "Query context", contextEmpty: "No query yet",
  results: "Result index", resultsEmpty: "No results yet", sourceHint: "Sources and time ranges are listed with each result.",
  guide: "A useful starting point", guideBody: "Include a merchant name or ID, then a metric and time range. Try: compare Tapo revenue and EPC over the last 3 months.",
  viewResults: "View results", readOnlyHint: "Read-only analysis · Your business data stays unchanged"
});

const suggestions = computed(() => props.language === "zh" ? [
  { title: "了解一个商户", detail: "核心指标与表现", prompt: copy.value.example },
  { title: "查看趋势变化", detail: "多月趋势与指标切换", prompt: "查看 Tapo（ID398679）最近 6 个月的收入、订单和 EPC 趋势" },
  { title: "分析 Tier 商户", detail: "分层概览与商户列表", prompt: "分析 Tier 2 的整体表现，并列出商户及核心指标" },
  { title: "核对付款状态", detail: "付款记录与待支付款项", prompt: "查询 Tapo（ID398679）的付款状态和未支付记录" }
] : [
  { title: "Explore a merchant", detail: "Key metrics and performance", prompt: copy.value.example },
  { title: "Follow a trend", detail: "Monthly trends and metric switching", prompt: "Show revenue, orders, and EPC trends for Tapo (ID398679) over the last 6 months" },
  { title: "Analyze a tier", detail: "Tier overview and merchant list", prompt: "Analyze Tier 2 performance and list its merchants with key metrics" },
  { title: "Check payments", detail: "Payment status and outstanding records", prompt: "Check payment status and unpaid records for Tapo (ID398679)" }
]);
const moreSuggestions = computed(() => props.language === "zh" ? [
  { title: "品类分析", prompt: "分析 Electronics 品类的整体表现和核心指标" },
  { title: "商户对比", prompt: "比较 Tapo 和 Kasa 的收入、订单和 EPC" },
  { title: "品类对比", prompt: "比较 Electronics 和 Home & Kitchen 的整体表现" }
] : [
  { title: "Category analysis", prompt: "Analyze Electronics category performance and key metrics" },
  { title: "Compare merchants", prompt: "Compare Tapo and Kasa revenue, orders, and EPC" },
  { title: "Compare categories", prompt: "Compare Electronics and Home & Kitchen category performance" }
]);
const statusLabel = computed(() => stopping.value ? copy.value.stopping : ({ idle: copy.value.ready, running: copy.value.running, done: copy.value.done, stopped: copy.value.stoppedLabel, error: copy.value.errorLabel })[runStatus.value]);
const activePhase = computed(() => [...timeline.value].reverse().find((step) => step.status === "running")?.phase || (response.value ? "synthesis" : "planning"));
const activeDetail = computed(() => [...timeline.value].reverse().find((step) => step.status === "running")?.label || (response.value ? copy.value.receiving : copy.value.preparing));
const resultIndex = computed(() => [
  ...messages.value.flatMap((message) => (message.resultViews || []).map((view, index) => ({ target: `${workspaceId}-${message.id}-${index}`, title: view.title }))),
  ...resultViews.value.map((view, index) => ({ target: `${workspaceId}-current-${index}`, title: view.title }))
]);
const visibleMessages = computed(() => messages.value.filter((message, index) => !(props.session && !localSessionOverride.value && runStatus.value === 'running' && message.role === 'assistant' && index === messages.value.length - 1)));

function resizeInput(): void {
  const field = inputRef.value;
  if (!field) return;
  field.style.height = "auto";
  field.style.height = `${Math.min(Math.max(field.scrollHeight, 56), 168)}px`;
}
function trackScroll(): void {
  const log = logRef.value;
  if (!log) return;
  followingLatest.value = log.scrollHeight - log.scrollTop - log.clientHeight < 96;
  const delta = log.scrollTop - lastScrollTop;
  if (!input.value.trim() && messages.value.length && Math.abs(delta) > 10) {
    composerCollapsed.value = !followingLatest.value;
    if (composerCollapsed.value) inputRef.value?.blur();
  }
  if (followingLatest.value) composerCollapsed.value = false;
  lastScrollTop = log.scrollTop;
}
function expandComposer(): void { composerCollapsed.value = false; nextTick(() => { resizeInput(); inputRef.value?.focus(); }); }
function chooseCommand(key: string): void { handleExample(`/${key} `); }
function scrollLatest(): void {
  followingLatest.value = true;
  composerCollapsed.value = false;
  logRef.value?.scrollTo?.({ top: logRef.value.scrollHeight, behavior: "auto" });
}
function followStream(): void {
  if (runStatus.value === "idle" && !messages.value.length) return;
  if (!followingLatest.value || scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; if (followingLatest.value) scrollLatest(); });
}
function jumpToResult(target: string): void {
  followingLatest.value = false;
  document.getElementById(target)?.scrollIntoView({ block: "start", behavior: "auto" });
}
function handleKeydown(event: KeyboardEvent): void {
  commandMenu.value?.handleKeydown(event);
  if (event.defaultPrevented) return;
  if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  if (runStatus.value !== "running") void submit();
}
watch(input, () => nextTick(resizeInput));
watch([response, messages, resultViews, timeline, runStatus], () => nextTick(followStream), { deep: true });

function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function renderAssistant(content: string): string {
  return renderMarkdownToHtml(content);
}

function history(): readonly { readonly role: "user" | "assistant"; readonly content: string }[] {
  return messages.value.map(({ role, content }) => ({ role, content }));
}

function downloadLogs(kind: "questions" | "feedback", format: "csv" | "jsonl"): void {
  (props.session?.downloadLogs || activity?.downloadLogs)?.(kind, format);
}
function downloadReport(id: string): void { window.OI_LEGACY_BRIDGE?.download('recommendation', id); }

function upsertResultView(view: unknown): void {
  const normalized = normalizeAgentResultViews([view])[0];
  if (!normalized) return;
  const index = resultViews.value.findIndex((item) => item.id === normalized.id);
  resultViews.value = index < 0
    ? [...resultViews.value, normalized].slice(0, 8)
    : resultViews.value.map((item, itemIndex) => itemIndex === index ? normalized : item);
}

function syncSessionState(next: LegacyAgentViewState = props.session!.getState()): void {
  if (localSessionOverride.value) return;
  runStatus.value = next.status;
  timeline.value = next.steps.map(normalizeAgentTimelineStep);
  response.value = next.response || "";
  partial.value = next.partial;
  omittedTargets.value = next.omittedTargets.slice(0, 20);
  if (Array.isArray(next.resultViews)) resultViews.value = normalizeAgentResultViews(next.resultViews);
  error.value = next.status === "error" ? copy.value.failed : "";
  const sessionMessages = next.messages || next.history;
  messages.value = sessionMessages.map((message, index) => {
    const id = `session-${index}-${message.role}`;
    const previous = messages.value.find((item) => item.id === id && item.content === message.content);
    const current = next.status === 'done' && index === sessionMessages.length - 1 && message.role === 'assistant';
    return { id, role: message.role, content: message.content, resultViews: current && resultViews.value.length ? resultViews.value.slice() : previous?.resultViews };
  });
  if (next.status === 'done' && messages.value.at(-1)?.resultViews?.length) resultViews.value = [];
  if (next.memory && typeof next.memory === "object") memory.value = normalizeAgentMemory(next.memory);
}

function handleExample(prompt = copy.value.example): void {
  composerCollapsed.value = false;
  input.value = prompt;
  nextTick(() => inputRef.value?.focus());
}

async function submit(): Promise<void> {
  if (runStatus.value === "running") {
    return;
  }
  const prompt = input.value.trim();
  if (!prompt) return;
  const command = parseAgentCommand(prompt);
  if (prompt.startsWith("/") && (!command || !command.value)) {
    if (!command) input.value = "/";
    inputRef.value?.focus();
    return;
  }
  const replay = replayTurn.value;
  replayTurn.value = null;
  const requestLanguage = replay?.language || props.language;
  const requestPrompt = command ? command.command.template(command.value, requestLanguage) : prompt;
  const initialHistory = replay?.history || (props.session && !localSessionOverride.value ? props.session.getState().history : history());
  const initialMemory = replay?.memory || memory.value;
  const diagnosticRequest: AgentRunRequest = { prompt, language: requestLanguage, history: initialHistory, memory: initialMemory, memoryText: agentMemoryPromptText(initialMemory, requestLanguage), signal: new AbortController().signal };
  let attemptError = "";
  function recordAttempt(): void {
    const status = runStatus.value === "done" ? "done" : runStatus.value === "stopped" ? "stopped" : "error";
    const result: AgentRunResult = { ok: status === "done", status, response: response.value, steps: timeline.value, errorCode: attemptError };
    activity?.finish(result);
    feedbackRefreshKey.value += 1;
    try { diagnostics.value = appendDiagnosticTurn(diagnostics.value, diagnosticTurn(diagnosticRequest, result)); } catch { /* oversized diagnostics do not interrupt an answer */ }
    if (replay) replayComparison.value = { original: replay.response || replay.errorCode, current: response.value || attemptError || copy.value.failed };
    if (status === "error") diagnosticsOpen.value = true;
  }
  lastPrompt.value = prompt;
  stopping.value = false;
  followingLatest.value = true;
  if (props.session && !localSessionOverride.value && !command?.command.route && !replay) {
    input.value = "";
    response.value = "";
    error.value = "";
    partial.value = false;
    omittedTargets.value = [];
    resultViews.value = [];
    timeline.value = [];
    runStatus.value = "running";
    feedbackRefreshKey.value += 1;
    abortController = new AbortController();
    try {
      const currentState = props.session.getState();
      const result = await props.session.submit({
        prompt: requestPrompt,
        language: requestLanguage,
        history: currentState.history,
        memoryText: agentMemoryPromptText(memory.value, props.language),
        signal: abortController.signal
      }, {
        onToken: (token) => {
          response.value += token;
        },
        onTimeline: (step) => {
          const normalized = normalizeAgentTimelineStep(step);
          const existing = timeline.value.findIndex((item) => item.id === normalized.id);
          if (existing >= 0) timeline.value[existing] = normalized;
          else timeline.value = [...timeline.value, normalized];
        },
        onResultView: upsertResultView
      });
      if (result.resultViews?.length) resultViews.value = normalizeAgentResultViews(result.resultViews);
      attemptError = result.errorCode || "";
      if (result.status === "error" && !result.response) error.value = copy.value.failed;
      feedbackRefreshKey.value += 1;
      syncSessionState();
    } catch (caught) {
      const stopped = abortController.signal.aborted || (caught instanceof DOMException && caught.name === "AbortError");
      runStatus.value = stopped ? "stopped" : "error";
      response.value = stopped ? copy.value.stopped : "";
      if (!stopped) error.value = copy.value.failed;
    } finally {
      abortController = null;
      if (runStatus.value === "running") runStatus.value = "error";
      recordAttempt();
      if (followingLatest.value && !composerCollapsed.value) inputRef.value?.focus();
    }
    return;
  }
  const currentHistory = initialHistory;
  if (props.session) localSessionOverride.value = true;
  const userId = nextId("user");
  messages.value = [...messages.value, { id: userId, role: "user", content: prompt }];
  input.value = "";
  response.value = "";
  error.value = "";
  partial.value = false;
  omittedTargets.value = [];
  resultViews.value = [];
  timeline.value = [];
  runStatus.value = "running";
  feedbackRefreshKey.value += 1;
  abortController = new AbortController();
  activity?.begin(prompt, requestLanguage);
  try {
    const request: AgentRunRequest = {
      prompt: requestPrompt,
      language: requestLanguage,
      history: currentHistory,
      memory: initialMemory,
      memoryText: agentMemoryPromptText(initialMemory, requestLanguage),
      signal: abortController.signal,
      onToken: (token) => { response.value += token; },
      onTimeline: (step) => {
        const normalized = normalizeAgentTimelineStep(step);
        const existing = timeline.value.findIndex((item) => item.id === normalized.id);
        if (existing >= 0) timeline.value[existing] = normalized;
        else timeline.value = [...timeline.value, normalized];
      },
      onResultView: upsertResultView
    };
    let result: AgentRunResult;
    if (command?.command.route) {
      const bridge = window.OI_LEGACY_BRIDGE?.runAgentPublisher;
      if (!bridge) throw new Error("publisher_unavailable");
      const label = requestLanguage === "zh" ? command.command.zh : command.command.en;
      timeline.value = [{ id: "publisher", phase: "tool", label, status: "running" }];
      const publisher = await bridge({ kind: command.command.route, query: command.value, language: requestLanguage, signal: request.signal });
      if (request.signal.aborted) throw new DOMException("Stopped", "AbortError");
      result = { ok: true, status: "done", response: publisher.text, steps: [{ id: "publisher", phase: "tool", label, status: "done" }],
        report: { intent: "analysis", status: "resolved", query: prompt, source: publisher.source, rows: [], summary: { offerCount: 0, clicks: 0, orders: 0, revenue: 0, commission: 0, conversionRate: null }, message: label, legacyHtml: publisher.html } };
    } else result = await props.run(request);
    attemptError = result.errorCode || "";
    timeline.value = result.steps.map(normalizeAgentTimelineStep);
    partial.value = result.partial === true;
    omittedTargets.value = (result.omittedTargets || []).map(String).filter(Boolean).slice(0, 20);
    runStatus.value = result.ok || result.status !== "done" ? result.status : "error";
    response.value = result.response || (result.status === "stopped" ? copy.value.stopped : "");
    if (result.resultViews?.length) resultViews.value = normalizeAgentResultViews(result.resultViews);
    if (result.status === "done" && result.ok && result.response) {
      messages.value = [...messages.value, { id: nextId("assistant"), role: "assistant", content: result.response, resultViews: resultViews.value.slice(), report: result.report }];
      resultViews.value = [];
    }
    if (result.status !== "done" || !result.ok) {
      messages.value = messages.value.filter((message) => message.id !== userId);
    }
    if (result.status === "done" && result.ok && result.memoryEvents?.length) {
      memory.value = applyAgentMemoryEvents(memory.value, result.memoryEvents, Date.now());
      saveAgentMemory(props.storage, memory.value);
    }
    if (runStatus.value === "error") error.value = copy.value.failed;
    feedbackRefreshKey.value += 1;
  } catch (caught) {
    const stopped = abortController.signal.aborted || (caught instanceof DOMException && caught.name === "AbortError");
    messages.value = messages.value.filter((message) => message.id !== userId);
    runStatus.value = stopped ? "stopped" : "error";
    response.value = stopped ? copy.value.stopped : "";
    if (!stopped) error.value = copy.value.failed;
    attemptError = stopped ? "stopped_by_user" : "agent_runtime_error";
  } finally {
    abortController = null;
    if (runStatus.value === "running") runStatus.value = "error";
    recordAttempt();
    if (followingLatest.value && !composerCollapsed.value) inputRef.value?.focus();
  }
}

function stop(): void {
  stopping.value = true;
  if (props.session && !localSessionOverride.value) props.session.stop();
  abortController?.abort();
}

watch(runStatus, (status) => { if (status !== "running") stopping.value = false; });

function newConversation(): void {
  if (runStatus.value === "running") return;
  stopping.value = false;
  lastPrompt.value = "";
  diagnostics.value = [];
  replayComparison.value = null;
  diagnosticsOpen.value = false;
  composerCollapsed.value = false;
  activity?.clear();
  localSessionOverride.value = false;
  followingLatest.value = true;
  nextTick(() => { logRef.value?.scrollTo?.({ top: 0, behavior: 'auto' }); });
  if (props.session) {
    props.session.newConversation();
    feedbackRefreshKey.value += 1;
    syncSessionState();
    nextTick(() => inputRef.value?.focus());
    return;
  }
  messages.value = [];
  timeline.value = [];
  runStatus.value = "idle";
  response.value = "";
  error.value = "";
  partial.value = false;
  omittedTargets.value = [];
  resultViews.value = [];
  feedbackRefreshKey.value += 1;
  memory.value = emptyAgentMemory();
  clearAgentMemory(props.storage);
  nextTick(() => inputRef.value?.focus());
}

function replay(turn: AgentDiagnosticTurn): void {
  if (runStatus.value === "running") return;
  replayTurn.value = turn;
  input.value = turn.prompt;
  void submit();
}

onMounted(() => {
  if (window.matchMedia?.('(max-width: 1024px)').matches) detailsOpen.value = false;
  if (props.session) {
    syncSessionState();
    stopSessionSubscription = props.session.onChange(syncSessionState);
  } else {
    memory.value = loadAgentMemory(props.storage);
  }
  if (props.autoFocus) inputRef.value?.focus();
  resizeInput();
  if (typeof ResizeObserver !== "undefined" && logRef.value?.firstElementChild) {
    resizeObserver = new ResizeObserver(followStream);
    resizeObserver.observe(logRef.value.firstElementChild);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  cancelAnimationFrame(scrollFrame);
  abortController?.abort();
  abortController = null;
  if (!props.session) {
    messages.value = [];
    timeline.value = [];
  }
  stopSessionSubscription?.();
  stopSessionSubscription = null;
});
</script>

<template>
  <main class="agent-modern-page agent-workspace" data-page="agent">
    <header class="aw-header">
      <div class="aw-heading">
        <span class="aw-brand-mark" aria-hidden="true">Y<span>P</span></span>
        <div><span class="aw-brand">{{ copy.eyebrow }}</span><h2>{{ copy.title }}</h2></div>
        <span class="aw-status" :data-status="runStatus" role="status"><i aria-hidden="true"></i>{{ statusLabel }}</span>
      </div>
      <div class="aw-header-actions">
        <details class="agent-modern-logs" data-agent-logs>
          <summary data-agent-action="logs">{{ copy.logs }}</summary>
          <div class="agent-modern-logs-menu">
            <button type="button" class="aw-case-menu-button" @click="diagnosticsOpen = !diagnosticsOpen">{{ language === 'zh' ? '对话日志与回测' : 'Conversation logs & replay' }}</button>
            <template v-if="hasLogDownloads">
            <span>{{ copy.questions }}</span>
            <button type="button" data-agent-log="questions-csv" @click="downloadLogs('questions', 'csv')">CSV</button>
            <button type="button" data-agent-log="questions-jsonl" @click="downloadLogs('questions', 'jsonl')">JSONL</button>
            <span>{{ copy.feedback }}</span>
            <button type="button" data-agent-log="feedback-csv" @click="downloadLogs('feedback', 'csv')">CSV</button>
            <button type="button" data-agent-log="feedback-jsonl" @click="downloadLogs('feedback', 'jsonl')">JSONL</button>
            </template>
          </div>
        </details>
        <button type="button" class="aw-button aw-details-toggle" :aria-expanded="detailsOpen" :aria-controls="`${workspaceId}-details`" data-agent-action="details" @click="detailsOpen = !detailsOpen">{{ copy.details }}</button>
        <button class="aw-button aw-new" type="button" data-agent-action="new" :disabled="runStatus === 'running'" @click="newConversation"><span aria-hidden="true">＋</span>{{ copy.newConversation }}</button>
      </div>
    </header>

    <section class="aw-layout" :class="{ 'aw-layout-with-details': detailsOpen }">
      <section class="aw-conversation" data-agent-surface="workspace" :aria-label="copy.conversation">
        <div class="aw-conversation-bar"><span>{{ copy.conversation }}</span><button type="button" @click="handleExample('/')">{{ language === 'zh' ? '/ 命令' : '/ Commands' }}</button></div>
        <div ref="logRef" class="aw-log" data-agent-log @scroll.passive="trackScroll">
          <div class="aw-log-content">
            <div v-if="!messages.length && runStatus === 'idle'" class="aw-welcome" data-agent-welcome>
              <span class="aw-welcome-caption">{{ copy.subtitle }}</span>
              <h3>{{ copy.welcomeTitle }}</h3>
              <p class="aw-intro">{{ copy.welcomeBody }}</p>
              <p v-if="copy.restored" class="aw-memory" role="status">{{ copy.restored }}</p>
              <div class="aw-task-heading">{{ copy.taskHint }}</div>
              <div class="aw-suggestions">
                <button v-for="(suggestion, index) in suggestions" :key="index" class="aw-suggestion" type="button" :data-agent-action="index === 0 ? 'example' : 'suggestion'" @click="handleExample(suggestion.prompt)">
                  <span class="aw-suggestion-number" aria-hidden="true">0{{ index + 1 }}</span>
                  <span><strong>{{ suggestion.title }}</strong><small>{{ suggestion.detail }}</small></span>
                  <span class="aw-suggestion-arrow" aria-hidden="true">↗</span>
                </button>
              </div>
              <div class="aw-more-suggestions"><span>{{ copy.more }}</span><button v-for="suggestion in moreSuggestions" :key="suggestion.title" type="button" @click="handleExample(suggestion.prompt)">{{ suggestion.title }} <span aria-hidden="true">→</span></button></div>
            </div>

            <article v-for="message in visibleMessages" :key="message.id" class="aw-message" :class="`aw-message-${message.role}`">
              <div class="aw-message-author"><span v-if="message.role === 'assistant'" class="aw-avatar" aria-hidden="true">YP</span>{{ message.role === 'user' ? copy.you : copy.answer }}</div>
              <ChatbotResultView v-if="message.report" :language="language" :result="message.report" @download="downloadReport" />
              <div v-else-if="message.role === 'assistant'" class="chat-stream-text" data-agent-response v-html="renderAssistant(message.content)"></div>
              <div v-else class="chat-stream-text"><p>{{ message.content }}</p></div>
              <section v-if="message.resultViews?.length" class="agent-modern-results" :aria-label="copy.results">
                <div v-for="(view, index) in message.resultViews" :id="`${workspaceId}-${message.id}-${index}`" :key="view.id" class="aw-result-anchor"><AgentResultView :language="language" :view="view" /></div>
              </section>
            </article>

            <div v-if="runStatus === 'running'" class="aw-progress" data-agent-progress role="status" aria-live="polite">
              <div class="aw-progress-heading"><span class="aw-activity-dot" aria-hidden="true"></span><strong>{{ stopping ? copy.stopping : activeDetail }}</strong></div>
              <div class="aw-progress-phases"><span v-for="phase in (['planning', 'tool', 'synthesis'] as const)" :key="phase" :class="{ 'is-active': phase === activePhase }">{{ copy[phase] }}</span></div>
              <div v-if="!response && !resultViews.length" class="aw-loading-lines" aria-hidden="true"><i></i><i></i></div>
            </div>
            <article v-if="runStatus !== 'done' && response" class="aw-message aw-message-assistant" data-agent-streaming-response>
              <div class="aw-message-author"><span class="aw-avatar" aria-hidden="true">YP</span>{{ copy.answer }}</div>
              <div class="chat-stream-text" v-html="renderAssistant(response)"></div>
            </article>
            <section v-if="resultViews.length" class="agent-modern-results" :aria-label="copy.results">
              <div v-for="(view, index) in resultViews" :id="`${workspaceId}-current-${index}`" :key="view.id" class="aw-result-anchor"><AgentResultView :language="language" :view="view" /></div>
            </section>
            <AgentTimeline v-if="timeline.length || runStatus !== 'idle'" :language="language" :status="runStatus" :steps="timeline" :partial="partial" :omitted-targets="omittedTargets" />
            <FeedbackForm :language="language" :feedback="feedback" :refresh-key="feedbackRefreshKey" />
            <div v-if="error || runStatus === 'stopped'" class="aw-notice" :class="{ 'aw-notice-error': error }" :role="error ? 'alert' : 'status'">
              <p>{{ error || copy.stopped }}</p><button v-if="lastPrompt" type="button" class="aw-button" data-agent-action="retry" @click="handleExample(lastPrompt)">{{ copy.retry }}</button>
            </div>
            <section v-if="replayComparison" class="aw-replay-comparison" data-agent-replay-comparison>
              <div><h4>{{ language === 'zh' ? '原回答' : 'Original answer' }}</h4><pre>{{ replayComparison.original }}</pre></div>
              <div><h4>{{ language === 'zh' ? '本次回测' : 'Replay result' }}</h4><pre>{{ replayComparison.current }}</pre></div>
            </section>
            <AgentDiagnostics v-if="diagnosticsOpen" :language="language" :turns="diagnostics" :running="runStatus === 'running'" @replay="replay" />
          </div>
        </div>

        <div class="aw-composer-area" :class="{ 'aw-composer-collapsed': composerCollapsed }" data-agent-composer>
          <button v-if="!followingLatest" class="aw-jump-latest" type="button" data-agent-action="latest" @click="scrollLatest">{{ copy.latest }} <span aria-hidden="true">↓</span></button>
          <button v-if="composerCollapsed" type="button" class="aw-composer-restore" data-agent-action="expand-composer" @click="expandComposer"><span>{{ input || (language === 'zh' ? '继续提问…' : 'Continue the conversation…') }}</span><span>{{ language === 'zh' ? '展开 ↑' : 'Expand ↑' }}</span></button>
          <div class="aw-composer-expandable" :inert="composerCollapsed || undefined">
          <form class="aw-composer" data-agent-form @submit.prevent="submit" @focusin="composerCollapsed = false">
            <ChatbotCommandMenu ref="commandMenu" :language="language" :input="input" :options="AGENT_COMMANDS" @select="chooseCommand" />
            <label class="aw-sr-only" :for="`${workspaceId}-input`">{{ copy.composer }}</label>
            <textarea :id="`${workspaceId}-input`" ref="inputRef" v-model="input" autocomplete="off" rows="2" :placeholder="copy.placeholder" :aria-expanded="commandMenu?.visible" :aria-controls="commandMenu?.visible ? commandMenu.menuId : undefined" :aria-activedescendant="commandMenu?.activeId" aria-autocomplete="list" data-agent-input @keydown="handleKeydown"></textarea>
            <p v-if="commandHint" class="aw-command-hint">{{ commandHint }}</p>
            <div class="aw-composer-toolbar"><span class="aw-composer-hint">{{ runStatus === 'running' ? copy.draft : copy.keyboard }}</span>
              <button v-if="runStatus === 'running'" type="button" class="aw-submit aw-stop" data-agent-action="stop" :disabled="stopping" @click="stop"><span class="aw-stop-symbol" aria-hidden="true"></span>{{ stopping ? copy.stopping : copy.stop }}</button>
              <button v-else type="submit" class="aw-submit" data-agent-action="send" :disabled="!input.trim()">{{ copy.send }}<span aria-hidden="true">↑</span></button>
            </div>
          </form>
          </div>
        </div>
      </section>

      <aside v-if="detailsOpen" :id="`${workspaceId}-details`" class="aw-details" :aria-label="copy.details" data-agent-details>
        <div class="aw-details-heading"><h3>{{ copy.details }}</h3><button type="button" class="aw-close" :aria-label="copy.closeDetails" @click="detailsOpen = false">×</button></div>
        <section class="aw-detail-section"><h4>{{ copy.context }}</h4><p :class="{ 'aw-context-populated': copy.restored }">{{ copy.restored || copy.contextEmpty }}</p></section>
        <section class="aw-detail-section"><h4>{{ copy.results }}<span>{{ resultIndex.length }}</span></h4>
          <p v-if="!resultIndex.length">{{ copy.resultsEmpty }}</p>
          <nav v-else :aria-label="copy.results" class="aw-result-index"><button v-for="(item, index) in resultIndex" :key="item.target" type="button" @click="jumpToResult(item.target)"><span>{{ String(index + 1).padStart(2, '0') }}</span><strong>{{ item.title }}</strong><span aria-hidden="true">↗</span></button></nav>
          <p v-if="resultIndex.length" class="aw-source-hint">{{ copy.sourceHint }}</p>
        </section>
        <section class="aw-detail-section aw-guide"><h4>{{ language === 'zh' ? '查询命令' : 'Query commands' }}</h4><div class="aw-command-shortcuts"><button v-for="command in AGENT_COMMANDS" :key="command.key" type="button" @click="chooseCommand(command.key)"><code>/{{ command.key }}</code><span>{{ language === 'zh' ? command.zh : command.en }}</span></button></div></section>
      </aside>
    </section>
  </main>
</template>
