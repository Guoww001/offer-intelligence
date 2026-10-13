<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { UiLanguage } from "../../../shared/i18n";
import type { AgentResultView, AgentTrendData } from "../../../shared/contracts/agentResult";
import { agentMetricLabel, agentToolLabel } from "../agentResultPresentation";

const props = defineProps<{ readonly language: UiLanguage; readonly view: AgentResultView }>();
const metric = ref(props.view.trend?.metric || "revenue");
watch(() => props.view.id, () => { metric.value = props.view.trend?.metric || "revenue"; });

const trend = computed<AgentTrendData | undefined>(() => props.view.trend);
const metricLabel = computed(() => {
  return agentMetricLabel(metric.value, props.language);
});

const rows = computed(() => {
  const key = metric.value;
  return (trend.value?.months || []).flatMap((row) => {
    const raw = row[key];
    const value = typeof raw === "number" ? raw : Number(raw);
    const month = String(row.month || "").trim();
    return month && typeof raw === "number" && Number.isFinite(value) ? [{ month, value }] : [];
  });
});

const chart = computed(() => {
  const points = rows.value;
  if (points.length < 2) return null;
  const width = 640;
  const height = 226;
  const left = 42;
  const right = 18;
  const top = 20;
  const bottom = 38;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || Math.max(Math.abs(max), 1);
  const xStep = (width - left - right) / Math.max(points.length - 1, 1);
  const toY = (value: number) => top + ((max - value) / range) * (height - top - bottom);
  const linePoints = points.map((point, index) => `${(left + index * xStep).toFixed(2)},${toY(point.value).toFixed(2)}`).join(" ");
  const areaPoints = `${left},${height - bottom} ${linePoints} ${left + (points.length - 1) * xStep},${height - bottom}`;
  const grid = [0, 0.5, 1].map((ratio) => ({ y: top + ratio * (height - top - bottom), value: max - ratio * range }));
  return { width, height, left, bottom, points, linePoints, areaPoints, grid, toY, min, max };
});

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (metric.value === "conversionRate") return `${(value * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function selectMetric(event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-agent-trend-metric]") : null;
  const key = target?.dataset.agentTrendMetric;
  if (key && trend.value?.metrics.includes(key)) metric.value = key;
}
</script>

<template>
  <section v-if="trend" class="agent-modern-result-card agent-trend-result" :aria-label="language === 'zh' ? '工具趋势结果' : 'Tool trend result'">
    <header class="agent-modern-result-header">
      <div>
        <span class="agent-modern-eyebrow">{{ agentToolLabel(view.toolName, language) }}</span>
        <strong>{{ view.title }}</strong>
      </div>
      <span class="agent-modern-result-status">{{ metricLabel }}</span>
    </header>
    <div class="agent-trend-metrics" @click="selectMetric">
      <button
        v-for="option in trend.metrics"
        :key="option"
        type="button"
        :data-agent-trend-metric="option"
        :class="{ active: metric === option }"
      >{{ agentMetricLabel(option, language) }}</button>
    </div>
    <div v-if="chart" class="agent-trend-chart-wrap">
      <svg class="agent-trend-chart" :viewBox="`0 0 ${chart.width} ${chart.height}`" role="img" :aria-label="`${metricLabel} ${trend.target}`">
        <g class="agent-trend-grid" aria-hidden="true">
          <line v-for="line in chart.grid" :key="line.y" :x1="chart.left" :x2="chart.width - 18" :y1="line.y" :y2="line.y" />
        </g>
        <polygon class="agent-trend-area" :points="chart.areaPoints" aria-hidden="true" />
        <polyline class="agent-trend-line" :points="chart.linePoints" fill="none" />
        <g class="agent-trend-points">
          <circle v-for="(point, index) in chart.points" :key="`${point.month}-${index}`" :cx="chart.left + index * ((chart.width - chart.left - 18) / Math.max(chart.points.length - 1, 1))" :cy="chart.toY(point.value)" r="4">
            <title>{{ point.month }}: {{ formatValue(point.value) }}</title>
          </circle>
        </g>
        <g class="agent-trend-labels" aria-hidden="true">
          <text v-for="point in chart.points" :key="point.month" :x="chart.left + chart.points.indexOf(point) * ((chart.width - chart.left - 18) / Math.max(chart.points.length - 1, 1))" :y="chart.height - 12">{{ point.month.slice(2) }}</text>
        </g>
      </svg>
    </div>
    <p v-else role="status">{{ language === 'zh' ? '该指标不足两个可比较的月份，缺失值不补零。' : 'Fewer than two comparable months; missing values are not zero.' }}</p>
    <details class="agent-trend-monthly-details">
      <summary>{{ language === 'zh' ? '月度明细' : 'Monthly details' }}</summary>
      <div class="agent-modern-result-table-wrap">
        <table class="agent-modern-result-table">
          <thead><tr><th scope="col">{{ language === 'zh' ? '月份' : 'Month' }}</th><th scope="col">{{ metricLabel }}</th></tr></thead>
          <tbody><tr v-for="row in trend.months" :key="String(row.month)"><th scope="row">{{ row.month }}</th><td>{{ typeof row[metric] === 'number' ? formatValue(row[metric] as number) : (language === 'zh' ? '未提供' : 'Not provided') }}</td></tr></tbody>
        </table>
      </div>
    </details>
    <footer class="agent-modern-result-meta">
      <span v-if="chart">{{ language === "zh" ? "范围" : "Range" }}: {{ formatValue(chart.min) }} – {{ formatValue(chart.max) }}</span>
      <span v-if="view.dataAsOf">{{ language === "zh" ? "数据截至" : "Data as of" }} {{ view.dataAsOf }}</span>
      <span v-if="view.estimated">{{ language === "zh" ? "估算" : "Estimated" }}</span>
      <span v-if="view.message">{{ view.message }}</span>
    </footer>
  </section>
  <p v-else role="status">{{ language === 'zh' ? '暂无可绘制的月度趋势数据。' : 'No monthly trend data to plot.' }}</p>
</template>
