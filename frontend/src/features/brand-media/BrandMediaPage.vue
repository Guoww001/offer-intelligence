<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";

import { translateMessage, type UiLanguage } from "../../shared/i18n";
import BrandMediaChart from "./BrandMediaChart.vue";
import BrandMediaClicksChart from "./BrandMediaClicksChart.vue";
import {
  formatBrandMediaCount,
  type BrandMediaCatalogOption
} from "./brandMediaModel";
import BrandMediaTable from "./BrandMediaTable.vue";
import { useBrandMedia, type BrandMediaCatalogLoader, type BrandMediaTrendLoader } from "./useBrandMedia";

const props = defineProps<{
  catalogData?: unknown;
  language: UiLanguage;
  today?: () => Date;
  loadCatalog?: BrandMediaCatalogLoader;
  loadTrend?: BrandMediaTrendLoader;
}>();

const media = useBrandMedia({
  catalogData: props.catalogData,
  loadCatalog: props.loadCatalog,
  loadTrend: props.loadTrend,
  today: props.today
});

const dropdownOpen = ref(false);
const expandButton = ref<HTMLButtonElement | null>(null);

const copy = computed(() => ({
  eyebrow: translateMessage(props.language, "brandMedia.eyebrow", "Revenue intelligence"),
  title: translateMessage(props.language, "brandMedia.title", "Brand media performance"),
  subtitle: translateMessage(props.language, "brandMedia.subtitle", "Compare every active publisher's daily revenue for one brand."),
  liveSource: translateMessage(props.language, "brandMedia.liveSource", "Daily order revenue"),
  brand: translateMessage(props.language, "brandMedia.brand", "Brand"),
  brandPlaceholder: translateMessage(props.language, "brandMedia.brandPlaceholder", "Search brand or Merchant ID"),
  manager: translateMessage(props.language, "brandMedia.manager", "Media manager"),
  allManagers: translateMessage(props.language, "brandMedia.allManagers", "All managers"),
  timeRange: translateMessage(props.language, "brandMedia.timeRange", "Time range"),
  startDate: translateMessage(props.language, "brandMedia.startDate", "Start date"),
  endDate: translateMessage(props.language, "brandMedia.endDate", "End date"),
  sourceNote: translateMessage(props.language, "brandMedia.sourceNote", "The line shows daily order numbers. Missing media-date records are shown as chart gaps, not zeroes; Revenue remains available on hover."),
  chartTitle: translateMessage(props.language, "brandMedia.chartTitle", "Publisher orders by day"),
  chartSubtitle: translateMessage(props.language, "brandMedia.chartSubtitle", "Click a media partner on the right to lock it; select multiple partners, and click again to unlock. The black line shows all-media orders before locking. Revenue remains available on hover. Lines break when there is no daily source record."),
  clicksTitle: translateMessage(props.language, "brandMedia.clicksTitle", "Clicks by locked media"),
  clicksSubtitle: translateMessage(props.language, "brandMedia.clicksSubtitle", "One locked media uses a regular bar chart; multiple locked media are stacked to show cumulative daily clicks."),
  clicksCount: translateMessage(props.language, "brandMedia.clicksCount", "click bars"),
  clicksEmpty: translateMessage(props.language, "brandMedia.clicksEmpty", "The locked media have no click records in the selected range."),
  tableTitle: translateMessage(props.language, "brandMedia.tableTitle", "Media summary"),
  tableSubtitle: translateMessage(props.language, "brandMedia.tableSubtitle", "Range totals and source-record coverage for every line in the chart."),
  selectBrand: translateMessage(props.language, "brandMedia.selectBrand", "Select a brand to load its daily media orders."),
  loading: translateMessage(props.language, "brandMedia.loading", "Loading brand media order trend…"),
  noData: translateMessage(props.language, "brandMedia.noData", "No media order records in this range."),
  loadError: translateMessage(props.language, "brandMedia.loadError", "Unable to load brand media trend. Adjust the date range and try again."),
  noPermission: translateMessage(props.language, "brandMedia.noPermission", "You do not have permission to view brand media trend data."),
  noLockedData: translateMessage(props.language, "brandMedia.noLockedData", "No locked media records in the selected range. Click a media in the right panel to unlock it."),
  lineCount: translateMessage(props.language, "brandMedia.lineCount", "media lines"),
  lockedCount: translateMessage(props.language, "brandMedia.lockedCount", "locked"),
  expandChart: translateMessage(props.language, "brandMedia.expandChart", "Expand chart"),
  collapseChart: translateMessage(props.language, "brandMedia.collapseChart", "Exit expanded chart"),
  publisherCount: translateMessage(props.language, "brandMedia.publisherCount", "Active media"),
  totalRevenue: translateMessage(props.language, "brandMedia.totalRevenue", "Revenue"),
  orders: translateMessage(props.language, "brandMedia.orders", "Orders"),
  observations: translateMessage(props.language, "brandMedia.observations", "Media-day records"),
  emptyCatalog: translateMessage(props.language, "brandMedia.merchantNoMatch", "No matching merchant")
}));

