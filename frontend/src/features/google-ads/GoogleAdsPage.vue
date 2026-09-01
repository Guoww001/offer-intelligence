<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";

import { formatInteger } from "../../shared/format/number";
import { formatMoney } from "../../shared/format/money";
import { translateMessage, type UiLanguage } from "../../shared/i18n";
import { googleAdsMatchKind, type GoogleAdsCampaign } from "./googleAdsModel";
import { useGoogleAds, type GoogleAdsLoader } from "./useGoogleAds";

const props = withDefaults(defineProps<{
  readonly language: UiLanguage;
  readonly userId?: string;
  readonly loadData?: GoogleAdsLoader;
  readonly today?: () => Date;
}>(), {
  userId: "19",
  loadData: undefined,
  today: undefined
});

const ads = useGoogleAds({
  userId: props.userId,
  loadData: props.loadData,
  today: props.today
});

const copy = computed(() => ({
  eyebrow: "PAID MEDIA × BACKEND RETURN",
  title: translateMessage(props.language, "googleAds.title", "Google Ads workbench"),
  subtitle: translateMessage(props.language, "googleAds.subtitle", "Connect Google campaign spend with Amazon merchant-level results for media ID 19."),
  account: translateMessage(props.language, "googleAds.account", "Google Ads account"),
  accountPending: translateMessage(props.language, "googleAds.accountPending", "Waiting for account data"),
  timeRange: translateMessage(props.language, "googleAds.timeRange", "Time range"),
  startDate: translateMessage(props.language, "googleAds.startDate", "Start date"),
  endDate: translateMessage(props.language, "googleAds.endDate", "End date"),
  refresh: translateMessage(props.language, "googleAds.refresh", "Refresh"),
  joinNote: translateMessage(props.language, "googleAds.joinNote", "Joined conservatively at merchant × date; unmatched spend remains visible."),
  trendTitle: translateMessage(props.language, "googleAds.trendTitle", "Spend and backend Revenue by day"),
  trendSubtitle: translateMessage(props.language, "googleAds.trendSubtitle", "Google spend is shown as bars; YeahPromos Amazon Revenue is shown as a line."),
  spend: translateMessage(props.language, "googleAds.spend", "Spend"),
  backendRevenue: translateMessage(props.language, "googleAds.backendRevenue", "Backend Revenue"),
  merchantTitle: translateMessage(props.language, "googleAds.merchantTitle", "Merchant connection table"),
  merchantSubtitle: translateMessage(props.language, "googleAds.merchantSubtitle", "Backend outcomes are counted once per merchant; Google campaigns are grouped under the matched brand."),
  merchant: translateMessage(props.language, "googleAds.merchant", "Merchant"),
  match: translateMessage(props.language, "googleAds.match", "Connection"),
  campaigns: translateMessage(props.language, "googleAds.campaigns", "Campaigns"),
  googleClicks: translateMessage(props.language, "googleAds.googleClicks", "Google clicks"),
  backendClicks: translateMessage(props.language, "googleAds.backendClicks", "Backend clicks"),
  orders: translateMessage(props.language, "googleAds.orders", "Orders"),
  roas: translateMessage(props.language, "googleAds.roas", "Merchant ROAS"),
  cpa: translateMessage(props.language, "googleAds.cpa", "Cost / order"),
  unmatchedTitle: translateMessage(props.language, "googleAds.unmatchedTitle", "Unmatched Google campaigns"),
  unmatchedSubtitle: translateMessage(props.language, "googleAds.unmatchedSubtitle", "Campaign spend is retained until a merchant alias or ASIN can be resolved."),
  methodTitle: translateMessage(props.language, "googleAds.methodTitle", "Data contract"),
  methodSubtitle: translateMessage(props.language, "googleAds.methodSubtitle", "What is joined, and what is deliberately kept separate."),
  loading: translateMessage(props.language, "googleAds.loading", "Loading Google Ads and backend returns…"),
  empty: translateMessage(props.language, "googleAds.empty", "No data is available for this date range."),
  matchName: translateMessage(props.language, "googleAds.matchName", "Brand name"),
  matchAsin: translateMessage(props.language, "googleAds.matchAsin", "ASIN match"),
  matchManual: translateMessage(props.language, "googleAds.matchManual", "Manual alias"),
  unmatched: translateMessage(props.language, "googleAds.unmatched", "Unmatched"),
  matchedSpend: translateMessage(props.language, "googleAds.matchedSpend", "matched spend"),
  coverage: translateMessage(props.language, "googleAds.coverage", "Spend match rate"),
  nativeConversions: translateMessage(props.language, "googleAds.nativeConversions", "Google native conversions"),
  merchantRoas: translateMessage(props.language, "googleAds.merchantRoas", "Merchant-level ROAS"),
  sourceGoogle: translateMessage(props.language, "googleAds.sourceGoogle", "Google source"),
  sourceBackend: translateMessage(props.language, "googleAds.sourceBackend", "Backend source"),
  joinGrain: translateMessage(props.language, "googleAds.joinGrain", "Join grain"),
  joinRule: translateMessage(props.language, "googleAds.joinRule", "Join rule"),
  caveat: translateMessage(props.language, "googleAds.caveat", "Attribution boundary")
}));

