<script setup lang="ts">
import { computed } from "vue";

import type {
  OfferTrackerFilters as TrackerFilters,
  OfferTrackerRevenueSort,
  UiLanguage
} from "../../shared/contracts/offer";

const props = defineProps<{
  modelValue: TrackerFilters;
  search: string;
  language: UiLanguage;
  tiers: readonly string[];
  categories: readonly string[];
  networks: readonly string[];
  loading: boolean;
}>();

const copy = computed(() => props.language === "zh"
  ? {
    search: "搜索 Offer",
    searchPlaceholder: "商户、ID、网络或品类",
    tiers: "Tier 筛选",
    categories: "品类筛选",
    networks: "Network 筛选",
    startDate: "开始日期",
    endDate: "结束日期",
    minAov: "最小 AOV",
    maxAov: "最大 AOV",
    minCommission: "最小 AFF Commission",
    maxCommission: "最大 AFF Commission",
    bbPolicy: "BB Preference",
    revenueStatus: "Revenue 状态",
    sort: "排序",
    all: "全部",
    mind: "介意 BB",
    open: "不介意 BB",
    unknown: "未知",
    positiveRevenue: "有 Revenue",
    noRevenue: "无 Revenue",
    priority: "优先级",
    revenueDesc: "Revenue 从高到低",
    revenueAsc: "Revenue 从低到高",
    rangeHint: "日期范围最多 366 天",
    reset: "重置",
    apply: "应用筛选",
    loading: "加载中…"
  }
  : {
    search: "Search offers",
    searchPlaceholder: "Search merchant, ID, network, or category",
    tiers: "Tier filters",
    categories: "Category filters",
    networks: "Network filters",
    startDate: "Start date",
    endDate: "End date",
    minAov: "Min AOV",
    maxAov: "Max AOV",
    minCommission: "Min AFF Commission",
    maxCommission: "Max AFF Commission",
    bbPolicy: "BB Preference",
    revenueStatus: "Revenue status",
    sort: "Sort",
    all: "All",
    mind: "Mind BB",
    open: "Doesn't mind BB",
    unknown: "Unknown",
    positiveRevenue: "Positive revenue",
    noRevenue: "No revenue",
    priority: "Priority",
    revenueDesc: "Revenue: high to low",
    revenueAsc: "Revenue: low to high",
    rangeHint: "Date range cannot exceed 366 days",
    reset: "Reset",
    apply: "Apply filters",
    loading: "Loading…"
  });

const emit = defineEmits<{
  (event: "update:modelValue", value: TrackerFilters): void;
  (event: "update:search", value: string): void;
  (event: "sort-change", value: OfferTrackerRevenueSort): void;
  (event: "apply"): void;
  (event: "reset"): void;
}>();

function inputValue(event: Event): string {
  return event.target instanceof HTMLInputElement ? event.target.value : "";
}

function selectValue(event: Event): string {
  return event.target instanceof HTMLSelectElement ? event.target.value : "";
}

function multiSelectValues(event: Event): string[] {
  if (!(event.target instanceof HTMLSelectElement)) return [];
  return Array.from(event.target.selectedOptions).map((option) => option.value);
}

function updateField<K extends keyof TrackerFilters>(field: K, value: TrackerFilters[K]): void {
  emit("update:modelValue", { ...props.modelValue, [field]: value });
}

function updateSort(event: Event): void {
  const value = selectValue(event) as OfferTrackerRevenueSort;
  updateField("revenueSort", value);
  emit("sort-change", value);
}
</script>

