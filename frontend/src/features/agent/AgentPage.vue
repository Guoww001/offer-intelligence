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
  createAgentRunLifecycleState,
  reduceAgentRun,
  type AgentRunLifecycleEvent,
  type AgentRunLifecycleState
} from "./agentRunReducer";
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
  readonly ok: boolean;
  readonly status: Exclude<AgentRunStatus, "idle" | "running">;
  readonly response: string;
  readonly steps: readonly unknown[];
  readonly partial?: boolean;
  readonly omittedTargets?: readonly string[];
  readonly resultViews?: readonly AgentResultViewModel[];
  readonly memoryEvents?: readonly AgentMemoryEvent[];
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
const runLifecycle = ref<AgentRunLifecycleState>(createAgentRunLifecycleState());
const memory = ref<AgentMemoryState>(emptyAgentMemory());
const error = ref("");
const feedbackRefreshKey = ref(0);
const inputRef = ref<HTMLTextAreaElement | null>(null);
let abortController: AbortController | null = null;
let stopSessionSubscription: (() => void) | null = null;
let idCounter = 0;

function dispatchLifecycle(event: AgentRunLifecycleEvent): void {
  const next = reduceAgentRun(runLifecycle.value, event);
  runLifecycle.value = next;
  runStatus.value = next.status;
  timeline.value = [...next.steps];
  response.value = next.response;
  partial.value = next.partial;
  omittedTargets.value = [...next.omittedTargets];
}

function dispatchTimelineStep(step: AgentTimelineStep): void {
  const phase = step.phase === "planning"
    ? (/replan|重新规划|修正查询/i.test(`${step.label} ${step.detail || ""}`) ? "replan" : "planning")
    : step.phase === "synthesis" ? "synthesis" : "tools";
  dispatchLifecycle({ type: "PHASE_STARTED", phase, step });
}

function upsertResultView(view: unknown): void {
  const normalized = normalizeAgentResultViews([view])[0];
  if (!normalized) return;
  const index = resultViews.value.findIndex((item) => item.id === normalized.id);
  resultViews.value = index < 0
    ? [...resultViews.value, normalized].slice(0, 8)
    : resultViews.value.map((item, itemIndex) => itemIndex === index ? normalized : item);
}

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

