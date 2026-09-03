import { readonly, shallowRef } from "vue";

import type {
  LegacyAgentRunCallbacks,
  LegacyAgentRunRequest,
  LegacyAgentRunResult,
  LegacyAgentSessionBridge,
  LegacyAgentTimelineStep,
  LegacyAgentViewState,
  LegacyBootstrapData,
  LegacyChatRunCallbacks,
  LegacyChatAnswerMessage,
  LegacyChatUtilityState,
  LegacySessionMessage,
  LegacyChatSessionBridge,
  LegacyChatStarterCard,
  LegacyChatViewResult,
  LegacyChatViewState,
  LegacyDeepWindowView,
  LegacyDeepWindowSkeletonStep,
  LegacyAnswerFeedbackState,
  LegacyDeepWindowInteraction,
  LegacyDeepWindowsBridge,
  LegacyDeepWindowsViewState,
  ModernAppApi,
  ModernPageController,
  ModernPageFactory,
  ModernPageName,
  ModernShellController,
  ModernShellFactory,
  UiLanguage
} from "./contracts";

export interface LegacyChatSessionBridgeOptions {
  readonly getState: () => LegacyChatViewState;
  readonly setMode: (mode: "report" | "chat") => void;
  readonly submit: (prompt: string, callbacks: LegacyChatRunCallbacks) => Promise<LegacyChatViewResult>;
  readonly removeMemory: (memoryId: string) => void;
  readonly clearConversation: () => void;
  readonly addMemory?: (result: import("./contracts").LegacyChatViewResult) => boolean;
  readonly downloadOverview?: () => boolean;
  readonly downloadRecommendation?: (downloadId: string) => boolean;
  readonly feedback?: import("./contracts").LegacyFeedbackBridge;
  readonly downloadLogs?: (kind: "questions" | "feedback", format: "csv" | "jsonl") => boolean;
  readonly toggleHelp?: () => boolean;
  readonly toggleGuide?: () => boolean;
  readonly startOnboarding?: () => boolean;
  readonly feedbackForAnswer?: (answerId: string) => import("./contracts").LegacyFeedbackBridge | null;
  readonly feedbackForDeepWindow?: (windowId: string) => import("./contracts").LegacyFeedbackBridge | null;
  readonly openChatAnswer?: (answerId: string) => string | null;
  readonly interactContext?: (action: string, value?: string) => boolean;
}

export interface LegacyAgentSessionBridgeOptions {
  readonly getState: () => LegacyAgentViewState;
  readonly submit: (request: LegacyAgentRunRequest, callbacks: LegacyAgentRunCallbacks) => Promise<LegacyAgentRunResult>;
  readonly stop: () => void;
  readonly newConversation: () => void;
}

export interface LegacyDeepWindowsBridgeOptions {
  readonly getState: () => LegacyDeepWindowsViewState;
  readonly activate: (id: string) => void;
  readonly minimize: (id: string) => void;
  readonly restore: (id: string) => void;
  readonly close: (id: string) => void;
  readonly pin: (id: string) => boolean;
  readonly move: (id: string, x: number, y: number) => boolean;
  readonly clone: (id: string) => string | null;
  readonly toggleOverlay: (id: string) => boolean;
  readonly export: (id: string) => boolean;
  readonly cancel: (id: string) => boolean;
  readonly addToChat: (id: string) => boolean;
  readonly interact?: (id: string, action: LegacyDeepWindowInteraction, value?: string) => boolean;
  readonly setTrendColumns?: (id: string, columns: readonly string[]) => boolean;
}

const EMPTY_BOOTSTRAP_DATA: LegacyBootstrapData = Object.freeze({
  chatbotData: {},
  sheetReportData: {},
  productKeywords: {},
  language: "zh",
  llmEnabled: false,
  agentEnabled: false
});

const legacySnapshot = shallowRef<LegacyBootstrapData>(EMPTY_BOOTSTRAP_DATA);
const readonlyLegacySnapshot = readonly(legacySnapshot);

export function getLegacySnapshot() {
  return readonlyLegacySnapshot;
}

