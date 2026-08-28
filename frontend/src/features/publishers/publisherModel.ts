import { toFiniteNumber } from "../../shared/format/number";

export const PUBLISHER_METRIC_KEYS = [
  "clicks",
  "dpv",
  "atc",
  "orders",
  "sales",
  "allCommission"
] as const;

export type PublisherMetricKey = (typeof PUBLISHER_METRIC_KEYS)[number];
export type PublisherOverviewType = "market" | "network";
export type PublisherPortfolioSort =
  | "sales"
  | "orders"
  | "aov"
  | "affCommissionRate"
  | "affCommission"
  | "merchantName";

export interface PublisherMetric {
  readonly clicks: number;
  readonly dpv: number;
  readonly atc: number;
  readonly orders: number;
  readonly sales: number;
  readonly allCommission: number;
  readonly affCommission: number;
  readonly aov: number | null;
  readonly epc: number;
  readonly allEpc: number;
  readonly affEpc: number;
  readonly conversionRate: number;
  readonly effectiveCommissionRate: number | null;
}

export type PublisherMetricLike = Partial<PublisherMetric>;

export interface PublisherRecord {
  readonly userId: string;
  readonly userName: string;
  readonly adminName: string;
  readonly networks: readonly string[];
  readonly linkTypes: Readonly<Record<string, PublisherMetric>>;
  readonly merchantIds: readonly string[];
  readonly markets: Readonly<Record<string, PublisherMetric>>;
  readonly total: PublisherMetric;
}

export interface PublisherMerchantLike {
  readonly merchantId?: unknown;
  readonly id?: unknown;
  readonly merchantName?: unknown;
  readonly category?: unknown;
  readonly network?: unknown;
  readonly tier?: unknown;
  readonly commissionRate?: unknown;
  readonly commission_rate?: unknown;
  readonly markets?: unknown;
  readonly total?: unknown;
}

export interface PublisherMerchant {
  readonly merchantId: string;
  readonly merchantName: string;
  readonly category: string;
  readonly network: string;
  readonly tier: string;
  readonly commissionRate: number | null;
  readonly markets: Readonly<Record<string, PublisherMetric>>;
  readonly total: PublisherMetric;
}

export interface DailyPublisherMetric extends Partial<PublisherMetric> {
  readonly userId: string;
  readonly market: string;
}

export interface PublishersPayload {
  readonly generatedAt: string;
  readonly publishers: readonly PublisherRecord[];
  readonly summary: Readonly<Record<string, number | string>>;
  readonly markets: readonly string[];
  readonly networks: readonly string[];
  readonly linkTypes: readonly string[];
  readonly merchantNameMap: Readonly<Record<string, string>>;
  readonly days: readonly string[];
  readonly dailyRows: Readonly<Record<string, readonly DailyPublisherMetric[]>>;
}

export interface PublisherPortfolioPayload {
  readonly publisher?: Readonly<{
    userId?: unknown;
    userName?: unknown;
    adminName?: unknown;
  }>;
  readonly merchants: readonly PublisherMerchant[];
}

export interface PublisherFilters {
  readonly market: string;
  readonly network: string;
  readonly linkType: string;
  readonly merchantSearch: string;
  readonly merchantSelectedId: string;
  readonly productSearch: string;
  readonly managerSearch: string;
  readonly siteSearch: string;
  readonly trackSearch: string;
  readonly portfolioSearch: string;
  readonly portfolioCategory: string;
  readonly portfolioTier: string;
  readonly portfolioSort: PublisherPortfolioSort;
  readonly selectedId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly chartMetric: PublisherMetricKey;
  readonly overviewFocus: string;
  readonly overviewType: PublisherOverviewType;
  readonly tablePage: number;
  readonly overviewExpanded: boolean;
  readonly chartExpanded: boolean;
}

export interface PublisherAggregate extends PublisherMetric {
  readonly grossProfit: number;
}

export interface PublisherPortfolioRow {
  readonly merchant: PublisherMerchant;
  readonly metrics: PublisherMetric;
}

export interface PublisherAffinityCategory {
  readonly category: string;
  readonly merchantCount: number;
  readonly orders: number;
  readonly sales: number;
  readonly allCommission: number;
  readonly salesShare: number;
}

export interface PublisherAffinityBand {
  readonly label: string;
  readonly merchantCount: number;
  readonly sales: number;
  readonly salesShare: number;
}

export interface PublisherAffinityMarket {
  readonly market: string;
  readonly sales: number;
}

export interface PublisherAffinitySummary {
  readonly merchantCount: number;
  readonly clicks: number;
  readonly dpv: number;
  readonly atc: number;
  readonly orders: number;
  readonly sales: number;
  readonly allCommission: number;
  readonly affCommission: number;
  readonly aov: number | null;
  readonly weightedCommissionRate: number | null;
  readonly effectiveCommissionRate: number | null;
  readonly categories: readonly PublisherAffinityCategory[];
  readonly aovBands: readonly PublisherAffinityBand[];
  readonly markets: readonly PublisherAffinityMarket[];
}

