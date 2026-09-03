/**
 * Safe, render-ready projections of Agent tool results.
 *
 * This contract deliberately excludes raw tool arguments, provider payloads,
 * plan proofs, and arbitrary HTML.  A backend action may project its result
 * into this shape; Vue then chooses a local component from the registry.
 */
export type AgentResultViewKind = "metric" | "table" | "status" | "summary";
export type AgentResultViewStatus = "running" | "done" | "partial" | "error";
export type AgentResultDataSource = "cache" | "database" | "mixed" | "unavailable" | "unknown";

export interface AgentResultMetric {
  readonly label: string;
  readonly value: string;
  readonly delta?: string;
}

export interface AgentResultRow {
  readonly label: string;
  readonly values: readonly string[];
}

export interface AgentResultView {
  readonly id: string;
  readonly toolName: string;
  readonly kind: AgentResultViewKind;
  readonly status: AgentResultViewStatus;
  readonly title: string;
  readonly source: AgentResultDataSource;
  readonly dataAsOf: string | null;
  readonly estimated: boolean;
  readonly partial: boolean;
  readonly metrics: readonly AgentResultMetric[];
  readonly columns: readonly string[];
  readonly rows: readonly AgentResultRow[];
  readonly message: string;
}

const KINDS = new Set<AgentResultViewKind>(["metric", "table", "status", "summary"]);
const STATUSES = new Set<AgentResultViewStatus>(["running", "done", "partial", "error"]);
const SOURCES = new Set<AgentResultDataSource>(["cache", "database", "mixed", "unavailable", "unknown"]);

function text(value: unknown, max: number): string {
  // Keep the projection text-only even before Vue escapes interpolation.
  return String(value ?? "").replace(/<[^>]*>/g, "").trim().slice(0, max);
}

function safeList(value: unknown, limit: number, max: number): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(value) ? value : []) {
    const next = text(item, max);
    const key = next.toLowerCase();
    if (!next || seen.has(key) || result.length >= limit) continue;
    seen.add(key);
    result.push(next);
  }
  return result;
}

function boundedValues(value: unknown, limit: number, max: number): string[] {
  return (Array.isArray(value) ? value : [])
    .map((item) => text(item, max))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeMetrics(value: unknown): AgentResultMetric[] {
  const result: AgentResultMetric[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const label = text(record.label || record.name, 80);
    const metricValue = text(record.value, 80);
    if (!label || !metricValue || result.length >= 8) continue;
    const delta = text(record.delta, 48);
    result.push({ label, value: metricValue, ...(delta ? { delta } : {}) });
  }
  return result;
}

function normalizeRows(value: unknown): AgentResultRow[] {
  const result: AgentResultRow[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const label = text(record.label || record.name, 120);
    // Preserve positional duplicates: values map one-to-one to columns.
    const values = boundedValues(record.values, 8, 120);
    if (!label || !values.length || result.length >= 16) continue;
    result.push({ label, values });
  }
  return result;
}

/**
 * Normalize an untrusted result view into a bounded, text-only projection.
 * Invalid views are ignored by callers instead of reaching the DOM.
 */
export function normalizeAgentResultView(value: unknown): AgentResultView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = text(record.id, 120);
  const toolName = text(record.toolName || record.tool, 64);
  const kind = text(record.kind, 16) as AgentResultViewKind;
  const status = text(record.status, 16) as AgentResultViewStatus;
  const title = text(record.title, 180);
  if (!id || !toolName || !KINDS.has(kind) || !STATUSES.has(status) || !title) return null;
  const rawSource = text(record.source || record.dataSource, 16);
  const source = (rawSource === "db" ? "database" : rawSource) as AgentResultDataSource;
  const dataAsOf = text(record.dataAsOf, 48) || null;
  const metrics = normalizeMetrics(record.metrics);
  const columns = safeList(record.columns, 8, 80);
  const rows = normalizeRows(record.rows);
  const message = text(record.message, 800);
  return {
    id,
    toolName,
    kind,
    status,
    title,
    source: SOURCES.has(source) ? source : "unknown",
    dataAsOf,
    estimated: record.estimated === true,
    partial: record.partial === true || status === "partial",
    metrics,
    columns,
    rows,
    message
  };
}

export function normalizeAgentResultViews(value: unknown, limit = 8): AgentResultView[] {
  const result: AgentResultView[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(value) ? value : []) {
    const view = normalizeAgentResultView(item);
    if (!view || seen.has(view.id) || result.length >= limit) continue;
    seen.add(view.id);
    result.push(view);
  }
  return result;
}
