<script setup lang="ts">
import { computed, ref } from "vue";

import { renderMarkdownToHtml } from "../../shared/markdown/markdown";
import type { UiLanguage } from "../../shared/i18n";
import type {
  LegacyChatStarterCard,
  LegacyChatViewResult,
  LegacyFeedbackBridge
} from "../../legacy/contracts";
import FeedbackForm from "./FeedbackForm.vue";
import type { ChatbotHistoryMessage, ChatbotMemoryItem } from "./chatbotViewTypes";

interface ChatMessage extends ChatbotHistoryMessage {
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
  readonly feedback?: LegacyFeedbackBridge;
  readonly feedbackRefreshKey?: number;
  readonly starterCards?: readonly LegacyChatStarterCard[];
  readonly currentResult?: LegacyChatViewResult | null;
  readonly openDeepAvailable?: boolean;
}>();

const emit = defineEmits<{
  (event: "update:input", value: string): void;
  (event: "submit"): void;
  (event: "stop"): void;
  (event: "remove-memory", id: string): void;
  (event: "starter-prompt", value: string): void;
  (event: "open-deep"): void;
  (event: "download", downloadId: string): void;
}>();

const starterCollapsed = ref(false);

const copy = computed(() => props.language === "zh" ? {
  eyebrow: "CHAT MODE",
  title: "直接和数据对话",
  subtitle: "围绕已加载的报告上下文继续追问，回答中的 Markdown 会实时渲染。",
  source: "当前会话",
  placeholder: "询问商户、Tier、付款、趋势或指标…",
  send: "发送",
  stop: "停止",
  memory: "报告上下文",
  noMemory: "尚未加入报告。可先在 Report Mode 生成一份报告。",
  remove: "移除报告",
  error: "回答暂时不可用，请重试。",
  starter: "继续追问",
  starterToggle: "切换提问示例",
  openDeep: "转为 View"
} : {
  eyebrow: "CHAT MODE",
  title: "Talk directly with the data",
  subtitle: "Continue from saved report context with streamed Markdown responses.",
  source: "Current session",
  placeholder: "Ask about merchants, tiers, payments, trends, or metrics…",
  send: "Send",
  stop: "Stop",
  memory: "Report context",
  noMemory: "No report has been added yet. Start in Report Mode first.",
  remove: "Remove report",
  error: "The response is temporarily unavailable. Try again.",
  starter: "Continue asking",
  starterToggle: "Toggle question examples",
  openDeep: "Open as View"
});

function rendered(content: string): string {
  return renderMarkdownToHtml(content);
}

function handleDownload(event: MouseEvent): void {
  const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-download-id]") : null;
  const root = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  if (!target || !root || !root.contains(target)) return;
  const downloadId = target.getAttribute("data-download-id")?.trim();
  if (downloadId) emit("download", downloadId.slice(0, 120));
}
</script>

<template>
  <section class="chatbot-chat-view" data-chatbot-mode="chat" aria-label="Chat Mode" @click="handleDownload">
    <header class="chatbot-mode-header">
      <div>
        <span class="chatbot-mode-eyebrow">{{ copy.eyebrow }}</span>
        <h2>{{ copy.title }}</h2>
        <p>{{ copy.subtitle }}</p>
      </div>
      <span class="chatbot-mode-source">{{ copy.source }}</span>
    </header>

    <section class="chatbot-memory-bar" data-chatbot-memory-bar aria-label="Report context">
      <div class="chatbot-memory-heading">
        <span class="chatbot-memory-mark" aria-hidden="true">+</span>
        <strong>{{ copy.memory }}</strong>
      </div>
      <div v-if="memory.length" class="chatbot-memory-list">
        <article v-for="item in memory" :key="item.id" class="chatbot-memory-item" data-chatbot-memory-item>
          <div>
            <strong>{{ item.title }}</strong>
            <span>{{ item.text }}</span>
          </div>
          <button type="button" data-chatbot-memory-remove :aria-label="copy.remove" @click="emit('remove-memory', item.id)">×</button>
        </article>
      </div>
      <p v-else class="chatbot-memory-empty">{{ copy.noMemory }}</p>
    </section>

    <section v-if="starterCards?.length" class="chatbot-memory-starter" data-chatbot-starter>
      <header class="chatbot-memory-starter-head">
        <strong>{{ copy.starter }}</strong>
        <button
          type="button"
          data-chatbot-starter-toggle
          :aria-expanded="!starterCollapsed"
          @click="starterCollapsed = !starterCollapsed"
        >{{ copy.starterToggle }}</button>
      </header>
      <div v-if="!starterCollapsed" class="chatbot-memory-starter-body">
        <article v-for="card in starterCards" :key="card.id" class="chatbot-memory-starter-group">
          <span class="chatbot-memory-starter-title">{{ card.title }}</span>
          <div class="chatbot-memory-starter-chips">
            <button
              v-for="question in card.questions"
              :key="question"
              type="button"
              class="chatbot-memory-starter-question"
              data-chatbot-starter-question
              @click="emit('starter-prompt', question)"
            >{{ question }}</button>
          </div>
        </article>
      </div>
    </section>

    <div class="chatbot-chat-log" data-chatbot-chat-log aria-live="polite">
      <article v-for="message in messages" :key="message.id" class="chatbot-chat-message" :class="`is-${message.role}`">
        <span class="chatbot-chat-role">{{ message.role === "user" ? "YOU" : "AI" }}</span>
        <div v-if="message.role === 'assistant'" class="chatbot-chat-content" v-html="rendered(message.content)"></div>
        <p v-else class="chatbot-chat-content">{{ message.content }}</p>
        <span v-if="message.streaming" class="chatbot-chat-cursor" aria-hidden="true"></span>
      </article>
      <p v-if="error" class="chatbot-chat-error" role="alert">{{ error || copy.error }}</p>
    </div>

    <div
      v-if="currentResult?.recommendationHtml"
      class="chatbot-memory-recommendation"
      data-chatbot-memory-recommendation
      v-html="currentResult.recommendationHtml"
    ></div>

    <button
      v-if="openDeepAvailable && currentResult?.ok"
      type="button"
      class="chatbot-chat-open-deep"
      data-chatbot-action="open-chat-deep"
      @click="emit('open-deep')"
    >{{ copy.openDeep }}</button>

    <FeedbackForm
      :language="language"
      :feedback="feedback"
      :refresh-key="feedbackRefreshKey"
    />

    <form class="chatbot-modern-composer" data-chatbot-composer @submit.prevent="emit('submit')">
      <textarea
        :value="input"
        :placeholder="copy.placeholder"
        rows="1"
        :disabled="loading"
        data-chatbot-input
        @input="emit('update:input', ($event.target as HTMLTextAreaElement).value)"
        @keydown.enter.exact.prevent="emit('submit')"
      ></textarea>
      <button v-if="loading" type="button" data-chatbot-action="stop" @click="emit('stop')">{{ copy.stop }}</button>
      <button v-else type="submit" data-chatbot-action="send">{{ copy.send }}</button>
    </form>
  </section>
</template>