export interface PublisherOverviewRow {
  readonly key: string;
  readonly clicks: number;
  readonly dpv: number;
  readonly atc: number;
  readonly publisherCount: number;
  readonly orders: number;
  readonly sales: number;
  readonly allCommission: number;
  readonly value: number;
}

export interface PublisherSort {
  readonly key: PublisherTableSortKey;
  readonly direction: "asc" | "desc";
}

export interface PublisherExportPayload {
  readonly scope: "page" | "all" | "portfolio";
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly filters: PublisherFilters;
  readonly publisherId?: string;
}

export type PublisherTableSortKey =
  | ""
  | "rank"
  | "userId"
  | "userName"
  | "adminName"
  | "clicks"
  | "conversionRate"
  | "dpv"
  | "atc"
  | "orders"
  | "sales"
  | "allCommission"
  | "affCommission"
  | "grossProfit";

export interface PublisherTableRow {
  readonly rank: number;
  readonly userId: string;
  readonly userName: string;
  readonly adminName: string;
  readonly clicks: number;
  readonly conversionRate: number;
  readonly dpv: number;
  readonly atc: number;
  readonly orders: number;
  readonly sales: number;
  readonly allCommission: number;
  readonly affCommission: number;
  readonly grossProfit: number;
}

export interface Pagination<T> {
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
  readonly totalRows: number;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly rows: readonly T[];
}

export interface PublisherMerchantOption {
  readonly merchantId: string;
  readonly name: string;
  readonly count: number;
}

export interface PublisherAssociationSummary {
  readonly query: string;
  readonly merchantCount: number;
  readonly publisherCount: number;
  readonly merchants: readonly { merchantId: string; merchantName: string }[];
  readonly publishers: readonly PublisherRecord[];
}

export const DEFAULT_PUBLISHER_FILTERS: PublisherFilters = {
  market: "all",
  network: "all",
  linkType: "all",
  merchantSearch: "",
  merchantSelectedId: "",
  productSearch: "",
  managerSearch: "",
  siteSearch: "",
  trackSearch: "",
  portfolioSearch: "",
  portfolioCategory: "all",
  portfolioTier: "all",
  portfolioSort: "sales",
  selectedId: "",
  startDate: "",
  endDate: "",
  chartMetric: "clicks",
  overviewFocus: "",
  overviewType: "network",
  tablePage: 1,
  overviewExpanded: true,
  chartExpanded: true
};

export const PUBLISHER_KPI_DEFINITIONS: readonly {
  readonly key: PublisherMetricKey;
  readonly label: string;
  readonly icon: string;
  readonly tone: string;
}[] = [
  { key: "clicks", label: "Clicks", icon: "C", tone: "blue" },
  { key: "dpv", label: "DPV", icon: "V", tone: "violet" },
  { key: "atc", label: "ATC", icon: "A", tone: "amber" },
  { key: "orders", label: "Orders", icon: "O", tone: "green" },
  { key: "sales", label: "Sales", icon: "$", tone: "teal" },
  { key: "allCommission", label: "Commission", icon: "‡", tone: "rose" }
];

export const PUBLISHER_CHART_COLORS: Readonly<Record<PublisherMetricKey, string>> = {
  clicks: "#66b3ff",
  dpv: "#22c55e",
  atc: "#ec4899",
  orders: "#ef4444",
  sales: "#a855f7",
  allCommission: "#f97316"
};

export const PUBLISHER_TABLE_COLUMNS: readonly {
  readonly key: PublisherTableSortKey;
  readonly label: string;
}[] = [
  { key: "rank", label: "#" },
  { key: "userId", label: "Publisher ID" },
  { key: "userName", label: "Publisher Name" },
  { key: "adminName", label: "Manager" },
  { key: "clicks", label: "Clicks" },
  { key: "conversionRate", label: "CVR" },
  { key: "dpv", label: "DPV" },
  { key: "atc", label: "ATC" },
  { key: "orders", label: "Orders" },
  { key: "sales", label: "Sales" },
  { key: "allCommission", label: "All Comm" },
  { key: "affCommission", label: "Aff Comm" },
  { key: "grossProfit", label: "Gross Profit" }
];

const PUBLISHER_AFF_COMMISSION_SHARE = 0.75;
const MARKET_ORDER = [
  "amazon.com",
  "amazon.co.uk",
  "amazon.de",
  "amazon.fr",
  "amazon.ca",
  "amazon.it",
  "amazon.com.mx",
  "amazon.es",
  "amazon.nl"
] as const;
const TIER_ORDER = ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"] as const;

type RawRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function numberValue(source: object, keys: readonly string[], fallback = 0): number {
  const values = source as Readonly<Record<string, unknown>>;
  for (const key of keys) {
    if (values[key] === undefined || values[key] === null || String(values[key]).trim() === "") continue;
    return toFiniteNumber(values[key], fallback);
  }
  return fallback;
}

