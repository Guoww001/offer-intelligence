export type ChatbotIntent =
  | "asin"
  | "merchant"
  | "payment"
  | "recommendation"
  | "tier"
  | "category"
  | "analysis";

export type ChatbotMetricOperator = "gt" | "gte" | "lt" | "lte" | "eq";

export interface ChatbotMetricFilter {
  readonly field: string;
  readonly operator: ChatbotMetricOperator;
  readonly value: number;
}

export interface ChatbotSearchOptions {
  readonly tier?: string | null;
  readonly includeTier4?: boolean;
  readonly includeBlack?: boolean;
  readonly metricFilters?: readonly ChatbotMetricFilter[];
}

export interface ChatbotSearchMatch {
  readonly offer: Readonly<Record<string, unknown>>;
  readonly score: number;
  readonly matchType: "merchant" | "asin" | "keyword" | "category";
  readonly matchedTerms: readonly string[];
}

export interface ChatbotMerchantResolution {
  readonly status: "resolved" | "ambiguous" | "not_found";
  readonly matches: readonly ChatbotSearchMatch[];
}
