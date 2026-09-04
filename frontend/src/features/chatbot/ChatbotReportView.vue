<script setup lang="ts">
import { computed, ref } from "vue";

import type { UiLanguage } from "../../shared/i18n";
import type { ChatbotAnswerFeedbackState, ChatbotFeedback } from "./chatbotViewTypes";
import ChatAnswerActions from "./ChatAnswerActions.vue";
import ChatbotCommandMenu from "./ChatbotCommandMenu.vue";
import ChatbotResultView from "./ChatbotResultView.vue";
import FeedbackForm from "./FeedbackForm.vue";
import type { ChatbotReportViewResult } from "./chatbotViewTypes";

const emit = defineEmits<{
  (event: "update:prompt", value: string): void;
  (event: "submit"): void;
  (event: "open-deep"): void;
  (event: "add-memory"): void;
  (event: "open-answer", answerId: string): void;
  (event: "context-interact", action: string, value?: string): void;
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
  readonly feedback?: ChatbotFeedback;
  readonly feedbackRefreshKey?: number;
  readonly answerId?: string | null;
  readonly feedbackState?: ChatbotAnswerFeedbackState;
  readonly answerFeedback?: ChatbotFeedback | null;
  readonly supplementalHtml?: string;
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
  summaryPrefix: "📊 深度分析：",
  summaryClick: "点击查看完整分析",
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
  summaryPrefix: "📊 Deep Analysis: ",
  summaryClick: "Click to view full analysis",
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
const contextRichHtml = computed(() => props.contextHtml?.trim() || props.result?.recommendationHtml?.trim() || "");
const reportHasAnswerActions = computed(() => Boolean(props.answerId && props.answerFeedback));
const commandMenu = ref<InstanceType<typeof ChatbotCommandMenu> | null>(null);

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

function handleCommandKeydown(event: KeyboardEvent): void {
  commandMenu.value?.handleKeydown(event);
}

function commandLabel(key: string): string {
  if (key === "categorytier") return props.language === "zh" ? "品类 + Tier" : "Category & Tier";
  return key;
}

function selectCommand(key: string): void {
  emit("update:prompt", commandLabel(key) + ": ");
}

function openReportSummary(): void {
  emit("open-deep");
}

function handleReportSummaryKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openReportSummary();
  }
}
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
        <div class="recommendation-box context-panel" aria-live="polite" @click="handleContextInteraction" @change="handleContextInteraction">
          <div v-if="result" class="chatbot-report-output-head">
            <span data-chatbot-report-source data-chatbot-result-source>{{ sourceLabel }}</span>
            <div>
              <button type="button" data-chatbot-action="open-deep" @click="emit('open-deep')">{{ copy.openDeep }}</button>
              <button type="button" data-chatbot-action="add-memory" @click="emit('add-memory')">{{ copy.addMemory }}</button>
            </div>
          </div>
          <div v-if="contextRichHtml" class="chatbot-rich-context" data-chatbot-context-html v-html="contextRichHtml"></div>
          <ChatbotResultView v-else-if="result" :language="language" :result="result" @download="emit('download', $event)" />
          <div v-else class="chatbot-report-empty" data-chatbot-report-empty>
            <span class="chatbot-report-empty-mark" aria-hidden="true">□</span>
            <strong>{{ language === 'zh' ? '还没有报告' : 'No report yet' }}</strong>
            <p>{{ language === 'zh' ? '输入一个商户、品类、Tier 或推荐问题，结果会显示在这里。' : 'Ask about a merchant, category, tier, or recommendation to see the result here.' }}</p>
          </div>
          <ChatAnswerActions
            v-if="reportHasAnswerActions"
            :language="language"
            :answer-id="answerId || ''"
            :can-open-deep="false"
            :feedback-state="feedbackState"
            :feedback="answerFeedback"
            :refresh-key="feedbackRefreshKey"
            @open="emit('open-answer', answerId || '')"
          />
          <FeedbackForm
            v-if="!reportHasAnswerActions"
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
            <div class="chat-stream-text">
              <div
                class="deep-summary-card"
                data-chatbot-report-summary
                role="button"
                tabindex="0"
                @click="openReportSummary"
                @keydown="handleReportSummaryKeydown"
              >
                <h4>{{ copy.summaryPrefix }}{{ result.query }}</h4>
                <p>{{ result.query }}</p>
                <small>{{ copy.summaryClick }}</small>
              </div>
            </div>
          </article>
          <article v-if="supplementalHtml" class="message assistant">
            <div class="chat-stream-text" data-chatbot-report-supplemental-chat v-html="supplementalHtml"></div>
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
            <ChatbotCommandMenu
              ref="commandMenu"
              :language="language"
              :input="prompt"
              mode="report"
              @select="selectCommand"
              @close="emit('update:prompt', prompt)"
            />
            <input
              id="chatbotReportInput"
              :value="prompt"
              :placeholder="copy.reportPlaceholder"
              :autofocus="autoFocus"
              autocomplete="off"
              data-chatbot-report-input
              @input="emit('update:prompt', ($event.target as HTMLInputElement).value)"
              @keydown="handleCommandKeydown"
            >
          </div>
          <button type="submit" class="chatbot-report-send" aria-label="Send" :disabled="loading" data-chatbot-action="report-submit">
            <span>{{ copy.ask }}</span>
          </button>
        </form>
      </section>
    </div>
  </section>
</template>
