import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import AgentTimeline from "./AgentTimeline.vue";

describe("AgentTimeline", () => {
  it("shows planning, tool, synthesis and partial metadata without raw payloads", () => {
    const wrapper = mount(AgentTimeline, {
      props: {
        language: "zh",
        status: "done",
        partial: true,
        steps: [
          { id: "planning", phase: "planning", status: "done", label: "规划", detail: "已生成 2 个数据步骤", elapsedMs: 42 },
          { id: "tool", phase: "tool", status: "done", label: "商户查询", detail: "数据库 · 120ms", elapsedMs: 120 },
          { id: "synthesis", phase: "synthesis", status: "done", label: "综合", detail: "已完成", elapsedMs: 80 }
        ],
        omittedTargets: ["Tier 2"]
      }
    });

    expect(wrapper.find('[data-agent-timeline]').attributes("data-status")).toBe("done");
    expect(wrapper.find('[data-agent-timeline]').classes()).toContain("agent-run-timeline");
    expect(wrapper.find(".agent-run-steps").exists()).toBe(true);
    expect(wrapper.find(".agent-run-step.agent-run-step-done").exists()).toBe(true);
    expect(wrapper.findAll('[data-agent-timeline-step]')).toHaveLength(3);
    expect(wrapper.find('[data-agent-partial]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Tier 2");
    expect(wrapper.text()).not.toContain("prompt");
  });

  it("shows the data freshness date supplied by the Agent tool", () => {
    const wrapper = mount(AgentTimeline, {
      props: {
        language: "en",
        status: "done",
        steps: [{
          id: "tool-freshness",
          phase: "tool",
          status: "done",
          label: "Merchant analysis",
          dataSource: "database",
          dataAsOf: "2026-09-02"
        }]
      }
    });

    expect(wrapper.text()).toContain("2026-09-02");
  });
});
