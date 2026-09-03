import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { normalizeAgentResultView } from "../../../shared/contracts/agentResult";
import AgentTrendResult from "./AgentTrendResult.vue";

describe("Agent trend component", () => {
  it("switches metrics through the existing local renderer", async () => {
    const render = vi.fn((data) => `<section><button data-agent-trend-metric="orders">Orders</button><svg aria-label="${data.metric}"></svg></section>`);
    window.OI_LEGACY_BRIDGE = { ...window.OI_LEGACY_BRIDGE!, renderAgentTrend: render };
    const view = normalizeAgentResultView({ id: "trend-1", toolName: "trend", kind: "trend", status: "done", title: "Monthly trend", trend: {
      target: "Fixture", metric: "revenue", metrics: ["revenue", "orders"], months: [
        { month: "2026-07", revenue: 100, orders: 10 }, { month: "2026-08", revenue: 200, orders: 12 }
      ]
    } })!;
    const wrapper = mount(AgentTrendResult, { props: { language: "en", view } });
    expect(wrapper.get("svg").attributes("aria-label")).toBe("revenue");
    await wrapper.get("button").trigger("click");
    expect(wrapper.get("svg").attributes("aria-label")).toBe("orders");
    expect(render.mock.calls.at(-1)![0].months).toHaveLength(2);
    wrapper.unmount();
  });

  it("preserves blank column positions and more than 16 tool rows", () => {
    const view = normalizeAgentResultView({ id: "table-1", toolName: "tier_analysis", kind: "table", status: "done", title: "Tier", columns: ["Tier", "Category", "Revenue"],
      rows: Array.from({ length: 40 }, (_, index) => ({ label: `Merchant ${index}`, values: ["Tier 2", "", "123"] })) })!;
    expect(view.rows).toHaveLength(40);
    expect(view.rows[0]!.values).toEqual(["Tier 2", "", "123"]);
  });
});
