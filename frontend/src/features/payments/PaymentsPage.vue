<script setup lang="ts">
import { computed, onMounted } from "vue";

import type { OfferRecord } from "../../shared/contracts/offer";
import type { PaymentExportPayload, PaymentSortKey } from "../../shared/contracts/payment";
import type { UiLanguage } from "../../shared/i18n";
import { translateMessage } from "../../shared/i18n";
import PaymentsFilters from "./PaymentsFilters.vue";
import PaymentsSummary from "./PaymentsSummary.vue";
import PaymentsTable from "./PaymentsTable.vue";
import { usePayments, type PaymentLoader } from "./usePayments";

const props = withDefaults(defineProps<{
  records: readonly unknown[];
  language: UiLanguage;
  loadLive?: PaymentLoader;
  download?: (payload: PaymentExportPayload) => void;
  offers?: readonly OfferRecord[];
  sheetRows?: readonly Readonly<Record<string, unknown>>[];
  today?: string;
  autoSync?: boolean;
}>(), {
  loadLive: undefined,
  download: undefined,
  offers: undefined,
  sheetRows: undefined,
  today: undefined,
  autoSync: true
});

const payments = usePayments({
  records: props.records,
  loadLive: props.loadLive,
  offers: props.offers,
  sheetRows: props.sheetRows,
  today: props.today
});

function message(key: string, fallback: string): string {
  return translateMessage(props.language, key, fallback);
}

const copy = computed(() => ({
  title: message("payments.title", "Payments"),
  sync: message("payments.sync", "Sync Levanta"),
  syncing: message("payments.syncing", "Syncing…"),
  stampSaved: message("payments.stampSaved", "saved Levanta payment records / cycle-aware availability / checked"),
  stampLive: message("payments.stampLive", "live Levanta payment records / checked"),
  stampUnavailable: message("payments.stampUnavailable", "saved Levanta payment records / live API unavailable / checked"),
  download: message("payments.download", "Download payment records"),
  downloadHint: message("payments.downloadHint", "Download the current filtered results as Excel."),
  downloadShort: message("payments.downloadShort", "Download")
}));

const stamp = computed(() => {
  const count = payments.rows.value.length.toLocaleString("en-US");
  const label = payments.error.value
    ? copy.value.stampUnavailable
    : payments.source.value === "live" ? copy.value.stampLive : copy.value.stampSaved;
  return `${count} ${label} ${payments.checkedAt.value || ""}`.trim();
});

const errorMessage = computed(() => payments.error.value
  ? message(payments.error.value, "Live payment sync failed; saved data has been kept.")
  : "");

function emitDownload(): void {
  if (!props.download || !payments.filteredRows.value.length) return;
  props.download({
    rows: [...payments.filteredRows.value],
    filters: payments.filters.value,
    sort: payments.sort.value
  });
}

function changeFilter(key: "month" | "network" | "region" | "tier" | "status", value: string): void {
  payments.setFilter(key, value);
}

function changeSort(key: PaymentSortKey, direction: "asc" | "desc"): void {
  payments.setSort(key, direction);
}

onMounted(() => {
  if (props.autoSync && props.loadLive) void payments.sync();
});
</script>

<template>
  <main class="oi-modern-page payments-modern-page" data-page="payments" :aria-busy="payments.loading.value ? 'true' : 'false'">
    <header class="payments-modern-header">
      <div>
        <h1>{{ copy.title }}</h1>
        <p class="payments-modern-stamp" data-payment-stamp>{{ stamp }}</p>
      </div>
      <button
        type="button"
        class="payments-modern-sync"
        :aria-label="copy.sync"
        :disabled="payments.loading.value"
        @click="payments.sync"
      >{{ payments.loading.value ? copy.syncing : copy.sync }}</button>
    </header>

    <PaymentsSummary
      :summary="payments.summary.value"
      :rows="payments.filteredRows.value"
      :region="payments.filters.value.region"
      :language="props.language"
    />

    <PaymentsFilters
      :model-value="payments.filters.value"
      :options="payments.filterOptions.value"
      :sort="payments.sort.value"
      :language="props.language"
      :loading="payments.loading.value"
      @update:filter="changeFilter"
      @update:search="payments.setSearch"
      @sort-change="changeSort"
    />

    <section class="payments-modern-results" :class="{ 'has-notice': Boolean(errorMessage) }">
      <p v-if="errorMessage" class="payments-modern-notice error" role="alert">{{ errorMessage }}</p>

      <PaymentsTable
        :rows="payments.filteredRows.value"
        :sort="payments.sort.value"
        :language="props.language"
        @sort-change="changeSort"
      >
        <template #actions>
          <button
            type="button"
            class="payments-modern-download"
            :aria-label="copy.download"
            :title="copy.downloadHint"
            :disabled="!payments.filteredRows.value.length || !props.download"
            @click="emitDownload"
          >{{ copy.downloadShort }}</button>
        </template>
      </PaymentsTable>
    </section>

  </main>
</template>
