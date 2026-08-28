<script setup lang="ts">
import { computed, ref } from "vue";

import { translateMessage, type UiLanguage } from "../../shared/i18n";
import { formatBrandMediaCount, type BrandMediaClickChartModel } from "./brandMediaModel";

const props = defineProps<{
  model: BrandMediaClickChartModel | null;
  language: UiLanguage;
  emptyMessage: string;
}>();

const chartRoot = ref<HTMLElement | null>(null);
const hover = ref<{ date: string; total: number; entries: string[] } | null>(null);

const copy = computed(() => ({
  total: translateMessage(props.language, "brandMedia.clicksDateTotal", "Total clicks"),
  media: translateMessage(props.language, "brandMedia.clicksMedia", "media clicks")
}));

function updateHover(event: PointerEvent): void {
  const target = event.target instanceof Element ? event.target.closest<SVGRectElement>("[data-brand-media-click-date]") : null;
  const model = props.model;
  if (!target || !model) return;
  const date = target.getAttribute("data-brand-media-click-date") || "";
  const entries = model.publishers.map((publisher) => {
    const value = model.clickPointsByIndex[publisher.sourceIndex]?.[date] || 0;
    return value > 0 ? `${publisher.userName}: ${formatBrandMediaCount(value)} ${copy.value.media}` : "";
  }).filter(Boolean);
  hover.value = { date, total: model.dailyTotals[date] || 0, entries };
}
</script>

<template>
  <div ref="chartRoot" class="brand-media-click-chart-wrap" role="img" @pointerover="updateHover" @pointerleave="hover = null">
    <div v-if="model?.hasData" class="brand-media-click-svg-host" v-html="model.svg"></div>
    <div v-else class="brand-media-empty-chart">{{ emptyMessage }}</div>
    <div v-if="hover" class="brand-media-hover-tooltip brand-media-click-hover-tooltip" aria-live="polite">
      <div class="brand-media-hover-date"><span>{{ hover.date }}</span><strong>{{ copy.total }}</strong></div>
      <div class="brand-media-hover-row"><span>{{ copy.total }}</span><strong>{{ formatBrandMediaCount(hover.total) }}</strong></div>
      <div v-for="entry in hover.entries" :key="entry" class="brand-media-hover-row brand-media-hover-secondary"><span>{{ entry }}</span></div>
    </div>
  </div>
</template>