function nullableNumber(source: object, keys: readonly string[]): number | null {
  const values = source as Readonly<Record<string, unknown>>;
  for (const key of keys) {
    const value = values[key];
    if (value === undefined || value === null || String(value).trim() === "") continue;
    const result = Number(String(value).replace(/[$,%]/g, "").replace(/,/g, "").trim());
    return Number.isFinite(result) ? result : null;
  }
  return null;
}

function normalizedText(value: unknown): string {
  return text(value).toLowerCase().trim();
}

function normalizeMetric(raw: unknown): PublisherMetric {
  const source = isRecord(raw) ? raw : {};
  const clicks = numberValue(source, ["clicks"]);
  const dpv = numberValue(source, ["dpv"]);
  const atc = numberValue(source, ["atc"]);
  const orders = numberValue(source, ["orders"]);
  const sales = numberValue(source, ["sales"]);
  const allCommission = numberValue(source, ["allCommission", "all_commission"]);
  const providedAffCommission = nullableNumber(source, ["affCommission", "aff_commission"]);
  const affCommission = providedAffCommission ?? allCommission * PUBLISHER_AFF_COMMISSION_SHARE;
  const aov = nullableNumber(source, ["aov"]) ?? (orders > 0 ? sales / orders : null);
  const epc = numberValue(source, ["epc"], clicks > 0 ? affCommission / clicks : 0);
  const allEpc = numberValue(source, ["allEpc", "all_epc"], clicks > 0 ? allCommission / clicks : 0);
  const affEpc = numberValue(source, ["affEpc", "aff_epc"], clicks > 0 ? affCommission / clicks : 0);
  const conversionRate = numberValue(source, ["conversionRate", "conversion_rate"], clicks > 0 ? orders / clicks : 0);
  const effectiveCommissionRate = nullableNumber(source, ["effectiveCommissionRate", "effective_commission_rate"])
    ?? (sales > 0 ? allCommission / sales * 100 : null);
  return {
    clicks,
    dpv,
    atc,
    orders,
    sales,
    allCommission,
    affCommission,
    aov,
    epc,
    allEpc,
    affEpc,
    conversionRate,
    effectiveCommissionRate
  };
}

function normalizeMetricMap(raw: unknown): Readonly<Record<string, PublisherMetric>> {
  if (!isRecord(raw)) return {};
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, normalizeMetric(value)]));
}

function normalizePublisher(raw: unknown): PublisherRecord | null {
  if (!isRecord(raw)) return null;
  const userId = text(raw.userId);
  if (!userId) return null;
  const networks = Array.isArray(raw.networks)
    ? raw.networks.map((value) => text(value)).filter(Boolean)
    : [];
  const merchantIds = Array.isArray(raw.merchantIds)
    ? raw.merchantIds.map((value) => text(value)).filter(Boolean)
    : [];
  return {
    userId,
    userName: text(raw.userName, userId),
    adminName: text(raw.adminName, "Unknown"),
    networks: [...new Set(networks)],
    linkTypes: normalizeMetricMap(raw.linkTypes),
    merchantIds: [...new Set(merchantIds)],
    markets: normalizeMetricMap(raw.markets),
    total: normalizeMetric(raw.total)
  };
}

function normalizeMerchant(raw: unknown): PublisherMerchant {
  const source = isRecord(raw) ? raw : {};
  const merchantId = text(source.merchantId, text(source.id, ""));
  return {
    merchantId,
    merchantName: text(source.merchantName, merchantId || "Unknown"),
    category: text(source.category, "Uncategorized"),
    network: text(source.network, "Unknown"),
    tier: text(source.tier, "Unknown"),
    commissionRate: nullableNumber(source, ["commissionRate", "commission_rate"]),
    markets: normalizeMetricMap(source.markets),
    total: normalizeMetric(source.total)
  };
}

function normalizeDailyRow(raw: unknown): DailyPublisherMetric | null {
  if (!isRecord(raw)) return null;
  const userId = text(raw.userId);
  const market = text(raw.market, "Unknown");
  if (!userId || !market) return null;
  return { userId, market, ...normalizeMetric(raw) };
}

function stringList(raw: unknown): readonly string[] {
  return Array.isArray(raw) ? [...new Set(raw.map((value) => text(value)).filter(Boolean))] : [];
}

export function normalizePublishersPayload(payload: unknown): PublishersPayload {
  const source = isRecord(payload) ? payload : {};
  const publisherRows = Array.isArray(source.publishers)
    ? source.publishers.map(normalizePublisher).filter((row): row is PublisherRecord => row !== null)
    : [];
  const map: Record<string, string> = {};
  if (isRecord(source.merchantNameMap)) {
    Object.entries(source.merchantNameMap).forEach(([key, value]) => {
      const name = text(value, key);
      if (name) map[key] = name;
    });
  }
  const dailyRows: Record<string, readonly DailyPublisherMetric[]> = {};
  if (isRecord(source.dailyRows)) {
    Object.entries(source.dailyRows).forEach(([key, rows]) => {
      if (!Array.isArray(rows)) return;
      dailyRows[key] = rows.map(normalizeDailyRow).filter((row): row is DailyPublisherMetric => row !== null);
    });
  }
  const summary: Record<string, number | string> = {};
  if (isRecord(source.summary)) {
    Object.entries(source.summary).forEach(([key, value]) => {
      if (typeof value === "number" && Number.isFinite(value)) summary[key] = value;
      else if (typeof value === "string") summary[key] = value;
    });
  }
  return {
    generatedAt: text(source.generatedAt),
    publishers: publisherRows,
    summary,
    markets: stringList(source.markets),
    networks: stringList(source.networks),
    linkTypes: stringList(source.linkTypes),
    merchantNameMap: map,
    days: stringList(source.days),
    dailyRows
  };
}