const filteredMerchantOptions = computed<readonly BrandMediaCatalogOption[]>(() => {
  const query = media.merchantSearch.value.trim().toLowerCase();
  return media.merchantOptions.value.filter((option) => !query
    || option.name.toLowerCase().includes(query)
    || option.merchantId.toLowerCase().includes(query)).slice(0, 80);
});

const statusText = computed(() => {
  if (!media.status.value) return "";
  return translateMessage(props.language, media.status.value, media.status.value);
});

const lineCountText = computed(() => {
  const count = formatBrandMediaCount(media.visiblePublishers.value.length);
  const locked = media.lockedPublisherKeys.value.length;
  return `${count} ${copy.value.lineCount}${locked ? ` · ${copy.value.lockedCount} ${formatBrandMediaCount(locked)}` : ""}`;
});

const emptyTableMessage = computed(() => {
  if (!media.merchantId.value) return copy.value.selectBrand;
  if (media.loading.value) return copy.value.loading;
  if (media.status.value === "brandMedia.noPermission") return copy.value.noPermission;
  if (media.status.value === "brandMedia.loadError") return copy.value.loadError;
  if (media.lockedPublisherKeys.value.length && !media.visiblePublishers.value.length) return copy.value.noLockedData;
  if (media.status.value === "brandMedia.noData") return copy.value.noData;
  return copy.value.noData;
});

const chartEmptyMessage = computed(() => {
  if (media.loading.value) return copy.value.loading;
  if (media.status.value === "brandMedia.noPermission") return copy.value.noPermission;
  if (media.status.value === "brandMedia.loadError") return copy.value.loadError;
  if (media.lockedPublisherKeys.value.length) return copy.value.noLockedData;
  if (media.payload.value && !media.payload.value.publishers.length) return copy.value.noData;
  return copy.value.selectBrand;
});

function selectMerchant(option: BrandMediaCatalogOption): void {
  media.selectMerchant(option);
  dropdownOpen.value = false;
  void media.loadTrend();
}

function applyQuickRange(days: number): void {
  media.setQuickRange(days);
  void media.loadTrend();
}

function onStartDateChange(event: Event): void {
  media.setDateRange((event.target as HTMLInputElement).value, media.endDate.value);
  void media.loadTrend();
}

function onEndDateChange(event: Event): void {
  media.setDateRange(media.startDate.value, (event.target as HTMLInputElement).value);
  void media.loadTrend();
}

function onDocumentClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element) || !target.closest(".brand-media-combobox")) dropdownOpen.value = false;
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  if (dropdownOpen.value) {
    dropdownOpen.value = false;
    return;
  }
  if (!media.chartExpanded.value) return;
  media.setChartExpanded(false);
  void nextTick(() => expandButton.value?.focus());
}

function syncRevenueFlowContext(): void {
  const bridgeRoot = document.getElementById("brandMediaModernRoot");
  if (!bridgeRoot) return;
  if (media.merchantId.value) {
    bridgeRoot.dataset.revenueFlowMerchantId = media.merchantId.value;
    bridgeRoot.dataset.revenueFlowMerchantName = media.merchantName.value || media.merchantId.value;
  } else {
    delete bridgeRoot.dataset.revenueFlowMerchantId;
    delete bridgeRoot.dataset.revenueFlowMerchantName;
  }
  bridgeRoot.dataset.revenueFlowStartDate = media.startDate.value;
  bridgeRoot.dataset.revenueFlowEndDate = media.endDate.value;
}

function setChartExpanded(expanded: boolean): void {
  media.setChartExpanded(expanded);
}

