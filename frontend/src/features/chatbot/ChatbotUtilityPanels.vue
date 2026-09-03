<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import type { LegacyChatUtilityState } from "../../legacy/contracts";
import type { UiLanguage } from "../../shared/i18n";

const props = withDefaults(defineProps<{
  readonly language: UiLanguage;
  readonly utility?: LegacyChatUtilityState;
  readonly logsAvailable?: boolean;
  readonly onboardingAvailable?: boolean;
  readonly clearAvailable?: boolean;
}>(), {
  utility: () => ({
    helpOpen: false,
    guideOpen: false,
    helpHtml: "",
    guideHtml: "",
    guideLoading: false,
    onboardingOpen: false,
    onboardingStep: 0,
    onboardingTotal: 0,
    reminderVisible: false,
    reminderCollapsed: false
  }),
  logsAvailable: false,
  onboardingAvailable: false,
  clearAvailable: false
});

const emit = defineEmits<{
  (event: "help"): void;
  (event: "guide"): void;
  (event: "logs", kind: "questions" | "feedback", format: "csv" | "jsonl"): void;
  (event: "onboarding"): void;
  (event: "clear"): void;
}>();

const root = ref<HTMLElement | null>(null);
const logsButton = ref<HTMLButtonElement | null>(null);
const logsOpen = ref(false);
const lightboxSrc = ref("");
const lightboxAlt = ref("");

const copy = computed(() => props.language === "zh" ? {
  help: "使用说明",
  guide: "使用流程",
  logs: "日志",
  questions: "提问记录",
  feedback: "反馈记录",
  clear: "清空对话",
  helpTitle: "使用说明",
  guideTitle: "使用流程",
  loading: "正在加载…"
} : {
  help: "Help",
  guide: "User guide",
  logs: "Logs",
  questions: "Questions",
  feedback: "Feedback",
  clear: "Clear conversation",
  helpTitle: "Help",
  guideTitle: "User guide",
  loading: "Loading…"
});

function toggleLogs(): void {
  logsOpen.value = !logsOpen.value;
}

function closeLogs(restoreFocus = false): void {
  if (!logsOpen.value) return;
  logsOpen.value = false;
  if (restoreFocus) logsButton.value?.focus();
}

function closeLightbox(): void {
  lightboxSrc.value = "";
  lightboxAlt.value = "";
}

function handlePointerdown(event: PointerEvent): void {
  if (!logsOpen.value || !root.value) return;
  const target = event.target;
  if (target instanceof Node && !root.value.contains(target)) closeLogs(true);
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  if (lightboxSrc.value) {
    event.preventDefault();
    closeLightbox();
    return;
  }
  if (logsOpen.value) {
    event.preventDefault();
    closeLogs(true);
  }
}

function handlePanelClick(event: MouseEvent): void {
  const target = event.target instanceof HTMLElement
    ? event.target.closest<HTMLImageElement>("[data-help-image], [data-guide-image]")
    : null;
  const src = target?.getAttribute("src")?.trim();
  if (!target || !src) return;
  lightboxSrc.value = src.slice(0, 2000);
  lightboxAlt.value = target.getAttribute("alt")?.trim().slice(0, 240) || "";
}

onMounted(() => {
  document.addEventListener("pointerdown", handlePointerdown);
  window.addEventListener("keydown", handleKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handlePointerdown);
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <div ref="root" class="chatbot-utility-panels" data-chatbot-utility @click="handlePanelClick">
    <button type="button" class="mode-btn mode-help" data-chatbot-action="help" :aria-expanded="utility.helpOpen" @click="emit('help')">
      <span class="mode-help-icon" aria-hidden="true">?</span>
      <span>{{ copy.help }}</span>
    </button>
    <button type="button" class="mode-btn mode-user-guide" data-chatbot-action="guide" :aria-expanded="utility.guideOpen" @click="emit('guide')">
      <span class="mode-help-icon" aria-hidden="true">i</span>
      <span>{{ copy.guide }}</span>
    </button>
    <div v-if="logsAvailable || clearAvailable" class="chatbot-modern-logs" data-chatbot-logs>
      <button ref="logsButton" type="button" class="mode-btn mode-logs" data-chatbot-action="logs" :aria-expanded="logsOpen" @click="toggleLogs">
        <span class="mode-logs-icon" aria-hidden="true">↘</span>
        <span>{{ logsAvailable ? copy.logs : copy.clear }}</span>
      </button>
      <div v-if="logsOpen" class="chat-logs-menu chatbot-modern-logs-menu" data-chatbot-logs-menu role="menu">
        <div v-if="logsAvailable" class="chat-log-group" role="group">
          <span class="chat-log-group-title">{{ copy.questions }}</span>
          <div class="chat-log-group-actions">
            <button type="button" role="menuitem" data-chatbot-log="questions-csv" @click="emit('logs', 'questions', 'csv')">CSV</button>
            <button type="button" role="menuitem" data-chatbot-log="questions-jsonl" @click="emit('logs', 'questions', 'jsonl')">JSONL</button>
          </div>
        </div>
        <div v-if="logsAvailable" class="chat-log-group" role="group">
          <span class="chat-log-group-title">{{ copy.feedback }}</span>
          <div class="chat-log-group-actions">
            <button type="button" role="menuitem" data-chatbot-log="feedback-csv" @click="emit('logs', 'feedback', 'csv')">CSV</button>
            <button type="button" role="menuitem" data-chatbot-log="feedback-jsonl" @click="emit('logs', 'feedback', 'jsonl')">JSONL</button>
          </div>
        </div>
        <button v-if="clearAvailable" type="button" role="menuitem" class="chat-log-clear" data-chatbot-action="clear" @click="emit('clear')">{{ copy.clear }}</button>
      </div>
    </div>

    <section v-if="utility.helpOpen" class="chatbot-utility-panel" data-chatbot-help-panel role="tabpanel" aria-live="polite">
      <header><strong>{{ copy.helpTitle }}</strong><button type="button" @click="emit('help')">×</button></header>
      <div v-if="utility.helpHtml" v-html="utility.helpHtml"></div>
    </section>
    <section v-if="utility.guideOpen" class="chatbot-utility-panel" data-chatbot-guide-panel role="tabpanel" aria-live="polite">
      <header><strong>{{ copy.guideTitle }}</strong><button type="button" @click="emit('guide')">×</button></header>
      <p v-if="utility.guideLoading" class="chatbot-utility-loading">{{ copy.loading }}</p>
      <div v-else-if="utility.guideHtml" v-html="utility.guideHtml"></div>
    </section>

    <div v-if="lightboxSrc" class="chatbot-utility-lightbox" data-chatbot-lightbox role="dialog" aria-modal="true" @click.self="closeLightbox">
      <button type="button" class="chatbot-utility-lightbox-close" data-chatbot-lightbox-close aria-label="Close image" @click="closeLightbox">×</button>
      <img :src="lightboxSrc" :alt="lightboxAlt" data-chatbot-lightbox-image>
    </div>
  </div>
</template>
