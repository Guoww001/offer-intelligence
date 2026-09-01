import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import GoogleAdsPage from "./GoogleAdsPage.vue";

const payload = {
  ok: true,
  publisher: { userId: 19, userName: "asdf260821" },
  googleAds: {
    customerId: "1234567890",
    descriptiveName: "YeahPromos Ads",
    currencyCode: "USD",
    timeZone: "Europe/Paris",
    apiVersion: "v20"
  },
  sources: {
    googleAds: "GoogleAdsService.SearchStream",
    backendOrders: "cnpscy_amazon_order",
    joinGrain: "merchant + date",
    joinRule: "merchant + date",
    attributionCaveat: "Merchant-level comparison only"
  },
  summary: {
    impressions: 100,
    googleClicks: 10,
    spend: 12,
    nativeConversions: 1,
    backendClicks: 8,
    orders: 2,
    revenue: 40,
    affCommission: 4,
    campaignCount: 1,
    backendMerchantCount: 1,
    matchedSpend: 12,
    matchCoverageBySpend: 1,
    merchantLevelRoas: 3.33
  },
  daily: [{ date: "2026-08-01", spend: 12, revenue: 40, orders: 2 }],
  merchants: [{
    merchantId: 101,
    merchantName: "Ulike",
    matchMethod: "merchant_name",
    campaignCount: 1,
    campaigns: [{ campaignName: "Ulike brand" }],
    spend: 12,
    googleClicks: 10,
    backendClicks: 8,
    orders: 2,
    revenue: 40,
    merchantRoas: 3.33,
    costPerOrder: 6
  }],
  unmatchedCampaigns: []
};

describe("GoogleAdsPage", () => {
  it("renders the legacy workbench structure with API data and chart", async () => {
    const wrapper = mount(GoogleAdsPage, {
      props: {
        language: "en",
        today: () => new Date("2026-08-31T12:00:00"),
        loadData: async () => payload
      }
    });

    await flushPromises();

    expect(wrapper.find('.oi-modern-page[data-page="google-ads"]').exists()).toBe(true);
    expect(wrapper.find(".google-ads-controls").exists()).toBe(true);
    expect(wrapper.findAll(".google-ads-kpi")).toHaveLength(6);
    expect(wrapper.find(".google-ads-chart-svg").exists()).toBe(true);
    expect(wrapper.findAll(".google-ads-table tbody tr")).toHaveLength(1);
    expect(wrapper.text()).toContain("YeahPromos Ads");
    expect(wrapper.text()).toContain("Ulike");
  });

  it("supports quick ranges, explicit dates and refresh without losing the data contract", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const wrapper = mount(GoogleAdsPage, {
      props: {
        language: "zh",
        loadData: async (request) => {
          requests.push(request);
          return payload;
        }
      }
    });

    await flushPromises();
    await wrapper.get('button[data-google-ads-range="30"]').trigger("click");
    await flushPromises();
    await wrapper.get('input[aria-label="Google Ads workbench start date"]').setValue("2026-08-01");
    await wrapper.get('input[aria-label="Google Ads workbench start date"]').trigger("change");
    await flushPromises();
    await wrapper.get(".google-ads-refresh").trigger("click");
    await flushPromises();

    expect(requests.length).toBe(4);
    expect(requests.at(-1)?.forceRefresh).toBe(true);
    expect(wrapper.text()).toContain("Google 广告工作台");
  });
});
