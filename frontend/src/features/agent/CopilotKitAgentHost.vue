<script setup lang="ts">
import { computed } from "vue";
import { CopilotKitProvider, type VueFrontendTool } from "@copilotkit/vue/v2";

import type { UiLanguage } from "../../shared/i18n";
import type { LegacyAgentSessionBridge, LegacyAgentToolSession } from "../../legacy/contracts";
import AgentPage, { type AgentRunner, type AgentRunRequest } from "./AgentPage.vue";
import CopilotKitAgentRuntime from "./CopilotKitAgentRuntime.vue";

const props = defineProps<{
  readonly language: UiLanguage;
  readonly endpoint: string;
  readonly enabled: boolean;
  readonly storage?: Storage;
  readonly fallbackRun: AgentRunner;
  readonly fallbackSession?: LegacyAgentSessionBridge;
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

let toolSession: LegacyAgentToolSession | undefined;
function beginRun(request: AgentRunRequest): LegacyAgentToolSession {
  toolSession?.dispose();
  const session = window.OI_LEGACY_BRIDGE?.createAgentToolSession?.(request);
  if (!session) throw new Error("Legacy Agent behavior bridge is unavailable");
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
    const bridge = window.OI_LEGACY_BRIDGE?.executeAgentTool;
    if (!bridge) {
      return {
        toolResult: {
          callId: context.toolCall.id,
          toolName,
          arguments: args,
          result: {
            ok: false,
            source: { dataSource: "unavailable", dataAsOf: null, estimated: false },
            errorCode: "tool_error"
          }
        }
      };
    }
    return bridge({
      callId: context.toolCall.id,
      toolName,
      arguments: args,
      prompt: messageText(prompt?.content),
      signal: context.signal
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
