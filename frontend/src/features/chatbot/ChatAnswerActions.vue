<script setup lang="ts">
import { computed, ref, watch } from "vue";

import type { ChatbotAnswerFeedbackState, ChatbotFeedback } from "./chatbotViewTypes";
import type { UiLanguage } from "../../shared/i18n";
import AnswerFeedbackDialog from "./AnswerFeedbackDialog.vue";

const props = withDefaults(defineProps<{
  readonly language: UiLanguage;
  readonly answerId?: string;
  readonly canOpenDeep?: boolean;
  readonly feedbackState?: ChatbotAnswerFeedbackState;
  readonly feedback?: ChatbotFeedback | null;
  readonly refreshKey?: number;
}>(), {
  answerId: "",
  canOpenDeep: false,
  feedbackState: "unavailable",
  feedback: null,
  refreshKey: 0
});

const emit = defineEmits<{
  (event: "open"): void;
}>();

const feedbackOpen = ref(false);
const feedbackSubmitted = ref(false);
const feedbackTrigger = ref<HTMLButtonElement | null>(null);
const feedbackAvailable = computed(() => props.feedbackState === "available" || Boolean(props.feedback));
const feedbackLabel = computed(() => feedbackSubmitted.value || props.feedbackState === "submitted"
  ? (props.language === "zh" ? "已反馈" : "Feedback sent")
  : (props.language === "zh" ? "反馈答案" : "Give feedback"));

function openFeedback(event: MouseEvent): void {
  if (!props.feedback || !feedbackAvailable.value || feedbackSubmitted.value) return;
  feedbackTrigger.value = event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null;
  feedbackOpen.value = true;
}

function markSubmitted(): void {
  feedbackSubmitted.value = true;
}

watch(() => [props.refreshKey, props.answerId], () => {
  feedbackSubmitted.value = false;
  feedbackOpen.value = false;
  feedbackTrigger.value = null;
});
</script>

<template>
  <span class="chat-answer-actions" data-chat-answer-actions :data-chat-answer-id="answerId">
    <button v-if="canOpenDeep" type="button" data-chatbot-action="open-chat-deep" @click="emit('open')">
      {{ language === 'zh' ? '转为 View' : 'Open as View' }}
    </button>
    <button
      v-if="feedbackAvailable"
      type="button"
      data-chatbot-action="feedback"
      data-feedback-action="open"
      :data-feedback-status="feedbackSubmitted || feedbackState === 'submitted' ? 'submitted' : 'available'"
      :disabled="feedbackSubmitted || feedbackState === 'submitted'"
      @click="openFeedback"
    >{{ feedbackLabel }}</button>
    <AnswerFeedbackDialog
      v-model:open="feedbackOpen"
      :language="language"
      :feedback="feedback"
      :refresh-key="refreshKey"
      :restore-focus="feedbackTrigger"
      @submitted="markSubmitted"
    />
  </span>
</template>
