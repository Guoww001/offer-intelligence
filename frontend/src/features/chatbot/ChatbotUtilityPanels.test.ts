import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, expect, it } from "vitest";

import ChatbotUtilityPanels from "./ChatbotUtilityPanels.vue";

describe("ChatbotUtilityPanels", () => {
  it("keeps help, guide, logs, and clear controls in the legacy utility surface", async () => {
    const wrapper = mount(ChatbotUtilityPanels, {
      attachTo: document.body,
      props: {
        language: "en",
        logsAvailable: true,
        clearAvailable: true,
        utility: {
          helpOpen: true,
          guideOpen: true,
          helpHtml: '<img data-help-image src="/help.png" alt="Help">',
          guideHtml: "<p data-guide-copy>Guide content</p>",
          guideLoading: false,
          onboardingOpen: false,
          onboardingStep: 0,
          onboardingTotal: 0,
          reminderVisible: false,
          reminderCollapsed: false
        }
      }
    });

    expect(wrapper.find('[data-chatbot-help-panel] [data-help-image]').exists()).toBe(true);
    expect(wrapper.find('[data-chatbot-guide-panel] [data-guide-copy]').exists()).toBe(true);
    await wrapper.get('[data-help-image]').trigger("click");
    expect(wrapper.get('[data-chatbot-lightbox-image]').attributes("src")).toBe("/help.png");
    await wrapper.get('[data-chatbot-lightbox]').trigger("click");
    expect(wrapper.find('[data-chatbot-lightbox]').exists()).toBe(false);
    const logsButton = wrapper.get('[data-chatbot-action="logs"]');
    await logsButton.trigger("click");
    expect(wrapper.find('[data-chatbot-logs-menu]').attributes("role")).toBe("menu");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await nextTick();
    expect(wrapper.find('[data-chatbot-logs-menu]').exists()).toBe(false);
    expect(document.activeElement).toBe(logsButton.element);
    await logsButton.trigger("click");
    await wrapper.get('[data-chatbot-log="questions-csv"]').trigger("click");
    await wrapper.get('[data-chatbot-log="feedback-jsonl"]').trigger("click");
    await wrapper.get('[data-chatbot-action="clear"]').trigger("click");

    expect(wrapper.emitted("logs")).toEqual([
      ["questions", "csv"],
      ["feedback", "jsonl"]
    ]);
    expect(wrapper.emitted("clear")).toHaveLength(1);
    wrapper.unmount();
  });
});
