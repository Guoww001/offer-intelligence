<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import type { UiLanguage } from "../../shared/i18n";
import type {
  LegacyChatAnswerMessage,
  LegacyChatViewResult,
  LegacyChatViewState,
  LegacyChatUtilityState,
  LegacyChatStarterCard,
  LegacyDeepWindowInteraction,
  LegacyDeepWindowView,
  LegacyDeepWindowsBridge,
  LegacyDeepWindowsViewState
} from "../../legacy/contracts";
import ChatbotChatView from "./ChatbotChatView.vue";
import ChatbotOnboarding from "./ChatbotOnboarding.vue";
import ChatbotReportView from "./ChatbotReportView.vue";
import ChatbotUtilityPanels from "./ChatbotUtilityPanels.vue";
import DeepWindow from "./DeepWindow.vue";
import { streamChatbotReply } from "./useChatbotChat";
import { useChatbotReport } from "./useChatbotReport";
import { useDeepWindows, type DeepWindowState } from "./useDeepWindows";
import type {
  ChatbotChatRequest,
  ChatbotChatResult,
  ChatbotChatRunner,
  ChatbotHistoryMessage,
  ChatbotMemoryItem,
  ChatbotMode,
  ChatbotReportViewResult,
  ChatbotSession
} from "./chatbotViewTypes";

const props = withDefaults(defineProps<{
  readonly language: UiLanguage;
  readonly offers: readonly Readonly<Record<string, unknown>>[];
  readonly runChat?: ChatbotChatRunner;
  readonly session?: ChatbotSession;
  readonly deepWindows?: LegacyDeepWindowsBridge;
  readonly autoFocus?: boolean;
}>(), {
  runChat: undefined,
  session: undefined,
  deepWindows: undefined,
  autoFocus: true
});

