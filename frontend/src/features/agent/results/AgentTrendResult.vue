<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { UiLanguage } from "../../../shared/i18n";
import type { AgentResultView } from "../../../shared/contracts/agentResult";

const props = defineProps<{ readonly language: UiLanguage; readonly view: AgentResultView }>();
const metric = ref(props.view.trend?.metric || "revenue");
watch(() => props.view.id, () => { metric.value = props.view.trend?.metric || "revenue"; });
// Only the existing local renderer produces HTML; model HTML is never mounted.
const chart = computed(() => props.view.trend
  ? window.OI_LEGACY_BRIDGE?.renderAgentTrend?.({ ...props.view.trend, metric: metric.value }, props.language) || ""
  : "");
function selectMetric(event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-agent-trend-metric]") : null;
  const key = target?.dataset.agentTrendMetric;
  if (key && props.view.trend?.metrics.includes(key)) metric.value = key;
}
</script>

<template>
  <div v-if="chart" class="agent-trend-visuals" data-agent-trend-result @click="selectMetric" v-html="chart"></div>
  <p v-else role="status">{{ language === 'zh' ? '暂无可绘制的月度趋势数据。' : 'No monthly trend data to plot.' }}</p>
</template>
