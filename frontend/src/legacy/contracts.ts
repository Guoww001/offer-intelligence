import type { UiLanguage } from "../shared/i18n";
import type { AgentResultView } from "../shared/contracts/agentResult";

export const MODERN_PAGE_NAMES = [
  "offer-list-tracker",
  "payments",
  "publishers",
  "monthly-new-merchants",
  "brand-media",
  "revenue-flow",
  "google-ads",
  "sheets",
  "category",
  "tier",
  "dashboard",
  "agent"
] as const;

export type ModernPageName = (typeof MODERN_PAGE_NAMES)[number];
export type { UiLanguage } from "../shared/i18n";

export interface LegacyBootstrapData {
  chatbotData: unknown;
  sheetReportData: unknown;
  productKeywords: unknown;
  language: UiLanguage;
  llmEnabled: boolean;
  agentEnabled: boolean;
}

export interface ModernAppApi {
  bootstrap(data: LegacyBootstrapData): void;
  mountPage(page: ModernPageName, element: HTMLElement): boolean;
  unmountPage(page: ModernPageName): void;
  mountShell(element: HTMLElement): boolean;
  unmountShell(): void;
  setPage(page: ModernPageName): void;
  setLanguage(language: UiLanguage): void;
  hasPage(page: ModernPageName): boolean;
}

export interface ModernPageController {
  unmount(): void;
  setLanguage?(language: UiLanguage): void;
}

export type ModernPageFactory = (element: HTMLElement) => ModernPageController;

export interface ModernShellController {
  unmount(): void;
  setPage?(page: ModernPageName): void;
  setLanguage?(language: UiLanguage): void;
}

export type ModernShellFactory = (element: HTMLElement) => ModernShellController;

export type LegacyDataSource = "cache" | "db" | "unavailable";
export type LegacySessionStatus = "idle" | "running" | "success" | "stopped" | "error";

export interface LegacySessionMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export type LegacyAnswerFeedbackState = "available" | "submitted" | "unavailable";

export interface LegacyChatAnswerMessage extends LegacySessionMessage {
  readonly id?: string;
  readonly answerId?: string;
  readonly contentHtml?: string;
  readonly deepWindowId?: string | null;
  readonly canOpenDeep?: boolean;
  readonly feedbackState?: LegacyAnswerFeedbackState;
}

export interface LegacyChatMemoryItem {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly html?: string;
  readonly source?: LegacyDataSource;
}

export interface LegacyChatStarterCard {
  readonly id: string;
  readonly title: string;
  readonly type: string;
  readonly questions: readonly string[];
}

export interface LegacyChatViewResult {
  readonly ok: boolean;
  readonly status: Exclude<LegacySessionStatus, "idle" | "running">;
  readonly mode: "report" | "chat";
  readonly source: LegacyDataSource;
  readonly intent?: string;
  readonly response: string;
  readonly contentHtml?: string;
  readonly recommendationHtml?: string;
  readonly reportSnapshot?: unknown;
  readonly deepWindowId?: string | null;
  readonly answerId?: string | null;
  readonly feedbackState?: LegacyAnswerFeedbackState;
  readonly errorCode?: string | null;
}

export interface LegacyChatUtilityState {
  readonly helpOpen: boolean;
  readonly guideOpen: boolean;
  readonly helpHtml: string;
  readonly guideHtml: string;
  readonly guideLoading: boolean;
  readonly onboardingOpen: boolean;
  readonly onboardingStep: number;
  readonly onboardingTotal: number;
  readonly reminderVisible: boolean;
  readonly reminderCollapsed: boolean;
}

export interface LegacyChatViewState {
  readonly mode: "report" | "chat";
  readonly language: UiLanguage;
  readonly contextTitle?: string;
  readonly contextSubtitle?: string;
  readonly contextHtml?: string;
  readonly hasMemory: boolean;
  readonly source: LegacyDataSource;
  readonly status: LegacySessionStatus;
  readonly history: readonly LegacyChatAnswerMessage[];
  readonly messages: readonly LegacyChatAnswerMessage[];
  readonly memory: readonly LegacyChatMemoryItem[];
  readonly starterCards?: readonly LegacyChatStarterCard[];
  readonly currentResult: LegacyChatViewResult | null;
  readonly utility?: LegacyChatUtilityState;
  readonly supplementalHtml?: string;
  readonly errorCode?: string | null;
}

