<script setup lang="ts">
import { computed } from "vue";

import type {
  OfferRecord,
  OfferTrackerDateRange,
  OfferTrackerExportPayload,
  UiLanguage
} from "../../shared/contracts/offer";
import { translateMessage } from "../../shared/i18n";
import OfferTrackerFilters from "./OfferTrackerFilters.vue";
import OfferTrackerTable from "./OfferTrackerTable.vue";
import { useOfferTracker, type OfferTrackerLoader } from "./useOfferTracker";

const props = withDefaults(defineProps<{
  offers: readonly OfferRecord[];
  language: UiLanguage;
  defaultDateRange: OfferTrackerDateRange;
  download?: (payload: OfferTrackerExportPayload) => void;
  loadRange?: OfferTrackerLoader;
}>(), {
  download: undefined,
  loadRange: undefined
});

const tracker = useOfferTracker({
  offers: props.offers,
  defaultDateRange: props.defaultDateRange,
  loadRange: props.loadRange
});

const copy = computed(() => {
  const message = (key: string, fallback: string) => translateMessage(props.language, key, fallback);
  return {
    eyebrow: message("offerTracker.eyebrow", "Offer 规划工作台"),
    subtitle: message("offerTracker.subtitle", "按优先级生成 Offer 清单，并导出可直接分享的工作簿。"),
    offersView: message("offerTracker.offersView", "Offers 视图"),
    productsView: message("offerTracker.productsView", "产品视图"),
    matched: message("offerTracker.matched", "匹配 Offer"),
    matchedNote: message("offerTracker.matchedNote", "当前筛选范围"),
    high: message("offerTracker.high", "高优先级"),
    highNote: message("offerTracker.highNote", "Score ≥ 8"),
    recommended: message("offerTracker.recommended", "推荐"),
    recommendedNote: message("offerTracker.recommendedNote", "常规机会池"),
    lowAov: message("offerTracker.lowAov", "低 AOV 优选"),
    lowAovNote: message("offerTracker.lowAovNote", "AOV ≤ 100"),
    summary: message("offerTracker.summary", "Offer Tracker 摘要"),
    exportHint: message("offerTracker.exportHint", "选择后可只导出已选 Offer；导出沿用现有 XLSX 生成器。"),
    exportCurrent: message("offerTracker.exportCurrent", "导出当前筛选"),
    exportSelected: message("offerTracker.exportSelected", "导出已选择")
  };
});

const {
  draftFilters,
  search,
  view,
  loading,
  error,
  filteredRows,
  pageRows,
  pageData,
  pageSize,
  selectedKeys,
  selectionSummary,
  availableTiers,
  availableCategories,
  availableNetworks
} = tracker;

const priorityCounts = computed(() => filteredRows.value.reduce((counts, row) => {
  counts[row.priority.key] += 1;
  return counts;
}, { high: 0, recommended: 0, "low-aov": 0 }));

const errorMessage = computed(() => {
  if (!error.value) return "";
  return props.language === "zh"
    ? error.value
    : translateMessage(props.language, "offerTracker.loadError", "Failed to load filtered data. Please try again.");
});

function emitDownload(selectedOnly: boolean): void {
  if (!props.download) return;
  props.download({
    rows: tracker.exportRows(selectedOnly),
    view: view.value,
    selectedOnly
  });
}
</script>

<template>
  <main class="oi-modern-page offer-tracker-modern-page" data-page="offer-list-tracker">
    <header class="offer-tracker-modern-header">
      <div>
        <span class="offer-tracker-modern-eyebrow">{{ copy.eyebrow }}</span>
        <h1>Offer List Tracker</h1>
        <p>{{ copy.subtitle }}</p>
      </div>
      <div class="offer-tracker-modern-header-actions">
        <button
          type="button"
          class="offer-tracker-secondary-button"
          :class="{ active: view === 'offers' }"
          :aria-label="copy.offersView"
          :aria-selected="view === 'offers' ? 'true' : 'false'"
          @click="tracker.setView('offers')"
        >{{ copy.offersView }}</button>
        <button
          type="button"
          class="offer-tracker-secondary-button"
          :class="{ active: view === 'products' }"
          :aria-label="copy.productsView"
          :aria-selected="view === 'products' ? 'true' : 'false'"
          @click="tracker.setView('products')"
        >{{ copy.productsView }}</button>
      </div>
    </header>

    <OfferTrackerFilters
      :model-value="draftFilters"
      :search="search"
      :language="props.language"
      :tiers="availableTiers"
      :categories="availableCategories"
      :networks="availableNetworks"
      :loading="loading"
      @update:model-value="tracker.setDraftFilters"
      @update:search="tracker.setSearch"
      @sort-change="tracker.setSort"
      @apply="tracker.applyFilters"
      @reset="tracker.resetFilters"
    />

    <p v-if="errorMessage" class="offer-tracker-modern-notice error" role="alert">{{ errorMessage }}</p>

    <section class="offer-tracker-modern-kpis" :aria-label="copy.summary">
      <article><span>{{ copy.matched }}</span><strong>{{ filteredRows.length.toLocaleString() }}</strong><small>{{ copy.matchedNote }}</small></article>
      <article><span>{{ copy.high }}</span><strong>{{ priorityCounts.high.toLocaleString() }}</strong><small>{{ copy.highNote }}</small></article>
      <article><span>{{ copy.recommended }}</span><strong>{{ priorityCounts.recommended.toLocaleString() }}</strong><small>{{ copy.recommendedNote }}</small></article>
      <article><span>{{ copy.lowAov }}</span><strong>{{ priorityCounts['low-aov'].toLocaleString() }}</strong><small>{{ copy.lowAovNote }}</small></article>
    </section>

    <div class="offer-tracker-modern-export-bar">
      <span>{{ copy.exportHint }}</span>
      <div>
        <button
          type="button"
          class="offer-tracker-secondary-button"
          :aria-label="copy.exportCurrent"
          :disabled="!filteredRows.length"
          @click="emitDownload(false)"
        >{{ copy.exportCurrent }}</button>
        <button
          type="button"
          class="offer-tracker-primary-button"
          :aria-label="copy.exportSelected"
          :disabled="!selectionSummary.selectedCount"
          @click="emitDownload(true)"
        >{{ copy.exportSelected }}</button>
      </div>
    </div>

    <OfferTrackerTable
      :rows="pageRows"
      :total-rows="pageData.totalRows"
      :page="pageData.page"
      :total-pages="pageData.totalPages"
      :page-size="pageSize"
      :selected-keys="selectedKeys"
      :summary="selectionSummary"
      :view="view"
      :language="props.language"
      @toggle-row="tracker.toggleRow"
      @toggle-page="tracker.toggleCurrentPage"
      @toggle-all="tracker.toggleAllFiltered"
      @page-change="tracker.setPage"
    />
  </main>
</template>
