<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import type { UiLanguage } from "../../shared/i18n";
import { translateMessage } from "../../shared/i18n";
import {
  DEFAULT_PUBLISHER_FILTERS,
  PUBLISHER_CHART_COLORS,
  PUBLISHER_KPI_DEFINITIONS,
  PUBLISHER_TABLE_COLUMNS,
  aggregatePublisherMetrics,
  applyDateFilter,
  filteredPublishers,
  paginate,
  publisherAffinitySummary,
  publisherAssociationSummary,
  publisherManagerMatches,
  publisherMerchantOptions,
  publisherMetricAffCommission,
  publisherMetricAffCommissionRate,
  publisherMetricAffEpc,
  publisherMetricAov,
  publisherMetricConversionRate,
  publisherMetricForMarket,
  publisherMetricIsActive,
  publisherOverviewRows,
  publisherQuickDateRange,
  publisherTableRows,
  publisherTierOptions,
  portfolioRowsForState,
  publishersForManager,
  type PublisherAggregate,
  type PublisherExportPayload,
  type PublisherFilters,
  type PublisherMetric,
  type PublisherMetricKey,
  type PublisherOverviewRow,
  type PublisherPortfolioRow,
  type PublisherRecord,
  type PublisherSort,
  type PublisherTableRow,
  type PublisherTableSortKey
} from "./publisherModel";
import { usePublishers, type PublisherLoader, type PublisherPortfolioLoader } from "./usePublishers";

const props = withDefaults(defineProps<{
  readonly language: UiLanguage;
  readonly loadData: PublisherLoader;
  readonly loadPortfolio?: PublisherPortfolioLoader;
  readonly download?: (payload: PublisherExportPayload) => void;
  readonly autoLoad?: boolean;
}>(), {
  loadPortfolio: undefined,
  download: undefined,
  autoLoad: true
});

const publishers = usePublishers({ loadData: props.loadData, loadPortfolio: props.loadPortfolio });
const filters = publishers.filters;
const layout = publishers.layout;
const layoutEditing = publishers.layoutEditing;
const loading = publishers.loading;
const loadError = publishers.error;
const portfolioLoading = publishers.portfolioLoading;
const portfolioError = publishers.portfolioError;
const publisherQuery = ref("");
const publisherSelectorOpen = ref(false);
const merchantDropdownOpen = ref(false);
const managerDropdownOpen = ref(false);
const columnsOpen = ref(false);
const highlightedOverviewKey = ref("");
const draggingSection = ref("");
const draggedSectionIndex = ref(-1);
const visibleColumnKeys = ref<readonly PublisherTableSortKey[]>(PUBLISHER_TABLE_COLUMNS.map((column) => column.key));
const sort = ref<PublisherSort>({ key: "", direction: "asc" });
const tablePageSize = 100;

