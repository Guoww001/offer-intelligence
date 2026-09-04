import { apiRequest } from "../../shared/api/client";
import { renderMarkdownToHtml } from "../../shared/markdown/markdown";
import type { UiLanguage } from "../../shared/i18n";
import {
  buildChatbotReport,
  summarizeChatbotOffers,
  type ChatbotReportResult
} from "./chatbotReportModel";
import { detectChatbotIntent, resolveChatbotMerchant } from "./chatbotModel";
import { streamChatbotReply } from "./useChatbotChat";
import { createDeepWindowStore, type DeepWindowStore } from "./deepWindowStore";
import type {
  ChatbotChatRunner,
  ChatbotDataSource,
  ChatbotFeedback,
  ChatbotFeedbackResult,
  ChatbotHistoryMessage,
  ChatbotMemoryItem,
  ChatbotReportViewResult,
  ChatbotRunCallbacks,
  ChatbotSession,
  ChatbotSessionMessage,
  ChatbotSessionResult,
  ChatbotSessionStatus,
  ChatbotStarterCard,
  ChatbotViewState
} from "./chatbotViewTypes";

type Row = Readonly<Record<string, unknown>>;

export interface ChatbotSessionOptions {
  readonly offers: readonly Row[];
  readonly paymentRecords?: readonly Row[];
  readonly language: UiLanguage;
  readonly llmEnabled?: boolean;
  readonly enableQuestionLogging?: boolean;
  readonly storage?: Storage;
  readonly runChat?: ChatbotChatRunner;
  readonly signal?: AbortSignal;
  readonly deepWindows?: DeepWindowStore;
  readonly classify?: (prompt: string, categories: readonly string[], signal?: AbortSignal) => Promise<unknown>;
  readonly analyze?: (summary: Readonly<Record<string, unknown>>, language: UiLanguage, signal?: AbortSignal) => Promise<string | null>;
  readonly downloadRecommendation?: (downloadId: string, result: ChatbotSessionResult | null) => boolean;
  readonly downloadReport?: (result: ChatbotReportViewResult) => boolean;
}

interface QuestionLogRecord {
  readonly recordId: string;
}

interface QuestionContext {
  readonly eventId: string;
  readonly prompt: string;
  readonly mode: ChatbotMode;
  readonly language: UiLanguage;
  readonly intent: string;
  readonly answer: string;
  recordPromise: Promise<QuestionLogRecord | null>;
  completionPromise?: Promise<QuestionLogRecord | null>;
  feedbackEventId?: string;
}

type ChatbotMode = "report" | "chat";

const MAX_HISTORY = 24;
const MAX_MEMORY = 5;
const SESSION_STORAGE_KEY = "oi_chat_session_v1";
const REPORT_STARTERS: readonly ChatbotStarterCard[] = [
  { id: "merchant", title: "Merchant", type: "merchant", questions: ["Show the latest merchant metrics", "Which metrics need attention?"] },
  { id: "trend", title: "Trend", type: "trend", questions: ["Show the revenue trend", "Compare the last 3 months"] },
  { id: "payment", title: "Payment", type: "payment", questions: ["Show unpaid payments", "Which payments are overdue?"] }
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, limit = 120_000): string {
  return String(value ?? "").trim().slice(0, limit);
}

