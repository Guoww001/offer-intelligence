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
export type UiLanguage = "zh" | "en";

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
  setLanguage(language: UiLanguage): void;
  hasPage(page: ModernPageName): boolean;
}

export interface LegacyBridgeApi {
  navigate(page: ModernPageName): void;
  requestRender(page: ModernPageName): void;
  download(type: string, payload: unknown): void;
}