export function normalizePublisherPortfolioPayload(payload: unknown): PublisherPortfolioPayload {
  const source = isRecord(payload) ? payload : {};
  const merchants = Array.isArray(source.merchants)
    ? source.merchants.map(normalizeMerchant)
    : [];
  const publisher = isRecord(source.publisher) ? source.publisher : undefined;
  return { merchants, ...(publisher ? { publisher } : {}) };
}

export function publisherMetricForMarket(
  merchant: PublisherMerchant,
  market: string
): PublisherMetric | null {
  if (market && market !== "all") return merchant.markets[market] || null;
  return merchant.total;
}

export function publisherMetricIsActive(metric: PublisherMetricLike | null | undefined): boolean {
  if (!metric) return false;
  return ["clicks", "dpv", "atc", "orders", "sales", "allCommission", "affCommission"]
    .some((key) => numberValue(metric, [key]) > 0);
}

export function publisherMetricAffCommission(metric: PublisherMetricLike | null | undefined): number | null {
  if (!metric) return null;
  const allCommission = Number(metric.allCommission);
  return Number.isFinite(allCommission) ? allCommission * PUBLISHER_AFF_COMMISSION_SHARE : null;
}

export function publisherMetricAffCommissionRate(metric: PublisherMetricLike | null | undefined): number | null {
  if (!metric) return null;
  const sales = Number(metric.sales);
  const affCommission = publisherMetricAffCommission(metric);
  return Number.isFinite(sales) && sales > 0 && affCommission !== null
    ? affCommission / sales * 100
    : null;
}

export function publisherMetricAffEpc(metric: PublisherMetricLike | null | undefined): number {
  if (!metric) return 0;
  const clicks = Number(metric.clicks);
  const sales = Number(metric.sales);
  const rate = publisherMetricAffCommissionRate(metric);
  return clicks > 0 && Number.isFinite(sales) && rate !== null ? sales * (rate / 100) / clicks : 0;
}

export function publisherMetricConversionRate(metric: PublisherMetricLike | null | undefined): number {
  if (!metric) return 0;
  const clicks = Number(metric.clicks);
  const orders = Number(metric.orders);
  return clicks > 0 && Number.isFinite(orders) ? orders / clicks : 0;
}

export function publisherMetricAov(metric: PublisherMetricLike | null | undefined): number | null {
  if (!metric) return null;
  const rawProvided = metric.aov;
  if (rawProvided !== null && rawProvided !== undefined && String(rawProvided).trim() !== "") {
    const provided = Number(rawProvided);
    if (Number.isFinite(provided)) return provided;
  }
  const sales = Number(metric.sales);
  const orders = Number(metric.orders);
  return orders > 0 && Number.isFinite(sales) ? sales / orders : null;
}

export function publisherManagerMatches(publisher: PublisherRecord, managerQuery: string): boolean {
  const query = normalizedText(managerQuery);
  return !query || normalizedText(publisher.adminName).includes(query);
}

export function publishersForManager(
  publishers: readonly PublisherRecord[],
  managerQuery: string
): readonly PublisherRecord[] {
  return publishers.filter((publisher) => publisherManagerMatches(publisher, managerQuery));
}

export function publisherMerchantOptions(data: PublishersPayload): readonly PublisherMerchantOption[] {
  const counts: Record<string, number> = {};
  data.publishers.forEach((publisher) => {
    const seen = new Set<string>();
    publisher.merchantIds.forEach((merchantId) => {
      if (!merchantId || seen.has(merchantId)) return;
      seen.add(merchantId);
      counts[merchantId] = (counts[merchantId] || 0) + 1;
    });
  });
  return Object.keys(counts).map((merchantId) => ({
    merchantId,
    name: data.merchantNameMap[merchantId] || merchantId,
    count: counts[merchantId] || 0
  })).sort((left, right) => left.name.localeCompare(right.name) || left.merchantId.localeCompare(right.merchantId));
}

