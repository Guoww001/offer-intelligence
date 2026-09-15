<script setup lang="ts">
import { computed } from "vue";
import type { UiLanguage } from "../../shared/i18n";
import { dailyTimeline, periodDays, type Metric, type PerformanceRow, type PromotionWindow } from "./performanceModel";

const props = defineProps<{ language: UiLanguage; rows: PerformanceRow[]; range: PromotionWindow; availableThrough: string; metric: Metric; metricLabel: string; supported: boolean }>();
const t = (zh: string, en: string) => props.language === "zh" ? zh : en;
const points = computed(() => dailyTimeline(props.rows, props.range, props.availableThrough, props.metric, props.supported));
const extent = computed(() => {
  const values = points.value.map(p => p.value).filter((v): v is number => v !== null);
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  return { min, max: max === min ? min + 1 : max };
});
const x = (date: string) => 85 + (periodDays(props.range.beforeStart, date) - 1) * 780 / Math.max(periodDays(props.range.beforeStart, props.range.endDate) - 1, 1);
const y = (value: number) => 235 - (value - extent.value.min) / (extent.value.max - extent.value.min) * 205;
function path() {
  let connected = false;
  return points.value.map((point) => {
    const value = point.value;
    if (value === null) { connected = false; return ""; }
    const command = `${connected ? "L" : "M"}${x(point.date)},${y(value)}`;
    connected = true;
    return command;
  }).join(" ");
}
function format(value: number | null, compact = false) {
  if (value === null) return t("暂无数据", "No data");
  return new Intl.NumberFormat(props.language === "zh" ? "zh-CN" : "en-US", {
    style: ["revenue", "commission"].includes(props.metric) ? "currency" : "decimal", currency: "USD", maximumFractionDigits: 2, notation: compact ? "compact" : "standard",
  }).format(value);
}
const periodLabel = (period: string) => period === "before" ? t("比较期", "Comparison") : period === "after" ? t("观察期", "Observation") : t("未选区间", "Outside selected periods");
</script>

<template>
  <section class="promotion-panel promotion-trend" :aria-label="t('每日变化图表', 'Daily changes chart')">
    <div class="promotion-section-heading">
      <div><h3>{{ metricLabel }} · {{ t("每日变化", "Daily changes") }}</h3>
        <p>{{ t("按实际日期从早到晚展示每日数据。点击上方指标切换；日均对比保留在指标卡中。", "Daily values in chronological order. Select a metric above; daily-average comparisons remain in the metric cards.") }}</p>
      </div>
      <div class="promotion-trend-legend"><span><i />{{ t("每日实际值", "Daily actual value") }}</span></div>
    </div>
    <p v-if="!supported || !rows.length">{{ t("当前范围暂无该指标的每日数据。", "No daily data for this metric in the current scope.") }}</p>
    <div v-else class="promotion-trend-scroll">
      <svg viewBox="0 0 900 280" role="img" :aria-label="`${metricLabel} · ${range.beforeStart} — ${range.endDate}`">
        <g v-for="step in [0, 1, 2, 3, 4]" :key="step" class="promotion-trend-grid">
          <line x1="85" x2="865" :y1="30 + step * 205 / 4" :y2="30 + step * 205 / 4" />
          <text x="75" :y="34 + step * 205 / 4" text-anchor="end">{{ format(extent.max - step * (extent.max - extent.min) / 4, true) }}</text>
        </g>
        <path :d="path()" class="promotion-trend-line after" />
        <g v-for="(point, index) in points" :key="point.date">
          <text v-if="index % Math.ceil(points.length / 9) === 0 || index === points.length - 1" :x="x(point.date)" y="262" text-anchor="middle" class="promotion-trend-date">{{ point.date.slice(5) }}</text>
          <circle v-if="point.value !== null" :cx="x(point.date)" :cy="y(point.value)" r="4" class="promotion-trend-point after"><title>{{ point.date }} · {{ periodLabel(point.period) }}: {{ format(point.value) }}</title></circle>
        </g>
      </svg>
    </div>
    <small>{{ t("横轴为实际日期。未选区间和未回传日期断开；已覆盖日期没有活动时记为 0。", "The axis shows actual dates. Unselected and pending dates break the line; covered dates without activity show 0.") }}</small>
    <details class="promotion-trend-details"><summary>{{ t("查看每日明细", "View daily details") }}</summary>
      <div class="promotion-scroll"><table><thead><tr><th>{{ t("日期", "Date") }}</th><th>{{ t("所属时期", "Period") }}</th><th>{{ metricLabel }}</th></tr></thead>
        <tbody><tr v-for="point in points.filter(p => p.period !== 'gap')" :key="point.date"><td>{{ point.date }}</td><td>{{ periodLabel(point.period) }}</td><td>{{ format(point.value) }}</td></tr></tbody>
      </table></div>
    </details>
  </section>
</template>
