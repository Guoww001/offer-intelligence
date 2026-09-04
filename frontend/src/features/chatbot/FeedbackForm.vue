<script setup lang="ts">
import { computed, ref, watch } from "vue";

import type { UiLanguage } from "../../shared/i18n";
import type { ChatbotFeedback } from "./chatbotViewTypes";

type FeedbackReason = "inaccurate" | "not_answered" | "incomplete_data" | "unclear" | "other";

const props = withDefaults(defineProps<{
  readonly language: UiLanguage;
  readonly feedback?: ChatbotFeedback;
  readonly refreshKey?: number;
}>(), {
  feedback: undefined,
  refreshKey: 0
});

const open = ref(false);
const submitted = ref(false);
const pending = ref(false);
const reason = ref<FeedbackReason | "">("");
const detail = ref("");
const error = ref("");

const copy = computed(() => props.language === "zh" ? {
  open: "反馈答案",
  title: "哪里需要改进？",
  subtitle: "请选择一个主要原因，也可以补充说明。",
  reason: "主要原因",
  detail: "补充说明（可选）",
  placeholder: "请告诉我们哪里需要改进",
  cancel: "取消",
  submit: "提交反馈",
  submitted: "反馈已记录",
  alreadySubmitted: "这条答案的反馈已记录",
  unavailable: "当前答案暂不可反馈",
  failed: "反馈提交失败，请稍后重试。",
  required: "请选择一个反馈原因。",
  reasons: {
    inaccurate: "回答不准确",
    not_answered: "没有回答问题",
    incomplete_data: "数据不完整",
    unclear: "内容难以理解",
    other: "其他"
  }
} : {
  open: "Give feedback",
  title: "What could be improved?",
  subtitle: "Choose one main reason and optionally add details.",
  reason: "Main reason",
  detail: "Additional details (optional)",
  placeholder: "Tell us what could be improved",
  cancel: "Cancel",
  submit: "Submit feedback",
  submitted: "Feedback recorded",
  alreadySubmitted: "Feedback for this answer was already recorded",
  unavailable: "Feedback is unavailable for this answer",
  failed: "Feedback could not be submitted. Please try again.",
  required: "Choose a feedback reason.",
  reasons: {
    inaccurate: "The answer is inaccurate",
    not_answered: "It did not answer the question",
    incomplete_data: "The data is incomplete",
    unclear: "The content is hard to understand",
    other: "Other"
  }
});

const reasonOptions = computed<readonly FeedbackReason[]>(() => [
  "inaccurate",
  "not_answered",
  "incomplete_data",
  "unclear",
  "other"
]);

const available = computed(() => {
  void props.refreshKey;
  if (!props.feedback) return false;
  try {
    return props.feedback.isAvailable();
  } catch {
    return false;
  }
});

watch(() => props.refreshKey, () => {
  open.value = false;
  submitted.value = false;
  pending.value = false;
  reason.value = "";
  detail.value = "";
  error.value = "";
});

function openForm(): void {
  if (!available.value || submitted.value) return;
  error.value = "";
  open.value = true;
}

function cancel(): void {
  if (pending.value) return;
  open.value = false;
  error.value = "";
}

async function submit(): Promise<void> {
  if (!props.feedback || pending.value) return;
  if (!reason.value) {
    error.value = copy.value.required;
    return;
  }
  pending.value = true;
  error.value = "";
  try {
    const result = await props.feedback.submit(reason.value, detail.value.slice(0, 4000));
    if (result.ok) {
      submitted.value = true;
      open.value = false;
      error.value = "";
    } else {
      error.value = result.errorCode === "feedback_unavailable" ? copy.value.unavailable : copy.value.failed;
    }
  } catch {
    error.value = copy.value.failed;
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <section v-if="available" class="modern-feedback" data-feedback>
    <button
      v-if="!open && !submitted"
      type="button"
      class="modern-feedback-trigger"
      data-feedback-action="open"
      @click="openForm"
    >{{ copy.open }}</button>

    <p v-if="submitted" class="modern-feedback-status" data-feedback-status="submitted" role="status">
      {{ copy.submitted }}
    </p>

    <form v-if="open && !submitted" class="modern-feedback-form" data-feedback-form @submit.prevent="submit">
      <div class="modern-feedback-heading">
        <strong>{{ copy.title }}</strong>
        <span>{{ copy.subtitle }}</span>
      </div>
      <fieldset>
        <legend>{{ copy.reason }}</legend>
        <label v-for="option in reasonOptions" :key="option" class="modern-feedback-reason">
          <input
            v-model="reason"
            type="radio"
            name="modernFeedbackReason"
            :value="option"
            :data-feedback-reason="option"
            required
          >
          <span>{{ copy.reasons[option] }}</span>
        </label>
      </fieldset>
      <label class="modern-feedback-detail">
        <span>{{ copy.detail }}</span>
        <textarea v-model="detail" rows="3" maxlength="4000" :placeholder="copy.placeholder" data-feedback-detail></textarea>
      </label>
      <p v-if="error" class="modern-feedback-error" data-feedback-error role="alert">{{ error }}</p>
      <div class="modern-feedback-actions">
        <button type="button" data-feedback-action="cancel" :disabled="pending" @click="cancel">{{ copy.cancel }}</button>
        <button type="submit" data-feedback-action="submit" :disabled="pending">{{ pending ? "…" : copy.submit }}</button>
      </div>
    </form>
  </section>
</template>
