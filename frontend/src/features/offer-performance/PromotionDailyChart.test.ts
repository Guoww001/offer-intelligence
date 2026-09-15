import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PromotionDailyChart from "./PromotionDailyChart.vue";
import { emptyMetrics, windowDates } from "./performanceModel";

describe("Daily chart", () => {
  it("shows only observation bars, zero markers and pending dates when comparison data is present", async () => {
    const wrapper = mount(PromotionDailyChart, { props: {
      language: "zh", range: windowDates("2026-09-11")!, availableThrough: "2026-09-12", metric: "revenue", metricLabel: "营收", supported: true,
      rows: [{ merchantId: "101", before: { ...emptyMetrics(), revenue: 140 }, after: { ...emptyMetrics(), revenue: 30 }, monthly: [], daily: [{ ...emptyMetrics(), date: "2026-09-11", revenue: 30 }, { ...emptyMetrics(), date: "2026-09-04", revenue: 140 }] }],
    } });
    expect(wrapper.findAll("rect.promotion-trend-bar")).toHaveLength(1);
    expect(wrapper.findAll(".promotion-trend-zero")).toHaveLength(1);
    expect(wrapper.findAll(".promotion-trend-line")).toHaveLength(0);
    expect(wrapper.findAll("tbody tr")[2]!.text()).toContain("暂无数据");
    expect(wrapper.findAll("tbody tr")[0]!.text()).toContain("2026-09-11");
    await wrapper.setProps({ range: windowDates("2026-09-11", undefined, undefined, "2026-08-28", "2026-09-10")! });
    expect(wrapper.findAll("tbody tr")).toHaveLength(7);
    expect(wrapper.findAll("tbody tr")[0]!.text()).toContain("2026-09-11");
    expect(wrapper.findAll("tbody tr")[0]!.text()).toContain("US$30.00");
    expect(wrapper.find(".promotion-trend-line.before").exists()).toBe(false);
    await wrapper.setProps({ metric: "atc", metricLabel: "加购量", supported: false });
    expect(wrapper.text()).toContain("当前范围暂无该指标的每日数据");
    expect(wrapper.find("svg").exists()).toBe(false);
    wrapper.unmount();
  });
});
