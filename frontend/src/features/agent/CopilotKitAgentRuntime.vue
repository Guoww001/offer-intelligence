<script setup lang="ts">
import { useAgent, useCopilotKit } from "@copilotkit/vue/v2";

import type { UiLanguage } from "../../shared/i18n";
import type { AgentResultView } from "../../shared/contracts/agentResult";
import { normalizeAgentResultView, normalizeAgentResultViews } from "../../shared/contracts/agentResult";
import type { AgentMemoryEvent, AgentTimelineStep } from "./agentModel";
import AgentPage, { type AgentRunRequest, type AgentRunResult, type AgentRunner } from "./AgentPage.vue";

defineProps<{
  readonly language: UiLanguage;
  readonly storage?: Storage;
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

function messageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => {
    const value = record(part);
    return typeof value?.text === "string" ? [value.text] : [];
  }).join("\n");
}

const run: AgentRunner = async (request: AgentRunRequest): Promise<AgentRunResult> => {
  const activeAgent = agent.value;
  if (!activeAgent) {
    return { ok: false, status: "error", response: "", steps: [], memoryEvents: [] };
  }
  const messages = [...request.history, { role: "user" as const, content: request.prompt }]
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
      language: request.language,
      memory: text(request.memoryText, 8000)
    }
  });

  let response = "";
  let errorCode = "";
  let stopped = false;
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
      if (!event.delta) return;
      response += event.delta;
      request.onToken?.(event.delta);
    },
    onCustomEvent: ({ event }) => {
      if (event.name === "oi.timeline") {
        const step = timelineStep(event.value);
        if (step) upsertStep(step);
      } else if (event.name === "oi.memory") {
        const next = memoryEvent(event.value);
        if (next) memoryEvents.push(next);
      } else if (event.name === "oi.result_view") {
        upsertResultView(event.value);
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
    if (!response) {
      const assistant = [...activeAgent.messages].reverse().find((message) => message.role === "assistant");
      response = messageContent(assistant?.content);
    }
    return {
      ok: !stopped && !errorCode,
      status: stopped ? "stopped" : errorCode ? "error" : "done",
      response,
      steps,
      memoryEvents,
      resultViews: normalizeAgentResultViews(resultViews),
      ...(errorCode ? { errorCode } : {})
    } as AgentRunResult;
  } catch (error) {
    const aborted = stopped || request.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
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
  }
};
</script>

<template>
  <AgentPage :language="language" :run="run" :storage="storage" :auto-focus="false" />
</template>
