<script setup lang="ts">
import { PAYMENT_MONTHS, paymentCurrencySymbol } from "./paymentModel";
import type { PaymentRecord, PaymentSort, PaymentSortKey, PaymentStatus } from "../../shared/contracts/payment";
import type { UiLanguage } from "../../shared/i18n";
import { translateMessage } from "../../shared/i18n";

const props = defineProps<{
  rows: readonly PaymentRecord[];
  sort: PaymentSort;
  language: UiLanguage;
}>();

const emit = defineEmits<{
  (event: "sort-change", key: PaymentSortKey, direction: "asc" | "desc"): void;
}>();

const columns = [
  { key: "merchantId", label: "payments.columns.merchantId", fallback: "Merchant ID" },
  { key: "merchantName", label: "payments.columns.merchant", fallback: "Merchant" },
  { key: "network", label: "payments.columns.network", fallback: "Network" },
  { key: "region", label: "payments.columns.region", fallback: "Region" },
  { key: "tier", label: "payments.columns.tier", fallback: "Tier" },
  { key: "reportMonth", label: "payments.columns.month", fallback: "Month" },
  { key: "paymentStatus", label: "payments.columns.status", fallback: "Status" },
  { key: "revenueMade", label: "payments.columns.revenueMade", fallback: "Revenue Made" },
  { key: "commissionMade", label: "payments.columns.commissionMade", fallback: "Commission Made" },
  { key: "paymentCycle", label: "payments.columns.cycle", fallback: "Cycle" },
  { key: "expectedPaymentDate", label: "payments.columns.expectedPaymentDate", fallback: "Expected Payment Date" },
  { key: "paymentMadeDate", label: "payments.columns.paymentMade", fallback: "Payment Made" }
] as const satisfies readonly { key: Exclude<PaymentSortKey, "">; label: string; fallback: string }[];

const statusKeys: Record<PaymentStatus, string> = {
  Paid: "payments.paid",
  Pending: "payments.pending",
  Unpaid: "payments.unpaid",
  Overdue: "payments.overdue",
  Partial: "payments.partial",
  Unknown: "payments.unknown"
};

function message(key: string, fallback: string): string {
  return translateMessage(props.language, key, fallback);
}

function monthLabel(value: string): string {
  const month = PAYMENT_MONTHS.find((candidate) => candidate === value);
  return month ? message(`payments.months.${month}`, month) : value || message("payments.notAvailable", "Not available in current data");
}

function statusLabel(status: PaymentStatus): string {
  return message(statusKeys[status], status);
}

function number(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function money(row: PaymentRecord, value: number): string {
  return `${paymentCurrencySymbol(row)}${number(value)}`;
}

function value(row: PaymentRecord, key: Exclude<PaymentSortKey, "">): string {
  switch (key) {
    case "merchantId": return row.merchantId || "-";
    case "merchantName": return row.merchantName || "-";
    case "network": return row.network || "-";
    case "region": return row.region || "-";
    case "tier": return row.tier || "Unknown";
    case "reportMonth": return `${monthLabel(row.reportMonth)} ${row.reportYear}`;
    case "paymentStatus": return statusLabel(row.paymentStatus);
    case "revenueMade": return money(row, row.revenueMade);
    case "commissionMade": return money(row, row.commissionMade);
    case "paymentCycle": return row.paymentCycle ? `${row.paymentCycle} ${message("payments.days", "days")}` : "-";
    case "expectedPaymentDate": return row.expectedPaymentDate || message("payments.notAvailable", "Not available in current data");
    case "paymentMadeDate": return row.paymentStatus === "Paid" ? row.paymentMadeDate || "-" : "-";
  }
}

function ariaSort(key: Exclude<PaymentSortKey, "">): "ascending" | "descending" | "none" {
  if (props.sort.key !== key) return "none";
  return props.sort.direction === "desc" ? "descending" : "ascending";
}

function toggleSort(key: Exclude<PaymentSortKey, "">): void {
  const direction = props.sort.key === key && props.sort.direction === "asc" ? "desc" : "asc";
  emit("sort-change", key, direction);
}
</script>

<template>
  <section class="payments-modern-table-panel" :aria-label="message('payments.records', 'Payment records')">
    <div class="payments-modern-table-heading">
      <div>
        <h2>{{ message("payments.records", "Payment records") }}</h2>
        <p>{{ rows.length.toLocaleString("en-US") }} {{ message("payments.tableCount", "matching payment records") }}</p>
      </div>
      <div class="payments-modern-table-actions">
        <slot name="actions" />
      </div>
    </div>
    <div class="payments-modern-table-wrap">
      <table class="payments-modern-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column.key" :aria-sort="ariaSort(column.key)">
              <button type="button" @click="toggleSort(column.key)">{{ message(column.label, column.fallback) }}</button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!rows.length" data-empty-state>
            <td :colspan="columns.length">{{ message("payments.empty", "No payment records match the current filters.") }}</td>
          </tr>
          <template v-else>
            <tr v-for="row in rows" :key="row.id" :data-merchant-id="row.merchantId || row.merchantName">
              <td v-for="column in columns" :key="column.key" :data-column="column.key">
                <span v-if="column.key === 'paymentStatus'" class="payments-modern-status" :data-status="row.paymentStatus.toLowerCase()">
                  {{ value(row, column.key) }}
                </span>
                <template v-else-if="column.key === 'merchantName'">
                  <strong>{{ value(row, column.key) }}</strong>
                  <small v-if="row.category">{{ row.category }}</small>
                </template>
                <span v-else>{{ value(row, column.key) }}</span>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </section>
</template>
