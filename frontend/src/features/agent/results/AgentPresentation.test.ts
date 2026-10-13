import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { normalizeAgentResultView } from "../../../shared/contracts/agentResult";
import AgentTableResult from "./AgentTableResult.vue";
import AgentMetricResult from "./AgentMetricResult.vue";
import AgentSummaryResult from "./AgentSummaryResult.vue";
import AgentStatusResult from "./AgentStatusResult.vue";
import AgentTrendResult from "./AgentTrendResult.vue";

describe("Agent 业务化结果展示", () => {
  it.each([
    { component: AgentTableResult, kind: "table", toolName: "merchant_comparison", status: "done", label: "商户对比", state: "已完成" },
    { component: AgentMetricResult, kind: "metric", toolName: "payment_status", status: "done", label: "付款状态", state: "已完成" },
    { component: AgentSummaryResult, kind: "summary", toolName: "keyword_search", status: "partial", label: "关键词商户", state: "部分完成" },
    { component: AgentStatusResult, kind: "status", toolName: "trend", status: "error", label: "月度趋势", state: "查询未完成" }
  ])("$kind 用中文业务标签代替工具和状态代码", ({ component, kind, toolName, status, label, state }) => {
    const view = normalizeAgentResultView({ id: "view", kind, toolName, status, title: "查询结果", metrics: [{ label: "recordCount", value: "0" }], rows: [], columns: [] })!;
    const wrapper = mount(component, { props: { language: "zh", view } });
    expect(wrapper.get("header").text()).toContain(label);
    expect(wrapper.get("header").text()).toContain(state);
    expect(wrapper.get("header").text()).not.toContain(toolName);
    if (kind === "metric") expect(wrapper.text()).toContain("记录数");
    wrapper.unmount();
  });

  it("趋势切换不把 null 绘成零，保留月份明细和中文指标", async () => {
    const view = normalizeAgentResultView({ id: "trend", toolName: "trend", kind: "trend", status: "done", title: "月度趋势", trend: {
      target: "商户", metric: "revenue", metrics: ["revenue", "clicks"], months: [
        { month: "2026-08", revenue: 100, clicks: null },
        { month: "2026-09", revenue: 150, clicks: 5 },
        { month: "2026-10", revenue: 200, clicks: 6 }
      ]
    } })!;
    const wrapper = mount(AgentTrendResult, { props: { language: "zh", view } });
    expect(wrapper.get('[data-agent-trend-metric="revenue"]').text()).toBe("收入");
    await wrapper.get('[data-agent-trend-metric="clicks"]').trigger("click");
    expect(wrapper.findAll("svg circle")).toHaveLength(2);
    expect(wrapper.get("table").text()).toContain("未提供");
    expect(wrapper.get("table").text()).toContain("2026-08");
    wrapper.unmount();
  });

  it("当前指标只有一点时仍能切回其他指标", async () => {
    const view = normalizeAgentResultView({ id: "trend", toolName: "trend", kind: "trend", status: "done", title: "月度趋势", trend: {
      target: "商户", metric: "revenue", metrics: ["revenue", "clicks"], months: [{ month: "2026-09", revenue: 100, clicks: null }, { month: "2026-10", revenue: 200, clicks: 6 }]
    } })!;
    const wrapper = mount(AgentTrendResult, { props: { language: "zh", view } });
    await wrapper.get('[data-agent-trend-metric="clicks"]').trigger("click");
    expect(wrapper.find("svg").exists()).toBe(false);
    expect(wrapper.find('[data-agent-trend-metric="revenue"]').exists()).toBe(true);
    await wrapper.get('[data-agent-trend-metric="revenue"]').trigger("click");
    expect(wrapper.find("svg").exists()).toBe(true);
    wrapper.unmount();
  });
});
