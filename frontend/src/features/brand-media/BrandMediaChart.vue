<script setup lang="ts">
import { computed, nextTick, ref } from "vue";

import { translateMessage, type UiLanguage } from "../../shared/i18n";
import {
  brandMediaColor,
  formatBrandMediaCount,
  formatBrandMediaDate,
  formatBrandMediaMoney,
  type BrandMediaChartModel,
  type BrandMediaPublisherView
} from "./brandMediaModel";

const props = defineProps<{
  model: BrandMediaChartModel | null;
  publishers: readonly BrandMediaPublisherView[];
  lockedKeys: readonly string[];
  language: UiLanguage;
  merchantName: string;
  emptyMessage: string;
}>();

const emit = defineEmits<{
  toggleLock: [publisherKey: string];
}>();

const chartRoot = ref<HTMLElement | null>(null);
const hoverDate = ref("");
const focusedIndex = ref<number | null>(null);
const tooltipLeft = ref(0);
const tooltipEdge = ref<"start" | "center" | "end">("center");

const copy = computed(() => ({
  allOrderLine: translateMessage(props.language, "brandMedia.allOrderLine", "All media orders"),
  totalOrders: translateMessage(props.language, "brandMedia.totalOrders", "Total orders"),
  totalOrdersForDate: translateMessage(props.language, "brandMedia.totalOrdersForDate", "Total orders"),
  totalRevenueForDate: translateMessage(props.language, "brandMedia.totalRevenueForDate", "Total revenue"),
  lockedMedia: translateMessage(props.language, "brandMedia.lockedMedia", "Locked media"),
  allMedia: translateMessage(props.language, "brandMedia.allMedia", "All media"),
  mediaRevenueForDate: translateMessage(props.language, "brandMedia.mediaRevenueForDate", "Media revenue"),
  noRecord: translateMessage(props.language, "brandMedia.noRecord", "No source record"),
  lock: translateMessage(props.language, "brandMedia.lock", "Click to lock this media"),
  unlock: translateMessage(props.language, "brandMedia.unlock", "Click to unlock this media")
}));

const lockedSet = computed(() => new Set(props.lockedKeys));
const totalOrderCount = computed(() => props.publishers.reduce((total, publisher) => total + publisher.totalOrders, 0));
const focusedPublisher = computed(() => props.model && focusedIndex.value !== null
  ? props.model.publisherByIndex[focusedIndex.value]
  : undefined);
const focusedPoint = computed(() => props.model && focusedIndex.value !== null && hoverDate.value
  ? props.model.publisherPointsByIndex[focusedIndex.value]?.[hoverDate.value]
  : undefined);
const tooltipRows = computed(() => {
  if (!props.model || !hoverDate.value) return null;
  const totalOrders = props.model.dailyOrderTotals[hoverDate.value] || 0;
  const totalRevenue = props.model.dailyRevenueTotals[hoverDate.value] || 0;
  return {
    date: formatBrandMediaDate(hoverDate.value),
    totalLabel: lockedSet.value.size ? copy.value.lockedMedia : copy.value.allMedia,
    totalOrders: formatBrandMediaCount(totalOrders),
    totalRevenue: formatBrandMediaMoney(totalRevenue),
    focusedName: focusedPublisher.value?.userName || "",
    focusedOrders: focusedPoint.value ? formatBrandMediaCount(focusedPoint.value.orders) : copy.value.noRecord,
    focusedRevenue: focusedPoint.value ? formatBrandMediaMoney(focusedPoint.value.revenue) : ""
  };
});

function publisherIndexFromTarget(target: EventTarget | null): number | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest("[data-brand-media-publisher-index]");
  if (!element) return null;
  const index = Number(element.getAttribute("data-brand-media-publisher-index"));
  return Number.isFinite(index) ? index : null;
}

