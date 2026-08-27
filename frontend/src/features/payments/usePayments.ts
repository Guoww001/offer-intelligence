import { computed, ref } from "vue";

import type { OfferRecord } from "../../shared/contracts/offer";
import type {
  PaymentFilters,
  PaymentLivePayload,
  PaymentRecord,
  PaymentSort,
  PaymentSortKey
} from "../../shared/contracts/payment";
import { PAYMENT_SORT_KEYS } from "../../shared/contracts/payment";
import {
  buildPaymentSummary,
  DEFAULT_PAYMENT_FILTERS,
  filterPaymentRecords,
  normalizePaymentRecord,
  paymentFilterOptions,
  sortPaymentRecords,
  visiblePaymentRecords,
  withPendingPaymentPlaceholders,
  type PaymentFilterOptions,
  type PaymentModelOptions
} from "./paymentModel";

export type PaymentLoader = () => Promise<PaymentLivePayload>;
export type PaymentSource = "saved" | "live";
export type PaymentFilterKey = Exclude<keyof PaymentFilters, "search">;

export interface UsePaymentsOptions {
  readonly records: readonly unknown[];
  readonly offers?: readonly OfferRecord[];
  readonly sheetRows?: readonly Readonly<Record<string, unknown>>[];
  readonly today?: string;
  readonly loadLive?: PaymentLoader;
}

function normalizeRows(
  rows: readonly unknown[],
  modelOptions: PaymentModelOptions
): readonly PaymentRecord[] {
  const normalized = rows
    .map((row) => normalizePaymentRecord(row, modelOptions))
    .filter((row): row is PaymentRecord => row !== null);
  return visiblePaymentRecords(withPendingPaymentPlaceholders(normalized));
}

function latestCheckedAt(rows: readonly PaymentRecord[]): string {
  return rows
    .map((row) => row.lastCheckedDate)
    .filter(Boolean)
    .sort()
    .at(-1) || "";
}

function normalizedSortKey(value: string): PaymentSortKey {
  return (PAYMENT_SORT_KEYS as readonly string[]).includes(value)
    ? value as PaymentSortKey
    : "";
}

export function usePayments(options: UsePaymentsOptions) {
  const modelOptions: PaymentModelOptions = {
    offers: options.offers,
    sheetRows: options.sheetRows,
    today: options.today
  };
  const rows = ref<readonly PaymentRecord[]>(normalizeRows(options.records, modelOptions));
  const filters = ref<PaymentFilters>({ ...DEFAULT_PAYMENT_FILTERS });
  const sort = ref<PaymentSort>({ key: "", direction: "asc" });
  const loading = ref(false);
  const error = ref("");
  const source = ref<PaymentSource>("saved");
  const checkedAt = ref(latestCheckedAt(rows.value));
  let requestSequence = 0;

  const filteredRows = computed(() => sortPaymentRecords(
    filterPaymentRecords(rows.value, filters.value),
    sort.value
  ));
  const summary = computed(() => buildPaymentSummary(filteredRows.value));
  const filterOptions = computed<PaymentFilterOptions>(() => paymentFilterOptions(rows.value));

  function setFilter(key: PaymentFilterKey, value: string): void {
    const nextValue = value.trim() || "all";
    filters.value = Object.freeze({ ...filters.value, [key]: nextValue });
  }

  function setSearch(value: string): void {
    filters.value = Object.freeze({ ...filters.value, search: value });
  }

  function setSort(key: string, direction: "asc" | "desc" = "asc"): void {
    sort.value = Object.freeze({
      key: normalizedSortKey(key),
      direction: direction === "desc" ? "desc" : "asc"
    });
  }

  async function sync(): Promise<boolean> {
    if (!options.loadLive) return false;
    const sequence = ++requestSequence;
    loading.value = true;
    error.value = "";
    try {
      const payload = await options.loadLive();
      if (!payload || !Array.isArray(payload.records)) {
        throw new Error("payments.invalidPayload");
      }
      if (sequence !== requestSequence) return false;
      rows.value = normalizeRows(payload.records, modelOptions);
      source.value = "live";
      checkedAt.value = payload.checkedAt || latestCheckedAt(rows.value);
      return true;
    } catch (_caughtError) {
      if (sequence !== requestSequence) return false;
      source.value = "saved";
      error.value = "payments.syncError";
      return false;
    } finally {
      if (sequence === requestSequence) loading.value = false;
    }
  }

  return {
    rows,
    filteredRows,
    filters,
    sort,
    summary,
    filterOptions,
    loading,
    error,
    source,
    checkedAt,
    setFilter,
    setSearch,
    setSort,
    sync
  };
}
