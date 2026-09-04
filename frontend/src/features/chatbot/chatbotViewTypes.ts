import type { UiLanguage } from "../../shared/i18n";
import type { ChatbotReportResult as ChatbotModelReportResult } from "./chatbotReportModel";
import type { DeepWindowStore } from "./deepWindowStore";

export type ChatbotMode = "report" | "chat";
export type ChatbotDataSource = "cache" | "db" | "unavailable";
export type ChatbotSessionStatus = "idle" | "running" | "success" | "stopped" | "error";
export type ChatbotAnswerFeedbackState = "available" | "submitted" | "unavailable";

export interface ChatbotMemoryItem {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly result?: ChatbotReportViewResult;
  readonly html?: string;
  readonly source?: ChatbotDataSource;
}

export interface ChatbotHistoryMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface ChatbotSessionMessage extends ChatbotHistoryMessage {
  readonly id?: string;
  readonly answerId?: string;
  readonly contentHtml?: string;
  readonly deepWindowId?: string | null;
  readonly canOpenDeep?: boolean;
  readonly feedbackState?: ChatbotAnswerFeedbackState;
}

export interface ChatbotChatRequest {
  readonly prompt: string;
  readonly language: UiLanguage;
  readonly history: readonly ChatbotHistoryMessage[];
  readonly memoryText: string;
  readonly signal?: AbortSignal;
}

export interface ChatbotUsage {
  readonly usageAvailable?: boolean;
  readonly outputTokens?: number | null;
  readonly outputChunks?: number | null;
  readonly errorCode?: string | null;
}

export interface ChatbotChatResult {
  readonly ok: boolean;
  readonly stopped?: boolean;
  readonly response: string;
  readonly usage?: ChatbotUsage | null;
  readonly errorCode?: string | null;
}

export type ChatbotChatRunner = (
  request: ChatbotChatRequest,
  onToken?: (token: string) => void
) => Promise<ChatbotChatResult>;

export interface ChatbotSessionResult {
  readonly ok: boolean;
  readonly stopped?: boolean;
  readonly status: Exclude<ChatbotSessionStatus, "idle" | "running">;
  readonly mode: ChatbotMode;
  readonly source: ChatbotDataSource;
  readonly intent?: string;
  readonly response: string;
  readonly contentHtml?: string;
  readonly recommendationHtml?: string;
  readonly reportSnapshot?: unknown;
  readonly report?: ChatbotReportViewResult;
  readonly deepWindowId?: string | null;
  readonly answerId?: string | null;
  readonly feedbackState?: ChatbotAnswerFeedbackState;
  readonly usage?: ChatbotUsage | null;
  readonly errorCode?: string | null;
}

export type ChatbotReportViewResult = ChatbotModelReportResult & {
  readonly title?: string;
  readonly contentHtml?: string;
  readonly recommendationHtml?: string;
  readonly sessionResult?: ChatbotSessionResult;
};

export interface ChatbotStarterCard {
  readonly id: string;
  readonly title: string;
  readonly type: string;
  readonly questions: readonly string[];
}

export interface ChatbotUtilityState {
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

export interface ChatbotViewState {
  readonly mode: ChatbotMode;
  readonly language: UiLanguage;
  readonly contextTitle?: string;
  readonly contextSubtitle?: string;
  readonly contextHtml?: string;
  readonly hasMemory: boolean;
  readonly source: ChatbotDataSource;
  readonly status: ChatbotSessionStatus;
  readonly history: readonly ChatbotSessionMessage[];
  readonly messages: readonly ChatbotSessionMessage[];
  readonly memory: readonly ChatbotMemoryItem[];
  readonly starterCards?: readonly ChatbotStarterCard[];
  readonly currentResult: ChatbotSessionResult | null;
  readonly utility?: ChatbotUtilityState;
  readonly supplementalHtml?: string;
  readonly errorCode?: string | null;
}

export interface ChatbotRunCallbacks {
  readonly onToken?: (token: string) => void;
  readonly onChange?: (state: ChatbotViewState) => void;
  readonly signal?: AbortSignal;
}

export interface ChatbotFeedbackResult {
  readonly ok: boolean;
  readonly alreadyExists?: boolean;
  readonly errorCode?: string;
}

export interface ChatbotFeedback {
  isAvailable(): boolean;
  submit(reasonCode: string, reasonDetail?: string): Promise<ChatbotFeedbackResult>;
}

export interface ChatbotSession {
  readonly deepWindows?: DeepWindowStore;
  getState(): ChatbotViewState;
  setLanguage?(language: UiLanguage): void;
  setMode(mode: ChatbotMode): void;
  submit(prompt: string, callbacks?: ChatbotRunCallbacks): Promise<ChatbotSessionResult>;
  addMemory?(result: ChatbotSessionResult | ChatbotReportViewResult): boolean;
  removeMemory(memoryId: string): void;
  clearConversation(): void;
  downloadOverview?(): boolean;
  downloadRecommendation?(downloadId: string): boolean;
  openDeepWindow?(): string | null;
  onChange(listener: (state: ChatbotViewState) => void): () => void;
  feedback?: ChatbotFeedback;
  downloadLogs?: (kind: "questions" | "feedback", format: "csv" | "jsonl") => boolean;
  toggleHelp?: () => boolean;
  toggleGuide?: () => boolean;
  startOnboarding?: () => boolean;
  feedbackForAnswer?(answerId: string): ChatbotFeedback | null;
  feedbackForDeepWindow?(windowId: string): ChatbotFeedback | null;
  openChatAnswer?(answerId: string): string | null;
  interactContext?(action: string, value?: string): boolean;
  stop?(): void;
  dispose?(): void;
}

export interface ChatbotReportRequest {
  readonly prompt: string;
  readonly language: UiLanguage;
  readonly signal?: AbortSignal;
}

export type ChatbotReportRunner = (
  request: ChatbotReportRequest
) => Promise<ChatbotReportViewResult>;
