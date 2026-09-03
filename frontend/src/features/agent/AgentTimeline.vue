<script setup lang="ts">
import { computed } from "vue";

import type { UiLanguage } from "../../shared/i18n";
import type { AgentRunStatus, AgentTimelineStep } from "./agentModel";

const props = defineProps<{
  readonly language: UiLanguage;
  readonly status: AgentRunStatus;
  readonly steps: readonly AgentTimelineStep[];
  readonly partial?: boolean;
  readonly omittedTargets?: readonly string[];
}>();

const copy = computed(() => props.language === "zh" ? {
  title: "执行摘要",
  running: "正在执行",
  done: "已完成",
  stopped: "已停止",
  error: "执行失败",
  partial: "结果不完整",
  omitted: "未执行目标",
  planning: "规划",
  tool: "数据查询",
  synthesis: "综合",
  source: "数据来源",
  estimated: "估算"
} : {
  title: "Execution summary",
  running: "Running",
  done: "Completed",
  stopped: "Stopped",
  error: "Failed",
  partial: "Partial result",
  omitted: "Unexecuted targets",
  planning: "Planning",
  tool: "Data query",
  synthesis: "Synthesis",
  source: "Data source",
  estimated: "Estimated"
});

const dataAsOfLabel = computed(() => props.language === "zh" ? "数据截至" : "Data as of");

function statusText(status: AgentRunStatus): string {
  return status === "running" ? copy.value.running
    : status === "done" ? copy.value.done
      : status === "stopped" ? copy.value.stopped : copy.value.error;
}

function phaseText(phase: AgentTimelineStep["phase"]): string {
  return copy.value[phase];
}

function stepStatusIcon(status: AgentTimelineStep["status"]): string {
  return status === "done" ? "✓" : status === "error" || status === "timeout" ? "!" : status === "stopped" ? "■" : "…";
}

function elapsed(step: AgentTimelineStep): string {
  return step.elapsedMs === undefined ? "" : `${Math.round(step.elapsedMs)}ms`;
}
</script>

<template>
  <details
    class="agent-run-timeline"
    :class="'agent-run-timeline-' + status"
    :open="status !== 'done'"
    data-agent-timeline
    :data-status="status"
    :aria-label="copy.title"
    :aria-busy="status === 'running'"
  >
    <summary class="agent-run-summary">
      <span class="agent-run-status-icon" aria-hidden="true">{{ status === "done" ? "✓" : status === "stopped" ? "■" : status === "error" ? "✗" : "⋯" }}</span>
      <span class="agent-run-title">{{ copy.title }}</span>
      <span class="agent-run-status" :data-agent-status="status">{{ statusText(status) }}</span>
      <span class="agent-run-meta" aria-hidden="true">{{ steps.length }} {{ language === "zh" ? "步" : "steps" }}</span>
    </summary>
    <div v-if="steps.length" class="agent-run-steps" role="list">
      <div
        v-for="step in steps"
        :key="step.id"
        class="agent-run-step"
        :class="'agent-run-step-' + step.status"
        role="listitem"
        data-agent-timeline-step
        :data-step-status="step.status"
      >
        <span class="agent-run-step-icon" aria-hidden="true">{{ stepStatusIcon(step.status) }}</span>
        <div class="agent-run-step-body">
          <strong class="agent-run-step-label">{{ phaseText(step.phase) }} · {{ step.label }}</strong>
          <span v-if="step.detail" class="agent-run-step-detail">{{ step.detail }}</span>
          <span v-if="step.dataSource || step.dataAsOf || step.estimated" class="agent-run-step-detail">
            <span v-if="step.dataSource">{{ copy.source }}: {{ step.dataSource }}</span>
            <span v-if="step.dataAsOf"> {{ dataAsOfLabel }}: {{ step.dataAsOf }}</span>
            <span v-if="step.estimated"> · {{ copy.estimated }}</span>
          </span>
        </div>
        <span v-if="elapsed(step)" class="agent-run-step-meta" aria-hidden="true">{{ elapsed(step) }}</span>
      </div>
    </div>
    <div v-if="partial" class="agent-run-partial" data-agent-partial role="status">
      <strong>{{ copy.partial }}</strong>
      <span v-if="omittedTargets?.length">{{ copy.omitted }}：{{ omittedTargets.join(language === 'zh' ? '、' : ', ') }}</span>
    </div>
  </details>
</template>
