<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";

import { translateMessage, type UiLanguage } from "../../shared/i18n";
import { MAX_REVENUE_FLOW_BRANDS, type RevenueFlowCatalogOption } from "./revenueFlowModel";
import RevenueFlowSankey from "./RevenueFlowSankey.vue";
import {
  useRevenueFlow,
  type RevenueFlowCatalogLoader,
  type RevenueFlowTrendLoader
} from "./useRevenueFlow";

const props = defineProps<{
  catalogData?: unknown;
  initialMerchants?: readonly RevenueFlowCatalogOption[];
  initialStartDate?: string;
  initialEndDate?: string;
  language: UiLanguage;
  today?: () => Date;
  loadCatalog?: RevenueFlowCatalogLoader;
  loadTrend?: RevenueFlowTrendLoader;
}>();

const flow = useRevenueFlow({
  catalogData: props.catalogData,
  initialMerchants: props.initialMerchants,
  initialStartDate: props.initialStartDate,
  initialEndDate: props.initialEndDate,
  loadCatalog: props.loadCatalog,
  loadTrend: props.loadTrend,
  today: props.today
});

const pageRoot = ref<HTMLElement | null>(null);
const expandButton = ref<HTMLButtonElement | null>(null);

const copy = computed(() => ({
  eyebrow: translateMessage(props.language, "revenueFlow.eyebrow", "REVENUE ATTRIBUTION"),
  title: translateMessage(props.language, "revenueFlow.title", "Revenue flow"),
  subtitle: translateMessage(props.language, "revenueFlow.subtitle", "Trace one or more brands' revenue from products to the media that generated it."),
  liveSource: translateMessage(props.language, "revenueFlow.liveSource", "Order-level revenue"),
  brand: translateMessage(props.language, "revenueFlow.brand", "Brands"),
  brandPlaceholder: translateMessage(props.language, "revenueFlow.brandPlaceholder", "Search brands or Merchant IDs"),
  noMatch: translateMessage(props.language, "revenueFlow.noMatch", "No matching brand"),
  selectedBrands: translateMessage(props.language, "revenueFlow.selectedBrands", "Selected brands"),
  clearBrands: translateMessage(props.language, "revenueFlow.clearBrands", "Clear brands"),
  brandLimit: translateMessage(props.language, "revenueFlow.brandLimit", "You can select up to 12 brands."),
  timeRange: translateMessage(props.language, "revenueFlow.timeRange", "Time range"),
  startDate: translateMessage(props.language, "revenueFlow.startDate", "Start date"),
  endDate: translateMessage(props.language, "revenueFlow.endDate", "End date"),
  sourceNote: translateMessage(props.language, "revenueFlow.sourceNote", "Only positive order Revenue is included. Select multiple brands to compare product and media attribution."),
  chartTitle: translateMessage(props.language, "revenueFlow.chartTitle", "Revenue attribution flow"),
  chartSubtitle: translateMessage(props.language, "revenueFlow.chartSubtitle", "Hover a node to trace its connected revenue; click a product or media node to lock the path."),
  brandColumn: translateMessage(props.language, "revenueFlow.brandColumn", "Brands"),
  products: translateMessage(props.language, "revenueFlow.products", "Products"),
  media: translateMessage(props.language, "revenueFlow.media", "Media"),
  brandCount: translateMessage(props.language, "revenueFlow.brandCount", "Brands"),
  productCount: translateMessage(props.language, "revenueFlow.productCount", "Products"),
  mediaCount: translateMessage(props.language, "revenueFlow.mediaCount", "Media"),
  totalRevenue: translateMessage(props.language, "revenueFlow.totalRevenue", "Total Revenue"),
  linkCount: translateMessage(props.language, "revenueFlow.linkCount", "Revenue links"),
  loading: translateMessage(props.language, "revenueFlow.loading", "Loading revenue flow…"),
  error: translateMessage(props.language, "revenueFlow.error", "Unable to load revenue flow. Adjust the date range and try again."),
  noPermission: translateMessage(props.language, "revenueFlow.noPermission", "You do not have permission to view revenue flow data."),
  empty: translateMessage(props.language, "revenueFlow.empty", "No positive order Revenue is available in this range."),
  unavailable: translateMessage(props.language, "revenueFlow.unavailable", "Order data does not include product fields, so Revenue flow cannot be generated."),
  selectBrand: translateMessage(props.language, "revenueFlow.selectBrand", "Select at least one brand to load revenue flow."),
  expandChart: translateMessage(props.language, "revenueFlow.expandChart", "Expand chart"),
  collapseChart: translateMessage(props.language, "revenueFlow.collapseChart", "Exit expanded chart")
}));

const statusText = computed(() => {
  const key = flow.status.value;
  if (!key) return "";
  if (key === "revenueFlow.brandLimit") return copy.value.brandLimit;
  if (key === "revenueFlow.loading") return copy.value.loading;
  if (key === "revenueFlow.noPermission") return copy.value.noPermission;
  if (key === "revenueFlow.loadError") return copy.value.error;
  if (key === "revenueFlow.empty") return copy.value.empty;
  if (key === "revenueFlow.unavailable") return copy.value.unavailable;
  if (key === "revenueFlow.selectBrand") return copy.value.selectBrand;
  return translateMessage(props.language, key, key);
});