const copy = computed(() => ({
  title: message("publishers.title", "Publisher Affinity"),
  subtitle: message("publishers.subtitle", "Understand which merchants, categories, order values and commissions each publisher prefers."),
  customize: message("publishers.customizeLayout", "Customize layout"),
  editing: message("publishers.editing", "Editing layout"),
  layoutHint: message("publishers.layoutHint", "Drag the handle on the left to reorder sections"),
  resetLayout: message("publishers.resetLayout", "Reset layout"),
  cancel: message("publishers.cancel", "Cancel"),
  save: message("publishers.save", "Done"),
  selectPublisher: message("publishers.selectPublisher", "选择要分析的媒体"),
  selectPublisherHint: message("publishers.selectPublisherHint", "输入媒体名称或 ID，查看其合作商家与偏好。"),
  publisher: message("publishers.publisher", "Publisher"),
  period: message("publishers.period", "Period"),
  market: message("publishers.market", "Market"),
  network: message("publishers.network", "Affiliate Network"),
  linkType: message("publishers.linkType", "Link Type"),
  merchant: message("publishers.merchant", "Merchant"),
  manager: message("publishers.manager", "Manager"),
  apply: message("common.apply", "Apply filters"),
  reset: message("common.reset", "Reset"),
  export: message("publishers.export", "Export"),
  exportPage: message("publishers.exportPage", "Export current page"),
  exportAll: message("publishers.exportAll", "Export all"),
  allMarkets: message("publishers.allMarkets", "All markets"),
  allNetworks: message("publishers.allNetworks", "All networks"),
  allLinkTypes: message("publishers.allLinkTypes", "All link types"),
  merchantPlaceholder: message("publishers.merchantPlaceholder", "商家名称或 ID"),
  managerPlaceholder: message("publishers.managerPlaceholder", "经理名称"),
  publisherPlaceholder: message("publishers.publisherPlaceholder", "媒体名称或 ID"),
  noPublisherMatch: message("publishers.noPublisherMatch", "No matching publisher"),
  noMerchantMatch: message("publishers.merchantNoMatch", "No matching merchant"),
  affinityEmptyTitle: message("publishers.affinityEmptyTitle", "选择媒体后生成倾向画像"),
  affinityEmptyBody: message("publishers.affinityEmptyBody", "系统会按该媒体实际合作的商家，计算品类贡献、AOV 区间与佣金偏好。"),
  backToAll: message("publishers.backToAll", "返回全部媒体"),
  categoryAffinity: message("publishers.categoryAffinity", "品类倾向"),
  bySales: message("publishers.bySales", "按销售额贡献"),
  affinitySignals: message("publishers.affinitySignals", "倾向信号"),
  signalHint: message("publishers.signalHint", "用于判断合作偏好"),
  merchantPortfolio: message("publishers.merchantPortfolio", "合作商家组合"),
  conversion: message("publishers.conversion", "Conversion"),
  commissionRate: message("publishers.commissionRate", "AFF commission rate"),
  orders: message("publishers.orders", "Orders"),
  sales: message("publishers.sales", "Sales"),
  earnedCommission: message("publishers.earnedCommission", "AFF earned commission"),
  portfolioShare: message("publishers.portfolioShare", "Sales share"),
  portfolioMethod: message("publishers.portfolioMethod", "AOV = Sales ÷ Orders; AFF EPC = Sales × AFF commission rate ÷ Clicks; Conversion = Orders ÷ Clicks. AFF earned commission = ALL earned commission × 75%; AFF commission rate = AFF earned commission ÷ Sales."),
  activeMerchants: message("publishers.activeMerchants", "Active merchants"),
  inCurrentView: message("publishers.inCurrentView", "in current view"),
  topCategory: message("publishers.topCategory", "Top category"),
  ofSales: message("publishers.ofSales", "of sales"),
  weightedCommission: message("publishers.weightedCommission", "AFF weighted commission rate"),
  weightedBySales: message("publishers.weightedBySales", "weighted by merchant sales"),
  typicalAovBand: message("publishers.typicalAovBand", "Typical AOV band"),
  categoryConcentration: message("publishers.categoryConcentration", "Category concentration"),
  commissionProfile: message("publishers.commissionProfile", "AFF commission profile"),
  effectiveEarned: message("publishers.effectiveEarned", "effective AFF rate"),
  marketReach: message("publishers.marketReach", "Market reach"),
  leadsWith: message("publishers.leadsWith", "Leads with"),
  merchantsInView: message("publishers.merchantsInView", "merchants in view"),
  portfolioLoading: message("publishers.portfolioLoading", "Loading merchant-level activity for the selected period…"),
  portfolioError: message("publishers.portfolioError", "Could not load merchant-level activity"),
  noPortfolioRows: message("publishers.noPortfolioRows", "No merchants match the current filters"),
  loading: message("publishers.loading", "Loading…"),
  error: message("publishers.error", "Error"),
  empty: message("publishers.empty", "No data"),
  marketSummary: message("publishers.marketSummary", "Overview"),
  publisherCount: message("publishers.publisherCount", "Publishers"),
  commission: message("publishers.commission", "Commission"),
  total: message("publishers.total", "Total"),
  tableTitle: message("publishers.tableTitle", "Publisher Records"),
  columnsButton: message("publishers.columnsButton", "Display"),
  columnsTitle: message("publishers.columnsTitle", "Display columns"),
  columnsHint: message("publishers.columnsHint", "Choose fields to display"),
  coreColumns: message("publishers.coreColumns", "Default"),
  allColumns: message("publishers.allColumns", "All"),
  previous: message("publishers.previous", "Previous"),
  next: message("publishers.next", "Next"),
  noActivity: message("publishers.noActivity", "No activity"),
  merchants: message("publishers.merchants", "merchants")
}));

