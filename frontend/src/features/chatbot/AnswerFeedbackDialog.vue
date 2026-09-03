<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import type { LegacyFeedbackBridge } from "../../legacy/contracts";
import type { UiLanguage } from "../../shared/i18n";

type FeedbackReason = "inaccurate" | "not_answered" | "incomplete_data" | "unclear" | "other";

const props = withDefaults(defineProps<{
  readonly open: boolean;
  readonly language: UiLanguage;
  readonly feedback?: LegacyFeedbackBridge | null;
  readonly refreshKey?: number;
  readonly restoreFocus?: HTMLElement | null;
}>(), {
  feedback: null,
  refreshKey: 0,
  restoreFocus: null
});

const emit = defineEmits<{
  (event: "update:open", value: boolean): void;
  (event: "submitted"): void;
}>();

const reason = ref<FeedbackReason | "">("");
const detail = ref("");
const pending = ref(false);
const error = ref("");
const dialog = ref<HTMLElement | null>(null);

const copy = computed(() => props.language === "zh" ? {
  title: "哪里需要改进？",
  subtitle: "请选择一个主要原因，也可以补充说明。",
  reason: "主要原因",
  detail: "补充说明（可选）",
  placeholder: "请告诉我们哪里需要改进",
  cancel: "取消",
  submit: "提交反馈",
  submitting: "提交中…",
  required: "请选择一个反馈原因。",
  failed: "反馈提交失败，请稍后重试。",
  reasons: {
    inaccurate: "回答不准确",
    not_answered: "没有回答问题",
    incomplete_data: "数据不完整",
    unclear: "内容难以理解",
    other: "其他"
  }
} : {
  title: "What could be improved?",
  subtitle: "Choose one main reason and optionally add details.",
  reason: "Main reason",
  detail: "Additional details (optional)",
  placeholder: "Tell us what could be improved",
  cancel: "Cancel",
  submit: "Submit feedback",
  submitting: "Submitting…",
  required: "Choose a feedback reason.",
  failed: "Feedback could not be submitted. Please try again.",
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

function reset(): void {
  reason.value = "";
  detail.value = "";
  pending.value = false;
  error.value = "";
}

async function focusFirst(): Promise<void> {
  await nextTick();
  dialog.value?.querySelector<HTMLElement>("input, textarea, button")?.focus();
}

function close(): void {
  if (pending.value) return;
  emit("update:open", false);
}

function restoreTriggerFocus(): void {
  const trigger = props.restoreFocus;
  if (trigger?.isConnected) trigger.focus();
}

function handleKeydown(event: KeyboardEvent): void {
  if (!props.open) return;
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== "Tab" || !dialog.value) return;
  const focusable = Array.from(dialog.value.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled)"));
  if (!focusable.length) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
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
    const result = await props.feedback.submit(reason.value, detail.value.trim().slice(0, 4000));
    if (!result.ok) {
      error.value = copy.value.failed;
      return;
    }
    emit("submitted");
    emit("update:open", false);
  } catch {
    error.value = copy.value.failed;
  } finally {
    pending.value = false;
  }
}

watch(() => props.open, (open) => {
  if (open) void focusFirst();
  else {
    reset();
    restoreTriggerFocus();
  }
});
watch(() => props.refreshKey, reset);

onMounted(() => window.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <div v-if="open" class="answer-feedback-backdrop" data-answer-feedback-backdrop @click.self="close">
    <section ref="dialog" class="answer-feedback-dialog" data-answer-feedback-dialog role="dialog" aria-modal="true" :aria-label="copy.title">
      <button type="button" class="answer-feedback-close" data-feedback-action="close" :aria-label="language === 'zh' ? '关闭反馈窗口' : 'Close feedback dialog'" @click="close">×</button>
      <div class="answer-feedback-heading">
        <strong>{{ copy.title }}</strong>
        <span>{{ copy.subtitle }}</span>
      </div>
      <form data-feedback-form @submit.prevent="submit">
        <fieldset>
          <legend>{{ copy.reason }}</legend>
          <label v-for="option in reasonOptions" :key="option" class="answer-feedback-reason">
            <input v-model="reason" type="radio" name="answerFeedbackReason" :value="option" :data-feedback-reason="option">
            <span>{{ copy.reasons[option] }}</span>
          </label>
        </fieldset>
        <label class="answer-feedback-detail">
          <span>{{ copy.detail }}</span>
          <textarea v-model="detail" rows="3" maxlength="4000" :placeholder="copy.placeholder" data-feedback-detail></textarea>
        </label>
        <p v-if="error" class="answer-feedback-error" data-feedback-error role="alert">{{ error }}</p>
        <div class="answer-feedback-actions">
          <button type="button" data-feedback-action="cancel" :disabled="pending" @click="close">{{ copy.cancel }}</button>
          <button type="submit" data-feedback-action="submit" :disabled="pending">{{ pending ? copy.submitting : copy.submit }}</button>
        </div>
      </form>
    </section>
  </div>
</template>