function assertLanguage(language: unknown): asserts language is UiLanguage {
  if (language !== "zh" && language !== "en") {
    throw new TypeError("Legacy bootstrap language 必须是 zh 或 en");
  }
}

function assertLegacyBootstrapData(data: LegacyBootstrapData): void {
  if (typeof data !== "object" || data === null) {
    throw new TypeError("Legacy bootstrap data 必须是对象");
  }
  for (const key of ["chatbotData", "sheetReportData", "productKeywords"] as const) {
    if (!(key in data)) {
      throw new TypeError(`Legacy bootstrap 缺少 ${key}`);
    }
  }
  assertLanguage(data.language);
  if (typeof data.llmEnabled !== "boolean" || typeof data.agentEnabled !== "boolean") {
    throw new TypeError("Legacy bootstrap 功能开关必须是布尔值");
  }
}

function safeText(value: unknown, limit = 240): string {
  return String(value ?? "").trim().slice(0, limit);
}

function safeDataSource(value: unknown): LegacyChatViewState["source"] {
  return value === "db" || value === "cache" ? value : "unavailable";
}

function safeFeedbackState(value: unknown): LegacyAnswerFeedbackState {
  return value === "available" || value === "submitted" ? value : "unavailable";
}

function normalizeAnswerMessage(value: LegacyChatAnswerMessage, index: number): LegacyChatAnswerMessage {
  const message = value || {} as LegacyChatAnswerMessage;
  const role = message.role === "assistant" ? "assistant" : "user";
  const messageId = safeText(message.id, 120);
  const answerId = role === "assistant"
    ? safeText(message.answerId || message.id, 120) || `assistant-${index + 1}`
    : "";
  const deepWindowId = safeText(message.deepWindowId, 120);
  const contentHtml = safeText(message.contentHtml, 160_000);
  return {
    id: messageId || answerId || `${role}-${index + 1}`,
    ...(role === "assistant" ? { answerId } : {}),
    role,
    content: safeText(message.content, 120_000),
    ...(role === "assistant" && contentHtml ? { contentHtml } : {}),
    ...(role === "assistant" && deepWindowId ? { deepWindowId } : {}),
    ...(role === "assistant" ? {
      canOpenDeep: message.canOpenDeep === true || Boolean(deepWindowId),
      feedbackState: safeFeedbackState(message.feedbackState)
    } : {})
  };
}

const EMPTY_CHAT_UTILITY: LegacyChatUtilityState = Object.freeze({
  helpOpen: false,
  guideOpen: false,
  helpHtml: "",
  guideHtml: "",
  guideLoading: false,
  onboardingOpen: false,
  onboardingStep: 0,
  onboardingTotal: 0,
  reminderVisible: false,
  reminderCollapsed: false
});

function normalizeUtilityState(value: LegacyChatUtilityState | undefined): LegacyChatUtilityState {
  const utility = value || EMPTY_CHAT_UTILITY;
  const step = Number(utility.onboardingStep);
  const total = Number(utility.onboardingTotal);
  return {
    helpOpen: utility.helpOpen === true,
    guideOpen: utility.guideOpen === true,
    helpHtml: safeText(utility.helpHtml, 160_000),
    guideHtml: safeText(utility.guideHtml, 160_000),
    guideLoading: utility.guideLoading === true,
    onboardingOpen: utility.onboardingOpen === true,
    onboardingStep: Number.isFinite(step) ? Math.max(0, Math.min(Math.floor(step), 100)) : 0,
    onboardingTotal: Number.isFinite(total) ? Math.max(0, Math.min(Math.floor(total), 100)) : 0,
    reminderVisible: utility.reminderVisible === true,
    reminderCollapsed: utility.reminderCollapsed === true
  };
}

function normalizeSkeletonStep(value: LegacyDeepWindowSkeletonStep, index: number): LegacyDeepWindowSkeletonStep | null {
  const step = value || {} as LegacyDeepWindowSkeletonStep;
  const id = safeText(step.id, 80) || `step-${index + 1}`;
  const state = step.state === "active" || step.state === "done" ? step.state : "pending";
  const label = safeText(step.label, 240);
  return label ? { id, label, state } : null;
}

