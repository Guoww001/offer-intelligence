<script setup lang="ts">
import type { UiLanguage } from "../../../shared/i18n";
import type { AgentResultView } from "../../../shared/contracts/agentResult";

defineProps<{
  readonly language: UiLanguage;
  readonly view: AgentResultView;
}>();
</script>

<template>
  <section class="agent-modern-result-card agent-modern-result-status-card" :aria-label="language === 'zh' ? '工具状态' : 'Tool status'" aria-live="polite">
    <header class="agent-modern-result-header">
      <div>
        <span class="agent-modern-eyebrow">{{ view.toolName }}</span>
        <strong>{{ view.title }}</strong>
      </div>
      <span class="agent-modern-result-status">{{ view.status }}</span>
    </header>
    <p v-if="view.message" class="agent-modern-result-message">{{ view.message }}</p>
    <small v-if="view.dataAsOf || view.estimated">
      <span v-if="view.dataAsOf">{{ language === "zh" ? "数据截至" : "Data as of" }} {{ view.dataAsOf }}</span>
      <span v-if="view.estimated"> · {{ language === "zh" ? "估算" : "Estimated" }}</span>
    </small>
  </section>
</template>