function message(key: string, fallback: string): string {
  return translateMessage(props.language, key, fallback);
}

const effectivePayload = computed(() => applyDateFilter(
  publishers.payload.value,
  filters.value.startDate,
  filters.value.endDate
));

const filteredRows = computed(() => filteredPublishers(effectivePayload.value, filters.value));
const selectedPublisher = computed<PublisherRecord | null>(() => {
  const selectedId = filters.value.selectedId;
  return effectivePayload.value.publishers.find((publisher) => publisher.userId === selectedId)
    || publishers.payload.value.publishers.find((publisher) => publisher.userId === selectedId)
    || null;
});
const selectedProfile = computed(() => Boolean(selectedPublisher.value));
const aggregate = computed<PublisherAggregate>(() => aggregatePublisherMetrics(filteredRows.value, filters.value.market));
const isDateFiltered = computed(() => Boolean(filters.value.startDate || filters.value.endDate));

const managerOptions = computed(() => {
  const counts = new Map<string, number>();
  publishers.payload.value.publishers.forEach((publisher) => {
    const name = publisher.adminName || "Unknown";
    counts.set(name, (counts.get(name) || 0) + 1);
  });
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((left, right) => {
    if (left.name === "Unknown") return 1;
    if (right.name === "Unknown") return -1;
    return left.name.localeCompare(right.name);
  });
});

const visibleManagerOptions = computed(() => {
  const query = filters.value.managerSearch.toLowerCase().trim();
  return managerOptions.value.filter((option) => !query || option.name.toLowerCase().includes(query));
});

const publisherOptions = computed(() => {
  const query = publisherQuery.value.toLowerCase().trim();
  return publishersForManager(effectivePayload.value.publishers, filters.value.managerSearch)
    .filter((publisher) => !query || publisher.userName.toLowerCase().includes(query) || publisher.userId.includes(query) || publisher.adminName.toLowerCase().includes(query))
    .slice(0, 60);
});

const merchantOptions = computed(() => {
  const query = filters.value.merchantSearch.toLowerCase().trim();
  return publisherMerchantOptions(effectivePayload.value).filter((merchant) => {
    return !query || merchant.name.toLowerCase().includes(query) || merchant.merchantId.toLowerCase().includes(query);
  }).slice(0, 60);
});

const association = computed(() => publisherAssociationSummary(
  effectivePayload.value,
  filteredRows.value,
  filters.value.merchantSearch,
  filters.value.merchantSelectedId
));
const associationPublishers = computed(() => [...association.value.publishers].sort((left, right) => right.total.sales - left.total.sales).slice(0, 8));
const associationRemaining = computed(() => Math.max(0, association.value.publisherCount - associationPublishers.value.length));

