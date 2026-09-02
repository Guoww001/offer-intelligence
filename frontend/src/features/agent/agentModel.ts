export type AgentRunStatus = "idle" | "running" | "done" | "stopped" | "error";
export type AgentTimelinePhase = "planning" | "tool" | "synthesis";
export type AgentTimelineStepStatus = "running" | "done" | "error" | "stopped" | "timeout";

export interface AgentTimelineStep {
  readonly id: string;
  readonly phase: AgentTimelinePhase;
  readonly status: AgentTimelineStepStatus;
  readonly label: string;
  readonly detail?: string;
  readonly elapsedMs?: number;
  readonly dataSource?: "cache" | "database" | "mixed" | "unavailable" | "unknown";
  readonly dataAsOf?: string | null;
  readonly estimated?: boolean;
}

export interface AgentMemoryEntity {
  readonly id?: string;
  readonly name: string;
}

export type AgentMemoryEntityType = "merchant" | "category" | "tier";

export interface AgentMemoryCandidate extends AgentMemoryEntity {
  readonly type: AgentMemoryEntityType;
}

export interface AgentMemoryState {
  readonly version: 1;
  readonly updatedAt: string;
  readonly focus: {
    readonly merchants: readonly AgentMemoryEntity[];
    readonly categories: readonly string[];
    readonly tiers: readonly string[];
  };
  readonly query: {
    readonly startMonth: string | null;
    readonly endMonth: string | null;
    readonly months: number | null;
    readonly metrics: readonly string[];
  };
  readonly lastTool: {
    readonly toolName: string;
    readonly headline: string;
    readonly dataSource: "cache" | "database" | "mixed" | "unknown";
    readonly dataAsOf: string | null;
    readonly estimated: boolean;
    readonly partial: boolean;
  } | null;
  readonly candidates: {
    readonly pending: readonly AgentMemoryCandidate[];
    readonly confirmed: readonly AgentMemoryCandidate[];
    readonly rejected: readonly AgentMemoryCandidate[];
  };
}

type AgentMemoryDataSource = NonNullable<AgentMemoryState["lastTool"]>["dataSource"];

export interface AgentMemoryEvent {
  readonly kind: "tool_success" | "candidates";
  readonly focus?: {
    readonly merchants?: readonly AgentMemoryEntity[];
    readonly categories?: readonly string[];
    readonly tiers?: readonly string[];
  };
  readonly query?: {
    readonly startMonth?: string | null;
    readonly endMonth?: string | null;
    readonly months?: number | null;
    readonly metrics?: readonly string[];
  };
  readonly lastTool?: Partial<NonNullable<AgentMemoryState["lastTool"]>>;
  readonly candidates?: readonly AgentMemoryCandidate[];
  readonly resolvedEntities?: readonly AgentMemoryCandidate[];
}

export interface AgentRunState {
  readonly status: AgentRunStatus;
  readonly steps: readonly AgentTimelineStep[];
  readonly response: string;
  readonly partial: boolean;
  readonly omittedTargets: readonly string[];
  readonly memory: AgentMemoryState;
}

const STORAGE_KEY = "oi_agent_memory_v1";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SOURCE_VALUES = new Set(["cache", "database", "mixed", "unknown"]);

function text(value: unknown, max = 240): string {
  return String(value ?? "").trim().slice(0, max);
}

function uniqueStrings(values: readonly unknown[] | undefined, limit: number, max = 120): string[] {
  const seen = new Set<string>();
  return (Array.isArray(values) ? values : []).map((item) => text(item, max)).filter((item) => {
    const key = item.toLowerCase();
    if (!item || seen.has(key) || seen.size >= limit) return false;
    seen.add(key);
    return true;
  });
}

function validMonth(value: unknown): string | null {
  const month = text(value, 7);
  return /^20\d{2}-(0[1-9]|1[0-2])$/.test(month) ? month : null;
}

function normalizeEntities(values: readonly unknown[] | undefined, limit: number): AgentMemoryEntity[] {
  const seen = new Set<string>();
  const result: AgentMemoryEntity[] = [];
  for (const item of Array.isArray(values) ? values : []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const id = text(record.id, 80);
    const name = text(record.name || record.merchantName || record.merchant, 120);
    if (!id && !name) continue;
    const key = `${id}:${name}`.toLowerCase();
    if (seen.has(key) || result.length >= limit) continue;
    seen.add(key);
    result.push({ ...(id ? { id } : {}), name: name || id });
  }
  return result;
}

function normalizeCandidates(values: readonly unknown[] | undefined, limit: number): AgentMemoryCandidate[] {
  const seen = new Set<string>();
  const result: AgentMemoryCandidate[] = [];
  for (const item of Array.isArray(values) ? values : []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const rawType = text(record.type, 16);
    const type: AgentMemoryEntityType = rawType === "category" || rawType === "tier" ? rawType : "merchant";
    const id = text(record.id, 80);
    const name = text(record.name || record.merchantName || record.merchant, 120);
    if (!id && !name) continue;
    const key = `${type}:${id || name}`.toLowerCase();
    if (seen.has(key) || result.length >= limit) continue;
    seen.add(key);
    result.push({ type, ...(id ? { id } : {}), name: name || id });
  }
  return result;
}