onMounted(() => {
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onDocumentKeydown);
  syncRevenueFlowContext();
  void media.loadCatalog();
});

onUnmounted(() => {
  document.removeEventListener("click", onDocumentClick);
  document.removeEventListener("keydown", onDocumentKeydown);
  document.body.classList.remove("brand-media-chart-expanded");
  media.unmount();
});

watch(() => media.chartExpanded.value, (expanded) => {
  document.body.classList.toggle("brand-media-chart-expanded", expanded);
});

watch([
  () => media.merchantId.value,
  () => media.merchantName.value,
  () => media.startDate.value,
  () => media.endDate.value
], syncRevenueFlowContext);
</script>

<template>
  <main class="oi-modern-page brand-media-page" data-page="brand-media">
    <header class="brand-media-header">
      <div>
        <span class="brand-media-eyebrow">{{ copy.eyebrow }}</span>
        <h1>{{ copy.title }}</h1>
        <p>{{ copy.subtitle }}</p>
      </div>
      <div class="brand-media-header-note"><span aria-hidden="true">●</span>{{ copy.liveSource }}</div>
    </header>

    <section class="panel brand-media-controls" aria-label="Brand media trend controls">
      <div class="brand-media-controls-grid">
        <label class="brand-media-field brand-media-merchant-field">
          <span>{{ copy.brand }}</span>
          <div class="brand-media-combobox">
            <input
              :value="media.merchantSearch.value"
              type="text"
              :placeholder="copy.brandPlaceholder"
              autocomplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-controls="brandMediaModernMerchantDropdown"
              :aria-expanded="dropdownOpen"
              @focus="dropdownOpen = true; void media.loadCatalog()"
              @input="media.setSearch(($event.target as HTMLInputElement).value); dropdownOpen = true"
              @keydown.escape="dropdownOpen = false"
            />
            <div v-if="dropdownOpen" id="brandMediaModernMerchantDropdown" class="brand-media-combobox-dropdown show" role="listbox">
              <button
                v-for="option in filteredMerchantOptions"
                :key="option.merchantId"
                type="button"
                class="brand-media-merchant-option"
                role="option"
                :aria-selected="media.merchantId.value === option.merchantId"
                :data-brand-media-merchant-id="option.merchantId"
                :data-brand-media-merchant-name="option.name"
                @click="selectMerchant(option)"
              >
                <span>{{ option.name }}</span>
                <small>ID {{ option.merchantId }} · {{ formatBrandMediaCount(option.count) }}</small>
              </button>
              <div v-if="!filteredMerchantOptions.length" class="brand-media-merchant-empty" role="option" aria-disabled="true">{{ copy.emptyCatalog }}</div>
            </div>
          </div>
        </label>

        <label class="brand-media-field brand-media-manager-field">
          <span>{{ copy.manager }}</span>
          <select
            class="brand-media-select"
            :value="media.managerFilter.value"
            :aria-label="copy.manager"
            @change="media.setManagerFilter(($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ copy.allManagers }}</option>
            <option v-for="manager in media.managerOptions.value" :key="manager" :value="manager">{{ manager }}</option>
          </select>
        </label>

        <div class="brand-media-field brand-media-range-field">
          <span>{{ copy.timeRange }}</span>
          <div class="brand-media-range-buttons" aria-label="Quick date ranges">
            <button v-for="days in [30, 90, 180, 365]" :key="days" type="button" :class="{ active: media.quickRange.value === String(days) }" :data-brand-media-range="days" @click="applyQuickRange(days)">{{ days === 365 ? "1Y" : `${days}D` }}</button>
          </div>
        </div>

        <label class="brand-media-field brand-media-date-field">
          <span>{{ copy.startDate }}</span>
          <input type="date" :value="media.startDate.value" :aria-label="copy.startDate" @change="onStartDateChange" />
        </label>
        <label class="brand-media-field brand-media-date-field">
          <span>{{ copy.endDate }}</span>
          <input type="date" :value="media.endDate.value" :aria-label="copy.endDate" @change="onEndDateChange" />
        </label>
      </div>
      <div class="brand-media-control-footer">
        <p class="brand-media-status" :data-kind="media.statusKind.value" role="status" aria-live="polite">{{ statusText }}</p>
        <p class="brand-media-source-note">{{ copy.sourceNote }}</p>
      </div>
    </section>

    <section class="brand-media-kpis" aria-label="Brand media performance summary">
      <template v-if="media.payload.value">
        <article v-for="(item, index) in [
          [copy.publisherCount, formatBrandMediaCount(media.summary.value.activePublisherCount)],
          [copy.totalRevenue, `$${media.summary.value.totalRevenue.toLocaleString('en-US', { maximumFractionDigits: 2 })}`],
          [copy.orders, formatBrandMediaCount(media.summary.value.totalOrders)],
          [copy.observations, formatBrandMediaCount(media.summary.value.observationCount)]
        ]" :key="item[0]" class="brand-media-kpi">
          <span>{{ String(index + 1).padStart(2, "0") }}</span>
          <strong>{{ item[1] }}</strong>
          <small>{{ item[0] }}</small>
        </article>
      </template>
    </section>

    <section id="brandMediaModernChartPanel" class="panel brand-media-chart-panel" :class="{ 'is-expanded': media.chartExpanded.value }" aria-labelledby="brandMediaModernChartTitle">
      <div class="brand-media-panel-heading">
        <div>
          <span class="brand-media-section-index">01</span>
          <h2 id="brandMediaModernChartTitle">{{ copy.chartTitle }}</h2>
          <p>{{ copy.chartSubtitle }}</p>
        </div>
        <div class="brand-media-chart-meta">
          <span v-if="media.chartModel.value && !media.lockedPublisherKeys.value.length" class="brand-media-total-key"><i aria-hidden="true" />{{ translateMessage(language, "brandMedia.allOrderLine", "All media orders") }}</span>
          <span class="brand-media-line-count" aria-live="polite">{{ media.payload.value ? lineCountText : "" }}</span>
          <button ref="expandButton" type="button" class="brand-media-chart-expand" aria-controls="brandMediaModernChartPanel" :aria-expanded="media.chartExpanded.value" :aria-label="media.chartExpanded.value ? copy.collapseChart : copy.expandChart" :title="media.chartExpanded.value ? copy.collapseChart : copy.expandChart" @click="setChartExpanded(!media.chartExpanded.value)">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 3H3v5M3 3l6 6M16 3h5v5M21 3l-6 6M8 21H3v-5M3 21l6-6M16 21h5v-5M21 21l-6-6" /></svg>
            <span class="sr-only">{{ media.chartExpanded.value ? copy.collapseChart : copy.expandChart }}</span>
          </button>
        </div>
      </div>
      <div class="brand-media-chart-layout">
        <BrandMediaChart
          :model="media.chartModel.value"
          :publishers="media.managerPublishers.value"
          :locked-keys="media.lockedPublisherKeys.value"
          :language="language"
          :merchant-name="media.merchantName.value"
          :empty-message="chartEmptyMessage"
          @toggle-lock="media.togglePublisherLock"
        />
      </div>
    </section>

    <section v-if="media.lockedPublisherKeys.value.length" class="panel brand-media-clicks-panel" aria-labelledby="brandMediaModernClicksTitle">
      <div class="brand-media-panel-heading">
        <div>
          <span class="brand-media-section-index">02</span>
          <h2 id="brandMediaModernClicksTitle">{{ copy.clicksTitle }}</h2>
          <p>{{ copy.clicksSubtitle }}</p>
        </div>
        <span class="brand-media-line-count">{{ formatBrandMediaCount(media.visiblePublishers.value.length) }} {{ copy.clicksCount }}</span>
      </div>
      <BrandMediaClicksChart :model="media.clickChartModel.value" :language="language" :empty-message="copy.clicksEmpty" />
    </section>

    <section class="panel brand-media-table-panel" aria-labelledby="brandMediaModernTableTitle">
      <div class="brand-media-panel-heading brand-media-table-heading">
        <div>
          <span class="brand-media-section-index">03</span>
          <h2 id="brandMediaModernTableTitle">{{ copy.tableTitle }}</h2>
          <p>{{ copy.tableSubtitle }}</p>
        </div>
        <span class="brand-media-table-count">{{ media.payload.value ? lineCountText : "" }}</span>
      </div>
      <BrandMediaTable :publishers="media.visiblePublishers.value" :language="language" :empty-message="emptyTableMessage" />
    </section>
  </main>
</template>
