<script setup lang="ts">
import { computed } from "vue";

import type { UiLanguage } from "../../shared/i18n";
import type { AgentRunStatus, AgentTimelineStep } from "./agentModel";
import type { AgentRunPhase } from "./agentRunReducer";

const props = defineProps<{
  readonly language: UiLanguage;
  readonly status: AgentRunStatus;
  readonly phase?: AgentRunPhase;
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
  <section class="agent-modern-timeline" data-agent-timeline :data-status="status" :data-phase="phase || status" :aria-label="copy.title">
    <header class="agent-modern-timeline-header">
      <div>
        <span class="agent-modern-eyebrow">AGENT TRACE</span>
        <strong>{{ copy.title }}</strong>
      </div>
      <span class="agent-modern-timeline-status" :data-agent-status="status">{{ statusText(status) }}</span>
    </header>
    <ol v-if="steps.length" class="agent-modern-timeline-steps">
      <li v-for="step in steps" :key="step.id" data-agent-timeline-step :data-step-status="step.status">
        <span class="agent-modern-timeline-icon" aria-hidden="true">{{ stepStatusIcon(step.status) }}</span>
        <div>
          <span class="agent-modern-timeline-phase">{{ phaseText(step.phase) }}</span>
          <strong>{{ step.label }}</strong>
          <p v-if="step.detail">{{ step.detail }}</p>
          <small v-if="step.dataSource || step.dataAsOf || step.estimated || elapsed(step)">
            <span v-if="step.dataSource">{{ copy.source }}: {{ step.dataSource }}</span>
            <span v-if="step.dataAsOf"> {{ dataAsOfLabel }}: {{ step.dataAsOf }}</span>
            <span v-if="step.estimated"> · {{ copy.estimated }}</span>
            <span v-if="elapsed(step)"> · {{ elapsed(step) }}</span>
          </small>
        </div>
      </li>
    </ol>
    <div v-if="partial" class="agent-modern-timeline-partial" data-agent-partial role="status">
      <strong>{{ copy.partial }}</strong>
      <span v-if="omittedTargets?.length">{{ copy.omitted }}：{{ omittedTargets.join(language === 'zh' ? '、' : ', ') }}</span>
    </div>
  </section>
</template>
