import { formatAgentMetric } from "./agentMetricFormatting";
import { createAgentResultReuse, type ReusableAgentResult } from "./agentResultReuse";
import type { UiLanguage } from "../../shared/i18n";
import { notifyAuthFailure } from "../../shared/api/client";
import { mergeMerchantMonths } from "../chatbot/report/trendReports";
import { createReportDataProvider } from "../chatbot/report/reportDataProvider";
import { parseAgentKeywordConstraints, searchAgentKeywords } from "./agentKeywordSearch";
import { agentMetricLabel } from "./agentResultPresentation";
import { consumeSseResponse } from "../../shared/stream/sse";
import {
  normalizeAgentResultView,
  normalizeAgentResultViews,
  type AgentResultView
} from "../../shared/contracts/agentResult";
import {
  canonicalChatbotTier,
  normalizeChatbotText,
  resolveChatbotCategory,
  resolveChatbotMerchant
} from "../chatbot/chatbotModel";
import {
  applyAgentMemoryEvents,
  emptyAgentMemory,
  loadAgentMemory,
  saveAgentMemory,
  type AgentMemoryCandidate,
  type AgentMemoryEvent,
  type AgentMemoryState,
  type AgentRunStatus,
  type AgentTimelineStep
} from "./agentModel";
import {
  executePromotionTool,
  type PromotionReportLoader,
  type PromotionToolArguments,
} from "./agentPromotionTool";
import { promotionManifestForRequest, type AgentPromotionAttachment } from "./agentAttachment";

type Row = Readonly<Record<string, unknown>>;
type DataSource = "cache" | "database" | "mixed" | "unavailable" | "unknown";
export type AgentToolName =
  | "merchant_analysis"
  | "category_analysis"
  | "merchant_comparison"
  | "tier_analysis"
  | "category_comparison"
  | "payment_status"
  | "trend"
  | "asin_analysis"
  | "keyword_search"
  | "promotion_analysis";

type ToolName = AgentToolName;

export const AGENT_TOOL_NAMES: readonly ToolName[] = [
  "merchant_analysis",
  "category_analysis",
  "merchant_comparison",
  "tier_analysis",
  "category_comparison",
  "payment_status",
  "trend",
  "asin_analysis",
  "keyword_search",
  "promotion_analysis"
];

export interface AgentHistoryMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly answerId?: string;
  readonly feedbackState?: "available" | "submitted";
}

import { asinContextFromViews } from "./agentAsinContext";

export interface AgentSessionRequest {
  readonly prompt: string;
  readonly language: UiLanguage;
  readonly history: readonly AgentHistoryMessage[];
  readonly memoryText: string;
  readonly asinContext?: readonly string[];
  // 页面已登记的提问事件：备用执行复用关联，日志创建及完成仍由页面负责。
  readonly questionEventId?: string;
  readonly reuseResult?: boolean;
  readonly signal: AbortSignal;
  readonly promotionAttachment?: AgentPromotionAttachment;
}

export interface AgentSessionCallbacks {
  readonly onToken?: (token: string) => void;
  readonly onTimeline?: (step: AgentTimelineStep) => void;
  readonly onResultView?: (view: AgentResultView) => void;
  readonly onChange?: (state: AgentSessionState) => void;
}

export interface AgentToolExecutionRequest {
  readonly callId: string;
  readonly toolName: AgentToolName;
  readonly arguments: Record<string, unknown>;
  readonly prompt: string;
  readonly signal: AbortSignal;
  readonly language?: UiLanguage;
  readonly promotionAttachment?: AgentPromotionAttachment;
}

export interface AgentToolExecutionResponse {
  readonly toolResult: Record<string, unknown>;
  readonly memoryEvent?: AgentMemoryEvent;
  readonly resultView?: AgentResultView;
}

export interface AgentSessionResult {
  readonly ok: boolean;
  readonly status: Exclude<AgentRunStatus, "idle" | "running">;
  readonly response: string;
  readonly steps: readonly AgentTimelineStep[];
  readonly partial?: boolean;
  readonly omittedTargets?: readonly string[];
  readonly resultViews?: readonly AgentResultView[];
  readonly memoryEvents?: readonly AgentMemoryEvent[];
  readonly errorCode?: string | null;
}

export interface AgentViewSessionResult extends Omit<AgentSessionResult, "memoryEvents"> {
  readonly memoryEvents?: readonly unknown[];
}

export interface AgentSessionState {
  readonly status: AgentRunStatus;
  readonly history: readonly AgentHistoryMessage[];
  readonly messages?: readonly AgentHistoryMessage[];
  readonly steps: readonly AgentTimelineStep[];
  readonly response: string;
  readonly partial: boolean;
  readonly omittedTargets: readonly string[];
  readonly resultViews?: readonly AgentResultView[];
  readonly hasMemory: boolean;
  readonly memory?: unknown;
  readonly errorCode?: string | null;
}

export interface AgentFeedbackResult {
  readonly ok: boolean;
  readonly alreadyExists?: boolean;
  readonly errorCode?: string;
}

export interface AgentFeedback {
  isAvailable(): boolean;
  submit(reasonCode: string, reasonDetail?: string): Promise<AgentFeedbackResult>;
}

export interface AgentViewSession {
  getState(): AgentSessionState;
  setLanguage?(language: UiLanguage): void;
  submit(request: AgentSessionRequest, callbacks?: AgentSessionCallbacks): Promise<AgentViewSessionResult>;
  stop(): void;
  newConversation(): void;
  onChange(listener: (state: AgentSessionState) => void): () => void;
  feedback?: AgentFeedback;
  feedbackForAnswer?: (answerId: string) => AgentFeedback | null;
  downloadLogs?: (kind: "questions" | "feedback", format: "csv" | "jsonl") => boolean;
  dispose?: () => void;
}

export interface AgentSession extends AgentViewSession {
  submit(request: AgentSessionRequest, callbacks?: AgentSessionCallbacks): Promise<AgentSessionResult>;
  executeTool(request: AgentToolExecutionRequest): Promise<AgentToolExecutionResponse>;
  getReusableResult(): ReusableAgentResult | null;
  retainReusableResult(result: ReusableAgentResult): void;
  markReusableStopped(): void;
  canReuseResult(prompt: string, explicit?: boolean): boolean;
  clearReusableResults(): void;
}

export interface AgentSessionOptions {
  readonly offers: readonly Row[];
  readonly paymentRecords?: readonly Row[];
  readonly language: UiLanguage;
  readonly storage?: Storage;
  readonly agentEnabled?: boolean;
  readonly signal?: AbortSignal;
  readonly fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readonly enableQuestionLogging?: boolean;
  readonly enableTrace?: boolean;
  readonly dataAsOf?: string | null;
  readonly asinRankingContext?: {
    readonly version: number | null;
    readonly startDate: string | null;
    readonly endDate: string | null;
  };
  readonly loadPromotionReport?: PromotionReportLoader;
  readonly getOffers?: () => readonly Row[];
  readonly getProductKeywords?: () => unknown;
  readonly loadOffers?: (signal: AbortSignal) => Promise<unknown>;
  readonly loadKeywords?: (signal: AbortSignal) => Promise<unknown>;
}

interface AgentToolCall {
  readonly id: string;
  readonly name: ToolName;
  readonly arguments: Record<string, unknown>;
}

interface AgentPlan {
  readonly agentRunId: string;
  readonly planProof?: string;
  readonly content: string;
  readonly toolCalls: readonly AgentToolCall[];
  readonly round: number;
}

interface AgentToolResult {
  readonly ok: boolean;
  readonly source: {
    readonly dataSource: DataSource;
    readonly dataAsOf: string | null;
    readonly estimated: boolean;
  };
  readonly data?: Record<string, unknown>;
  readonly errorCode?: "tool_error" | "tool_timeout" | "llm_timeout" | "invalid_arguments" | "invalid_filter" | "not_found" | "stopped_by_user";
  readonly resolution?: Record<string, unknown>;
  readonly resultView?: AgentResultView;
}

interface AgentToolExecution {
  readonly call: AgentToolCall;
  readonly result: AgentToolResult;
}

interface QuestionContext {
  readonly eventId: string;
  readonly prompt: string;
  readonly language: UiLanguage;
  readonly answer: string;
  recordPromise: Promise<{ readonly recordId: string } | null>;
  completionPromise?: Promise<{ readonly recordId: string } | null>;
  feedbackEventId?: string;
  submitted?: boolean;
}

interface TraceContext {
  readonly runId: string;
  readonly questionEventId: string;
  readonly sessionId: string;
  readonly startedAt: string;
  readonly language: UiLanguage;
}

interface JsonPayload {
  readonly ok?: unknown;
  readonly errorCode?: unknown;
  readonly recordId?: unknown;
  readonly [key: string]: unknown;
}

const MAX_HISTORY = 24;
const MAX_TOOL_CALLS = 6;
const MAX_PLAN_PROOFS = 2;
const MAX_MEMORY_TEXT = 8_000;
const SESSION_STORAGE_KEY = "oi_agent_session_v1";
const ENABLED_ERROR_CODES = new Set([
  "tool_error",
  "tool_timeout",
  "llm_timeout",
  "invalid_arguments",
  "invalid_filter",
  "not_found",
  "stopped_by_user"
]);
const KNOWN_ERROR_CODES = new Set([
  ...ENABLED_ERROR_CODES,
  "agent_planning_unavailable",
  "agent_no_tool_plan",
  "agent_plan_truncated",
  "network_error",
  "provider_error",
]);
const INITIAL_PLANNING_RETRYABLE_ERROR_CODES = new Set([
  "agent_planning_unavailable",
  "network_error",
  "provider_error",
  "llm_timeout",
]);
const RETRYABLE_TOOL_ERROR_CODES = new Set(["tool_error", "tool_timeout", "llm_timeout"]);
const ASIN_PATTERN = /^B[0-9A-Z]{9}$/i;
const MAX_ASINS_PER_QUERY = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, maximum = 120_000): string {
  return String(value ?? "").trim().slice(0, maximum);
}