const profileMerchants = computed(() => publishers.portfolio.value?.merchants || []);
const profileAllRows = computed<readonly PublisherPortfolioRow[]>(() => portfolioRowsForState(profileMerchants.value, filters.value, false));
const profileRows = computed<readonly PublisherPortfolioRow[]>(() => portfolioRowsForState(profileMerchants.value, filters.value, true));
const profileSummary = computed(() => publisherAffinitySummary(profileAllRows.value, filters.value.market));
type PublisherKpiAggregate = Pick<PublisherAggregate, PublisherMetricKey>;
const profileKpiAggregate = computed<PublisherKpiAggregate>(() => ({
  clicks: profileSummary.value.clicks,
  dpv: profileSummary.value.dpv,
  atc: profileSummary.value.atc,
  orders: profileSummary.value.orders,
  sales: profileSummary.value.sales,
  allCommission: profileSummary.value.allCommission
}));
const kpiAggregate = computed<PublisherKpiAggregate>(() => selectedProfile.value && publishers.portfolio.value
  ? profileKpiAggregate.value
  : aggregate.value);
const profileCategories = computed(() => [...new Set(profileAllRows.value.map((row) => row.merchant.category || "Uncategorized"))].sort());
const profileTiers = computed(() => publisherTierOptions(profileAllRows.value, filters.value.portfolioTier));
const portfolioStatus = computed(() => {
  if (publishers.portfolioError.value) return `${copy.value.portfolioError}: ${publishers.portfolioError.value}`;
  return publishers.portfolioLoading.value ? copy.value.portfolioLoading : "";
});

const overviewAllRows = computed(() => publisherOverviewRows(filteredRows.value, filters.value.overviewType, filters.value.chartMetric));
const overviewRows = computed(() => filters.value.overviewFocus
  ? overviewAllRows.value.filter((row) => row.key === filters.value.overviewFocus)
  : overviewAllRows.value);
const overviewTotal = computed(() => overviewRows.value.reduce((sum, row) => sum + row.value, 0));
const overviewLeader = computed(() => overviewRows.value[0] || null);
const overviewTotals = computed(() => overviewRows.value.reduce((totals, row) => ({
  clicks: totals.clicks + row.clicks,
  orders: totals.orders + row.orders,
  allCommission: totals.allCommission + row.allCommission
}), { clicks: 0, orders: 0, allCommission: 0 }));
const overviewSegments = computed(() => {
  const total = overviewTotal.value || 1;
  let current = 0;
  return overviewRows.value.map((row) => {
    const fraction = row.value / total;
    const dash = Math.max(0.1, fraction * 100);
    const segment = {
      ...row,
      color: PUBLISHER_CHART_COLORS[filters.value.chartMetric] || "#3b82f6",
      dash,
      offset: -current,
      percentage: fraction * 100,
      originalIndex: overviewAllRows.value.findIndex((candidate) => candidate.key === row.key)
    };
    current += dash;
    return segment;
  });
});
const overviewColor = (row: PublisherOverviewRow): string => {
  const index = overviewAllRows.value.findIndex((candidate) => candidate.key === row.key);
  const colors = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#06b6d4"];
  return colors[(index < 0 ? 0 : index) % colors.length] || colors[0] || "#3b82f6";
};

const chartRows = computed(() => [...filteredRows.value].sort((left, right) => {
  const leftMetric = filters.value.market !== "all" ? left.markets[filters.value.market] : left.total;
  const rightMetric = filters.value.market !== "all" ? right.markets[filters.value.market] : right.total;
  return (rightMetric?.[filters.value.chartMetric] || 0) - (leftMetric?.[filters.value.chartMetric] || 0);
}).slice(0, 15));
const chartMax = computed(() => {
  const first = chartRows.value[0];
  if (!first) return 1;
  const metric = filters.value.market !== "all" ? first.markets[filters.value.market] : first.total;
  return Math.max(1, metric?.[filters.value.chartMetric] || 0);
});

function chartMetricValue(publisher: PublisherRecord): number {
  const metric = filters.value.market !== "all" ? publisher.markets[filters.value.market] : publisher.total;
  return metric?.[filters.value.chartMetric] || 0;
}

function chartBarWidth(publisher: PublisherRecord): string {
  return `${Math.max(2, Number((chartMetricValue(publisher) / chartMax.value * 100).toFixed(1)))}%`;
}