function syncSessionState(next: LegacyAgentViewState = props.session!.getState()): void {
  dispatchLifecycle({
    type: "STATE_SYNC",
    state: {
      status: next.status,
      steps: next.steps.map(normalizeAgentTimelineStep),
      response: next.response || "",
      partial: next.partial,
      omittedTargets: next.omittedTargets.slice(0, 20),
      errorCode: next.errorCode || null
    }
  });
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
    error.value = "";
    resultViews.value = [];
    dispatchLifecycle({ type: "RUN_STARTED" });
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
          dispatchLifecycle({ type: "TOKEN", token });
        },
        onResultView: (view) => {
          upsertResultView(view);
        },
        onTimeline: (step) => {
          const normalized = normalizeAgentTimelineStep(step);
          dispatchTimelineStep(normalized);
        }
      });
      if (result.resultViews?.length) resultViews.value = normalizeAgentResultViews(result.resultViews);
      if (result.status === "error" && !result.response) error.value = copy.value.failed;
      feedbackRefreshKey.value += 1;
      syncSessionState();
    } catch (caught) {
      const stopped = abortController.signal.aborted || (caught instanceof DOMException && caught.name === "AbortError");
      dispatchLifecycle(stopped
        ? { type: "RUN_STOPPED", response: copy.value.stopped }
        : { type: "RUN_ERROR", errorCode: "agent_runtime_error" });
      if (!stopped) error.value = copy.value.failed;
    } finally {
      abortController = null;
      if (runLifecycle.value.status === "running") dispatchLifecycle({ type: "RUN_ERROR", errorCode: "agent_runtime_error" });
      inputRef.value?.focus();
    }
    return;
  }
  const currentHistory = history();
  const userId = nextId("user");
  messages.value = [...messages.value, { id: userId, role: "user", content: prompt }];
  input.value = "";
  error.value = "";
  resultViews.value = [];
  dispatchLifecycle({ type: "RUN_STARTED" });
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
      onToken: (token) => dispatchLifecycle({ type: "TOKEN", token }),
      onTimeline: (step) => dispatchTimelineStep(normalizeAgentTimelineStep(step)),
      onResultView: (view) => upsertResultView(view)
    });
    const normalizedSteps = result.steps.map(normalizeAgentTimelineStep);
    if (result.resultViews?.length) resultViews.value = normalizeAgentResultViews(result.resultViews);
    if (result.status === "done") {
      dispatchLifecycle({
        type: "RUN_FINISHED",
        response: result.response || "",
        steps: normalizedSteps,
        partial: result.partial,
        omittedTargets: result.omittedTargets
      });
    } else if (result.status === "stopped") {
      dispatchLifecycle({ type: "RUN_STOPPED", response: result.response || copy.value.stopped });
    } else {
      dispatchLifecycle({ type: "RUN_ERROR", response: result.response || "", errorCode: "agent_runtime_error" });
    }
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
    dispatchLifecycle(stopped
      ? { type: "RUN_STOPPED", response: copy.value.stopped }
      : { type: "RUN_ERROR", errorCode: "agent_runtime_error" });
    if (!stopped) error.value = copy.value.failed;
  } finally {
    abortController = null;
    if (runLifecycle.value.status === "running") dispatchLifecycle({ type: "RUN_ERROR", errorCode: "agent_runtime_error" });
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
    resultViews.value = [];
    feedbackRefreshKey.value += 1;
    syncSessionState();
    nextTick(() => inputRef.value?.focus());
    return;
  }
  messages.value = [];
  dispatchLifecycle({ type: "RESET" });
  resultViews.value = [];
  error.value = "";
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
  <main class="oi-modern-page agent-modern-page" data-page="agent">
    <header class="agent-modern-header">
      <div class="agent-modern-heading">
        <span class="agent-modern-eyebrow">{{ copy.eyebrow }}</span>
        <h1>{{ copy.title }}</h1>
        <p>{{ copy.subtitle }}</p>
      </div>
      <div class="agent-modern-header-actions">
        <span class="agent-modern-readonly"><span aria-hidden="true"></span>{{ copy.readOnly }}</span>
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
        <button type="button" data-agent-action="new" :disabled="runStatus === 'running'" @click="newConversation">{{ copy.newConversation }}</button>
      </div>
    </header>

    <section class="agent-modern-workspace">
      <aside class="agent-modern-rail">
        <span class="agent-modern-rail-label">CAPABILITIES</span>
        <strong>01 / DATA AGENT</strong>
        <p>{{ copy.subtitle }}</p>
        <div class="agent-modern-capabilities">
          <span>01 <b>Merchant analysis</b></span>
          <span>02 <b>Category and tier</b></span>
          <span>03 <b>Comparisons</b></span>
          <span>04 <b>Payments and trends</b></span>
        </div>
      </aside>

      <section class="agent-modern-chat" aria-label="Chat Agent chat">
        <div v-if="!messages.length" class="agent-modern-welcome" data-agent-welcome>
          <span class="agent-modern-welcome-mark" aria-hidden="true">Y</span>
          <span class="agent-modern-eyebrow">{{ copy.welcomeKicker }}</span>
          <h2>{{ copy.welcomeTitle }}</h2>
          <p>{{ copy.welcomeBody }}</p>
          <p v-if="copy.restored" class="agent-modern-restored" role="status">{{ copy.restored }}</p>
          <button type="button" data-agent-action="example" @click="handleExample">↗ <span>{{ copy.example }}</span></button>
        </div>

        <div v-else class="agent-modern-message-list" aria-live="polite">
          <article v-for="message in messages" :key="message.id" class="agent-modern-message" :class="`is-${message.role}`">
            <span>{{ message.role === "user" ? "YOU" : "AGENT" }}</span>
            <div
              v-if="message.role === 'assistant'"
              class="agent-modern-message-content"
              data-agent-response
              v-html="renderAssistant(message.content)"
            ></div>
            <p v-else>{{ message.content }}</p>
          </article>
        </div>

        <p
          v-if="runStatus === 'running' && response"
          class="agent-modern-streaming"
          data-agent-streaming-response
          aria-live="polite"
        >{{ response }}</p>

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
          :phase="runLifecycle.phase"
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
        <form class="agent-modern-composer" data-agent-form @submit.prevent="submit">
          <textarea ref="inputRef" v-model="input" :placeholder="copy.placeholder" rows="1" :disabled="runStatus === 'running'" data-agent-input></textarea>
          <button v-if="runStatus === 'running'" type="button" data-agent-action="stop" @click="stop">{{ copy.stop }}</button>
          <button v-else type="submit" data-agent-action="send">{{ copy.send }}</button>
        </form>
      </section>
    </section>
  </main>
</template>