const mode = ref<ChatbotMode>(props.session?.getState().mode || "report");
const report = useChatbotReport(() => props.offers, () => props.language);
const reportPrompt = report.prompt;
const reportResult = report.result;
const reportLoading = report.loading;
const contextTitle = ref("");
const contextSubtitle = ref("");
const contextHtml = ref("");
const supplementalHtml = ref("");
const chatInput = ref("");
const chatLoading = ref(false);
const chatError = ref("");
const chatMessages = ref<Array<ChatbotHistoryMessage & Partial<LegacyChatAnswerMessage> & { readonly id: string; readonly streaming?: boolean }>>([]);
const chatCurrentResult = ref<LegacyChatViewResult | null>(null);
const starterCards = ref<readonly LegacyChatStarterCard[]>([]);
const memory = ref<ChatbotMemoryItem[]>([]);
const memoryDropHighlighted = ref(false);
const utilityState = ref<LegacyChatUtilityState>({
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
const feedbackRefreshKey = ref(0);
const {
  deepWindow: localDeepWindow,
  windows: localDeepWindows,
  open: openLocalDeepWindow,
  minimize: minimizeLocalDeepWindow,
  restore: restoreLocalDeepWindow,
  close: closeLocalDeepWindow,
  pin: pinLocalDeepWindow,
  move: moveLocalDeepWindow,
  clone: cloneLocalDeepWindow,
  toggleOverlay: toggleLocalDeepWindowOverlay,
  export: exportLocalDeepWindow,
  cancel: cancelLocalDeepWindow,
  clear: clearLocalDeepWindows
} = useDeepWindows();
let chatAbortController: AbortController | null = null;
let stopSessionSubscription: (() => void) | null = null;
const legacyDeepWindowsState = ref<LegacyDeepWindowsViewState>(props.deepWindows?.getState() || { windows: [], activeId: null });
let stopDeepWindowSubscription: (() => void) | null = null;
let idCounter = 0;

const copy = computed(() => props.language === "zh" ? {
  title: "Chatbot",
  subtitle: "用 Report Mode 查数据，用 Chat Mode 继续追问。",
  report: "报告模式",
  chat: "聊天模式",
  reportError: "报告暂时无法生成，请重试。"
} : {
  title: "Chatbot",
  subtitle: "Use Report Mode for data, then continue in Chat Mode.",
  report: "Report Mode",
  chat: "Chat Mode",
  reportError: "The report is temporarily unavailable. Try again."
});

const reportError = computed(() => report.hasError.value ? copy.value.reportError : "");
const reportAnswerId = computed(() => reportResult.value?.bridgeResult?.answerId || null);
const reportAnswerFeedback = computed(() => reportAnswerId.value ? feedbackForAnswer(reportAnswerId.value) : null);

const utilityCopy = computed(() => props.language === "zh" ? {
  help: "使用说明",
  guide: "使用流程",
  logs: "日志",
  questions: "提问记录",
  feedback: "反馈记录"
} : {
  help: "Help",
  guide: "User guide",
  logs: "Logs",
  questions: "Questions",
  feedback: "Feedback"
});

function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function reportText(result: ChatbotReportViewResult): string {
  return result.message || `${result.intent} report`;
}

function downloadLogs(kind: "questions" | "feedback", format: "csv" | "jsonl"): void {
  props.session?.downloadLogs?.(kind, format);
}

function downloadRecommendation(downloadId: string): void {
  props.session?.downloadRecommendation?.(downloadId);
}

function downloadOverview(): void {
  props.session?.downloadOverview?.();
}

function toggleHelp(): void {
  props.session?.toggleHelp?.();
}

function toggleGuide(): void {
  props.session?.toggleGuide?.();
}

function startOnboarding(): void {
  props.session?.startOnboarding?.();
}

function clearConversation(): void {
  props.session?.clearConversation();
}

function interactContext(action: string, value?: string): void {
  props.session?.interactContext?.(action, value);
}

function feedbackForAnswer(answerId: string): ReturnType<NonNullable<ChatbotSession["feedbackForAnswer"]>> {
  return props.session?.feedbackForAnswer?.(answerId) || null;
}

function feedbackForDeepWindow(windowId: string): ReturnType<NonNullable<ChatbotSession["feedbackForDeepWindow"]>> {
  return props.session?.feedbackForDeepWindow?.(windowId) || null;
}

function bridgeResultToView(result: LegacyChatViewResult, query: string): ChatbotReportViewResult {
  const status: ChatbotReportViewResult["status"] = result.status === "success"
    ? "resolved" : result.status === "stopped" ? "deferred" : "not_found";
  return {
    intent: (result.intent || "analysis") as ChatbotReportViewResult["intent"],
    ...(result.intent ? { title: result.intent } : {}),
    status,
    query,
    source: result.source,
    rows: [],
    summary: {
      offerCount: 0,
      clicks: 0,
      orders: 0,
      revenue: 0,
      commission: 0,
      conversionRate: null
    },
    message: result.response || (result.status === "stopped" ? copy.value.reportError : copy.value.reportError),
    ...(result.contentHtml ? { legacyHtml: result.contentHtml } : {}),
    ...(result.recommendationHtml ? { recommendationHtml: result.recommendationHtml } : {}),
    bridgeResult: result
  };
}

function deepWindowResult(view: LegacyDeepWindowView): ChatbotReportViewResult {
  return {
    intent: "analysis",
    title: view.title,
    status: view.status === "content" ? "resolved" : view.status === "error" ? "not_found" : "deferred",
    query: view.prompt,
    source: view.source,
    rows: [],
    summary: {
      offerCount: 0,
      clicks: 0,
      orders: 0,
      revenue: 0,
      commission: 0,
      conversionRate: null
    },
    message: view.summary || view.title,
    ...(view.contentHtml ? { legacyHtml: view.contentHtml } : {})
  };
}

function deepWindowState(view: LegacyDeepWindowView): DeepWindowState {
  return {
    id: view.id,
    mode: view.mode,
    result: deepWindowResult(view),
    title: view.title,
    summary: view.summary,
    contentHtml: view.contentHtml,
    errorMessage: view.errorMessage,
    skeletonSteps: view.skeletonSteps,
    zIndex: view.zIndex,
    canCancel: view.canCancel,
    minimized: view.minimized,
    pinned: view.pinned,
    overlay: view.overlay,
    status: view.status === "loading" ? "loading" : view.status === "error" ? "error" : "ready",
    position: view.position,
    canAddMemory: view.canAddMemory,
    addedToMemory: view.addedToMemory,
    canExport: view.canExport,
    canMinimize: view.canMinimize,
    canClose: view.canClose,
    feedbackState: view.feedbackState
  };
}

const displayedDeepWindows = computed<readonly DeepWindowState[]>(() => props.deepWindows
  ? legacyDeepWindowsState.value.windows.map(deepWindowState)
  : localDeepWindows.value);

const activeDisplayedDeepWindow = computed<DeepWindowState | null>(() => {
  const activeId = props.deepWindows ? legacyDeepWindowsState.value.activeId : localDeepWindow.value?.id;
  return displayedDeepWindows.value.find((item) => item.id === activeId) || displayedDeepWindows.value.at(-1) || null;
});

function syncDeepWindowState(next: LegacyDeepWindowsViewState = props.deepWindows!.getState()): void {
  legacyDeepWindowsState.value = next;
}

function sessionMemoryToLocal(state: LegacyChatViewState): ChatbotMemoryItem[] {
  return state.memory.map((item) => ({
    id: item.id,
    title: item.title,
    text: item.text,
    ...(item.html ? { html: item.html } : {}),
    ...(item.source ? { source: item.source } : {})
  }));
}

function syncSessionState(next: LegacyChatViewState = props.session!.getState()): void {
  mode.value = next.mode;
  contextTitle.value = next.contextTitle || "";
  contextSubtitle.value = next.contextSubtitle || "";
  contextHtml.value = next.contextHtml || (next.currentResult?.mode === "report"
    ? next.currentResult.recommendationHtml || ""
    : "");
  supplementalHtml.value = next.supplementalHtml || "";
  utilityState.value = next.utility || utilityState.value;
  chatLoading.value = next.status === "running";
  chatError.value = next.status === "error" ? copy.value.reportError : "";
  memory.value = sessionMemoryToLocal(next);
  starterCards.value = next.starterCards || [];
  chatCurrentResult.value = next.currentResult?.mode === "chat" ? next.currentResult : null;
  const lastAssistantIndex = next.messages.reduce(
    (index, message, currentIndex) => message.role === "assistant" ? currentIndex : index,
    -1
  );
  chatMessages.value = next.messages.map((message, messageIndex) => ({
    id: message.id || message.answerId || nextId(message.role === "user" ? "user" : "assistant"),
    role: message.role,
    content: message.content,
    ...(message.answerId ? { answerId: message.answerId } : {}),
    ...(message.contentHtml ? { contentHtml: message.contentHtml } : {}),
    ...(message.deepWindowId ? { deepWindowId: message.deepWindowId } : {}),
    ...(message.canOpenDeep !== undefined ? { canOpenDeep: message.canOpenDeep } : {}),
    ...(message.feedbackState ? { feedbackState: message.feedbackState } : {}),
    ...(next.status === "running" && message.role === "assistant" && messageIndex === lastAssistantIndex
      ? { streaming: true }
      : {})
  }));
  if (next.currentResult && next.currentResult.mode === "report") {
    reportResult.value = bridgeResultToView(next.currentResult, reportPrompt.value || reportResult.value?.query || "");
    report.hasError.value = next.currentResult.ok === false;
  } else if (!next.currentResult) {
    reportResult.value = null;
    report.hasError.value = false;
  }
}

function setMode(nextMode: ChatbotMode): void {
  mode.value = nextMode;
  props.session?.setMode(nextMode);
}

async function submitReport(): Promise<void> {
  if (props.session) {
    const query = reportPrompt.value.trim();
    if (!query || reportLoading.value) return;
    reportLoading.value = true;
    report.hasError.value = false;
    chatAbortController = new AbortController();
    try {
      const result = await props.session.submit(query, { signal: chatAbortController.signal });
      reportResult.value = bridgeResultToView(result, query);
      report.hasError.value = !result.ok;
      feedbackRefreshKey.value += 1;
      if (result.ok && !props.deepWindows) closeLocalDeepWindow();
    } finally {
      chatAbortController = null;
      reportLoading.value = false;
    }
    return;
  }
  const result = await report.submit();
  if (result) closeLocalDeepWindow();
}

function openDeep(): void {
  if (!reportResult.value) return;
  const legacyId = reportResult.value.bridgeResult?.deepWindowId;
  if (props.deepWindows && legacyId) {
    props.deepWindows.activate(legacyId);
    return;
  }
  openLocalDeepWindow(reportResult.value);
}

function openChatDeep(): void {
  const id = props.session?.openDeepWindow?.();
  if (id && props.deepWindows) props.deepWindows.activate(id);
}

function openChatAnswer(answerId: string): void {
  const id = props.session?.openChatAnswer?.(answerId) || null;
  if (id && props.deepWindows) props.deepWindows.activate(id);
}

function setMemoryDropHighlight(active: boolean): void {
  memoryDropHighlighted.value = active;
}

function setStarterPrompt(prompt: string): void {
  chatInput.value = prompt;
}

function addReportToMemory(result = reportResult.value): void {
  if (!result) return;
  if (props.session?.addMemory && result.bridgeResult) {
    props.session.addMemory(result.bridgeResult);
    setMode("chat");
    return;
  }
  const item: ChatbotMemoryItem = {
    id: nextId("memory"),
    title: result.category || result.tier || result.intent,
    text: reportText(result),
    result
  };
  memory.value = [...memory.value.filter((entry) => entry.result?.query !== result.query), item].slice(-5);
  if (localDeepWindow.value) localDeepWindow.value = { ...localDeepWindow.value, result };
  setMode("chat");
}

function removeMemory(id: string): void {
  props.session?.removeMemory(id);
  memory.value = memory.value.filter((item) => item.id !== id);
}

function addDeepWindowToMemory(id?: string): void {
  const active = id
    ? displayedDeepWindows.value.find((item) => item.id === id)
    : activeDisplayedDeepWindow.value;
  if (!active) return;
  if (props.deepWindows) {
    props.deepWindows.addToChat(active.id);
    return;
  }
  addReportToMemory(active.result);
}

function activeDeepWindowId(): string | null {
  return activeDisplayedDeepWindow.value?.id || null;
}

function pinDeepWindowById(id: string): void {
  if (props.deepWindows) props.deepWindows.pin(id);
  else pinLocalDeepWindow(id);
}

function moveDeepWindowById(id: string, x: number, y: number): void {
  if (props.deepWindows) props.deepWindows.move(id, x, y);
  else moveLocalDeepWindow(id, x, y);
}

function cloneDeepWindowById(id: string): void {
  if (props.deepWindows) props.deepWindows.clone(id);
  else cloneLocalDeepWindow(id);
}

function toggleDeepWindowOverlayById(id: string): void {
  if (props.deepWindows) props.deepWindows.toggleOverlay(id);
  else toggleLocalDeepWindowOverlay(id);
}

function exportDeepWindowById(id: string): void {
  if (props.deepWindows) props.deepWindows.export(id);
  else exportLocalDeepWindow(id);
}

function cancelDeepWindowById(id: string): void {
  if (props.deepWindows) props.deepWindows.cancel(id);
  else cancelLocalDeepWindow(id);
}

function interactDeepWindowById(id: string, action: LegacyDeepWindowInteraction, value?: string): void {
  props.deepWindows?.interact(id, action, value);
}

function setDeepWindowTrendColumns(id: string, columns: readonly string[]): void {
  props.deepWindows?.setTrendColumns(id, columns);
}

function memoryText(): string {
  return memory.value.map((item) => `[报告上下文] ${item.title}: ${item.text.slice(0, 8000)}`).join("\n---\n");
}

function updateStreamingMessage(id: string, content: string): void {
  chatMessages.value = chatMessages.value.map((message) => message.id === id ? { ...message, content, streaming: true } : message);
}

function appendAssistantMessage(content: string, streaming = false): string {
  const id = nextId("assistant");
  chatMessages.value = [...chatMessages.value, { id, role: "assistant", content, ...(streaming ? { streaming: true } : {}) }];
  return id;
}

async function submitChat(): Promise<void> {
  const prompt = chatInput.value.trim();
  if (!prompt || chatLoading.value) return;
  if (props.session) {
    chatInput.value = "";
    chatError.value = "";
    chatLoading.value = true;
    chatAbortController = new AbortController();
    try {
      const result = await props.session.submit(prompt, {
        signal: chatAbortController.signal,
        onToken: (token) => {
          const previous = chatMessages.value[chatMessages.value.length - 1]?.content || "";
          if (chatMessages.value[chatMessages.value.length - 1]?.role === "assistant") {
            updateStreamingMessage(chatMessages.value[chatMessages.value.length - 1]!.id, previous + token);
          }
        }
      });
      if (!result.ok && result.status !== "stopped") chatError.value = copy.value.reportError;
      if (result.status === "stopped") chatError.value = "";
      chatCurrentResult.value = result.mode === "chat" ? result : null;
      feedbackRefreshKey.value += 1;
    } catch {
      chatError.value = copy.value.reportError;
    } finally {
      chatLoading.value = false;
      chatAbortController = null;
    }
    return;
  }
  const history: ChatbotHistoryMessage[] = chatMessages.value.map(({ role, content }) => ({ role, content }));
  const userId = nextId("user");
  chatMessages.value = [...chatMessages.value, { id: userId, role: "user", content: prompt }];
  chatInput.value = "";
  chatError.value = "";
  chatLoading.value = true;
  chatAbortController = new AbortController();
  const assistantId = appendAssistantMessage("", true);
  const runner = props.runChat || streamChatbotReply;
  const request: ChatbotChatRequest = {
    prompt,
    language: props.language,
    history,
    memoryText: memoryText(),
    signal: chatAbortController.signal
  };
  try {
    const result: ChatbotChatResult = await runner(request, (token) => {
      const previous = chatMessages.value.find((message) => message.id === assistantId)?.content || "";
      updateStreamingMessage(assistantId, previous + token);
    });
    const response = result.response || "";
    chatMessages.value = chatMessages.value.map((message) => message.id === assistantId
      ? { ...message, content: response, streaming: false }
      : message);
    if (result.stopped) {
      chatMessages.value = chatMessages.value.filter((message) => message.id !== userId && message.id !== assistantId);
      return;
    }
    if (!result.ok && !response.trim()) {
      chatMessages.value = chatMessages.value.filter((message) => message.id !== userId && message.id !== assistantId);
      chatError.value = copy.value.reportError;
    } else if (!result.ok) {
      chatMessages.value = chatMessages.value.filter((message) => message.id !== userId && message.id !== assistantId);
      chatError.value = copy.value.reportError;
    }
  } catch {
    chatMessages.value = chatMessages.value.filter((message) => message.id !== userId && message.id !== assistantId);
    chatError.value = copy.value.reportError;
  } finally {
    chatLoading.value = false;
    chatAbortController = null;
  }
}

function stopChat(): void {
  chatAbortController?.abort();
}

onMounted(() => {
  if (props.session) {
    syncSessionState();
    stopSessionSubscription = props.session.onChange(syncSessionState);
  }
  if (props.deepWindows) {
    syncDeepWindowState();
    stopDeepWindowSubscription = props.deepWindows.onChange(syncDeepWindowState);
  }
});

onBeforeUnmount(() => {
  chatAbortController?.abort();
  chatAbortController = null;
  stopSessionSubscription?.();
  stopSessionSubscription = null;
  stopDeepWindowSubscription?.();
  stopDeepWindowSubscription = null;
  clearLocalDeepWindows();
});
</script>

<template>
  <main class="chatbot-modern-page" data-page="chatbot">
    <ChatbotOnboarding
      v-if="session"
      class="chatbot-page-onboarding"
      :language="language"
      :utility="utilityState"
      :available="Boolean(session.startOnboarding)"
      @start="startOnboarding"
    />
    <ChatbotReportView
      v-if="mode === 'report'"
      :language="language"
      :prompt="reportPrompt"
      :result="reportResult"
      :context-title="contextTitle"
      :context-subtitle="contextSubtitle"
      :context-html="contextHtml"
      :loading="reportLoading"
      :error="reportError"
      :auto-focus="autoFocus"
      :feedback="session?.feedback"
      :feedback-refresh-key="feedbackRefreshKey"
      :answer-id="reportAnswerId"
      :feedback-state="reportResult?.bridgeResult?.feedbackState"
      :answer-feedback="reportAnswerFeedback"
      :supplemental-html="supplementalHtml"
      @update:prompt="reportPrompt = $event"
      @submit="submitReport"
      @open-deep="openDeep"
      @open-answer="openChatAnswer"
      @context-interact="interactContext"
      @add-memory="addReportToMemory()"
      @download-overview="downloadOverview"
      @download="downloadRecommendation"
    >
      <template #mode-controls>
        <button
          type="button"
          class="mode-btn mode-deep active"
          data-chatbot-mode-button="report"
          aria-selected="true"
          @click="setMode('report')"
        >
          <span class="mode-indicator"></span>
          <span>{{ copy.report }}</span>
        </button>
        <button
          type="button"
          class="mode-btn mode-fast"
          data-chatbot-mode-button="chat"
          aria-selected="false"
          @click="setMode('chat')"
        >
          <span class="mode-indicator"></span>
           <span>{{ copy.chat }}</span>
         </button>
        <ChatbotUtilityPanels
          v-if="session"
          :language="language"
          :utility="utilityState"
          :logs-available="Boolean(session.downloadLogs)"
          :clear-available="Boolean(session.clearConversation)"
          @help="toggleHelp"
          @guide="toggleGuide"
          @logs="downloadLogs"
          @clear="clearConversation"
        />
        <button v-if="false && session?.toggleHelp" type="button" class="mode-btn mode-help" data-chatbot-action="help" @click="toggleHelp">
          <span class="mode-help-icon">📖</span>
          <span>{{ utilityCopy.help }}</span>
        </button>
        <button v-if="false && session?.toggleGuide" type="button" class="mode-btn mode-user-guide" data-chatbot-action="guide" @click="toggleGuide">
          <span class="mode-help-icon" aria-hidden="true">i</span>
          <span>{{ utilityCopy.guide }}</span>
        </button>
        <div v-if="false && session?.downloadLogs" class="chat-logs-control">
          <details class="chatbot-modern-logs" data-chatbot-logs>
            <summary class="mode-btn mode-logs" data-chatbot-action="logs">
              <span class="mode-logs-icon" aria-hidden="true">↓</span>
              <span>{{ utilityCopy.logs }}</span>
            </summary>
            <div class="chat-logs-menu chatbot-modern-logs-menu">
              <div class="chat-log-group" role="group">
                <span class="chat-log-group-title">{{ utilityCopy.questions }}</span>
                <div class="chat-log-group-actions">
                  <button type="button" data-chatbot-log="questions-csv" @click="downloadLogs('questions', 'csv')">CSV</button>
                  <button type="button" data-chatbot-log="questions-jsonl" @click="downloadLogs('questions', 'jsonl')">JSONL</button>
                </div>
              </div>
              <div class="chat-log-group" role="group">
                <span class="chat-log-group-title">{{ utilityCopy.feedback }}</span>
                <div class="chat-log-group-actions">
                  <button type="button" data-chatbot-log="feedback-csv" @click="downloadLogs('feedback', 'csv')">CSV</button>
                  <button type="button" data-chatbot-log="feedback-jsonl" @click="downloadLogs('feedback', 'jsonl')">JSONL</button>
                </div>
              </div>
            </div>
          </details>
        </div>
      </template>
    </ChatbotReportView>

    <ChatbotChatView
      v-else
      :language="language"
      :messages="chatMessages"
      :context-title="contextTitle"
      :context-subtitle="contextSubtitle"
      :context-html="contextHtml"
      :utility="utilityState"
      :memory="memory"
      :input="chatInput"
      :loading="chatLoading"
      :error="chatError"
      :feedback="session?.feedback"
      :feedback-refresh-key="feedbackRefreshKey"
      :feedback-for-answer="feedbackForAnswer"
      :drop-highlighted="memoryDropHighlighted"
      :supplemental-html="supplementalHtml"
      :starter-cards="starterCards"
      :current-result="chatCurrentResult"
      :open-deep-available="Boolean(session?.openDeepWindow && chatCurrentResult?.ok)"
      @update:input="chatInput = $event"
      @submit="submitChat"
      @stop="stopChat"
      @remove-memory="removeMemory"
      @starter-prompt="setStarterPrompt"
      @open-deep="openChatDeep"
      @open-answer="openChatAnswer"
      @context-interact="interactContext"
      @download="downloadRecommendation"
    >
      <template #mode-controls>
        <button
          type="button"
          class="mode-btn mode-deep"
          data-chatbot-mode-button="report"
          aria-selected="false"
          @click="setMode('report')"
        >
          <span class="mode-indicator"></span>
          <span>{{ copy.report }}</span>
        </button>
        <button
          type="button"
          class="mode-btn mode-fast active"
          data-chatbot-mode-button="chat"
          aria-selected="true"
          @click="setMode('chat')"
        >
          <span class="mode-indicator"></span>
           <span>{{ copy.chat }}</span>
         </button>
        <ChatbotUtilityPanels
          v-if="session"
          :language="language"
          :utility="utilityState"
          :logs-available="Boolean(session.downloadLogs)"
          :clear-available="Boolean(session.clearConversation)"
          @help="toggleHelp"
          @guide="toggleGuide"
          @logs="downloadLogs"
          @clear="clearConversation"
        />
        <button v-if="false && session?.toggleHelp" type="button" class="mode-btn mode-help" data-chatbot-action="help" @click="toggleHelp">
          <span class="mode-help-icon">📖</span>
          <span>{{ utilityCopy.help }}</span>
        </button>
        <button v-if="false && session?.toggleGuide" type="button" class="mode-btn mode-user-guide" data-chatbot-action="guide" @click="toggleGuide">
          <span class="mode-help-icon" aria-hidden="true">i</span>
          <span>{{ utilityCopy.guide }}</span>
        </button>
        <div v-if="false && session?.downloadLogs" class="chat-logs-control">
          <details class="chatbot-modern-logs" data-chatbot-logs>
            <summary class="mode-btn mode-logs" data-chatbot-action="logs">
              <span class="mode-logs-icon" aria-hidden="true">↓</span>
              <span>{{ utilityCopy.logs }}</span>
            </summary>
            <div class="chat-logs-menu chatbot-modern-logs-menu">
              <div class="chat-log-group" role="group">
                <span class="chat-log-group-title">{{ utilityCopy.questions }}</span>
                <div class="chat-log-group-actions">
                  <button type="button" data-chatbot-log="questions-csv" @click="downloadLogs('questions', 'csv')">CSV</button>
                  <button type="button" data-chatbot-log="questions-jsonl" @click="downloadLogs('questions', 'jsonl')">JSONL</button>
                </div>
              </div>
              <div class="chat-log-group" role="group">
                <span class="chat-log-group-title">{{ utilityCopy.feedback }}</span>
                <div class="chat-log-group-actions">
                  <button type="button" data-chatbot-log="feedback-csv" @click="downloadLogs('feedback', 'csv')">CSV</button>
                  <button type="button" data-chatbot-log="feedback-jsonl" @click="downloadLogs('feedback', 'jsonl')">JSONL</button>
                </div>
              </div>
            </div>
          </details>
        </div>
      </template>
    </ChatbotChatView>

    <DeepWindow
      v-for="window in displayedDeepWindows"
      :key="window.id"
      :id="window.id"
      :mode="window.mode"
      :language="language"
      :result="window.result"
      :minimized="window.minimized"
      :pinned="window.pinned"
      :overlay="window.overlay"
      :status="window.status"
      :position="window.position"
      :title="window.title"
      :summary="window.summary"
      :content-html="window.contentHtml"
      :error-message="window.errorMessage"
      :skeleton-steps="window.skeletonSteps"
      :z-index="window.zIndex"
      :can-cancel="window.canCancel"
      :can-add-memory="window.canAddMemory"
      :added-to-memory="window.addedToMemory"
      :can-export="window.canExport"
      :can-minimize="window.canMinimize"
      :can-close="window.canClose"
      :feedback-state="window.feedbackState"
      :feedback="feedbackForDeepWindow(window.id)"
      :absolute-position="Boolean(props.deepWindows)"
      @activate="props.deepWindows ? props.deepWindows.activate(window.id) : undefined"
      @minimize="props.deepWindows ? props.deepWindows.minimize(window.id) : minimizeLocalDeepWindow(window.id)"
      @restore="props.deepWindows ? props.deepWindows.restore(window.id) : restoreLocalDeepWindow(window.id)"
      @close="props.deepWindows ? props.deepWindows.close(window.id) : closeLocalDeepWindow(window.id)"
      @add-memory="addDeepWindowToMemory(window.id)"
      @pin="pinDeepWindowById(window.id)"
      @move="(x, y) => moveDeepWindowById(window.id, x, y)"
      @clone="cloneDeepWindowById(window.id)"
      @overlay="toggleDeepWindowOverlayById(window.id)"
      @export="exportDeepWindowById(window.id)"
      @cancel="cancelDeepWindowById(window.id)"
      @download="downloadRecommendation"
      @trend-interact="(action, value) => interactDeepWindowById(window.id, action, value)"
      @trend-columns="(columns) => setDeepWindowTrendColumns(window.id, columns)"
      @drop-memory="addDeepWindowToMemory(window.id)"
      @drop-highlight="setMemoryDropHighlight"
    />
  </main>
</template>
