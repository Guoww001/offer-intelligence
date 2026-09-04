<script setup lang="ts">
import { computed } from "vue";
import { CopilotKitProvider, type VueFrontendTool } from "@copilotkit/vue/v2";

import type { UiLanguage } from "../../shared/i18n";
import AgentPage, { type AgentRunner, type AgentRunRequest } from "./AgentPage.vue";
import CopilotKitAgentRuntime from "./CopilotKitAgentRuntime.vue";
import type { AgentSession, AgentToolExecutionResponse, AgentToolName, AgentViewSession } from "./agentSession";

interface AgentToolRunSession {
  readonly language: UiLanguage;
  readonly history: AgentRunRequest["history"];
  readonly bypassPlanning: boolean;
  direct(planningFallback?: { readonly content?: string }): ReturnType<AgentRunner>;
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
  }): ReturnType<AgentRunner>;
  dispose(): void;
}

const props = defineProps<{
  readonly language: UiLanguage;
  readonly endpoint: string;
  readonly enabled: boolean;
  readonly storage?: Storage;
  readonly fallbackRun: AgentRunner;
  readonly fallbackSession?: AgentViewSession;
  readonly toolExecutor: NonNullable<AgentSession["executeTool"]>;
}>();

const toolNames = [
  "merchant_analysis",
  "category_analysis",
  "merchant_comparison",
  "tier_analysis",
  "category_comparison",
  "payment_status",
  "trend"
] as const;

let toolSession: AgentToolRunSession | undefined;
function beginRun(request: AgentRunRequest): AgentToolRunSession {
  toolSession?.dispose();
  const memoryEvents: NonNullable<Awaited<ReturnType<AgentRunner>>["memoryEvents"]>[number][] = [];
  const resultViews: NonNullable<Awaited<ReturnType<AgentRunner>>["resultViews"]>[number][] = [];
  const session: AgentToolRunSession = {
    language: request.language,
    history: request.history,
    bypassPlanning: false,
    direct: () => props.fallbackRun(request),
    async execute(toolRequest) {
      const result = await props.toolExecutor({
        callId: toolRequest.callId,
        toolName: toolRequest.toolName as AgentToolName,
        arguments: toolRequest.arguments,
        prompt: request.prompt,
        signal: toolRequest.signal || request.signal
      });
      if (result.memoryEvent) memoryEvents.push(result.memoryEvent);
      if (result.resultView) {
        resultViews.push(result.resultView);
        request.onResultView?.(result.resultView);
      }
      return result;
    },
    async complete(response, options) {
      if (options.synthesisFailed) {
        const fallback = await props.fallbackRun(request);
        return { ...fallback, fallbackDelivered: fallback.ok };
      }
      return {
        ok: Boolean(response.trim()),
        status: response.trim() ? "done" : "error",
        response,
        steps: [],
        partial: options.partial,
        omittedTargets: options.omittedTargets,
        memoryEvents,
        resultViews
      };
    },
    dispose() {
      if (toolSession === session) toolSession = undefined;
    }
  };
  toolSession = session;
  return session;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => {
    if (!part || typeof part !== "object") return [];
    const value = part as Record<string, unknown>;
    return typeof value.text === "string" ? [value.text] : [];
  }).join("\n");
}

const frontendTools = computed<VueFrontendTool[]>(() => toolNames.map((toolName) => ({
  name: toolName,
  agentId: "default",
  followUp: true,
  handler: async (args, context) => {
    const session = toolSession;
    if (session) {
      const { toolResult } = await session.execute({ callId: context.toolCall.id, toolName, arguments: args, signal: context.signal });
      // Charts/full UI rows stay local. Only the bounded proof-bound result
      // travels back to Python, preserving the synthesis request size budget.
      return { toolResult };
    }
    const prompt = [...context.agent.messages].reverse().find((message) => message.role === "user");
    return props.toolExecutor({
      callId: context.toolCall.id,
      toolName,
      arguments: args,
      prompt: messageText(prompt?.content),
      signal: context.signal || new AbortController().signal
    });
  }
})));
</script>

<template>
  <CopilotKitProvider
    v-if="enabled"
    :runtime-url="endpoint"
    credentials="same-origin"
    :use-single-endpoint="false"
    :frontend-tools="frontendTools"
    :default-throttle-ms="40"
    :enable-inspector="false"
    :debug="false"
  >
    <CopilotKitAgentRuntime :language="language" :storage="storage" :begin-run="beginRun" />
  </CopilotKitProvider>
  <AgentPage
    v-else
    :language="language"
    :run="fallbackRun"
    :session="fallbackSession"
    :storage="storage"
    :auto-focus="false"
  />
</template>
