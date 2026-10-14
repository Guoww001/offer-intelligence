<script setup lang="ts">
import { computed } from "vue";
import { CopilotKitProvider, type VueFrontendTool } from "@copilotkit/vue/v2";

import type { UiLanguage } from "../../shared/i18n";
import AgentPage, { type AgentRunner, type AgentRunRequest } from "./AgentPage.vue";
import CopilotKitAgentRuntime from "./CopilotKitAgentRuntime.vue";
import { isKeywordDataQuestion, keywordMissingDataResponse, type AgentSession, type AgentToolExecutionRequest, type AgentToolExecutionResponse, type AgentToolName, type AgentViewSession } from "./agentSession";
import type { ReusableAgentResult } from "./agentResultReuse";
import type { AgentAttachmentStore } from "./agentAttachment";
import { readMerchantWorkbook } from "../../shared/import/merchantWorkbook";

interface AgentToolRunSession {
  readonly language: UiLanguage;
  readonly history: AgentRunRequest["history"];
  readonly bypassPlanning: boolean;
  readonly promotionAttachment?: AgentRunRequest["promotionAttachment"];
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
  setPlanningState(state: unknown): void;
  hasPlanned(): boolean;
  stop(): void;
  dispose(): void;
}

const props = defineProps<{
  readonly language: UiLanguage;
  readonly endpoint: string;
  readonly enabled: boolean;
  readonly storage?: Storage;
  readonly fallbackRun: AgentRunner;
  readonly fallbackSession?: AgentViewSession;
  readonly toolExecutor: (request: AgentToolExecutionRequest) => Promise<AgentToolExecutionResponse>;
  readonly attachmentStore?: AgentAttachmentStore;
  readonly readFile?: typeof readMerchantWorkbook;
}>();

const toolNames = [
  "merchant_analysis",
  "category_analysis",
  "merchant_comparison",
  "tier_analysis",
  "category_comparison",
  "payment_status",
  "trend",
  "asin_analysis",
  "keyword_search",
  "promotion_analysis"
] as const;

