import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import DeepWindow from "./DeepWindow.vue";
import type { ChatbotReportViewResult } from "./chatbotViewTypes";

const report: ChatbotReportViewResult = {
  intent: "merchant",
  status: "resolved",
  query: "Tapo",
  source: "db",
  rows: [],
  summary: { offerCount: 0, clicks: 0, orders: 0, revenue: 0, commission: 0, conversionRate: null },
  message: "Tapo report"
};

describe("DeepWindow", () => {
  it("exposes drag, pin, export, clone, overlay, cancel and memory controls", async () => {
    const wrapper = mount(DeepWindow, {
      props: { language: "zh", result: report, minimized: false, pinned: false, overlay: false, status: "loading" }
    });

    expect(wrapper.find('[data-deep-window-action="export"]').exists()).toBe(true);
    expect(wrapper.find('[data-deep-window-action="clone"]').exists()).toBe(true);
    expect(wrapper.find('[data-deep-window-action="overlay"]').exists()).toBe(true);
    expect(wrapper.find('[data-deep-window-action="cancel"]').exists()).toBe(true);
    expect(wrapper.find('[data-deep-window-action="pin"]').exists()).toBe(true);
    expect(wrapper.get('[data-deep-window-header]').attributes("data-draggable")).toBe("true");

    await wrapper.get('[data-deep-window-action="pin"]').trigger("click");
    await wrapper.get('[data-deep-window-action="export"]').trigger("click");
    await wrapper.get('[data-deep-window-action="clone"]').trigger("click");
    await wrapper.get('[data-deep-window-action="overlay"]').trigger("click");
    await wrapper.get('[data-deep-window-action="cancel"]').trigger("click");
    await wrapper.get('[data-deep-window-action="add-memory"]').trigger("click");

    expect(wrapper.emitted("pin")).toHaveLength(1);
    expect(wrapper.emitted("export")).toHaveLength(1);
    expect(wrapper.emitted("clone")).toHaveLength(1);
    expect(wrapper.emitted("overlay")).toHaveLength(1);
    expect(wrapper.emitted("cancel")).toHaveLength(1);
    expect(wrapper.emitted("add-memory")).toHaveLength(1);
  });

  it("delegates legacy trend-chart controls through explicit events", async () => {
    const wrapper = mount(DeepWindow, {
      props: {
        language: "en",
        result: {
          ...report,
          legacyHtml: `<div class="trend-context-wrap">
            <button type="button" data-trend-metric="revenue">Revenue</button>
            <label><input type="checkbox" value="orders" data-trend-column-check></label>
            <label><input type="checkbox" value="revenue" data-trend-column-check></label>
          </div>`
        },
        minimized: false
      }
    });

    await wrapper.get('[data-trend-metric="revenue"]').trigger("click");
    const checkbox = wrapper.get('[data-trend-column-check][value="orders"]');
    await checkbox.setValue(true);

    expect(wrapper.emitted("trend-interact")).toEqual([["trend-metric", "revenue"]]);
    expect(wrapper.emitted("trend-columns")).toEqual([[['orders']]]);
  });

  it("emits a memory-drop action when a panel ends over the memory bar", async () => {
    const memoryBar = document.createElement("div");
    memoryBar.setAttribute("data-chatbot-memory-bar", "true");
    document.body.appendChild(memoryBar);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(memoryBar);
    const wrapper = mount(DeepWindow, {
      props: { language: "en", result: report, minimized: false }
    });

    await wrapper.get('[data-deep-window-header]').trigger("pointerdown", { button: 0, clientX: 10, clientY: 10 });
    window.dispatchEvent(new Event("pointerup"));

    expect(wrapper.emitted("drop-memory")).toHaveLength(1);
    memoryBar.remove();
    vi.restoreAllMocks();
  });

  it("reflects the legacy memory action state", () => {
    const wrapper = mount(DeepWindow, {
      props: {
        language: "en",
        result: report,
        minimized: false,
        canAddMemory: false,
        addedToMemory: true
      }
    });

    const button = wrapper.get('[data-deep-window-action="add-memory"]');
    expect(button.attributes("disabled")).toBeDefined();
    expect(button.text()).toContain("Added");
  });
});