function numberValue(value: unknown): number {
  const parsed = Number(String(value ?? "").replace(/[$,%]/g, "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function resultMetricKey(label: string): string {
  return label.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function formatAgentResultNumber(label: string, value: number): string {
  const key = resultMetricKey(label);
  return formatAgentMetric(key === "conversionrate" || key === "cvr" || key === "commissionrate" ? "conversionRate" : key.endsWith("count") || ["returned", "unpaid", "pending", "paid", "overdue"].includes(key) ? "count" : key, value, "zh");
}

function firstValue(row: Row, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}

function numberFor(row: Row, keys: readonly string[]): number {
  return numberValue(firstValue(row, keys));
}

function nullableNumberFor(row: Row, keys: readonly string[]): number | null {
  const raw = firstValue(row, keys);
  if (raw === undefined || typeof raw === "boolean") return null;
  const parsed = Number(String(raw).replace(/[$,%]/g, "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function merchantId(row: Row): string {
  return text(firstValue(row, ["merchantId", "merchant_id", "Merchant ID", "MerchantID", "id"]), 80).replace(/\.0$/, "");
}

function merchantName(row: Row): string {
  return text(firstValue(row, ["brand", "merchantName", "merchant_name", "Merchant Name", "Merchant"]), 120) || merchantId(row);
}

function rowTier(row: Row): string {
  return canonicalChatbotTier(firstValue(row, ["tier", "Tier"]));
}

function rowCategories(row: Row): string[] {
  const keys = ["sheetCategory", "Sheet Category", "mainCategory", "Main Category", "category", "Category", "levantaCategory"];
  return keys.flatMap((key) => {
    const value = row[key];
    return Array.isArray(value) ? value.map((item) => text(item, 120)).filter(Boolean) : [text(value, 120)];
  }).filter(Boolean);
}

function normalizedCategories(rows: readonly Row[]): string[] {
  return Array.from(new Set(rows.flatMap(rowCategories).filter((value) => normalizeChatbotText(value) !== "uncategorized")));
}

function rowMatchesCategory(row: Row, category: string): boolean {
  const query = normalizeChatbotText(category);
  return Boolean(query) && rowCategories(row).some((value) => {
    const normalized = normalizeChatbotText(value);
    return normalized === query || normalized.includes(query) || query.includes(normalized);
  });
}

function metricValues(row: Row): Record<string, number | null> {
  const clicks = nullableNumberFor(row, ["clicks", "Clicks", "totalClicks"]);
  const orders = nullableNumberFor(row, ["orders", "orderCount", "Order count", "Order Count"]);
  const revenue = nullableNumberFor(row, ["salesAmount", "revenue", "Revenue", "revenueMade"]);
  const commission = nullableNumberFor(row, ["affCommission", "commissionMade", "AFF Commission", "affiliatePayout"]);
  const epcRaw = nullableNumberFor(row, ["epc", "affEpc", "EPC", "EPC(Aff)"]);
  const aovRaw = nullableNumberFor(row, ["aov", "AOV"]);
  const conversionRaw = nullableNumberFor(row, ["conversionRate", "conversion", "CVR"]);
  return {
    clicks,
    orders,
    revenue,
    commission,
    epc: epcRaw ?? (clicks !== null && clicks > 0 && commission !== null ? commission / clicks : null),
    aov: aovRaw ?? (orders !== null && orders > 0 && revenue !== null ? revenue / orders : null),
    conversionRate: conversionRaw ?? (clicks !== null && clicks > 0 && orders !== null ? orders / clicks : null)
  };
}

function aggregate(rows: readonly Row[]): Record<string, unknown> {
  const values = rows.map(metricValues);
  const totals = values.reduce((result, item) => {
    Object.entries(item).forEach(([key, value]) => { if (value !== null) result[key] = (result[key] || 0) + value; });
    return result;
  }, {} as Record<string, number>);
  const clicks = totals.clicks || 0;
  const orders = totals.orders || 0;
  const revenue = totals.revenue || 0;
  return {
    merchantCount: new Set(rows.map(merchantId).filter(Boolean)).size || rows.length,
    clicks: Object.hasOwn(totals, "clicks") ? clicks : null,
    orders: Object.hasOwn(totals, "orders") ? orders : null,
    revenue: Object.hasOwn(totals, "revenue") ? revenue : null,
    commission: Object.hasOwn(totals, "commission") ? totals.commission : null,
    epc: clicks > 0 && values.every(row => row.commission !== null && row.clicks !== null) ? (totals.commission || 0) / clicks : null,
    aov: orders > 0 && values.every(row => row.revenue !== null && row.orders !== null) ? revenue / orders : null,
    conversionRate: clicks > 0 && values.every(row => row.orders !== null && row.clicks !== null) ? orders / clicks : null
  };
}

function merchantObject(row: Row): Record<string, unknown> {
  const id = merchantId(row);
  return { ...(id ? { id } : {}), name: merchantName(row) };
}

function merchantData(row: Row): Record<string, unknown> {
  const categories = rowCategories(row);
  return {
    merchant: merchantObject(row),
    ...(rowTier(row) ? { tier: rowTier(row) } : {}),
    ...(categories[0] ? { category: categories[0] } : {}),
    metrics: metricValues(row)
  };
}

function normalizeAsins(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ASINS_PER_QUERY) return null;
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const asin = item.trim().toUpperCase();
    if (!ASIN_PATTERN.test(asin)) return null;
    if (!normalized.includes(asin)) normalized.push(asin);
  }
  return normalized.length ? normalized : null;
}

function optionalAsinText(row: Row, keys: readonly string[], maximum = 160): string | undefined {
  const value = firstValue(row, keys);
  if (typeof value !== "string") return undefined;
  const normalized = text(value, maximum);
  return normalized || undefined;
}

function optionalAsinNumber(row: Row, keys: readonly string[]): number | undefined {
  const value = firstValue(row, keys);
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? rounded(parsed) : undefined;
}

function optionalAsinPrice(row: Row, keys: readonly string[]): string | number | undefined {
  const value = firstValue(row, keys);
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? rounded(value) : undefined;
  if (typeof value !== "string") return undefined;
  const price = value.trim();
  // 保留来源中的货币标记，不把带符号的价格当成缺失，也不猜测币种。
  if (price.length > 80 || !/^(?:(?:[$€£¥]|USD|EUR|GBP|JPY|CNY|CAD|AUD)\s*)?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/i.test(price)) return undefined;
  return /^\d+(?:\.\d+)?$/.test(price) ? rounded(Number(price)) : price;
}

const ASIN_DETAIL_FIELDS = [
  ["merchantId", "商家 ID", "Merchant ID"], ["merchantName", "商家名称", "Merchant"],
  ["productName", "商品名称", "Product"], ["productUrl", "商品链接", "Product URL"],
  ["category", "品类", "Category"], ["dealPrice", "商品价格", "Deal price"],
  ["originalPrice", "原价", "Original price"], ["discountPercent", "折扣（%）", "Discount (%)"],
  ["commissionRate", "佣金率（源值）", "Commission rate (source value)"],
  ["updatedAt", "商品更新时间", "Product updated at"]
] as const;

function asinDetailRows(rows: readonly Row[], language: UiLanguage) {
  return rows.flatMap((row) => ASIN_DETAIL_FIELDS.map(([key, zh, en]) => ({
    label: text(row.asin, 20),
    values: [language === "en" ? en : zh, row[key] === undefined || row[key] === null || row[key] === ""
      ? (language === "en" ? "Not provided" : "未提供") : String(row[key])]
  })));
}

function asinSummaryRow(row: Row): Record<string, unknown> | null {
  const asin = text(firstValue(row, ["asin", "ASIN"]), 20).toUpperCase();
  if (!ASIN_PATTERN.test(asin)) return null;
  const id = merchantId(row);
  const name = merchantName(row);
  const metrics = row.asinPerformanceAvailable === false || (Array.isArray(row.monthly) && !row.monthly.length)
    ? {} : metricValues(row);
  const dealPrice = optionalAsinPrice(row, ["dealPrice", "deal_price", "Deal Price"]);
  const originalPrice = optionalAsinPrice(row, ["originalPrice", "original_price", "Original Price"]);
  return {
    asin,
    asinPerformanceAvailable: Object.keys(metrics).length > 0,
    ...(id ? { merchantId: id } : {}),
    ...(name ? { merchantName: name } : {}),
    ...(optionalAsinText(row, ["productName", "product_name", "Product Name", "title", "name"], 500) ? { productName: optionalAsinText(row, ["productName", "product_name", "Product Name", "title", "name"], 500) } : {}),
    ...(optionalAsinText(row, ["productUrl", "product_url", "Product URL", "url"], 500) ? { productUrl: optionalAsinText(row, ["productUrl", "product_url", "Product URL", "url"], 500) } : {}),
    ...(dealPrice !== undefined ? { dealPrice } : {}),
    ...(originalPrice !== undefined ? { originalPrice } : {}),
    ...(optionalAsinNumber(row, ["discountPercent", "discount_percent", "Discount Percent"]) !== undefined ? { discountPercent: optionalAsinNumber(row, ["discountPercent", "discount_percent", "Discount Percent"]) } : {}),
    ...(optionalAsinText(row, ["category", "Category"]) ? { category: optionalAsinText(row, ["category", "Category"]) } : {}),
    ...(optionalAsinNumber(row, ["commissionRate"]) !== undefined ? { commissionRate: optionalAsinNumber(row, ["commissionRate"]) } : {}),
    ...(optionalAsinText(row, ["updatedAt"], 80) ? { updatedAt: optionalAsinText(row, ["updatedAt"], 80) } : {}),
    ...metrics
  };
}

function asinMonthlyRow(row: Row, fallbackAsin: string, fallbackMerchantName: string, fallbackMerchantId: string): Record<string, unknown> | null {
  const rawAsin = text(firstValue(row, ["asin", "ASIN"]), 20).toUpperCase();
  const asin = ASIN_PATTERN.test(rawAsin) ? rawAsin : fallbackAsin;
  const month = rowMonth(row);
  if (!asin || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const id = merchantId(row) || fallbackMerchantId;
  const name = optionalAsinText(row, ["merchantName", "merchant_name", "Merchant Name", "merchant"]) || fallbackMerchantName;
  const metrics = metricValues(row);
  return {
    asin,
    ...(id ? { merchantId: id } : {}),
    ...(name ? { merchantName: name } : {}),
    month,
    ...metrics
  };
}

function resultSource(dataSource: DataSource, dataAsOf: string | null, estimated = false): AgentToolResult["source"] {
  return { dataSource, dataAsOf: dataAsOf || null, estimated };
}

function success(data: Record<string, unknown>, dataSource: DataSource, dataAsOf: string | null = null, estimated = false): AgentToolResult {
  return { ok: true, source: resultSource(dataSource, dataAsOf, estimated), data };
}

function failure(
  errorCode: AgentToolResult["errorCode"],
  dataSource: DataSource = "cache",
  resolution?: Record<string, unknown>
): AgentToolResult {
  return {
    ok: false,
    source: resultSource(dataSource, null),
    errorCode: errorCode || "tool_error",
    ...(resolution ? { resolution } : {})
  };
}

function safeErrorCode(value: unknown): string {
  const code = text(value, 64).toLowerCase();
  return KNOWN_ERROR_CODES.has(code) ? code : "tool_error";
}

function randomUuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // 本地测试环境没有 Web Crypto 时使用格式合法的回退值。
  }
  const value = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
    .replace(/[^a-f0-9]/gi, "").padEnd(32, "0").slice(0, 32);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function getSessionId(storage?: Storage): string {
  try {
    const saved = storage?.getItem(SESSION_STORAGE_KEY)?.trim();
    if (saved && /^[A-Za-z0-9._:-]{16,64}$/.test(saved)) return saved;
    const next = `agent-${randomUuid().replace(/-/g, "")}`.slice(0, 64);
    storage?.setItem(SESSION_STORAGE_KEY, next);
    return next;
  } catch {
    return `agent-${randomUuid().replace(/-/g, "")}`.slice(0, 64);
  }
}

function linkSignal(parent: AbortSignal | undefined, external: AbortSignal | undefined): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abort = (event: Event): void => controller.abort((event.target as AbortSignal).reason);
  if (parent?.aborted || external?.aborted) controller.abort();
  parent?.addEventListener("abort", abort, { once: true });
  external?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      parent?.removeEventListener("abort", abort);
      external?.removeEventListener("abort", abort);
    }
  };
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted || (isRecord(error) && error.name === "AbortError"));
}

function clipHistory(history: readonly AgentHistoryMessage[]): AgentHistoryMessage[] {
  return (Array.isArray(history) ? history : []).slice(-4).flatMap((item) => {
    if (!item || (item.role !== "user" && item.role !== "assistant")) return [];
    const content = text(item.content, 1_200);
    return content ? [{ role: item.role, content }] : [];
  });
}

function isDataQuestion(prompt: string): boolean {
  const value = text(prompt, 4_000);
  if (!value) return false;
  const definitionCue = /什么是|是什么|定义|含义|解释|如何计算|怎么算|怎么计算|what is|meaning|definition|formula|explain|how to calculate/i;
  const metricDefinition = /^\s*(?:(?:什么是|解释|如何计算|怎么算|怎么计算|what is|explain|how to calculate)\s*)?(?:(?:联盟|平均|加权|总|affiliate|average|weighted|total)\s*)?(?:EPC|CVR|AOV|收入趋势|收入|销售额|订单|点击|联盟佣金|佣金|转化率|客单价|关键词搜索|revenue trend|revenue|sales|orders|clicks|commission|conversion rate|average order value|keyword search)\s*(?:的\s*)?(?:是什么|是什么意思|定义|含义|公式|如何计算|怎么算|怎么计算|definition|meaning|formula)?\s*[？?。.]?\s*$/i;
  if (definitionCue.test(value) && metricDefinition.test(value)) return false;
  return isKeywordDataQuestion(value) || /(?:\basin\b|\bB[0-9A-Z]{9}\b|epc|aov|cvr|conversion|revenue|sales|orders|clicks|commission|payout|payment|trend|monthly|merchant|category|tier|report|data|\u4ed8\u6b3e|\u6536\u5165|\u8ba2\u5355|\u70b9\u51fb|\u8d8b\u52bf|\u6708\u5ea6|\u5546\u6237|\u54c1\u7c7b|\u5c42\u7ea7|\u6570\u636e)/i.test(value);
}

export function isKeywordDataQuestion(prompt: string): boolean {
  return /(?:^\s*\/?keyword\b|^\s*(?:查询|搜索|查找)\s*关键词|^\s*(?:search|find)\s+(?:product\s+)?keywords?\b|brand\s+recommendation|(?:产品|商品)关键词|关键词\s*[:：]|推荐.*品牌|查找.*商家|相关商家|哪些品牌做)/i.test(prompt);
}

export function keywordMissingDataResponse(language: UiLanguage): string {
  return language === "en"
    ? "I do not have a verifiable data source for this keyword query. Retry or provide a product keyword."
    : "关键词查询尚未取得可验证的数据来源。请重试或补充产品关键词。";
}

function keywordFailureMessage(errorCode: string | undefined, language: UiLanguage, keyword: string): string {
  if (errorCode === "not_found") return language === "en"
    ? `No merchants matched "${keyword}" in the available keyword data.`
    : `当前可用的关键词数据中没有匹配“${keyword}”的商户。`;
  return language === "en"
    ? `Keyword data is unavailable for "${keyword}"; this does not mean no merchants exist.`
    : `“${keyword}”的关键词数据暂不可用，这不代表数据库中没有相关商户。`;
}

function toolFailureMessage(result: AgentToolResult, language: UiLanguage, target: string): string {
  if (result.errorCode === "tool_timeout") return language === "zh" ? `“${target}”的数据查询超时，请稍后重试。` : `The data query for "${target}" timed out. Please retry.`;
  if (result.resolution?.status === "invalid_filter" && Array.isArray(result.resolution.candidates)) {
    const candidates = result.resolution.candidates.filter(isRecord).map(row => text(row.name || row.id, 120)).filter(Boolean);
    if (candidates.length) return language === "zh" ? `“${target}”对应多个商户，请选择：${candidates.join("、")}。` : `Choose a merchant for "${target}": ${candidates.join(", ")}.`;
  }
  if (result.errorCode === "not_found") return language === "zh"
    ? (result.resolution?.field === "months" ? `“${target}”没有足够的月度数据，暂时无法生成趋势。` : `当前可用数据中未找到“${target}”，请核对目标名称或编号。`)
    : `No matching data is available for "${target}". Check the target or period.`;
  if (["invalid_arguments", "invalid_filter"].includes(result.errorCode || "")) return language === "zh" ? "查询条件暂不支持，请核对目标、指标或筛选条件。" : "Check the target, metric or filters for this query.";
  return language === "zh" ? `“${target}”的数据查询暂不可用，请稍后重试。` : `Data for "${target}" is temporarily unavailable. Please retry.`;
}

export function missingDataResponse(language: UiLanguage, reason = "agent_no_tool_plan"): string {
  if (reason === "agent_plan_truncated") return language === "zh"
    ? "本次未能完成查询计划，数据查询尚未执行。请重试当前问题；商户、时间范围和指标条件已保留。"
    : "The query plan could not be completed, so no data lookup was executed. Retry this question; the targets, period and metrics have been preserved.";
  return language === "en"
    ? `I do not have a verifiable data source for this request. ${reason === "agent_no_tool_plan" ? "No executable data lookup was planned." : "The planning service is temporarily unavailable."} Retry this question or use a query command.`
    : `本次尚未取得可验证的数据来源。${reason === "agent_no_tool_plan" ? "未生成可执行的数据查询计划。" : "规划服务暂时不可用。"}请重试当前问题，或使用查询命令。`;
}

function rowMonth(row: Row): string {
  const value = text(firstValue(row, ["month", "monthKey", "reportMonth", "reportMonthKey", "date"]), 40);
  const match = value.match(/(20\d{2})[-\/]?(1[0-2]|0?[1-9])(?!\d)/);
  return match?.[1] && match[2] ? `${match[1]}-${match[2].padStart(2, "0")}` : value.slice(0, 7);
}

function monthlyData(row: Row, metric?: string): Record<string, unknown> {
  const result = merchantMonthlyData(row);
  const values = result.metrics as Record<string, number>;
  if (metric) {
    const key = metric === "affiliatePayout" ? "commission" : metric;
    result.value = typeof values[key] === "number" ? values[key] : null;
  }
  return result;
}

// 完整商户月度数据保留缺失值，避免把仅有月份的记录展示为零业绩。
function merchantMonthlyData(row: Row): Record<string, unknown> {
  const fields: Record<string, string[]> = {
    clicks: ["clicks", "Clicks", "totalClicks"], orders: ["orders", "orderCount"],
    revenue: ["salesAmount", "revenue"], commission: ["affCommission", "affiliatePayout"],
    payout: ["allCommission", "payout"], epc: ["epc", "affEpc"], allEpc: ["allEpc"],
    aov: ["aov"], conversionRate: ["conversionRate"], dpv: ["dpv"], atc: ["atc"],
    directSales: ["directSales", "direct_sales"], haloSales: ["haloSales", "halo_sales"]
  };
  const metrics: Record<string, number> = {};
  Object.entries(fields).forEach(([key, aliases]) => {
    const raw = firstValue(row, aliases);
    if (raw === undefined) return;
    const value = Number(String(raw).replace(/[$,%]/g, "").replace(/,/g, ""));
    if (Number.isFinite(value)) metrics[key] = value;
  });
  return { month: rowMonth(row), metrics };
}

function tierDistribution(rows: readonly Row[]): Record<string, number> {
  const result: Record<string, number> = {};
  rows.forEach((row) => {
    const tier = rowTier(row) || "Unknown";
    result[tier] = (result[tier] || 0) + 1;
  });
  return result;
}

function categorySummary(rows: readonly Row[], category: string): Record<string, unknown> {
  const sorted = rows.slice().sort((left, right) => (metricValues(right).revenue || 0) - (metricValues(left).revenue || 0));
  return {
    category,
    merchantCount: new Set(rows.map(merchantId).filter(Boolean)).size || rows.length,
    aggregates: aggregate(rows),
    topMerchants: sorted.slice(0, 5).map((row) => ({ merchant: merchantObject(row), metrics: metricValues(row) }))
  };
}

function resolveMerchant(input: string, offers: readonly Row[]): { row?: Row; result?: AgentToolResult } {
  const resolution = resolveChatbotMerchant(input, offers);
  const query = normalizeChatbotText(input);
  // 工具参数是明确实体名，不能沿用全文搜索的内部短词命中。
  const matches = resolution.matches.filter(match => {
    if (match.score >= 110) return true;
    const name = normalizeChatbotText(merchantName(match.offer));
    return match.score >= 90 && !(query.startsWith(name) && query !== name && !/^\s/.test(query.slice(name.length)));
  });
  if (resolution.status === "resolved" && matches[0]?.offer) return { row: matches[0].offer };
  const candidates = matches.slice(0, 10).map((match) => {
    const row = match.offer;
    return {
      merchantId: merchantId(row),
      name: merchantName(row),
      ...(rowTier(row) ? { tier: rowTier(row) } : {}),
      ...(rowCategories(row)[0] ? { category: rowCategories(row)[0] } : {})
    };
  });
  return {
    result: failure("not_found", offers.length ? "cache" : "unavailable", {
      status: resolution.status === "ambiguous" ? "invalid_filter" : "not_found",
      field: "merchant",
      candidates,
      value: text(input, 80)
    })
  };
}

