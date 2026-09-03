<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";

import type { UiLanguage } from "../../shared/i18n";
import type { LegacyAgentSessionBridge, LegacyAgentViewState } from "../../legacy/contracts";
import { renderMarkdownToHtml } from "../../shared/markdown/markdown";
import type { AgentResultView as AgentResultViewModel } from "../../shared/contracts/agentResult";
import { normalizeAgentResultViews } from "../../shared/contracts/agentResult";
import FeedbackForm from "../chatbot/FeedbackForm.vue";
import AgentTimeline from "./AgentTimeline.vue";
import AgentResultView from "./AgentResultView.vue";
import {
  agentMemoryDisplayText,
  agentMemoryPromptText,
  applyAgentMemoryEvents,
  clearAgentMemory,
  createAgentRunState,
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
const messages = ref<Array<{ readonly id: string; readonly role: "user" | "assistant"; readonly content: string }>>([]);
const timeline = ref<AgentTimelineStep[]>([]);
const runStatus = ref<AgentRunStatus>("idle");
const response = ref("");
const partial = ref(false);
const omittedTargets = ref<string[]>([]);
const resultViews = ref<AgentResultViewModel[]>([]);
const memory = ref<AgentMemoryState>(emptyAgentMemory());
const error = ref("");
const feedbackRefreshKey = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);
let abortController: AbortController | null = null;
let stopSessionSubscription: (() => void) | null = null;
let idCounter = 0;

const copy = computed(() => props.language === "zh" ? {
  eyebrow: "DASHBOARD / AGENT",
  title: "Chat Agent",
  subtitle: "让 Agent 规划查询、调用只读工具，并解释真实返回的数据。",
  readOnly: "只读数据工作区",
  newConversation: "新对话",
  stop: "停止",
  placeholder: "询问商户、品类、Tier、付款或趋势…",
  send: "发送",
  welcomeKicker: "从一个数据问题开始",
  welcomeTitle: "你想查询什么？",
  welcomeBody: "可以询问商户分析、品类对比、付款状态或多月趋势。",
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
  failed: "Agent 暂时不可用，请稍后重试。"
} : {
  eyebrow: "DASHBOARD / AGENT",
  title: "Chat Agent",
  subtitle: "Plan lookups, run read-only tools, and explain returned data.",
  readOnly: "Read-only data workspace",
  newConversation: "New conversation",
  stop: "Stop",
  placeholder: "Ask about merchants, categories, tiers, payments, or trends…",
  send: "Send",
  welcomeKicker: "START WITH A DATA QUESTION",
  welcomeTitle: "What would you like to query?",
  welcomeBody: "Ask for a merchant analysis, category comparison, payment status, or a multi-month trend.",
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
  failed: "The Agent is temporarily unavailable. Please try again."
});

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
  props.session?.downloadLogs?.(kind, format);
}

function upsertResultView(view: unknown): void {
  const normalized = normalizeAgentResultViews([view])[0];
  if (!normalized) return;
  const index = resultViews.value.findIndex((item) => item.id === normalized.id);
  resultViews.value = index < 0
    ? [...resultViews.value, normalized].slice(0, 8)
    : resultViews.value.map((item, itemIndex) => itemIndex === index ? normalized : item);
}

function syncSessionState(next: LegacyAgentViewState = props.session!.getState()): void {
  runStatus.value = next.status;
  timeline.value = next.steps.map(normalizeAgentTimelineStep);
  response.value = next.response || "";
  partial.value = next.partial;
  omittedTargets.value = next.omittedTargets.slice(0, 20);
  if (Array.isArray(next.resultViews)) resultViews.value = normalizeAgentResultViews(next.resultViews);
  error.value = next.status === "error" ? copy.value.failed : "";
  const sessionMessages = next.messages || next.history;
  messages.value = sessionMessages.map((message, index) => ({
    id: `session-${index}-${message.role}`,
    role: message.role,
    content: message.content
  }));
  if (next.memory && typeof next.memory === "object") memory.value = normalizeAgentMemory(next.memory);
}

function handleExample(): void {
  input.value = copy.value.example;
  nextTick(() => inputRef.value?.focus());
}