export interface LegacyChatRunCallbacks {
  readonly onToken?: (token: string) => void;
  readonly onChange?: (state: LegacyChatViewState) => void;
  readonly signal?: AbortSignal;
}

export interface LegacyChatSessionBridge {
  getState(): LegacyChatViewState;
  setMode(mode: "report" | "chat"): void;
  submit(prompt: string, callbacks?: LegacyChatRunCallbacks): Promise<LegacyChatViewResult>;
  addMemory?(result: LegacyChatViewResult): boolean;
  removeMemory(memoryId: string): void;
  clearConversation(): void;
  downloadOverview?(): boolean;
  downloadRecommendation?(downloadId: string): boolean;
  openDeepWindow?: () => string | null;
  onChange(listener: (state: LegacyChatViewState) => void): () => void;
  feedback?: LegacyFeedbackBridge;
  downloadLogs?: (kind: "questions" | "feedback", format: "csv" | "jsonl") => boolean;
  toggleHelp?: () => boolean;
  toggleGuide?: () => boolean;
  startOnboarding?: () => boolean;
  feedbackForAnswer?(answerId: string): LegacyFeedbackBridge | null;
  feedbackForDeepWindow?(windowId: string): LegacyFeedbackBridge | null;
  openChatAnswer?(answerId: string): string | null;
  interactContext?(action: string, value?: string): boolean;
}

export interface LegacyFeedbackResult {
  readonly ok: boolean;
  readonly alreadyExists?: boolean;
  readonly errorCode?: string;
}

export interface LegacyFeedbackBridge {
  isAvailable(): boolean;
  submit(reasonCode: string, reasonDetail?: string): Promise<LegacyFeedbackResult>;
}

export type LegacyDeepWindowStatus = "loading" | "content" | "error";

export interface LegacyDeepWindowView {
  readonly id: string;
  readonly mode: "report" | "chat";
  readonly status: LegacyDeepWindowStatus;
  readonly title: string;
  readonly prompt: string;
  readonly summary: string;
  readonly contentHtml?: string;
  readonly source: LegacyDataSource;
  readonly minimized: boolean;
  readonly pinned: boolean;
  readonly overlay: boolean;
  readonly position: { readonly x: number; readonly y: number };
  readonly canCancel: boolean;
  readonly canAddMemory: boolean;
  readonly addedToMemory: boolean;
  readonly skeletonSteps?: readonly LegacyDeepWindowSkeletonStep[];
  readonly errorMessage?: string;
  readonly zIndex?: number;
  readonly canExport?: boolean;
  readonly canMinimize?: boolean;
  readonly canClose?: boolean;
  readonly feedbackState?: LegacyAnswerFeedbackState;
}

export interface LegacyDeepWindowSkeletonStep {
  readonly id: string;
  readonly label: string;
  readonly state: "pending" | "active" | "done";
}

export interface LegacyDeepWindowsViewState {
  readonly windows: readonly LegacyDeepWindowView[];
  readonly activeId: string | null;
}

export type LegacyDeepWindowInteraction =
  | "trend-metric"
  | "trend-category"
  | "trend-column-toggle"
  | "trend-column-core"
  | "trend-column-all";

export interface LegacyDeepWindowsBridge {
  getState(): LegacyDeepWindowsViewState;
  activate(id: string): void;
  minimize(id: string): void;
  restore(id: string): void;
  close(id: string): void;
  pin(id: string): boolean;
  move(id: string, x: number, y: number): boolean;
  clone(id: string): string | null;
  toggleOverlay(id: string): boolean;
  export(id: string): boolean;
  cancel(id: string): boolean;
  addToChat(id: string): boolean;
  interact(id: string, action: LegacyDeepWindowInteraction, value?: string): boolean;
  setTrendColumns(id: string, columns: readonly string[]): boolean;
  onChange(listener: (state: LegacyDeepWindowsViewState) => void): () => void;
}

export type LegacyAgentTimelinePhase = "planning" | "tool" | "synthesis";
export type LegacyAgentTimelineStatus = "running" | "done" | "error" | "stopped" | "timeout";

