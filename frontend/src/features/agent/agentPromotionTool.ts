import type { AgentResultView } from "../../shared/contracts/agentResult";
import type { UiLanguage } from "../../shared/i18n";
import {
  change,
  sumMetrics,
  type MediaRow,
  type Metrics,
  type PerformanceReport,
  type ReportRequest,
  type TrackedOffer,
} from "../offer-performance/performanceModel";
import type { AgentPromotionAttachment, AgentPromotionWindow } from "./agentAttachment";

export type PromotionView = "file" | "merchants" | "merchant_media" | "publishers" | "links" | "history" | "categories";
export type PromotionMetric = keyof Metrics;
export type PromotionSort = "after" | "before" | "delta" | "change";

export interface PromotionToolArguments {
  readonly attachmentId: string;
  readonly view: PromotionView;
  readonly merchantIds: readonly string[];
  readonly window: AgentPromotionWindow | null;
  readonly metric: PromotionMetric;
  readonly sortBy: PromotionSort;
  readonly direction: "asc" | "desc";
  readonly offset: number;
  readonly limit: number;
}

export type PromotionToolInput = Partial<PromotionToolArguments> & Pick<PromotionToolArguments, "attachmentId" | "view">;

export type PromotionReportLoader = (
  request: ReportRequest,
  signal?: AbortSignal,
) => Promise<PerformanceReport>;

export interface PromotionToolResult {
  readonly ok: boolean;
  readonly source: {
    readonly dataSource: "database" | "unknown" | "unavailable";
    readonly dataAsOf: string | null;
    readonly estimated: boolean;
  };
  readonly data?: Record<string, unknown>;
  readonly errorCode?: "invalid_arguments" | "not_found" | "tool_error";
  readonly resolution?: Record<string, unknown>;
}

export interface PromotionToolExecution {
  readonly result: PromotionToolResult;
  readonly resultView?: AgentResultView;
}

const METRIC_NAMES: readonly PromotionMetric[] = ["revenue", "clicks", "dpv", "atc", "orders", "commission"];
const VIEWS: readonly PromotionView[] = ["file", "merchants", "merchant_media", "publishers", "links", "history", "categories"];
const SORTS: readonly PromotionSort[] = ["after", "before", "delta", "change"];
const PROMOTION_RESULT_MAX_BYTES = 16_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, maximum = 240): string {
  return String(value ?? "").trim().slice(0, maximum);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.round(value * 10000) / 10000);
  return text(value, 160);
}

function validWindow(value: unknown): value is AgentPromotionWindow {
  if (!isRecord(value)) return false;
  const dates = ["launchDate", "startDate", "endDate", "beforeStart", "beforeEnd"];
  const dateValues = dates.map((key) => value[key]);
  if (!dateValues.every((item): item is string => typeof item === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item))) return false;
  const parsed = dateValues.map((item) => Date.parse(`${item}T00:00:00Z`));
  if (parsed.some((item, index) => !Number.isFinite(item) || new Date(item).toISOString().slice(0, 10) !== dateValues[index])) return false;
  const start = dateValues[1]!;
  const end = dateValues[2]!;
  const beforeStart = dateValues[3]!;
  const beforeEnd = dateValues[4]!;
  return typeof value.days === "number" && Number.isInteger(value.days) && value.days >= 1 && value.days <= 92
    && start <= end
    && parsed[1]! >= parsed[0]!
    && beforeStart <= beforeEnd
    && Math.round((parsed[2]! - parsed[1]!) / 86400000) + 1 === value.days
    && Math.round((parsed[0]! - parsed[3]!) / 86400000) === value.days
    && Math.round((parsed[0]! - parsed[4]!) / 86400000) === 1;
}

function sameWindow(left: AgentPromotionWindow, right: AgentPromotionWindow): boolean {
  return left.launchDate === right.launchDate
    && left.startDate === right.startDate
    && left.endDate === right.endDate
    && left.beforeStart === right.beforeStart
    && left.beforeEnd === right.beforeEnd
    && left.days === right.days;
}

function failure(
  errorCode: PromotionToolResult["errorCode"],
  field: string,
  source: "database" | "unknown" | "unavailable" = "unknown",
): PromotionToolExecution {
  return {
    result: {
      ok: false,
      source: { dataSource: source, dataAsOf: null, estimated: false },
      errorCode,
      resolution: { status: errorCode === "not_found" ? "not_found" : "invalid_filter", field },
    },
  };
}

