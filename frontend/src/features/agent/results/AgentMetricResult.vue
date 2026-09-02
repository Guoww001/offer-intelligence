<script setup lang="ts">
import type { UiLanguage } from "../../../shared/i18n";
import type { AgentResultView } from "../../../shared/contracts/agentResult";

defineProps<{
  readonly language: UiLanguage;
  readonly view: AgentResultView;
}>();
</script>

<template>
  <section class="agent-modern-result-card" :aria-label="language === 'zh' ? '工具指标' : 'Tool metrics'">
    <header class="agent-modern-result-header">
      <div>
        <span class="agent-modern-eyebrow">{{ view.toolName }}</span>
        <strong>{{ view.title }}</strong>
      </div>
      <span class="agent-modern-result-status">{{ view.status }}</span>
    </header>
    <div class="agent-modern-result-metrics">
      <div v-for="metric in view.metrics" :key="`${view.id}-${metric.label}`" class="agent-modern-result-metric">
        <span>{{ metric.label }}</span>
        <strong>{{ metric.value }}</strong>
        <small v-if="metric.delta">{{ metric.delta }}</small>
      </div>
    </div>
    <footer v-if="view.dataAsOf || view.estimated || view.message" class="agent-modern-result-meta">
      <span v-if="view.dataAsOf">{{ language === "zh" ? "数据截至" : "Data as of" }} {{ view.dataAsOf }}</span>
      <span v-if="view.estimated">{{ language === "zh" ? "估算" : "Estimated" }}</span>
      <span v-if="view.message">{{ view.message }}</span>
    </footer>
  </section>
</template>
