import { markRaw, type Component } from "vue";

import AgentMetricResult from "./results/AgentMetricResult.vue";
import AgentStatusResult from "./results/AgentStatusResult.vue";
import AgentSummaryResult from "./results/AgentSummaryResult.vue";
import AgentTableResult from "./results/AgentTableResult.vue";
import type { AgentResultViewKind } from "../../shared/contracts/agentResult";

/**
 * Local component registry for structured result views.
 *
 * Components are marked raw so Vue does not proxy static component definitions.
 * The model returns only a small view model; it never returns executable
 * templates or HTML, which keeps rendering cheap and bounded.
 */
const RESULT_COMPONENTS: Readonly<Record<AgentResultViewKind, Component>> = Object.freeze({
  metric: markRaw(AgentMetricResult),
  table: markRaw(AgentTableResult),
  status: markRaw(AgentStatusResult),
  summary: markRaw(AgentSummaryResult)
});

export function resolveAgentResultComponent(kind: AgentResultViewKind): Component {
  return RESULT_COMPONENTS[kind] || RESULT_COMPONENTS.summary;
}

export function registeredAgentResultKinds(): readonly AgentResultViewKind[] {
  return Object.keys(RESULT_COMPONENTS) as AgentResultViewKind[];
}