function numberValue(value: unknown): number {
  const numeric = Number(String(value ?? "").replace(/[$,%]/g, "").replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function safeSource(value: unknown): ChatbotDataSource {
  return value === "db" || value === "cache" ? value : "unavailable";
}

function safeMode(value: unknown): ChatbotMode {
  return value === "chat" ? "chat" : "report";
}

function safeStatus(value: unknown): ChatbotSessionStatus {
  return value === "running" || value === "success" || value === "stopped" || value === "error" ? value : "idle";
}

function uuid(prefix: string): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // 运行环境没有 crypto 时退回到不可预测性要求较低的页面会话 ID。
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`.slice(0, 64);
}

function browserSessionId(storage?: Storage): string {
  try {
    const saved = storage?.getItem(SESSION_STORAGE_KEY)?.trim();
    if (saved && /^[A-Za-z0-9._:-]{16,64}$/.test(saved)) return saved;
    const next = uuid("chat");
    storage?.setItem(SESSION_STORAGE_KEY, next);
    return next;
  } catch {
    return uuid("chat");
  }
}

function linkSignal(parent: AbortSignal | undefined, external: AbortSignal | undefined): {
  readonly signal: AbortSignal;
  readonly dispose: () => void;
} {
  const controller = new AbortController();
  const abort = (event: Event): void => controller.abort((event.target as AbortSignal).reason);
  if (parent?.aborted || external?.aborted) controller.abort();
  parent?.addEventListener("abort", abort, { once: true });
  external?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    dispose() {
      parent?.removeEventListener("abort", abort);
      external?.removeEventListener("abort", abort);
    }
  };
}

function offerCategories(offers: readonly Row[]): string[] {
  const values = new Set<string>();
  offers.forEach((offer) => {
    [offer.sheetCategory, offer.mainCategory, offer.category, offer.Category, offer.levantaCategory]
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .map((value) => text(value, 160))
      .filter((value) => value && value.toLowerCase() !== "uncategorized")
      .forEach((value) => values.add(value));
  });
  return [...values].slice(0, 200);
}

function paymentStatus(prompt: string): string | null {
  if (/overdue|逾期|到期/.test(prompt.toLowerCase())) return "overdue";
  if (/unpaid|未付|未支付|没付/.test(prompt.toLowerCase())) return "unpaid";
  if (/pending|待处理|未到期|等待/.test(prompt.toLowerCase())) return "pending";
  if (/partial|部分/.test(prompt.toLowerCase())) return "partial";
  if (/paid|已付|已支付/.test(prompt.toLowerCase())) return "paid";
  return null;
}

function paymentMonth(prompt: string): string | null {
  const iso = prompt.match(/\b(20\d{2})[-\/](0?[1-9]|1[0-2])\b/);
  if (iso?.[1] && iso[2]) return `${iso[1]}-${iso[2].padStart(2, "0")}`;
  const numeric = prompt.match(/(?:^|[^0-9])(\d{1,2})\s*(?:月|月份)/);
  if (!numeric?.[1]) return null;
  const month = Number(numeric[1]);
  return month >= 1 && month <= 12 ? `${new Date().getFullYear()}-${String(month).padStart(2, "0")}` : null;
}

function paymentRowMatches(row: Row, prompt: string): boolean {
  const status = paymentStatus(prompt);
  if (status && text(row.status || row.paymentStatus).toLowerCase() !== status) return false;
  const month = paymentMonth(prompt);
  if (month && text(row.month || row.monthKey || row.reportMonth) !== month) return false;
  const tierMatch = prompt.match(/tier\s*[1-4]|black\s*tier|第[一二三四]层/i);
  if (tierMatch && !text(row.tier || row.Tier).toLowerCase().includes(tierMatch[0].toLowerCase().replace(/第[一二三四]层/, "tier"))) {
    return false;
  }
  const merchant = text(row.merchant || row.merchantName || row.brand);
  const merchantId = text(row.merchantId || row.merchant_id);
  const query = prompt.replace(/payment|paid|unpaid|overdue|pending|commission|付款|支付|结算|逾期|未付款|待处理/gi, "").trim();
  const id = query.match(/\b\d{4,}\b/)?.[0];
  if (id && merchantId !== id) return false;
  const name = query.replace(/\b\d{4,}\b/g, "").trim().toLowerCase();
  return !name || merchant.toLowerCase().includes(name);
}

function paymentReport(prompt: string, records: readonly Row[], language: UiLanguage): ChatbotReportViewResult {
  const rows = records.filter((row) => paymentRowMatches(row, prompt));
  const summary = {
    ...summarizeChatbotOffers(rows),
    revenue: rows.reduce((total, row) => total + numberValue(row.revenue || row.salesAmount || row.amount), 0),
    commission: rows.reduce((total, row) => total + numberValue(row.commission || row.commissionMade || row.affCommission), 0)
  };
  const hasRows = rows.length > 0;
  return {
    intent: "payment",
    status: hasRows ? "resolved" : "not_found",
    query: prompt,
    source: records.length ? "cache" : "unavailable",
    rows,
    summary: { ...summary, conversionRate: summary.clicks ? summary.orders / summary.clicks : null },
    message: hasRows
      ? (language === "zh" ? `已找到 ${rows.length.toLocaleString()} 条付款记录。` : `Found ${rows.length.toLocaleString()} payment records.`)
      : (language === "zh" ? "当前数据中没有找到匹配的付款记录。" : "No matching payment records were found in the current data.")
  };
}

function zeroSummary(): ChatbotReportViewResult["summary"] {
  return { offerCount: 0, clicks: 0, orders: 0, revenue: 0, commission: 0, conversionRate: null };
}

function resultFromReport(report: ChatbotReportViewResult, status: Exclude<ChatbotSessionStatus, "idle" | "running"> = report.status === "resolved" || report.status === "ambiguous" ? "success" : "error"): ChatbotSessionResult {
  return {
    ok: status === "success",
    status,
    mode: "report",
    source: report.source,
    intent: report.intent,
    response: report.message,
    report,
    reportSnapshot: { rows: report.rows, summary: report.summary, query: report.query },
    ...(report.contentHtml ? { contentHtml: report.contentHtml } : {}),
    ...(report.recommendationHtml ? { recommendationHtml: report.recommendationHtml } : {})
  };
}

function resultFromChat(response: string, usage: ChatbotSessionResult["usage"], status: Exclude<ChatbotSessionStatus, "idle" | "running"> = "success"): ChatbotSessionResult {
  return {
    ok: status === "success" && Boolean(response.trim()),
    status,
    mode: "chat",
    source: "unavailable",
    response,
    usage
  };
}

function viewResultFromSession(result: ChatbotSessionResult, query: string): ChatbotReportViewResult {
  if (result.report) return { ...result.report, sessionResult: result };
  return {
    intent: (result.intent || "analysis") as ChatbotReportViewResult["intent"],
    status: result.ok ? "resolved" : result.status === "stopped" ? "deferred" : "not_found",
    query,
    source: result.source,
    rows: [],
    summary: zeroSummary(),
    message: result.response,
    sessionResult: result,
    ...(result.contentHtml ? { contentHtml: result.contentHtml } : {}),
    ...(result.recommendationHtml ? { recommendationHtml: result.recommendationHtml } : {})
  };
}

async function defaultClassify(prompt: string, categories: readonly string[], signal?: AbortSignal): Promise<unknown> {
  return apiRequest<unknown>("/api/chat/classify", {
    method: "POST",
    signal,
    body: JSON.stringify({ prompt: text(prompt, 2_048), categories: categories.slice(0, 200) })
  });
}

async function defaultAnalyze(summary: Readonly<Record<string, unknown>>, language: UiLanguage, signal?: AbortSignal): Promise<string | null> {
  try {
    const payload = await apiRequest<unknown>("/api/chat/analyze", {
      method: "POST",
      signal,
      timeoutMs: 30_000,
      body: JSON.stringify({ summary, language })
    });
    return isRecord(payload) && typeof payload.text === "string" ? payload.text.trim().slice(0, 24_000) || null : null;
  } catch {
    return null;
  }
}

function reportAnalysisRows(prompt: string, offers: readonly Row[]): readonly Row[] {
  const merchant = resolveChatbotMerchant(prompt, offers);
  if (merchant.status === "resolved") return merchant.matches.map((item) => item.offer);
  const normalized = prompt.toLowerCase();
  const rows = offers.filter((offer) => {
    const haystack = [offer.brand, offer.merchantName, offer.category, offer.mainCategory, offer.sheetCategory, offer.tier]
      .map((value) => text(value).toLowerCase()).join(" ");
    return normalized.split(/\s+/).filter((value) => value.length > 2).some((token) => haystack.includes(token));
  });
  return rows.length ? rows : offers.slice(0, 50);
}

function normalizeMemory(item: ChatbotMemoryItem): ChatbotMemoryItem | null {
  const id = text(item.id, 120);
  const title = text(item.title, 200);
  const content = text(item.text, 8_000);
  if (!id || !content) return null;
  return {
    id,
    title: title || "Report",
    text: content,
    ...(item.html ? { html: text(item.html, 160_000) } : {}),
    ...(item.source ? { source: safeSource(item.source) } : {}),
    ...(item.result ? { result: item.result } : {})
  };
}

function safeMessage(value: unknown): ChatbotSessionMessage | null {
  if (!isRecord(value)) return null;
  const content = text(value.content);
  if (!content) return null;
  return { role: value.role === "assistant" ? "assistant" : "user", content };
}

export function createChatbotSession(options: ChatbotSessionOptions): ChatbotSession & { deepWindows: DeepWindowStore } {
  const storage = options.storage;
  const deepWindows = options.deepWindows || createDeepWindowStore({
    signal: options.signal,
    onAddToChat: (item) => addMemory(item.result),
    onExport: (item) => options.downloadReport?.(item.result) || false
  });
  const offers = options.offers.slice();
  const listeners = new Set<(state: ChatbotViewState) => void>();
  let mode: ChatbotMode = "report";
  let currentLanguage: UiLanguage = options.language;
  let status: ChatbotSessionStatus = "idle";
  let source: ChatbotDataSource = offers.length ? "cache" : "unavailable";
  let history: ChatbotSessionMessage[] = [];
  let messages: ChatbotSessionMessage[] = [];
  let memory: ChatbotMemoryItem[] = [];
  let currentResult: ChatbotSessionResult | null = null;
  let errorCode: string | null = null;
  let helpOpen = false;
  let guideOpen = false;
  let onboardingOpen = false;
  let activeController: AbortController | null = null;
  let disposed = false;
  let currentQuestion: QuestionContext | null = null;

  function state(): ChatbotViewState {
    return {
      mode,
      language: currentLanguage,
      hasMemory: memory.length > 0,
      source,
      status,
      history: history.slice(-MAX_HISTORY),
      messages: messages.slice(-MAX_HISTORY),
      memory: memory.map((item) => ({ ...item })),
      starterCards: REPORT_STARTERS,
      currentResult,
      utility: {
        helpOpen,
        guideOpen,
        helpHtml: "",
        guideHtml: "",
        guideLoading: false,
        onboardingOpen,
        onboardingStep: onboardingOpen ? 1 : 0,
        onboardingTotal: 1,
        reminderVisible: false,
        reminderCollapsed: false
      },
      ...(errorCode ? { errorCode } : {})
    };
  }

  function notify(): void {
    if (disposed) return;
    const snapshot = state();
    listeners.forEach((listener) => listener(snapshot));
  }

  function setState(nextStatus: ChatbotSessionStatus, nextSource?: ChatbotDataSource): void {
    status = nextStatus;
    if (nextSource) source = nextSource;
    notify();
  }

  function completeQuestion(statusValue: "success" | "failed"): Promise<QuestionLogRecord | null> {
    const question = currentQuestion;
    if (!question) return Promise.resolve(null);
    if (question.completionPromise) return question.completionPromise;
    question.completionPromise = question.recordPromise.then(async (record) => {
      if (!record) return null;
      try {
        await apiRequest<unknown>("/api/chat/stream?operation=questions", {
          method: "POST",
          body: JSON.stringify({
            action: "complete",
            recordId: record.recordId,
            sessionId: browserSessionId(storage),
            status: statusValue,
            intent: question.intent
          })
        });
        return record;
      } catch {
        return null;
      }
    });
    return question.completionPromise;
  }

  function beginQuestion(prompt: string, currentMode: ChatbotMode): void {
    const eventId = uuid("question");
    const intent = detectChatbotIntent(prompt);
    const question: QuestionContext = {
      eventId,
      prompt,
      mode: currentMode,
      language: currentLanguage,
      intent,
      answer: "",
      recordPromise: options.enableQuestionLogging === false ? Promise.resolve(null) : apiRequest<unknown>("/api/chat/stream?operation=questions", {
        method: "POST",
        body: JSON.stringify({
          action: "create",
          eventId,
          sessionId: browserSessionId(storage),
          mode: currentMode,
          prompt: text(prompt, 20_000),
          language: currentLanguage,
          intent
        })
      }).then((payload) => isRecord(payload) && text(payload.recordId, 128) ? { recordId: text(payload.recordId, 128) } : null).catch(() => null)
    };
    currentQuestion = question;
  }

  function setQuestionAnswer(answer: string): void {
    if (currentQuestion) currentQuestion = { ...currentQuestion, answer: text(answer) };
  }

  async function submitReport(prompt: string, callbacks: ChatbotRunCallbacks, signal: AbortSignal): Promise<ChatbotSessionResult> {
    let report: ChatbotReportViewResult = buildChatbotReport(prompt, { offers }, currentLanguage);
    const detectedIntent = report.intent;
    if (options.llmEnabled !== false) {
      try {
        await (options.classify || defaultClassify)(prompt, offerCategories(offers), signal);
      } catch {
        // 本地规则始终是确定性 fallback；LLM 分类失败不应清空报告。
      }
    }

    if (detectedIntent === "payment") {
      report = paymentReport(prompt, options.paymentRecords || extractPaymentRecords(offers), currentLanguage);
    } else if (detectedIntent === "analysis") {
      const rows = reportAnalysisRows(prompt, offers);
      const analysisText = await (options.analyze || defaultAnalyze)(
        { ...summarizeChatbotOffers(rows), rows: rows.slice(0, 50), query: prompt },
        currentLanguage,
        signal
      );
      if (analysisText) {
        report = {
          ...report,
          status: rows.length ? "resolved" : "not_found",
          source: rows.length ? "cache" : "unavailable",
          rows,
          summary: summarizeChatbotOffers(rows),
          message: analysisText,
          contentHtml: renderMarkdownToHtml(analysisText)
        };
      }
    }

    if (signal.aborted) return stoppedResult("report", source);
    const result = resultFromReport(report, report.status === "resolved" || report.status === "ambiguous" ? "success" : report.status === "deferred" ? "stopped" : "error");
    callbacks.onChange?.(state());
    return result;
  }

  function extractPaymentRecords(rows: readonly Row[]): readonly Row[] {
    return rows.filter((row) => row.paymentStatus !== undefined || row.status !== undefined || row.paymentCycle !== undefined || row.remainingAmount !== undefined);
  }

  async function submitChat(prompt: string, callbacks: ChatbotRunCallbacks, signal: AbortSignal): Promise<ChatbotSessionResult> {
    const previousHistory = history.slice(-MAX_HISTORY);
    messages = [
      ...messages,
      { role: "user", content: prompt } satisfies ChatbotSessionMessage,
      { role: "assistant", content: "" } satisfies ChatbotSessionMessage
    ];
    notify();
    const runner = options.runChat || streamChatbotReply;
    const result = await runner({
      prompt,
      language: currentLanguage,
      history: previousHistory,
      memoryText: memory.map((item) => `[报告上下文] ${item.title}: ${item.text.slice(0, 8_000)}`).join("\n---\n"),
      signal
    }, (token) => {
      const last = messages.length - 1;
      const current = messages[last]?.content || "";
      messages = messages.map((item, index) => index === last ? { ...item, content: current + token } : item);
      callbacks.onToken?.(token);
      notify();
    });
    if (result.stopped || signal.aborted) {
      messages = messages.slice(0, -2);
      return stoppedResult("chat", source);
    }
    if (!result.ok) {
      messages = messages.slice(0, -2);
      errorCode = result.errorCode || "stream_error";
      return {
        ...resultFromChat(result.response || "", result.usage, "error"),
        errorCode
      };
    }
    const response = text(result.response);
    messages = messages.map((item, index) => index === messages.length - 1
      ? { ...item, content: response } satisfies ChatbotSessionMessage
      : item);
    history = [
      ...previousHistory,
      { role: "user", content: prompt } satisfies ChatbotSessionMessage,
      { role: "assistant", content: response } satisfies ChatbotSessionMessage
    ].slice(-MAX_HISTORY);
    setQuestionAnswer(response);
    return resultFromChat(response, result.usage, "success");
  }

  function stoppedResult(resultMode: ChatbotMode, resultSource: ChatbotDataSource): ChatbotSessionResult {
    return { ok: false, stopped: true, status: "stopped", mode: resultMode, source: resultSource, response: "", errorCode: "stopped_by_user" };
  }

  async function submit(prompt: string, callbacks: ChatbotRunCallbacks = {}): Promise<ChatbotSessionResult> {
    const query = text(prompt, 20_000);
    if (!query) return { ok: false, status: "error", mode, source, response: "", errorCode: "empty_prompt" };
    if (disposed || status === "running") return { ok: false, status: "error", mode, source, response: "", errorCode: "busy" };
    const linked = linkSignal(options.signal, callbacks.signal);
    activeController = new AbortController();
    const bridge = linkSignal(linked.signal, activeController.signal);
    beginQuestion(query, mode);
    errorCode = null;
    currentResult = null;
    setState("running");
    try {
      const result = mode === "report"
        ? await submitReport(query, callbacks, bridge.signal)
        : await submitChat(query, callbacks, bridge.signal);
      if (result.stopped) {
        setState("stopped", result.source);
        await completeQuestion("failed");
      } else {
        currentResult = result;
        setQuestionAnswer(result.response);
        setState(result.ok ? "success" : "error", result.source);
        await completeQuestion(result.ok ? "success" : "failed");
      }
      callbacks.onChange?.(state());
      return result;
    } catch (error) {
      const stopped = bridge.signal.aborted || (isRecord(error) && error.name === "AbortError");
      const result = stopped ? stoppedResult(mode, source) : { ok: false, status: "error" as const, mode, source, response: "", errorCode: "session_error" };
      currentResult = result;
      errorCode = result.errorCode || null;
      setState(result.status, result.source);
      await completeQuestion(stopped ? "failed" : "failed");
      callbacks.onChange?.(state());
      return result;
    } finally {
      bridge.dispose();
      linked.dispose();
      activeController = null;
    }
  }

  const feedback: ChatbotFeedback = {
    isAvailable() {
      return Boolean(currentQuestion && currentQuestion.answer.trim() && currentResult?.ok);
    },
    async submit(reasonCode: string, reasonDetail = ""): Promise<ChatbotFeedbackResult> {
      const question = currentQuestion;
      const allowed = ["inaccurate", "not_answered", "incomplete_data", "unclear", "other"];
      if (!question || !question.answer.trim() || !currentResult?.ok) return { ok: false, errorCode: "feedback_unavailable" };
      if (!allowed.includes(reasonCode)) return { ok: false, errorCode: "invalid_reason" };
      const record = await completeQuestion("success");
      if (!record) return { ok: false, errorCode: "question_log_unavailable" };
      const feedbackEventId = question.feedbackEventId || uuid("feedback");
      currentQuestion = { ...question, feedbackEventId };
      try {
        const payload = await apiRequest<unknown>("/api/chat/stream?operation=feedback", {
          method: "POST",
          body: JSON.stringify({
            feedbackEventId,
            questionEventId: record.recordId,
            sessionId: browserSessionId(storage),
            mode: question.mode,
            prompt: question.prompt,
            answer: question.answer.slice(0, 120_000),
            language: question.language,
            reasonCode,
            reasonDetail: text(reasonDetail, 4_000)
          })
        });
        return isRecord(payload) && payload.ok === false ? { ok: false, errorCode: text(payload.errorCode || payload.code, 80) } : { ok: true };
      } catch (error) {
        if (isRecord(error) && Number(error.status) === 409) return { ok: true, alreadyExists: true };
        return { ok: false, errorCode: "feedback_error" };
      }
    }
  };

  function addMemory(result: ChatbotSessionResult | ChatbotReportViewResult): boolean {
    const view = "mode" in result ? viewResultFromSession(result, result.response) : result;
    if (!view.message && !view.contentHtml) return false;
    const item = normalizeMemory({
      id: uuid("memory"),
      title: text(view.title || view.category || view.tier || view.intent, 200) || "Report",
      text: text(view.message || view.contentHtml, 8_000),
      ...(view.contentHtml ? { html: view.contentHtml } : {}),
      source: view.source,
      result: view
    });
    if (!item) return false;
    memory = [...memory.filter((entry) => entry.result?.query !== view.query), item].slice(-MAX_MEMORY);
    notify();
    return true;
  }

  function removeMemory(memoryId: string): void {
    memory = memory.filter((item) => item.id !== text(memoryId, 120));
    notify();
  }

  function clearConversation(): void {
    if (status === "running") return;
    history = [];
    messages = [];
    memory = [];
    currentResult = null;
    currentQuestion = null;
    errorCode = null;
    status = "idle";
    notify();
  }

  function openDeepWindow(): string | null {
    const result = currentResult ? viewResultFromSession(currentResult, currentResult.response) : null;
    if (!result) return null;
    return deepWindows.open(result);
  }

  function downloadRecommendation(downloadId: string): boolean {
    const downloaded = options.downloadRecommendation?.(text(downloadId, 120), currentResult) || false;
    if (downloaded || !currentResult) return downloaded;
    return options.downloadReport?.(viewResultFromSession(currentResult, currentResult.response)) || false;
  }

  function downloadOverview(): boolean {
    if (!currentResult) return false;
    return options.downloadReport?.(viewResultFromSession(currentResult, currentResult.response)) || false;
  }

  function downloadLogs(kind: "questions" | "feedback", format: "csv" | "jsonl"): boolean {
    const safeKind = kind === "feedback" ? "feedback" : "questions";
    const safeFormat = format === "jsonl" ? "jsonl" : "csv";
    if (typeof document === "undefined") return false;
    const anchor = document.createElement("a");
    anchor.href = `/api/chat/stream?operation=${safeKind}&format=${safeFormat}`;
    anchor.download = `chat-${safeKind}.${safeFormat}`;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  }

  function setLanguage(nextLanguage: UiLanguage): void {
    currentLanguage = nextLanguage === "en" ? "en" : "zh";
    notify();
  }

  function setMode(nextMode: ChatbotMode): void {
    if (nextMode !== "report" && nextMode !== "chat") return;
    mode = nextMode;
    notify();
  }

  function onChange(listener: (nextState: ChatbotViewState) => void): () => void {
    if (disposed) return () => undefined;
    listeners.add(listener);
    listener(state());
    return () => listeners.delete(listener);
  }

  function toggleHelp(): boolean {
    helpOpen = !helpOpen;
    notify();
    return helpOpen;
  }

  function toggleGuide(): boolean {
    guideOpen = !guideOpen;
    notify();
    return guideOpen;
  }

  function startOnboarding(): boolean {
    onboardingOpen = !onboardingOpen;
    notify();
    return onboardingOpen;
  }

  function stop(): void {
    activeController?.abort();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    activeController?.abort();
    activeController = null;
    listeners.clear();
    if (!options.deepWindows) deepWindows.dispose();
  }

  return {
    getState: state,
    deepWindows,
    setLanguage,
    setMode,
    submit,
    addMemory,
    removeMemory,
    clearConversation,
    downloadOverview,
    downloadRecommendation,
    openDeepWindow,
    onChange,
    feedback,
    downloadLogs,
    toggleHelp,
    toggleGuide,
    startOnboarding,
    stop,
    dispose
  };
}
