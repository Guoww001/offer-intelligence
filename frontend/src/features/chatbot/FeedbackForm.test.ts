import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import FeedbackForm from "./FeedbackForm.vue";

describe("FeedbackForm", () => {
  it("requires a reason and submits the bounded detail through the Legacy bridge", async () => {
    const submit = vi.fn(async () => ({ ok: true as const }));
    const feedback = {
      isAvailable: vi.fn(() => true),
      submit
    };
    const wrapper = mount(FeedbackForm, {
      props: { language: "zh", feedback, refreshKey: 1 }
    });

    expect(wrapper.find('[data-feedback-action="open"]').exists()).toBe(true);
    await wrapper.get('[data-feedback-action="open"]').trigger("click");
    expect(wrapper.find('[data-feedback-form]').exists()).toBe(true);
    await wrapper.get('[data-feedback-reason="incomplete_data"]').setValue(true);
    await wrapper.get('[data-feedback-detail]').setValue("数据在刷新后不完整");
    await wrapper.get('[data-feedback-form]').trigger("submit");
    await flushPromises();

    expect(submit).toHaveBeenCalledWith("incomplete_data", "数据在刷新后不完整");
    expect(wrapper.find('[data-feedback-status="submitted"]').exists()).toBe(true);
  });

  it("does not render when the Legacy answer is unavailable", () => {
    const wrapper = mount(FeedbackForm, {
      props: {
        language: "en",
        feedback: { isAvailable: () => false, submit: vi.fn() },
        refreshKey: 1
      }
    });

    expect(wrapper.find('[data-feedback]').exists()).toBe(false);
  });
});