function normalizeChatResult(value: LegacyChatViewResult, fallbackMode: "report" | "chat", fallbackSource: LegacyChatViewState["source"]): LegacyChatViewResult {
  const source = safeDataSource(value?.source || fallbackSource);
  const status = value?.status === "success" || value?.status === "stopped" ? value.status : "error";
  const response = safeText(value?.response, 120_000);
  const contentHtml = safeText(value?.contentHtml, 160_000);
  const recommendationHtml = safeText(value?.recommendationHtml, 160_000);
  return {
    ok: value?.ok === true && status === "success",
    status,
    mode: value?.mode === "chat" || value?.mode === "report" ? value.mode : fallbackMode,
    source,
    ...(safeText(value?.intent, 64) ? { intent: safeText(value.intent, 64) } : {}),
    response,
    ...(contentHtml ? { contentHtml } : {}),
    ...(recommendationHtml ? { recommendationHtml } : {}),
    ...(typeof value?.reportSnapshot === "object" && value.reportSnapshot !== null
      ? { reportSnapshot: value.reportSnapshot }
      : {}),
    ...(safeText(value?.deepWindowId, 120) ? { deepWindowId: safeText(value.deepWindowId, 120) } : {}),
    ...(safeText(value?.answerId, 120) ? { answerId: safeText(value.answerId, 120) } : {}),
    ...(value?.feedbackState === "available" || value?.feedbackState === "submitted"
      ? { feedbackState: value.feedbackState }
      : {}),
    ...(safeText(value?.errorCode, 80) ? { errorCode: safeText(value.errorCode, 80) } : {})
  };
}

function normalizeDeepWindow(value: LegacyDeepWindowView): LegacyDeepWindowView {
  const view = value || {} as LegacyDeepWindowView;
  const mode = view.mode === "chat" ? "chat" : "report";
  const status = view.status === "loading" || view.status === "error" ? view.status : "content";
  const x = Number(view.position?.x);
  const y = Number(view.position?.y);
  const zIndex = Number(view.zIndex);
  const skeletonSteps = Array.isArray(view.skeletonSteps)
    ? view.skeletonSteps.map(normalizeSkeletonStep).filter((item): item is LegacyDeepWindowSkeletonStep => Boolean(item)).slice(0, 12)
    : [];
  const errorMessage = safeText(view.errorMessage, 8_000);
  return {
    id: safeText(view.id, 120),
    mode,
    status,
    title: safeText(view.title, 200),
    prompt: safeText(view.prompt, 20_000),
    summary: safeText(view.summary, 8_000),
    ...(safeText(view.contentHtml, 160_000) ? { contentHtml: safeText(view.contentHtml, 160_000) } : {}),
    source: safeDataSource(view.source),
    minimized: view.minimized === true,
    pinned: view.pinned === true,
    overlay: view.overlay === true,
    position: {
      x: Number.isFinite(x) ? Math.max(-10_000, Math.min(x, 10_000)) : 0,
      y: Number.isFinite(y) ? Math.max(-10_000, Math.min(y, 10_000)) : 0
    },
    canCancel: view.canCancel === true,
    canAddMemory: view.canAddMemory === true,
    addedToMemory: view.addedToMemory === true,
    skeletonSteps,
    ...(errorMessage ? { errorMessage } : {}),
    ...(Number.isFinite(zIndex) ? { zIndex: Math.max(0, Math.min(Math.floor(zIndex), 100_000)) } : {}),
    canExport: view.canExport !== false && status === "content",
    canMinimize: view.canMinimize !== false,
    canClose: view.canClose !== false,
    feedbackState: safeFeedbackState(view.feedbackState)
  };
}

function normalizeDeepWindowsState(value: LegacyDeepWindowsViewState): LegacyDeepWindowsViewState {
  const state = value || { windows: [], activeId: null } as LegacyDeepWindowsViewState;
  const windows = Array.isArray(state.windows)
    ? state.windows.map(normalizeDeepWindow).filter((item) => item.id)
    : [];
  const activeId = safeText(state.activeId, 120);
  return {
    windows,
    activeId: activeId && windows.some((item) => item.id === activeId) ? activeId : null
  };
}