async function submit(): Promise<void> {
  if (runStatus.value === "running") {
    abortController?.abort();
    return;
  }
  const prompt = input.value.trim();
  if (!prompt) return;
  if (props.session) {
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
        prompt,
        language: props.language,
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
      inputRef.value?.focus();
    }
    return;
  }
  const currentHistory = history();
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
  try {
    const result = await props.run({
      prompt,
      language: props.language,
      history: currentHistory,
      memory: memory.value,
      memoryText: agentMemoryPromptText(memory.value, props.language),
      signal: abortController.signal,
      onToken: (token) => { response.value += token; },
      onTimeline: (step) => {
        const normalized = normalizeAgentTimelineStep(step);
        const existing = timeline.value.findIndex((item) => item.id === normalized.id);
        if (existing >= 0) timeline.value[existing] = normalized;
        else timeline.value = [...timeline.value, normalized];
      },
      onResultView: upsertResultView
    });
    timeline.value = result.steps.map(normalizeAgentTimelineStep);
    partial.value = result.partial === true;
    omittedTargets.value = (result.omittedTargets || []).map(String).filter(Boolean).slice(0, 20);
    runStatus.value = result.status;
    response.value = result.response || (result.status === "stopped" ? copy.value.stopped : "");
    if (result.resultViews?.length) resultViews.value = normalizeAgentResultViews(result.resultViews);
    if (result.status === "done" && result.ok && result.response) {
      messages.value = [...messages.value, { id: nextId("assistant"), role: "assistant", content: result.response }];
    }
    if (result.status !== "done" || !result.ok) {
      messages.value = messages.value.filter((message) => message.id !== userId);
    }
    if (result.status === "done" && result.ok && result.memoryEvents?.length) {
      memory.value = applyAgentMemoryEvents(memory.value, result.memoryEvents, Date.now());
      saveAgentMemory(props.storage, memory.value);
    }
    if (result.status === "error" && !response.value) error.value = copy.value.failed;
    feedbackRefreshKey.value += 1;
  } catch (caught) {
    const stopped = abortController.signal.aborted || (caught instanceof DOMException && caught.name === "AbortError");
    runStatus.value = stopped ? "stopped" : "error";
    response.value = stopped ? copy.value.stopped : "";
    if (!stopped) error.value = copy.value.failed;
  } finally {
    abortController = null;
    if (runStatus.value === "running") runStatus.value = "error";
    inputRef.value?.focus();
  }
}

function stop(): void {
  if (props.session) props.session.stop();
  abortController?.abort();
}

