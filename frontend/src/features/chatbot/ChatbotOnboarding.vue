<script setup lang="ts">
import { computed } from "vue";

import type { LegacyChatUtilityState } from "../../legacy/contracts";
import type { UiLanguage } from "../../shared/i18n";

const props = defineProps<{
  readonly language: UiLanguage;
  readonly utility: LegacyChatUtilityState;
  readonly available?: boolean;
}>();

const emit = defineEmits<{
  (event: "start"): void;
}>();

const copy = computed(() => props.language === "zh" ? {
  start: "新手引导",
  active: "正在进行新手引导",
  step: "第",
  of: "步，共",
  done: "完成"
} : {
  start: "First-time guide",
  active: "Onboarding in progress",
  step: "Step",
  of: "of",
  done: "done"
});
</script>

<template>
  <div class="chatbot-onboarding" data-chatbot-onboarding>
    <button v-if="available" type="button" class="mode-btn mode-onboarding" data-chatbot-action="onboarding" @click="emit('start')">
      <span aria-hidden="true">✦</span>
      <span>{{ copy.start }}</span>
    </button>
    <div v-if="utility.onboardingOpen" class="chatbot-onboarding-status" data-onboarding-status role="status">
      <strong>{{ copy.active }}</strong>
      <span>{{ copy.step }} {{ utility.onboardingStep + 1 }} {{ copy.of }} {{ utility.onboardingTotal }} {{ copy.done }}</span>
    </div>
  </div>
</template>
