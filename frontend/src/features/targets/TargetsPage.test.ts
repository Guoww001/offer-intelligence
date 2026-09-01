import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import TargetsPage from "./TargetsPage.vue";

const report = {
  sheets: [
    {
      name: "Tier 1",
      rows: [
        { "Merchant ID": "101", "Merchant Name": "Alpha", Clicks: "100", "Order count": "10", Revenue: "1,000", Payout: "100" },
        { "Merchant ID": "102", "Merchant Name": "Beta", Clicks: "50", "Order count": "5", Revenue: "500", Payout: "50" }
      ]
    },
    {
      name: "Tier 2",
      rows: [{ "Merchant ID": "201", "Merchant Name": "Gamma", Clicks: "200", "Order count": "20", Revenue: "2,000", Payout: "250" }]
    }
  ]
};

describe("TargetsPage", () => {
  it("loads database status and tier summary when autoLoad is omitted", async () => {
    const statusMonths: string[] = [];
    const tierSummaryMonths: string[] = [];
    const wrapper = mount(TargetsPage, {
      props: {
        language: "en",
        reportData: report,
        today: () => new Date("2026-07-15T12:00:00"),
        loadStatus: async ({ monthKey }) => {
          statusMonths.push(monthKey);
          return {
            ok: true,
            recentMonths: {
              aggregateOrders: [{ month: monthKey, activeBrands: 1239, orders: 32360, revenue: 4697257.9789 }],
              amazonClicks: [{ month: monthKey, clicks: 708552 }]
            }
          };
        },
        loadTierSummary: async ({ monthKey }) => {
          tierSummaryMonths.push(monthKey);
          return {
            ok: true,
            month: monthKey,
            tiers: [{ tier: "Tier 1", brandCount: 2, clicks: 150, orders: 15, revenue: 1500 }],
            total: { brandCount: 2, clicks: 150, orders: 15, revenue: 1500 }
          };
        }
      }
    });

    await flushPromises();

    expect(statusMonths).toEqual(["2026-07"]);
    expect(tierSummaryMonths).toEqual(["2026-07"]);
    expect(wrapper.find(".target-source-status").text()).toContain("Production database");
    expect(wrapper.findAll(".target-kpi-card strong").map((node) => node.text())).toEqual([
      "$4.7M", "32.4K", "708.6K", "4.57%", "1.2K"
    ]);
  });

  it("renders the target report cards and the legacy visual hierarchy", () => {
    const wrapper = mount(TargetsPage, {
      props: {
        language: "en",
        reportData: report,
        autoLoad: false,
        today: () => new Date("2026-07-15T12:00:00")
      }
    });

    expect(wrapper.find('[data-page="sheets"]').exists()).toBe(true);
    expect(wrapper.findAll(".target-kpi-card")).toHaveLength(5);
    expect(wrapper.find(".target-trend-card").exists()).toBe(true);
    expect(wrapper.find(".target-matrix-table").exists()).toBe(true);
    expect(wrapper.findAll(".target-matrix-table tbody tr")).toHaveLength(3);
    expect(wrapper.text()).toContain("$3.5K");
  });

  it("switches trend metrics and edits a target without leaving the page", async () => {
    const wrapper = mount(TargetsPage, {
      props: {
        language: "en",
        reportData: report,
        autoLoad: false,
        today: () => new Date("2026-07-15T12:00:00")
      }
    });

    await wrapper.get('[data-target-metric="orders"]').trigger("click");
    expect(wrapper.get('[data-target-metric="orders"]').attributes("aria-pressed")).toBe("true");
    await wrapper.get(".target-set-button").trigger("click");
    const input = wrapper.get(".target-edit-form input[name='target']");
    await input.setValue("700K");
    await wrapper.get(".target-edit-form").trigger("submit");
    expect(wrapper.text()).toContain("700K");
  });

  it("renders the controlled empty state when there is no report data", () => {
    const wrapper = mount(TargetsPage, {
      props: {
        language: "zh",
        reportData: { sheets: [] },
        autoLoad: false,
        today: () => new Date("2026-07-15T12:00:00")
      }
    });

    expect(wrapper.find(".target-empty-state").exists()).toBe(true);
    expect(wrapper.text()).toContain("目标数据");
  });

  it("exports the current filtered target rows with the legacy field order", async () => {
    const downloads: unknown[] = [];
    const wrapper = mount(TargetsPage, {
      props: {
        language: "en",
        reportData: report,
        autoLoad: false,
        today: () => new Date("2026-07-15T12:00:00"),
        download: (payload) => downloads.push(payload)
      }
    });

    await wrapper.get('[data-target-action="download"]').trigger("click");
    expect(downloads).toHaveLength(1);
    const payload = downloads[0] as { rows: Array<Record<string, unknown>>; scope: string };
    expect(payload.scope).toBe("July 2026");
    expect(Object.keys(payload.rows[0] || {})).toEqual([
      "Month", "Tier", "Brand Count", "Total Clicks", "Order Count", "Revenue",
      "Avg Conversion", "New Tier Entries", "Tier Exits", "Target"
    ]);
  });
  it("exposes stable hooks for the filter and trend interactions", () => {
    const wrapper = mount(TargetsPage, {
      props: {
        language: "en",
        reportData: report,
        autoLoad: false,
        today: () => new Date("2026-07-15T12:00:00")
      }
    });

    expect(wrapper.get('[data-target-action="month"]').element.tagName).toBe("SELECT");
    expect(wrapper.get('[data-target-action="compare-month"]').element.tagName).toBe("SELECT");
    expect(wrapper.get('[data-target-action="tier"]').element.tagName).toBe("SELECT");
    expect(wrapper.find('[data-target-trend-view="month"]').exists()).toBe(true);
    expect(wrapper.find('[data-target-action="edit-target"]').exists()).toBe(true);
  });

});
