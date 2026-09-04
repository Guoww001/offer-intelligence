<script setup lang="ts">
import { computed, ref } from "vue";

import { renderMarkdownToHtml } from "../../shared/markdown/markdown";
import type { UiLanguage } from "../../shared/i18n";
import ChatAnswerActions from "./ChatAnswerActions.vue";
import FeedbackForm from "./FeedbackForm.vue";
import type {
  ChatbotFeedback,
  ChatbotHistoryMessage,
  ChatbotMemoryItem,
  ChatbotSessionMessage,
  ChatbotSessionResult,
  ChatbotStarterCard,
  ChatbotUtilityState
} from "./chatbotViewTypes";

interface ChatMessage extends ChatbotHistoryMessage, Partial<Omit<ChatbotSessionMessage, "role" | "content">> {
  readonly id: string;
  readonly streaming?: boolean;
}

const props = defineProps<{
  readonly language: UiLanguage;
  readonly messages: readonly ChatMessage[];
  readonly memory: readonly ChatbotMemoryItem[];
  readonly input: string;
  readonly loading: boolean;
  readonly error: string;
  readonly contextTitle?: string;
  readonly contextSubtitle?: string;
  readonly contextHtml?: string;
  readonly feedback?: ChatbotFeedback;
  readonly feedbackRefreshKey?: number;
  readonly starterCards?: readonly ChatbotStarterCard[];
  readonly currentResult?: ChatbotSessionResult | null;
  readonly utility?: ChatbotUtilityState;
  readonly feedbackForAnswer?: (answerId: string) => ChatbotFeedback | null;
  readonly dropHighlighted?: boolean;
  readonly supplementalHtml?: string;
}>();

const emit = defineEmits<{
  (event: "update:input", value: string): void;
  (event: "submit"): void;
  (event: "stop"): void;
  (event: "remove-memory", id: string): void;
  (event: "starter-prompt", value: string): void;
  (event: "open-answer", answerId: string): void;
  (event: "context-interact", action: string, value?: string): void;
  (event: "download", downloadId: string): void;
}>();

const starterCollapsed = ref(false);

const hasPerAnswerFeedback = computed(() => props.messages.some((message) =>
  message.role === "assistant" && !message.streaming &&
  (message.feedbackState === "available" || message.feedbackState === "submitted")
));

const copy = computed(() => props.language === "zh" ? {
  eyebrow: "CHAT MODE",
  title: "直接和数据对话",
  subtitle: "围绕已加载的报告上下文继续追问，回答中的 Markdown 会实时渲染。",
  source: "当前会话",
  contextTitle: "上下文概览",
  contextSubtitle: "整体 offer 快照",
  contextEmpty: "尚未生成可展示的上下文。",
  placeholder: "询问 EPC、分层、AOV、转化率、未付款 offer...",
  send: "发送",
  stop: "停止",
  memory: "报告上下文",
  noMemory: "尚未加入报告。可先在 Report Mode 生成一份报告。",
  remove: "移除报告",
  error: "回答暂时不可用，请重试。",
  starter: "继续追问",
  starterToggle: "切换提问示例",
  chatReminderKicker: "Chat Mode",
  chatReminderTitle: "把报告放进记忆栏，再开始对话",
  chatReminderBody: "Chat Mode 可以根据记忆内容做解释、归纳、横向比较和行动建议",
  chatReminderReminder: "还没有报告？先去 Report Mode 生成一份",
  goReport: "去生成报告",
  collapse: "收起"
} : {
  eyebrow: "CHAT MODE",
  title: "Talk directly with the data",
  subtitle: "Continue from saved report context with streamed Markdown responses.",
  source: "Current session",
  contextTitle: "Context Overview",
  contextSubtitle: "General offer snapshot",
  contextEmpty: "No report context is available yet.",
  placeholder: "Ask about EPC, tiers, AOV, conversion, unpaid offers...",
  send: "Send",
  stop: "Stop",
  memory: "Report context",
  noMemory: "No report has been added yet. Start in Report Mode first.",
  remove: "Remove report",
  error: "The response is temporarily unavailable. Try again.",
  starter: "Continue asking",
  starterToggle: "Toggle question examples",
  chatReminderKicker: "Chat Mode",
  chatReminderTitle: "Bring a report into memory, then start the conversation",
  chatReminderBody: "Chat Mode can explain, summarize, compare side by side, and suggest actions based on memory content.",
  chatReminderReminder: "No report yet? Generate one in Report Mode first",
  goReport: "Go generate a report",
  collapse: "Collapse"
});

const contextRichHtml = computed(() => props.contextHtml?.trim() || "");

function rendered(content: string): string {
  return renderMarkdownToHtml(content);
}

function messageHtml(message: ChatMessage): string {
  const richHtml = message.role === "assistant" ? message.contentHtml?.trim() || "" : "";
  return richHtml || rendered(message.content);
}