let toolSession: AgentToolRunSession | undefined;
function beginRun(request: AgentRunRequest): AgentToolRunSession {
  toolSession?.dispose();
  const memoryEvents: NonNullable<Awaited<ReturnType<AgentRunner>>["memoryEvents"]>[number][] = [];
  const resultViews: NonNullable<Awaited<ReturnType<AgentRunner>>["resultViews"]>[number][] = [];
  const projections: Record<string, unknown>[] = [];
  let planningState: Record<string, unknown> | null = null;
  let disposed = false;
  const shared = props.fallbackSession as AgentSession | undefined;
  const retain = () => {
    if (!planningState || disposed || request.signal.aborted) return;
    shared?.retainReusableResult?.({ originalQuestion: request.prompt, sourceQuestionEventId: request.questionEventId || "native-result",
      agentRunId: String(planningState.agentRunId || ""), planProofs: Array.isArray(planningState.planProofs) ? planningState.planProofs.map(String) : [],
      toolResults: projections, resultViews,
      partial: Array.isArray(planningState.calls) && planningState.calls.length > projections.filter(item => (item.result as Record<string, unknown> | undefined)?.ok === true).length } as ReusableAgentResult);
  };
  const session: AgentToolRunSession = {
    language: request.language,
    history: request.history,
    bypassPlanning: request.reuseResult === true || shared?.canReuseResult?.(request.prompt) === true,
    promotionAttachment: request.promotionAttachment,
    direct: () => props.fallbackRun(request),
    async execute(toolRequest) {
      const result = await props.toolExecutor({
        callId: toolRequest.callId,
        toolName: toolRequest.toolName as AgentToolName,
        arguments: toolRequest.arguments,
        prompt: request.prompt,
        signal: toolRequest.signal || request.signal,
        language: request.language,
        promotionAttachment: request.promotionAttachment
      });
      if (disposed || request.signal.aborted || toolRequest.signal?.aborted) throw new DOMException("执行已停止", "AbortError");
      if (result.memoryEvent) memoryEvents.push(result.memoryEvent);
      if (result.resultView) {
        resultViews.push(result.resultView);
        request.onResultView?.(result.resultView);
      }
      projections.push(result.toolResult);
      retain();
      return result;
    },
    setPlanningState(value) { if (value && typeof value === "object") { planningState = value as Record<string, unknown>; retain(); } },
    hasPlanned() { return Boolean(planningState?.agentRunId); },
    stop() { shared?.markReusableStopped?.(); },
    async complete(response, options) {
      if (options.synthesisFailed) {
        const fieldsOnly = projections.length > 0 && projections.every(item => item.toolName === "asin_analysis"
          || (item.toolName === "merchant_analysis" && (item.arguments as Record<string, unknown> | undefined)?.view === "top_asins"));
        if (fieldsOnly && resultViews.length && projections.some(item => (item.result as Record<string, unknown> | undefined)?.ok === true)) {
          // 综合失败时直接展示本轮已完成的查询，避免重新规划丢失结果。
          const cell = (value: string) => value.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
          const response = resultViews.map((view) => {
            const lines = [view.title, view.message];
            if (view.rows.length) {
              lines.push([
                `| # | ${view.columns.map(cell).join(" | ")} |`, `| --- | ${view.columns.map(() => "---").join(" | ")} |`,
                ...view.rows.map((row) => `| ${cell(row.label)} | ${row.values.map(cell).join(" | ")} |`)
              ].join("\n"));
            }
            return lines.filter(Boolean).join("\n\n");
          }).join("\n\n");
          return { ok: true, status: "done", response, steps: [], partial: options.partial,
            omittedTargets: options.omittedTargets, memoryEvents, resultViews, fallbackDelivered: true };
        }
        return { ok: false, status: "error", response: request.language === "zh" ? "本次综合未完成，已有查询结果仍保留。可继续使用已有结果，或重新查询。" : "Synthesis did not complete. Existing query results are retained; continue with them or query again.",
          steps: [], partial: options.partial, omittedTargets: options.omittedTargets, memoryEvents: [], resultViews, errorCode: "synthesis_unavailable" };
      }
      const keywordView = resultViews.find((view) => view.toolName === "keyword_search");
      if (isKeywordDataQuestion(request.prompt) && (!keywordView || keywordView.status === "error")) {
        return {
          ok: false, status: "error", errorCode: "no_verifiable_source", response: keywordView?.message || keywordMissingDataResponse(request.language),
          steps: [], partial: false, omittedTargets: [], memoryEvents: [], resultViews
        };
      }
      if (projections.length && !projections.some(item => (item.result as Record<string, unknown> | undefined)?.ok === true)) {
        return { ok: false, status: "error", response: resultViews.map(view => view.message).filter(Boolean).join("\n") || response,
          steps: [], partial: false, omittedTargets: [], memoryEvents: [], resultViews, errorCode: "no_verifiable_source" };
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
      disposed = true;
      if (toolSession === session) {
        toolSession = undefined;
      }
    }
  };
  toolSession = session;
  return session;
}

function canContinue(): boolean { return Boolean((props.fallbackSession as AgentSession | undefined)?.getReusableResult?.()); }
function clearReusableResults(): void { (props.fallbackSession as AgentSession | undefined)?.clearReusableResults?.(); }

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
      session.setPlanningState((context.agent?.state as Record<string, unknown> | undefined)?.offerIntelligence);
      const { toolResult } = await session.execute({ callId: context.toolCall.id, toolName, arguments: args, signal: context.signal });
      // 图表与完整行保留在本地，只发送受 proof 绑定的有界结果。
      return { toolResult };
    }
    const prompt = [...context.agent.messages].reverse().find((message) => message.role === "user");
    return props.toolExecutor({
      callId: context.toolCall.id,
      toolName,
      arguments: args,
      prompt: messageText(prompt?.content),
      signal: context.signal || new AbortController().signal,
      language: props.language,
      promotionAttachment: props.attachmentStore?.get() || undefined
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
    <CopilotKitAgentRuntime :can-continue="canContinue" :clear-reusable-results="clearReusableResults" :language="language" :storage="storage" :begin-run="beginRun" :attachment-store="attachmentStore" :read-file="readFile" />
  </CopilotKitProvider>
  <AgentPage
    v-else
    :language="language"
    :run="fallbackRun"
    :session="fallbackSession"
    :storage="storage"
    :attachment-store="attachmentStore"
    :read-file="readFile"
    :can-continue="canContinue"
    :clear-reusable-results="clearReusableResults"
    :auto-focus="false"
  />
</template>