export interface LegacyAgentTimelineStep {
  readonly id: string;
  readonly phase: LegacyAgentTimelinePhase;
  readonly status: LegacyAgentTimelineStatus;
  readonly label: string;
  readonly detail?: string;
  readonly elapsedMs?: number;
  readonly dataSource?: "cache" | "database" | "mixed" | "unavailable" | "unknown";
  readonly dataAsOf?: string | null;
  readonly estimated?: boolean;
}

export interface LegacyAgentViewState {
  readonly status: "idle" | "running" | "done" | "stopped" | "error";
  readonly history: readonly LegacySessionMessage[];
  readonly messages?: readonly LegacySessionMessage[];
  readonly steps: readonly LegacyAgentTimelineStep[];
  readonly response: string;
  readonly partial: boolean;
  readonly omittedTargets: readonly string[];
  /** Safe, render-ready projections only; raw tool payloads stay in Python. */
  readonly resultViews?: readonly AgentResultView[];
  readonly hasMemory: boolean;
  readonly memory?: unknown;
  readonly errorCode?: string | null;
}

export interface LegacyAgentRunRequest {
  readonly prompt: string;
  readonly language: UiLanguage;
  readonly history: readonly LegacySessionMessage[];
  readonly memoryText: string;
  readonly signal: AbortSignal;
}

export interface LegacyAgentRunCallbacks {
  readonly onToken?: (token: string) => void;
  readonly onTimeline?: (step: LegacyAgentTimelineStep) => void;
  readonly onResultView?: (view: AgentResultView) => void;
  readonly onChange?: (state: LegacyAgentViewState) => void;
}

export interface LegacyAgentRunResult {
  readonly ok: boolean;
  readonly status: "done" | "stopped" | "error";
  readonly response: string;
  readonly steps: readonly LegacyAgentTimelineStep[];
  readonly partial?: boolean;
  readonly omittedTargets?: readonly string[];
  readonly resultViews?: readonly AgentResultView[];
  readonly memoryEvents?: readonly Record<string, unknown>[];
  readonly errorCode?: string | null;
}

export interface LegacyAgentSessionBridge {
  getState(): LegacyAgentViewState;
  submit(request: LegacyAgentRunRequest, callbacks?: LegacyAgentRunCallbacks): Promise<LegacyAgentRunResult>;
  stop(): void;
  newConversation(): void;
  onChange(listener: (state: LegacyAgentViewState) => void): () => void;
  feedback?: LegacyFeedbackBridge;
  downloadLogs?: (kind: "questions" | "feedback", format: "csv" | "jsonl") => boolean;
}

export interface LegacyBridgeApi {
  navigate(page: ModernPageName): void;
  setLanguage(language: UiLanguage): void;
  download(type: string, payload: unknown): boolean;
  chatSession?: LegacyChatSessionBridge;
  agentSession?: LegacyAgentSessionBridge;
  deepWindows?: LegacyDeepWindowsBridge;
  runChat?(request: {
    readonly prompt: string;
    readonly language: UiLanguage;
    readonly history: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
    readonly memoryText: string;
    readonly signal?: AbortSignal;
    readonly onToken?: (token: string) => void;
  }): Promise<{
    readonly ok: boolean;
    readonly stopped?: boolean;
    readonly response: string;
    readonly usage?: Record<string, unknown> | null;
    readonly errorCode?: string | null;
  }>;
  runAgent?(request: {
    readonly prompt: string;
    readonly language: UiLanguage;
    readonly history: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
    readonly memoryText: string;
    readonly signal: AbortSignal;
    readonly onToken?: (token: string) => void;
    readonly onTimeline?: (step: LegacyAgentTimelineStep) => void;
    readonly onResultView?: (view: AgentResultView) => void;
  }): Promise<{
    readonly ok: boolean;
    readonly status: "done" | "stopped" | "error";
    readonly response: string;
    readonly steps: readonly LegacyAgentTimelineStep[];
    readonly partial?: boolean;
    readonly omittedTargets?: readonly string[];
    readonly resultViews?: readonly AgentResultView[];
    readonly memoryEvents?: readonly Record<string, unknown>[];
  }>;
  executeAgentTool?(request: {
    readonly callId: string;
    readonly toolName: string;
    readonly arguments: Record<string, unknown>;
    readonly prompt: string;
    readonly signal?: AbortSignal;
  }): Promise<{
    readonly toolResult: Record<string, unknown>;
    readonly memoryEvent?: Record<string, unknown> | null;
    readonly resultView?: AgentResultView | null;
  }>;
}
