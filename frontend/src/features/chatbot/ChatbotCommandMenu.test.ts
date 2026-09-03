import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import ChatbotReportView from "./ChatbotReportView.vue";

describe("ChatbotCommandMenu", () => {
  it("supports slash intent navigation, selection, and Escape dismissal", async () => {
    const wrapper = mount(ChatbotReportView, {
      props: {
        language: "en",
        prompt: "/",
        result: null,
        loading: false,
        error: "",
        autoFocus: false
      }
    });

    expect(wrapper.findAll('[role="option"]')).toHaveLength(9);
    expect(wrapper.get(".chat-intent-menu-title").text()).toContain("Question type");
    expect(wrapper.get(".chat-intent-menu-title kbd").text()).toBe("/");
    expect(wrapper.findAll(".chat-intent-option.chatbot-command-option")).toHaveLength(9);
    expect(wrapper.findAll(".chat-intent-option-prefix")).toHaveLength(9);
    expect(wrapper.findAll(".chat-intent-option-hint")).toHaveLength(9);
    expect(wrapper.get(".chat-intent-option-prefix").text()).toBe(":");

    await wrapper.get("[data-chatbot-report-input]").trigger("keydown", { key: "ArrowDown" });
    await wrapper.get("[data-chatbot-report-input]").trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("update:prompt")?.at(-1)).toEqual(["category: "]);

    await wrapper.setProps({ prompt: "/" });
    expect(wrapper.find('[data-chatbot-command-menu]').exists()).toBe(true);
    await wrapper.get("[data-chatbot-report-input]").trigger("keydown", { key: "Escape" });
    expect(wrapper.find('[data-chatbot-command-menu]').exists()).toBe(false);
  });
});