function handleDownload(event: MouseEvent): void {
  const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-download-id]") : null;
  const root = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  if (!target || !root || !root.contains(target)) return;
  const downloadId = target.getAttribute("data-download-id")?.trim();
  if (downloadId) emit("download", downloadId.slice(0, 120));
}

function handleContextInteraction(event: Event): void {
  const target = event.target instanceof HTMLElement
    ? event.target.closest<HTMLElement>("[data-trend-metric], [data-trend-category-select], [data-trend-column-toggle], [data-trend-column-core], [data-trend-column-all], [data-payment-month], [data-context-action]")
    : null;
  if (!target) return;
  if (target.matches("[data-trend-metric]")) {
    const metric = target.getAttribute("data-trend-metric");
    if (metric) emit("context-interact", "trend-metric", metric);
  } else if (target.matches("[data-trend-category-select]")) {
    emit("context-interact", "trend-category", (target as HTMLSelectElement).value);
  } else if (target.matches("[data-trend-column-toggle]")) {
    emit("context-interact", "trend-column-toggle");
  } else if (target.matches("[data-trend-column-core]")) {
    emit("context-interact", "trend-column-core");
  } else if (target.matches("[data-trend-column-all]")) {
    emit("context-interact", "trend-column-all");
  } else if (target.matches("[data-payment-month]")) {
    emit("context-interact", "payment-month", target.getAttribute("data-payment-month") || undefined);
  } else {
    emit("context-interact", target.getAttribute("data-context-action") || "open", target.getAttribute("data-value") || undefined);
  }
}

function handleReminderInteraction(event: MouseEvent): void {
  const target = event.target instanceof HTMLElement
    ? event.target.closest<HTMLElement>("[data-chatbot-action='reminder-toggle'], [data-chatbot-action='go-report']")
    : null;
  if (!target) return;
  if (target.matches("[data-chatbot-action='reminder-toggle']")) emit("context-interact", "reminder-toggle");
  else emit("context-interact", "go-report");
}
</script>

