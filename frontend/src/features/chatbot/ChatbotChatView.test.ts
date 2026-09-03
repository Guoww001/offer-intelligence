import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import ChatbotChatView from "./ChatbotChatView.vue";

describe("ChatbotChatView", () => {
  it("keeps the Legacy Chat Mode context and composer copy", () => {
    const wrapper = mount(ChatbotChatView, {
      props: {
        language: "zh",
        messages: [],
        memory: [],
        input: "",
        loading: false,
        error: "",
        contextTitle: "上下文概览",
        contextSubtitle: "整体 offer 快照",
        contextHtml: "<div data-legacy-chat-context>报告内容</div>"
      }
    });

    expect(wrapper.get(".chart-header h3").text()).toBe("上下文概览");
    expect(wrapper.get(".chart-header p").text()).toBe("整体 offer 快照");
    expect(wrapper.find("[data-chatbot-context-html] [data-legacy-chat-context]").exists()).toBe(true);
    expect(wrapper.get("[data-chatbot-input]").attributes("placeholder")).toBe("询问 EPC、分层、AOV、转化率、未付款 offer...");
  });

  it("renders memory starter questions without an extra Chat Mode conversion button", async () => {
    const wrapper = mount(ChatbotChatView, {
      props: {
        language: "en",
        messages: [{ id: "assistant-1", role: "assistant", content: "Answer" }],
        memory: [],
        starterCards: [{ id: "memory-1", title: "Tapo report", type: "merchant", questions: ["Analyze this report"] }],
        input: "",
        loading: false,
        error: "",
        currentResult: {
          ok: true,
          status: "success",
          mode: "chat",
          source: "db",
          response: "Answer",
          recommendationHtml: '<div data-recommendation-card><button type="button" data-download-id="memory-recommendation-1">Download</button></div>'
        }
      }
    });

    expect(wrapper.find('[data-chatbot-starter]').exists()).toBe(true);
    expect(wrapper.find('[data-chatbot-memory-recommendation]').exists()).toBe(true);
    expect(wrapper.find('.insight-panel').exists()).toBe(true);
    expect(wrapper.find('.chat-panel').exists()).toBe(true);
    expect(wrapper.find('.message.assistant .chat-stream-text').exists()).toBe(true);
    expect(wrapper.find('.chat-input .chat-input-field input[data-chatbot-input]').exists()).toBe(true);
    expect(wrapper.get('[data-chatbot-action="send"]').classes()).toContain("chatbot-chat-send");
    expect(wrapper.find('[data-chatbot-action="open-chat-deep"]').exists()).toBe(false);
    await wrapper.get('[data-download-id="memory-recommendation-1"]').trigger("click");
    expect(wrapper.emitted("download")?.[0]).toEqual(["memory-recommendation-1"]);
    await wrapper.get('[data-chatbot-starter-question]').trigger("click");
    expect(wrapper.emitted("starter-prompt")?.[0]).toEqual(["Analyze this report"]);
  });

  it("keeps the user's question inside the Chat Mode user bubble", () => {
    const wrapper = mount(ChatbotChatView, {
      props: {
        language: "zh",
        messages: [{ id: "user-1", role: "user", content: "近期 Shokz 怎么样" }],
        memory: [],
        input: "",
        loading: false,
        error: ""
      }
    });

    expect(wrapper.get('.chatbot-chat-log .message.user .chat-stream-text').text()).toBe("近期 Shokz 怎么样");
    expect(wrapper.get('[data-chatbot-action="send"]').classes()).toContain("chatbot-chat-send");
  });

  it("renders Legacy answer HTML as a summary card instead of literal markup", () => {
    const wrapper = mount(ChatbotChatView, {
      props: {
        language: "zh",
        messages: [{
          id: "answer-raw-html",
          role: "assistant",
          content: '<div class="merchant-card">Shokz Official</div>',
          contentHtml: '<div class="deep-summary-card"><h4>📊 深度分析：merchant: shokz</h4><p>merchant: shokz</p><small>点击查看完整分析</small></div>'
        }],
        memory: [],
        input: "",
        loading: false,
        error: ""
      }
    });

    expect(wrapper.find(".deep-summary-card").exists()).toBe(true);
    expect(wrapper.find(".deep-summary-card").text()).toContain("merchant: shokz");
    expect(wrapper.find(".message.assistant").text()).not.toContain("<div class=\"merchant-card\">");
  });

  it("keeps the legacy reminder actions and per-answer actions wired", async () => {
    const feedback = {
      isAvailable: () => true,
      submit: async () => ({ ok: true as const })
    };
    const wrapper = mount(ChatbotChatView, {
      props: {
        language: "en",
        messages: [{ id: "answer-1", answerId: "answer-1", role: "assistant", content: "Answer", canOpenDeep: true, feedbackState: "available" }],
        memory: [],
        input: "",
        loading: false,
        error: "",
        utility: {
          helpOpen: false,
          guideOpen: false,
          helpHtml: "",
          guideHtml: "",
          guideLoading: false,
          onboardingOpen: false,
          onboardingStep: 0,
          onboardingTotal: 0,
          reminderVisible: true,
          reminderCollapsed: false
        },
        feedbackForAnswer: () => feedback
      }
    });

    expect(wrapper.find('[data-chatbot-reminder]').exists()).toBe(true);
    expect(wrapper.find('[data-chat-answer-actions]').exists()).toBe(true);
    await wrapper.get('[data-chatbot-action="go-report"]').trigger("click");
    await wrapper.get('[data-chatbot-action="reminder-toggle"]').trigger("click");
    await wrapper.get('[data-chatbot-action="open-chat-deep"]').trigger("click");

    expect(wrapper.emitted("context-interact")).toEqual([["go-report"], ["reminder-toggle"]]);
    expect(wrapper.emitted("open-answer")).toEqual([["answer-1"]]);
  });
});
