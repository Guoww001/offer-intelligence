<script setup lang="ts">
import { computed } from "vue";

import { formatMoney } from "../../shared/format/money";
import { formatInteger } from "../../shared/format/number";
import { formatPercentage } from "../../shared/format/percentage";
import type {
  OfferTrackerRow,
  OfferTrackerSelectionSummary,
  OfferTrackerView,
  UiLanguage
} from "../../shared/contracts/offer";
import { aovTypeLabel, bbPolicyLabel, priorityLabel } from "./offerTrackerModel";

const props = defineProps<{
  rows: readonly OfferTrackerRow[];
  totalRows: number;
  page: number;
  totalPages: number;
  pageSize: number;
  selectedKeys: ReadonlySet<string>;
  summary: OfferTrackerSelectionSummary;
  view: OfferTrackerView;
  language: UiLanguage;
}>();

const emit = defineEmits<{
  (event: "toggle-row", key: string, selected: boolean): void;
  (event: "toggle-page", selected: boolean): void;
  (event: "toggle-all"): void;
  (event: "page-change", page: number): void;
}>();

const isProductsView = computed(() => props.view === "products");
const copy = computed(() => props.language === "zh"
  ? {
    selected: "已选择",
    selectAll: "选择全部匹配",
    clearAll: "清除匹配选择",
    currentPage: "选择当前页",
    priority: "优先级",
    merchant: "商户",
    tier: "Tier",
    commission: "AFF 佣金",
    aov: "AOV",
    revenue: "Revenue",
    aovType: "AOV 类型",
    bbPolicy: "BB Preference",
    category: "品类",
    recommendation: "推荐说明",
    topAsins: "Top Rank ASINs",
    empty: "没有符合当前筛选条件的 Offer，请调整筛选条件。",
    previous: "上一页",
    next: "下一页",
    results: "Offer Tracker 结果",
    pagination: "Offer Tracker 分页",
    selectRow: "选择",
    unknown: "未知"
  }
  : {
    selected: "Selected",
    selectAll: "Select all matching",
    clearAll: "Clear matching selection",
    currentPage: "Select current page",
    priority: "Priority",
    merchant: "Merchant",
    tier: "Tier",
    commission: "AFF Commission",
    aov: "AOV",
    revenue: "Revenue",
    aovType: "AOV Type",
    bbPolicy: "BB Preference",
    category: "Category",
    recommendation: "Recommendation",
    topAsins: "Top Rank ASINs",
    empty: "No offers match the current filters. Adjust the filters and try again.",
    previous: "Previous",
    next: "Next",
    results: "Offer Tracker results",
    pagination: "Offer Tracker pagination",
    selectRow: "Select",
    unknown: "Unknown"
  });

function checked(event: Event): boolean {
  return event.target instanceof HTMLInputElement && event.target.checked;
}

function rangeLabel(): string {
  if (!props.totalRows) return props.language === "zh" ? "0 个 Offer" : "0 offers";
  const start = (props.page - 1) * props.pageSize + 1;
  const end = Math.min(props.page * props.pageSize, props.totalRows);
  return props.language === "zh"
    ? `显示第 ${formatInteger(start)}–${formatInteger(end)} 条，共 ${formatInteger(props.totalRows)} 个 Offer`
    : `Showing ${formatInteger(start)}–${formatInteger(end)} of ${formatInteger(props.totalRows)} offers`;
}

function selectedLabel(): string {
  return props.language === "zh"
    ? `${copy.value.selected} ${formatInteger(props.summary.selectedCount)} 个`
    : `${copy.value.selected} ${formatInteger(props.summary.selectedCount)} offers`;
}
</script>

<template>
  <section class="offer-tracker-modern-table-panel" :aria-label="copy.results">
    <div class="offer-tracker-table-toolbar">
      <div>
        <strong>{{ rangeLabel() }}</strong>
        <span class="offer-tracker-selection-count">{{ selectedLabel() }}</span>
      </div>
      <button
        type="button"
        class="offer-tracker-selection-button"
        :aria-label="copy.selectAll"
        :aria-pressed="summary.allFilteredSelected ? 'true' : 'false'"
        :disabled="!totalRows"
        @click="emit('toggle-all')"
      >
        {{ summary.allFilteredSelected ? copy.clearAll : copy.selectAll }}
      </button>
    </div>

    <div class="offer-tracker-table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">
              <input
                type="checkbox"
                :aria-label="copy.currentPage"
                :checked="summary.allPageSelected"
                :disabled="!rows.length"
                @change="emit('toggle-page', checked($event))"
              >
            </th>
            <th scope="col">{{ copy.priority }}</th>
            <th scope="col">{{ copy.merchant }}</th>
            <th v-if="!isProductsView" scope="col">{{ copy.tier }}</th>
            <th v-if="!isProductsView" scope="col">{{ copy.commission }}</th>
            <th scope="col">{{ copy.aov }}</th>
            <th scope="col">{{ copy.revenue }}</th>
            <th scope="col">{{ copy.aovType }}</th>
            <th scope="col">{{ copy.bbPolicy }}</th>
            <th scope="col">{{ copy.category }}</th>
            <th scope="col">{{ isProductsView ? copy.topAsins : copy.recommendation }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.key" :data-row-key="row.key" :class="{ 'is-selected': selectedKeys.has(row.key) }">
            <td>
              <input
                type="checkbox"
                :data-row-select="row.key"
                :aria-label="`${copy.selectRow} ${row.merchantName}`"
                :checked="selectedKeys.has(row.key)"
                @change="emit('toggle-row', row.key, checked($event))"
              >
            </td>
            <td>
              <span class="offer-tracker-priority-label">{{ priorityLabel(row.priority.key, language) }}</span>
              <small>Score {{ row.score }}</small>
            </td>
            <td>
              <strong>{{ row.merchantName }}</strong>
              <small>{{ row.merchantId || "—" }}</small>
            </td>
            <td v-if="!isProductsView">{{ row.tier || copy.unknown }}</td>
            <td v-if="!isProductsView">{{ formatPercentage(row.commissionRate) }}</td>
            <td>{{ row.aov > 0 ? formatMoney(row.aov) : "—" }}</td>
            <td>{{ formatMoney(row.revenue) }}</td>
            <td><span :class="`offer-tracker-aov-type ${row.aovType}`">{{ aovTypeLabel(row.aovType, language) }}</span></td>
            <td><span :class="`offer-tracker-bb-policy ${row.bbPolicy}`">{{ bbPolicyLabel(row.bbPolicy, language) }}</span></td>
            <td>{{ row.category }}</td>
            <td>
              <span v-if="!isProductsView">{{ priorityLabel(row.priority.key, language) }}</span>
              <span v-else>{{ row.asins.length ? row.asins.join(", ") : "—" }}</span>
            </td>
          </tr>
          <tr v-if="!rows.length" data-empty-state>
            <td colspan="11">{{ copy.empty }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <nav class="offer-tracker-pagination" :aria-label="copy.pagination">
      <button
        type="button"
        :aria-label="copy.previous"
        :disabled="page <= 1"
        @click="emit('page-change', page - 1)"
      >{{ copy.previous }}</button>
      <span>{{ props.language === 'zh' ? `第 ${page} / ${totalPages} 页` : `Page ${page} / ${totalPages}` }}</span>
      <button
        type="button"
        :aria-label="copy.next"
        :disabled="page >= totalPages"
        @click="emit('page-change', page + 1)"
      >{{ copy.next }}</button>
    </nav>
  </section>
</template>
