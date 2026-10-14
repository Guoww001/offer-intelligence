<script setup lang="ts">
import type { UiLanguage } from "../../shared/i18n";
import type { AgentResultView as AgentResultViewModel } from "../../shared/contracts/agentResult";
import { resolveAgentResultComponent } from "./agentResultRegistry";

const props = defineProps<{
  readonly language: UiLanguage;
  readonly view: AgentResultViewModel;
  readonly expanded?: boolean;
}>();
</script>

<template>
  <article
    class="agent-modern-result"
    :data-result-id="view.id"
    :data-result-kind="view.kind"
    :data-result-status="view.status"
  >
    <component :is="resolveAgentResultComponent(view.kind)" :language="props.language" :view="props.view" v-bind="view.kind === 'trend' ? { expanded: props.expanded } : {}" />
  </article>
</template>
