import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { normalizeAgentResultView } from "../../../shared/contracts/agentResult";
import AgentTrendResult from "./AgentTrendResult.vue";

describe("Agent trend component", () => {
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