export function publisherMerchantMatches(
  data: PublishersPayload,
  query: string
): readonly { merchantId: string; merchantName: string }[] {
  const normalizedQuery = normalizedText(query);
  if (!normalizedQuery) return [];
  const merchantIds = new Set(Object.keys(data.merchantNameMap));
  data.publishers.forEach((publisher) => publisher.merchantIds.forEach((merchantId) => merchantIds.add(merchantId)));
  return [...merchantIds].filter((merchantId) => {
    const name = normalizedText(data.merchantNameMap[merchantId]);
    return normalizedText(merchantId).includes(normalizedQuery) || name.includes(normalizedQuery);
  }).map((merchantId) => ({
    merchantId,
    merchantName: data.merchantNameMap[merchantId] || merchantId
  }));
}

export function publisherAssociationSummary(
  data: PublishersPayload,
  publishers: readonly PublisherRecord[],
  query: string,
  selectedMerchantId = ""
): PublisherAssociationSummary {
  const selectedId = text(selectedMerchantId);
  const merchants = selectedId
    ? publisherMerchantMatches(data, selectedId).filter((merchant) => merchant.merchantId === selectedId)
    : publisherMerchantMatches(data, query);
  return {
    query: text(query),
    merchantCount: merchants.length,
    publisherCount: publishers.length,
    merchants,
    publishers: [...publishers]
  };
}

export function filteredPublishers(
  data: PublishersPayload,
  filters: Pick<PublisherFilters, "market" | "network" | "linkType" | "merchantSearch" | "merchantSelectedId" | "productSearch" | "managerSearch" | "siteSearch" | "trackSearch">
): readonly PublisherRecord[] {
  const market = filters.market || "all";
  const network = filters.network || "all";
  const linkType = filters.linkType || "all";
  const merchantSearch = normalizedText(filters.merchantSearch);
  const selectedMerchantId = text(filters.merchantSelectedId);
  const productSearch = normalizedText(filters.productSearch);
  const siteSearch = normalizedText(filters.siteSearch);
  const trackSearch = normalizedText(filters.trackSearch);
  const matchingMerchantIds = selectedMerchantId
    ? new Set([selectedMerchantId])
    : merchantSearch
      ? new Set(publisherMerchantMatches(data, merchantSearch).map((merchant) => merchant.merchantId))
      : null;

  return data.publishers.filter((publisher) => {
    if (market !== "all" && !publisher.markets[market]) return false;
    if (network !== "all" && !publisher.networks.includes(network)) return false;
    if (linkType !== "all" && !publisher.linkTypes[linkType]) return false;
    if ((merchantSearch || selectedMerchantId) && matchingMerchantIds) {
      if (!publisher.merchantIds.some((merchantId) => matchingMerchantIds.has(merchantId))) return false;
    }
    if (productSearch && !normalizedText(publisher.userName).includes(productSearch) && !publisher.userId.includes(productSearch)) return false;
    if (!publisherManagerMatches(publisher, filters.managerSearch)) return false;
    if (siteSearch) {
      const siteMatches = Object.keys(publisher.markets).some((key) => normalizedText(key).includes(siteSearch));
      if (!siteMatches && !normalizedText(publisher.userName).includes(siteSearch) && !publisher.userId.includes(siteSearch)) return false;
    }
    if (trackSearch && !normalizedText(publisher.userName).includes(trackSearch) && !publisher.userId.includes(trackSearch) && !normalizedText(publisher.adminName).includes(trackSearch)) return false;
    return true;
  });
}

function emptyMetric(): PublisherMetric {
  return normalizeMetric({});
}

export function aggregatePublisherMetrics(
  publishers: readonly PublisherRecord[],
  market: string
): PublisherAggregate {
  const values = publishers.map((publisher) => market && market !== "all" ? publisher.markets[market] : publisher.total);
  const totals = values.reduce((acc, metric) => {
    if (!metric) return acc;
    acc.clicks += metric.clicks;
    acc.dpv += metric.dpv;
    acc.atc += metric.atc;
    acc.orders += metric.orders;
    acc.sales += metric.sales;
    acc.allCommission += metric.allCommission;
    acc.affCommission += metric.affCommission;
    return acc;
  }, { clicks: 0, dpv: 0, atc: 0, orders: 0, sales: 0, allCommission: 0, affCommission: 0 });
  const normalizedTotals = normalizeMetric(totals);
  const conversionRate = publisherMetricConversionRate(normalizedTotals);
  const aov = normalizedTotals.orders > 0 ? normalizedTotals.sales / normalizedTotals.orders : null;
  const effectiveCommissionRate = normalizedTotals.sales > 0 ? normalizedTotals.affCommission / normalizedTotals.sales * 100 : null;
  return {
    ...normalizedTotals,
    aov,
    epc: normalizedTotals.clicks > 0 ? normalizedTotals.affCommission / normalizedTotals.clicks : 0,
    allEpc: normalizedTotals.clicks > 0 ? normalizedTotals.allCommission / normalizedTotals.clicks : 0,
    affEpc: normalizedTotals.clicks > 0 ? normalizedTotals.affCommission / normalizedTotals.clicks : 0,
    conversionRate,
    effectiveCommissionRate,
    grossProfit: normalizedTotals.allCommission - normalizedTotals.affCommission
  };
}