function paymentStatusValue(row: Row): string {
  const value = text(firstValue(row, ["paymentStatus", "status"]), 40).toLowerCase();
  if (value.includes("overdue") || value.includes("\u903e\u671f")) return "overdue";
  if (value.includes("unpaid") || value.includes("\u672a\u4ed8") || value.includes("\u672a\u652f\u4ed8")) return "unpaid";
  if (value.includes("pending") || value.includes("\u5f85\u5904\u7406") || value.includes("\u5f85\u4ed8\u6b3e")) return "pending";
  if (value.includes("partial") || value.includes("\u90e8\u5206")) return "partial";
  if (value.includes("paid") || value.includes("\u5df2\u4ed8") || value.includes("\u5df2\u652f\u4ed8")) return "paid";
  return value;
}

function paymentMonthValue(row: Row): string {
  return text(firstValue(row, ["reportMonthKey", "monthKey", "reportMonth", "month"]), 20);
}

function paymentRowData(row: Row): Record<string, unknown> {
  return {
    merchant: text(row.merchantName || row.brand || merchantId(row), 120),
    ...(rowTier(row) ? { tier: rowTier(row) } : {}),
    month: paymentMonthValue(row),
    status: paymentStatusValue(row),
    ...(text(row.paymentCycle, 40) ? { cycle: text(row.paymentCycle, 40) } : {}),
    expected: rounded(numberFor(row, ["expectedPaymentAmount", "expectedAmount", "amount"])),
    remaining: rounded(numberFor(row, ["remainingAmount", "remaining"])),
    due: text(row.paymentAvailabilityDate || row.expectedPaymentDate, 40)
  };
}

function paymentMerchantMatches(row: Row, merchant: Row): boolean {
  const id = merchantId(merchant);
  const name = normalizeChatbotText(merchantName(merchant));
  return Boolean((id && merchantId(row) === id) || (name && normalizeChatbotText(text(row.merchantName || row.brand)) === name));
}

function metricKey(value: unknown): string | null {
  const key = text(value, 40);
  return ["revenue", "orders", "epc", "aov", "clicks", "affiliatePayout", "dpv", "atc", "conversionRate", "payout", "directSales", "haloSales"].includes(key)
    ? key : null;
}

function trendRows(rows: readonly Row[], requestedMonths: number, metric: string): Record<string, unknown>[] {
  const grouped = new Map<string, Row[]>();
  rows.forEach((row) => {
    const month = rowMonth(row);
    if (!/^20\d{2}-\d{2}$/.test(month)) return;
    grouped.set(month, [...(grouped.get(month) || []), row]);
  });
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).slice(-requestedMonths).map(([month, monthRows]) => {
    const metrics = aggregate(monthRows);
    const additional: Record<string, string[]> = { payout: ["payout", "allCommission"], directSales: ["directSales", "direct_sales"], haloSales: ["haloSales", "halo_sales"], dpv: ["dpv", "detailPageViews"], atc: ["atc", "addToCart"] };
    Object.entries(additional).forEach(([key, aliases]) => {
      const values = monthRows.map(row => nullableNumberFor(row, aliases)).filter((value): value is number => value !== null);
      metrics[key] = values.length ? values.reduce((sum, value) => sum + value, 0) : null;
    });
    const value = metrics[metric === "affiliatePayout" ? "commission" : metric];
    return { month, value: typeof value === "number" ? value : null, metrics };
  });
}

function trendSummary(rows: readonly Record<string, unknown>[]): Record<string, unknown> {
  const first = typeof rows[0]?.value === "number" ? rows[0].value as number : null;
  const latest = typeof rows.at(-1)?.value === "number" ? rows.at(-1)!.value as number : null;
  const changeRate = first === null || latest === null || first === 0 ? null : Math.round(((latest - first) / first) * 1_000_000) / 1_000_000;
  return {
    first,
    latest,
    startMonth: text(rows[0]?.month, 10),
    endMonth: text(rows.at(-1)?.month, 10),
    change: first === null || latest === null ? null : rounded(latest - first),
    changeRate,
    changeRateDisplay: changeRate === null ? null : `${(changeRate * 100).toFixed(2)}%`
  };
}

function requestedMetrics(prompt: string): string[] {
  const result: string[] = [];
  const patterns: Array<[string, RegExp]> = [
    ["conversionRate", /cvr|conversion|\u8f6c\u5316/i],
    ["affiliatePayout", /affiliate|commission|payout|\u4f63\u91d1/i],
    ["revenue", /revenue|sales|\u6536\u5165|\u9500\u552e/i],
    ["orders", /orders?|\u8ba2\u5355/i],
    ["clicks", /clicks?|\u70b9\u51fb/i],
    ["epc", /\bepc\b/i],
    ["aov", /\baov\b/i]
  ];
  patterns.forEach(([name, pattern]) => { if (pattern.test(prompt)) result.push(name); });
  return result.slice(0, 12);
}