function normalizeLastTool(value: unknown): AgentMemoryState["lastTool"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = text((value as Record<string, unknown>).dataSource, 16);
  const toolName = text((value as Record<string, unknown>).toolName, 48);
  const headline = text((value as Record<string, unknown>).headline, 240);
  if (!toolName && !headline) return null;
  return {
    toolName,
    headline,
    dataSource: SOURCE_VALUES.has(source) && source !== "unavailable" ? source as AgentMemoryDataSource : "unknown",
    dataAsOf: text((value as Record<string, unknown>).dataAsOf, 40) || null,
    estimated: (value as Record<string, unknown>).estimated === true,
    partial: (value as Record<string, unknown>).partial === true
  };
}

export function emptyAgentMemory(now = Date.now()): AgentMemoryState {
  return {
    version: 1,
    updatedAt: new Date(now).toISOString(),
    focus: { merchants: [], categories: [], tiers: [] },
    query: { startMonth: null, endMonth: null, months: null, metrics: [] },
    lastTool: null,
    candidates: { pending: [], confirmed: [], rejected: [] }
  };
}

export function normalizeAgentMemory(value: unknown, now = Date.now()): AgentMemoryState {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const focus = source.focus && typeof source.focus === "object" ? source.focus as Record<string, unknown> : {};
  const query = source.query && typeof source.query === "object" ? source.query as Record<string, unknown> : {};
  const candidates = source.candidates && typeof source.candidates === "object"
    ? source.candidates as Record<string, unknown> : {};
  const updatedAt = Date.parse(text(source.updatedAt, 40));
  const months = Number(query.months);
  return {
    version: 1,
    updatedAt: Number.isFinite(updatedAt) ? new Date(updatedAt).toISOString() : new Date(now).toISOString(),
    focus: {
      merchants: normalizeEntities(focus.merchants as readonly unknown[] | undefined, 5),
      categories: uniqueStrings(focus.categories as readonly unknown[] | undefined, 4),
      tiers: uniqueStrings(focus.tiers as readonly unknown[] | undefined, 5, 40)
    },
    query: {
      startMonth: validMonth(query.startMonth),
      endMonth: validMonth(query.endMonth),
      months: Number.isInteger(months) && months >= 1 && months <= 24 ? months : null,
      metrics: uniqueStrings(query.metrics as readonly unknown[] | undefined, 12, 40)
    },
    lastTool: normalizeLastTool(source.lastTool),
    candidates: {
      pending: normalizeCandidates(candidates.pending as readonly unknown[] | undefined, 10),
      confirmed: normalizeCandidates(candidates.confirmed as readonly unknown[] | undefined, 10),
      rejected: normalizeCandidates(candidates.rejected as readonly unknown[] | undefined, 10)
    }
  };
}

function mergeQuery(current: AgentMemoryState["query"], incoming: AgentMemoryEvent["query"]): AgentMemoryState["query"] {
  const starts = [current.startMonth, validMonth(incoming?.startMonth)].filter((item): item is string => Boolean(item)).sort();
  const ends = [current.endMonth, validMonth(incoming?.endMonth)].filter((item): item is string => Boolean(item)).sort();
  return {
    startMonth: starts[0] || null,
    endMonth: ends[ends.length - 1] || null,
    months: Number.isInteger(incoming?.months) && Number(incoming?.months) >= 1 && Number(incoming?.months) <= 24
      ? Number(incoming?.months) : current.months,
    metrics: uniqueStrings([...current.metrics, ...(incoming?.metrics || [])], 12, 40)
  };
}

export function applyAgentMemoryEvents(
  current: AgentMemoryState,
  events: readonly AgentMemoryEvent[],
  now = Date.now()
): AgentMemoryState {
  let next = normalizeAgentMemory(current, now);
  if ((Array.isArray(events) ? events : []).some((event) => event?.kind === "tool_success")) {
    next = {
      ...next,
      focus: { merchants: [], categories: [], tiers: [] },
      query: { startMonth: null, endMonth: null, months: null, metrics: [] }
    };
  }
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event !== "object") continue;
    if (event.kind === "candidates") {
      next = {
        ...next,
        candidates: {
          ...next.candidates,
          pending: normalizeCandidates(event.candidates, 10)
        }
      };
      continue;
    }
    if (event.kind !== "tool_success") continue;
    const focus = event.focus || {};
    const selected = normalizeCandidates(event.resolvedEntities, 10);
    const pending = next.candidates.pending;
    const selectedKeys = new Set(selected.map((item) => `${item.type}:${item.id || item.name}`.toLowerCase()));
    const selectedFromPending = pending.some((item) => selectedKeys.has(`${item.type}:${item.id || item.name}`.toLowerCase()));
    next = {
      ...next,
      focus: {
        merchants: normalizeEntities([...next.focus.merchants, ...(focus.merchants || [])], 5),
        categories: uniqueStrings([...next.focus.categories, ...(focus.categories || [])], 4),
        tiers: uniqueStrings([...next.focus.tiers, ...(focus.tiers || [])], 5, 40)
      },
      query: mergeQuery(next.query, event.query),
      lastTool: normalizeLastTool(event.lastTool) || next.lastTool,
      candidates: {
        pending: selectedFromPending ? [] : pending,
        confirmed: normalizeCandidates([...next.candidates.confirmed, ...selected], 10),
        rejected: selectedFromPending
          ? normalizeCandidates([...next.candidates.rejected, ...pending.filter((item) => !selectedKeys.has(`${item.type}:${item.id || item.name}`.toLowerCase()))], 10)
          : next.candidates.rejected
      }
    };
  }
  return normalizeAgentMemory({ ...next, updatedAt: new Date(now).toISOString() }, now);
}

