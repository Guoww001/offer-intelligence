import type { UiLanguage } from "../../shared/i18n";
import type { AgentTimelineStepStatus } from "./agentModel";

export interface AgentNativeToolStep {
  readonly callId: string;
  readonly toolName: string;
  readonly status: AgentTimelineStepStatus;
  readonly errorCode?: unknown;
}

const tools = new Set(["merchant_analysis", "category_analysis", "merchant_comparison", "tier_analysis", "category_comparison", "payment_status", "trend", "asin_analysis", "keyword_search", "promotion_analysis"]);
const errors = new Set(["unknown", "validation_error", "request_error", "network_error", "database_error", "llm_unavailable", "llm_timeout", "provider_error", "tool_error", "tool_timeout", "synthesis_unavailable", "no_verifiable_source", "agent_plan_truncated", "agent_no_tool_plan", "agent_planning_unavailable", "stopped_by_user", "trace_write_failed"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, part => {
    const digit = Math.floor(Math.random() * 16);
    return (part === "x" ? digit : (digit & 3) | 8).toString(16);
  });
}

function sessionId(storage?: Storage): string {
  try {
    const saved = storage?.getItem("oi_agent_session_v1") || "";
    if (/^[A-Za-z0-9._:-]{16,64}$/.test(saved)) return saved;
    const created = `agent-${uuid().replace(/-/g, "")}`;
    storage?.setItem("oi_agent_session_v1", created);
    return created;
  } catch { return `agent-${uuid().replace(/-/g, "")}`; }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function errorCode(value: unknown, fallback: string): string {
  return typeof value === "string" && errors.has(value) ? value : fallback;
}

interface TraceStep {
  readonly stepId: string;
  readonly phase: "planning" | "tool" | "synthesis";
  readonly startedAt: number;
  completedAt?: number;
  toolName?: string;
  status: AgentTimelineStepStatus;
  errorCode?: string;
  sent?: boolean;
}

export function createAgentNativeTrace(options: {
  readonly questionEventId?: string;
  readonly language: UiLanguage;
  readonly storage?: Storage;
  readonly fetcher?: typeof fetch;
  readonly now?: () => number;
}) {
  const now = options.now || Date.now;
  const startedAt = now();
  const fetcher = options.fetcher || fetch;
  const context = { runId: uuid(), questionEventId: options.questionEventId, sessionId: sessionId(options.storage) };
  const enabled = uuidPattern.test(options.questionEventId || "");
  const steps = new Map<string, TraceStep>();
  const planned = new Map<string, string>();
  const executed = new Set<string>();
  const failed = new Set<string>();
  let active = false;
  let completed = false;
  let queue = Promise.resolve();
  let sequence = 0;

  function enqueue(body: Record<string, unknown>): void {
    if (!enabled) return;
    queue = queue.then(async () => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // 单次写入有独立时限，既不绑定回答信号，也不等待回答流程。
        await Promise.race([
          fetcher("/api/chat/stream?operation=agent_trace", {
            method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
            headers: { Accept: "application/json", "Content-Type": "application/json; charset=utf-8" },
            body: JSON.stringify({ ...context, ...body })
          }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("trace_write_failed")); }, 10_000); })
        ]);
      } catch { /* Trace 故障不改变原生运行状态。 */ }
      finally { if (timer !== undefined) clearTimeout(timer); }
    }).catch(() => undefined);
  }

  function flushSteps(): void {
    if (!active || completed) return;
    for (const step of steps.values()) {
      if (step.status === "running" || step.sent) continue;
      step.sent = true;
      enqueue({ action: "append", steps: [{
        stepId: step.stepId, runId: context.runId, questionEventId: context.questionEventId, sequence: ++sequence,
        phase: step.phase, toolName: step.toolName || null,
        status: step.status === "done" ? "success" : step.status === "error" ? "failed" : step.status,
        startedAt: new Date(step.startedAt).toISOString(), completedAt: new Date(step.completedAt ?? now()).toISOString(),
        durationMs: Math.max(0, (step.completedAt ?? now()) - step.startedAt),
        errorCode: step.errorCode || null, usageAvailable: false, inputTokens: null, outputTokens: null, totalTokens: null,
        retryCount: 0
      }] });
    }
  }

  function activate(): void {
    if (active || completed) return;
    active = true;
    enqueue({ action: "start", mode: "agent", language: options.language, startedAt: new Date(startedAt).toISOString(),
      planningBypassed: false, partial: false, fallbackDelivered: false, stoppedByUser: false,
      plannedToolCalls: 0, executedToolCalls: 0, failedToolCalls: 0 });
    flushSteps();
  }

  function observeStep(value: unknown): void {
    if (completed) return;
    const raw = record(value);
    if (!raw || !["planning", "tool", "synthesis"].includes(String(raw.phase)) || !["running", "done", "error", "stopped", "timeout"].includes(String(raw.status))) return;
    const id = typeof raw.id === "string" ? raw.id.slice(0, 128) : "";
    if (!id) return;
    const phase = raw.phase as TraceStep["phase"];
    const key = `${phase}:${id}`;
    const previous = steps.get(key);
    if (previous && previous.status !== "running") return;
    if (!previous && steps.size >= 64) return;
    const status = raw.status as AgentTimelineStepStatus;
    steps.set(key, { stepId: previous?.stepId || uuid(), phase, startedAt: previous?.startedAt ?? now(), status,
      ...(phase === "tool" && planned.has(id) ? { toolName: planned.get(id) } : {}),
      ...(status !== "running" ? { completedAt: now() } : {}),
      ...(status === "error" ? { errorCode: errorCode(raw.errorCode ?? raw.detail, phase === "tool" ? "tool_error" : phase === "planning" ? "agent_planning_unavailable" : "synthesis_unavailable") }
        : status === "timeout" ? { errorCode: phase === "tool" ? "tool_timeout" : "llm_timeout" }
          : status === "stopped" ? { errorCode: "stopped_by_user" } : {}) });
    flushSteps();
  }

  function observePlanningState(value: unknown): void {
    if (completed) return;
    const raw = record(value);
    for (const value of Array.isArray(raw?.calls) ? raw.calls.slice(0, 6) : []) {
      const call = record(value);
      if (typeof call?.id === "string" && typeof call.name === "string" && tools.has(call.name)) planned.set(call.id.slice(0, 128), call.name);
    }
    if (raw?.agentRunId) {
      observeStep({ id: "planning", phase: "planning", status: "done" });
      activate();
    }
  }

  function observeTool(step: AgentNativeToolStep): void {
    if (completed || !tools.has(step.toolName)) return;
    const id = step.callId.slice(0, 128);
    planned.set(id, step.toolName);
    executed.add(id);
    if (step.status === "error" || step.status === "timeout") failed.add(id);
    activate();
    observeStep({ id, phase: "tool", status: step.status, errorCode: step.errorCode });
  }

  function complete(result: { readonly status: "done" | "error" | "stopped"; readonly partial?: boolean; readonly fallbackDelivered?: boolean; readonly errorCode?: unknown }): void {
    if (completed) return;
    activate();
    for (const [key, step] of steps) if (step.status === "running") {
      const status = result.status === "stopped" ? "stopped" : result.status === "error" ? "error" : "done";
      observeStep({ id: key.slice(key.indexOf(":") + 1), phase: step.phase, status, errorCode: result.errorCode });
    }
    flushSteps();
    completed = true;
    enqueue({ action: "complete", mode: "agent", language: options.language,
      status: result.status === "done" ? "success" : result.status === "stopped" ? "stopped" : "failed",
      completedAt: new Date(now()).toISOString(), durationMs: Math.max(0, now() - startedAt),
      partial: result.partial === true, fallbackDelivered: result.fallbackDelivered === true, stoppedByUser: result.status === "stopped",
      plannedToolCalls: planned.size, executedToolCalls: executed.size, failedToolCalls: failed.size,
      errorCode: result.status === "stopped" ? "stopped_by_user" : result.errorCode ? errorCode(result.errorCode, "unknown") : null });
  }

  // 规划可能转入已有备用执行，确认原生链拥有本轮之后才发送缓存摘要。
  observeStep({ id: "planning", phase: "planning", status: "running" });
  return { observeStep, observePlanningState, observeTool, complete };
}