function applyFocus(index: number | null): void {
  const svg = chartRoot.value?.querySelector<SVGElement>(".brand-media-svg");
  if (!svg) return;
  svg.classList.toggle("brand-media-chart-has-focus", index !== null);
  svg.querySelectorAll<SVGPathElement>(".brand-media-series").forEach((path) => {
    const pathIndex = Number(path.getAttribute("data-brand-media-publisher-index"));
    path.classList.toggle("is-focused", index !== null && pathIndex === index);
    path.classList.toggle("is-muted", index !== null && pathIndex !== index);
  });
}

function updateCrosshair(dateKey: string, index: number | null): void {
  const model = props.model;
  const svg = chartRoot.value?.querySelector<SVGSVGElement>(".brand-media-svg");
  if (!model || !svg || !dateKey) return;
  const dateLine = svg.querySelector<SVGLineElement>(".brand-media-crosshair-date");
  const valueLine = svg.querySelector<SVGLineElement>(".brand-media-crosshair-value");
  const x = model.xFor(dateKey);
  let value = model.showAllOrderLine ? model.allDailyOrderTotals[dateKey] || 0 : 0;
  const focusedPoint = index !== null
    ? model.publisherPointsByIndex[index]?.[dateKey]
    : undefined;
  if (focusedPoint) {
    value = focusedPoint.orders;
  } else if (!model.showAllOrderLine) {
    for (const publisher of model.publishers) {
      value = Math.max(value, model.publisherPointsByIndex[publisher.sourceIndex]?.[dateKey]?.orders || 0);
    }
  }
  const y = model.yFor(value);
  dateLine?.setAttribute("x1", x.toFixed(2));
  dateLine?.setAttribute("x2", x.toFixed(2));
  dateLine?.style.setProperty("display", "");
  valueLine?.setAttribute("y1", y.toFixed(2));
  valueLine?.setAttribute("y2", y.toFixed(2));
  valueLine?.style.setProperty("display", "");
}

function clearHover(): void {
  hoverDate.value = "";
  focusedIndex.value = null;
  applyFocus(null);
  const svg = chartRoot.value?.querySelector<SVGSVGElement>(".brand-media-svg");
  svg?.querySelector<SVGLineElement>(".brand-media-crosshair-date")?.style.setProperty("display", "none");
  svg?.querySelector<SVGLineElement>(".brand-media-crosshair-value")?.style.setProperty("display", "none");
}

function updateHover(event: PointerEvent): void {
  const model = props.model;
  const svg = chartRoot.value?.querySelector<SVGSVGElement>(".brand-media-svg");
  if (!model || !svg) return;
  const rect = svg.getBoundingClientRect();
  const width = rect.width || model.width;
  const clientX = Number.isFinite(event.clientX) ? event.clientX : 0;
  const localX = rect.width ? (clientX - rect.left) / width * model.width : model.left;
  const offset = Math.round((localX - model.left) / Math.max(1, model.plotWidth) * model.daySpan);
  hoverDate.value = model.dateForOffset(Math.max(0, Math.min(model.daySpan, offset)));
  focusedIndex.value = publisherIndexFromTarget(event.target);
  const chartWidth = chartRoot.value?.clientWidth || width;
  tooltipLeft.value = Math.max(12, Math.min(chartWidth - 12, localX / model.width * width));
  tooltipEdge.value = tooltipLeft.value < chartWidth * 0.18
    ? "start"
    : tooltipLeft.value > chartWidth * 0.82 ? "end" : "center";
  applyFocus(focusedIndex.value);
  updateCrosshair(hoverDate.value, focusedIndex.value);
}

function toggleLock(publisher: BrandMediaPublisherView): void {
  emit("toggleLock", publisher.publisherKey);
}

function handleLegendKeydown(event: KeyboardEvent, publisher: BrandMediaPublisherView): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  toggleLock(publisher);
}

async function focusLegendAgain(): Promise<void> {
  await nextTick();
  chartRoot.value?.querySelector<HTMLElement>("[data-brand-media-publisher-index]")?.focus();
}