export function portfolioRowsForState(
  merchants: readonly PublisherMerchantLike[],
  filters: Pick<PublisherFilters, "market" | "network" | "merchantSearch" | "merchantSelectedId" | "portfolioSearch" | "portfolioCategory" | "portfolioTier" | "portfolioSort">,
  includePortfolioControls: boolean
): readonly PublisherPortfolioRow[] {
  const market = filters.market || "all";
  const network = filters.network || "all";
  const globalSearch = normalizedText(filters.merchantSearch);
  const globalSelectedId = text(filters.merchantSelectedId);
  const portfolioSearch = includePortfolioControls ? normalizedText(filters.portfolioSearch) : "";
  const categoryFilter = includePortfolioControls ? filters.portfolioCategory || "all" : "all";
  const tierFilter = includePortfolioControls ? filters.portfolioTier || "all" : "all";
  const rows = merchants.map((rawMerchant) => {
    const merchant = normalizeMerchant(rawMerchant);
    return { merchant, metrics: publisherMetricForMarket(merchant, market) };
  }).filter((row): row is PublisherPortfolioRow => {
    const { merchant, metrics } = row;
    // The selected publisher profile is a relationship view, so merchants with
    // zero activity still belong in the portfolio table. Their zero values are
    // meaningful when comparing the full set of active partnerships.
    if (!metrics) return false;
    if (network !== "all" && merchant.network !== network) return false;
    if (globalSelectedId && merchant.merchantId !== globalSelectedId) return false;
    if (!globalSelectedId && globalSearch) {
      const haystack = [merchant.merchantId, merchant.merchantName, merchant.category, merchant.network, merchant.tier].join(" ").toLowerCase();
      if (!haystack.includes(globalSearch)) return false;
    }
    if (categoryFilter !== "all" && merchant.category !== categoryFilter) return false;
    if (tierFilter !== "all" && merchant.tier !== tierFilter) return false;
    if (portfolioSearch) {
      const haystack = [merchant.merchantId, merchant.merchantName, merchant.category, merchant.network, merchant.tier, ...Object.keys(merchant.markets)].join(" ").toLowerCase();
      if (!haystack.includes(portfolioSearch)) return false;
    }
    return true;
  });
  if (!includePortfolioControls) return rows;
  return [...rows].sort((left, right) => {
    if (filters.portfolioSort === "merchantName") return left.merchant.merchantName.localeCompare(right.merchant.merchantName);
    const value = (row: PublisherPortfolioRow): number => {
      switch (filters.portfolioSort) {
        case "affCommissionRate": return publisherMetricAffCommissionRate(row.metrics) ?? -1;
        case "affCommission": return publisherMetricAffCommission(row.metrics) ?? -1;
        case "aov": return publisherMetricAov(row.metrics) ?? -1;
        case "orders": return row.metrics.orders;
        case "sales": return row.metrics.sales;
      }
      return 0;
    };
    return value(right) - value(left) || left.merchant.merchantName.localeCompare(right.merchant.merchantName);
  });
}

export function publisherAovBand(aov: number | null): string {
  if (aov === null || !Number.isFinite(aov)) return "N/A";
  if (aov < 50) return "< $50";
  if (aov < 100) return "$50–99";
  if (aov < 200) return "$100–199";
  return "$200+";
}

