<script setup lang="ts">
import { computed } from "vue";
import type { UiLanguage } from "../../../shared/i18n";
import type { AgentResultView } from "../../../shared/contracts/agentResult";
import { agentToolLabel, agentStatusLabel } from "../agentResultPresentation";

const props = defineProps<{
  readonly language: UiLanguage;
  readonly view: AgentResultView;
}>();
// 保留结果模型和追问上下文，只在展示时按 ASIN 拆表。
const tables = computed(() => {
  if (props.view.toolName !== "asin_analysis") return [{ title: props.view.title, rows: props.view.rows }];
  const groups = new Map<string, typeof props.view.rows>();
  for (const row of props.view.rows) {
    const asin = row.label.match(/^B[0-9A-Z]{9}(?=\s|$)/)?.[0] || props.view.title;
    groups.set(asin, [...(groups.get(asin) || []), row]);
  }
  return groups.size ? [...groups].map(([title, rows]) => ({ title, rows })) : [{ title: props.view.title, rows: props.view.rows }];
});
</script>

<template>
  <section v-for="table in tables" :key="table.title" class="agent-modern-result-card" :aria-label="table.title">
    <header class="agent-modern-result-header">
      <div>
        <span class="agent-modern-eyebrow">{{ agentToolLabel(view.toolName, language) }}</span>
        <strong>{{ table.title }}</strong>
      </div>
      <span class="agent-modern-result-status">{{ agentStatusLabel(view.status, language) }}</span>
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
          <tr v-for="(row, rowIndex) in table.rows" :key="`${view.id}-${rowIndex}`">
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

<style scoped>
.agent-modern-result-card + .agent-modern-result-card { margin-top: 16px; }
</style>
