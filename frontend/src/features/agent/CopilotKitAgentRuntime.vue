<script setup lang="ts">
import { useAgent, useCopilotKit } from "@copilotkit/vue/v2";

import type { UiLanguage } from "../../shared/i18n";
import type { AgentToolExecutionResponse } from "./agentSession";
import type { AgentResultView } from "../../shared/contracts/agentResult";
import { normalizeAgentResultView, normalizeAgentResultViews } from "../../shared/contracts/agentResult";
import type { AgentMemoryEvent, AgentTimelineStep } from "./agentModel";
import { normalizeAgentTimelineStep } from "./agentModel";
import AgentPage, { type AgentRunRequest, type AgentRunResult, type AgentRunner } from "./AgentPage.vue";

interface AgentToolRunSession {
  readonly language: UiLanguage;
  readonly history: AgentRunRequest["history"];
  readonly bypassPlanning: boolean;
  direct(planningFallback?: { readonly content?: string }): Promise<AgentRunResult>;
  execute(request: {
    readonly callId: string;
    readonly toolName: string;
    readonly arguments: Record<string, unknown>;
    readonly signal?: AbortSignal;
  }): Promise<AgentToolExecutionResponse>;
  complete(response: string, options: {
    readonly synthesisFailed: boolean;
    readonly partial: boolean;
    readonly omittedTargets: readonly string[];
  }): Promise<AgentRunResult & { readonly fallbackDelivered?: boolean }>;
  dispose(): void;
}

const props = defineProps<{
  readonly language: UiLanguage;
  readonly storage?: Storage;
  readonly beginRun: (request: AgentRunRequest) => AgentToolRunSession;
}>();

const { agent } = useAgent({ agentId: "default", throttleMs: 40 });
const { copilotkit } = useCopilotKit();