export function publisherAffinitySummary(
  rows: readonly PublisherPortfolioRow[],
  marketOverride?: string
): PublisherAffinitySummary {
  let clicks = 0;
  let dpv = 0;
  let atc = 0;
  let orders = 0;
  let sales = 0;
  let allCommission = 0;
  let affCommission = 0;
  const categories = new Map<string, { category: string; merchantCount: number; orders: number; sales: number; allCommission: number }>();
  const aovBands = new Map<string, { label: string; merchantCount: number; sales: number }>();
  const markets = new Map<string, { market: string; sales: number }>();
  let rateNumerator = 0;
  let rateDenominator = 0;
  const fallbackRates: number[] = [];

  rows.forEach(({ merchant, metrics }) => {
    clicks += metrics.clicks;
    dpv += metrics.dpv;
    atc += metrics.atc;
    orders += metrics.orders;
    sales += metrics.sales;
    allCommission += metrics.allCommission;
    affCommission += publisherMetricAffCommission(metrics) || 0;
    const category = merchant.category || "Uncategorized";
    const categoryRow = categories.get(category) || { category, merchantCount: 0, orders: 0, sales: 0, allCommission: 0 };
    categoryRow.merchantCount += 1;
    categoryRow.orders += metrics.orders;
    categoryRow.sales += metrics.sales;
    categoryRow.allCommission += metrics.allCommission;
    categories.set(category, categoryRow);
    const band = publisherAovBand(publisherMetricAov(metrics));
    const bandRow = aovBands.get(band) || { label: band, merchantCount: 0, sales: 0 };
    bandRow.merchantCount += 1;
    bandRow.sales += metrics.sales;
    aovBands.set(band, bandRow);
    const rate = publisherMetricAffCommissionRate(metrics);
    if (rate !== null) {
      fallbackRates.push(rate);
      if (metrics.sales > 0) {
        rateNumerator += rate * metrics.sales;
        rateDenominator += metrics.sales;
      }
    }
    const marketNames = marketOverride && marketOverride !== "all" ? [marketOverride] : Object.keys(merchant.markets);
    marketNames.forEach((market) => {
      const marketMetric = merchant.markets[market];
      if (!marketMetric || !publisherMetricIsActive(marketMetric)) return;
      const marketRow = markets.get(market) || { market, sales: 0 };
      marketRow.sales += marketMetric.sales;
      markets.set(market, marketRow);
    });
  });
  const share = (value: number): number => sales > 0 ? value / sales : 0;
  const categoryRows = [...categories.values()].map((row) => ({ ...row, salesShare: share(row.sales) }))
    .sort((left, right) => right.sales - left.sales || right.merchantCount - left.merchantCount);
  const bandRows = [...aovBands.values()].map((row) => ({ ...row, salesShare: share(row.sales) }))
    .sort((left, right) => right.sales - left.sales || right.merchantCount - left.merchantCount);
  const weightedCommissionRate = rateDenominator > 0
    ? rateNumerator / rateDenominator
    : fallbackRates.length ? fallbackRates.reduce((sum, rate) => sum + rate, 0) / fallbackRates.length : null;
  return {
    merchantCount: rows.length,
    clicks,
    dpv,
    atc,
    orders,
    sales,
    allCommission,
    affCommission,
    aov: orders > 0 ? sales / orders : null,
    weightedCommissionRate,
    effectiveCommissionRate: sales > 0 ? affCommission / sales * 100 : null,
    categories: categoryRows,
    aovBands: bandRows,
    markets: [...markets.values()].sort((left, right) => right.sales - left.sales)
  };
}

export function publisherTierOptions(
  rows: readonly (PublisherPortfolioRow | PublisherMerchantLike)[],
  selectedTier = ""
): readonly string[] {
  const values = new Set(rows.map((row) => {
    const merchant = "merchant" in row ? row.merchant : row;
    return text(merchant.tier, "Unknown");
  }));
  if (selectedTier && selectedTier !== "all") values.add(selectedTier);
  return [...values].sort((left, right) => {
    const leftIndex = TIER_ORDER.indexOf(left as (typeof TIER_ORDER)[number]);
    const rightIndex = TIER_ORDER.indexOf(right as (typeof TIER_ORDER)[number]);
    return (leftIndex < 0 ? TIER_ORDER.length : leftIndex) - (rightIndex < 0 ? TIER_ORDER.length : rightIndex) || left.localeCompare(right);
  });
}

export function publisherOverviewRows(
  publishers: readonly PublisherRecord[],
  overviewType: PublisherOverviewType,
  activeMetric: PublisherMetricKey
): readonly PublisherOverviewRow[] {
  const totals = new Map<string, {
    publishers: Set<string>;
    clicks: number;
    dpv: number;
    atc: number;
    orders: number;
    sales: number;
    allCommission: number;
  }>();
  publishers.forEach((publisher) => {
    const keys = overviewType === "network"
      ? (publisher.networks.length ? publisher.networks : ["Unknown"])
      : Object.keys(publisher.markets);
    keys.forEach((key) => {
      const value = totals.get(key) || { publishers: new Set<string>(), clicks: 0, dpv: 0, atc: 0, orders: 0, sales: 0, allCommission: 0 };
      const metric = overviewType === "network" ? publisher.total : publisher.markets[key];
      if (!metric) return;
      value.publishers.add(publisher.userId);
      value.clicks += metric.clicks;
      value.dpv += metric.dpv;
      value.atc += metric.atc;
      value.orders += metric.orders;
      value.sales += metric.sales;
      value.allCommission += metric.allCommission;
      totals.set(key, value);
    });
  });
  return [...totals.entries()].map(([key, value]) => ({
    key,
    clicks: value.clicks,
    dpv: value.dpv,
    atc: value.atc,
    publisherCount: value.publishers.size,
    orders: value.orders,
    sales: value.sales,
    allCommission: value.allCommission,
    value: value[activeMetric]
  })).sort((left, right) => {
    if (overviewType === "market") {
      const leftIndex = MARKET_ORDER.indexOf(left.key as (typeof MARKET_ORDER)[number]);
      const rightIndex = MARKET_ORDER.indexOf(right.key as (typeof MARKET_ORDER)[number]);
      if (leftIndex >= 0 || rightIndex >= 0) return (leftIndex < 0 ? MARKET_ORDER.length : leftIndex) - (rightIndex < 0 ? MARKET_ORDER.length : rightIndex);
    }
    return right.value - left.value;
  });
}