function focusLegend(publisher: BrandMediaPublisherView): void {
  focusedIndex.value = publisher.sourceIndex;
  hoverDate.value = hoverDate.value || props.model?.endDate || "";
  applyFocus(focusedIndex.value);
  if (hoverDate.value) updateCrosshair(hoverDate.value, focusedIndex.value);
}

defineExpose({ focusLegendAgain });
</script>

<template>
  <div
    ref="chartRoot"
    class="brand-media-chart-wrap"
    role="img"
    :aria-label="`${merchantName}, ${model?.startDate || ''} to ${model?.endDate || ''}, ${publishers.length} publisher order lines`"
    @pointermove="updateHover"
    @pointerleave="clearHover"
  >
    <div v-if="model" class="brand-media-svg-host" v-html="model.svg"></div>
    <div v-else class="brand-media-empty-chart">{{ emptyMessage }}</div>
    <div
      v-if="tooltipRows"
      class="brand-media-hover-tooltip"
      :data-edge="tooltipEdge"
      :style="{ left: `${tooltipLeft}px` }"
      aria-live="polite"
    >
      <div class="brand-media-hover-date">
        <span>{{ tooltipRows.date }}</span>
        <strong>{{ copy.totalOrdersForDate }}</strong>
      </div>
      <div class="brand-media-hover-row">
        <span>{{ tooltipRows.totalLabel }}</span>
        <strong>{{ tooltipRows.totalOrders }}</strong>
      </div>
      <div class="brand-media-hover-row brand-media-hover-secondary">
        <span>{{ copy.totalRevenueForDate }}</span>
        <strong>{{ tooltipRows.totalRevenue }}</strong>
      </div>
      <template v-if="tooltipRows.focusedName">
        <div class="brand-media-hover-row brand-media-hover-media">
          <span><i :style="{ '--brand-media-line': brandMediaColor(focusedIndex || 0) }" />{{ tooltipRows.focusedName }}</span>
          <strong>{{ tooltipRows.focusedOrders }}</strong>
        </div>
        <div v-if="tooltipRows.focusedRevenue" class="brand-media-hover-row brand-media-hover-secondary">
          <span>{{ copy.mediaRevenueForDate }}</span>
          <strong>{{ tooltipRows.focusedRevenue }}</strong>
        </div>
      </template>
    </div>
  </div>

  <aside class="brand-media-legend" aria-label="Publisher line legend">
    <div v-if="model" class="brand-media-legend-total">
      <i aria-hidden="true" />
      <span class="brand-media-legend-details">
        <strong>{{ copy.allOrderLine }}</strong>
        <small>{{ copy.totalOrders }}</small>
      </span>
      <strong>{{ formatBrandMediaCount(totalOrderCount) }}</strong>
    </div>
    <button
      v-for="publisher in publishers"
      :key="publisher.publisherKey"
      type="button"
      class="brand-media-legend-item"
      :class="{ 'is-locked': lockedSet.has(publisher.publisherKey), 'is-focused': focusedIndex === publisher.sourceIndex, 'is-muted': focusedIndex !== null && focusedIndex !== publisher.sourceIndex }"
      :aria-pressed="lockedSet.has(publisher.publisherKey)"
      :aria-label="`${publisher.userName} / ${publisher.adminName}: ${lockedSet.has(publisher.publisherKey) ? copy.unlock : copy.lock}`"
      :title="lockedSet.has(publisher.publisherKey) ? copy.unlock : copy.lock"
      :data-brand-media-publisher-index="publisher.sourceIndex"
      @click="toggleLock(publisher)"
      @pointerover="focusLegend(publisher)"
      @pointerleave="clearHover"
      @keydown="handleLegendKeydown($event, publisher)"
    >
      <i :style="{ '--brand-media-line': brandMediaColor(publisher.sourceIndex) }" />
      <span class="brand-media-legend-details">
        <strong>{{ publisher.userName }}</strong>
        <small>{{ publisher.adminName }}</small>
      </span>
      <strong>{{ formatBrandMediaMoney(publisher.totalRevenue) }}</strong>
    </button>
  </aside>
</template>
