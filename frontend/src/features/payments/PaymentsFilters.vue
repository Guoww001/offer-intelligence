<script setup lang="ts">
import { computed } from "vue";

import { PAYMENT_MONTHS } from "./paymentModel";
import type { PaymentFilterOptions } from "./paymentModel";
import type { PaymentFilters, PaymentSort, PaymentSortKey, PaymentStatus } from "../../shared/contracts/payment";
import { PAYMENT_SORT_KEYS } from "../../shared/contracts/payment";
import type { UiLanguage } from "../../shared/i18n";
import { translateMessage } from "../../shared/i18n";
import type { PaymentFilterKey } from "./usePayments";

const props = defineProps<{
  modelValue: PaymentFilters;
  options: PaymentFilterOptions;
  sort: PaymentSort;
  language: UiLanguage;
  loading: boolean;
}>();

const emit = defineEmits<{
  (event: "update:filter", key: PaymentFilterKey, value: string): void;
  (event: "update:search", value: string): void;
  (event: "sort-change", key: PaymentSortKey, direction: "asc" | "desc"): void;
}>();

const statusKeys: Record<PaymentStatus, string> = {
  Paid: "payments.paid",
  Pending: "payments.pending",
  Unpaid: "payments.unpaid",
  Overdue: "payments.overdue",
  Partial: "payments.partial",
  Unknown: "payments.unknown"
};

const columnKeys: Record<Exclude<PaymentSortKey, "">, string> = {
  merchantId: "payments.columns.merchantId",
  merchantName: "payments.columns.merchant",
  network: "payments.columns.network",
  region: "payments.columns.region",
  tier: "payments.columns.tier",
  reportMonth: "payments.columns.month",
  paymentStatus: "payments.columns.status",
  revenueMade: "payments.columns.revenueMade",
  commissionMade: "payments.columns.commissionMade",
  paymentCycle: "payments.columns.cycle",
  expectedPaymentDate: "payments.columns.expectedPaymentDate",
  paymentMadeDate: "payments.columns.paymentMade"
};

const sortKeys = computed<readonly PaymentSortKey[]>(() => ["", ...PAYMENT_SORT_KEYS]);

function message(key: string, fallback: string): string {
  return translateMessage(props.language, key, fallback);
}

function monthLabel(value: string): string {
  const month = PAYMENT_MONTHS.find((candidate) => value === candidate);
  return month ? message(`payments.months.${month}`, month) : value;
}

function statusLabel(status: PaymentStatus): string {
  return message(statusKeys[status], status);
}

function selectValue(event: Event): string {
  return (event.target as HTMLSelectElement).value;
}

function emitFilter(key: PaymentFilterKey, value: string): void {
  emit("update:filter", key, value);
}

function emitSort(value: string): void {
  const key = (sortKeys.value.includes(value as PaymentSortKey) ? value : "") as PaymentSortKey;
  emit("sort-change", key, props.sort.key === key && props.sort.direction === "asc" ? "desc" : "asc");
}

function sortLabel(key: PaymentSortKey): string {
  return key ? message(columnKeys[key], key) : message("payments.defaultSort", "Default priority");
}
</script>

<template>
  <section class="payments-modern-filters" :aria-label="message('payments.filters', 'Payment filters')">
    <label>
      <span>{{ message("payments.month", "Month") }}</span>
      <select :aria-label="message('payments.month', 'Month')" :value="props.modelValue.month" :disabled="props.loading" @change="emitFilter('month', selectValue($event))">
        <option value="all">{{ message("payments.allMonths", "All months") }}</option>
        <option v-for="month in props.options.months" :key="month" :value="month">{{ monthLabel(month) }}</option>
      </select>
    </label>
    <label>
      <span>{{ message("payments.network", "Network") }}</span>
      <select :aria-label="message('payments.network', 'Network')" :value="props.modelValue.network" :disabled="props.loading" @change="emitFilter('network', selectValue($event))">
        <option value="all">{{ message("payments.allNetworks", "All networks") }}</option>
        <option v-for="network in props.options.networks" :key="network" :value="network">{{ network }}</option>
      </select>
    </label>
    <label>
      <span>{{ message("payments.region", "Region") }}</span>
      <select :aria-label="message('payments.region', 'Region')" :value="props.modelValue.region" :disabled="props.loading" @change="emitFilter('region', selectValue($event))">
        <option value="all">{{ message("payments.allRegions", "All regions") }}</option>
        <option v-for="region in props.options.regions" :key="region" :value="region">{{ region }}</option>
      </select>
    </label>
    <label>
      <span>{{ message("payments.tier", "Tier") }}</span>
      <select :aria-label="message('payments.tier', 'Tier')" :value="props.modelValue.tier" :disabled="props.loading" @change="emitFilter('tier', selectValue($event))">
        <option value="all">{{ message("payments.allTiers", "All tiers") }}</option>
        <option v-for="tier in props.options.tiers" :key="tier" :value="tier">{{ tier }}</option>
      </select>
    </label>
    <label>
      <span>{{ message("payments.status", "Status") }}</span>
      <select :aria-label="message('payments.status', 'Status')" :value="props.modelValue.status" :disabled="props.loading" @change="emitFilter('status', selectValue($event))">
        <option value="all">{{ message("payments.allStatuses", "All status") }}</option>
        <option v-for="status in props.options.statuses" :key="status" :value="status">{{ statusLabel(status) }}</option>
      </select>
    </label>
    <label>
      <span>{{ message("payments.sort", "Sort by") }}</span>
      <select :aria-label="message('payments.sort', 'Sort by')" :value="props.sort.key" :disabled="props.loading" @change="emitSort(selectValue($event))">
        <option v-for="key in sortKeys" :key="key" :value="key">{{ sortLabel(key) }}</option>
      </select>
    </label>
    <label class="payments-modern-search">
      <span>{{ message("payments.search", "Merchant search") }}</span>
      <input
        type="search"
        :aria-label="message('payments.search', 'Merchant search')"
        :placeholder="message('payments.searchPlaceholder', 'Merchant name or ID')"
        :value="props.modelValue.search"
        :disabled="props.loading"
        @input="emit('update:search', ($event.target as HTMLInputElement).value)"
      />
    </label>
  </section>
</template>
