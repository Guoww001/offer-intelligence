import type { UiLanguage } from "../../shared/i18n";
import { runReportEngine } from "../chatbot/report/reportEngine";
import { resolveReportQuery } from "../chatbot/report/reportQuery";
import type { ReportDataProvider, ReportDocument, ReportRow } from "../chatbot/report/reportContracts";

export interface AgentPublisherRequest {
  readonly kind: "publisher" | "publisherprofile";
  readonly query: string;
  readonly language: UiLanguage;
  readonly signal: AbortSignal;
}

export interface AgentPublisherDependencies {
  readonly offers: readonly ReportRow[];
  readonly paymentRecords: readonly ReportRow[];
  readonly productKeywords: unknown;
  readonly provider: ReportDataProvider;
  readonly now?: () => Date;
}

export interface AgentPublisherResult {
  readonly html: string;
  readonly text: string;
  readonly source: "cache" | "db" | "unavailable";
  readonly report: ReportDocument;
}

export async function runAgentPublisher(
  request: AgentPublisherRequest,
  dependencies: AgentPublisherDependencies
): Promise<AgentPublisherResult> {
  const query = resolveReportQuery(`${request.kind}: ${request.query}`, {
    language: request.language,
    categories: []
  });
  const result = await runReportEngine({
    query,
    language: request.language,
    signal: request.signal,
    offers: dependencies.offers,
    paymentRecords: dependencies.paymentRecords,
    productKeywords: dependencies.productKeywords,
    provider: dependencies.provider,
    now: dependencies.now || (() => new Date())
  });
  return {
    html: result.view.contentHtml || "",
    text: result.view.message || "",
    source: result.view.source,
    report: result.report
  };
}

export function createAgentPublisherBridge(
  getDependencies: () => AgentPublisherDependencies
): (request: AgentPublisherRequest) => Promise<AgentPublisherResult> {
  return (request) => runAgentPublisher(request, getDependencies());
}