function chartValueLabel(publisher: PublisherRecord): string {
  const value = chartMetricValue(publisher);
  return value / chartMax.value * 100 > 5 ? formatMetric(value, filters.value.chartMetric) : "";
}

function chartMetricLabel(): string {
  return PUBLISHER_KPI_DEFINITIONS.find((definition) => definition.key === filters.value.chartMetric)?.label || "Clicks";
}

const allTableRows = computed(() => publisherTableRows(filteredRows.value, filters.value.market, aggregate.value, sort.value));
const tablePagination = computed(() => paginate(allTableRows.value, filters.value.tablePage, tablePageSize));
const totalTableRow = computed<PublisherTableRow>(() => ({
  rank: 0,
  userId: "",
  userName: "Total",
  adminName: "",
  clicks: aggregate.value.clicks,
  conversionRate: aggregate.value.conversionRate,
  dpv: aggregate.value.dpv,
  atc: aggregate.value.atc,
  orders: aggregate.value.orders,
  sales: aggregate.value.sales,
  allCommission: aggregate.value.allCommission,
  affCommission: aggregate.value.affCommission,
  grossProfit: aggregate.value.grossProfit
}));
const displayTableRows = computed(() => [totalTableRow.value, ...tablePagination.value.rows]);
const displayColumns = computed(() => PUBLISHER_TABLE_COLUMNS.filter((column) => visibleColumnKeys.value.includes(column.key)));

function formatNumber(value: unknown, maximumFractionDigits = 0): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString("en-US", { maximumFractionDigits }) : "-";
}

function formatMoney(value: unknown): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `$${numeric.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "-";
}

function formatCompactNumber(value: unknown): string {
  const numeric = Number(value) || 0;
  if (Math.abs(numeric) >= 1_000_000) return `${(numeric / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
  if (Math.abs(numeric) >= 1_000) return `${(numeric / 1_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}K`;
  return formatNumber(numeric);
}

function formatCompactMoney(value: unknown): string {
  const numeric = Number(value) || 0;
  if (Math.abs(numeric) >= 1_000_000) return `$${(numeric / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
  if (Math.abs(numeric) >= 1_000) return `$${(numeric / 1_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}K`;
  return formatMoney(numeric);
}

function formatMetric(value: unknown, metric: PublisherMetricKey): string {
  return metric === "sales" || metric === "allCommission" ? formatCompactMoney(value) : formatCompactNumber(value);
}

function formatFullMetric(value: unknown, metric: PublisherMetricKey): string {
  return metric === "sales" || metric === "allCommission" ? formatMoney(value) : formatNumber(value);
}

function formatPercent(value: unknown): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(2)}%` : "-";
}

function formatRate(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "N/A" : `${value.toFixed(2)}%`;
}

function formatEpc(value: number): string {
  return Number.isFinite(value) ? `$${value.toFixed(3)}` : "-";
}

function formatAov(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "N/A" : formatMoney(value);
}

function portfolioMetric(row: PublisherPortfolioRow): PublisherMetric {
  return row.metrics;
}

function profileMarketText(row: PublisherPortfolioRow): string {
  const names = Object.keys(row.merchant.markets);
  const visible = filters.value.market !== "all" ? names.filter((market) => market === filters.value.market) : names;
  const result = visible.slice(0, 2).join(" · ");
  return visible.length > 2 ? `${result} +${visible.length - 2}` : result || "Unknown";
}

function tierTone(tier: string): string {
  const match = /^Tier ([1-4])$/.exec(tier);
  if (tier === "BLACK TIER") return "black";
  return match ? `tier-${match[1]}` : "unknown";
}

function setFilters(patch: Partial<PublisherFilters>, resetPage = true): void {
  publishers.setFilters(resetPage ? { ...patch, tablePage: 1 } : patch);
}

function setMarket(value: string): void { setFilters({ market: value || "all", overviewFocus: "" }); }
function setNetwork(value: string): void { setFilters({ network: value || "all", overviewFocus: "" }); }
function setLinkType(value: string): void { setFilte