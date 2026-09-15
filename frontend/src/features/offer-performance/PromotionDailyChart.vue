<script setup lang="ts">
import { computed } from "vue";
import type { UiLanguage } from "../../shared/i18n";
import { dailyObservation, type Metric, type PerformanceRow, type PromotionWindow } from "./performanceModel";

const props = defineProps<{ language: UiLanguage; rows: PerformanceRow[]; range: PromotionWindow; availableThrough: string; metric: Metric; metricLabel: string; supported: boolean }>();
const t = (zh: string, en: string) => props.language === "zh" ? zh : en;
const points = computed(() => dailyObservation(props.rows, props.range, props.availableThrough, props.metric, props.supported));
const extent = computed(() => {
  const values = points.value.map(p => p.value).filter((v): v is number => v !== null);
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  return { min, max: max === min ? min + 1 : max };
});
const x = (index: number) => 85 + (index + 0.5) * 780 / points.value.length;
const barWidth = computed(() => Math.min(48, 780 / points.value.length * 0.7));
const y = (value: number) => 235 - (value - extent.value.min) / (extent.value.max - extent.value.min) * 205;
function format(value: number | null, compact = false) {
  if (value === null) return t("暂无数据", "No data");
  return new Intl.NumberFormat(props.language === "zh" ? "zh-CN" : "en-US", {
    style: ["revenue", "commission"].includes(props.metric) ? "currency" : "decimal", currency: "USD", maximumFractionDigits: 2, notation: compact ? "compact" : "standard",
  }).format(value);
}
</script>

<template>
  <section class="promotion-panel promotion-trend" :aria-label="t('每日变化图表', 'Daily changes chart')">
    <div class="promotion-section-heading">
      <div><h3>{{ metricLabel }} · {{ t("每日变化", "Daily changes") }}</h3>
        <p>{{ t("观察期内按日期顺序每天一根柱，点击上方指标切换。", "One bar per day within the observation period, in date order. Select a metric above to switch.") }}</p>
      </div>
      <div class="promotion-trend-legend"><span><i />{{ t("每日实际值", "Daily actual value") }}</span></div>
    </div>
    <p v-if="!supported || !rows.length">{{ t("当前范围暂无该指标的每日数据。", "No daily data for this metric in the current scope.") }}</p>
    <div v-else class="promotion-trend-scroll">
      <svg viewBox="0 0 900 280" role="img" :aria-label="`${metricLabel} · ${range.startDate} — ${range.endDate}`">
        <g v-for="step in [0, 1, 2, 3, 4]" :key="step" class="promotion-trend-grid">
          <line x1="85" x2="865" :y1="30 + step * 205 / 4" :y2="30 + step * 205 / 4" />
          <text x="75" :y="34 + step * 205 / 4" text-anchor="end">{{ format(extent.max - step * (extent.max - extent.min) / 4, true) }}</text>
        </g>
        <line x1="85" x2="865" :y1="y(0)" :y2="y(0)" class="promotion-trend-zero-axis" />
        <g v-for="(point, index) in points" :key="point.date">
          <text v-if="index % Math.ceil(points.length / 9) === 0 || index === points.length - 1" :x="x(index)" y="262" text-anchor="middle" class="promotion-trend-date">{{ point.date.slice(5) }}</text>
          <rect v-if="point.value !== null && point.value !== 0" :x="x(index) - barWidth / 2" :y="Math.min(y(0), y(point.value))" :width="barWidth" :height="Math.abs(y(0) - y(point.value))" rx="2" class="promotion-trend-bar"><title>{{ point.date }}: {{ format(point.value) }}</title></rect>
          <line v-else-if="point.value === 0" :x1="x(index) - barWidth / 2" :x2="x(index) + barWidth / 2" :y1="y(0)" :y2="y(0)" class="promotion-trend-zero"><title>{{ point.date }}: {{ format(0) }}</title></line>
        </g>
      </svg>
    </div>
    <small>{{ t("未回传日期留空；已覆盖日期没有活动时在基线标记 0。", "Pending dates remain blank; covered dates without activity are marked as 0 on the baseline.") }}</small>
    <details class="promotion-trend-details"><summary>{{ t("查看每日明细", "View daily details") }}</summary>
      <div class="promotion-scroll"><table><thead><tr><th>{{ t("日期", "Date") }}</th><th>{{ metricLabel }}</th></tr></thead>
        <tbody><tr v-for="point in points" :key="point.date"><td>{{ point.date }}</td><td>{{ format(point.value) }}</td></tr></tbody>
      </table></div>
    </details>
  </section>
</template>
