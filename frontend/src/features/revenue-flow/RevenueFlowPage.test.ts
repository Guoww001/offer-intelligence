import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import RevenueFlowPage from "./RevenueFlowPage.vue";

const catalog = {
  merchantNameMap: { "101": "Alpha", "202": "Beta" },
  publishers: [{ merchantIds: [101] }, { merchantIds: [202] }]
};

const trendPayload = {
  ok: true,
  merchants: [
    { merchantId: "101", merchantName: "Alpha" },
    { merchantId: "202", merchantName: "Beta" }
  ],
  dateRange: { startDate: "2026-08-01", endDate: "2026-08-27" },
  sankey: {
    available: true,
    nodes: [
      { id: "brand:101", type: "brand", label: "Alpha", merchantId: "101", value: 10 },
      { id: "product:101:A", type: "product", label: "Alpha A", productKey: "A", merchantId: "101", value: 10 },
      { id: "media:7", type: "media", label: "Media Seven", userId: "7", value: 10 }
    ],
    links: [
      { source: "brand:101", target: "product:101:A", value: 10 },
      { source: "product:101:A", target: "media:7", value: 10 }
    ],
    summary: { totalRevenue: 10 }
  }
};

describe("RevenueFlowPage", () => {
  it("渲染旧页面语义结构、五个 KPI 和 Canvas，并支持展开与卸载清理", async () => {
    const wrapper = mount(RevenueFlowPage, {
      props: {
        language: "zh",
        catalogData: catalog,
        today: () => new Date("2026-08-28T12:00:00"),
        loadTrend: async () => trendPayload
      }
    });

    expect(wrapper.find('[data-page="revenue-flow"]').exists()).toBe(true);
    expect(wrapper.find("h1").exists()).toBe(true);
    expect(wrapper.find('[role="combobox"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="revenue-flow-kpi"]')).toHaveLength(5);

    await wrapper.find('[role="combobox"]').trigger("click");
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true);
    await wrapper.find('[role="option"]').trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".revenue-flow-selected-brand")).toHaveLength(1);
    expect(wrapper.find("canvas").exists()).toBe(true);

    const expandButton = wrapper.find('[data-testid="revenue-flow-expand"]');
    await expandButton.trigger("click");
    expect(expandButton.attributes("aria-expanded")).toBe("true");
    expect(document.body.classList.contains("revenue-flow-chart-expanded")).toBe(true);

    wrapper.unmount();
    expect(document.body.classList.contains("revenue-flow-chart-expanded")).toBe(false);
  });

  it("保留品牌最多 12 个的选择边界", async () => {
    const merchants = Array.from({ length: 13 }, (_, index) => ({
      merchantId: String(index + 1),
      name: "Brand " + String(index + 1),
      count: 1
    }));
    const wrapper = mount(RevenueFlowPage, {
      props: {
        language: "en",
        catalogData: {
          merchants: merchants.map((merchant) => ({
            merchantId: merchant.merchantId,
            merchantName: merchant.name,
            count: merchant.count
          }))
        },
        loadTrend: async () => trendPayload
      }
    });

    await wrapper.find('[role="combobox"]').trigger("click");
    for (const option of wrapper.findAll('[role="option"]')) {
      await option.trigger("click");
    }
    expect(wrapper.findAll(".revenue-flow-selected-brand")).toHaveLength(12);
    expect(wrapper.text()).toContain("12");
    wrapper.unmount();
  });

  it("品牌搜索无匹配项时显示专用提示", async () => {
    const wrapper = mount(RevenueFlowPage, {
      props: {
        language: "en",
        catalogData: catalog,
        loadTrend: async () => trendPayload
      }
    });

    const input = wrapper.find('[role="combobox"]');
    await input.setValue("missing-brand");
    await input.trigger("focus");
    expect(wrapper.text()).toContain("No matching brand");
    wrapper.unmount();
  });
});
