import { toFiniteNumber, toNullableNumber } from "../../shared/format/number";

export interface GoogleAdsDateRange {
  readonly startDate: string;
  readonly endDate: string;
  readonly dayCount: number;
}

export interface GoogleAdsPublisher {
  readonly userId: string;
  readonly userName: string;
  readonly adminName: string;
}

export interface GoogleAdsAccount {
  readonly customerId: string;
  readonly descriptiveName: string;
  readonly currencyCode: string;
  readonly timeZone: string;
  readonly testAccount: boolean;
  readonly apiVersion: string;
}

export interface GoogleAdsSources {
  readonly googleAds: string;
  readonly backendOrders: string;
  readonly joinGrain: string;
  readonly joinRule: string;
  readonly attributionCaveat: string;
}

export interface GoogleAdsMetrics {
  readonly impressions: number;
  readonly googleClicks: number;
  readonly spend: number;
  readonly nativeConversions: number;
  readonly nativeConversionValue: number;
  readonly backendClicks: number;
  readonly detailPageViews: number;
  readonly addToCarts: number;
  readonly orders: number;
  readonly revenue: number;
  readonly allCommission: number;
  readonly affCommission: number;
  readonly merchantRoas: number | null;
  readonly costPerOrder: number | null;
  readonly googleCtr: number | null;
  readonly campaignCount: number;
  readonly matchedCampaignCount: number;
  readonly unmatchedCampaignCount: number;
}

export interface GoogleAdsSummary extends GoogleAdsMetrics {
  readonly backendMerchantCount: number;
  readonly matchedMerchantCount: number;
  readonly matchedSpend: number;
  readonly unmatchedSpend: number;
  readonly matchedRevenue: number;
  readonly matchCoverageBySpend: number | null;
  readonly merchantLevelRoas: number | null;
}

export interface GoogleAdsDailyRow extends GoogleAdsMetrics {
  readonly date: string;
  readonly matchedSpend: number;
  readonly unmatchedSpend: number;
  readonly matchedRevenue: number;
  readonly matchedOrders: number;
}

export type GoogleAdsMatchKind = "merchantName" | "asin" | "manualAlias" | "unmatched";

export interface GoogleAdsCampaign extends GoogleAdsMetrics {
  readonly campaignId: string;
  readonly campaignName: string;
  readonly status: string;
  readonly channelType: string;
  readonly merchantId: string;
  readonly merchantName: string;
  readonly matchMethod: string;
  readonly matchConfidence: string;
}

export interface GoogleAdsMerchant extends GoogleAdsMetrics {
  readonly merchantId: string;
  readonly merchantName: string;
  readonly matchMethod: string;
  readonly matchConfidence: string;
  readonly campaigns: readonly GoogleAdsCampaign[];
}

export interface GoogleAdsPayload {
  readonly ok: boolean;
  readonly generatedAt: string;
  readonly dateRange: GoogleAdsDateRange;
  readonly publisher: GoogleAdsPublisher;
  readonly googleAds: GoogleAdsAccount;
  readonly sources: GoogleAdsSources;
  readonly summary: GoogleAdsSummary;
  readonly daily: readonly GoogleAdsDailyRow[];
  readonly merchants: readonly GoogleAdsMerchant[];
  readonly campaigns: readonly GoogleAdsCampaign[];
  readonly unmatchedCampaigns: readonly GoogleAdsCampaign[];
}

export interface GoogleAdsChartBar {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly value: number;
  readonly row: GoogleAdsDailyRow;
}

export interface GoogleAdsChartPoint {
  readonly x: number;
  readonly y: number;
  readonly row: GoogleAdsDailyRow;
}

export interface GoogleAdsChartGridLine {
  readonly y: number;
  readonly revenueLabel: string;
  readonly spendLabel: string;
}

export interface GoogleAdsChartLabel {
  readonly x: number;
  readonly value: string;
  readonly row: GoogleAdsDailyRow;
}

export interface GoogleAdsChartModel {
  readonly hasData: boolean;
  readonly rows: readonly GoogleAdsDailyRow[];
  readonly width: number;
  readonly height: number;
  readonly bars: readonly GoogleAdsChartBar[];
  readonly points: readonly GoogleAdsChartPoint[];
  readonly grid: readonly GoogleAdsChartGridLine[];
  readonly xLabels: readonly GoogleAdsChartLabel[];
  readonly linePath: string;
}

type RawRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function rawArray(value: unknown): readonly RawRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is RawRecord => isRecord(item))
    : [];
}

function numberValue(value: unknown, fallback = 0): number {
  return Math.max(0, toFiniteNumber(value, fallback));
}

function nullableNumber(value: unknown): number | null {
  const parsed = toNullableNumber(value);
  return parsed === null ? null : Math.max(0, parsed);
}

function metricSource(value: RawRecord | undefined): RawRecord {
  if (!value) return {};
  return isRecord(value.metrics) ? value.metrics : value;
}

