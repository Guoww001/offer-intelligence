import { describe, expect, it } from "vitest";

import {
  buildGoogleAdsChartModel,
  googleAdsMatchKind,
  normalizeGoogleAdsPayload
} from "./googleAdsModel";

const rawPayload = {
  ok: true,
  dateRange: {
    startDate: "2026-08-01",
    endDate: "2026-08-03",
    dayCount: 3
  },
  publisher: { userId: 19, userName: "asdf260821", adminName: "Team" },
  googleAds: {
    customerId: "1234567890",
    descriptiveName: "YeahPromos Ads",
    currencyCode: "USD",
    timeZone: "Europe/Paris",
    testAccount: false,
    apiVersion: "v20"
  },
  sources: {
    googleAds: "GoogleAdsService.SearchStream campaign metrics",
    backendOrders: "cnpscy_amazon_order",
    joinGrain: "merchant + date",
    joinRule: "Manual alias, ASIN, then normalized merchant name",
    attributionCaveat: "Merchant-level comparison only"
  },
  summary: {
    impressions: 1000,
    googleClicks: 100,
    spend: 250,
    nativeConversions: 5,
    nativeConversionValue: 600,
    backendClicks: 80,
    orders: 20,
    revenue: 1000,
    affCommission: 120,
    campaignCount: 4,
    matchedCampaignCount: 3,
    unmatchedCampaignCount: 1,
    backendMerchantCount: 2,
    matchedMerchantCount: 2,
    matchedSpend: 220,
    unmatchedSpend: 30,
    matchedRevenue: 900,
    matchCoverageBySpend: 0.88,
    merchantLevelRoas: 4.09
  },
  daily: [
    { date: "2026-08-01", spend: 100, revenue: 300, orders: 5 },
    { date: "2026-08-02", spend: 0, revenue: 0, orders: 0 },
    { date: "2026-08-03", spend: 150, revenue: 700, orders: 15 }
  ],
  merchants: [{
    merchantId: 101,
    merchantName: "Ulike",
    matchMethod: "merchant_name",
    matchConfidence: "high",
    campaignCount: 2,
    campaigns: [{ campaignId: "1", campaignName: "Ulike brand", status: "ENABLED" }],
    spend: 220,
    googleClicks: 90,
    backendClicks: 80,
    orders: 20,
    revenue: 900,
    merchantRoas: 4.09,
    costPerOrder: 11
  }],
  campaigns: [{
    campaignId: "1",
    campaignName: "Ulike brand",
    status: "ENABLED",
    channelType: "SEARCH",
    merchantId: 101,
    merchantName: "Ulike",
    matchMethod: "merchant_name",
    spend: 220,
    googleClicks: 90,
    nativeConversions: 5
  }],
  unmatchedCampaigns: [{
    campaignId: "2",
    campaignName: "Unresolved campaign",
    spend: 30,
    googleClicks: 10
  }]
};

describe("googleAdsModel", () => {
  it("normalizes the workbench payload without changing merchant-level totals", () => {
    const payload = normalizeGoogleAdsPayload(rawPayload);

    expect(payload).not.toBeNull();
    expect(payload?.summary.spend).toBe(250);
    expect(payload?.summary.revenue).toBe(1000);
    expect(payload?.summary.matchCoverageBySpend).toBe(0.88);
    expect(payload?.merchants[0]?.merchantId).toBe("101");
    expect(payload?.merchants[0]?.campaignCount).toBe(2);
    expect(payload?.unmatchedCampaigns[0]?.campaignName).toBe("Unresolved campaign");
  });

  it("builds a zero-filled chart model with bars, revenue line points and labels", () => {
    const payload = normalizeGoogleAdsPayload(rawPayload);
    const chart = buildGoogleAdsChartModel(payload);

    expect(chart.hasData).toBe(true);
    expect(chart.rows).toHaveLength(3);
    expect(chart.bars).toHaveLength(3);
    expect(chart.points).toHaveLength(3);
    expect(chart.xLabels).toHaveLength(3);
    expect(chart.width).toBeGreaterThanOrEqual(760);
    expect(chart.bars[1]?.height).toBe(0);
    expect(chart.points[2]?.row.revenue).toBe(700);
  });

  it("keeps match labels explicit for name, ASIN, alias and unmatched rows", () => {
    expect(googleAdsMatchKind("merchant_name")).toBe("merchantName");
    expect(googleAdsMatchKind("asin")).toBe("asin");
    expect(googleAdsMatchKind("manual_alias")).toBe("manualAlias");
    expect(googleAdsMatchKind("unmatched")).toBe("unmatched");
  });
});
