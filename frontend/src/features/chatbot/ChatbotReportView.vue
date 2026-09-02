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
  (event: "download", downloadId: string): void;
}>();

const props = defineProps<{
  readonly language: UiLanguage;
  readonly prompt: string;
  readonly result: ChatbotReportViewResult | null;
  readonly loading: boolean;
  readonly error: string;
  readonly autoFocus?: boolean;
  readonly feedback?: LegacyFeedbackBridge;
  readonly feedbackRefreshKey?: number;
}>();

const copy = computed(() => props.language === "zh" ? {
  reportEyebrow: "REPORT MODE",
  reportTitle: "从一个数据问题开始",
  reportBody: "查询商户、品类、Tier 或推荐结果；结果会标明当前数据来源和缺失状态。",
  reportPlaceholder: "例如：查询 Tapo ID398679 的 EPC 和 conversion",
  ask: "生成报告",
  source: "数据来源",
  emptyTitle: "还没有报告",
  emptyBody: "输入一个商户、品类、Tier 或推荐问题，结果会显示在这里。",
  openDeep: "打开 Deep Window",
  addMemory: "加入对话"
} : {
  reportEyebrow: "REPORT MODE",
  reportTitle: "Start with a data question",
  reportBody: "Query a merchant, category, tier, or recommendation; each result shows its data source.",
  reportPlaceholder: "For example: find EPC and conversion for Tapo ID398679",
  ask: "Generate report",
  source: "Data source",
  emptyTitle: "No report yet",
  emptyBody: "Ask about a merchant, category, tier, or recommendation to start.",
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
</script>

<template>
  <section class="chatbot-report-view" data-chatbot-mode="report">
    <div class="chatbot-report-layout">
      <section class="chatbot-report-intro">
        <span class="chatbot-mode-eyebrow">{{ copy.reportEyebrow }}</span>
        <h2>{{ copy.reportTitle }}</h2>
        <p>{{ copy.reportBody }}</p>
        <form data-chatbot-report-form @submit.prevent="emit('submit')">
          <label class="sr-only" for="chatbotReportInput">{{ copy.reportTitle }}</label>
          <input
            id="chatbotReportInput"
            :value="prompt"
            :placeholder="copy.reportPlaceholder"
            :autofocus="autoFocus"
            data-chatbot-report-input
            @input="emit('update:prompt', ($event.target as HTMLInputElement).value)"
          >
          <button type="submit" :disabled="loading" data-chatbot-action="report-submit">{{ copy.ask }}</button>
        </form>
        <p v-if="error" class="chatbot-report-error" role="alert">{{ error }}</p>
      </section>
      <section class="chatbot-report-output" aria-live="polite">
        <div v-if="result" class="chatbot-report-output-head">
          <span data-chatbot-report-source>{{ sourceLabel }}</span>
          <div>
            <button type="button" data-chatbot-action="open-deep" @click="emit('open-deep')">{{ copy.openDeep }}</button>
            <button type="button" data-chatbot-action="add-memory" @click="emit('add-memory')">{{ copy.addMemory }}</button>
          </div>
        </div>
        <ChatbotResultView v-if="result" :language="language" :result="result" @download="emit('download', $event)" />
        <FeedbackForm
          :language="language"
          :feedback="feedback"
          :refresh-key="feedbackRefreshKey"
        />
        <div v-if="!result" class="chatbot-report-empty">
          <span class="chatbot-report-empty-mark" aria-hidden="true">▣</span>
          <strong>{{ copy.emptyTitle }}</strong>
          <p>{{ copy.emptyBody }}</p>
        </div>
      </section>
    </div>
  </section>
</template>
