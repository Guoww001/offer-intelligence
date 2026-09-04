import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import DeepWindow from "./DeepWindow.vue";
import type { ChatbotReportViewResult } from "./chatbotViewTypes";
import {
  deepWindowReport,
  errorDeepWindow,
  loadingDeepWindow,
  readyDeepWindow
} from "./deepWindowTestFixtures";

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
  it("renders the Legacy skeleton while a report is loading", () => {
    const wrapper = mount(DeepWindow, { props: loadingDeepWindow() });

    expect(wrapper.find(".deep-window").exists()).toBe(true);
    expect(wrapper.find(".deep-window-skeleton").exists()).toBe(true);
    expect(wrapper.findAll("[data-deep-window-step]")).toHaveLength(3);
    expect(wrapper.find('[data-deep-window-action="add-memory"]').exists()).toBe(false);
    expect(wrapper.find('[data-deep-window-action="stop"]').exists()).toBe(true);
  });

  it("keeps only the Legacy Deep Window actions when content is ready", async () => {
    const wrapper = mount(DeepWindow, { props: readyDeepWindow() });

    expect(wrapper.find(".deep-report-title").exists()).toBe(true);
    expect(wrapper.find(".deep-report-summary").exists()).toBe(true);
    expect(wrapper.find(".deep-report-sections").exists()).toBe(true);
    expect(wrapper.find(".deep-window-feedback").exists()).toBe(true);
    expect(wrapper.find('[data-deep-window-action="add-memory"]').exists()).toBe(true);
    expect(wrapper.find('[data-deep-window-action="export"]').exists()).toBe(true);
    expect(wrapper.find('[data-deep-window-action="minimize"]').exists()).toBe(true);
    expect(wrapper.find('[data-deep-window-action="close"]').exists()).toBe(true);
    expect(wrapper.find('[data-deep-window-action="pin"]').exists()).toBe(false);
    expect(wrapper.find('[data-deep-window-action="clone"]').exists()).toBe(false);
    expect(wrapper.find('[data-deep-window-action="overlay"]').exists()).toBe(false);
    expect(wrapper.get('[data-deep-window-header]').attributes("data-draggable")).toBe("true");

    await wrapper.get('[data-deep-window-action="export"]').trigger("click");
    await wrapper.get('[data-deep-window-action="add-memory"]').trigger("click");

    expect(wrapper.emitted("export")).toHaveLength(1);
    expect(wrapper.emitted("add-memory")).toHaveLength(1);
  });

  it("shows the error card and keeps the panel closable", () => {
    const wrapper = mount(DeepWindow, { props: errorDeepWindow() });
    expect(wrapper.find(".deep-window-error").text()).toContain("error");
    expect(wrapper.find('[data-deep-window-action="close"]').exists()).toBe(true);
  });

  it("delegates legacy trend-chart controls through explicit events", async () => {
    const wrapper = mount(DeepWindow, {
      props: {
        language: "en",
        result: {
          ...deepWindowReport,
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

  it("keeps the legacy column picker usable inside the Vue-owned window", async () => {
    const wrapper = mount(DeepWindow, {
      props: {
        language: "en",
        result: {
          ...deepWindowReport,
          legacyHtml: `<div class="trend-context-wrap">
            <button type="button" data-trend-column-toggle aria-expanded="false">Display</button>
            <div class="trend-column-picker hidden" data-trend-column-panel>
              <button type="button" data-trend-column-core>Default</button>
              <button type="button" data-trend-column-all>All</button>
              <input type="checkbox" value="revenue" data-trend-column-check checked>
              <input type="checkbox" value="orders" data-trend-column-check>
              <input type="checkbox" value="directSales" data-trend-column-check>
            </div>
          </div>`
        },
        minimized: false
      }
    });

    const toggle = wrapper.get("[data-trend-column-toggle]");
    await toggle.trigger("click");
    expect(wrapper.get("[data-trend-column-panel]").classes()).not.toContain("hidden");
    expect(toggle.attributes("aria-expanded")).toBe("true");

    await wrapper.get("[data-trend-column-core]").trigger("click");
    expect((wrapper.get('[data-trend-column-check][value="revenue"]').element as HTMLInputElement).checked).toBe(true);
    expect((wrapper.get('[data-trend-column-check][value="orders"]').element as HTMLInputElement).checked).toBe(true);
    expect((wrapper.get('[data-trend-column-check][value="directSales"]').element as HTMLInputElement).checked).toBe(false);

    await wrapper.get("[data-trend-column-all]").trigger("click");
    expect(wrapper.findAll('[data-trend-column-check]:checked')).toHaveLength(3);
    expect(wrapper.emitted("trend-interact")).toEqual([
      ["trend-column-toggle"],
      ["trend-column-core"],
      ["trend-column-all"]
    ]);
  });

  it("emits a memory-drop action when a panel ends over the memory bar", async () => {
    const memoryBar = document.createElement("div");
    memoryBar.setAttribute("data-chatbot-memory-bar", "true");
    document.body.appendChild(memoryBar);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(memoryBar);
    const wrapper = mount(DeepWindow, {
      props: { language: "en", result: deepWindowReport, minimized: true }
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
        result: deepWindowReport,
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
