import type { AgentRunStatus, AgentTimelinePhase, AgentTimelineStep } from "./agentModel";

/**
 * Explicit lifecycle phases for the Agent run.
 *
 * The legacy Python runner remains authoritative for what is executed.  This
 * reducer only models the UI lifecycle, so the Vue surface can render the
 * same planning/tool/replan/synthesis/stop transitions for either the legacy
 * bridge or a future CopilotKit transport.
 */
export type AgentRunPhase =
  | "idle"
  | "planning"
  | "tools"
  | "replan"
  | "synthesis"
  | "done"
  | "stopped"
  | "error";

export interface AgentRunLifecycleState {
  readonly runId: string | null;
  readonly status: AgentRunStatus;
  readonly phase: AgentRunPhase;
  readonly steps: readonly AgentTimelineStep[];
  readonly response: string;
  readonly partial: boolean;
  readonly omittedTargets: readonly string[];
  readonly errorCode: string | null;
}

export interface AgentRunSyncState {
  readonly status: AgentRunStatus;
  readonly phase?: AgentRunPhase;
  readonly steps?: readonly AgentTimelineStep[];
  readonly response?: string;
  readonly partial?: boolean;
  readonly omittedTargets?: readonly string[];
  readonly errorCode?: string | null;
  readonly runId?: string | null;
}

export type AgentRunLifecycleEvent =
  | { readonly type: "RUN_STARTED"; readonly runId?: string }
  | { readonly type: "PHASE_STARTED"; readonly phase: Exclude<AgentRunPhase, "idle" | "done" | "stopped" | "error">; readonly step?: AgentTimelineStep }
  | { readonly type: "STEP_UPDATED"; readonly step: AgentTimelineStep }
  | { readonly type: "TOKEN"; readonly token: string }
  | { readonly type: "PARTIAL"; readonly omittedTargets: readonly string[] }
  | { readonly type: "RUN_FINISHED"; readonly response: string; readonly steps?: readonly AgentTimelineStep[]; readonly partial?: boolean; readonly omittedTargets?: readonly string[] }
  | { readonly type: "RUN_STOPPED"; readonly response?: string }
  | { readonly type: "RUN_ERROR"; readonly errorCode?: string; readonly response?: string }
  | { readonly type: "STATE_SYNC"; readonly state: AgentRunSyncState }
  | { readonly type: "RESET" };

export function createAgentRunLifecycleState(): AgentRunLifecycleState {
  return {
    runId: null,
    status: "idle",
    phase: "idle",
    steps: [],
    response: "",
    partial: false,
    omittedTargets: [],
    errorCode: null
  };
}

function upsertStep(steps: readonly AgentTimelineStep[], step: AgentTimelineStep): readonly AgentTimelineStep[] {
  const index = steps.findIndex((item) => item.id === step.id);
  if (index < 0) return [...steps, step];
  return steps.map((item, itemIndex) => itemIndex === index ? step : item);
}

function phaseForStep(step: AgentTimelineStep | undefined): AgentRunPhase {
  if (!step) return "planning";
  return step.phase === "planning" ? "planning" : step.phase === "synthesis" ? "synthesis" : "tools";
}

function phaseForSyncedState(state: AgentRunSyncState): AgentRunPhase {
  if (state.phase) return state.phase;
  if (state.status !== "running") return state.status;
  const reversedSteps = [...(state.steps || [])].reverse();
  const activeStep = reversedSteps.find((step) => step.status === "running") || reversedSteps[0];
  return phaseForStep(activeStep);
}

/**
 * Reduce one lifecycle event.  Invalid late events are ignored, which keeps a
 * stopped/unmounted run from resurrecting the composer or appending tokens.
 */
export function reduceAgentRun(
  current: AgentRunLifecycleState,
  event: AgentRunLifecycleEvent
): AgentRunLifecycleState {
  switch (event.type) {
    case "RUN_STARTED":
      return {
        ...createAgentRunLifecycleState(),
        runId: event.runId || null,
        status: "running",
        phase: "planning"
      };
    case "PHASE_STARTED":
      if (current.status !== "running") return current;
      return {
        ...current,
        phase: event.phase,
        steps: event.step ? upsertStep(current.steps, event.step) : current.steps,
        errorCode: null
      };
    case "STEP_UPDATED":
      if (current.status !== "running") return current;
      return {
        ...current,
        phase: phaseForStep(event.step),
        steps: upsertStep(current.steps, event.step)
      };
    case "TOKEN":
      if (current.status !== "running" || !event.token) return current;
      return { ...current, response: `${current.response}${event.token}` };
    case "PARTIAL":
      if (current.status !== "running") return current;
      return {
        ...current,
        partial: true,
        omittedTargets: Array.from(new Set(event.omittedTargets.filter(Boolean))).slice(0, 20)
      };
    case "RUN_FINISHED":
      if (current.status !== "running") return current;
      return {
        ...current,
        status: "done",
        phase: "done",
        response: event.response,
        steps: event.steps?.length ? [...event.steps] : current.steps,
        partial: event.partial === undefined ? current.partial : event.partial === true,
        omittedTargets: event.omittedTargets === undefined
          ? current.omittedTargets
          : event.omittedTargets.filter(Boolean).slice(0, 20),
        errorCode: null
      };
    case "RUN_STOPPED":
      if (current.status !== "running") return current;
      return {
        ...current,
        status: "stopped",
        phase: "stopped",
        response: event.response ?? current.response,
        errorCode: "stopped_by_user"
      };
    case "RUN_ERROR":
      if (current.status !== "running") return current;
      return {
        ...current,
        status: "error",
        phase: "error",
        response: event.response ?? current.response,
        errorCode: event.errorCode || "agent_runtime_error"
      };
    case "STATE_SYNC":
      return {
        runId: event.state.runId === undefined ? current.runId : event.state.runId,
        status: event.state.status,
        phase: phaseForSyncedState(event.state),
        steps: event.state.steps ? [...event.state.steps] : current.steps,
        response: event.state.response ?? current.response,
        partial: event.state.partial === true,
        omittedTargets: (event.state.omittedTargets || []).filter(Boolean).slice(0, 20),
        errorCode: event.state.errorCode ?? null
      };
    case "RESET":
      return createAgentRunLifecycleState();
    default:
      return current;
  }
}