function metricsFrom(value: RawRecord | undefined): GoogleAdsMetrics {
  const source = metricSource(value);
  const googleClicks = numberValue(source.googleClicks ?? source.clicks);
  const orders = numberValue(source.orders ?? source.backendOrders);
  const spend = numberValue(source.spend ?? source.cost);
  const revenue = numberValue(source.revenue ?? source.backendRevenue);
  const campaignCount = numberValue(source.campaignCount);
  return {
    impressions: numberValue(source.impressions),
    googleClicks,
    spend,
    nativeConversions: numberValue(source.nativeConversions ?? source.conversions),
    nativeConversionValue: numberValue(source.nativeConversionValue ?? source.conversionValue),
    backendClicks: numberValue(source.backendClicks),
    detailPageViews: numberValue(source.detailPageViews),
    addToCarts: numberValue(source.addToCarts),
    orders,
    revenue,
    allCommission: numberValue(source.allCommission),
    affCommission: numberValue(source.affCommission),
    merchantRoas: nullableNumber(source.merchantRoas),
    costPerOrder: nullableNumber(source.costPerOrder ?? (orders > 0 ? spend / orders : null)),
    googleCtr: nullableNumber(source.googleCtr ?? (numberValue(source.impressions) > 0
      ? googleClicks / numberValue(source.impressions)
      : null)),
    campaignCount,
    matchedCampaignCount: numberValue(source.matchedCampaignCount),
    unmatchedCampaignCount: numberValue(source.unmatchedCampaignCount)
  };
}

function withDerivedMetrics(metrics: GoogleAdsMetrics, campaignCount: number): GoogleAdsMetrics {
  return {
    ...metrics,
    campaignCount: metrics.campaignCount || campaignCount
  };
}

function normalizeCampaign(value: unknown): GoogleAdsCampaign | null {
  if (!isRecord(value)) return null;
  const campaigns = rawArray(value.campaigns);
  const metrics = withDerivedMetrics(metricsFrom(value), campaigns.length);
  const campaignId = text(value.campaignId ?? value.id);
  const campaignName = text(value.campaignName ?? value.name, campaignId || "Unnamed campaign");
  return {
    ...metrics,
    campaignId,
    campaignName,
    status: text(value.status),
    channelType: text(value.channelType),
    merchantId: text(value.merchantId ?? value.merchant_id),
    merchantName: text(value.merchantName ?? value.merchant),
    matchMethod: text(value.matchMethod),
    matchConfidence: text(value.matchConfidence)
  };
}

function normalizeMerchant(value: unknown): GoogleAdsMerchant | null {
  if (!isRecord(value)) return null;
  const campaigns = rawArray(value.campaigns)
    .map(normalizeCampaign)
    .filter((campaign): campaign is GoogleAdsCampaign => campaign !== null);
  const metrics = withDerivedMetrics(metricsFrom(value), campaigns.length);
  const merchantId = text(value.merchantId ?? value.merchant_id ?? value.id);
  const merchantName = text(value.merchantName ?? value.name, merchantId || "Unnamed merchant");
  return {
    ...metrics,
    merchantId,
    merchantName,
    matchMethod: text(value.matchMethod),
    matchConfidence: text(value.matchConfidence),
    campaigns
  };
}

function normalizeDaily(value: unknown): GoogleAdsDailyRow | null {
  if (!isRecord(value)) return null;
  const metrics = metricsFrom(value);
  return {
    ...metrics,
    date: text(value.date ?? value.day),
    matchedSpend: numberValue(value.matchedSpend),
    unmatchedSpend: numberValue(value.unmatchedSpend),
    matchedRevenue: numberValue(value.matchedRevenue),
    matchedOrders: numberValue(value.matchedOrders)
  };
}

function normalizeAccount(value: unknown): GoogleAdsAccount {
  const source = isRecord(value) ? value : {};
  return {
    customerId: text(source.customerId),
    descriptiveName: text(source.descriptiveName),
    currencyCode: text(source.currencyCode, "USD"),
    timeZone: text(source.timeZone),
    testAccount: Boolean(source.testAccount),
    apiVersion: text(source.apiVersion)
  };
}

function normalizeSources(value: unknown): GoogleAdsSources {
  const source = isRecord(value) ? value : {};
  return {
    googleAds: text(source.googleAds, "GoogleAdsService.SearchStream campaign metrics"),
    backendOrders: text(source.backendOrders, "cnpscy_amazon_order"),
    joinGrain: text(source.joinGrain, "merchant + date"),
    joinRule: text(source.joinRule, "Manual alias, ASIN, then normalized merchant name"),
    attributionCaveat: text(source.attributionCaveat, "Merchant-level comparison only")
  };
}

export function googleAdsMatchKind(method: unknown): GoogleAdsMatchKind {
  const value = text(method).toLowerCase().replace(/[\s-]+/g, "_");
  if (value.includes("manual_alias") || value === "alias" || value === "manual") return "manualAlias";
  if (value.includes("asin")) return "asin";
  if (value.includes("merchant_name") || value === "merchant" || value === "name") return "merchantName";
  return "unmatched";
}

