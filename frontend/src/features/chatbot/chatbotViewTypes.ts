import type { ChatbotReportResult as ChatbotModelReportResult } from "./chatbotReportModel";
import type {
  LegacyChatSessionBridge,
  LegacyChatViewResult,
  LegacyDataSource
} from "../../legacy/contracts";

export type ChatbotMode = "report" | "chat";

export interface ChatbotMemoryItem {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly result?: ChatbotReportViewResult;
  readonly html?: string;
  readonly source?: LegacyDataSource;
}

export interface ChatbotHistoryMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface ChatbotChatRequest {
  readonly prompt: string;
  readonly language: "zh" | "en";
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

export type ChatbotReportViewResult = ChatbotModelReportResult & {
  readonly title?: string;
  readonly contentHtml?: string;
  readonly legacyHtml?: string;
  readonly recommendationHtml?: string;
  readonly bridgeResult?: LegacyChatViewResult;
};

export type ChatbotSession = LegacyChatSessionBridge;

export interface ChatbotReportRequest {
  readonly prompt: string;
  readonly language: "zh" | "en";
  readonly signal?: AbortSignal;
}

export type ChatbotReportRunner = (
  request: ChatbotReportRequest
) => Promise<ChatbotReportViewResult>;
