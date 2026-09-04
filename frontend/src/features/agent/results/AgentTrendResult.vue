<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { UiLanguage } from "../../../shared/i18n";
import type { AgentResultView, AgentTrendData } from "../../../shared/contracts/agentResult";

const props = defineProps<{ readonly language: UiLanguage; readonly view: AgentResultView }>();
const metric = ref(props.view.trend?.metric || "revenue");
watch(() => props.view.id, () => { metric.value = props.view.trend?.metric || "revenue"; });

const trend = computed<AgentTrendData | undefined>(() => props.view.trend);
const metricLabel = computed(() => {
  const labels: Record<string, { zh: string; en: string }> = {
    revenue: { zh: "收入", en: "Revenue" },
    orders: { zh: "订单", en: "Orders" },
    epc: { zh: "EPC", en: "EPC" },
    aov: { zh: "AOV", en: "AOV" },
    clicks: { zh: "点击", en: "Clicks" },
    conversionRate: { zh: "转化率", en: "Conversion" },
    affiliatePayout: { zh: "联盟佣金", en: "Affiliate payout" },
    payout: { zh: "付款", en: "Payout" },
    dpv: { zh: "详情页浏览", en: "DPV" },
    atc: { zh: "加购", en: "ATC" }
  };
  return labels[metric.value]?.[props.language] || metric.value;
});

const rows = computed(() => {
  const key = metric.value;
  return (trend.value?.months || []).flatMap((row) => {
    const raw = row[key];
    const value = typeof raw === "number" ? raw : Number(raw);
    const month = String(row.month || "").trim();
    return month && Number.isFinite(value) ? [{ month, value }] : [];
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
  <section v-if="trend && chart" class="agent-modern-result-card agent-trend-result" :aria-label="language === 'zh' ? '工具趋势结果' : 'Tool trend result'">
    <header class="agent-modern-result-header">
      <div>
        <span class="agent-modern-eyebrow">{{ view.toolName }}</span>
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
      >{{ option }}</button>
    </div>
    <div class="agent-trend-chart-wrap">
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
    <footer class="agent-modern-result-meta">
      <span>{{ language === "zh" ? "范围" : "Range" }}: {{ formatValue(chart.min) }} – {{ formatValue(chart.max) }}</span>
      <span v-if="view.dataAsOf">{{ language === "zh" ? "数据截至" : "Data as of" }} {{ view.dataAsOf }}</span>
      <span v-if="view.estimated">{{ language === "zh" ? "估算" : "Estimated" }}</span>
    </footer>
  </section>
  <p v-else role="status">{{ language === 'zh' ? '暂无可绘制的月度趋势数据。' : 'No monthly trend data to plot.' }}</p>
</template>
