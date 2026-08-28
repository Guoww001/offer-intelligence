import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import PublishersPage from "./PublishersPage.vue";
import type { PublisherExportPayload } from "./publisherModel";

const metric = (sales: number) => ({ clicks: 10, dpv: 5, atc: 1, orders: 2, sales, allCommission: sales * 0.1 });
const data = {
  generatedAt: "2026-08-28T00:00:00Z",
  publishers: [
    { userId: 1, userName: "Media One", adminName: "Dora Long", networks: ["Levanta"], linkTypes: { storefront: metric(100) }, merchantIds: [101], markets: { "amazon.com": metric(100) }, total: metric(100) },
    { userId: 2, userName: "Media Two", adminName: "Alex Chen", networks: ["Wayward"], linkTypes: { storefront: metric(80) }, merchantIds: [102], markets: { "amazon.com": metric(80) }, total: metric(80) }
  ],
  summary: {},
  markets: ["amazon.com"],
  networks: ["Levanta", "Wayward"],
  linkTypes: ["storefront"],
  merchantNameMap: { "101": "Alpha", "102": "Beta" },
  dailyRows: {}
};

describe("PublishersPage", () => {
  it("keeps the legacy page hierarchy and six KPI cards", async () => {
    const wrapper = mount(PublishersPage, {
      props: { language: "zh", loadData: async () => data, autoLoad: false }
    });
    await wrapper.vm.load();

    expect(wrapper.find(".publishers-page").exists()).toBe(true);
    expect(wrapper.find(".publishers-filters").exists()).toBe(true);
    expect(wrapper.findAll(".publishers-kpi-row .metric")).toHaveLength(6);
    expect(wrapper.find(".publisher-affinity-panel").exists()).toBe(true);
    expect(wrapper.find(".publishers-market-summary").exists()).toBe(true);
    expect(wrapper.find(".publishers-chart-panel").exists()).toBe(true);
    expect(wrapper.find(".publishers-table-panel").exists()).toBe(true);
    expect(wrapper.findAll(".publishers-table tbody tr")).toHaveLength(3);
  });

  it("filters by manager, opens a publisher profile, and loads its portfolio", async () => {
    const portfolioCalls: string[] = [];
    const wrapper = mount(PublishersPage, {
      props: {
        language: "zh",
        loadData: async () => data,
        loadPortfolio: async (userId) => {
          portfolioCalls.push(userId);
          return {
            merchants: [{ merchantId: 101, merchantName: "Alpha", category: "Beauty", network: "Levanta", tier: "Tier 1", markets: { "amazon.com": metric(100) }, total: metric(100) }]
          };
        }
      }
    });
    await flushPromises();

    await wrapper.get('input[aria-label="经理名称"]').setValue("Dora");
    expect(wrapper.findAll(".publisher-selector-option")).toHaveLength(1);
    await wrapper.find(".publisher-selector-option").trigger("click");
    await flushPromises();

    expect(portfolioCalls).toEqual(["1"]);
    expect(wrapper.find(".publisher-affinity-content").exists()).toBe(true);
    expect(wrapper.text()).toContain("Alpha");
    expect(wrapper.find(".publishers-market-summary").classes()).toContain("hidden");
    expect(wrapper.findAll(".publishers-kpi-row .metric-value").map((node) => node.text())).toEqual([
      "10", "5", "1", "2", "$100", "$10"
    ]);
  });

  it("emits filtered publisher rows for export and toggles language copy", async () => {
    const exports: PublisherExportPayload[] = [];
    const wrapper = mount(PublishersPage, {
      props: { language: "en", loadData: async () => data, autoLoad: false, download: (payload) => exports.push(payload) }
    });
    await wrapper.vm.load();
    await wrapper.get('button[aria-label="Export current publisher results"]').trigger("click");
    expect(exports[0]?.rows).toHaveLength(2);
    expect(wrapper.get("h2").text()).toBe("Publisher Affinity");
  });

  it("exposes loading and error states without losing the page shell", async () => {
    const wrapper = mount(PublishersPage, {
      props: { language: "zh", loadData: async () => { throw new Error("503"); } }
    });
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.find(".publishers-page").exists()).toBe(true);
  });
});