export function publisherTableRows(
  publishers: readonly PublisherRecord[],
  market: string,
  totals: PublisherAggregate,
  sort: PublisherSort
): readonly PublisherTableRow[] {
  const rows: PublisherTableRow[] = publishers.map((publisher, index) => {
    const metric = (market && market !== "all" ? publisher.markets[market] : publisher.total) || emptyMetric();
    return {
      rank: index + 1,
      userId: publisher.userId,
      userName: publisher.userName,
      adminName: publisher.adminName || "Unknown",
      clicks: metric.clicks,
      conversionRate: publisherMetricConversionRate(metric),
      dpv: metric.dpv,
      atc: metric.atc,
      orders: metric.orders,
      sales: metric.sales,
      allCommission: metric.allCommission,
      affCommission: metric.affCommission,
      grossProfit: metric.allCommission - metric.affCommission
    };
  });
  if (!sort.key) return rows;
  const sortKey: Exclude<PublisherTableSortKey, ""> = sort.key;
  const sorted = [...rows].sort((left, right) => {
    const leftValue = left[sortKey];
    const rightValue = right[sortKey];
    if (typeof leftValue === "number" && typeof rightValue === "number") {
      return (leftValue - rightValue) * (sort.direction === "desc" ? -1 : 1);
    }
    return String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: "base" }) * (sort.direction === "desc" ? -1 : 1);
  });
  return sorted.map((row, index) => ({ ...row, rank: index + 1 }));
}

export function paginate<T>(rows: readonly T[], page: number, pageSize: number): Pagination<T> {
  const safePageSize = Math.max(1, Math.floor(pageSize) || 1);
  const totalPages = Math.max(1, Math.ceil(rows.length / safePageSize));
  const currentPage = Math.min(totalPages, Math.max(1, Math.floor(page) || 1));
  const startIndex = (currentPage - 1) * safePageSize;
  const endIndex = Math.min(rows.length, startIndex + safePageSize);
  return {
    page: currentPage,
    pageSize: safePageSize,
    totalPages,
    totalRows: rows.length,
    startIndex,
    endIndex,
    rows: rows.slice(startIndex, endIndex)
  };
}

function addDaysUtc(date: Date, days: number): string {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function publisherQuickDateRange(
  range: "lastMonth" | "past30" | "past3m" | "past6m",
  today = new Date()
): { startDate: string; endDate: string } {
  const endDate = addDaysUtc(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())), 0);
  if (range === "lastMonth") {
    const monthStart = new Date(Date.UTC(today.getFullYear(), today.getMonth() - 1, 1));
    const monthEnd = new Date(Date.UTC(today.getFullYear(), today.getMonth(), 0));
    return { startDate: monthStart.toISOString().slice(0, 10), endDate: monthEnd.toISOString().slice(0, 10) };
  }
  const days = range === "past30" ? 30 : range === "past3m" ? 90 : 180;
  return { startDate: addDaysUtc(new Date(`${endDate}T00:00:00Z`), -days), endDate };
}

export function applyDateFilter(data: PublishersPayload, startDate: string, endDate: string): PublishersPayload {
  if (!startDate && !endDate) return data;
  const sums = new Map<string, PublisherMetric>();
  Object.entries(data.dailyRows).forEach(([day, rows]) => {
    if (startDate && day < startDate) return;
    if (endDate && day > endDate) return;
    rows.forEach((row) => {
      const key = `${row.userId}|${row.market}`;
      const current = sums.get(key) || emptyMetric();
      sums.set(key, {
        ...current,
        clicks: current.clicks + numberValue(row, ["clicks"]),
        dpv: current.dpv + numberValue(row, ["dpv"]),
        atc: current.atc + numberValue(row, ["atc"]),
        orders: current.orders + numberValue(row, ["orders"]),
        sales: current.sales + numberValue(row, ["sales"]),
        allCommission: current.allCommission + numberValue(row, ["allCommission", "all_commission"]),
        affCommission: current.affCommission + numberValue(row, ["affCommission", "aff_commission"])
      });
    });
  });
  const publishers = data.publishers.map((publisher) => {
    const markets: Record<string, PublisherMetric> = {};
    let total = emptyMetric();
    [...sums.entries()].forEach(([key, metric]) => {
      if (!key.startsWith(`${publisher.userId}|`)) return;
      const market = key.slice(`${publisher.userId}|`.length);
      markets[market] = metric;
      total = {
        ...total,
        clicks: total.clicks + metric.clicks,
        dpv: total.dpv + metric.dpv,
        atc: total.atc + metric.atc,
        orders: total.orders + metric.orders,
        sales: total.sales + metric.sales,
        allCommission: total.allCommission + metric.allCommission,
        affCommission: total.affCommission + metric.affCommission
      };
    });
    return { ...publisher, markets, total: normalizeMetric(total) };
  }).filter((publisher) => publisher.total.clicks > 0 || publisher.total.dpv > 0 || publisher.total.atc > 0 || publisher.total.orders > 0 || publisher.total.sales > 0);
  const activeMarkets = new Set(publishers.flatMap((publisher) => Object.keys(publisher.markets)));
  return {
    ...data,
    publishers,
    markets: data.markets.filter((market) => activeMarkets.has(market)),
    dailyRows: {}
  };
}
