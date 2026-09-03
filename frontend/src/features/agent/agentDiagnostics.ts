import type { AgentRunRequest, AgentRunResult } from "./AgentPage.vue";
import { normalizeAgentMemory, normalizeAgentTimelineStep } from "./agentModel";

export const DIAGNOSTIC_LIMIT = 512 * 1024;
export interface AgentDiagnosticTurn {
  prompt: string;
  language: "zh" | "en";
  history: { role: "user" | "assistant"; content: string }[];
  memory: ReturnType<typeof normalizeAgentMemory>;
  response: string;
  status: "done" | "error" | "stopped";
  errorCode: string;
  steps: ReturnType<typeof normalizeAgentTimelineStep>[];
}
export interface AgentDiagnosticLog { version: 1; turns: AgentDiagnosticTurn[] }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_log");
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum) throw new Error("invalid_log");
  return value;
}
// Export only request context, visible answers and normalized execution steps.
// No HTML, cookies, proof tokens, raw tool payloads or provider errors.
export function normalizeDiagnosticLog(value: unknown): AgentDiagnosticLog {
  const log = record(value);
  if (log.version !== 1 || !Array.isArray(log.turns) || !log.turns.length || log.turns.length > 10) throw new Error("invalid_log");
  const turns = log.turns.map((value) => {
    const turn = record(value);
    if (!["zh", "en"].includes(String(turn.language)) || !["done", "error", "stopped"].includes(String(turn.status))) throw new Error("invalid_log");
    if (!Array.isArray(turn.history) || turn.history.length > 40 || !Array.isArray(turn.steps) || turn.steps.length > 64) throw new Error("invalid_log");
    return {
      prompt: text(turn.prompt, 16000), language: turn.language as "zh" | "en",
      history: turn.history.map((value) => { const message = record(value); if (!["user", "assistant"].includes(String(message.role))) throw new Error("invalid_log"); return { role: message.role as "user" | "assistant", content: text(message.content, 24000) }; }),
      memory: normalizeAgentMemory(turn.memory), response: text(turn.response, 64000), status: turn.status as AgentDiagnosticTurn["status"],
      errorCode: text(turn.errorCode || "", 80).replace(/[^a-zA-Z0-9_-]/g, ""),
      steps: turn.steps.map(normalizeAgentTimelineStep)
    };
  });
  const normalized: AgentDiagnosticLog = { version: 1, turns };
  if (new TextEncoder().encode(JSON.stringify(normalized)).byteLength > DIAGNOSTIC_LIMIT) throw new Error("log_too_large");
  return normalized;
}
export function diagnosticTurn(request: AgentRunRequest, result: AgentRunResult): AgentDiagnosticTurn {
  return normalizeDiagnosticLog({ version: 1, turns: [{ prompt: request.prompt.slice(0, 16000), language: request.language,
    history: request.history.slice(-4).map(({ role, content }) => ({ role, content: content.slice(0, 24000) })),
    memory: request.memory, response: result.response.slice(0, 64000), status: result.status, errorCode: result.errorCode || "", steps: result.steps.slice(0, 64) }] }).turns[0]!;
}
export function appendDiagnosticTurn(turns: AgentDiagnosticTurn[], turn: AgentDiagnosticTurn): AgentDiagnosticTurn[] {
  const next = [...turns, turn].slice(-10);
  while (next.length > 1 && new TextEncoder().encode(JSON.stringify({ version: 1, turns: next })).byteLength > DIAGNOSTIC_LIMIT) next.shift();
  return next;
}