function metricPair(
  before: number | null,
  after: number | null,
  complete: boolean,
): { before: number | null; after: number | null; delta: number | null; change: number | null } {
  return {
    before,
    after,
    delta: before === null || after === null ? null : after - before,
    change: change(before, after, complete),
  };
}

function rowPair(row: { before: Metrics; after: Metrics }, metric: PromotionMetric, complete: boolean) {
  return metricPair(numberOrNull(row.before[metric]), numberOrNull(row.after[metric]), complete);
}

function aggregatePair(rows: readonly { before: Metrics; after: Metrics }[], metric: PromotionMetric, complete: boolean) {
  const before = sumMetrics(rows.map((row) => row.before))[metric];
  const after = sumMetrics(rows.map((row) => row.after))[metric];
  return metricPair(before, after, complete);
}

function merchantNameMap(attachment: AgentPromotionAttachment): Map<string, string> {
  return new Map(attachment.offers.map((offer) => [offer.merchantId, offer.merchantName]));
}

function selectedMerchantIds(
  attachment: AgentPromotionAttachment,
  requested: readonly string[] | undefined,
): string[] | null {
  const allowed = new Set(attachment.manifest.merchants.map((merchant) => merchant.merchantId));
  const ids = requested?.length ? [...new Set(requested.map((id) => text(id, 20)))] : [...allowed];
  if (!ids.length || ids.some((id) => !allowed.has(id))) return null;
  return ids;
}

function normalizeArguments(
  attachment: AgentPromotionAttachment,
  input: PromotionToolInput,
): { args: PromotionToolArguments; ids: string[]; window: AgentPromotionWindow | null } | null {
  const candidate: PromotionToolArguments = {
    attachmentId: text(input?.attachmentId, 128),
    view: input?.view,
    merchantIds: Array.isArray(input?.merchantIds) ? input.merchantIds : [],
    window: input?.window ?? null,
    metric: input?.metric || "revenue",
    sortBy: input?.sortBy || "after",
    direction: input?.direction || "desc",
    offset: Number.isInteger(input?.offset) ? input.offset! : 0,
    limit: Number.isInteger(input?.limit) ? input.limit! : 25,
  };
  if (!candidate.attachmentId || candidate.attachmentId !== attachment.manifest.attachmentId || !VIEWS.includes(candidate.view)) return null;
  const ids = selectedMerchantIds(attachment, candidate.merchantIds);
  if (!ids || !METRIC_NAMES.includes(candidate.metric) || !SORTS.includes(candidate.sortBy)) return null;
  if (!Number.isInteger(candidate.offset) || candidate.offset < 0 || !Number.isInteger(candidate.limit) || candidate.limit < 1 || candidate.limit > 25) return null;
  if (candidate.direction !== "asc" && candidate.direction !== "desc") return null;
  const window = candidate.window === null || candidate.window === undefined ? attachment.manifest.window : candidate.window;
  if (candidate.view !== "file" && (!validWindow(window) || (attachment.manifest.window && !sameWindow(window, attachment.manifest.window)))) return null;
  return { args: { ...candidate, merchantIds: ids, window: window || null }, ids, window: window || null };
}

function sortedPage<T extends Record<string, unknown>>(
  rows: readonly T[],
  sortBy: PromotionSort,
  direction: "asc" | "desc",
  offset: number,
  limit: number,
): { rows: T[]; totalRows: number; hasMore: boolean } {
  const sorted = rows.slice().sort((left, right) => {
    const leftValue = numberOrNull(left[sortBy]);
    const rightValue = numberOrNull(right[sortBy]);
    if (leftValue === null && rightValue === null) return text(left.merchantId || left.publisherId || left.category || left.month || left.label).localeCompare(text(right.merchantId || right.publisherId || right.category || right.month || right.label));
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    const difference = leftValue - rightValue;
    return difference === 0
      ? text(left.merchantId || left.publisherId || left.category || left.month || left.label).localeCompare(text(right.merchantId || right.publisherId || right.category || right.month || right.label))
      : direction === "desc" ? -difference : difference;
  });
  const page = sorted.slice(offset, offset + limit);
  return { rows: page, totalRows: sorted.length, hasMore: offset + page.length < sorted.length };
}

function sortedMerchantMediaPage(
  rows: readonly Record<string, unknown>[],
  direction: "asc" | "desc",
  offset: number,
  limit: number,
): { rows: Record<string, unknown>[]; totalRows: number; hasMore: boolean } {
  const sorted = rows.slice().sort((left, right) => {
    const difference = (numberOrNull(left.mediaCount) || 0) - (numberOrNull(right.mediaCount) || 0);
    if (difference !== 0) return direction === "desc" ? -difference : difference;
    return text(left.merchantId).localeCompare(text(right.merchantId));
  });
  const page = sorted.slice(offset, offset + limit);
  return { rows: page, totalRows: sorted.length, hasMore: offset + page.length < sorted.length };
}

