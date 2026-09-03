<script setup lang="ts">
import type { UiLanguage } from "../../../shared/i18n";
import type { AgentResultView } from "../../../shared/contracts/agentResult";

defineProps<{
  readonly language: UiLanguage;
  readonly view: AgentResultView;
}>();
</script>

<template>
  <section class="agent-modern-result-card" :aria-label="language === 'zh' ? '工具结果表' : 'Tool table'">
    <header class="agent-modern-result-header">
      <div>
        <span class="agent-modern-eyebrow">{{ view.toolName }}</span>
        <strong>{{ view.title }}</strong>
      </div>
      <span class="agent-modern-result-status">{{ view.status }}</span>
    </header>
    <div class="agent-modern-result-table-wrap">
      <table class="agent-modern-result-table">
        <thead v-if="view.columns.length">
          <tr>
            <th scope="col">{{ language === "zh" ? "项目" : "Item" }}</th>
            <th v-for="column in view.columns" :key="`${view.id}-${column}`" scope="col">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in view.rows" :key="`${view.id}-${row.label}`">
            <th scope="row">{{ row.label }}</th>
            <td v-for="(value, index) in row.values" :key="`${view.id}-${row.label}-${index}`">{{ value }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <footer v-if="view.dataAsOf || view.estimated || view.message" class="agent-modern-result-meta">
      <span v-if="view.dataAsOf">{{ language === "zh" ? "数据截至" : "Data as of" }} {{ view.dataAsOf }}</span>
      <span v-if="view.estimated">{{ language === "zh" ? "估算" : "Estimated" }}</span>
      <span v-if="view.message">{{ view.message }}</span>
    </footer>
  </section>
</template>
