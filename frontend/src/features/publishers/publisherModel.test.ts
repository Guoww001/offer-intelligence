import { describe, expect, it } from "vitest";

import {
  applyDateFilter,
  aggregatePublisherMetrics,
  filteredPublishers,
  normalizePublishersPayload,
  paginate,
  publisherAffinitySummary,
  publisherMerchantOptions,
  publisherMetricAffCommission,
  publisherMetricAffCommissionRate,
  publisherMetricAffEpc,
  publisherMetricAov,
  publisherMetricConversionRate,
  publisherOverviewRows,
  publisherTierOptions,
  portfolioRowsForState,
  type PublisherFilters
} from "./publisherModel";

const metric = (sales: number, clicks = 10) => ({
  clicks,
  dpv: 5,
  atc: 1,
  orders: 2,
  sales,
  allCommission: sales * 0.1,
  affCommission: sales * 0.075,
  aov: sales / 2
});

const payload = normalizePublishersPayload({
  generatedAt: "2026-08-28T00:00:00Z",
  publishers: [
    {
      userId: 1,
      userName: "Media One",
      adminName: "Dora Long",
      networks: ["Levanta"],
      linkTypes: { storefront: metric(100) },
      merchantIds: [101, 102],
      markets: { "amazon.com": metric(100) },
      total: metric(100)
    },
    {
      userId: 2,
      userName: "Media Two",
      adminName: "Alex Chen",
      networks: ["Wayward"],
      linkTypes: { storefront: metric(80) },
      merchantIds: [102],
      markets: { "amazon.com": metric(80), "amazon.co.uk": metric(20) },
      total: { ...metric(100), clicks: 20 }
    }
  ],
  summary: { totalPublishers: 2 },
  markets: ["amazon.com", "amazon.co.uk"],
  networks: ["Levanta", "Wayward"],
  linkTypes: ["storefront"],
  merchantNameMap: { "101": "Alpha", "102": "Beta" },
  dailyRows: {
    "2026-08-01": [{ userId: 1, market: "amazon.com", ...metric(40) }],
    "2026-08-02": [{ userId: 1, market: "amazon.com", ...metric(60) }]
  }
});

const baseFilters: PublisherFilters = {
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

describe("publisherModel", () => {
  it("keeps publisher filtering scoped to merchant associations and managers", () => {
    expect(publisherMerchantOptions(payload).find((item) => item.merchantId === "102")).toEqual({
      merchantId: "102",
      name: "Beta",
      count: 2
    });
    expect(filteredPublishers(payload, { ...baseFilters, managerSearch: "dora" }).map((row) => row.userId)).toEqual(["1"]);
    expect(filteredPublishers(payload, { ...baseFilters, merchantSearch: "beta" }).map((row) => row.userId)).toEqual(["1", "2"]);
    expect(filteredPublishers(payload, { ...baseFilters, merchantSelectedId: "101" }).map((row) => row.userId)).toEqual(["1"]);
  });

  it("uses the legacy 75% AFF share and ratio formulas", () => {
    const row = metric(100);
    expect(publisherMetricAffCommission(row)).toBe(7.5);
    expect(publisherMetricAffCommissionRate(row)).toBe(7.5);
    expect(publisherMetricAffEpc(row)).toBe(0.75);
    expect(publisherMetricConversionRate(row)).toBe(0.2);
    expect(publisherMetricAffCommissionRate({ sales: 0, allCommission: 10 })).toBeNull();
  });

  it("re-aggregates daily rows without changing publisher identity", () => {
    const ranged = applyDateFilter(payload, "2026-08-02", "2026-08-02");
    expect(ranged.publishers).toHaveLength(1);
    expect(ranged.publishers[0]?.userName).toBe("Media One");
    expect(ranged.publishers[0]?.total.sales).toBe(60);
    expect(ranged.publishers[0]?.markets["amazon.com"]?.orders).toBe(2);
  });

  it("builds affinity, overview, and tier summaries from normalized rows", () => {
    const merchants = [
      { merchantId: "101", merchantName: "Alpha", category: "Electronics", network: "Levanta", tier: "Tier 1", markets: { "amazon.com": metric(100) }, total: metric(100) },
      { merchantId: "102", merchantName: "Beta", category: "Home", network: "Wayward", tier: "Tier 3", markets: { "amazon.com": metric(80) }, total: metric(80) }
    ];
    const rows = portfolioRowsForState(merchants, { ...baseFilters, portfolioTier: "Tier 3" }, true);
    expect(rows.map((row) => row.merchant.merchantId)).toEqual(["102"]);
    expect(publisherTierOptions(rows)).toEqual(["Tier 3"]);
    expect(publisherAffinitySummary(rows).weightedCommissionRate).toBe(7.5);
    expect(publisherAffinitySummary(rows).effectiveCommissionRate).toBe(7.5);
    expect(aggregatePublisherMetrics(payload.publishers, "all").grossProfit).toBeCloseTo(5);
    expect(publisherOverviewRows(payload.publishers, "network", "sales").map((row) => row.key)).toEqual(["Levanta", "Wayward"]);
  });

  it("keeps zero-activity partnerships in the selected publisher portfolio", () => {
    const zeroMetric = { clicks: 0, dpv: 0, atc: 0, orders: 0, sales: 0, allCommission: 0 };
    const rows = portfolioRowsForState([
      { merchantId: "101", merchantName: "Active", category: "Home", network: "Levanta", tier: "Tier 1", markets: { "amazon.com": metric(100) }, total: metric(100) },
      { merchantId: "102", merchantName: "No activity", category: "Home", network: "Levanta", tier: "Tier 2", markets: { "amazon.com": zeroMetric }, total: zeroMetric }
    ], baseFilters, true);

    expect(rows.map((row) => row.merchant.merchantName)).toEqual(["Active", "No activity"]);
    expect(publisherAffinitySummary(rows).merchantCount).toBe(2);
    expect(publisherMetricAov(zeroMetric)).toBeNull();
  });

  it("paginates with a stable one-based page contract", () => {
    const result = paginate([1, 2, 3], 2, 2);
    expect(result).toMatchObject({ page: 2, totalPages: 2, startIndex: 2, endIndex: 3, rows: [3] });
  });
});