<template>
  <form class="offer-tracker-modern-filters" @submit.prevent="emit('apply')">
    <div class="offer-tracker-filter-grid">
      <label class="offer-tracker-filter-field offer-tracker-filter-search">
        <span>{{ copy.search }}</span>
        <input
          :value="search"
          type="search"
          :aria-label="copy.search"
          :placeholder="copy.searchPlaceholder"
          autocomplete="off"
          @input="emit('update:search', inputValue($event))"
        >
      </label>

      <label class="offer-tracker-filter-field">
        <span>{{ copy.tiers }}</span>
        <select
          :value="modelValue.tiers"
          multiple
          :aria-label="copy.tiers"
          @change="updateField('tiers', multiSelectValues($event))"
        >
          <option v-for="tier in tiers" :key="tier" :value="tier">{{ tier }}</option>
        </select>
      </label>

      <label class="offer-tracker-filter-field">
        <span>{{ copy.categories }}</span>
        <select
          :value="modelValue.categories"
          multiple
          :aria-label="copy.categories"
          @change="updateField('categories', multiSelectValues($event))"
        >
          <option v-for="category in categories" :key="category" :value="category">{{ category }}</option>
        </select>
      </label>

      <label class="offer-tracker-filter-field">
        <span>{{ copy.networks }}</span>
        <select
          :value="modelValue.networks"
          multiple
          :aria-label="copy.networks"
          @change="updateField('networks', multiSelectValues($event))"
        >
          <option v-for="network in networks" :key="network" :value="network">{{ network }}</option>
        </select>
      </label>

      <label class="offer-tracker-filter-field">
        <span>{{ copy.startDate }}</span>
        <input
          :value="modelValue.startDate"
          type="date"
          :aria-label="copy.startDate"
          @input="updateField('startDate', inputValue($event))"
        >
      </label>

      <label class="offer-tracker-filter-field">
        <span>{{ copy.endDate }}</span>
        <input
          :value="modelValue.endDate"
          type="date"
          :aria-label="copy.endDate"
          @input="updateField('endDate', inputValue($event))"
        >
      </label>

      <label class="offer-tracker-filter-field">
        <span>{{ copy.minAov }}</span>
        <input
          :value="modelValue.minAov"
          type="number"
          min="0"
          step="any"
          :aria-label="copy.minAov"
          @input="updateField('minAov', inputValue($event))"
        >
      </label>

      <label class="offer-tracker-filter-field">
        <span>{{ copy.maxAov }}</span>
        <input
          :value="modelValue.maxAov"
          type="number"
          min="0"
          step="any"
          :aria-label="copy.maxAov"
          @input="updateField('maxAov', inputValue($event))"
        >
      </label>

      <label class="offer-tracker-filter-field">
        <span>{{ copy.minCommission }}</span>
        <input
          :value="modelValue.minCommission"
          type="number"
          min="0"
          step="any"
          :aria-label="copy.minCommission"
          @input="updateField('minCommission', inputValue($event))"
        >
      </label>

      <label class="offer-tracker-filter-field">
        <span>{{ copy.maxCommission }}</span>
        <input
          :value="modelValue.maxCommission"
          type="number"
          min="0"
          step="any"
          :aria-label="copy.maxCommission"
          @input="updateField('maxCommission', inputValue($event))"
        >
      </label>

      <label class="offer-tracker-filter-field">
        <span>{{ copy.bbPolicy }}</span>
        <select
          :value="modelValue.bbPolicy"
          :aria-label="copy.bbPolicy"
          @change="updateField('bbPolicy', selectValue($event) as TrackerFilters['bbPolicy'])"
        >
          <option value="all">{{ copy.all }}</option>
          <option value="mind">{{ copy.mind }}</option>
          <option value="open">{{ copy.open }}</option>
          <option value="unknown">{{ copy.unknown }}</option>
        </select>
      </label>

      <label class="offer-tracker-filter-field">
        <span>{{ copy.revenueStatus }}</span>
        <select
          :value="modelValue.revenueStatus"
          :aria-label="copy.revenueStatus"
          @change="updateField('revenueStatus', selectValue($event) as TrackerFilters['revenueStatus'])"
        >
          <option value="all">{{ copy.all }}</option>
          <option value="positive">{{ copy.positiveRevenue }}</option>
          <option value="none">{{ copy.noRevenue }}</option>
        </select>
      </label>

      <label class="offer-tracker-filter-field">
        <span>{{ copy.sort }}</span>
        <select
          :value="modelValue.revenueSort"
          :aria-label="copy.sort"
          @change="updateSort"
        >
          <option value="priority">{{ copy.priority }}</option>
          <option value="revenue-desc">{{ copy.revenueDesc }}</option>
          <option value="revenue-asc">{{ copy.revenueAsc }}</option>
        </select>
      </label>
    </div>

    <div class="offer-tracker-filter-actions">
      <span class="offer-tracker-filter-hint">{{ copy.rangeHint }}</span>
      <div>
        <button type="button" class="offer-tracker-secondary-button" :disabled="loading" @click="emit('reset')">{{ copy.reset }}</button>
        <button type="submit" class="offer-tracker-primary-button" :aria-label="copy.apply" :disabled="loading">
          {{ loading ? copy.loading : copy.apply }}
        </button>
      </div>
    </div>
  </form>
</template>
