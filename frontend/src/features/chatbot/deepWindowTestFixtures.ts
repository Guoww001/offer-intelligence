import type { LegacyDeepWindowSkeletonStep } from "../../legacy/contracts";
import type { ChatbotReportViewResult } from "./chatbotViewTypes";

export const deepWindowReport: ChatbotReportViewResult = {
  intent: "merchant",
  status: "resolved",
  query: "Tapo",
  source: "db",
  rows: [],
  summary: { offerCount: 0, clicks: 0, orders: 0, revenue: 0, commission: 0, conversionRate: null },
  message: "Tapo report"
};

export const deepWindowSkeletonSteps: readonly LegacyDeepWindowSkeletonStep[] = [
  { id: "fetch", label: "读取数据", state: "active" },
  { id: "analyze", label: "分析结果", state: "pending" },
  { id: "render", label: "整理报告", state: "pending" }
];

export const baseDeepWindowProps = {
  id: "deep-1",
  language: "zh" as const,
  result: deepWindowReport,
  title: "Tapo",
  summary: "Tapo report summary",
  contentHtml: "<section>Report sections</section>",
  errorMessage: "error",
  skeletonSteps: deepWindowSkeletonSteps,
  zIndex: 10,
  position: { x: 200, y: 220 },
  minimized: false,
  pinned: false,
  overlay: false,
  canAddMemory: true,
  addedToMemory: false,
  canExport: true,
  canMinimize: true,
  canClose: true,
  feedbackState: "available" as const
};

export const loadingDeepWindow = (overrides: Record<string, unknown> = {}) => ({
  ...baseDeepWindowProps,
  status: "loading" as const,
  ...overrides
});

export const readyDeepWindow = (overrides: Record<string, unknown> = {}) => ({
  ...baseDeepWindowProps,
  status: "content" as const,
  ...overrides
});

export const errorDeepWindow = (overrides: Record<string, unknown> = {}) => ({
  ...baseDeepWindowProps,
  status: "error" as const,
  ...overrides
});