function normalizeChatState(value: LegacyChatViewState): LegacyChatViewState {
  const state = value || {} as LegacyChatViewState;
  const mode = state.mode === "chat" ? "chat" : "report";
  const language = state.language === "en" ? "en" : "zh";
  const messages: LegacyChatAnswerMessage[] = Array.isArray(state.messages)
    ? state.messages.filter(Boolean).map(normalizeAnswerMessage)
    : [];
  const history: LegacyChatAnswerMessage[] = Array.isArray(state.history)
    ? state.history.filter(Boolean).map(normalizeAnswerMessage)
    : [];
  const memory = Array.isArray(state.memory)
    ? state.memory.filter(Boolean).map((item) => ({
        id: safeText(item.id, 120),
        title: safeText(item.title, 200),
        text: safeText(item.text, 8_000),
        ...(safeText(item.html, 160_000) ? { html: safeText(item.html, 160_000) } : {}),
        ...(item.source === "db" || item.source === "cache" || item.source === "unavailable" ? { source: item.source } : {})
      })).filter((item) => item.id)
    : [];
  const starterCards: LegacyChatStarterCard[] = Array.isArray(state.starterCards)
    ? state.starterCards.filter(Boolean).map((card) => ({
        id: safeText(card.id, 120),
        title: safeText(card.title, 200),
        type: safeText(card.type, 80),
        questions: Array.isArray(card.questions)
          ? card.questions.map((question: unknown) => safeText(question, 400)).filter(Boolean).slice(0, 6)
          : []
      })).filter((card) => card.id && card.questions.length)
    : [];
  const contextTitle = safeText(state.contextTitle, 240);
  const contextSubtitle = safeText(state.contextSubtitle, 240);
  const contextHtml = safeText(state.contextHtml, 160_000);
  const supplementalHtml = safeText(state.supplementalHtml, 160_000);
  return {
    mode,
    language,
    ...(contextTitle ? { contextTitle } : {}),
    ...(contextSubtitle ? { contextSubtitle } : {}),
    ...(contextHtml ? { contextHtml } : {}),
    hasMemory: state.hasMemory === true || memory.length > 0,
    source: safeDataSource(state.source),
    status: state.status === "running" || state.status === "success" || state.status === "stopped" || state.status === "error"
      ? state.status : "idle",
    history,
    messages,
    memory,
    starterCards,
    utility: normalizeUtilityState(state.utility),
    ...(supplementalHtml ? { supplementalHtml } : {}),
    currentResult: state.currentResult
      ? normalizeChatResult(state.currentResult, mode, safeDataSource(state.source))
      : null,
    ...(safeText(state.errorCode, 80) ? { errorCode: safeText(state.errorCode, 80) } : {})
  };
}

function normalizeAgentStep(value: LegacyAgentTimelineStep): LegacyAgentTimelineStep {
  const step = value || {} as LegacyAgentTimelineStep;
  const phase = step.phase === "planning" || step.phase === "synthesis" ? step.phase : "tool";
  const status = step.status === "running" || step.status === "done" || step.status === "stopped" || step.status === "timeout"
    ? step.status : "error";
  const dataSource = step.dataSource === "cache" || step.dataSource === "database" || step.dataSource === "mixed"
    || step.dataSource === "unavailable" || step.dataSource === "unknown" ? step.dataSource : undefined;
  const elapsed = Number(step.elapsedMs);
  return {
    id: safeText(step.id, 120) || `${phase}-${status}`,
    phase,
    status,
    label: safeText(step.label, 160),
    ...(safeText(step.detail, 320) ? { detail: safeText(step.detail, 320) } : {}),
    ...(Number.isFinite(elapsed) && elapsed >= 0 ? { elapsedMs: Math.min(elapsed, 3_600_000) } : {}),
    ...(dataSource ? { dataSource } : {}),
    ...(step.dataAsOf == null ? {} : { dataAsOf: safeText(step.dataAsOf, 48) || null }),
    ...(step.estimated === true ? { estimated: true } : {})
  };
}

