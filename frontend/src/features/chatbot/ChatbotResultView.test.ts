import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import type { LegacyChatViewResult } from "../../legacy/contracts";
import ChatbotResultView from "./ChatbotResultView.vue";
import { buildChatbotReport, type ChatbotReportData } from "./chatbotReportModel";

const data: ChatbotReportData = {
  offers: [{
    merchantId: "101",
    merchantName: "Alpha",
    brand: "Alpha",
    tier: "Tier 1",
    category: "Beauty",
    clicks: 100,
    orders: 10,
    salesAmount: 1000,
    affCommission: 100
  }]
};

describe("ChatbotResultView", () => {
  it("renders structured summary cards and escaped result rows", () => {
    const result = buildChatbotReport("Alpha", data, "en");
    const wrapper = mount(ChatbotResultView, { props: { language: "en", result } });

    expect(wrapper.find("[data-chatbot-result-status]").attributes("data-status")).toBe("resolved");
    expect(wrapper.findAll("[data-chatbot-stat]")).toHaveLength(6);
    expect(wrapper.find("[data-chatbot-row]").text()).toContain("Alpha");
    expect(wrapper.find("[data-chatbot-row]").text()).toContain("$1,000");
    expect(wrapper.find("[data-chatbot-result-source]").text()).toContain("cached");
  });

  it("shows an explicit empty state for missing data", () => {
    const result = buildChatbotReport("Missing", data, "zh");
    const wrapper = mount(ChatbotResultView, { props: { language: "zh", result } });

    expect(wrapper.find("[data-chatbot-empty]").exists()).toBe(true);
    expect(wrapper.find("[data-chatbot-empty]").text()).toContain("没有找到");
    expect(wrapper.findAll("[data-chatbot-row]")).toHaveLength(0);
  });

  it("does not synthesize a table when the Legacy bridge has no HTML payload", () => {
    const bridgeResult: LegacyChatViewResult = {
      ok: true,
      status: "success",
      mode: "report",
      source: "cache",
      response: "Legacy answer is still loading"
    };
    const result = buildChatbotReport("Alpha", data, "en");
    const wrapper = mount(ChatbotResultView, {
      props: { language: "en", result: { ...result, bridgeResult } }
    });

    expect(wrapper.find("[data-chatbot-explicit-state]").exists()).toBe(true);
    expect(wrapper.find(".chatbot-result-table-wrap").exists()).toBe(false);
    expect(wrapper.findAll("[data-chatbot-row]")).toHaveLength(0);
  });

  it("forwards legacy recommendation download clicks", async () => {
    const result = buildChatbotReport("Alpha", data, "en");
    const wrapper = mount(ChatbotResultView, {
      props: {
        language: "en",
        result: { ...result, legacyHtml: '<button type="button" data-download-id="download-1">Download Excel</button>' }
      }
    });

    await wrapper.get('[data-download-id="download-1"]').trigger("click");

    expect(wrapper.emitted("download")).toEqual([["download-1"]]);
  });
});
