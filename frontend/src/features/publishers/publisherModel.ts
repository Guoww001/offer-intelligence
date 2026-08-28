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
    merchantName: data.merchantNameMap[merchantId] || 