<template>
  <section class="chatbot-chat-view" data-chatbot-mode="chat" aria-label="Chat Mode" @click="handleDownload">
    <div class="chatbot-chat-layout">
      <section class="insight-panel chatbot-chat-context-panel" aria-label="Insights">
        <div class="chart-header">
          <div>
            <h3>{{ contextTitle || copy.contextTitle }}</h3>
            <p>{{ contextSubtitle || (currentResult ? copy.source : copy.contextSubtitle) }}</p>
          </div>
        </div>
        <div class="recommendation-box context-panel" :class="{ 'drop-highlight': dropHighlighted }" @click="handleContextInteraction" @change="handleContextInteraction">
          <div v-if="contextRichHtml" class="chatbot-rich-context" data-chatbot-context-html v-html="contextRichHtml"></div>
          <div v-else-if="currentResult?.contentHtml" class="chat-stream-text" data-chatbot-chat-context v-html="currentResult.contentHtml"></div>
          <div v-else-if="currentResult?.recommendationHtml" class="chat-stream-text" data-chatbot-chat-context v-html="currentResult.recommendationHtml"></div>
          <p v-else class="chatbot-chat-context-empty">{{ copy.contextEmpty }}</p>
          <div v-if="supplementalHtml" class="chatbot-chat-context-supplemental" data-chatbot-context-supplemental v-html="supplementalHtml"></div>
        </div>
      </section>

      <section class="chat-panel chatbot-chat-panel" aria-label="Chat">
        <div class="chat-log chatbot-chat-log" data-chatbot-chat-log aria-live="polite">
          <aside
            v-if="utility?.reminderVisible"
            class="chat-reminder"
            :class="{ collapsed: utility.reminderCollapsed }"
            data-chatbot-reminder
            role="note"
            aria-labelledby="chatModeReminderTitle"
            @click="handleReminderInteraction"
          >
            <div class="chat-reminder-mark" aria-hidden="true">◈</div>
            <div class="chat-reminder-content">
              <div class="chat-reminder-head">
                <span class="chat-reminder-kicker">{{ copy.chatReminderKicker }}</span>
                <button
                  type="button"
                  class="chat-reminder-toggle"
                  data-chatbot-action="reminder-toggle"
                  :aria-expanded="!utility.reminderCollapsed"
                  :aria-label="copy.collapse"
                ><span class="chat-reminder-chevron" aria-hidden="true"></span></button>
              </div>
              <div v-show="!utility.reminderCollapsed" class="chat-reminder-fold">
                <h3 id="chatModeReminderTitle" class="chat-reminder-title">{{ copy.chatReminderTitle }}</h3>
                <p class="chat-reminder-body">{{ copy.chatReminderBody }}</p>
                <p class="chat-reminder-reminder">
                  <span aria-hidden="true">→</span>
                  <strong>{{ copy.chatReminderReminder }}</strong>
                  <button type="button" class="chat-reminder-action" data-chatbot-action="go-report">{{ copy.goReport }}</button>
                </p>
              </div>
            </div>
          </aside>
          <article v-for="message in messages" :key="message.id" class="message" :class="message.role">
            <div v-if="message.role === 'assistant'" class="chat-stream-text" v-html="messageHtml(message)"></div>
            <div v-else class="chat-stream-text"><p>{{ message.content }}</p></div>
            <span v-if="message.streaming" class="chatbot-chat-cursor" aria-hidden="true"></span>
            <ChatAnswerActions
              v-if="message.role === 'assistant' && !message.streaming && (message.canOpenDeep || message.feedbackState === 'available' || message.feedbackState === 'submitted')"
              :language="language"
              :answer-id="message.answerId || message.id"
              :can-open-deep="message.canOpenDeep"
              :feedback-state="message.feedbackState"
              :feedback="feedbackForAnswer?.(message.answerId || message.id)"
              @open="emit('open-answer', message.answerId || message.id)"
            />
          </article>
          <p v-if="error" class="chatbot-chat-error" role="alert">{{ error || copy.error }}</p>
        </div>

        <section class="chat-memory-bar" :class="{ 'drop-highlight': dropHighlighted }" data-chatbot-memory-bar aria-label="Report context">
          <div class="chat-memory-chips">
            <article v-for="item in memory" :key="item.id" class="chat-memory-chip" data-chatbot-memory-item :title="item.text">
              <span class="chat-memory-chip-label">{{ item.title }}</span>
              <button class="chat-memory-chip-remove" type="button" data-chatbot-memory-remove :aria-label="copy.remove" @click="emit('remove-memory', item.id)">×</button>
            </article>
          </div>
          <div class="chat-memory-dropzone" data-chatbot-memory-dropzone>
            <span class="chat-memory-dropzone-icon" aria-hidden="true">+</span>
            <span class="chat-memory-hint">{{ memory.length ? copy.memory : copy.noMemory }}</span>
          </div>
          <section v-if="starterCards?.length" class="chat-memory-starter is-in" :class="{ collapsed: starterCollapsed }" data-chatbot-starter>
            <div class="chat-memory-starter-core">
              <div class="chat-memory-starter-head">
                <span class="chat-memory-starter-eyebrow">{{ copy.starter }} · {{ starterCards.length }}</span>
                <button
                  class="chat-memory-starter-toggle"
                  type="button"
                  data-chatbot-starter-toggle
                  :aria-expanded="!starterCollapsed"
                  :aria-label="copy.starterToggle"
                  @click="starterCollapsed = !starterCollapsed"
                ><span class="chat-memory-starter-chevron" aria-hidden="true"></span></button>
              </div>
              <div v-if="!starterCollapsed" class="chat-memory-starter-body">
                <article v-for="card in starterCards" :key="card.id" class="chat-memory-starter-group">
                  <div class="chat-memory-starter-group-head">
                    <span class="chat-memory-starter-type is-generic">
                      <span class="chat-memory-starter-type-dot" aria-hidden="true"></span>
                      <span class="chat-memory-starter-type-text">{{ card.type }}</span>
                    </span>
                    <span class="chat-memory-starter-title">{{ card.title }}</span>
                  </div>
                  <div class="chat-memory-starter-chips">
                    <button
                      v-for="question in card.questions"
                      :key="question"
                      type="button"
                      class="starter-chip"
                      data-chatbot-starter-question
                      @click="emit('starter-prompt', question)"
                    >{{ question }}</button>
                  </div>
                </article>
              </div>
            </div>
          </section>
        </section>
      <div class="chat-mode-toggle" role="tablist" aria-label="Chatbot mode">
        <slot name="mode-controls"></slot>
      </div>

      <div
        v-if="currentResult?.recommendationHtml"
        class="chatbot-memory-recommendation"
        data-chatbot-memory-recommendation
        v-html="currentResult.recommendationHtml"
      ></div>

      <FeedbackForm
        v-if="!hasPerAnswerFeedback"
        :language="language"
        :feedback="feedback"
        :refresh-key="feedbackRefreshKey"
      />

      <form class="chat-input chatbot-chat-input" data-chatbot-composer @submit.prevent="emit('submit')">
        <div class="chat-input-field">
          <input
            :value="input"
            :placeholder="copy.placeholder"
            autocomplete="off"
            :disabled="loading"
            data-chatbot-input
            @input="emit('update:input', ($event.target as HTMLInputElement).value)"
            @keydown.enter.exact.prevent="emit('submit')"
          >
        </div>
        <button v-if="loading" type="button" class="chatbot-chat-send is-stopping" data-chatbot-action="stop" @click="emit('stop')">{{ copy.stop }}</button>
        <button v-else type="submit" class="chatbot-chat-send" data-chatbot-action="send">{{ copy.send }}</button>
      </form>
    </section>
    </div>
  </section>
</template>