export function createAgentSession(options: AgentSessionOptions): AgentSession {
  const offers = options.offers.slice();
  const paymentRecords = (options.paymentRecords || []).slice();
  const storage = options.storage;
  const fetcher = options.fetcher || ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const loadPromotionReport = options.loadPromotionReport;
  const listeners = new Set<(state: AgentSessionState) => void>();
  let currentLanguage: UiLanguage = options.language;
  let status: AgentRunStatus = "idle";
  let history: AgentHistoryMessage[] = [];
  let messages: AgentHistoryMessage[] = [];
  let steps: AgentTimelineStep[] = [];
  let resultViews: AgentResultView[] = [];
  let planningAsins: readonly string[] = [];
  let planningContext: { memory: string; history: AgentHistoryMessage[] } = { memory: "", history: [] };
  let response = "";
  let partial = false;
  let omittedTargets: string[] = [];
  let errorCode: string | null = null;
  let memory = options.storage ? loadAgentMemory(options.storage) : emptyAgentMemory();
  let activeController: AbortController | null = null;
  let disposed = false;
  let activeCallbacks: AgentSessionCallbacks | null = null;
  let currentQuestion: QuestionContext | null = null;
  const answerContexts = new Map<string, QuestionContext>();
  let lastResultOk = false;
  let traceQueue: Promise<void> = Promise.resolve();

  function state(): AgentSessionState {
    return {
      status,
      history: history.slice(-MAX_HISTORY),
      messages: messages.slice(-MAX_HISTORY),
      steps: steps.map((step) => ({ ...step })),
      resultViews: normalizeAgentResultViews(resultViews),
      response,
      partial,
      omittedTargets: omittedTargets.slice(0, 20),
      hasMemory: Boolean(memory.focus.merchants.length || memory.focus.categories.length || memory.focus.tiers.length || memory.lastTool),
      memory,
      ...(errorCode ? { errorCode } : {})
    };
  }

  function notify(): void {
    if (disposed) return;
    const next = state();
    listeners.forEach((listener) => listener(next));
    activeCallbacks?.onChange?.(next);
  }

  function emitStep(step: AgentTimelineStep): void {
    const index = steps.findIndex((item) => item.id === step.id);
    if (index < 0) steps = [...steps, step];
    else steps = steps.map((item, itemIndex) => itemIndex === index ? step : item);
    activeCallbacks?.onTimeline?.(step);
    notify();
  }

  function emitResultView(view: AgentResultView): void {
    const index = resultViews.findIndex((item) => item.id === view.id);
    resultViews = index < 0
      ? normalizeAgentResultViews([...resultViews, view])
      : normalizeAgentResultViews(resultViews.map((item, itemIndex) => itemIndex === index ? view : item));
    activeCallbacks?.onResultView?.(view);
    notify();
  }

  function updateStep(id: string, update: Partial<AgentTimelineStep>): void {
    const existing = steps.find((step) => step.id === id);
    if (existing) emitStep({ ...existing, ...update });
  }

  async function requestJson<T extends JsonPayload>(url: string, init: RequestInit = {}, signal?: AbortSignal, timeoutMs = 10_000): Promise<T> {
    const controller = new AbortController();
    const linked = linkSignal(signal, controller.signal);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await fetcher(url, {
        credentials: "same-origin",
        cache: "no-store",
        ...init,
        headers: { Accept: "application/json", ...(init.headers || {}) },
        signal: linked.signal
      });
      if (result.status === 401 || result.status === 403) notifyAuthFailure(result.status);
      let payload: unknown = null;
      try {
        payload = await result.json();
      } catch {
        throw new Error("invalid_json");
      }
      if (!result.ok || (isRecord(payload) && payload.ok === false)) {
        const error = new Error(safeErrorCode(isRecord(payload) ? payload.errorCode : undefined));
        (error as Error & { code?: string }).code = safeErrorCode(isRecord(payload) ? payload.errorCode : undefined);
        if (url === "/api/chat/agent" && isRecord(payload) && (payload.round === 1 || payload.round === 2)) {
          (error as Error & { round?: number }).round = payload.round;
        }
        throw error;
      }
      return (isRecord(payload) ? payload : {}) as T;
    } catch (error) {
      if (controller.signal.aborted && !signal?.aborted) {
        const timeout = new Error("请求超时") as Error & { code?: string };
        timeout.code = url === "/api/chat/agent" ? "llm_timeout" : "tool_timeout";
        throw timeout;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      linked.dispose();
    }
  }

  function enqueueTrace(body: Record<string, unknown>): void {
    if (options.enableTrace === false) return;
    traceQueue = traceQueue
      .then(() => requestJson<JsonPayload>("/api/chat/stream?operation=agent_trace", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body)
      }))
      .then(() => undefined)
      .catch(() => undefined);
  }

  function beginTrace(questionEventId: string): TraceContext {
    const trace: TraceContext = {
      runId: randomUuid(),
      questionEventId,
      sessionId: getSessionId(storage),
      startedAt: new Date().toISOString(),
      language: currentLanguage
    };
    enqueueTrace({
      runId: trace.runId,
      questionEventId: trace.questionEventId,
      sessionId: trace.sessionId,
      mode: "agent",
      language: trace.language,
      status: "running",
      startedAt: trace.startedAt,
      planningBypassed: false,
      partial: false,
      fallbackDelivered: false,
      stoppedByUser: false,
      plannedToolCalls: 0,
      executedToolCalls: 0,
      failedToolCalls: 0
    });
    return trace;
  }

  function appendTraceStep(trace: TraceContext, step: AgentTimelineStep, sequence: number): void {
    const statusValue = step.status === "done" ? "success" : step.status === "stopped" ? "stopped" : step.status === "timeout" ? "timeout" : "failed";
    enqueueTrace({
      runId: trace.runId,
      questionEventId: trace.questionEventId,
      sessionId: trace.sessionId,
      steps: [{
        stepId: randomUuid(),
        runId: trace.runId,
        questionEventId: trace.questionEventId,
        sequence,
        phase: step.phase,
        toolName: step.phase === "tool" ? step.id.slice(5) : null,
        status: statusValue,
        durationMs: step.elapsedMs,
        dataSource: step.dataSource === "database" ? "database" : step.dataSource === "mixed" ? "mixed" : step.dataSource === "cache" ? "cache" : "unknown",
        dataAsOf: step.dataAsOf || null,
        estimated: step.estimated === true,
        errorCode: step.status === "error" ? "tool_error" : step.status === "timeout" ? "llm_timeout" : step.status === "stopped" ? "stopped_by_user" : null,
        usageAvailable: false,
        retryCount: 0
      }]
    });
  }

  function completeTrace(
    trace: TraceContext,
    result: {
      readonly status: AgentSessionResult["status"];
      readonly partial: boolean;
      readonly stopped: boolean;
      readonly fallback: boolean;
      readonly planned: number;
      readonly executed: number;
      readonly failed: number;
      readonly errorCode?: string | null;
    }
  ): void {
    const statusValue = result.status === "done" ? "success" : result.status === "stopped" ? "stopped" : result.status === "error" ? "failed" : "timeout";
    enqueueTrace({
      runId: trace.runId,
      questionEventId: trace.questionEventId,
      sessionId: trace.sessionId,
      mode: "agent",
      language: trace.language,
      status: statusValue,
      completedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - Date.parse(trace.startedAt)),
      partial: result.partial,
      fallbackDelivered: result.fallback,
      stoppedByUser: result.stopped,
      plannedToolCalls: result.planned,
      executedToolCalls: result.executed,
      failedToolCalls: result.failed,
      errorCode: result.errorCode || null
    });
  }

  function beginQuestion(prompt: string, eventId: string): void {
    currentQuestion = {
      eventId,
      prompt,
      language: currentLanguage,
      answer: "",
      recordPromise: options.enableQuestionLogging === false ? Promise.resolve(null) : requestJson<JsonPayload>("/api/chat/stream?operation=questions", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          action: "create",
          eventId,
          sessionId: getSessionId(storage),
          mode: "agent",
          prompt: text(prompt, 20_000),
          language: currentLanguage,
          intent: "agent"
        })
      }).then((payload) => text(payload.recordId, 128) ? { recordId: text(payload.recordId, 128) } : null).catch(() => null)
    };
  }

  function setQuestionAnswer(answer: string): void {
    if (currentQuestion) currentQuestion = { ...currentQuestion, answer: text(answer) };
  }

  function completeQuestion(statusValue: "success" | "failed"): Promise<{ readonly recordId: string } | null> {
    const question = currentQuestion;
    if (!question) return Promise.resolve(null);
    if (question.completionPromise) return question.completionPromise;
    question.completionPromise = question.recordPromise.then(async (record) => {
      if (!record || options.enableQuestionLogging === false) return record;
      try {
        await requestJson<JsonPayload>("/api/chat/stream?operation=questions", {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ action: "complete", recordId: record.recordId, sessionId: getSessionId(storage), status: statusValue, intent: "agent" })
        });
        return record;
      } catch {
        return null;
      }
    });
    answerContexts.set(question.eventId, question);
    while (answerContexts.size > 50) answerContexts.delete(answerContexts.keys().next().value!);
    return question.completionPromise;
  }

  function buildPlanningBody(
    question: string,
    language: UiLanguage,
    trace: TraceContext,
    promotionAttachment?: AgentPromotionAttachment,
    retry?: Record<string, unknown>,
    planningRound = 1,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      contractVersion: "v2",
      planningRound,
      question: text(question, 4_000),
      asinContext: planningAsins,
      context: planningContext,
      language,
      enabledTools: AGENT_TOOL_NAMES.filter((name) => promotionAttachment || name !== "promotion_analysis"),
      trace: { runId: trace.runId, questionEventId: trace.questionEventId, tracePhase: "planning" }
    };
    if (promotionAttachment) {
      body.promotionContext = promotionManifestForRequest(promotionAttachment);
    }
    if (retry) body.retry = retry;
    return body;
  }

  function parsePlan(payload: JsonPayload): AgentPlan | null {
    if (payload.ok !== true) return null;
    const agentRunId = text(payload.agentRunId, 128);
    if (!agentRunId) return null;
    const rawCalls = Array.isArray(payload.toolCalls) ? payload.toolCalls : [];
    const toolCalls: AgentToolCall[] = rawCalls.flatMap((value) => {
      if (!isRecord(value)) return [];
      const name = text(value.name, 64) as ToolName;
      const args = value.arguments;
      if (!AGENT_TOOL_NAMES.includes(name) || !isRecord(args)) return [];
      const id = text(value.id, 128);
      return id ? [{ id, name, arguments: { ...args } }] : [];
    });
    return {
      agentRunId,
      round: payload.round === 2 ? 2 : 1,
      ...(text(payload.planProof, 8_192) ? { planProof: text(payload.planProof, 8_192) } : {}),
      content: text(payload.content, 8_000),
      toolCalls
    };
  }

  async function plan(
    question: string,
    language: UiLanguage,
    trace: TraceContext,
    signal: AbortSignal,
    promotionAttachment?: AgentPromotionAttachment,
    retry?: Record<string, unknown>,
    planningRound = 1
  ): Promise<{ readonly plan?: AgentPlan; readonly errorCode?: string; readonly round?: number }> {
    try {
      const payload = await requestJson<JsonPayload>("/api/chat/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(buildPlanningBody(question, language, trace, promotionAttachment, retry, planningRound))
      // 首次 HTTP 规划可在服务端消耗两轮，每轮最多30秒；第二轮仅剩一次。
      }, signal, planningRound === 2 || retry ? 35_000 : 65_000);
      const parsed = parsePlan(payload);
      if (!parsed) return { errorCode: safeErrorCode(payload.errorCode || "agent_planning_unavailable"), round: payload.round === 2 ? 2 : planningRound };
      if (parsed.toolCalls.length && !parsed.planProof) return { errorCode: "agent_signing_unavailable" };
      return { plan: { ...parsed, round: planningRound === 2 ? 2 : parsed.round } };
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      return { errorCode: text((error as Error & { code?: string }).code, 64) || "agent_planning_unavailable", round: (error as Error & { round?: number }).round === 2 ? 2 : planningRound };
    }
  }

  async function merchantMonthlyRows(row: Row, months: number, signal: AbortSignal, full = false): Promise<{ rows: Row[]; checkedAt: string | null; merchant?: Row; errorCode?: "tool_timeout" | "tool_error" }> {
    const id = merchantId(row);
    if (!id) return { rows: [], checkedAt: null };
    const query = new URLSearchParams({ merchantId: id, months: String(months), ...(full ? { limit: "50" } : { minimal: "1" }) });
    try {
      const payload = await requestJson<JsonPayload>("/api/ui/db/merchant?" + query.toString(), {}, signal, full ? 30_000 : 10_000);
      if (full) {
        const monthly = mergeMerchantMonths(payload)[0]?.monthly;
        const rows = Array.isArray(monthly) ? monthly.filter(isRecord).sort((a, b) => rowMonth(b).localeCompare(rowMonth(a))) : [];
        return { rows, checkedAt: text(payload.checkedAt, 80) || null, ...(isRecord(payload.merchant) ? { merchant: payload.merchant } : {}) };
      }
      const rows = Array.isArray(payload.monthlyAmazonMetrics)
        ? (mergeMerchantMonths(payload)[0]?.monthly as Row[] || [])
        : Array.isArray(payload.monthlyMetrics)
          ? payload.monthlyMetrics.filter(isRecord)
          : [];
      return { rows, checkedAt: text(payload.checkedAt, 80) || null };
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      return { rows: [], checkedAt: null, errorCode: (error as Error & { code?: string }).code === "tool_timeout" ? "tool_timeout" : "tool_error" };
    }
  }

  async function executeAsinAnalysis(args: Record<string, unknown>, signal: AbortSignal): Promise<AgentToolResult> {
    if (args.view !== undefined && args.view !== "details" && args.view !== "performance") return failure("invalid_arguments");
    const asins = normalizeAsins(args.asins);
    const unavailableSource: DataSource = offers.length ? "cache" : "unavailable";
    if (!asins) {
      return failure("invalid_arguments", unavailableSource, {
        status: "invalid_filter",
        field: "asins"
      });
    }
    const query = new URLSearchParams({ asins: asins.join(","), months: "12" });
    const payload = await requestJson<JsonPayload>("/api/ui/db/asin?" + query.toString(), {}, signal);
    const apiRows = Array.isArray(payload.rows) ? payload.rows.filter(isRecord) : [];
    const rows = apiRows.flatMap((row) => {
      const projected = asinSummaryRow(row);
      return projected ? [projected] : [];
    }).slice(0, 25);
    const monthly = apiRows.flatMap((row) => {
      const rowAsin = text(firstValue(row, ["asin", "ASIN"]), 20).toUpperCase();
      const rowMerchantName = merchantName(row);
      const rowMerchantId = merchantId(row);
      return (Array.isArray(row.monthly) ? row.monthly : [])
        .filter(isRecord)
        .flatMap((monthRow) => {
          const projected = asinMonthlyRow(monthRow, rowAsin, rowMerchantName, rowMerchantId);
          return projected ? [projected] : [];
        });
    }).slice(0, 100);
    const matched = new Set(rows.map((row) => text(row.asin, 20).toUpperCase()).filter(Boolean));
    const apiUnmatched = Array.isArray(payload.unmatched)
      ? payload.unmatched.map((value) => text(value, 20).toUpperCase()).filter((value) => ASIN_PATTERN.test(value))
      : [];
    const notFound = Array.from(new Set([
      ...apiUnmatched,
      ...asins.filter((asin) => !matched.has(asin))
    ])).filter((asin) => asins.includes(asin));
    const checkedAt = text(payload.checkedAt, 80) || options.dataAsOf || null;
    if (!rows.length) {
      return failure("not_found", "database", {
        status: "not_found",
        field: "asins",
        value: asins.join(",")
      });
    }
    const headline = currentLanguage === "en"
      ? `${asins.join(", ")} ASIN analysis`
      : `${asins.join("、")} ASIN 查询`;
    const note = monthly.length
      ? (currentLanguage === "en" ? "Monthly rows are loaded from database data." : "月份明细来自数据库真实数据。")
      : (currentLanguage === "en" ? "Product rows are loaded, but monthly performance is unavailable." : "已加载产品信息，但暂无可用的月份表现数据。")
    return success({
      asins,
      rows,
      monthly,
      notFound,
      headline,
      note,
      source: "database",
      dataAsOf: checkedAt
    }, "database", checkedAt);
  }

  function latestMonth(rows: readonly Row[], fallback: string | null): string | null {
    const months = rows.map(rowMonth).filter((value) => /^20\d{2}-\d{2}$/.test(value)).sort();
    return months.at(-1) || fallback;
  }

  async function executeMerchantAnalysis(args: Record<string, unknown>, signal: AbortSignal): Promise<AgentToolResult> {
    if (args.view !== undefined && args.view !== "overview" && args.view !== "top_asins") return failure("invalid_arguments");
    const input = text(args.merchant, 80);
    if (!input) return failure("invalid_arguments", offers.length ? "cache" : "unavailable", { status: "invalid_filter", field: "merchant" });
    const resolved = resolveMerchant(input, offers);
    if (!resolved.row) return resolved.result || failure("not_found");
    const row = resolved.row;
    if (args.view === "top_asins") {
      const raw = row.topAsins;
      const topAsins = Array.isArray(raw)
        ? [...new Set(raw.filter((value): value is string => typeof value === "string")
          .map((value) => value.trim().toUpperCase()).filter((value) => ASIN_PATTERN.test(value)))].slice(0, 5)
        : [];
      const status = topAsins.length ? "available" : Array.isArray(raw) && raw.length === 0 ? "empty" : "unavailable";
      const context = options.asinRankingContext;
      const version = typeof context?.version === "number" && Number.isInteger(context.version) && context.version > 0 ? context.version : null;
      const basis = version === 1 || version === 2 || version === 3 ? "period_revenue_desc_then_asin" : "unknown";
      const revenueRows = Array.isArray(row.topAsinMetrics) ? row.topAsinMetrics.filter(isRecord) : [];
      const topAsinMetrics = topAsins.map(asin => {
        const value = revenueRows.find(metric => metric.asin === asin)?.periodRevenue;
        return { asin, periodRevenue: typeof value === "number" && Number.isFinite(value) ? value : null };
      });
      const date = (value: unknown): string | null => {
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
        const parsed = new Date(value);
        return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
      };
      let startDate = date(context?.startDate);
      let endDate = date(context?.endDate);
      if (startDate && endDate && startDate > endDate) { startDate = null; endDate = null; }
      const dataAsOf = text(options.dataAsOf, 100) || null;
      const en = currentLanguage === "en";
      const availability = status === "empty"
        ? (en ? "No Top ASINs provided in this snapshot." : "当前快照未提供该商家的 Top ASIN。")
        : status === "unavailable" ? (en ? "Top ASIN data is unavailable." : "Top ASIN 数据不可用。") : "";
      const rankingNote = basis === "unknown"
        ? (en ? "Ranking basis is unknown; snapshot order is preserved." : "排序口径未知，保留快照原有顺序。")
        : (en ? "Positive period revenue descending; ties and remaining slots use ASIN code order. Entries may have no sales." : "按期间单品正营收降序，同营收及剩余位置按 ASIN 编码补齐；不代表全部有成交。");
      const note = [availability, rankingNote,
        en ? `Snapshot range: ${startDate || "unknown"} to ${endDate || "unknown"}; as of ${dataAsOf || "unknown"}.`
          : `快照区间：${startDate || "未知"} 至 ${endDate || "未知"}；数据日期：${dataAsOf || "未知"}。`,
        en ? "Current snapshot only, up to 5 per merchant; other periods and larger lists are not queried."
          : "仅提取当前快照，每家最多 5 个；未查询其他期间或更多商品。"
      ].filter(Boolean).join(" ");
      return success({ merchant: merchantObject(row), topAsins, topAsinMetrics,
        asinRanking: { status, basis, limit: 5, returned: topAsins.length, startDate, endDate, dataAsOf, version },
        headline: `${merchantName(row)} · Top ASIN`, note
      }, "cache", dataAsOf);
    }
    const monthlyResult = await merchantMonthlyRows(row, 12, signal, true);
    const monthly = monthlyResult.rows.map(merchantMonthlyData);
    const name = merchantName(row);
    const data: Record<string, unknown> = {
      ...merchantData({ ...row, ...monthlyResult.merchant }),
      ranks: {},
      comparisons: {
        global: aggregate(offers),
        tier: aggregate(offers.filter((item) => rowTier(item) === rowTier(row)))
      },
      strengths: [],
      weaknesses: [],
      paymentRisk: null,
      peers: offers.filter((item) => rowTier(item) === rowTier(row) && merchantId(item) !== merchantId(row)).slice(0, 3).map(merchantObject),
      latestMonth: latestMonth(monthlyResult.rows, options.dataAsOf || null),
      monthly,
      monthlyDataAvailable: monthly.length > 0,
      monthlyDataSource: monthly.length ? "database" : "unavailable",
      monthlyNote: currentLanguage === "zh"
        ? (monthly.length ? "月度数据来自数据库，缺失指标显示为未提供。" : "月度数据暂不可用，当前指标来自商户缓存。")
        : (monthly.length ? "Monthly data is loaded from the database; missing metrics are not provided." : "Monthly data is unavailable; current metrics use the offer cache."),
      headline: name + (currentLanguage === "zh" ? " · 商户分析" : " merchant analysis"),
      note: "Merchant details and merged monthly rows use the full database endpoint; missing merchant fields and comparisons use the current offer cache."
    };
    return success(data, monthly.length ? "mixed" : "cache", monthlyResult.checkedAt || options.dataAsOf || null);
  }

  function resolveCategoryRows(input: string, rows: readonly Row[]): { category?: string; rows: Row[] } {
    const category = resolveChatbotCategory(input, normalizedCategories(rows));
    if (!category) return { rows: [] };
    return { category, rows: rows.filter((row) => rowMatchesCategory(row, category)) };
  }

  async function executeCategoryAnalysis(args: Record<string, unknown>): Promise<AgentToolResult> {
    const input = text(args.category, 120);
    if (!input) return failure("invalid_arguments", offers.length ? "cache" : "unavailable", { status: "invalid_filter", field: "category" });
    const resolved = resolveCategoryRows(input, offers);
    if (!resolved.category || !resolved.rows.length) {
      return failure("not_found", offers.length ? "cache" : "unavailable", { status: "not_found", field: "category", value: input });
    }
    const data: Record<string, unknown> = {
      ...categorySummary(resolved.rows, resolved.category),
      tierDistribution: tierDistribution(resolved.rows),
      vsGlobal: { category: aggregate(resolved.rows), global: aggregate(offers) },
      headline: resolved.category + " category analysis",
      note: "Category metrics are calculated from cached offer rows."
    };
    return success(data, "cache", options.dataAsOf || null);
  }

  async function executeMerchantComparison(args: Record<string, unknown>): Promise<AgentToolResult> {
    const names = Array.isArray(args.merchants) ? args.merchants.map((item) => text(item, 80)).filter(Boolean).slice(0, 5) : [];
    if (names.length < 2) return failure("invalid_arguments", offers.length ? "cache" : "unavailable", { status: "invalid_filter", field: "merchants" });
    const rows: Row[] = [];
    const notFound: string[] = [];
    names.forEach((name) => {
      const resolved = resolveMerchant(name, offers);
      if (resolved.row) rows.push(resolved.row);
      else notFound.push(name);
    });
    if (notFound.length || rows.length < 2) {
      return failure("not_found", offers.length ? "cache" : "unavailable", { status: "not_found", field: "merchants", candidates: notFound });
    }
    const base = metricValues(rows[0]!);
    const entities = rows.map((row) => ({ merchant: merchantObject(row), tier: rowTier(row), category: rowCategories(row)[0] || null, metrics: metricValues(row) }));
    const deltas = entities.map((entity) => ({
      merchant: entity.merchant,
      metrics: Object.fromEntries(Object.entries(entity.metrics).map(([key, value]) => [key, value === null || base[key] === null || base[key] === undefined ? null : rounded(value - base[key])]))
    }));
    return success({
      entities,
      notFound: [],
      deltas,
      pairwiseDeltas: deltas,
      headline: currentLanguage === "zh" ? "商户对比" : "Merchant comparison",
      note: currentLanguage === "zh" ? "指标来自当前商户快照，完整对比见结果表；缺失指标显示未提供。" : "Metrics use the current offer snapshot; see the result table for the full comparison. Missing metrics are not provided."
    }, "cache", options.dataAsOf || null);
  }

  function validTier(input: unknown): string | null {
    const value = canonicalChatbotTier(input);
    return ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"].includes(value) ? value : null;
  }

  async function executeTierAnalysis(args: Record<string, unknown>): Promise<AgentToolResult> {
    const tier = validTier(args.tier);
    if (!tier) return failure("invalid_filter", offers.length ? "cache" : "unavailable", { status: "invalid_filter", field: "tier", allowed: ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"] });
    const rows = offers.filter((row) => rowTier(row) === tier).sort((left, right) => (metricValues(right).revenue || 0) - (metricValues(left).revenue || 0));
    if (!rows.length) return failure("not_found", offers.length ? "cache" : "unavailable", { status: "not_found", field: "tier", value: tier });
    const limitValue = Number(args.limit);
    const offsetValue = Number(args.offset);
    const limit = Number.isInteger(limitValue) && limitValue > 0 ? Math.min(100, limitValue) : 100;
    const offset = Number.isInteger(offsetValue) && offsetValue > 0 ? Math.min(rows.length, offsetValue) : 0;
    const page = rows.slice(offset, offset + limit);
    const merchants = page.map((row) => ({ merchant: merchantObject(row), category: rowCategories(row)[0] || null, metrics: metricValues(row) }));
    return success({
      tier,
      merchantCount: rows.length,
      aggregates: aggregate(rows),
      vsOtherTiers: {},
      segments: { head: Math.ceil(page.length / 3), mid: 0, tail: 0 },
      outliers: [],
      merchantList: { total: rows.length, offset, limit, returned: page.length, hasMore: offset + page.length < rows.length },
      merchants,
      headline: tier + " merchant list",
      note: "Merchants follow the current Tier report order and are paginated."
    }, "cache", options.dataAsOf || null);
  }

  async function executeCategoryComparison(args: Record<string, unknown>): Promise<AgentToolResult> {
    const names = Array.isArray(args.categories) ? args.categories.map((item) => text(item, 120)).filter(Boolean).slice(0, 4) : [];
    if (names.length < 2) return failure("invalid_arguments", offers.length ? "cache" : "unavailable", { status: "invalid_filter", field: "categories" });
    const entities: Record<string, unknown>[] = [];
    const missing: string[] = [];
    names.forEach((name) => {
      const resolved = resolveCategoryRows(name, offers);
      if (resolved.category && resolved.rows.length) entities.push(categorySummary(resolved.rows, resolved.category));
      else missing.push(name);
    });
    if (entities.length < 2) return failure("not_found", offers.length ? "cache" : "unavailable", { status: "not_found", field: "categories", candidates: missing });
    return success({
      tierFilter: validTier(args.tier),
      entities,
      headline: "Category comparison",
      note: "Category comparison values are calculated from cached offer rows."
    }, "cache", options.dataAsOf || null);
  }

  function normalizePaymentMonth(value: string, prompt: string): string {
    if (!value) return "";
    if (/20\d{2}/.test(prompt)) return value;
    const match = value.match(/(?:20\d{2}-)?(0?[1-9]|1[0-2])$/);
    return match?.[1] ? String(new Date().getFullYear()) + "-" + match[1].padStart(2, "0") : value;
  }

  async function executePaymentStatus(args: Record<string, unknown>, prompt: string): Promise<AgentToolResult> {
    const statusFilter = text(args.status, 24).toLowerCase();
    const tierFilter = args.tier ? validTier(args.tier) : null;
    if (args.tier && !tierFilter) return failure("invalid_filter", paymentRecords.length ? "cache" : "unavailable", { status: "invalid_filter", field: "tier" });
    const merchantFilter = args.merchant ? resolveMerchant(text(args.merchant, 80), offers) : undefined;
    if (args.merchant && !merchantFilter?.row) return merchantFilter?.result || failure("not_found");
    const monthFilter = normalizePaymentMonth(text(args.month, 20), prompt);
    let rows = paymentRecords.slice();
    if (statusFilter) rows = rows.filter((row) => paymentStatusValue(row) === statusFilter);
    if (tierFilter) rows = rows.filter((row) => rowTier(row) === tierFilter);
    if (monthFilter) rows = rows.filter((row) => paymentMonthValue(row) === monthFilter);
    if (merchantFilter?.row) rows = rows.filter((row) => paymentMerchantMatches(row, merchantFilter.row!));
    const projected = rows.slice(0, 30).map(paymentRowData);
    const countBy = (value: string): number => rows.filter((row) => paymentStatusValue(row) === value).length;
    return success({
      filter: { status: statusFilter || null, month: monthFilter || null, tier: tierFilter, merchant: args.merchant ? text(args.merchant, 80) : null },
      summary: {
        recordCount: rows.length,
        merchantCount: new Set(rows.map(merchantId).filter(Boolean)).size,
        unpaid: countBy("unpaid"),
        pending: countBy("pending"),
        paid: countBy("paid"),
        overdue: countBy("overdue"),
        totalExpected: rounded(rows.reduce((sum, row) => sum + numberFor(row, ["expectedPaymentAmount", "amount"]), 0)),
        totalRemaining: rounded(rows.reduce((sum, row) => sum + numberFor(row, ["remainingAmount"]), 0))
      },
      rows: projected,
      headline: "Payment status",
      note: "Payment rows are read from the current payment cache."
    }, paymentRecords.length ? "cache" : "unavailable", options.dataAsOf || null);
  }

  async function executeTrend(args: Record<string, unknown>, signal: AbortSignal): Promise<AgentToolResult> {
    const target = text(args.target, 80);
    if (!target) return failure("invalid_arguments", offers.length ? "cache" : "unavailable", { status: "invalid_filter", field: "target" });
    const monthsValue = Number(args.months);
    const months = Number.isInteger(monthsValue) && monthsValue >= 2 && monthsValue <= 24 ? monthsValue : 12;
    const metric = metricKey(args.metric) || "revenue";
    const entityType = text(args.entityType, 20).toLowerCase() || "merchant";
    let trend: Record<string, unknown>[] = [];
    let dataSource: DataSource = "cache";
    let dataAsOf = options.dataAsOf || null;
    let estimated = true;
    let label = target;
    let monthlyError: "tool_timeout" | "tool_error" | undefined;
    if (entityType === "merchant") {
      const resolved = resolveMerchant(target, offers);
      if (!resolved.row) return resolved.result || failure("not_found");
      label = merchantName(resolved.row);
      const monthlyResult = await merchantMonthlyRows(resolved.row, months, signal);
      monthlyError = monthlyResult.errorCode;
      trend = monthlyResult.rows.map((row) => monthlyData(row, metric)).filter((row) => /^20\d{2}-\d{2}$/.test(String(row.month)));
      dataAsOf = monthlyResult.checkedAt || dataAsOf;
      if (trend.length >= 2) {
        dataSource = "database";
        estimated = false;
      } else {
        trend = trendRows([resolved.row], months, metric);
      }
    } else if (entityType === "category") {
      const resolved = resolveCategoryRows(target, offers);
      if (!resolved.category || !resolved.rows.length) return failure("not_found", offers.length ? "cache" : "unavailable", { status: "not_found", field: "category", value: target });
      label = resolved.category;
      trend = trendRows(resolved.rows, months, metric);
    } else if (entityType === "tier") {
      const tier = validTier(target);
      if (!tier) return failure("invalid_filter", offers.length ? "cache" : "unavailable", { status: "invalid_filter", field: "tier", value: target });
      label = tier;
      trend = trendRows(offers.filter((row) => rowTier(row) === tier), months, metric);
    } else {
      return failure("invalid_filter", offers.length ? "cache" : "unavailable", { status: "invalid_filter", field: "entityType" });
    }
    if (trend.length < 2 && monthlyError) return failure(monthlyError, "unavailable", { status: "unavailable", field: "monthly_data", value: target });
    if (trend.length < 2) return failure("not_found", dataSource, { status: "not_found", field: "months", value: months });
    trend.sort((left, right) => String(left.month).localeCompare(String(right.month)));
    const summary = trendSummary(trend);
    summary.requestedMonths = months;
    summary.availableMonths = trend.length;
    const asOfMonth = dataAsOf?.slice(0, 7);
    summary.latestMonthComplete = asOfMonth ? String(summary.endMonth) < asOfMonth : null;
    return success({
      entityType,
      target: label,
      estimated,
      metric,
      metrics: summary,
      months: trend,
      summary,
      headline: label + (currentLanguage === "zh" ? " · 月度趋势" : " trend"),
      note: currentLanguage === "zh"
        ? `${estimated ? "来自带月份的缓存记录。" : "月度数据来自数据库。"}请求最近${months}个月，实际有${trend.length}个月（${summary.startMonth}至${summary.endMonth}）；缺少月份不计为零。${summary.latestMonthComplete === false ? "最新月份尚未结束，不能直接与完整月份比较。" : ""}`
        : `${estimated ? "Trend points are estimated from dated cached rows." : "Trend points are loaded from monthly database data."} Requested ${months} months; ${trend.length} available (${summary.startMonth} to ${summary.endMonth}). Missing months are not zero.${summary.latestMonthComplete === false ? " The latest month is incomplete." : ""}`
    }, dataSource, dataAsOf, estimated);
  }

  async function executeKeywordSearch(args: Record<string, unknown>, signal: AbortSignal): Promise<AgentToolResult> {
    const keyword = typeof args.keyword === "string" ? args.keyword.trim() : "";
    const mode = args.mode === undefined ? "search" : args.mode;
    const limit = args.limit === undefined ? 10 : args.limit;
    const alternatives = args.semanticAlternatives === undefined ? [] : args.semanticAlternatives;
    const constraints = parseAgentKeywordConstraints(args);
    if (keyword.length < 2 || keyword.length > 120 || (mode !== "search" && mode !== "recommendation")
      || !Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 20
      || !Array.isArray(alternatives) || alternatives.length > 3
      || alternatives.some((value) => typeof value !== "string" || value.trim().length < 2 || value.trim().length > 120)
      || !constraints || Object.keys(args).some(key => !["keyword", "mode", "limit", "semanticAlternatives", "tiers", "metricFilters", "metricSort"].includes(key))) {
      return failure("invalid_arguments", "unavailable", { status: "invalid_filter", field: "keyword" });
    }
    const provider = createReportDataProvider({
      offers: options.getOffers?.() || offers,
      keywords: options.getProductKeywords?.() || {},
      source: "cache",
      asOf: options.dataAsOf || null,
      preferRemote: Boolean(options.loadOffers),
      loadOffers: options.loadOffers,
      loadKeywords: options.loadKeywords
    });
    const offerRows = await provider.offers(signal);
    let productKeywords: unknown = {};
    let keywordUnavailable = false;
    try {
      productKeywords = await provider.keywords(signal);
      if (isRecord(productKeywords) && productKeywords.ok === false) keywordUnavailable = true;
      else if (!Array.isArray(productKeywords) && (!isRecord(productKeywords)
        || (!Array.isArray(productKeywords.merchants) && !Array.isArray(productKeywords.rows)
          && !Array.isArray(productKeywords.keywords) && !Array.isArray(productKeywords.items)))) keywordUnavailable = true;
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      keywordUnavailable = true;
    }
    if (signal.aborted) throw new DOMException("Keyword search aborted", "AbortError");
    if (keywordUnavailable && !offerRows.length) {
      return failure("tool_error", "unavailable", { status: "unavailable", field: "keywords" });
    }
    const data = searchAgentKeywords(keyword, mode, Number(limit), offerRows, keywordUnavailable ? {} : productKeywords, currentLanguage, keywordUnavailable, alternatives, constraints);
    const source = provider.snapshot();
    const dataSource: DataSource = source.offersLoadedFrom === "db" ? "mixed" : "cache";
    const rawCheckedAt = isRecord(productKeywords) && typeof productKeywords.checkedAt === "string" ? productKeywords.checkedAt : "";
    const checkedAt = /^\d{4}-\d{2}-\d{2}/.test(rawCheckedAt) ? rawCheckedAt.slice(0, 40) : null;
    if (!data.matchedCount && keywordUnavailable) return failure("tool_error", "unavailable", { status: "unavailable", field: "keywords" });
    if (!data.matchedCount && normalizeChatbotText(keyword) !== "audio") {
      return failure("not_found", dataSource, { status: "not_found", field: "keyword", value: keyword });
    }
    const note = checkedAt
      ? `${data.note} ${currentLanguage === "zh" ? "关键词目录截至" : "Keyword catalog as of"} ${checkedAt}.`
      : data.note;
    return success({ ...data, note, ...(checkedAt ? { keywordCheckedAt: checkedAt } : {}) }, dataSource,
      source.offersLoadedFrom === "db" ? null : source.asOf);
  }

  async function executeTool(
    call: AgentToolCall,
    prompt: string,
    signal: AbortSignal,
    promotionAttachment?: AgentPromotionAttachment,
  ): Promise<AgentToolResult> {
    try {
      if (call.name === "merchant_analysis") return executeMerchantAnalysis(call.arguments, signal);
      if (call.name === "category_analysis") return executeCategoryAnalysis(call.arguments);
      if (call.name === "merchant_comparison") return executeMerchantComparison(call.arguments);
      if (call.name === "tier_analysis") return executeTierAnalysis(call.arguments);
      if (call.name === "category_comparison") return executeCategoryComparison(call.arguments);
      if (call.name === "payment_status") return executePaymentStatus(call.arguments, prompt);
      if (call.name === "asin_analysis") return executeAsinAnalysis(call.arguments, signal);
      if (call.name === "keyword_search") return executeKeywordSearch(call.arguments, signal);
      if (call.name === "promotion_analysis") {
        if (!promotionAttachment) return failure("invalid_arguments", "unavailable", { status: "invalid_filter", field: "attachment" });
        if (!loadPromotionReport) return failure("tool_error", "unavailable", { status: "unavailable", field: "promotion_report" });
        const execution = await executePromotionTool(
          promotionAttachment,
          call.arguments as unknown as PromotionToolArguments,
          loadPromotionReport,
          signal,
          currentLanguage,
          call.id,
        );
        return { ...execution.result, ...(execution.resultView ? { resultView: execution.resultView } : {}) };
      }
      return executeTrend(call.arguments, signal);
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      return failure("tool_error", offers.length ? "cache" : "unavailable");
    }
  }

  function toolTarget(call: AgentToolCall): string {
    const args = call.arguments;
    if (call.name === "merchant_analysis" || call.name === "trend") return text(args.merchant || args.target, 120) || call.name;
    if (call.name === "category_analysis") return text(args.category, 120) || call.name;
    if (call.name === "tier_analysis") return text(args.tier, 80) || call.name;
    if (call.name === "merchant_comparison") return Array.isArray(args.merchants) ? args.merchants.map((item) => text(item, 80)).join(", ") : call.name;
    if (call.name === "category_comparison") return Array.isArray(args.categories) ? args.categories.map((item) => text(item, 120)).join(", ") : call.name;
    if (call.name === "asin_analysis") return Array.isArray(args.asins) ? args.asins.map((item) => text(item, 20).toUpperCase()).join(", ") : call.name;
    if (call.name === "keyword_search") return text(args.keyword, 120) || call.name;
    if (call.name === "promotion_analysis") return text(args.view, 40) || call.name;
    return [args.merchant, args.month, args.status, args.tier].map((item) => text(item, 80)).filter(Boolean).join(" / ") || call.name;
  }

  function stepLabel(phase: AgentTimelineStep["phase"], target: string): string {
    if (currentLanguage === "en") return phase === "planning" ? "Plan data lookup" : phase === "tool" ? "Read " + target : "Compose answer";
    return phase === "planning" ? "\u89c4\u5212\u6570\u636e\u67e5\u8be2" : phase === "tool" ? "\u67e5\u8be2 " + target : "\u7efc\u5408\u56de\u7b54";
  }

  function makeStep(id: string, phase: AgentTimelineStep["phase"], stepStatus: AgentTimelineStep["status"], label: string, startedAt: number, result?: AgentToolResult): AgentTimelineStep {
    return {
      id,
      phase,
      status: stepStatus,
      label,
      ...(stepStatus === "running" ? {} : { elapsedMs: Math.max(0, Date.now() - startedAt) }),
      ...(result ? {
        dataSource: result.source.dataSource === "unavailable" ? "unavailable" : result.source.dataSource,
        dataAsOf: result.source.dataAsOf,
        ...(result.source.estimated ? { estimated: true } : {})
      } : {})
    };
  }

  const reusableResults = createAgentResultReuse();
  let pendingSource: ReusableAgentResult | null = null;
  let pendingCallCount = 0;

  async function executeCalls(
    calls: readonly AgentToolCall[],
    prompt: string,
    signal: AbortSignal,
    trace: TraceContext,
    promotionAttachment?: AgentPromotionAttachment,
  ): Promise<AgentToolExecution[]> {
    const started = new Map<string, number>();
    const results: AgentToolExecution[] = [];
    for (let offset = 0; offset < calls.length; offset += 4) {
      const batch = await Promise.all(calls.slice(offset, offset + 4).map(async (call) => {
        started.set(call.id, Date.now());
        emitStep(makeStep("tool-" + call.id, "tool", "running", stepLabel("tool", toolTarget(call)), started.get(call.id)!));
        const result = await executeTool(call, prompt, signal, promotionAttachment);
        const stepStatus: AgentTimelineStep["status"] = result.ok ? "done" : result.errorCode === "tool_timeout" ? "timeout" : "error";
        const step = makeStep("tool-" + call.id, "tool", stepStatus, stepLabel("tool", toolTarget(call)), started.get(call.id) || Date.now(), result);
        emitStep(step);
        appendTraceStep(trace, step, steps.findIndex((item) => item.id === step.id) + 1);
        const execution = { call, result };
        const view = result.resultView || resultViewFromExecution(execution);
        if (view) emitResultView(view);
        if (pendingSource && result.ok && !signal.aborted && !disposed) {
          pendingSource.toolResults = [...pendingSource.toolResults.filter(item => item.callId !== call.id), projectedToolResult(execution)].slice(0, MAX_TOOL_CALLS);
          pendingSource.partial = pendingSource.toolResults.length < pendingCallCount;
          pendingSource.resultViews = normalizeAgentResultViews(resultViews.filter(view => pendingSource!.toolResults.some(item => item.callId === view.id)));
          reusableResults.retain(pendingSource);
        }
        return execution;
      }));
      results.push(...batch);
    }
    return results;
  }

  function projectedToolResult(item: AgentToolExecution): Record<string, unknown> {
    const result = item.result;
    const projected: Record<string, unknown> = {
      callId: item.call.id,
      toolName: item.call.name,
      arguments: { ...item.call.arguments },
      result: {
        ok: result.ok,
        source: {
          dataSource: result.source.dataSource,
          dataAsOf: result.source.dataAsOf,
          estimated: result.source.estimated
        }
      }
    };
    if (result.ok) projected.result = { ...projected.result as Record<string, unknown>, data: result.data || {} };
    else {
      projected.result = {
        ...projected.result as Record<string, unknown>,
        errorCode: result.errorCode || "tool_error",
        ...(result.resolution ? { resolution: result.resolution } : {})
      };
    }
    return projected;
  }

  function resultViewFromExecution(item: AgentToolExecution): AgentResultView | null {
    const result = item.result;
    const data = result.ok && result.data ? result.data : {};
    if (item.call.name === "merchant_analysis" && Array.isArray(data.topAsins) && isRecord(data.merchant)) {
      const merchant = data.merchant;
      return normalizeAgentResultView({
        id: item.call.id, toolName: item.call.name, kind: data.topAsins.length ? "table" : "summary", status: "done",
        title: text(data.headline, 180), source: result.source.dataSource, dataAsOf: result.source.dataAsOf,
        columns: currentLanguage === "en" ? ["Merchant ID", "Merchant", "ASIN", "Period revenue"] : ["商家 ID", "商家", "ASIN", "期间收入"],
        rows: data.topAsins.map((asin, index) => {
          const revenue = Array.isArray(data.topAsinMetrics) ? data.topAsinMetrics.filter(isRecord).find(row => row.asin === asin)?.periodRevenue : null;
          return { label: String(index + 1), values: [text(merchant.id), text(merchant.name), text(asin),
            typeof revenue === "number" ? formatAgentResultNumber("revenue", revenue) : (currentLanguage === "en" ? "Not provided" : "未提供")] };
        }),
        metrics: [], message: text(data.note, 800), estimated: false, partial: false
      });
    }
    const scalar = (label: string, value: unknown): string => {
      if (typeof value === "number") return Number.isFinite(value) ? formatAgentResultNumber(label, value) : "";
      if (typeof value === "string" || typeof value === "boolean") return text(value, 120);
      return "";
    };
    if (result.ok && item.call.name === "trend" && Array.isArray(data.months)) {
      const sourceMonths = data.months.filter(isRecord).sort((left, right) => String(left.month).localeCompare(String(right.month)));
      const metric = text(data.metric, 40) || "revenue";
      const chartKey = (key: string) => key === "commission" ? "affiliatePayout" : key;
      const months: Record<string, string | number | null>[] = sourceMonths.map(row => ({
        month: text(row.month, 10),
        ...Object.fromEntries(Object.entries(isRecord(row.metrics) ? row.metrics : {}).map(([key, value]) => [chartKey(key), typeof value === "number" ? value : null])),
        [metric]: typeof row.value === "number" ? row.value : null
      }));
      const available = months.flatMap(row => Object.keys(row).filter(key => key !== "month" && typeof row[key] === "number"));
      const metrics = [...new Set([metric, ...available])];
      const summary = Object.fromEntries(metrics.map(key => {
        const first = months[0]?.[key];
        const last = months.at(-1)?.[key];
        return [key, { pct: typeof first === "number" && typeof last === "number" && first !== 0 ? (last - first) / first : null }];
      }));
      return normalizeAgentResultView({ id: item.call.id, toolName: item.call.name, kind: "trend", status: "done",
        title: text(data.headline, 180), source: result.source.dataSource, dataAsOf: result.source.dataAsOf,
        estimated: result.source.estimated, partial: false, metrics: [], columns: [], rows: [], message: text(data.note, 800),
        trend: { target: text(data.target, 180), metric, metrics, months, summary, estimated: result.source.estimated } });
    }
    if (result.ok && item.call.name === "merchant_comparison" && Array.isArray(data.entities)) {
      const keys = ["tier", "revenue", "epc", "conversionRate", "orders", "clicks", "aov", "commission"];
      const columns = currentLanguage === "zh" ? ["Tier", "销售额", "联盟 EPC", "转化率", "订单", "点击", "客单价", "联盟佣金"]
        : ["Tier", "Revenue", "Affiliate EPC", "CVR", "Orders", "Clicks", "AOV", "Affiliate commission"];
      return normalizeAgentResultView({ id: item.call.id, toolName: item.call.name, kind: "table", status: "done",
        title: currentLanguage === "zh" ? "商户对比" : "Merchant comparison", source: result.source.dataSource, dataAsOf: result.source.dataAsOf,
        estimated: false, partial: false, metrics: [], columns,
        rows: data.entities.filter(isRecord).map(entity => ({ label: isRecord(entity.merchant) ? text(entity.merchant.name, 120) : "",
          values: keys.map(key => scalar(key, key === "tier" ? entity.tier : isRecord(entity.metrics) ? entity.metrics[key] : undefined) || (currentLanguage === "zh" ? "未提供" : "Not provided")) })),
        message: currentLanguage === "zh" ? "使用当前商户快照的同口径指标进行对比。" : "Compared using the current offer snapshot." });
    }
    if (item.call.name === "keyword_search") {
      const sourceRows = Array.isArray(data.rows) ? data.rows.filter(isRecord) : [];
      const recommendation = data.mode === "recommendation";
      const columns = ["merchantId", "matchedField", "matchedText", ...(recommendation
        ? ["salesAmount", "orders", "conversionRate", "aov", "epc", "affCommission", "clicks"].filter((column) => sourceRows.some((row) => typeof row[column] === "number"))
        : [])];
      const rows = sourceRows.map((row) => ({
        label: `${recommendation && typeof row.rank === "number" ? `#${row.rank} · ` : ""}${text(row.merchantName, 120)}`,
        values: columns.map((column) => scalar(column, row[column]))
      })).filter((row) => row.label && row.values.some(Boolean));
      return normalizeAgentResultView({
        id: item.call.id, toolName: item.call.name,
        kind: result.ok ? (rows.length ? "table" : "summary") : "status",
        status: result.ok ? (data.partial === true || data.truncated === true ? "partial" : "done") : "error",
        title: text(data.headline, 180) || toolTarget(item.call),
        source: result.source.dataSource, dataAsOf: result.source.dataAsOf,
        estimated: false, partial: data.partial === true || data.truncated === true,
        metrics: [], columns: currentLanguage === "zh" ? columns.map(key => ({ merchantId: "商户 ID", matchedField: "匹配字段", matchedText: "命中依据", salesAmount: "销售额", orders: "订单", conversionRate: "转化率", aov: "客单价", epc: "联盟 EPC", affCommission: "联盟佣金", clicks: "点击" }[key] || key)) : columns, rows,
        message: result.ok ? text(data.note, 800) : keywordFailureMessage(result.errorCode, currentLanguage, toolTarget(item.call))
      });
    }
    if (item.call.name === "merchant_analysis" && Array.isArray(data.monthly) && data.monthly.length) {
      const keys = ["clicks", "orders", "revenue", "commission", "payout", "epc", "aov", "conversionRate"];
      const labels = currentLanguage === "en"
        ? ["Clicks", "Orders", "Revenue", "Affiliate commission", "Total commission", "Affiliate EPC", "AOV", "CVR"]
        : ["点击", "订单", "销售额", "联盟佣金", "总佣金", "联盟 EPC", "客单价", "转化率"];
      return normalizeAgentResultView({ id: item.call.id, toolName: item.call.name, kind: "table", status: "done",
        title: text(data.headline, 180), source: result.source.dataSource, dataAsOf: result.source.dataAsOf,
        columns: labels, rows: data.monthly.filter(isRecord).map(row => ({ label: text(row.month, 20),
          values: keys.map(key => scalar(key, isRecord(row.metrics) ? row.metrics[key] : undefined) || (currentLanguage === "en" ? "Not provided" : "未提供")) })),
        metrics: [], message: text(data.monthlyNote, 800), estimated: false, partial: false });
    }
    if (item.call.name === "asin_analysis") {
      const summarySource = Array.isArray(data.rows) ? data.rows.filter(isRecord) : [];
      const monthlySource = Array.isArray(data.monthly) ? data.monthly.filter(isRecord) : [];
      if (result.ok && (item.call.arguments.view === "details" || !monthlySource.length)) {
        return normalizeAgentResultView({
          id: item.call.id, toolName: item.call.name, kind: "table", status: "done",
          title: text(data.headline, 180), source: result.source.dataSource, dataAsOf: result.source.dataAsOf,
          columns: currentLanguage === "en" ? ["Field", "Value"] : ["信息", "内容"],
          rows: asinDetailRows(summarySource, currentLanguage), metrics: [],
          message: text(data.note, 800), partial: summarySource.length > 10, estimated: false
        });
      }
      const sourceRows = monthlySource.length ? monthlySource : summarySource;
      const preferredColumns = monthlySource.length
        ? ["month", "orders", "revenue", "commission", "epc", "aov", "conversionRate", "clicks"]
        : ["productName", "merchantName", "category", "orders", "revenue", "commission", "epc", "aov"];
      const columns = preferredColumns.filter((column) => sourceRows.some((row) => scalar(column, row[column]))).slice(0, 8);
      const rows = sourceRows.flatMap((value) => {
        const asin = scalar("asin", value.asin);
        const merchant = scalar("merchantName", value.merchantName) || scalar("merchant", value.merchant);
        const month = scalar("month", value.month);
        const label = [asin, merchant, month].filter(Boolean).join(" · ") || scalar("productName", value.productName);
        const values = columns.map((column) => scalar(column, value[column]));
        return label && values.some(Boolean) ? [{ label, values }] : [];
      }).slice(0, 100);
      return normalizeAgentResultView({
        id: item.call.id,
        toolName: item.call.name,
        kind: result.ok ? (rows.length ? "table" : "summary") : "status",
        status: result.ok ? "done" : "error",
        title: text(data.headline, 180) || toolTarget(item.call),
        source: result.source.dataSource,
        dataAsOf: result.source.dataAsOf,
        estimated: result.source.estimated,
        partial: false,
        metrics: [],
        columns,
        rows,
        message: result.ok ? text(data.note, 800) : result.errorCode || "tool_error"
      });
    }
    const metricSource = [data.metrics, data.aggregates, data.summary].find(isRecord) || {};
    const metrics = Object.entries(metricSource).flatMap(([label, value]) => {
      const metricValue = scalar(label, value);
      return metricValue ? [{ label: text(label, 80), value: metricValue }] : [];
    }).slice(0, 8);
    const rowSource = [data.rows, data.months, data.merchants, data.entities]
      .find((value) => Array.isArray(value)) as unknown[] | undefined;
    const firstRow = rowSource?.find(isRecord);
    const columns = firstRow
      ? Object.keys(firstRow).filter((key) => !["merchant", "name", "label", "month", "category"].includes(key)
        && scalar(key, firstRow[key])).slice(0, 6)
      : [];
    const rows = (rowSource || []).flatMap((value) => {
      if (!isRecord(value)) return [];
      const merchant = isRecord(value.merchant) ? text(value.merchant.name, 120) : scalar("merchant", value.merchant);
      const label = scalar("asin", value.asin) || merchant || scalar("name", value.name) || scalar("label", value.label) || scalar("month", value.month) || scalar("category", value.category);
      const values = columns.map((column) => scalar(column, value[column]));
      return label && values.some(Boolean) ? [{ label, values }] : [];
    }).slice(0, 16);
    return normalizeAgentResultView({
      id: item.call.id,
      toolName: item.call.name,
      kind: result.ok ? (rows.length ? "table" : metrics.length ? "metric" : "summary") : "status",
      status: result.ok ? "done" : "error",
      title: text(data.headline, 180) || toolTarget(item.call),
      source: result.source.dataSource,
      dataAsOf: result.source.dataAsOf,
      estimated: result.source.estimated,
      partial: false,
      metrics,
      columns,
      rows,
      message: result.ok ? text(data.note, 800) : toolFailureMessage(result, currentLanguage, toolTarget(item.call))
    });
  }

  async function executeFrontendTool(request: AgentToolExecutionRequest): Promise<AgentToolExecutionResponse> {
    const call: AgentToolCall = {
      id: text(request.callId, 128) || `tool-${Date.now()}`,
      name: request.toolName,
      arguments: isRecord(request.arguments) ? { ...request.arguments } : {}
    };
    const execution: AgentToolExecution = {
      call,
      result: await executeTool(call, text(request.prompt, 20_000), request.signal, request.promotionAttachment)
    };
    const nextMemoryEvent = memoryEvent(execution, request.prompt, false);
    const resultView = execution.result.resultView || resultViewFromExecution(execution);
    return {
      toolResult: projectedToolResult(execution),
      ...(nextMemoryEvent ? { memoryEvent: nextMemoryEvent } : {}),
      ...(resultView ? { resultView } : {})
    };
  }

  function fallbackAnswer(executions: readonly AgentToolExecution[], language: UiLanguage, omitted: readonly string[]): string {
    const lines: string[] = [];
    executions.forEach((item) => {
      const data = item.result.data || {};
      if (!item.result.ok) {
        lines.push(item.call.name === "keyword_search"
          ? keywordFailureMessage(item.result.errorCode, language, toolTarget(item.call))
          : toolFailureMessage(item.result, language, toolTarget(item.call)));
        return;
      }
      if (item.call.name === "asin_analysis" && Array.isArray(data.rows)) {
        const rows = data.rows.filter(isRecord);
        const asins = [...new Set(rows.map(row => text(row.asin, 20)).filter(Boolean))];
        if (asins.length > 1) {
          for (const asin of asins) {
            lines.push(fallbackAnswer([{ ...item, result: { ...item.result, data: { ...data,
              headline: asin, rows: rows.filter(row => row.asin === asin),
              monthly: Array.isArray(data.monthly) ? data.monthly.filter(isRecord).filter(row => row.asin === asin) : []
            } } }], language, []));
          }
          return;
        }
      }
      const headline = text(data.headline, 240);
      if (headline) lines.push(headline);
      if (item.call.name === "keyword_search" && Array.isArray(data.rows)) {
        const sourceRows = data.rows.filter(isRecord);
        const metrics = ["salesAmount", "orders", "conversionRate", "aov", "epc", "affCommission", "clicks"]
          .filter((field) => data.mode === "recommendation" && sourceRows.some((row) => typeof row[field] === "number"));
        const headings = language === "zh" ? ["排名", "商户", "Merchant ID", "命中字段", "命中依据"] : ["Rank", "Merchant", "Merchant ID", "Matched field", "Evidence"];
        const columns = [...(data.mode === "recommendation" ? headings : headings.slice(1)), ...metrics.map(key => agentMetricLabel(key, language))];
        lines.push(`| ${columns.join(" | ")} |\n| ${columns.map(() => "---").join(" | ")} |`);
        const cell = (value: unknown, maxLength: number): string => text(value, maxLength).replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
        sourceRows.forEach((row) => {
          const values = [
            ...(data.mode === "recommendation" ? [typeof row.rank === "number" ? `#${row.rank}` : "-"] : []),
            cell(row.merchantName, 120), cell(row.merchantId, 80), cell(row.matchedField, 40), cell(row.matchedText, 80),
            ...metrics.map((field) => typeof row[field] === "number" ? formatAgentResultNumber(field, row[field]) : "N/A")
          ];
          lines.push(`| ${values.join(" | ")} |`);
        });
        if (text(data.note, 800)) lines.push(text(data.note, 800));
      } else if (item.call.name === "asin_analysis" && Array.isArray(data.rows)) {
        const cell = (value: string) => value.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
        lines.push([
          language === "en" ? "| ASIN | Field | Value |\n| --- | --- | --- |" : "| ASIN | 信息 | 内容 |\n| --- | --- | --- |",
          ...asinDetailRows(data.rows.filter(isRecord), language).map((row) => `| ${cell(row.label)} | ${row.values.map(cell).join(" | ")} |`)
        ].join("\n"));
        lines.push(text(data.note, 800));
        if (item.call.arguments.view === "details") return;
        const performanceRows = data.rows.filter(isRecord).filter((row) => row.asinPerformanceAvailable !== false);
        if (performanceRows.length) {
          const headers = language === "en"
            ? "| ASIN | Merchant | Orders | Revenue | EPC | CVR |\n| --- | --- | ---: | ---: | ---: | ---: |"
            : "| ASIN | 商户 | 订单 | 销售额 | EPC | CVR |\n| --- | --- | ---: | ---: | ---: | ---: |";
          lines.push([headers, ...performanceRows.map((row) =>
            "| " + text(row.asin, 20) + " | " + text(row.merchantName, 120)
              + " | " + formatAgentResultNumber("orders", numberValue(row.orders))
              + " | " + formatAgentResultNumber("revenue", numberValue(row.revenue))
              + " | " + formatAgentResultNumber("epc", numberValue(row.epc))
              + " | " + formatAgentResultNumber("conversionRate", numberValue(row.conversionRate)) + " |")].join("\n"));
        }
        if (Array.isArray(data.monthly) && data.monthly.length) {
          lines.push(language === "en"
            ? "| Month | ASIN | Orders | Revenue | EPC | CVR |\n| --- | --- | ---: | ---: | ---: | ---: |"
            : "| 月份 | ASIN | 订单 | 销售额 | EPC | CVR |\n| --- | --- | ---: | ---: | ---: | ---: |");
          data.monthly.forEach((row) => {
            if (!isRecord(row)) return;
            lines.push("| " + text(row.month, 20) + " | " + text(row.asin, 20)
              + " | " + formatAgentResultNumber("orders", numberValue(row.orders))
              + " | " + formatAgentResultNumber("revenue", numberValue(row.revenue))
              + " | " + formatAgentResultNumber("epc", numberValue(row.epc))
              + " | " + formatAgentResultNumber("conversionRate", numberValue(row.conversionRate)) + " |");
          });
        }
      } else if (item.call.name === "merchant_analysis" && Array.isArray(data.topAsins) && isRecord(data.merchant)) {
        const cell = (value: unknown) => text(value, 200).replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
        lines.push(language === "en"
          ? "| Merchant ID | Merchant | Top ASIN | Period revenue |\n| --- | --- | --- | ---: |"
          : "| 商家 ID | 商家 | Top ASIN | 期间收入 |\n| --- | --- | --- | ---: |");
        const merchant = data.merchant;
        for (const asin of data.topAsins) {
          const revenue = Array.isArray(data.topAsinMetrics) ? data.topAsinMetrics.filter(isRecord).find(row => row.asin === asin)?.periodRevenue : null;
          lines.push(`| ${cell(merchant.id)} | ${cell(merchant.name)} | ${cell(asin)} | ${typeof revenue === "number" ? formatAgentResultNumber("revenue", revenue) : (language === "en" ? "Not provided" : "未提供")} |`);
        }
        lines.push(text(data.note, 800));
      } else if (item.call.name === "merchant_analysis" && isRecord(data.metrics)) {
        const metrics = data.metrics;
        lines.push(["revenue", "epc", "conversionRate"].map(key => `${agentMetricLabel(key, language)}：${typeof metrics[key] === "number" ? formatAgentResultNumber(key, metrics[key]) : (language === "zh" ? "未提供" : "Not provided")}`).join("；"));
        if (Array.isArray(data.monthly) && data.monthly.length) lines.push(language === "zh" ? "完整月度指标见上方数据表。" : "See the result table for all monthly metrics.");
      } else if (item.call.name === "tier_analysis" && Array.isArray(data.merchants)) {
        lines.push(language === "zh" ? "| 商户 | 联盟 EPC | 转化率 |\n| --- | --- | --- |" : "| Merchant | Affiliate EPC | CVR |\n| --- | --- | --- |");
        data.merchants.forEach((row) => {
          if (!isRecord(row)) return;
          const merchant = isRecord(row.merchant) ? text(row.merchant.name, 120) : "";
          const metrics = isRecord(row.metrics) ? row.metrics : {};
          const value = (key: string) => typeof metrics[key] === "number" ? formatAgentResultNumber(key, metrics[key]) : (language === "zh" ? "未提供" : "Not provided");
          lines.push("| " + merchant + " | " + value("epc") + " | " + value("conversionRate") + " |");
        });
      } else if (isRecord(data.summary)) {
        const summary = data.summary;
        const keys = item.call.name === "trend" ? ["first", "latest", "changeRate"] : Object.keys(summary);
        const labels: Record<string, string> = language === "zh" ? { first: "起点", latest: "最新值", changeRate: "变化率" } : { first: "First", latest: "Latest", changeRate: "Change" };
        lines.push(keys.filter(key => typeof summary[key] === "number" || summary[key] === null).map(key => {
          const value = summary[key];
          return `${labels[key] || agentMetricLabel(key, language)}：${typeof value === "number" ? formatAgentResultNumber(key === "changeRate" ? "conversionRate" : text(data.metric) || key, value) : (language === "zh" ? "未提供" : "Not provided")}`;
        }).join("；"));
      } else if (text(data.note, 500)) {
        lines.push(text(data.note, 500));
      }
    });
    if (omitted.length) {
      lines.push(language === "en"
        ? "The result is partial; unexecuted targets: " + omitted.join(", ") + "."
        : "\u672c\u6b21\u7ed3\u679c\u4e0d\u5b8c\u6574\uff0c\u672a\u6267\u884c\u76ee\u6807\uff1a" + omitted.join("\u3001") + "\u3002");
    }
    return lines.join("\n\n").trim() || missingDataResponse(language);
  }

  function memoryEvent(item: AgentToolExecution, prompt: string, runPartial: boolean): AgentMemoryEvent | null {
    if (!item.result.ok || !item.result.data) {
      const resolution = item.result.resolution;
      const candidates = isRecord(resolution) && Array.isArray(resolution.candidates) ? resolution.candidates : [];
      const safeCandidates: AgentMemoryCandidate[] = candidates.flatMap((candidate) => {
        if (!isRecord(candidate)) return [];
        const name = text(candidate.name || candidate.merchantName || candidate.merchant, 120);
        if (!name) return [];
        return [{ type: "merchant", ...(text(candidate.merchantId || candidate.id, 80) ? { id: text(candidate.merchantId || candidate.id, 80) } : {}), name }];
      });
      return safeCandidates.length ? { kind: "candidates", candidates: safeCandidates } : null;
    }
    const data = item.result.data;
    const focus = item.call.name === "merchant_analysis" && isRecord(data.merchant)
      ? {
        merchants: [{ ...(text(data.merchant.id, 80) ? { id: text(data.merchant.id, 80) } : {}), name: text(data.merchant.name, 120) }],
        ...(text(data.category, 120) ? { categories: [text(data.category, 120)] } : {}),
        ...(text(data.tier, 40) ? { tiers: [text(data.tier, 40)] } : {})
      }
      : item.call.name === "category_analysis" && text(data.category, 120)
        ? { categories: [text(data.category, 120)] }
        : item.call.name === "tier_analysis" && text(data.tier, 40)
          ? { tiers: [text(data.tier, 40)] }
          : undefined;
    const event: AgentMemoryEvent = {
      kind: "tool_success",
      query: { metrics: requestedMetrics(prompt) },
      lastTool: {
        toolName: item.call.name,
        headline: item.call.name + " completed",
        dataSource: item.result.source.dataSource === "unavailable" ? "unknown" : item.result.source.dataSource,
        dataAsOf: item.result.source.dataAsOf,
        estimated: item.result.source.estimated,
        partial: runPartial
      },
      ...(focus ? { focus } : {})
    };
    return event;
  }

  async function streamSynthesis(
    body: Record<string, unknown>,
    signal: AbortSignal,
    onToken: (token: string) => void
  ): Promise<{ response: string; errorCode?: string }> {
    let result: Response;
    try {
      result = await fetcher("/api/chat/stream", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "text/event-stream", "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
        signal
      });
      if (result.status === 401 || result.status === 403) notifyAuthFailure(result.status);
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      return { response: "", errorCode: "network_error" };
    }
    if (!result.ok) return { response: "", errorCode: "synthesis_unavailable" };
    let content = "";
    let streamError = "";
    try {
      await consumeSseResponse(result, {
        signal,
        onEvent(event) {
          if (event.event === "done" || event.data === "[DONE]") return;
          let payload: Record<string, unknown>;
          try {
            const parsed: unknown = JSON.parse(event.data);
            payload = isRecord(parsed) ? parsed : {};
          } catch {
            return;
          }
          if (typeof payload.errorCode === "string") streamError = safeErrorCode(payload.errorCode);
          if (payload.type === "usage" || event.event === "usage") return;
          if (typeof payload.token !== "string" || !payload.token) return;
          content += payload.token;
          onToken(payload.token);
        }
      });
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      return { response: content, errorCode: streamError || "synthesis_unavailable" };
    }
    return streamError ? { response: content, errorCode: streamError } : { response: content };
  }

  function commitPlanningFailure(baseHistory: readonly AgentHistoryMessage[], failureResponse: string, code: string): AgentSessionResult {
    response = failureResponse;
    status = "error";
    errorCode = code;
    lastResultOk = false;
    messages = baseHistory.slice();
    setQuestionAnswer(response);
    notify();
    return { ok: false, status: "error", response, steps: steps.slice(), resultViews: normalizeAgentResultViews(resultViews), memoryEvents: [], errorCode };
  }

  function commitDone(
    baseHistory: readonly AgentHistoryMessage[],
    prompt: string,
    finalResponse: string,
    runPartial: boolean,
    runOmittedTargets: readonly string[],
    events: readonly AgentMemoryEvent[],
    resultErrorCode?: string
  ): AgentSessionResult {
    response = text(finalResponse, 120_000);
    partial = runPartial;
    omittedTargets = runOmittedTargets.slice(0, 20);
    errorCode = resultErrorCode || null;
    lastResultOk = Boolean(response);
    status = "done";
    setQuestionAnswer(response);
    if (response) {
      history = [...baseHistory, { role: "user" as const, content: prompt }, {
        role: "assistant" as const,
        content: response,
        ...(currentQuestion ? { answerId: currentQuestion.eventId, feedbackState: "available" as const } : {})
      }].slice(-MAX_HISTORY);
      messages = history.slice();
      if (events.length) {
        memory = applyAgentMemoryEvents(memory, events, Date.now());
        saveAgentMemory(storage, memory);
      }
    } else {
      messages = baseHistory.slice();
    }
    notify();
    return {
      ok: Boolean(response),
      status: "done",
      response,
      steps: steps.slice(),
      partial: runPartial,
      omittedTargets: omittedTargets.slice(),
      resultViews: normalizeAgentResultViews(resultViews),
      memoryEvents: events,
      ...(resultErrorCode ? { errorCode: resultErrorCode } : {})
    };
  }

  function commitStopped(baseHistory: readonly AgentHistoryMessage[], trace: TraceContext, planned: number, executed: number, failed: number): AgentSessionResult {
    status = "stopped";
    reusableResults.markStopped();
    response = "";
    partial = false;
    omittedTargets = [];
    errorCode = "stopped_by_user";
    lastResultOk = false;
    messages = baseHistory.slice();
    const result: AgentSessionResult = {
      ok: false,
      status: "stopped",
      response: "",
      resultViews: normalizeAgentResultViews(resultViews),
      steps: steps.slice(),
      partial: false,
      omittedTargets: [],
      memoryEvents: [],
      errorCode
    };
    completeTrace(trace, { status: "stopped", partial: false, stopped: true, fallback: false, planned, executed, failed, errorCode });
    notify();
    return result;
  }

  async function submit(request: AgentSessionRequest, callbacks: AgentSessionCallbacks = {}): Promise<AgentSessionResult> {
    const prompt = text(request.prompt, 4_000);
    if (!prompt) return { ok: false, status: "error", response: "", steps: [], memoryEvents: [], errorCode: "empty_prompt" };
    if (disposed) return { ok: false, status: "error", response: "", steps: [], memoryEvents: [], errorCode: "disposed" };
    if (status === "running") return { ok: false, status: "error", response: "", steps: steps.slice(), memoryEvents: [], errorCode: "busy" };
    if (options.agentEnabled === false) {
      return { ok: false, status: "error", response: "", steps: [], memoryEvents: [], errorCode: "agent_disabled" };
    }

    const retainedSourceViews = status === "stopped" || status === "error" ? resultViews.slice() : [];
    currentLanguage = request.language === "en" ? "en" : "zh";
    planningAsins = request.asinContext ?? (status === "done" ? asinContextFromViews(resultViews) : []);
    const baseHistory = Array.isArray(request.history) ? request.history.slice(-MAX_HISTORY) : history.slice(-MAX_HISTORY);
    planningContext = { memory: text(request.memoryText, MAX_MEMORY_TEXT), history: clipHistory(baseHistory) };
    history = baseHistory.slice();
    messages = [...baseHistory, { role: "user", content: prompt }, { role: "assistant", content: "" }];
    steps = [];
    resultViews = retainedSourceViews;
    response = "";
    partial = false;
    omittedTargets = [];
    errorCode = null;
    status = "running";
    activeCallbacks = callbacks;
    activeController = new AbortController();
    const linked = linkSignal(options.signal, request.signal);
    const combined = linkSignal(linked.signal, activeController.signal);
    const questionEventId = request.questionEventId || randomUuid();
    const trace = beginTrace(questionEventId);
    if (request.questionEventId) currentQuestion = null;
    else beginQuestion(prompt, questionEventId);
    const reuseDecision = reusableResults.decide(prompt, request.reuseResult, (options.getOffers?.() || offers).flatMap(row => [merchantName(row), merchantId(row)]));
    pendingSource = null;
    const started = Date.now();
    let plannedCount = 0;
    let executedCount = 0;
    let failedCount = 0;
    let fallbackDelivered = false;
    let traceSequence = 0;
    try {
      if (reuseDecision.kind === "unavailable") {
        const failed = commitPlanningFailure(baseHistory, currentLanguage === "zh" ? "已有结果不可用、已过期或未覆盖这次请求。请重新查询所需范围。" : "Existing results are unavailable, expired, or do not cover this request. Query the required scope again.", "agent_reuse_scope_unavailable");
        completeTrace(trace, { status: "error", partial: false, stopped: false, fallback: false, planned: 0, executed: 0, failed: 0, errorCode });
        await completeQuestion("failed"); return failed;
      }
      if (reuseDecision.kind === "reuse") {
        const source = reuseDecision.source;
        emitStep(makeStep("synthesis", "synthesis", "running", stepLabel("synthesis", ""), started));
        const synthesized = await streamSynthesis({ contractVersion: "v2", agentRunId: source.agentRunId,
          planProofs: source.planProofs, question: prompt, language: currentLanguage,
          context: { memory: text(request.memoryText, MAX_MEMORY_TEXT), history: clipHistory(baseHistory) },
          toolResults: source.toolResults,
          reuse: { originalQuestion: source.originalQuestion, sourceQuestionEventId: source.sourceQuestionEventId, scope: reuseDecision.scope },
          trace: { runId: trace.runId, questionEventId, tracePhase: "synthesis" }
        }, combined.signal, token => { response += token; callbacks.onToken?.(token); notify(); });
        if (synthesized.errorCode || !synthesized.response.trim()) {
          emitStep(makeStep("synthesis", "synthesis", "error", stepLabel("synthesis", ""), started));
          const failed = commitPlanningFailure(baseHistory, currentLanguage === "zh" ? "已有数据仍保留，但本次综合未完成。可以重试继续，或重新查询。" : "Existing data is retained, but synthesis did not complete. Retry continuing or query again.", synthesized.errorCode || "synthesis_unavailable");
          completeTrace(trace, { status: "error", partial: false, stopped: false, fallback: false, planned: 0, executed: 0, failed: 0, errorCode });
          await completeQuestion("failed"); return failed;
        }
        emitStep(makeStep("synthesis", "synthesis", "done", stepLabel("synthesis", ""), started));
        if (source.restoreViews) resultViews = source.resultViews;
        const sourcePartial = source.partial === true;
        const result = commitDone(baseHistory, prompt, synthesized.response.trim(), sourcePartial, [], []);
        reusableResults.markPresented();
        completeTrace(trace, { status: "done", partial: sourcePartial, stopped: false, fallback: false, planned: 0, executed: 0, failed: 0, errorCode: null });
        await completeQuestion("success"); return result;
      }
      const planningId = "planning";
      emitStep(makeStep(planningId, "planning", "running", stepLabel("planning", ""), started));
      let firstPlan = await plan(prompt, currentLanguage, trace, combined.signal, request.promotionAttachment);
      if (!firstPlan.plan && firstPlan.round !== 2 && INITIAL_PLANNING_RETRYABLE_ERROR_CODES.has(firstPlan.errorCode || "") && !combined.signal.aborted) {
        const retryStarted = Date.now();
        emitStep(makeStep("planning-retry", "planning", "running", stepLabel("planning", ""), retryStarted));
        firstPlan = await plan(prompt, currentLanguage, trace, combined.signal, request.promotionAttachment, undefined, 2);
        emitStep(makeStep("planning-retry", "planning", firstPlan.plan ? "done" : "error", stepLabel("planning", ""), retryStarted));
      }
      if (!firstPlan.plan) {
        const planningStep = makeStep(planningId, "planning", "error", stepLabel("planning", ""), started);
        emitStep(planningStep);
        appendTraceStep(trace, planningStep, ++traceSequence);
        const code = firstPlan.errorCode || "agent_planning_unavailable";
        const safeResponse = isDataQuestion(prompt) ? missingDataResponse(currentLanguage, code) : "";
        const failedResult = commitPlanningFailure(baseHistory, safeResponse, code);
        completeTrace(trace, { status: "error", partial: false, stopped: false, fallback: false, planned: 0, executed: 0, failed: 0, errorCode });
        await completeQuestion("failed");
        return failedResult;
      }

      const activePlan = firstPlan.plan;
      plannedCount = activePlan.toolCalls.length;
      const planningStep = makeStep(planningId, "planning", "done", stepLabel("planning", ""), started);
      emitStep(planningStep);
      appendTraceStep(trace, planningStep, ++traceSequence);
      if (!activePlan.toolCalls.length) {
        if (isDataQuestion(prompt)) {
          const failed = commitPlanningFailure(baseHistory, missingDataResponse(currentLanguage), "agent_no_tool_plan");
          completeTrace(trace, { status: "error", partial: false, stopped: false, fallback: false, planned: 0, executed: 0, failed: 0, errorCode });
          await completeQuestion("failed");
          return failed;
        }
        const direct = isKeywordDataQuestion(prompt) ? keywordMissingDataResponse(currentLanguage)
          : isDataQuestion(prompt) ? missingDataResponse(currentLanguage)
          : activePlan.content || missingDataResponse(currentLanguage);
        const result = commitDone(baseHistory, prompt, direct, false, [], [], activePlan.content ? undefined : "no_verifiable_source");
        completeTrace(trace, { status: "done", partial: false, stopped: false, fallback: !activePlan.content, planned: 0, executed: 0, failed: 0, errorCode: activePlan.content ? null : "no_verifiable_source" });
        await completeQuestion("success");
        return result;
      }

      if (isKeywordDataQuestion(prompt) && !activePlan.toolCalls.some((call) => call.name === "keyword_search")) {
        const failed = commitPlanningFailure(baseHistory, keywordMissingDataResponse(currentLanguage), "no_verifiable_source");
        completeTrace(trace, { status: "error", partial: false, stopped: false, fallback: false, planned: plannedCount, executed: 0, failed: 0, errorCode });
        await completeQuestion("failed"); return failed;
      }

      let allExecutions: AgentToolExecution[] = [];
      const omitted: string[] = activePlan.toolCalls.slice(MAX_TOOL_CALLS).map(toolTarget);
      let firstCalls = activePlan.toolCalls.slice(0, MAX_TOOL_CALLS);
      pendingSource = { originalQuestion: prompt, sourceQuestionEventId: questionEventId, agentRunId: activePlan.agentRunId,
        planProofs: activePlan.planProof ? [activePlan.planProof] : [], toolResults: [], resultViews: [] };
      pendingCallCount = activePlan.toolCalls.length;
      allExecutions = await executeCalls(firstCalls, prompt, combined.signal, trace, request.promotionAttachment);
      executedCount += allExecutions.length;
      failedCount += allExecutions.filter((item) => !item.result.ok).length;
      const proofs: string[] = activePlan.planProof ? [activePlan.planProof] : [];

      const failedCalls = allExecutions.filter((item) => !item.result.ok && RETRYABLE_TOOL_ERROR_CODES.has(item.result.errorCode || ""));
      if (failedCalls.length && activePlan.round < 2 && activePlan.planProof && executedCount < MAX_TOOL_CALLS && !combined.signal.aborted) {
        const retryBody = {
          agentRunId: activePlan.agentRunId,
          previousPlanProof: activePlan.planProof,
          failedCalls: failedCalls.map((item) => ({ callId: item.call.id, errorCode: item.result.errorCode || "tool_error" }))
        };
        const retryPlanResult = await plan(prompt, currentLanguage, trace, combined.signal, request.promotionAttachment, retryBody);
        if (retryPlanResult.plan) {
          const retryPlan = retryPlanResult.plan;
          pendingCallCount += retryPlan.toolCalls.length;
          if (retryPlan.planProof) proofs.push(retryPlan.planProof);
          pendingSource.planProofs = proofs.slice(0, MAX_PLAN_PROOFS);
          plannedCount += retryPlan.toolCalls.length;
          const remaining = MAX_TOOL_CALLS - executedCount;
          const retryCalls = retryPlan.toolCalls.slice(0, remaining);
          omitted.push(...retryPlan.toolCalls.slice(remaining).map(toolTarget));
          if (retryCalls.length) {
            const retryExecutions = await executeCalls(retryCalls, prompt, combined.signal, trace, request.promotionAttachment);
            allExecutions = [...allExecutions, ...retryExecutions];
            executedCount += retryExecutions.length;
            failedCount += retryExecutions.filter((item) => !item.result.ok).length;
          }
        }
      }
      omittedTargets = omitted.slice(0, 20);
      partial = Boolean(omitted.length || failedCount);
      if (!allExecutions.some(item => item.result.ok)) {
        const failed = commitPlanningFailure(baseHistory, fallbackAnswer(allExecutions, currentLanguage, omitted), allExecutions[0]?.result.errorCode || "no_verifiable_source");
        completeTrace(trace, { status: "error", partial, stopped: false, fallback: true, planned: plannedCount, executed: executedCount, failed: failedCount, errorCode });
        await completeQuestion("failed"); return { ...failed, resultViews: normalizeAgentResultViews(resultViews) };
      }
      const synthesisStarted = Date.now();
      const synthesisId = "synthesis";
      emitStep(makeStep(synthesisId, "synthesis", "running", stepLabel("synthesis", ""), synthesisStarted));
      const synthesisBody: Record<string, unknown> = {
        contractVersion: "v2",
        agentRunId: activePlan.agentRunId,
        planProofs: proofs.slice(0, MAX_PLAN_PROOFS),
        question: text(prompt, 4_000),
        language: currentLanguage,
        context: {
          memory: text(request.memoryText, MAX_MEMORY_TEXT),
          history: clipHistory(baseHistory),
          ...(request.promotionAttachment ? {
            promotionContext: promotionManifestForRequest(request.promotionAttachment)
          } : {})
        },
        toolResults: allExecutions.map(projectedToolResult),
        trace: { runId: trace.runId, questionEventId: trace.questionEventId, tracePhase: "synthesis" }
      };
      const synthesisResult = await streamSynthesis(synthesisBody, combined.signal, (token) => {
        response += token;
        messages = messages.map((item, index) => index === messages.length - 1 ? { ...item, content: response } : item);
        callbacks.onToken?.(token);
        notify();
      });
      let finalResponse = synthesisResult.response.trim();
      if (!finalResponse || synthesisResult.errorCode) {
        finalResponse = fallbackAnswer(allExecutions, currentLanguage, omitted);
        fallbackDelivered = true;
      }
      if (synthesisResult.errorCode && allExecutions.some(item => item.call.name === "trend")) {
        emitStep(makeStep(synthesisId, "synthesis", "error", stepLabel("synthesis", ""), synthesisStarted));
        const failed = commitPlanningFailure(baseHistory, currentLanguage === "zh" ? "查询结果已保留，但本次趋势综合未完成。可基于已有结果继续，或重新查询。" : "Query results are retained, but trend synthesis did not complete. Continue with existing results or query again.", synthesisResult.errorCode);
        completeTrace(trace, { status: "error", partial, stopped: false, fallback: false, planned: plannedCount, executed: executedCount, failed: failedCount, errorCode });
        await completeQuestion("failed"); return failed;
      }
      const synthesisStep = makeStep(synthesisId, "synthesis", finalResponse ? "done" : "error", stepLabel("synthesis", ""), synthesisStarted);
      emitStep(synthesisStep);
      appendTraceStep(trace, synthesisStep, ++traceSequence);
      const events = allExecutions.flatMap((item) => {
        const event = memoryEvent(item, prompt, partial);
        return event ? [event] : [];
      });
      const result = commitDone(baseHistory, prompt, finalResponse, partial, omitted, events, synthesisResult.errorCode && fallbackDelivered ? "synthesis_unavailable" : undefined);
      completeTrace(trace, { status: "done", partial, stopped: false, fallback: fallbackDelivered, planned: plannedCount, executed: executedCount, failed: failedCount, errorCode: synthesisResult.errorCode && fallbackDelivered ? "synthesis_unavailable" : null });
      await completeQuestion("success");
      return result;
    } catch (error) {
      if (isAbortError(error, combined.signal)) {
        const stoppedSteps = steps.map((step) => step.status === "running" ? { ...step, status: "stopped" as const, elapsedMs: Math.max(0, Date.now() - started) } : step);
        steps = stoppedSteps;
        const result = commitStopped(baseHistory, trace, plannedCount, executedCount, failedCount);
        await completeQuestion("failed");
        return result;
      }
      status = "error";
      response = "";
      messages = baseHistory.slice();
      errorCode = "agent_session_error";
      lastResultOk = false;
      notify();
      const result: AgentSessionResult = { ok: false, status: "error", response: "", steps: steps.slice(), memoryEvents: [], errorCode };
      completeTrace(trace, { status: "error", partial, stopped: false, fallback: fallbackDelivered, planned: plannedCount, executed: executedCount, failed: failedCount, errorCode });
      await completeQuestion("failed");
      return result;
    } finally {
      combined.dispose();
      linked.dispose();
      activeController = null;
      activeCallbacks = null;
    }
  }

  function feedbackBridge(resolve: () => QuestionContext | null): AgentFeedback {
    function markSubmitted(question: QuestionContext): void {
      question.submitted = true;
      history = history.map((message) => message.answerId === question.eventId ? { ...message, feedbackState: "submitted" } : message);
      messages = messages.map((message) => message.answerId === question.eventId ? { ...message, feedbackState: "submitted" } : message);
      notify();
    }

    return {
      isAvailable: () => Boolean(resolve()?.completionPromise && !resolve()?.submitted),
      async submit(reasonCode: string, reasonDetail = ""): Promise<AgentFeedbackResult> {
        const question = resolve();
        const allowed = ["inaccurate", "not_answered", "incomplete_data", "unclear", "other"];
        if (!question?.completionPromise || question.submitted) return { ok: false, errorCode: "feedback_unavailable" };
        if (!allowed.includes(reasonCode)) return { ok: false, errorCode: "invalid_reason" };
        const record = await (question.completionPromise || question.recordPromise);
        if (!record || options.enableQuestionLogging === false) return { ok: false, errorCode: "question_log_unavailable" };
        const feedbackEventId = question.feedbackEventId || randomUuid();
        question.feedbackEventId = feedbackEventId;
        try {
          const payload = await requestJson<JsonPayload>("/api/chat/stream?operation=feedback", {
            method: "POST",
            headers: { "Content-Type": "application/json; charset=utf-8" },
            body: JSON.stringify({
              feedbackEventId,
              questionEventId: record.recordId,
              sessionId: getSessionId(storage),
              mode: "agent",
              prompt: question.prompt,
              answer: question.answer.slice(0, 120_000),
              language: question.language,
              reasonCode,
              reasonDetail: text(reasonDetail, 4_000)
            })
          });
          if (payload.ok === false) return { ok: false, errorCode: safeErrorCode(payload.errorCode) };
          markSubmitted(question);
          return { ok: true };
        } catch (error) {
          if (isRecord(error) && Number(error.status) === 409) {
            markSubmitted(question);
            return { ok: true, alreadyExists: true };
          }
          return { ok: false, errorCode: "feedback_error" };
        }
      }
    };
  }

  const feedback = feedbackBridge(() => currentQuestion);

  function feedbackForAnswer(answerId: string): AgentFeedback | null {
    if (!answerContexts.has(answerId)) return null;
    return feedbackBridge(() => answerContexts.get(answerId) || null);
  }

  function setLanguage(language: UiLanguage): void {
    currentLanguage = language === "en" ? "en" : "zh";
    notify();
  }

  function stop(): void {
    activeController?.abort();
  }

  function newConversation(): void {
    if (status === "running") return;
    reusableResults.clear();
    resultViews = [];
    history = [];
    messages = [];
    steps = [];
    response = "";
    partial = false;
    omittedTargets = [];
    errorCode = null;
    currentQuestion = null;
    answerContexts.clear();
    lastResultOk = false;
    memory = emptyAgentMemory();
    saveAgentMemory(storage, memory);
    status = "idle";
    notify();
  }

  function downloadLogs(kind: "questions" | "feedback", format: "csv" | "jsonl"): boolean {
    if (typeof document === "undefined") return false;
    const safeKind = kind === "feedback" ? "feedback" : "questions";
    const safeFormat = format === "jsonl" ? "jsonl" : "csv";
    const anchor = document.createElement("a");
    anchor.href = "/api/chat/stream?operation=" + safeKind + "&format=" + safeFormat;
    anchor.download = "agent-" + safeKind + "." + safeFormat;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  }

  function onChange(listener: (next: AgentSessionState) => void): () => void {
    if (disposed) return () => undefined;
    listeners.add(listener);
    listener(state());
    return () => listeners.delete(listener);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    reusableResults.clear();
    activeController?.abort();
    activeController = null;
    listeners.clear();
  }

  return {
    getState: state,
    getReusableResult: reusableResults.get,
    retainReusableResult: result => { if (!disposed) reusableResults.retain(result); },
    markReusableStopped: reusableResults.markStopped,
    canReuseResult: (prompt, explicit = false) => reusableResults.decide(prompt, explicit, (options.getOffers?.() || offers).flatMap(row => [merchantName(row), merchantId(row)])).kind !== "query",
    clearReusableResults: reusableResults.clear,
    setLanguage,
    submit,
    stop,
    newConversation,
    executeTool: executeFrontendTool,
    onChange,
    feedback,
    feedbackForAnswer,
    downloadLogs,
    dispose
  };
}
