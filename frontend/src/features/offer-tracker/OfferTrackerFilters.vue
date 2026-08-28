<script setup lang="ts">
import { computed, ref } from "vue";

import type {
  OfferTrackerFilters as TrackerFilters,
  OfferTrackerRevenueSort,
  UiLanguage
} from "../../shared/contracts/offer";
import { translateMessage } from "../../shared/i18n";

const props = defineProps<{
  modelValue: TrackerFilters;
  language: UiLanguage;
  tiers: readonly string[];
  categories: readonly string[];
  networks: readonly string[];
  loading: boolean;
}>();

const emit = defineEmits<{
  (event: "update:modelValue", value: TrackerFilters): void;
  (event: "sort-change", value: OfferTrackerRevenueSort): void;
  (event: "apply"): void;
  (event: "reset"): void;
}>();

type MultiSelectKey = "tiers" | "categories" | "networks";
const openMenu = ref<MultiSelectKey | "">("");

const copy = computed(() => {
  const message = (key: string, fallback: string) => translateMessage(props.language, key, fallback);
  return {
    heading: message("offerTracker.defineRange", "定义 Offer 范围"),
    subtitle: message("offerTracker.defineRangeSubtitle", "先选择商业范围，再查看并导出对应的优先级清单。"),
    liveSource: message("offerTracker.liveSource", "实时 OFFER 缓存"),
    tiers: message("offerTracker.filterTiers", props.language === "zh" ? "分层" : "Tier filters"),
    nativeTiers: message("offerTracker.tiers", props.language === "zh" ? "Tier 筛选" : "Tier filters"),
    categories: message("offerTracker.filterCategories", props.language === "zh" ? "品类" : "Category filters"),
    networks: message("offerTracker.filterNetworks", props.language === "zh" ? "网络" : "Network filters"),
    startDate: message("offerTracker.startDate", "开始日期"),
    endDate: message("offerTracker.endDate", "结束日期"),
    timeRange: message("offerTracker.timeRange", "时间范围"),
    aovRange: message("offerTracker.aovRange", "AOV 范围"),
    commissionRange: message("offerTracker.commissionRange", "AFF 佣金范围"),
    minAov: message("offerTracker.minAov", "Min $"),
    maxAov: message("offerTracker.maxAov", "Max $"),
    minCommission: message("offerTracker.minCommission", "Min %"),
    maxCommission: message("offerTracker.maxCommission", "Max %"),
    bbPolicy: message("offerTracker.filterBbPolicy", props.language === "zh" ? "是否介意 BB" : "BB Preference"),
    revenueStatus: message("offerTracker.filterRevenueStatus", props.language === "zh" ? "REVENUE 状态" : "Revenue status"),
    sort: message("offerTracker.filterSort", props.language === "zh" ? "REVENUE 排序" : "Sort"),
    nativeSort: message("offerTracker.sort", props.language === "zh" ? "排序" : "Sort"),
    allTiers: message("offerTracker.allTiers", "全部分层"),
    allCategories: message("offerTracker.allCategories", "全部品类"),
    allNetworks: message("offerTracker.allNetworks", "全部网络"),
    all: message("common.all", "全部"),
    mind: message("offerTracker.mind", "介意 BB"),
    open: message("offerTracker.open", "不介意 BB"),
    unknown: message("common.unknown", "未知"),
    positiveRevenue: message("offerTracker.positiveRevenue", "有 Revenue"),
    noRevenue: message("offerTracker.noRevenue", "无 Revenue"),
    priority: message("offerTracker.priority", "默认优先级"),
    revenueDesc: message("offerTracker.revenueDesc", "Revenue 从高到低"),
    revenueAsc: message("offerTracker.revenueAsc", "Revenue 从低到高"),
    rangeHint: message("offerTracker.dataRangeLabel", props.language === "zh" ? "数据范围：" : "Data range: "),
    datePrefix: message("offerTracker.datePrefix", "日期"),
    reset: message("common.reset", "重置"),
    apply: message("common.apply", "应用筛选"),
    loading: message("common.loading", "加载中…")
  };
});

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

function toggleMenu(key: MultiSelectKey): void {
  openMenu.value = openMenu.value === key ? "" : key;
}

function valuesFor(key: MultiSelectKey): readonly string[] {
  return props.modelValue[key];
}

function optionsFor(key: MultiSelectKey): readonly string[] {
  return key === "tiers" ? props.tiers : key === "categories" ? props.categories : props.networks;
}