function normalizeAgentMemoryEntity(value: unknown, includeType = false): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = safeText(record.id, 80);
  const name = safeText(record.name || record.merchantName || record.merchant, 120);
  if (!id && !name) return null;
  const result: Record<string, unknown> = { ...(id ? { id } : {}), name: name || id };
  if (includeType) {
    result.type = record.type === "category" || record.type === "tier" ? record.type : "merchant";
  }
  return result;
}

function normalizeAgentMemoryEntities(values: unknown, includeType = false, limit = 10): Record<string, unknown>[] {
  const seen = new Set<string>();
  const result: Record<string, unknown>[] = [];
  for (const item of Array.isArray(values) ? values : []) {
    const entity = normalizeAgentMemoryEntity(item, includeType);
    if (!entity) continue;
    const key = `${String(entity.type || "merchant")}:${String(entity.id || entity.name)}`.toLowerCase();
    if (seen.has(key) || result.length >= limit) continue;
    seen.add(key);
    result.push(entity);
  }
  return result;
}

function normalizeAgentMemoryStrings(values: unknown, limit: number, max = 120): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of Array.isArray(values) ? values : []) {
    const value = safeText(item, max);
    const key = value.toLowerCase();
    if (!value || seen.has(key) || result.length >= limit) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function normalizeAgentMemoryMonth(value: unknown): string | null {
  const month = safeText(value, 7);
  return /^20\d{2}-(0[1-9]|1[0-2])$/.test(month) ? month : null;
}

function normalizeAgentMemoryLastTool(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const toolName = safeText(record.toolName, 48);
  const headline = safeText(record.headline, 240);
  if (!toolName && !headline) return null;
  const dataSource = record.dataSource === "cache" || record.dataSource === "database"
    || record.dataSource === "mixed" || record.dataSource === "unknown"
    ? record.dataSource : "unknown";
  return {
    toolName,
    headline,
    dataSource,
    dataAsOf: safeText(record.dataAsOf, 48) || null,
    estimated: record.estimated === true,
    partial: record.partial === true
  };
}

function normalizeAgentMemorySnapshot(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const focus = source.focus && typeof source.focus === "object" && !Array.isArray(source.focus)
    ? source.focus as Record<string, unknown> : {};
  const query = source.query && typeof source.query === "object" && !Array.isArray(source.query)
    ? source.query as Record<string, unknown> : {};
  const candidates = source.candidates && typeof source.candidates === "object" && !Array.isArray(source.candidates)
    ? source.candidates as Record<string, unknown> : {};
  const months = Number(query.months);
  const updatedAt = safeText(source.updatedAt, 40);
  return {
    version: 1,
    ...(updatedAt ? { updatedAt } : {}),
    focus: {
      merchants: normalizeAgentMemoryEntities(focus.merchants),
      categories: normalizeAgentMemoryStrings(focus.categories, 4),
      tiers: normalizeAgentMemoryStrings(focus.tiers, 5, 40)
    },
    query: {
      startMonth: normalizeAgentMemoryMonth(query.startMonth),
      endMonth: normalizeAgentMemoryMonth(query.endMonth),
      months: Number.isInteger(months) && months >= 1 && months <= 24 ? months : null,
      metrics: normalizeAgentMemoryStrings(query.metrics, 12, 40)
    },
    lastTool: normalizeAgentMemoryLastTool(source.lastTool),
    candidates: {
      pending: normalizeAgentMemoryEntities(candidates.pending, true),
      confirmed: normalizeAgentMemoryEntities(candidates.confirmed, true),
      rejected: normalizeAgentMemoryEntities(candidates.rejected, true)
    }
  };
}

function normalizeAgentMemoryEvent(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (event.kind === "candidates") {
    return {
      kind: "candidates",
      candidates: normalizeAgentMemoryEntities(event.candidates, true)
    };
  }
  if (event.kind !== "tool_success") return null;
  const focus = event.focus && typeof event.focus === "object" && !Array.isArray(event.focus)
    ? event.focus as Record<string, unknown> : {};
  const query = event.query && typeof event.query === "object" && !Array.isArray(event.query)
    ? event.query as Record<string, unknown> : {};
  const months = Number(query.months);
  return {
    kind: "tool_success",
    focus: {
      merchants: normalizeAgentMemoryEntities(focus.merchants),
      categories: normalizeAgentMemoryStrings(focus.categories, 4),
      tiers: normalizeAgentMemoryStrings(focus.tiers, 5, 40)
    },
    query: {
      startMonth: normalizeAgentMemoryMonth(query.startMonth),
      endMonth: normalizeAgentMemoryMonth(query.endMonth),
      months: Number.isInteger(months) && months >= 1 && months <= 24 ? months : null,
      metrics: normalizeAgentMemoryStrings(query.metrics, 12, 40)
    },
    lastTool: normalizeAgentMemoryLastTool(event.lastTool),
    resolvedEntities: normalizeAgentMemoryEntities(event.resolvedEntities, true)
  };
}

function normalizeAgentState(value: LegacyAgentViewState): LegacyAgentViewState {
  const state = value || {} as LegacyAgentViewState;
  const history: LegacySessionMessage[] = Array.isArray(state.history)
    ? state.history.filter(Boolean).map((message): LegacySessionMessage => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: safeText(message.content, 120_000)
      }))
      : [];
  const messages: LegacySessionMessage[] | undefined = Array.isArray(state.messages)
    ? state.messages.filter(Boolean).map((message): LegacySessionMessage => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: safeText(message.content, 120_000)
      }))
    : undefined;
  const steps = Array.isArray(state.steps) ? state.steps.filter(Boolean).map(normalizeAgentStep) : [];
  const status = state.status === "running" || state.status === "done" || state.status === "stopped" || state.status === "error"
    ? state.status : "idle";
  return {
    status,
    history,
    ...(messages ? { messages } : {}),
    steps,
    response: safeText(state.response, 120_000),
    partial: state.partial === true,
    omittedTargets: Array.isArray(state.omittedTargets)
      ? state.omittedTargets.map((item) => safeText(item, 160)).filter(Boolean).slice(0, 20)
      : [],
    hasMemory: state.hasMemory === true,
    ...(normalizeAgentMemorySnapshot(state.memory) ? { memory: normalizeAgentMemorySnapshot(state.memory) } : {}),
    ...(safeText(state.errorCode, 80) ? { errorCode: safeText(state.errorCode, 80) } : {})
  };
}

