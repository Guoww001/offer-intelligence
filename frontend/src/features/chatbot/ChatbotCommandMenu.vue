<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";

import type { UiLanguage } from "../../shared/i18n";

interface CommandOption {
  readonly key: string;
  readonly intent: string;
  readonly zh: string;
  readonly en: string;
  readonly zhHint: string;
  readonly enHint: string;
}

const OPTIONS: readonly CommandOption[] = [
  { key: "merchant", intent: "merchant", zh: "商户", en: "Merchant", zhHint: "商户查询", enHint: "Merchant lookup" },
  { key: "category", intent: "category", zh: "品类", en: "Category", zhHint: "品类查询", enHint: "Category lookup" },
  { key: "tier", intent: "tier", zh: "Tier", en: "Tier", zhHint: "Tier 概览", enHint: "Tier overview" },
  { key: "categorytier", intent: "category", zh: "品类 + Tier", en: "Category & Tier", zhHint: "某 Tier 内的品类查询", enHint: "Category within a tier" },
  { key: "trend", intent: "analysis", zh: "趋势", en: "Trend", zhHint: "趋势分析", enHint: "Trend analysis" },
  { key: "payment", intent: "payment", zh: "付款", en: "Payment", zhHint: "付款状态", enHint: "Payment status" },
  { key: "asin", intent: "asin", zh: "ASIN", en: "ASIN", zhHint: "ASIN 查询", enHint: "ASIN lookup" },
  { key: "publisher", intent: "publisher", zh: "媒体", en: "Publisher", zhHint: "媒体记录查询", enHint: "Publisher records" },
  { key: "publisherprofile", intent: "publisherprofile", zh: "媒体画像", en: "Publisher profile", zhHint: "媒体画像", enHint: "Publisher profile" }
];

const props = withDefaults(defineProps<{
  readonly language: UiLanguage;
  readonly input: string;
  readonly mode?: "report" | "chat";
  readonly options?: readonly Omit<CommandOption, "intent">[];
}>(), { mode: "report" });

const emit = defineEmits<{
  (event: "select", key: string): void;
  (event: "close"): void;
}>();

const activeIndex = ref(0);
const menuId = useId();
const menuRef = ref<HTMLElement>();
const options = computed(() => (props.options || OPTIONS).filter((option) => !props.options || `${option.key} ${option.zh} ${option.en}`.toLowerCase().includes(props.input.trim().slice(1).toLowerCase())));
const open = computed(() => props.mode === "report" && /^\s*\/[^\s/]*$/.test(props.input));
const dismissed = ref(false);
const visible = computed(() => open.value && !dismissed.value);

watch(open, (isOpen) => {
  if (isOpen) {
    dismissed.value = false;
    activeIndex.value = 0;
  }
});

watch(() => props.input, (next, previous) => {
  if (next !== previous) { dismissed.value = false; activeIndex.value = 0; }
});

function optionLabel(option: Omit<CommandOption, "intent">): string {
  return props.language === "zh" ? option.zh : option.en;
}

function optionHint(option: Omit<CommandOption, "intent">): string {
  return props.language === "zh" ? option.zhHint : option.enHint;
}

function select(option: Omit<CommandOption, "intent">): void {
  emit("select", option.key);
}

function handleKeydown(event: KeyboardEvent): void {
  if (!visible.value || event.isComposing || event.keyCode === 229) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    activeIndex.value = options.value.length ? (activeIndex.value + direction + options.value.length) % options.value.length : 0;
    nextTick(() => menuRef.value?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" }));
  } else if (event.key === "Enter") {
    event.preventDefault();
    const option = options.value[activeIndex.value];
    if (option) select(option);
  } else if (event.key === "Escape") {
    event.preventDefault();
    dismissed.value = true;
    emit("close");
  }
}

defineExpose({ handleKeydown, visible, menuId, activeId: computed(() => visible.value && options.value.length ? `${menuId}-${activeIndex.value}` : undefined) });
</script>

<template>
  <div v-if="visible" :id="menuId" ref="menuRef" class="chatbot-command-menu chat-intent-menu" data-chatbot-command-menu role="listbox" :aria-label="language === 'zh' ? '选择命令' : 'Choose command'">
    <div class="chat-intent-menu-title" role="presentation">
      <span>{{ language === "zh" ? "提问类型" : "Question type" }}</span>
      <kbd>/</kbd>
    </div>
    <button
      v-for="(option, index) in options"
      :id="`${menuId}-${index}`"
      :key="option.key"
      type="button"
      class="chatbot-command-option chat-intent-option"
      :class="{ active: index === activeIndex }"
      :data-chat-intent="option.key"
      :data-command-intent="'intent' in option ? option.intent : option.key"
      :aria-selected="index === activeIndex"
      role="option"
      @mousedown.prevent
      @click="select(option)"
    >
      <span class="chat-intent-option-prefix chatbot-command-slash" aria-hidden="true">{{ props.options ? '/' + option.key : ':' }}</span>
      <span class="chat-intent-option-label">{{ optionLabel(option) }}</span>
      <span class="chat-intent-option-hint">{{ optionHint(option) }}</span>
    </button>
    <p v-if="!options.length" class="aw-command-empty">{{ language === 'zh' ? '没有匹配的命令' : 'No matching commands' }}</p>
  </div>
</template>