function toggleValue(key: MultiSelectKey, value: string, checked: boolean): void {
  const next = new Set(valuesFor(key));
  if (checked) next.add(value);
  else next.delete(value);
  updateField(key, [...next]);
}

function toggleAll(key: MultiSelectKey, checked: boolean): void {
  updateField(key, checked ? [...optionsFor(key)] : []);
}

function selectedText(key: MultiSelectKey): string {
  const values = valuesFor(key);
  if (!values.length || values.length === optionsFor(key).length) {
    return key === "tiers" ? copy.value.allTiers : key === "categories" ? copy.value.allCategories : copy.value.allNetworks;
  }
  return values.join(", ");
}

function checked(event: Event): boolean {
  return event.target instanceof HTMLInputElement && event.target.checked;
}

const filterChips = computed(() => [
  `${copy.value.datePrefix} ${props.modelValue.startDate}至${props.modelValue.endDate}`
]);
</script>

<template>
  <section class="offer-tracker-filter-card offer-tracker-modern-filters">
    <div class="offer-tracker-section-heading">
      <div>
        <h2>{{ copy.heading }}</h2>
        <p>{{ copy.subtitle }}</p>
      </div>
      <span class="offer-tracker-live-source">{{ copy.liveSource }}</span>
    </div>

    <form @submit.prevent="emit('apply')">
      <div class="offer-tracker-filter-grid">
        <div class="offer-tracker-filter-field offer-tracker-filter-multiselect">
          <span>{{ copy.tiers }}</span>
          <button
            type="button"
            class="offer-tracker-network-toggle"
            :aria-label="copy.tiers"
            :aria-expanded="openMenu === 'tiers' ? 'true' : 'false'"
            @click="toggleMenu('tiers')"
          >
            <span>{{ selectedText("tiers") }}</span><b>⌄</b>
          </button>
          <div v-if="openMenu === 'tiers'" class="offer-tracker-network-menu">
            <label class="offer-tracker-network-option offer-tracker-network-option--all">
              <input
                type="checkbox"
                :checked="!modelValue.tiers.length"
                :aria-label="copy.allTiers"
                @change="toggleAll('tiers', checked($event))"
              >
              <span>{{ copy.allTiers }}</span>
            </label>
            <label v-for="tier in tiers" :key="tier" class="offer-tracker-network-option">
              <input
                type="checkbox"
                :value="tier"
                :checked="modelValue.tiers.includes(tier)"
                @change="toggleValue('tiers', tier, checked($event))"
              >
              <span>{{ tier }}</span>
            </label>
          </div>
          <select
            class="offer-tracker-native-multiselect"
            :value="modelValue.tiers"
            multiple
            :aria-label="copy.nativeTiers"
            aria-hidden="true"
            tabindex="-1"
            @change="updateField('tiers', multiSelectValues($event))"
          >
            <option v-for="tier in tiers" :key="tier" :value="tier">{{ tier }}</option>
          </select>
        </div>

        <div class="offer-tracker-filter-field offer-tracker-filter-multiselect">
          <span>{{ copy.categories }}</span>
          <button
            type="button"
            class="offer-tracker-network-toggle"
            :aria-label="copy.categories"
            :aria-expanded="openMenu === 'categories' ? 'true' : 'false'"
            @click="toggleMenu('categories')"
          >
            <span>{{ selectedText("categories") }}</span><b>⌄</b>
          </button>
          <div v-if="openMenu === 'categories'" class="offer-tracker-network-menu">
            <label class="offer-tracker-network-option offer-tracker-network-option--all">
              <input
                type="checkbox"
                :checked="!modelValue.categories.length"
                :aria-label="copy.allCategories"
                @change="toggleAll('categories', checked($event))"
              >
              <span>{{ copy.allCategories }}</span>
            </label>
            <label v-for="category in categories" :key="category" class="offer-tracker-network-option">
              <input
                type="checkbox"
                :value="category"
                :checked="modelValue.categories.includes(category)"
                @change="toggleValue('categories', category, checked($event))"
              >
              <span>{{ category }}</span>
            </label>
          </div>
          <select
            class="offer-tracker-native-multiselect"
            :value="modelValue.categories"
            multiple
            :aria-label="copy.categories"
            aria-hidden="true"
            tabindex="-1"
            @change="updateField('categories', multiSelectValues($event))"
          >
            <option v-for="category in categories" :key="category" :value="category">{{ category }}</option>
          </select>
        </div>

        <fieldset class="offer-tracker-filter-field offer-tracker-range-group offer-tracker-date-range">
          <legend>{{ copy.timeRange }}</legend>
          <div class="offer-tracker-range-inputs">
            <input
              :value="modelValue.startDate"
              type="date"
              :aria-label="copy.startDate"
              @input="updateField('startDate', inputValue($event))"
            >
            <span>–</span>
            <input
              :value="modelValue.endDate"
              type="date"
              :aria-label="copy.endDate"
              @input="updateField('endDate', inputValue($event))"
            >
          </div>
          <small>{{ copy.rangeHint }}{{ modelValue.startDate }}至{{ modelValue.endDate }}</small>
        </fieldset>

        <fieldset class="offer-tracker-filter-field offer-tracker-range-group">
          <legend>{{ copy.aovRange }}</legend>
          <div class="offer-tracker-range-inputs">
            <input
              :value="modelValue.minAov"
              type="number"
              min="0"
              step="any"
              :placeholder="copy.minAov"
              :aria-label="copy.minAov"
              @input="updateField('minAov', inputValue($event))"
            >
            <span>–</span>
            <input
              :value="modelValue.maxAov"
              type="number"
              min="0"
              step="any"
              :placeholder="copy.maxAov"
              :aria-label="copy.maxAov"
              @input="updateField('maxAov', inputValue($event))"
            >
          </div>
        </fieldset>

        <fieldset class="offer-tracker-filter-field offer-tracker-range-group">
          <legend>{{ copy.commissionRange }}</legend>
          <div class="offer-tracker-range-inputs">
            <input
              :value="modelValue.minCommission"
              type="number"
              min="0"
              step="any"
              :placeholder="copy.minCommission"
              :aria-label="copy.minCommission"
              @input="updateField('minCommission', inputValue($event))"
            >
            <span>–</span>
            <input
              :value="modelValue.maxCommission"
              type="number"
              min="0"
              step="any"
              :placeholder="copy.maxCommission"
              :aria-label="copy.maxCommission"
              @input="updateField('maxCommission', inputValue($event))"
            >
          </div>
        </fieldset>

        <div class="offer-tracker-filter-field offer-tracker-filter-multiselect">
          <span>{{ copy.networks }}</span>
          <button
            type="button"
            class="offer-tracker-network-toggle"
            :aria-label="copy.networks"
            :aria-expanded="openMenu === 'networks' ? 'true' : 'false'"
            @click="toggleMenu('networks')"
          >
            <span>{{ selectedText("networks") }}</span><b>{{ openMenu === 'networks' ? "⌃" : "⌄" }}</b>
          </button>
          <div v-if="openMenu === 'networks'" class="offer-tracker-network-menu">
            <label class="offer-tracker-network-option offer-tracker-network-option--all">
              <input
                type="checkbox"
                :checked="!modelValue.networks.length"
                :aria-label="copy.allNetworks"
                @change="toggleAll('networks', checked($event))"
              >
              <span>{{ copy.allNetworks }}</span>
            </label>
            <label v-for="network in networks" :key="network" class="offer-tracker-network-option">
              <input
                type="checkbox"
                :value="network"
                :checked="modelValue.networks.includes(network)"
                @change="toggleValue('networks', network, checked($event))"
              >
              <span>{{ network }}</span>
            </label>
          </div>
          <select
            class="offer-tracker-native-multiselect"
            :value="modelValue.networks"
            multiple
            :aria-label="copy.networks"
            aria-hidden="true"
            tabindex="-1"
            @change="updateField('networks', multiSelectValues($event))"
          >
            <option v-for="network in networks" :key="network" :value="network">{{ network }}</option>
          </select>
        </div>

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
            :aria-label="copy.nativeSort"
            @change="updateSort"
          >
            <option value="priority">{{ copy.priority }}</option>
            <option value="revenue-desc">{{ copy.revenueDesc }}</option>
            <option value="revenue-asc">{{ copy.revenueAsc }}</option>
          </select>
        </label>
      </div>

      <div class="offer-tracker-filter-footer">
        <div class="offer-tracker-filter-chips">
          <span v-for="chip in filterChips" :key="chip">{{ chip }}</span>
        </div>
        <div class="offer-tracker-filter-actions">
          <button type="button" class="offer-tracker-secondary-button" :disabled="loading" @click="emit('reset')">{{ copy.reset }}</button>
          <button type="submit" class="offer-tracker-primary-button" :aria-label="copy.apply" :disabled="loading">
            {{ loading ? copy.loading : copy.apply }}
          </button>
        </div>
      </div>
    </form>
  </section>
</template>
