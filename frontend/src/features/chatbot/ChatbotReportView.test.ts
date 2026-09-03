import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import ChatbotReportView from "./ChatbotReportView.vue";

describe("ChatbotReportView Context", () => {
  it("forwards Legacy trend, column, payment-month, and context actions", async () => {
    const wrapper = mount(ChatbotReportView, {
      props: {
        language: "en",
        prompt: "Tapo",
        result: null,
        loading: false,
        error: "",
        contextHtml: `
          <button type="button" data-trend-metric="revenue">Revenue</button>
          <select data-trend-category-select><option value="Beauty">Beauty</option></select>
          <button type="button" data-trend-column-toggle>Display</button>
          <button type="button" data-trend-column-core>Default</button>
          <button type="button" data-trend-column-all>All</button>
          <button type="button" data-payment-month="2026-04">April</button>
          <button type="button" data-context-action="download" data-value="report-1">Download</button>
        `
      }
    });

    await wrapper.get('[data-trend-metric="revenue"]').trigger("click");
    await wrapper.get("[data-trend-category-select]").setValue("Beauty");
    await wrapper.get("[data-trend-column-toggle]").trigger("click");
    await wrapper.get("[data-trend-column-core]").trigger("click");
    await wrapper.get("[data-trend-column-all]").trigger("click");
    await wrapper.get('[data-payment-month="2026-04"]').trigger("click");
    await wrapper.get('[data-context-action="download"]').trigger("click");

    expect(wrapper.emitted("context-interact")).toEqual([
      ["trend-metric", "revenue"],
      ["trend-category", "Beauty"],
      ["trend-column-toggle"],
      ["trend-column-core"],
      ["trend-column-all"],
      ["payment-month", "2026-04"],
      ["download", "report-1"]
    ]);
  });

  it("keeps the Legacy report summary and live DB card in the chat log", async () => {
    const wrapper = mount(ChatbotReportView, {
      props: {
        language: "zh",
        prompt: "merchant: shokz",
        result: {
          intent: "merchant",
          status: "resolved",
          query: "merchant: shokz",
          source: "db",
          rows: [],
          summary: { offerCount: 1, clicks: 0, orders: 0, revenue: 0, commission: 0, conversionRate: null },
          message: "报告已生成",
          legacyHtml: '<div class="merchant-card">Shokz Official</div>',
          bridgeResult: {
            ok: true,
            status: "success",
            mode: "report",
            source: "db",
            response: '<div class="merchant-card">Shokz Official</div>',
            deepWindowId: "deep-1"
          }
        },
        supplementalHtml: '<section class="db-chat-card">Live DB details</section>',
        loading: false,
        error: ""
      }
    });

    const log = wrapper.get("[data-chatbot-report-log]");
    expect(log.find(".message.user").text()).toBe("merchant: shokz");
    expect(log.find(".deep-summary-card").text()).toContain("深度分析：merchant: shokz");
    expect(log.find(".deep-summary-card").text()).toContain("点击查看完整分析");
    expect(log.find(".db-chat-card").text()).toBe("Live DB details");
    expect(log.find(".message.assistant .merchant-card").exists()).toBe(false);

    await log.get(".deep-summary-card").trigger("click");
    expect(wrapper.emitted("open-deep")).toHaveLength(1);
  });
});