export function agentMemoryDisplayText(memory: AgentMemoryState, language: "zh" | "en"): string {
  const state = normalizeAgentMemory(memory);
  const items = [
    ...state.focus.merchants.map((item) => item.name),
    ...state.focus.categories,
    ...state.focus.tiers,
    state.query.startMonth || state.query.endMonth || (state.query.months ? `${state.query.months} months` : ""),
    ...state.query.metrics
  ].filter(Boolean);
  if (!items.length && state.candidates.pending.length) {
    items.push(`${language === "zh" ? "待确认候选：" : "Pending candidates: "}${state.candidates.pending.map((item) => item.name).join(language === "zh" ? "、" : ", ")}`);
  }
  return items.length
    ? `${language === "zh" ? "已恢复上下文：" : "Restored context: "}${items.join(language === "zh" ? " · " : " · ")}`.slice(0, 360)
    : "";
}

export function agentMemoryPromptText(memory: AgentMemoryState, language: "zh" | "en"): string {
  const display = agentMemoryDisplayText(memory, language);
  if (!display) return "";
  return `[Agent structured memory]\n${display}\n${language === "zh"
    ? "这些上下文只用于消解指代；涉及当前数值时必须重新调用数据工具。"
    : "Use this context only to resolve references; run a data tool for current numeric values."}`;
}

export function loadAgentMemory(storage: Storage | undefined, now = Date.now()): AgentMemoryState {
  if (!storage) return emptyAgentMemory(now);
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw || raw.length > 12_000) return emptyAgentMemory(now);
    const parsed: unknown = JSON.parse(raw);
    const normalized = normalizeAgentMemory(parsed, now);
    const updatedAt = Date.parse(normalized.updatedAt);
    if (parsed && typeof parsed === "object" && (parsed as Record<string, unknown>).version === 1
      && Number.isFinite(updatedAt) && now - updatedAt <= MAX_AGE_MS && updatedAt <= now + 60_000) return normalized;
  } catch {
    // 不可用或损坏的本地记忆按空上下文处理。
  }
  try { storage.removeItem(STORAGE_KEY); } catch { /* ignore storage failures */ }
  return emptyAgentMemory(now);
}

export function saveAgentMemory(storage: Storage | undefined, memory: AgentMemoryState, now = Date.now()): boolean {
  if (!storage) return false;
  const normalized = normalizeAgentMemory({ ...memory, updatedAt: new Date(now).toISOString() }, now);
  const meaningful = normalized.focus.merchants.length || normalized.focus.categories.length
    || normalized.focus.tiers.length || normalized.query.metrics.length || normalized.lastTool
    || normalized.candidates.pending.length || normalized.candidates.confirmed.length || normalized.candidates.rejected.length;
  if (!meaningful) {
    try { storage.removeItem(STORAGE_KEY); } catch { /* ignore storage failures */ }
    return true;
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

export function clearAgentMemory(storage: Storage | undefined): void {
  try { storage?.removeItem(STORAGE_KEY); } catch { /* ignore storage failures */ }
}

export function normalizeAgentTimelineStep(value: unknown): AgentTimelineStep {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const phase = ["planning", "tool", "synthesis"].includes(String(source.phase))
    ? String(source.phase) as AgentTimelinePhase : "tool";
  const status = ["running", "done", "error", "stopped", "timeout"].includes(String(source.status))
    ? String(source.status) as AgentTimelineStepStatus : "error";
  const elapsed = Number(source.elapsedMs);
  const dataSource = text(source.dataSource, 16);
  return {
    id: text(source.id, 100) || `${phase}-${status}`,
    phase,
    status,
    label: text(source.label, 120),
    ...(text(source.detail, 240) ? { detail: text(source.detail, 240) } : {}),
    ...(Number.isFinite(elapsed) && elapsed >= 0 ? { elapsedMs: Math.min(elapsed, 3_600_000) } : {}),
    ...(SOURCE_VALUES.has(dataSource) ? { dataSource: dataSource as AgentTimelineStep["dataSource"] } : {}),
    ...(text(source.dataAsOf, 40) ? { dataAsOf: text(source.dataAsOf, 40) } : {}),
    ...(source.estimated === true ? { estimated: true } : {})
  };
}

export function createAgentRunState(now = Date.now()): AgentRunState {
  return { status: "idle", steps: [], response: "", partial: false, omittedTargets: [], memory: emptyAgentMemory(now) };
}
