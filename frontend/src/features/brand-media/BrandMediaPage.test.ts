import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import BrandMediaPage from "./BrandMediaPage.vue";

const catalog = {
  merchantNameMap: { "101": "Alpha" },
  publishers: [{ merchantIds: [101] }]
};

const trendPayload = {
  ok: true,
  merchant: { merchantId: 101, merchantName: "Alpha" },
  dateRange: { startDate: "2026-05-01", endDate: "2026-05-05" },
  summary: { activePublisherCount: 1, totalRevenue: 10, totalOrders: 2, observationCount: 1 },
  publishers: [{
    userId: 9,
    userName: "Media Nine",
    adminName: "timmy",
    totalRevenue: 10,
    totalOrders: 2,
    activeDays: 1,
    firstActiveDate: "2026-05-05",
    lastActiveDate: "2026-05-05",
    points: [{ date: "2026-05-05", revenue: 10, orders: 2, clicks: 0 }],
    clickPoints: [{ date: "2026-05-05", clicks: 40 }]
  }]
};

function mountBrandMedia(props: Record<string, unknown> = {}) {
  return mount(BrandMediaPage, {
    attachTo: document.body,
    props: {
      catalogData: catalog,
      language: "zh",
      today: () => new Date("2026-08-28T12:00:00"),
      loadTrend: async () => trendPayload,
      ...props
    }
  });
}

describe("BrandMediaPage", () => {
  it("保留旧页面的控件、KPI、趋势图、点击图和汇总表结构", async () => {
    const wrapper = mountBrandMedia();

    expect(wrapper.find('.oi-modern-page[data-page="brand-media"]').exists()).toBe(true);
    expect(wrapper.find(".brand-media-controls").exists()).toBe(true);
    expect(wrapper.find('input[role="combobox"]').exists()).toBe(true);
    expect(wrapper.findAll('button[data-brand-media-range]')).toHaveLength(4);
    expect(wrapper.find(".brand-media-kpis").exists()).toBe(true);
    expect(wrapper.findAll(".brand-media-kpi")).toHaveLength(0);
    expect(wrapper.find(".brand-media-chart-panel").exists()).toBe(true);
    expect(wrapper.find(".brand-media-table").exists()).toBe(true);

    await wrapper.get('input[role="combobox"]').trigger("focus");
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true);
  });

  it("选择品牌后加载趋势，Manager 筛选和图例锁定会更新当前视图", async () => {
    const wrapper = mountBrandMedia();
    await wrapper.get('input[role="combobox"]').trigger("focus");
    await wrapper.get('[role="option"][data-brand-media-merchant-id="101"]').trigger("click");

    expect(wrapper.text()).toContain("Media Nine");
    expect(wrapper.findAll(".brand-media-kpi")).toHaveLength(4);
    expect(wrapper.findAll(".brand-media-series")).toHaveLength(1);

    await wrapper.get('.brand-media-legend-item[data-brand-media-publisher-index="0"]').trigger("click");
    expect(wrapper.get(".brand-media-clicks-panel").classes()).not.toContain("hidden");
    expect(wrapper.find(".brand-media-click-svg").exists()).toBe(true);
  });

  it("展开图表后使用 Escape 恢复按钮焦点，并支持中英文文案", async () => {
    const wrapper = mountBrandMedia({ language: "en" });
    const expand = wrapper.get('button[aria-label="Expand chart"]');

    await expand.trigger("click");
    expect(wrapper.get(".brand-media-chart-panel").classes()).toContain("is-expanded");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(wrapper.get(".brand-media-chart-panel").classes()).not.toContain("is-expanded");
    expect(document.activeElement).toBe(expand.element);
    expect(wrapper.text()).toContain("Brand media performance");
  });
});
