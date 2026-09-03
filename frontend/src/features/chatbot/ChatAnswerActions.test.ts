import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import type { LegacyFeedbackBridge } from "../../legacy/contracts";
import ChatAnswerActions from "./ChatAnswerActions.vue";

describe("ChatAnswerActions", () => {
  it("opens a view and submits feedback for one answer", async () => {
    const submit = vi.fn(async () => ({ ok: true as const }));
    const feedback: LegacyFeedbackBridge = {
      isAvailable: () => true,
      submit
    };
    const wrapper = mount(ChatAnswerActions, {
      props: {
        language: "en",
        answerId: "answer-1",
        canOpenDeep: true,
        feedbackState: "available",
        feedback
      }
    });

    expect(wrapper.get("[data-chat-answer-actions]").attributes("data-chat-answer-id")).toBe("answer-1");
    await wrapper.get('[data-chatbot-action="open-chat-deep"]').trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(1);

    await wrapper.get('[data-chatbot-action="feedback"]').trigger("click");
    await wrapper.get('[data-feedback-reason="unclear"]').setValue(true);
    await wrapper.get("[data-feedback-detail]").setValue("Needs more context");
    await wrapper.get(".answer-feedback-dialog form").trigger("submit");
    await flushPromises();

    expect(submit).toHaveBeenCalledWith("unclear", "Needs more context");
    expect(wrapper.get('[data-chatbot-action="feedback"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-chatbot-action="feedback"]').attributes("data-feedback-status")).toBe("submitted");
    expect(wrapper.text()).toContain("Feedback sent");
  });

  it("restores focus to the feedback trigger after closing the dialog", async () => {
    const feedback: LegacyFeedbackBridge = {
      isAvailable: () => true,
      submit: async () => ({ ok: true as const })
    };
    const wrapper = mount(ChatAnswerActions, {
      attachTo: document.body,
      props: { language: "en", answerId: "answer-focus", feedbackState: "available", feedback }
    });
    const trigger = wrapper.get('[data-chatbot-action="feedback"]');

    await trigger.trigger("click");
    await wrapper.get('[data-feedback-action="close"]').trigger("click");

    expect(document.activeElement).toBe(trigger.element);
    wrapper.unmount();
  });
});