function text(value: unknown, maximum: number): string {
  return String(value ?? "").trim().slice(0, maximum);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function timelineStep(value: unknown): AgentTimelineStep | null {
  const outer = record(value);
  const raw = record(outer?.step || outer);
  if (!raw) return null;
  const phase = raw.phase === "planning" || raw.phase === "synthesis" ? raw.phase : "tool";
  const status = ["running", "done", "error", "stopped", "timeout"].includes(String(raw.status))
    ? raw.status as AgentTimelineStep["status"] : "running";
  return {
    ...normalizeAgentTimelineStep(raw),
    id: text(raw.id, 128) || `step-${Date.now()}`,
    phase,
    status,
    label: text(raw.label, 160) || "Agent",
    ...(text(raw.detail, 320) ? { detail: text(raw.detail, 320) } : {})
  };
}

function memoryEvent(value: unknown): AgentMemoryEvent | null {
  const raw = record(value);
  if (!raw || (raw.kind !== "tool_success" && raw.kind !== "candidates")) return null;
  return raw as unknown as AgentMemoryEvent;
}

const run: AgentRunner = async (request: AgentRunRequest): Promise<AgentRunResult> => {
  if (request.signal.aborted) return { ok: false, status: "stopped", response: "", steps: [] };
  const session = props.beginRun({ ...request, onResultView: (view) => upsertResultView(view) });
  if (session.bypassPlanning) {
    try {
      const direct = await session.direct();
      return { ...direct, steps: [], memoryEvents: [] };
    }
    finally { session.dispose(); }
  }
  const activeAgent = agent.value;
  if (!activeAgent) {
    session.dispose();
    return { ok: false, status: "error", response: "", steps: [], memoryEvents: [] };
  }
  const messages = [...session.history, { role: "user" as const, content: request.prompt }]
    .slice(-40)
    .map((message, index) => ({
      id: `oi-${Date.now()}-${index}`,
      role: message.role,
      content: text(message.content, 12_000)
    }));
  activeAgent.setMessages(messages);
  activeAgent.setState({
    offerIntelligence: {
      version: 1,
      status: "planning",
      language: session.language,
      memory: text(request.memoryText, 8000),
      history: session.history,
      legacyParity: true
    }
  });

  let response = "";
  let errorCode = "";
  let stopped = false;
  let synthesisStarted = false;
  let planningFallback: { content?: string } | undefined;
  let partial = false;
  let omittedTargets: string[] = [];
  const steps: AgentTimelineStep[] = [];
  const memoryEvents: AgentMemoryEvent[] = [];
  const resultViews: AgentResultView[] = [];
  const upsertStep = (step: AgentTimelineStep) => {
    const index = steps.findIndex((item) => item.id === step.id);
    if (index < 0) steps.push(step);
    else steps[index] = step;
    request.onTimeline?.(step);
  };
  const upsertResultView = (value: unknown) => {
    const view = normalizeAgentResultView(value);
    if (!view) return;
    const index = resultViews.findIndex((item) => item.id === view.id);
    if (index < 0 && resultViews.length < 8) resultViews.push(view);
    else if (index >= 0) resultViews[index] = view;
    request.onResultView?.(view);
  };
  const subscription = activeAgent.subscribe({
    onTextMessageContentEvent: ({ event }) => {
      if (!event.delta || request.signal.aborted) return;
      response += event.delta;
      request.onToken?.(event.delta);
    },
    onCustomEvent: ({ event }) => {
      if (request.signal.aborted) return;
      if (event.name === "oi.timeline") {
        const step = timelineStep(event.value);
        if (step) {
          if (step.phase === "synthesis") synthesisStarted = true;
          upsertStep(step);
        }
      } else if (event.name === "oi.memory") {
        const next = memoryEvent(event.value);
        if (next) memoryEvents.push(next);
      } else if (event.name === "oi.result_view") {
        upsertResultView(event.value);
      } else if (event.name === "oi.planning_fallback") {
        planningFallback = { content: text(record(event.value)?.content, 8000) };
      } else if (event.name === "oi.execution") {
        const meta = record(event.value);
        partial = meta?.partial === true;
        omittedTargets = Array.isArray(meta?.omittedTargets) ? meta.omittedTargets.map(String).slice(0, 20) : [];
      }
    },
    onRunErrorEvent: ({ event }) => {
      errorCode = text(event.code, 80) || "copilotkit_runtime_error";
    }
  });
  const stop = () => {
    stopped = true;
    copilotkit.value.stopAgent({ agent: activeAgent });
  };
  request.signal.addEventListener("abort", stop, { once: true });
  try {
    await copilotkit.value.runAgent({ agent: activeAgent });
    if (planningFallback && !stopped && !errorCode) {
      const direct = await session.direct(planningFallback);
      return { ...direct, steps,
        memoryEvents: (direct.memoryEvents || []).map(memoryEvent).filter((item): item is AgentMemoryEvent => item !== null) };
    }
    const completed = !stopped && (!errorCode || synthesisStarted)
      ? await session.complete(response, { synthesisFailed: Boolean(errorCode) || !response.trim(), partial, omittedTargets })
      : null;
    if (completed?.fallbackDelivered) errorCode = "";
    return {
      ok: !stopped && !errorCode && Boolean((completed?.response || response).trim()),
      status: stopped ? "stopped" : errorCode || !(completed?.response || response).trim() ? "error" : "done",
      response: completed?.response || response,
      steps,
      partial,
      omittedTargets,
      memoryEvents: completed ? (completed.memoryEvents || []).map(memoryEvent).filter((item): item is AgentMemoryEvent => item !== null) : memoryEvents,
      resultViews: normalizeAgentResultViews(completed?.resultViews || resultViews),
      ...(errorCode ? { errorCode } : {})
    } as AgentRunResult;
  } catch (error) {
    const aborted = stopped || request.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
    if (!aborted && !errorCode && !synthesisStarted && !steps.some((step) => step.phase === "tool")) {
      const direct = await session.direct({});
      return { ...direct, steps,
        memoryEvents: (direct.memoryEvents || []).map(memoryEvent).filter((item): item is AgentMemoryEvent => item !== null) };
    }
    if (!aborted && synthesisStarted) {
      const completed = await session.complete(response, { synthesisFailed: true, partial, omittedTargets });
      if (completed.fallbackDelivered) return { ...completed, ok: true, status: "done", steps,
        memoryEvents: (completed.memoryEvents || []).map(memoryEvent).filter((item): item is AgentMemoryEvent => item !== null) };
    }
    return {
      ok: false,
      status: aborted ? "stopped" : "error",
      response,
      steps,
      memoryEvents,
      resultViews: normalizeAgentResultViews(resultViews),
      ...(!aborted ? { errorCode: errorCode || "copilotkit_runtime_error" } : {})
    } as AgentRunResult;
  } finally {
    request.signal.removeEventListener("abort", stop);
    subscription.unsubscribe();
    session.dispose();
  }
};
</script>

<template>
  <AgentPage :language="language" :run="run" :storage="storage" :auto-focus="false" />
</template>
