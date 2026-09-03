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

  it("renders memory starter questions and exposes the chat Deep Window action", async () => {
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
        },
        openDeepAvailable: true
      }
    });

    expect(wrapper.find('[data-chatbot-starter]').exists()).toBe(true);
    expect(wrapper.find('[data-chatbot-memory-recommendation]').exists()).toBe(true);
    expect(wrapper.find('.insight-panel').exists()).toBe(true);
    expect(wrapper.find('.chat-panel').exists()).toBe(true);
    expect(wrapper.find('.message.assistant .chat-stream-text').exists()).toBe(true);
    expect(wrapper.find('.chat-input .chat-input-field input[data-chatbot-input]').exists()).toBe(true);
    await wrapper.get('[data-download-id="memory-recommendation-1"]').trigger("click");
    expect(wrapper.emitted("download")?.[0]).toEqual(["memory-recommendation-1"]);
    await wrapper.get('[data-chatbot-starter-question]').trigger("click");
    expect(wrapper.emitted("starter-prompt")?.[0]).toEqual(["Analyze this report"]);

    await wrapper.get('[data-chatbot-action="open-chat-deep"]').trigger("click");
    expect(wrapper.emitted("open-deep")).toHaveLength(1);
  });
});