function normalizeAgentResult(value: LegacyAgentRunResult): LegacyAgentRunResult {
  const status = value?.status === "done" || value?.status === "stopped" ? value.status : "error";
  return {
    ok: value?.ok === true && status === "done",
    status,
    response: safeText(value?.response, 120_000),
    steps: Array.isArray(value?.steps) ? value.steps.filter(Boolean).map(normalizeAgentStep) : [],
    ...(value?.partial === true ? { partial: true } : {}),
    ...(Array.isArray(value?.omittedTargets) ? {
      omittedTargets: value.omittedTargets.map((item) => safeText(item, 160)).filter(Boolean).slice(0, 20)
    } : {}),
    ...(Array.isArray(value?.memoryEvents) ? {
      memoryEvents: value.memoryEvents
        .map((event) => normalizeAgentMemoryEvent(event))
        .filter((event): event is Record<string, unknown> => Boolean(event))
        .slice(0, 20)
    } : {}),
    ...(safeText(value?.errorCode, 80) ? { errorCode: safeText(value.errorCode, 80) } : {})
  };
}

export function createLegacyChatSessionBridge(options: LegacyChatSessionBridgeOptions): LegacyChatSessionBridge {
  const listeners = new Set<(state: LegacyChatViewState) => void>();
  const emit = (): void => {
    const state = normalizeChatState(options.getState());
    listeners.forEach((listener) => listener(state));
  };
  return {
    getState: () => normalizeChatState(options.getState()),
    setMode(mode) {
      if (mode !== "report" && mode !== "chat") throw new TypeError("Legacy Chat mode 无效");
      options.setMode(mode);
      emit();
    },
    async submit(prompt, callbacks = {}) {
      const query = safeText(prompt, 20_000);
      if (!query) {
        return {
          ok: false,
          status: "error",
          mode: normalizeChatState(options.getState()).mode,
          source: normalizeChatState(options.getState()).source,
          response: "",
          errorCode: "empty_prompt"
        };
      }
      try {
        const result = await options.submit(query, {
          onToken: callbacks.onToken,
          signal: callbacks.signal,
          onChange: (state) => {
            const next = normalizeChatState(state);
            callbacks.onChange?.(next);
            listeners.forEach((listener) => listener(next));
          }
        });
        const normalized = normalizeChatResult(result, normalizeChatState(options.getState()).mode, normalizeChatState(options.getState()).source);
        emit();
        return normalized;
      } catch {
        const state = normalizeChatState(options.getState());
        const fallback: LegacyChatViewResult = {
          ok: false,
          status: "error",
          mode: state.mode,
          source: state.source,
          response: "",
          errorCode: "legacy_chat_bridge_error"
        };
        emit();
        return fallback;
      }
    },
    removeMemory(memoryId) {
      options.removeMemory(safeText(memoryId, 120));
      emit();
    },
    clearConversation() {
      options.clearConversation();
      emit();
    },
    downloadOverview() {
      return options.downloadOverview?.() || false;
    },
    downloadRecommendation(downloadId) {
      return options.downloadRecommendation?.(safeText(downloadId, 120)) || false;
    },
    addMemory(result) {
      const state = normalizeChatState(options.getState());
      return options.addMemory?.(normalizeChatResult(result, state.mode, state.source)) || false;
    },
    feedback: options.feedback,
    downloadLogs(kind, format) {
      return options.downloadLogs?.(kind, format) || false;
    },
    toggleHelp() {
      return options.toggleHelp?.() || false;
    },
    toggleGuide() {
      return options.toggleGuide?.() || false;
    },
    startOnboarding() {
      return options.startOnboarding?.() || false;
    },
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
    },
    interactContext(action, value) {
      const target = safeText(action, 120);
      return target ? options.interactContext?.(target, safeText(value, 200)) || false : false;
    },
    onChange(listener) {
      if (typeof listener !== "function") throw new TypeError("Legacy Chat listener 必须是函数");
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

export function createLegacyAgentSessionBridge(options: LegacyAgentSessionBridgeOptions): LegacyAgentSessionBridge {
  const listeners = new Set<(state: LegacyAgentViewState) => void>();
  const emit = (): void => {
    const state = normalizeAgentState(options.getState());
    listeners.forEach((listener) => listener(state));
  };
  return {
    getState: () => normalizeAgentState(options.getState()),
    async submit(request, callbacks = {}) {
      const prompt = safeText(request?.prompt, 20_000);
      if (!prompt) {
        return { ok: false, status: "error", response: "", steps: [], errorCode: "empty_prompt" };
      }
      try {
        const result = await options.submit({ ...request, prompt }, {
          onToken: callbacks.onToken,
          onTimeline: (step) => {
            const next = normalizeAgentStep(step);
            callbacks.onTimeline?.(next);
            const state = normalizeAgentState(options.getState());
            listeners.forEach((listener) => listener({ ...state, steps: [...state.steps, next] }));
          },
          onChange: (state) => {
            const next = normalizeAgentState(state);
            callbacks.onChange?.(next);
            listeners.forEach((listener) => listener(next));
          }
        });
        const normalized = normalizeAgentResult(result);
        emit();
        return normalized;
      } catch {
        emit();
        return { ok: false, status: "error", response: "", steps: [], errorCode: "legacy_agent_bridge_error" };
      }
    },
    stop() {
      options.stop();
      emit();
    },
    newConversation() {
      options.newConversation();
      emit();
    },
    onChange(listener) {
      if (typeof listener !== "function") throw new TypeError("Legacy Agent listener 必须是函数");
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

export function createLegacyDeepWindowsBridge(options: LegacyDeepWindowsBridgeOptions): LegacyDeepWindowsBridge {
  const listeners = new Set<(state: LegacyDeepWindowsViewState) => void>();
  const emit = (): void => {
    const state = normalizeDeepWindowsState(options.getState());
    listeners.forEach((listener) => listener(state));
  };
  const id = (value: string): string => safeText(value, 120);
  return {
    getState: () => normalizeDeepWindowsState(options.getState()),
    activate(value) {
      const target = id(value);
      if (!target) return;
      options.activate(target);
      emit();
    },
    minimize(value) {
      const target = id(value);
      if (!target) return;
      options.minimize(target);
      emit();
    },
    restore(value) {
      const target = id(value);
      if (!target) return;
      options.restore(target);
      emit();
    },
    close(value) {
      const target = id(value);
      if (!target) return;
      options.close(target);
      emit();
    },
    pin(value) {
      const target = id(value);
      if (!target) return false;
      const result = options.pin(target);
      emit();
      return result;
    },
    move(value, x, y) {
      const target = id(value);
      if (!target || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      const result = options.move(target, x, y);
      emit();
      return result;
    },
    clone(value) {
      const target = id(value);
      if (!target) return null;
      const result = options.clone(target);
      emit();
      return result;
    },
    toggleOverlay(value) {
      const target = id(value);
      if (!target) return false;
      const result = options.toggleOverlay(target);
      emit();
      return result;
    },
    export(value) {
      const target = id(value);
      if (!target) return false;
      const result = options.export(target);
      emit();
      return result;
    },
    cancel(value) {
      const target = id(value);
      if (!target) return false;
      const result = options.cancel(target);
      emit();
      return result;
    },
    addToChat(value) {
      const target = id(value);
      if (!target) return false;
      const result = options.addToChat(target);
      emit();
      return result;
    },
    interact(value, action, detail) {
      const target = id(value);
      const allowed: readonly LegacyDeepWindowInteraction[] = [
        "trend-metric",
        "trend-category",
        "trend-column-toggle",
        "trend-column-core",
        "trend-column-all"
      ];
      if (!target || !allowed.includes(action)) return false;
      const result = options.interact?.(target, action, safeText(detail, 120)) || false;
      emit();
      return result;
    },
    setTrendColumns(value, columns) {
      const target = id(value);
      if (!target) return false;
      const safeColumns = Array.isArray(columns)
        ? Array.from(new Set(columns.map((column) => safeText(column, 80)).filter(Boolean))).slice(0, 32)
        : [];
      const result = options.setTrendColumns?.(target, safeColumns) || false;
      emit();
      return result;
    },
    onChange(listener) {
      if (typeof listener !== "function") throw new TypeError("Legacy Deep Window listener 必须是函数");
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

export function createModernAppApi(
  definitions: Partial<Record<ModernPageName, ModernPageFactory>> = {},
  shellFactory?: ModernShellFactory
): ModernAppApi {
  let activePage: { name: ModernPageName; controller: ModernPageController } | null = null;
  let activeShell: ModernShellController | null = null;

  function unmountActivePage(): void {
    if (!activePage) return;
    const current = activePage;
    activePage = null;
    current.controller.unmount();
  }

  function unmountActiveShell(): void {
    if (!activeShell) return;
    const current = activeShell;
    activeShell = null;
    current.unmount();
  }

  return {
    bootstrap(data) {
      assertLegacyBootstrapData(data);
      legacySnapshot.value = Object.freeze({ ...data });
    },

    mountPage(page, element) {
      const factory = definitions[page];
      if (!factory) return false;
      unmountActivePage();
      const controller = factory(element);
      activePage = { name: page, controller };
      return true;
    },

    unmountPage(page) {
      if (!activePage || activePage.name !== page) return;
      unmountActivePage();
    },

    mountShell(element) {
      if (!shellFactory) return false;
      unmountActiveShell();
      const controller = shellFactory(element);
      activeShell = controller;
      return true;
    },

    unmountShell() {
      unmountActiveShell();
    },

    setPage(page: ModernPageName) {
      activeShell?.setPage?.(page);
    },

    setLanguage(language: UiLanguage) {
      assertLanguage(language);
      legacySnapshot.value = Object.freeze({
        ...legacySnapshot.value,
        language
      });
      activePage?.controller.setLanguage?.(language);
      activeShell?.setLanguage?.(language);
    },

    hasPage(page: ModernPageName) {
      return Boolean(definitions[page]);
    }
  };
}