const payload = computed(() => ads.payload.value);
const summary = computed(() => payload.value?.summary || null);
const account = computed(() => payload.value?.googleAds || null);
const chart = computed(() => ads.chartModel.value);
const chartViewBox = computed(() => `0 0 ${chart.value.width} ${chart.value.height}`);

function compactMoney(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  const absolute = Math.abs(numeric);
  if (absolute >= 1_000_000) return `$${(numeric / 1_000_000).toFixed(1)}m`;
  if (absolute >= 1_000) return `$${(numeric / 1_000).toFixed(1)}k`;
  return `$${numeric.toFixed(0)}`;
}

function percent(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}%`;
}

function ratio(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}×`;
}

const kpis = computed(() => {
  const value = summary.value;
  if (!value) return [];
  return [
    { label: copy.value.spend, value: formatMoney(value.spend), note: `${formatInteger(value.impressions)} impressions` },
    { label: copy.value.googleClicks, value: formatInteger(value.googleClicks), note: `CTR ${percent(value.googleCtr, 2)}` },
    { label: copy.value.orders, value: formatInteger(value.orders), note: `${formatInteger(value.backendClicks)} ${copy.value.backendClicks}` },
    { label: copy.value.backendRevenue, value: formatMoney(value.revenue), note: `${formatMoney(value.affCommission)} AFF` },
    { label: copy.value.coverage, value: percent(value.matchCoverageBySpend), note: `${formatMoney(value.matchedSpend)} ${copy.value.matchedSpend}` },
    { label: copy.value.merchantRoas, value: ratio(value.merchantLevelRoas), note: `${formatInteger(value.nativeConversions)} ${copy.value.nativeConversions}` }
  ];
});

const statusText = computed(() => {
  if (ads.status.value === "googleAds.loaded" && summary.value) {
    return translateMessage(props.language, "googleAds.loaded", "Connected: {campaigns} campaigns, {merchants} merchants.", {
      campaigns: formatInteger(summary.value.campaignCount),
      merchants: formatInteger(summary.value.backendMerchantCount)
    });
  }
  if (ads.status.value === "googleAds.loading") return copy.value.loading;
  if (ads.status.value === "googleAds.error") return translateMessage(props.language, "googleAds.error", "Unable to load the Google Ads workbench. Check the server configuration and retry.");
  return "";
});

