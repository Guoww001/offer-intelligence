import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import ChatbotChatView from "./ChatbotChatView.vue";

describe("ChatbotChatView", () => {
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
    await wrapper.get('[data-download-id="memory-recommendation-1"]').trigger("click");
    expect(wrapper.emitted("download")?.[0]).toEqual(["memory-recommendation-1"]);
    await wrapper.get('[data-chatbot-starter-question]').trigger("click");
    expect(wrapper.emitted("starter-prompt")?.[0]).toEqual(["Analyze this report"]);

    await wrapper.get('[data-chatbot-action="open-chat-deep"]').trigger("click");
    expect(wrapper.emitted("open-deep")).toHaveLength(1);
  });
});