export function normalizeGoogleAdsPayload(value: unknown): GoogleAdsPayload | null {
  if (!isRecord(value)) return null;
  const daily = rawArray(value.daily)
    .map(normalizeDaily)
    .filter((row): row is GoogleAdsDailyRow => row !== null);
  const merchants = rawArray(value.merchants)
    .map(normalizeMerchant)
    .filter((row): row is GoogleAdsMerchant => row !== null);
  const campaigns = rawArray(value.campaigns)
    .map(normalizeCampaign)
    .filter((row): row is GoogleAdsCampaign => row !== null);
  const unmatchedCampaigns = rawArray(value.unmatchedCampaigns)
    .map(normalizeCampaign)
    .filter((row): row is GoogleAdsCampaign => row !== null);
  const rawSummary = isRecord(value.summary) ? value.summary : {};
  const baseSummary = metricsFrom(rawSummary);
  const spend = baseSummary.spend;
  const matchedSpend = numberValue(rawSummary.matchedSpend);
  const matchedRevenue = numberValue(rawSummary.matchedRevenue);
  const summary: GoogleAdsSummary = {
    ...baseSummary,
    campaignCount: baseSummary.campaignCount || campaigns.length + unmatchedCampaigns.length,
    matchedCampaignCount: baseSummary.matchedCampaignCount || campaigns.length,
    unmatchedCampaignCount: baseSummary.unmatchedCampaignCount || unmatchedCampaigns.length,
    backendMerchantCount: numberValue(rawSummary.backendMerchantCount, merchants.length),
    matchedMerchantCount: numberValue(rawSummary.matchedMerchantCount, merchants.length),
    matchedSpend,
    unmatchedSpend: numberValue(rawSummary.unmatchedSpend),
    matchedRevenue,
    matchCoverageBySpend: nullableNumber(rawSummary.matchCoverageBySpend)
      ?? (spend > 0 ? matchedSpend / spend : null),
    merchantLevelRoas: nullableNumber(rawSummary.merchantLevelRoas)
      ?? (matchedSpend > 0 ? matchedRevenue / matchedSpend : null)
  };
  const rawDateRange = isRecord(value.dateRange) ? value.dateRange : {};
  const startDate = text(rawDateRange.startDate, daily[0]?.date || "");
  const endDate = text(rawDateRange.endDate, daily.at(-1)?.date || startDate);
  return {
    ok: value.ok !== false,
    generatedAt: text(value.generatedAt),
    dateRange: {
      startDate,
      endDate,
      dayCount: numberValue(rawDateRange.dayCount, daily.length)
    },
    publisher: (() => {
      const source = isRecord(value.publisher) ? value.publisher : {};
      return {
        userId: text(source.userId, "19"),
        userName: text(source.userName, "asdf260821"),
        adminName: text(source.adminName)
      };
    })(),
    googleAds: normalizeAccount(value.googleAds),
    sources: normalizeSources(value.sources),
    summary,
    daily,
    merchants,
    campaigns,
    unmatchedCampaigns
  };
}

function compactMoney(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}m`;
  if (absolute >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

export function buildGoogleAdsChartModel(payload: GoogleAdsPayload | null): GoogleAdsChartModel {
  const rows = payload?.daily || [];
  const width = Math.max(760, rows.length * 16 + 94);
  const height = 292;
  const margin = { top: 20, right: 44, bottom: 35, left: 50 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const step = rows.length ? innerWidth / rows.length : innerWidth;
  const barWidth = Math.max(3, Math.min(10, step * 0.58));
  const maxSpend = Math.max(1, ...rows.map((row) => row.spend));
  const maxRevenue = Math.max(1, ...rows.map((row) => row.revenue));
  const hasData = rows.some((row) => row.spend > 0 || row.revenue > 0);
  const bars = rows.map((row, index) => {
    const heightValue = Math.max(0, row.spend / maxSpend * innerHeight);
    return {
      x: margin.left + index * step + (step - barWidth) / 2,
      y: margin.top + innerHeight - heightValue,
      width: barWidth,
      height: heightValue,
      value: row.spend,
      row
    };
  });
  const points = rows.map((row, index) => ({
    x: margin.left + index * step + step / 2,
    y: margin.top + innerHeight - row.revenue / maxRevenue * innerHeight,
    row
  }));
  const grid = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    y: margin.top + innerHeight * (1 - ratio),
    revenueLabel: compactMoney(maxRevenue * ratio),
    spendLabel: compactMoney(maxSpend * ratio)
  }));
  const labelEvery = Math.max(1, Math.ceil(rows.length / 8));
  const xLabels = rows.flatMap((row, index) => (
    index % labelEvery === 0 || index === rows.length - 1
      ? [{ x: margin.left + index * step + step / 2, value: row.date.slice(5), row }]
      : []
  ));
  const linePath = points.map((point, index) => (
    `${index ? "L" : "M"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
  )).join(" ");
  return { hasData, rows, width, height, bars, points, grid, xLabels, linePath };
}