const chartEmptyMessage = computed(() => {
  if (flow.loading.value) return copy.value.loading;
  if (flow.status.value === "revenueFlow.noPermission") return copy.value.noPermission;
  if (flow.status.value === "revenueFlow.loadError") return copy.value.error;
  if (flow.status.value === "revenueFlow.unavailable") return copy.value.unavailable;
  if (!flow.selectedMerchants.value.length) return copy.value.selectBrand;
  return copy.value.empty;
});

const kpis = computed(() => [
  { key: "brands", label: copy.value.brandCount, value: formatCount(flow.summary.value.brandCount) },
  { key: "revenue", label: copy.value.totalRevenue, value: formatMoney(flow.summary.value.totalRevenue) },
  { key: "products", label: copy.value.productCount, value: formatCount(flow.summary.value.productCount) },
  { key: "media", label: copy.value.mediaCount, value: formatCount(flow.summary.value.mediaCount) },
  { key: "links", label: copy.value.linkCount, value: formatCount(flow.summary.value.linkCount) }
]);

function formatCount(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatMoney(value: number): string {
  return "$" + value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

function isSelected(option: RevenueFlowCatalogOption): boolean {
  return flow.selectedIds.value.includes(option.merchantId);
}

function selectMerchant(option: RevenueFlowCatalogOption): void {
  if (!flow.toggleMerchant(option)) return;
  void flow.loadTrend();
}

function removeMerchant(merchantId: string): void {
  flow.removeMerchant(merchantId);
  if (flow.selectedMerchants.value.length) void flow.loadTrend();
}

function clearMerchants(): void {
  flow.clearMerchants();
}

function applyQuickRange(days: number): void {
  flow.setQuickRange(days);
  if (flow.selectedMerchants.value.length) void flow.loadTrend();
}

function onStartDateChange(event: Event): void {
  flow.setDateRange((event.target as HTMLInputElement).value, flow.endDate.value);
  if (flow.selectedMerchants.value.length) void flow.loadTrend();
}

function onEndDateChange(event: Event): void {
  flow.setDateRange(flow.startDate.value, (event.target as HTMLInputElement).value);
  if (flow.selectedMerchants.value.length) void flow.loadTrend();
}

function onDocumentClick(event: MouseEvent): void {
  if (!(event.target instanceof Element) || !event.target.closest(".revenue-flow-combobox")) {
    flow.setDropdownOpen(false);
  }
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  if (flow.dropdownOpen.value) {
    flow.setDropdownOpen(false);
    return;
  }
  if (!flow.chartExpanded.value) return;
  flow.setChartExpanded(false);
  void nextTick(() => expandButton.value?.focus());
}

function setChartExpanded(expanded: boolean): void {
  flow.setChartExpanded(expanded);
}

onMounted(() => {
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onDocumentKeydown);
  void flow.loadCatalog();
  if (flow.selectedMerchants.value.length) void flow.loadTrend();
});

onUnmounted(() => {
  document.removeEventListener("click", onDocumentClick);
  document.removeEventListener("keydown", onDocumentKeydown);
  document.body.classList.remove("revenue-flow-chart-expanded");
  flow.unmount();
});

watch(() => flow.chartExpanded.value, (expanded) => {
  document.body.classList.toggle("revenue-flow-chart-expanded", expanded);
});
</script>

<template>
  <main
    ref="pageRoot"
    class="oi-modern-page brand-media-page revenue-flow-page"
    :class="{ 'is-chart-expanded': flow.chartExpanded.value }"
    data-page="revenue-flow"
  >
    <header class="brand-media-header revenue-flow-header">
      <div>
        <span class="brand-media-eyebrow">{{ copy.eyebrow }}</span>
        <h1>{{ copy.title }}</h1>
        <p>{{ copy.subtitle }}</p>
      </div>
      <div class="brand-media-header-note"><span aria-hidden="true">●</span>{{ copy.liveSource }}</div>
    </header>

    <section class="panel brand-media-controls revenue-flow-controls" aria-label="Revenue flow controls">
      <div class="brand-media-controls-grid revenue-flow-controls-grid">
        <div class="brand-media-field brand-media-merchant-field revenue-flow-merchant-field">
          <span>{{ copy.brand }}</span>
          <div class="brand-media-combobox revenue-flow-combobox">
            <input
              :value="flow.merchantSearch.value"
              type="search"
              role="combobox"
              :placeholder="copy.brandPlaceholder"
              :aria-expanded="flow.dropdownOpen.value"
              aria-controls="revenueFlowMerchantDropdown"
              autocomplete="off"
              @focus="flow.setDropdownOpen(true)"
              @click="flow.setDropdownOpen(true)"
              @input="flow.setSearch(($event.target as HTMLInputElement).value); flow.setDropdownOpen(true)"
            >
            <div
              v-if="flow.dropdownOpen.value"
              id="revenueFlowMerchantDropdown"
              class="brand-media-combobox-dropdown revenue-flow-merchant-dropdown"
              role="listbox"
              aria-multiselectable="true"
            >
              <button
                v-for="option in flow.filteredMerchantOptions.value"
                :key="option.merchantId"
                type="button"
                class="brand-media-merchant-option revenue-flow-merchant-option"
                :class="{ 'is-selected': isSelected(option) }"
                role="option"
                :aria-selected="isSelected(option)"
                @click="selectMerchant(option)"
              >
                <span><i aria-hidden="true">{{ isSelected(option) ? "✓" : "" }}</i>{{ option.name }}</span>
                <small>{{ option.merchantId }}</small>
              </button>
              <p v-if="!flow.filteredMerchantOptions.value.length" class="revenue-flow-no-match">{{ copy.noMatch }}</p>
            </div>
          </div>
          <div class="revenue-flow-selected-brands" :aria-label="copy.selectedBrands">
            <span
              v-for="merchant in flow.selectedMerchants.value"
              :key="merchant.merchantId"
              class="revenue-flow-selected-brand"
            >
              {{ merchant.name }}
              <button type="button" :aria-label="copy.clearBrands + ': ' + merchant.name" @click="removeMerchant(merchant.merchantId)">×</button>
            </span>
            <button
              v-if="flow.selectedMerchants.value.length"
              type="button"
              class="revenue-flow-clear-brands"
              @click="clearMerchants"
            >{{ copy.clearBrands }}</button>
          </div>
        </div>

        <div class="brand-media-field brand-media-range-field revenue-flow-range-field">
          <span>{{ copy.timeRange }}</span>
          <div class="brand-media-range-buttons revenue-flow-range-buttons">
            <button
              v-for="days in [30, 90, 180, 365]"
              :key="days"
              type="button"
              :class="{ active: flow.quickRange.value === String(days) }"
              :aria-pressed="flow.quickRange.value === String(days)"
              :data-revenue-flow-range="days"
              @click="applyQuickRange(days)"
            >{{ days }}d</button>
          </div>
        </div>

        <label class="brand-media-field brand-media-date-field revenue-flow-date-field">
          <span>{{ copy.startDate }}</span>
          <input type="date" :value="flow.startDate.value" @change="onStartDateChange">
        </label>
        <label class="brand-media-field brand-media-date-field revenue-flow-date-field">
          <span>{{ copy.endDate }}</span>
          <input type="date" :value="flow.endDate.value" @change="onEndDateChange">
        </label>
      </div>
      <div class="brand-media-control-footer revenue-flow-control-footer">
        <p class="brand-media-status revenue-flow-status" :class="{ 'is-error': flow.statusKind.value === 'error', 'is-loading': flow.statusKind.value === 'loading' }" role="status" aria-live="polite">{{ statusText }}</p>
        <p class="brand-media-source-note revenue-flow-source-note">{{ copy.sourceNote }}</p>
      </div>
    </section>

    <section class="brand-media-kpis revenue-flow-kpis" aria-label="Revenue flow summary">
      <article v-for="kpi in kpis" :key="kpi.key" class="brand-media-kpi revenue-flow-kpi" data-testid="revenue-flow-kpi">
        <span>{{ kpi.label }}</span>
        <strong>{{ kpi.value }}</strong>
      </article>
    </section>

    <section class="panel brand-media-sankey-panel revenue-flow-panel" :class="{ 'is-expanded': flow.chartExpanded.value }" aria-labelledby="revenueFlowTitle">
      <header class="brand-media-sankey-head revenue-flow-panel-head">
        <div>
          <h2 id="revenueFlowTitle">{{ copy.chartTitle }}</h2>
          <p>{{ copy.chartSubtitle }}</p>
        </div>
        <div class="revenue-flow-panel-actions">
          <span class="brand-media-sankey-count revenue-flow-count" aria-live="polite">
            {{ formatCount(flow.summary.value.linkCount) }} {{ copy.linkCount }}
          </span>
          <button
            ref="expandButton"
            type="button"
            class="brand-media-chart-expand revenue-flow-expand"
            data-testid="revenue-flow-expand"
            aria-controls="revenueFlowPanel"
            :aria-expanded="flow.chartExpanded.value"
            @click="setChartExpanded(!flow.chartExpanded.value)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M8 3H3v5M3 3l6 6M16 3h5v5M21 3l-6 6M8 21H3v-5M3 21l6-6M16 21h5v-5M21 21l-6-6" />
            </svg>
            <span class="brand-media-chart-expand-label sr-only">{{ flow.chartExpanded.value ? copy.collapseChart : copy.expandChart }}</span>
          </button>
        </div>
      </header>
      <RevenueFlowSankey
        :model="flow.model.value"
        :language="props.language"
        :empty-message="chartEmptyMessage"
        :loading="flow.loading.value"
        :locked-node-id="flow.lockedNodeId.value"
        :zoom="flow.chartZoom.value"
        @toggle-node="flow.toggleNode"
        @set-zoom="flow.setChartZoom"
        @reset-zoom="flow.resetChartZoom"
      />
    </section>
  </main>
</template>
