<script setup lang="ts">
import { computed } from "vue";

import type { UiLanguage } from "../../shared/i18n";
import type { ChatbotReportViewResult } from "./chatbotViewTypes";

const props = defineProps<{
  readonly language: UiLanguage;
  readonly result: ChatbotReportViewResult;
}>();

const emit = defineEmits<{
  (event: "download", downloadId: string): void;
}>();

type Row = Readonly<Record<string, unknown>>;

const copy = computed(() => props.language === "zh" ? {
  source: "来源",
  offers: "Offer 数",
  clicks: "点击",
  orders: "订单",
  revenue: "Revenue",
  commission: "佣金",
  conversion: "转化率",
  merchant: "商户",
  tier: "Tier",
  category: "品类",
  epc: "EPC",
  empty: "当前数据中没有找到匹配结果。"
} : {
  source: "Source",
  offers: "Offers",
  clicks: "Clicks",
  orders: "Orders",
  revenue: "Revenue",
  commission: "Commission",
  conversion: "Conversion",
  merchant: "Merchant",
  tier: "Tier",
  category: "Category",
  epc: "EPC",
  empty: "No matching results were found in the current data."
});

const sourceLabel = computed(() => {
  const source = props.result.source === "db"
    ? (props.language === "zh" ? "DB" : "DB")
    : props.result.source === "cache"
      ? (props.language === "zh" ? "缓存数据" : "cached data")
      : (props.language === "zh" ? "不可用" : "unavailable");
  return `${copy.value.source}: ${source}`;
});

const stats = computed(() => [
  { key: "offers", label: copy.value.offers, value: formatCount(props.result.summary.offerCount) },
  { key: "clicks", label: copy.value.clicks, value: formatCount(props.result.summary.clicks) },
  { key: "orders", label: copy.value.orders, value: formatCount(props.result.summary.orders) },
  { key: "revenue", label: copy.value.revenue, value: formatMoney(props.result.summary.revenue) },
  { key: "commission", label: copy.value.commission, value: formatMoney(props.result.summary.commission) },
  { key: "conversion", label: copy.value.conversion, value: formatPercent(props.result.summary.conversionRate) }
]);

function value(row: Row, keys: readonly string[]): string {
  for (const key of keys) {
    const candidate = row[key];
    if (candidate !== undefined && candidate !== null && String(candidate).trim()) return String(candidate).trim();
  }
  return "-";
}

function numberValue(row: Row, keys: readonly string[]): number {
  const raw = value(row, keys).replace(/[$,%]/g, "").replace(/,/g, "");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCount(input: number): string {
  return Number(input || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatMoney(input: number): string {
  return `$${Number(input || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function formatPercent(input: number | null): string {
  return input === null || !Number.isFinite(input) ? "-" : `${(input * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

function rowMerchant(row: Row): string {
  return value(row, ["brand", "merchantName", "Merchant Name", "merchant"]);
}

function rowCategory(row: Row): string {
  return value(row, ["sheetCategory", "mainCategory", "category", "Category"]);
}

function handleDownload(event: MouseEvent): void {
  const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-download-id]") : null;
  const root = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  if (!target || !root || !root.contains(target)) return;
  const downloadId = target.getAttribute("data-download-id")?.trim();
  if (downloadId) emit("download", downloadId.slice(0, 120));
}
</script>

<template>
  <section class="chatbot-result-view" data-chatbot-result @click="handleDownload">
    <div class="chatbot-result-meta">
      <div>
        <span class="chatbot-result-kicker">{{ result.intent }}</span>
        <p class="chatbot-result-message">{{ result.message || copy.empty }}</p>
      </div>
      <span data-chatbot-result-source class="chatbot-result-source">{{ sourceLabel }}</span>
    </div>

    <div
      data-chatbot-result-status
      class="chatbot-result-status"
      :data-status="result.status"
      role="status"
      aria-live="polite"
    >
      {{ result.status }}
    </div>

    <div v-if="!result.contentHtml && result.rows.length" class="chatbot-result-stats" aria-label="Chatbot summary">
      <article v-for="stat in stats" :key="stat.key" data-chatbot-stat class="chatbot-result-stat">
        <span>{{ stat.label }}</span>
        <strong>{{ stat.value }}</strong>
      </article>
    </div>

    <div v-if="result.contentHtml" class="chatbot-result-rich-html" data-chatbot-rich-result v-html="result.contentHtml"></div>

    <p v-else-if="!result.rows.length" data-chatbot-empty data-chatbot-explicit-state="empty" class="chatbot-result-empty">
      {{ result.message || copy.empty }}
    </p>

    <div v-else class="chatbot-result-table-wrap">
      <table class="chatbot-result-table">
        <thead>
          <tr>
            <th>{{ copy.merchant }}</th>
            <th>{{ copy.tier }}</th>
            <th>{{ copy.category }}</th>
            <th>{{ copy.epc }}</th>
            <th>{{ copy.orders }}</th>
            <th>{{ copy.revenue }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in result.rows" :key="value(row, ['merchantId', 'id']) + '-' + index" data-chatbot-row>
            <td>
              <strong>{{ rowMerchant(row) }}</strong>
              <small>{{ value(row, ['merchantId', 'Merchant ID', 'id']) }}</small>
            </td>
            <td>{{ value(row, ['tier', 'Tier']) }}</td>
            <td>{{ rowCategory(row) }}</td>
            <td>{{ formatMoney(numberValue(row, ['epc', 'EPC', 'EPC(Aff)'])) }}</td>
            <td>{{ formatCount(numberValue(row, ['orders', 'Order count', 'orderCount'])) }}</td>
            <td>{{ formatMoney(numberValue(row, ['salesAmount', 'revenue', 'Revenue'])) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
