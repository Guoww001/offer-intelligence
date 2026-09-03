<script setup lang="ts">
import { computed } from "vue";

import type { UiLanguage } from "../../shared/i18n";
import type { LegacyFeedbackBridge } from "../../legacy/contracts";
import ChatbotResultView from "./ChatbotResultView.vue";
import FeedbackForm from "./FeedbackForm.vue";
import type { ChatbotReportViewResult } from "./chatbotViewTypes";

const emit = defineEmits<{
  (event: "update:prompt", value: string): void;
  (event: "submit"): void;
  (event: "open-deep"): void;
  (event: "add-memory"): void;
  (event: "download-overview"): void;
  (event: "download", downloadId: string): void;
}>();

const props = defineProps<{
  readonly language: UiLanguage;
  readonly prompt: string;
  readonly result: ChatbotReportViewResult | null;
  readonly contextTitle?: string;
  readonly contextSubtitle?: string;
  readonly contextHtml?: string;
  readonly loading: boolean;
  readonly error: string;
  readonly autoFocus?: boolean;
  readonly feedback?: LegacyFeedbackBridge;
  readonly feedbackRefreshKey?: number;
}>();

const copy = computed(() => props.language === "zh" ? {
  reportEyebrow: "报告模式",
  reportTitle: "先获取数据报告",
  reportBody: "Report Mode 用于查询商户、ASIN、品类和指标，生成结构化分析报告。",
  reportModeReminder: "具体要求请转至聊天模式",
  reportPlaceholder: "询问 EPC、分层、AOV、转化率、未付款 offer...",
  ask: "发送",
  download: "下载",
  contextTitle: "上下文概览",
  contextSubtitle: "整体 offer 快照",
  responseTitle: "报告响应",
  generating: "正在生成报告…",
  source: "数据来源",
  openDeep: "打开 Deep Window",
  addMemory: "加入对话"
} : {
  reportEyebrow: "Report Mode",
  reportTitle: "Start with a data report",
  reportBody: "Use Report Mode to query merchants, ASINs, categories, and metrics, then generate a structured report.",
  reportModeReminder: "For specific requirements, switch to Chat Mode",
  reportPlaceholder: "Ask about EPC, tiers, AOV, conversion, unpaid offers...",
  ask: "Send",
  download: "Download",
  contextTitle: "Context Overview",
  contextSubtitle: "General offer snapshot",
  responseTitle: "Report response",
  generating: "Generating report…",
  source: "Data source",
  openDeep: "Open Deep Window",
  addMemory: "Add to chat"
});

const sourceLabel = computed(() => {
  if (!props.result) return copy.value.source;
  const source = props.result.source === "db"
    ? (props.language === "zh" ? "DB" : "database")
    : props.result.source === "cache"
      ? (props.language === "zh" ? "缓存" : "cache")
      : (props.language === "zh" ? "不可用" : "unavailable");
  return `${copy.value.source}: ${source}`;
});

const displayContextTitle = computed(() => props.contextTitle?.trim() || props.result?.title || copy.value.contextTitle);
const displayContextSubtitle = computed(() => props.contextSubtitle?.trim()
  || (props.result ? sourceLabel.value : copy.value.contextSubtitle));
const legacyContextHtml = computed(() => props.contextHtml?.trim() || props.result?.recommendationHtml?.trim() || "");
</script>

<template>
  <section class="chatbot-report-view" data-chatbot-mode="report">
    <div class="chatbot-report-layout">
      <section class="insight-panel" aria-label="Insights">
        <div class="chart-header">
          <div>
            <h3>{{ displayContextTitle }}</h3>
            <p>{{ displayContextSubtitle }}</p>
          </div>
          <button
            class="icon-button"
            type="button"
            data-chatbot-action="download-overview"
            :aria-label="copy.download"
            @click="emit('download-overview')"
          >{{ copy.download }}</button>
        </div>
        <div class="recommendation-box context-panel" aria-live="polite">
          <div v-if="result" class="chatbot-report-output-head">
            <span data-chatbot-report-source data-chatbot-result-source>{{ sourceLabel }}</span>
            <div>
              <button type="button" data-chatbot-action="open-deep" @click="emit('open-deep')">{{ copy.openDeep }}</button>
              <button type="button" data-chatbot-action="add-memory" @click="emit('add-memory')">{{ copy.addMemory }}</button>
            </div>
          </div>
          <div v-if="legacyContextHtml" class="chatbot-legacy-context" data-chatbot-context-html v-html="legacyContextHtml"></div>
          <ChatbotResultView v-else-if="result" :language="language" :result="result" @download="emit('download', $event)" />
          <FeedbackForm
            :language="language"
            :feedback="feedback"
            :refresh-key="feedbackRefreshKey"
          />
        </div>
      </section>

      <section class="chat-panel chatbot-report-chat-panel" aria-label="Report chat">
        <div class="chat-log chatbot-report-log" data-chatbot-report-log aria-live="polite">
          <aside class="report-mode-guide" role="note">
            <div class="report-mode-guide-mark" aria-hidden="true">▣</div>
            <div class="report-mode-guide-content">
              <span class="report-mode-guide-kicker">{{ copy.reportEyebrow }}</span>
              <h3>{{ copy.reportTitle }}</h3>
              <p>{{ copy.reportBody }}</p>
              <p class="report-mode-guide-reminder">
                <span aria-hidden="true">→</span>
                <strong>{{ copy.reportModeReminder }}</strong>
              </p>
            </div>
          </aside>
          <article v-if="result" class="message user">
            <div class="chat-stream-text"><p>{{ result.query }}</p></div>
          </article>
          <article v-if="result" class="message assistant">
            <div v-if="result.legacyHtml" class="chat-stream-text" v-html="result.legacyHtml"></div>
            <div v-else class="chat-stream-text"><p>{{ result.message || copy.responseTitle }}</p></div>
          </article>
          <article v-if="loading" class="message assistant loading-indicator">
            <div class="chat-stream-text"><p>{{ copy.generating }}</p></div>
          </article>
          <p v-if="error" class="chatbot-report-error" role="alert">{{ error }}</p>
        </div>

        <div class="chat-mode-toggle" role="tablist" aria-label="Chatbot mode">
          <slot name="mode-controls"></slot>
        </div>

        <form class="chat-input" data-chatbot-report-form @submit.prevent="emit('submit')">
          <div class="chat-input-field">
            <label class="sr-only" for="chatbotReportInput">{{ copy.reportTitle }}</label>
            <input
              id="chatbotReportInput"
              :value="prompt"
              :placeholder="copy.reportPlaceholder"
              :autofocus="autoFocus"
              autocomplete="off"
              data-chatbot-report-input
              @input="emit('update:prompt', ($event.target as HTMLInputElement).value)"
            >
          </div>
          <button type="submit" aria-label="Send" :disabled="loading" data-chatbot-action="report-submit">
            <span>{{ copy.ask }}</span>
          </button>
        </form>
      </section>
    </div>
  </section>
</template>