function activeMediaRow(row: MediaRow): boolean {
  return METRIC_NAMES.some((metric) =>
    [numberOrNull(row.before[metric]), numberOrNull(row.after[metric])].some((value) => value !== null && value !== 0),
  );
}

function reportSource(report: PerformanceReport): PromotionToolResult["source"] {
  return {
    dataSource: "database",
    dataAsOf: report.availableThrough || report.generatedAt || null,
    estimated: false,
  };
}

function reportMeta(report: PerformanceReport): Record<string, unknown> {
  return {
    availableThrough: report.availableThrough || null,
    generatedAt: report.generatedAt || null,
    clickSource: report.clickSource || null,
    supported: report.supported,
    dateRange: report.dateRange,
  };
}

function jsonBytes(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return typeof TextEncoder === "undefined"
      ? serialized.length
      : new TextEncoder().encode(serialized).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function fitResultToBudget(data: Record<string, unknown>): Record<string, unknown> | null {
  const initialRows = Array.isArray(data.rows) ? data.rows.filter(isRecord) : [];
  let rows = initialRows;
  let candidate: Record<string, unknown> = {
    ...data,
    rows,
    returned: rows.length,
    nextOffset: Number(data.offset || 0) + rows.length,
  };
  while (jsonBytes(candidate) > PROMOTION_RESULT_MAX_BYTES && rows.length) {
    rows = rows.slice(0, Math.floor((rows.length - 1) / 2));
    candidate = {
      ...data,
      rows,
      returned: rows.length,
      hasMore: true,
      nextOffset: Number(data.offset || 0) + rows.length,
    };
  }
  return jsonBytes(candidate) <= PROMOTION_RESULT_MAX_BYTES ? candidate : null;
}

function offerRows(offers: readonly TrackedOffer[]): Record<string, unknown>[] {
  return offers.map((offer) => ({
    merchantId: offer.merchantId,
    merchantName: offer.merchantName,
    category: offer.category || null,
    asins: offer.asins.slice(0, 50),
  }));
}

function relationshipBase(row: MediaRow, names: Map<string, string>, pair: ReturnType<typeof metricPair>): Record<string, unknown> {
  return {
    merchantId: row.merchantId,
    merchantName: names.get(row.merchantId) || null,
    publisherId: row.publisherId,
    publisherName: row.publisherName,
    ...pair,
  };
}

function buildResultView(
  callId: string,
  language: UiLanguage,
  view: PromotionView,
  data: Record<string, unknown>,
  source: PromotionToolResult["source"],
): AgentResultView {
  const rows = Array.isArray(data.rows) ? data.rows.filter(isRecord) : [];
  const columns = view === "file"
    ? (language === "zh" ? ["商家 ID", "商家名称", "品类", "ASIN"] : ["Merchant ID", "Merchant", "Category", "ASIN"])
    : view === "merchant_media"
      ? (language === "zh" ? ["商家", "媒体数量"] : ["Merchant", "Media count"])
    : view === "links"
      ? (language === "zh" ? ["商家", "媒体", "链接类型", "目标 ASIN", "成交 ASIN", "推送后"] : ["Merchant", "Publisher", "Link type", "Target ASIN", "Purchased ASIN", "After"])
      : view === "history"
        ? (language === "zh" ? ["月份", "指标"] : ["Month", "Metric"])
        : (language === "zh" ? ["对象", "推送前", "推送后", "变化", "变化率"] : ["Entity", "Before", "After", "Delta", "Change"]);
  const values = rows.map((row) => {
    if (view === "file") return [row.merchantId, row.merchantName, row.category, Array.isArray(row.asins) ? row.asins.join(", ") : ""];
    if (view === "merchant_media") return [row.merchantName || row.merchantId, row.mediaCount];
    if (view === "links") return [row.merchantName || row.merchantId, row.publisherName || row.publisherId, row.linkType, row.targetAsin, row.purchasedAsin, row.after];
    if (view === "history") return [row.month, row.value];
    return [row.publisherName || row.category || row.merchantName || row.merchantId, row.before, row.after, row.delta, row.change];
  }).map((row) => row.map(formatValue));
  const aggregate = isRecord(data.aggregates) ? data.aggregates : null;
  const metrics = aggregate
    ? ["before", "after", "delta", "change"].flatMap((key) => [{ label: key, value: formatValue(aggregate[key]) }])
    : [];
  return {
    id: callId,
    toolName: "promotion_analysis",
    kind: view === "history" ? "trend" : rows.length ? "table" : metrics.length ? "metric" : "summary",
    status: "done",
    title: text(data.headline, 180) || view,
    source: source.dataSource,
    dataAsOf: source.dataAsOf,
    estimated: source.estimated,
    partial: data.hasMore === true,
    metrics,
    columns,
    rows: rows.map((row, index) => ({ label: text(row.merchantName || row.publisherName || row.category || row.month || row.merchantId || row.publisherId || `row-${index}`, 160), values: values[index] || [] })),
    message: text(data.note, 800),
  };
}

function baseData(
  attachment: AgentPromotionAttachment,
  args: PromotionToolArguments,
  rows: readonly Record<string, unknown>[],
  totalRows: number,
  hasMore: boolean,
): Record<string, unknown> {
  return {
    view: args.view,
    metric: args.metric,
    attachmentId: attachment.manifest.attachmentId,
    fileName: attachment.manifest.fileName,
    merchantCount: attachment.manifest.merchantCount,
    window: args.window,
    totalRows,
    offset: args.offset,
    limit: args.limit,
    returned: rows.length,
    nextOffset: args.offset + rows.length,
    hasMore,
    rows,
  };
}

export async function executePromotionTool(
  attachment: AgentPromotionAttachment,
  input: PromotionToolInput,
  loadReport: PromotionReportLoader,
  signal: AbortSignal,
  language: UiLanguage,
  callId = "promotion-analysis",
): Promise<PromotionToolExecution> {
  const normalized = normalizeArguments(attachment, input);
  if (!normalized) return failure("invalid_arguments", "promotion_analysis");
  const { args, ids, window } = normalized;
  const selectedIds = new Set(ids);
  const offers = attachment.offers.filter((offer) => selectedIds.has(offer.merchantId));
  if (args.view === "file") {
    const allRows = offerRows(offers).sort((left, right) => text(left.merchantId).localeCompare(text(right.merchantId)));
    const pageRows = allRows.slice(args.offset, args.offset + args.limit);
    const hasMore = args.offset + pageRows.length < allRows.length;
    const rows = pageRows;
    const data = fitResultToBudget({
      ...baseData(attachment, args, rows, allRows.length, hasMore),
      evidenceOrigin: "file",
      headline: language === "zh" ? "上传清单" : "Uploaded merchant list",
      note: language === "zh" ? "商家和 ASIN 信息来自上传文件。" : "Merchant and ASIN facts come from the uploaded file.",
    });
    if (!data) return failure("tool_error", "result", "unavailable");
    const source = { dataSource: "unknown" as const, dataAsOf: null, estimated: false };
    return { result: { ok: true, source, data }, resultView: buildResultView(callId, language, args.view, data, source) };
  }
  if (!window) return failure("invalid_arguments", "window");

  const request: ReportRequest = {
    action: args.view === "merchant_media" || args.view === "publishers" || args.view === "links" ? "relations" : undefined,
    batchId: attachment.manifest.attachmentId,
    merchantIds: ids.join(","),
    launchDate: window.launchDate,
    startDate: window.startDate,
    endDate: window.endDate,
    beforeStart: window.beforeStart,
    beforeEnd: window.beforeEnd,
  };
  let report: PerformanceReport;
  try {
    report = await loadReport(request, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    return failure("tool_error", "report", "unavailable");
  }
  const names = merchantNameMap(attachment);
  const complete = report.availableThrough >= window.endDate;
  const selectedReports = report.merchants.filter((row) => selectedIds.has(row.merchantId));
  const source = reportSource(report);
  let rows: Record<string, unknown>[] = [];
  let totalRows = 0;
  let hasMore = false;
  let aggregates: Record<string, unknown> | undefined;

  if (args.view === "merchants") {
    const allRows = selectedReports.map((row) => ({
      merchantId: row.merchantId,
      merchantName: names.get(row.merchantId) || null,
      ...rowPair(row, args.metric, complete),
    }));
    const page = sortedPage(allRows, args.sortBy, args.direction, args.offset, args.limit);
    rows = page.rows;
    totalRows = page.totalRows;
    hasMore = page.hasMore;
    aggregates = aggregatePair(selectedReports, args.metric, complete);
  } else if (args.view === "categories") {
    const categories = new Map<string, typeof selectedReports>();
    selectedReports.forEach((row) => {
      const category = attachment.offers.find((offer) => offer.merchantId === row.merchantId)?.category
        || (language === "zh" ? "未分类" : "Uncategorized");
      categories.set(category, [...(categories.get(category) || []), row]);
    });
    const allRows = [...categories.entries()].map(([category, categoryRows]) => ({
      category,
      merchantCount: categoryRows.length,
      ...aggregatePair(categoryRows, args.metric, complete),
    }));
    const page = sortedPage(allRows, args.sortBy, args.direction, args.offset, args.limit);
    rows = page.rows;
    totalRows = page.totalRows;
    hasMore = page.hasMore;
    aggregates = aggregatePair(selectedReports, args.metric, complete);
  } else if (args.view === "history") {
    const months = new Map<string, Array<{ [key in "revenue" | "clicks" | "dpv" | "atc" | "orders" | "commission"]: number | null }>>();
    selectedReports.forEach((row) => row.monthly.forEach((monthly) => {
      months.set(monthly.month, [...(months.get(monthly.month) || []), monthly]);
    }));
    const allRows = [...months.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([month, monthRows]) => ({
      month,
      value: sumMetrics(monthRows)[args.metric],
      merchantCount: monthRows.length,
    }));
    rows = allRows.slice(args.offset, args.offset + args.limit);
    totalRows = allRows.length;
    hasMore = args.offset + rows.length < totalRows;
  } else {
    const relationRows = (args.view === "links" ? report.links : report.media) || [];
    if (args.view === "merchant_media") {
      const mediaByMerchant = new Map(ids.map((merchantId) => [merchantId, new Set<string>()]));
      relationRows.filter((row): row is MediaRow => selectedIds.has(row.merchantId) && activeMediaRow(row)).forEach((row) => {
        const publisherId = text(row.publisherId, 80);
        if (publisherId && publisherId !== "0") mediaByMerchant.get(row.merchantId)?.add(publisherId);
      });
      const allRows = ids.map((merchantId) => ({
        merchantId,
        merchantName: names.get(merchantId) || null,
        mediaCount: mediaByMerchant.get(merchantId)?.size || 0,
      }));
      const page = sortedMerchantMediaPage(allRows, args.direction, args.offset, args.limit);
      rows = page.rows;
      totalRows = page.totalRows;
      hasMore = page.hasMore;
    } else if (args.view === "publishers") {
      const publishers = new Map<string, MediaRow[]>();
      relationRows.filter((row) => selectedIds.has(row.merchantId)).forEach((row) => {
        publishers.set(row.publisherId, [...(publishers.get(row.publisherId) || []), row]);
      });
      const allRows = [...publishers.entries()].map(([publisherId, publisherRows]) => ({
        publisherId,
        publisherName: publisherRows[0]?.publisherName || publisherId,
        merchantCount: new Set(publisherRows.map((row) => row.merchantId)).size,
        ...aggregatePair(publisherRows, args.metric, complete),
      }));
      const page = sortedPage(allRows, args.sortBy, args.direction, args.offset, args.limit);
      rows = page.rows;
      totalRows = page.totalRows;
      hasMore = page.hasMore;
      aggregates = aggregatePair(relationRows.filter((row) => selectedIds.has(row.merchantId)), args.metric, complete);
    } else {
      const allRows = relationRows.filter((row) => selectedIds.has(row.merchantId)).map((row) => ({
        ...relationshipBase(row, names, rowPair(row, args.metric, complete)),
        linkType: row.linkType,
        targetAsin: row.asin || null,
        purchasedAsin: row.purchasedAsin || null,
      }));
      const page = sortedPage(allRows, args.sortBy, args.direction, args.offset, args.limit);
      rows = page.rows;
      totalRows = page.totalRows;
      hasMore = page.hasMore;
      aggregates = aggregatePair(relationRows.filter((row) => selectedIds.has(row.merchantId)), args.metric, complete);
    }
  }
  const data = fitResultToBudget({
    ...baseData(attachment, args, rows, totalRows, hasMore),
    ...reportMeta(report),
    ...(aggregates ? { aggregates } : {}),
    evidenceOrigin: "database",
    headline: language === "zh" ? `推广追踪·${args.view}` : `Promotion tracking · ${args.view}`,
    note: language === "zh"
      ? "指标来自推广追踪数据库；结果表示所选窗口内的观察值，不证明推送因果。"
      : "Metrics come from the promotion tracking database; they describe the selected window and do not prove campaign causality.",
  });
  if (!data) return failure("tool_error", "result", "unavailable");
  return { result: { ok: true, source, data }, resultView: buildResultView(callId, language, args.view, data, source) };
}
