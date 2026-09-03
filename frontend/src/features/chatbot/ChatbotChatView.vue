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
  readonly contextTitle?: string;
  readonly contextSubtitle?: string;
  readonly contextHtml?: string;
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
  openDeep: "转为 View"
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
  openDeep: "Open as View"
});

const legacyContextHtml = computed(() => props.contextHtml?.trim() || "");

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
    <div class="chatbot-chat-layout">
      <section class="insight-panel chatbot-chat-context-panel" aria-label="Insights">
        <div class="chart-header">
          <div>
            <h3>{{ contextTitle || copy.contextTitle }}</h3>
            <p>{{ contextSubtitle || (currentResult ? copy.source : copy.contextSubtitle) }}</p>
          </div>
        </div>
        <div class="recommendation-box context-panel">
          <div v-if="legacyContextHtml" class="chatbot-legacy-context" data-chatbot-context-html v-html="legacyContextHtml"></div>
          <div v-else-if="currentResult?.contentHtml" class="chat-stream-text" data-chatbot-chat-context v-html="currentResult.contentHtml"></div>
          <div v-else-if="currentResult?.recommendationHtml" class="chat-stream-text" data-chatbot-chat-context v-html="currentResult.recommendationHtml"></div>
          <p v-else class="chatbot-chat-context-empty">{{ copy.contextEmpty }}</p>
        </div>
      </section>

      <section class="chat-panel chatbot-chat-panel" aria-label="Chat">
        <div class="chat-log chatbot-chat-log" data-chatbot-chat-log aria-live="polite">
          <article v-for="message in messages" :key="message.id" class="message" :class="message.role">
            <div v-if="message.role === 'assistant'" class="chat-stream-text" v-html="rendered(message.content)"></div>
            <div v-else class="chat-stream-text"><p>{{ message.content }}</p></div>
            <span v-if="message.streaming" class="chatbot-chat-cursor" aria-hidden="true"></span>
          </article>
          <p v-if="error" class="chatbot-chat-error" role="alert">{{ error || copy.error }}</p>
        </div>

        <section class="chat-memory-bar" data-chatbot-memory-bar aria-label="Report context">
          <div class="chat-memory-chips">
            <article v-for="item in memory" :key="item.id" class="chat-memory-chip" data-chatbot-memory-item :title="item.text">
              <span class="chat-memory-chip-label">{{ item.title }}</span>
              <button class="chat-memory-chip-remove" type="button" data-chatbot-memory-remove :aria-label="copy.remove" @click="emit('remove-memory', item.id)">×</button>
            </article>
          </div>
          <div v-if="!memory.length" class="chat-memory-dropzone">
            <span class="chat-memory-dropzone-icon" aria-hidden="true">+</span>
            <span class="chat-memory-hint">{{ copy.noMemory }}</span>
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
        <button v-if="loading" type="button" data-chatbot-action="stop" @click="emit('stop')">{{ copy.stop }}</button>
        <button v-else type="submit" data-chatbot-action="send">{{ copy.send }}</button>
      </form>
    </section>
    </div>
  </section>
</template>
