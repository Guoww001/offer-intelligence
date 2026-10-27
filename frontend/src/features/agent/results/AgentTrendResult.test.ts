import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { normalizeAgentResultView } from "../../../shared/contracts/agentResult";
import AgentTrendResult from "./AgentTrendResult.vue";

describe("Agent trend component", () => {
  it("选择其他指标时月度表仍保留该指标", () => {
    const view = normalizeAgentResultView({ id: "epc-monthly", toolName: "trend", kind: "trend", status: "done", title: "EPC", trend: { target: "合成商户", metric: "epc", metrics: ["epc"], months: [{ month: "2026-08", epc: 0.125 }] } })!;
    const wrapper = mount(AgentTrendResult, { props: { language: "zh", view } });
    expect(wrapper.get("table").text()).toContain("联盟 EPC");
    expect(wrapper.get("table").text()).toContain("0.125");
    wrapper.unmount();
  });
  it("逐月表直接展示所需八列和确定性环比，缺失不显示为零", () => {
    const view = normalizeAgentResultView({ id: "monthly-columns", toolName: "trend", kind: "trend", status: "done", title: "月度", trend: {
      target: "合成商户", metric: "revenue", metrics: ["revenue", "revenueMoM", "clicks", "clicksMoM", "orders", "ordersDelta", "conversionRate"],
      months: [{ month: "2026-08", revenue: 100, revenueMoM: -0.5, clicks: 30, clicksMoM: 0.5, orders: 3, ordersDelta: 1, conversionRate: 0.1 }, { month: "2026-09", revenue: 0, revenueMoM: null, clicks: null }]
    } })!;
    const wrapper = mount(AgentTrendResult, { props: { language: "zh", view } });
    expect(wrapper.findAll("thead th").map(cell => cell.text())).toEqual(["月份", "GMV", "GMV 环比", "点击", "点击环比", "订单", "订单环比新增", "转化率"]);
    expect(wrapper.get("tbody tr").text()).toContain("-50.00%");
    expect(wrapper.get("tbody tr").text()).toContain("50.00%");
    expect(wrapper.findAll("tbody tr")[1]!.text()).toContain("未提供");
    wrapper.unmount();
  });
  it("图表默认折叠，所问指标优先且保留更多指标", async () => {
    const view = normalizeAgentResultView({ id: "trend-ui", toolName: "trend", kind: "trend", status: "done", title: "趋势", trend: { target: "Shokz", metric: "conversionRate", metrics: ["revenue", "conversionRate", "epc"], months: [{ month: "2026-08", conversionRate: 0.072 }, { month: "2026-09", conversionRate: 0.1 }] } })!;
    const wrapper = mount(AgentTrendResult, { props: { language: "zh", view } });
    expect(wrapper.get('[data-agent-trend-toggle]').attributes("aria-expanded")).toBe("false");
    expect(wrapper.get('[data-agent-more-metrics]').find('[data-agent-trend-metric="epc"]').exists()).toBe(true);
    expect(wrapper.get("table").text()).toContain("7.20%");
    await wrapper.get('[data-agent-trend-toggle]').trigger("click");
    expect(wrapper.get('[data-agent-trend-toggle]').attributes("aria-expanded")).toBe("true");
    wrapper.unmount();
  });
  it("switches metrics through the local SVG renderer", async () => {
    const view = normalizeAgentResultView({ id: "trend-1", toolName: "trend", kind: "trend", status: "done", title: "Monthly trend", trend: {
      target: "Fixture", metric: "revenue", metrics: ["revenue", "orders"], months: [
        { month: "2026-07", revenue: 100, orders: 10 }, { month: "2026-08", revenue: 200, orders: 12 }
      ]
    } })!;
    const wrapper = mount(AgentTrendResult, { props: { language: "en", view } });
    expect(wrapper.get("svg").attributes("aria-label")).toContain("Revenue");
    await wrapper.get('[data-agent-trend-metric="orders"]').trigger("click");
    expect(wrapper.get("svg").attributes("aria-label")).toContain("Orders");
    wrapper.unmount();
  });

  it("preserves blank column positions and more than 16 tool rows", () => {
    const view = normalizeAgentResultView({ id: "table-1", toolName: "tier_analysis", kind: "table", status: "done", title: "Tier", columns: ["Tier", "Category", "Revenue"],
      rows: Array.from({ length: 40 }, (_, index) => ({ label: `Merchant ${index}`, values: ["Tier 2", "", "123"] })) })!;
    expect(view.rows).toHaveLength(40);
    expect(view.rows[0]!.values).toEqual(["Tier 2", "", "123"]);
  });
});