const accountMeta = computed(() => {
  if (!account.value) return copy.value.accountPending;
  const customerId = account.value.customerId.replace(/^(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3");
  return [customerId, account.value.currencyCode, account.value.timeZone, account.value.apiVersion]
    .filter(Boolean)
    .join(" · ") || copy.value.accountPending;
});

function matchLabel(method: string): string {
  const kind = googleAdsMatchKind(method);
  if (kind === "manualAlias") return copy.value.matchManual;
  if (kind === "asin") return copy.value.matchAsin;
  if (kind === "merchantName") return copy.value.matchName;
  return copy.value.unmatched;
}

function matchClass(method: string): string {
  return googleAdsMatchKind(method) === "unmatched" ? "unmatched" : "";
}

function campaignTitle(row: { readonly campaigns: readonly GoogleAdsCampaign[] }): string {
  return row.campaigns.map((campaign) => campaign.campaignName).filter(Boolean).join(" · ");
}

function applyQuickRange(days: number): void {
  ads.setQuickRange(days);
  void ads.load();
}

function onStartDateChange(event: Event): void {
  ads.setDateRange((event.target as HTMLInputElement).value, ads.endDate.value);
  void ads.load();
}

function onEndDateChange(event: Event): void {
  ads.setDateRange(ads.startDate.value, (event.target as HTMLInputElement).value);
  void ads.load();
}

onMounted(() => {
  void ads.load();
});

onUnmounted(() => {
  ads.unmount();
});
</script>

<template>
  <main class="oi-modern-page google-ads-page" data-page="google-ads">
    <header class="google-ads-header">
      <div>
        <span class="google-ads-eyebrow">{{ copy.eyebrow }}</span>
        <h2>{{ copy.title }}</h2>
        <p>{{ copy.subtitle }}</p>
      </div>
      <div class="google-ads-identity">
        <span class="google-ads-live-dot" aria-hidden="true"></span>
        <strong>{{ payload?.publisher.userName || "asdf260821" }}</strong>
        <small>MEDIA ID {{ payload?.publisher.userId || ads.userId.value }}</small>
      </div>
    </header>

    <section class="panel google-ads-controls" aria-label="Google Ads workbench controls">
      <div class="google-ads-control-grid">
        <div class="google-ads-account-card">
          <span>{{ copy.account }}</span>
          <strong>{{ account?.descriptiveName || "—" }}</strong>
          <small>{{ accountMeta }}</small>
        </div>
        <div class="brand-media-field google-ads-range-field">
          <span>{{ copy.timeRange }}</span>
          <div class="brand-media-range-buttons" aria-label="Quick date ranges">
            <button v-for="days in [30, 60, 90, 180]" :key="days" type="button" :class="{ active: ads.quickRange.value === String(days) }" :data-google-ads-range="days" @click="applyQuickRange(days)">
              {{ days }}D
            </button>
          </div>
        </div>
        <label class="brand-media-field google-ads-date-field">
          <span>{{ copy.startDate }}</span>
          <input type="date" :value="ads.startDate.value" aria-label="Google Ads workbench start date" @change="onStartDateChange" />
        </label>
        <label class="brand-media-field google-ads-date-field">
          <span>{{ copy.endDate }}</span>
          <input type="date" :value="ads.endDate.value" aria-label="Google Ads workbench end date" @change="onEndDateChange" />
        </label>
        <button class="google-ads-refresh" data-google-ads-action="refresh" type="button" :disabled="ads.loading.value" :class="{ 'is-loading': ads.loading.value }" @click="ads.load(true)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>
          <span>{{ copy.refresh }}</span>
        </button>
      </div>
      <div class="google-ads-control-footer">
        <p class="google-ads-status" role="status" aria-live="polite" :data-kind="ads.statusKind.value">{{ statusText }}</p>
        <p>{{ copy.joinNote }}</p>
      </div>
    </section>

    <section class="google-ads-kpis" aria-label="Google Ads workbench summary">
      <article v-for="item in kpis" :key="item.label" class="google-ads-kpi">
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
        <small>{{ item.note }}</small>
      </article>
    </section>

    <section class="panel google-ads-trend-panel" aria-labelledby="googleAdsModernTrendTitle">
      <div class="google-ads-panel-heading">
        <div>
          <span class="google-ads-section-index">01</span>
          <h2 id="googleAdsModernTrendTitle">{{ copy.trendTitle }}</h2>
          <p>{{ copy.trendSubtitle }}</p>
        </div>
        <div class="google-ads-legend" aria-label="Chart legend">
          <span><i class="google-ads-legend-spend"></i><span>{{ copy.spend }}</span></span>
          <span><i class="google-ads-legend-revenue"></i><span>{{ copy.backendRevenue }}</span></span>
        </div>
      </div>
      <div class="google-ads-chart" role="img" :aria-label="copy.trendTitle">
        <svg v-if="chart.hasData" class="google-ads-chart-svg" :viewBox="chartViewBox" :width="chart.width" :height="chart.height" role="img" :aria-label="copy.trendTitle">
          <g v-for="line in chart.grid" :key="line.y">
            <line class="google-ads-chart-grid" x1="50" :y1="line.y" :x2="chart.width - 44" :y2="line.y" />
            <text class="google-ads-chart-axis" x="42" :y="line.y + 3" text-anchor="end">{{ line.revenueLabel }}</text>
            <text class="google-ads-chart-axis" :x="chart.width - 36" :y="line.y + 3" text-anchor="start">{{ line.spendLabel }}</text>
          </g>
          <rect v-for="bar in chart.bars" :key="`bar-${bar.row.date}`" class="google-ads-chart-bar" :x="bar.x" :y="bar.y" :width="bar.width" :height="bar.height">
            <title>{{ bar.row.date }} · {{ copy.spend }} {{ formatMoney(bar.value) }} · {{ copy.backendRevenue }} {{ formatMoney(bar.row.revenue) }}</title>
          </rect>
          <path class="google-ads-chart-line" :d="chart.linePath" />
          <circle v-for="point in chart.points" :key="`point-${point.row.date}`" class="google-ads-chart-point" :cx="point.x" :cy="point.y" r="2.5">
            <title>{{ point.row.date }} · {{ copy.backendRevenue }} {{ formatMoney(point.row.revenue) }} · {{ copy.orders }} {{ formatInteger(point.row.orders) }}</title>
          </circle>
          <text v-for="label in chart.xLabels" :key="`label-${label.row.date}`" class="google-ads-chart-axis" :x="label.x" :y="chart.height - 12" text-anchor="middle">{{ label.value }}</text>
        </svg>
        <div v-else class="google-ads-chart-empty">{{ ads.loading.value ? copy.loading : copy.empty }}</div>
      </div>
    </section>

    <section class="panel google-ads-table-panel" aria-labelledby="googleAdsModernMerchantTitle">
      <div class="google-ads-panel-heading">
        <div>
          <span class="google-ads-section-index">02</span>
          <h2 id="googleAdsModernMerchantTitle">{{ copy.merchantTitle }}</h2>
          <p>{{ copy.merchantSubtitle }}</p>
        </div>
        <span class="google-ads-count">{{ payload?.merchants.length ? `${formatInteger(payload.merchants.length)} ${copy.merchant}` : "" }}</span>
      </div>
      <div class="google-ads-table-wrap">
        <table class="google-ads-table">
          <thead>
            <tr>
              <th>{{ copy.merchant }}</th>
              <th>{{ copy.match }}</th>
              <th class="google-ads-numeric">{{ copy.campaigns }}</th>
              <th class="google-ads-numeric">{{ copy.spend }}</th>
              <th class="google-ads-numeric">{{ copy.googleClicks }}</th>
              <th class="google-ads-numeric">{{ copy.backendClicks }}</th>
              <th class="google-ads-numeric">{{ copy.orders }}</th>
              <th class="google-ads-numeric">{{ copy.backendRevenue }}</th>
              <th class="google-ads-numeric">{{ copy.roas }}</th>
              <th class="google-ads-numeric">{{ copy.cpa }}</th>
            </tr>
          </thead>
          <tbody v-if="payload?.merchants.length">
            <tr v-for="row in payload.merchants" :key="row.merchantId">
              <td class="google-ads-merchant-cell"><strong>{{ row.merchantName || row.merchantId }}</strong><small>ID {{ row.merchantId }}</small></td>
              <td><span class="google-ads-match-pill" :class="matchClass(row.matchMethod)">{{ matchLabel(row.matchMethod) }}</span></td>
              <td class="google-ads-numeric" :title="campaignTitle(row)">{{ formatInteger(row.campaignCount) }}</td>
              <td class="google-ads-numeric">{{ formatMoney(row.spend) }}</td>
              <td class="google-ads-numeric">{{ formatInteger(row.googleClicks) }}</td>
              <td class="google-ads-numeric">{{ formatInteger(row.backendClicks) }}</td>
              <td class="google-ads-numeric">{{ formatInteger(row.orders) }}</td>
              <td class="google-ads-numeric">{{ formatMoney(row.revenue) }}</td>
              <td class="google-ads-numeric">{{ ratio(row.merchantRoas) }}</td>
              <td class="google-ads-numeric">{{ row.costPerOrder == null ? "—" : formatMoney(row.costPerOrder) }}</td>
            </tr>
          </tbody>
          <tbody v-else>
            <tr><td colspan="10" class="google-ads-empty-cell">{{ ads.loading.value ? copy.loading : copy.empty }}</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <div class="google-ads-bottom-grid">
      <section class="panel google-ads-unmatched-panel" aria-labelledby="googleAdsModernUnmatchedTitle">
        <div class="google-ads-panel-heading compact">
          <div>
            <span class="google-ads-section-index">03</span>
            <h2 id="googleAdsModernUnmatchedTitle">{{ copy.unmatchedTitle }}</h2>
            <p>{{ copy.unmatchedSubtitle }}</p>
          </div>
        </div>
        <div class="google-ads-unmatched-list">
          <div v-if="!payload?.unmatchedCampaigns.length" class="google-ads-empty-block">{{ ads.loading.value ? copy.loading : copy.empty }}</div>
          <div v-for="row in payload?.unmatchedCampaigns.slice(0, 12)" :key="row.campaignId" class="google-ads-unmatched-row">
            <strong :title="row.campaignName">{{ row.campaignName }}</strong>
            <span>{{ formatMoney(row.spend) }}</span>
            <span>{{ formatInteger(row.googleClicks) }} {{ copy.googleClicks }}</span>
          </div>
        </div>
      </section>

      <section class="panel google-ads-method-panel" aria-labelledby="googleAdsModernMethodTitle">
        <div class="google-ads-panel-heading compact">
          <div>
            <span class="google-ads-section-index">04</span>
            <h2 id="googleAdsModernMethodTitle">{{ copy.methodTitle }}</h2>
            <p>{{ copy.methodSubtitle }}</p>
          </div>
        </div>
        <dl>
          <dt>{{ copy.sourceGoogle }}</dt><dd>{{ payload?.sources.googleAds || "—" }}</dd>
          <dt>{{ copy.sourceBackend }}</dt><dd>{{ payload?.sources.backendOrders || "—" }}</dd>
          <dt>{{ copy.joinGrain }}</dt><dd>{{ payload?.sources.joinGrain || "—" }}</dd>
          <dt>{{ copy.joinRule }}</dt><dd>{{ payload?.sources.joinRule || "—" }}</dd>
          <dt>{{ copy.caveat }}</dt><dd>{{ payload?.sources.attributionCaveat || "—" }}</dd>
        </dl>
      </section>
    </div>
  </main>
</template>