function newConversation(): void {
  if (runStatus.value === "running") return;
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

onMounted(() => {
  if (props.session) {
    syncSessionState();
    stopSessionSubscription = props.session.onChange(syncSessionState);
  } else {
    memory.value = loadAgentMemory(props.storage);
  }
  if (props.autoFocus) inputRef.value?.focus();
});

onBeforeUnmount(() => {
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
  <main class="agent-modern-page" data-page="agent">
    <header class="agent-page-header">
      <div class="agent-page-heading">
        <div class="agent-page-title-row">
          <span class="agent-page-title-mark" aria-hidden="true"><span></span></span>
          <div>
            <span class="agent-page-kicker">{{ copy.eyebrow }}</span>
            <h2>{{ copy.title }}</h2>
          </div>
          <span class="agent-page-status-chip">
            <span class="agent-page-status-dot" aria-hidden="true"></span>
            <span>{{ copy.readOnly }}</span>
          </span>
        </div>
        <p>{{ copy.subtitle }}</p>
      </div>
      <div class="agent-page-actions">
        <details v-if="session?.downloadLogs" class="agent-modern-logs" data-agent-logs>
          <summary data-agent-action="logs">Logs</summary>
          <div class="agent-modern-logs-menu">
            <span>Questions</span>
            <button type="button" data-agent-log="questions-csv" @click="downloadLogs('questions', 'csv')">CSV</button>
            <button type="button" data-agent-log="questions-jsonl" @click="downloadLogs('questions', 'jsonl')">JSONL</button>
            <span>Feedback</span>
            <button type="button" data-agent-log="feedback-csv" @click="downloadLogs('feedback', 'csv')">CSV</button>
            <button type="button" data-agent-log="feedback-jsonl" @click="downloadLogs('feedback', 'jsonl')">JSONL</button>
          </div>
        </details>
        <button class="secondary-button agent-new-button" type="button" data-agent-action="new" :disabled="runStatus === 'running'" @click="newConversation">{{ copy.newConversation }}</button>
        <button v-if="runStatus === 'running'" class="secondary-button agent-stop-button" type="button" data-agent-action="stop" @click="stop">{{ copy.stop }}</button>
      </div>
    </header>

    <section class="agent-page-layout">
      <aside class="agent-page-rail panel" :aria-label="copy.capabilities">
        <span class="agent-page-rail-eyebrow">{{ copy.capabilities }}</span>
        <div class="agent-page-rail-heading">
          <span class="agent-page-rail-index">01</span>
          <div>
            <strong>{{ copy.dataAgent }}</strong>
            <p>{{ copy.subtitle }}</p>
          </div>
        </div>
        <div class="agent-capability-list">
          <div class="agent-capability-item"><span>01</span><strong>{{ copy.merchantAnalysis }}</strong></div>
          <div class="agent-capability-item"><span>02</span><strong>{{ copy.categoryTier }}</strong></div>
          <div class="agent-capability-item"><span>03</span><strong>{{ copy.comparisons }}</strong></div>
          <div class="agent-capability-item"><span>04</span><strong>{{ copy.paymentTrends }}</strong></div>
        </div>
        <p class="agent-page-rail-note">{{ copy.railNote }}</p>
      </aside>

      <section class="chat-panel agent-page-chat-panel" data-agent-surface="workspace" aria-label="Chat Agent chat">
        <div class="agent-chat-context" aria-label="Agent workspace context">
          <span class="agent-chat-context-mark" aria-hidden="true"></span>
          <span>{{ copy.readOnly }}</span>
        </div>
        <div
          class="chat-log agent-chat-log"
          :class="{ 'agent-chat-log-has-messages': messages.length || runStatus !== 'idle' }"
          aria-live="polite"
        >
          <div v-if="!messages.length && runStatus === 'idle'" class="agent-page-welcome" data-agent-welcome>
            <span class="agent-page-welcome-logo" role="img" aria-label="YeahPromos">
              <span class="agent-page-welcome-logo-wordmark"><span class="agent-page-welcome-logo-base">YEAH</span><span class="agent-page-welcome-logo-accent">P</span><span class="agent-page-welcome-logo-tail">ROMOS</span></span>
            </span>
            <div>
              <span class="agent-page-welcome-kicker">{{ copy.welcomeKicker }}</span>
              <h3>{{ copy.welcomeTitle }}</h3>
              <p>{{ copy.welcomeBody }}</p>
              <p v-if="copy.restored" class="agent-page-memory-status" role="status">{{ copy.restored }}</p>
              <button class="agent-example-prompt" type="button" data-agent-action="example" @click="handleExample">
                <span class="agent-example-prompt-icon" aria-hidden="true">↗</span>
                <span class="agent-example-prompt-content">
                  <span class="agent-example-prompt-label">{{ copy.exampleLabel }}</span>
                  <span class="agent-example-prompt-text">{{ copy.example }}</span>
                </span>
                <span class="agent-example-prompt-arrow" aria-hidden="true">→</span>
              </button>
            </div>
          </div>

          <article v-for="message in messages" :key="message.id" class="message" :class="message.role">
            <div
              v-if="message.role === 'assistant'"
              class="chat-stream-text"
              data-agent-response
              v-html="renderAssistant(message.content)"
            ></div>
            <div v-else class="chat-stream-text"><p>{{ message.content }}</p></div>
          </article>

          <article
            v-if="runStatus === 'running' && response"
            class="message assistant"
            data-agent-streaming-response
            aria-live="polite"
          >
            <div class="chat-stream-text" v-html="renderAssistant(response)"></div>
          </article>

          <section v-if="resultViews.length" class="agent-modern-results" aria-label="Structured tool results">
            <AgentResultView
              v-for="view in resultViews"
              :key="view.id"
              :language="language"
              :view="view"
            />
          </section>

          <AgentTimeline
            v-if="timeline.length || runStatus !== 'idle'"
            :language="language"
            :status="runStatus"
            :steps="timeline"
            :partial="partial"
            :omitted-targets="omittedTargets"
          />

          <FeedbackForm
            :language="language"
            :feedback="session?.feedback"
            :refresh-key="feedbackRefreshKey"
          />

          <p v-if="error" class="agent-modern-error" role="alert">{{ error }}</p>
        </div>
        <form class="chat-input agent-page-input" data-agent-form @submit.prevent="submit">
          <div class="chat-input-field">
            <input ref="inputRef" v-model="input" autocomplete="off" :placeholder="copy.placeholder" :disabled="runStatus === 'running'" data-agent-input />
          </div>
          <button type="submit" data-agent-action="send" :disabled="runStatus === 'running'">
            <span class="agent-send-label">{{ copy.send }}</span>
            <span class="agent-send-icon" aria-hidden="true">↑</span>
          </button>
        </form>
      </section>
    </section>
  </main>
</template>
