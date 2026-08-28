<script setup lang="ts">
import { computed } from "vue";

import { formatMoney } from "../../shared/format/money";
import type { UiLanguage } from "../../shared/i18n";
import { translateMessage } from "../../shared/i18n";
import type { PaymentRecord, PaymentSummary } from "../../shared/contracts/payment";
import { paymentCurrencySymbol } from "./paymentModel";

const props = defineProps<{
  summary: PaymentSummary;
  rows: readonly PaymentRecord[];
  region: string;
  language: UiLanguage;
}>();

function message(key: string, fallback: string): string {
  return translateMessage(props.language, key, fallback);
}

const moneySymbol = computed(() => {
  if (props.region === "all") return "$";
  const symbols = new Set(props.rows.map((row) => paymentCurrencySymbol(row)));
  return symbols.size === 1 ? [...symbols][0] || "$" : "$";
});

function money(value: number): string {
  return formatMoney(value, moneySymbol.value);
}

function rate(value: number): string {
  return `${(value * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

const cards = computed(() => [
  { key: "merchants", label: message("payments.merchants", "Merchants"), value: props.summary.merchantCount.toLocaleString("en-US") },
  { key: "revenue", label: message("payments.revenueMade", "Revenue made"), value: money(props.summary.totalRevenueMade) },
  { key: "commission", label: message("payments.commissionMade", "Commission made"), value: money(props.summary.totalCommissionMade) },
  { key: "rate", label: message("payments.paymentRate", "Payment rate"), value: rate(props.summary.paymentRate) }
]);

const statuses = computed(() => [
  { key: "paid", label: message("payments.paid", "Paid"), value: props.summary.paidMerchantCount },
  { key: "pending", label: message("payments.pending", "Pending"), value: props.summary.pendingMerchantCount },
  { key: "unpaid", label: message("payments.unpaid", "Unpaid"), value: props.summary.unpaidMerchantCount },
  { key: "overdue", label: message("payments.overdue", "Overdue"), value: props.summary.overdueMerchantCount }
]);
</script>

<template>
  <section
    class="payments-modern-summary payment-summary"
    data-layout="four-by-two"
    :aria-label="message('payments.summary', 'Payment summary')"
  >
    <article v-for="card in cards" :key="card.key" class="payments-modern-summary-card" :data-summary-key="card.key">
      <span>{{ card.label }}</span>
      <strong>{{ card.value }}</strong>
    </article>
    <div class="payments-modern-status-row payment-status-row">
      <article
        v-for="status in statuses"
        :key="status.key"
        class="payments-modern-summary-card payments-modern-summary-card--status payment-status-pill"
        :data-summary-key="status.key"
        :data-status="status.key"
        :aria-label="`${status.label}: ${status.value.toLocaleString('en-US')}`"
      >
        <span>{{ status.label }}</span>
        <strong>{{ status.value.toLocaleString("en-US") }}</strong>
      </article>
    </div>
  </section>
</template>
