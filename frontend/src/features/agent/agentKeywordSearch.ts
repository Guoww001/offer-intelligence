import type { UiLanguage } from "../../shared/i18n";
import { normalizeChatbotText } from "../chatbot/chatbotModel";
import { buildEntityReport, metricValue, nullableNumber, rowMerchantId, rowMerchantName } from "../chatbot/report/entityReports";
import { resolveReportQuery } from "../chatbot/report/reportQuery";
import { compareRecommendationOffers } from "../chatbot/report/recommendationReports";
import type { ReportRow } from "../chatbot/report/reportContracts";
import { canonicalChatbotTier } from "../chatbot/chatbotModel";
import { agentMetricLabel } from "./agentResultPresentation";

type Row = Readonly<Record<string, unknown>>;

export const AGENT_KEYWORD_METRICS = ["salesAmount", "orders", "conversionRate", "aov", "epc", "affCommission", "clicks"] as const;
export type AgentKeywordMetric = typeof AGENT_KEYWORD_METRICS[number];
export interface AgentKeywordConstraints {
  readonly tiers?: readonly string[];
  readonly metricFilters?: readonly { readonly field: string; readonly operator: string; readonly value: number }[];
  readonly metricSort?: { readonly field: string; readonly direction: string };
}

export function parseAgentKeywordConstraints(args: Record<string, unknown>): AgentKeywordConstraints | null {
  const tiers = args.tiers ?? [];
  const filters = args.metricFilters ?? [];
  const metrics = new Set<string>(AGENT_KEYWORD_METRICS);
  const tierNames = new Set(["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"]);
  if (!Array.isArray(tiers) || tiers.length > 5 || tiers.some(value => typeof value !== "string" || !tierNames.has(value))) return null;
  if (!Array.isArray(filters) || filters.length > 6 || filters.some(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return true;
    const filter = value as Record<string, unknown>;
    return Object.keys(filter).some(key => !["field", "operator", "value"].includes(key))
      || !metrics.has(String(filter.field)) || ![">", ">=", "<", "<=", "="].includes(String(filter.operator))
      || typeof filter.value !== "number" || !Number.isFinite(filter.value);
  })) return null;
  let metricSort: AgentKeywordConstraints["metricSort"];
  if (args.metricSort !== undefined) {
    if (!args.metricSort || typeof args.metricSort !== "object" || Array.isArray(args.metricSort)) return null;
    const sort = args.metricSort as Record<string, unknown>;
    if (Object.keys(sort).some(key => !["field", "direction"].includes(key)) || !metrics.has(String(sort.field)) || !["asc", "desc"].includes(String(sort.direction))) return null;
    metricSort = { field: String(sort.field), direction: String(sort.direction) };
  }
  return { tiers: [...new Set(tiers)], metricFilters: filters, ...(metricSort ? { metricSort } : {}) };
}

function values(row: Row, keys: readonly string[]): string[] {
  return keys.flatMap((key) => (Array.isArray(row[key]) ? row[key] as unknown[] : [row[key]]))
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim()).filter(Boolean);
}

function evidence(row: Row, keyword: string): { matchedField: string; matchedText: string } {
  const groups: Array<[string, readonly string[]]> = [
    ["productTitles", ["productTitles", "productTitle"]],
    ["productKeywords", ["productNameKeywords", "product_name_keywords", "productKeywords", "product_keywords", "keywords", "keyword"]],
    ["merchantName", ["merchantName", "brand", "merchant_name"]],
    ["category", ["sheetCategory", "mainCategory", "category", "levantaCategory", "feishuMainCategory"]]
  ];
  const needle = normalizeChatbotText(keyword);
  for (const [matchedField, keys] of groups) {
    const found = values(row, keys).find((value) => normalizeChatbotText(value).includes(needle));
    if (found) return { matchedField, matchedText: found.slice(0, 80) };
  }
  return { matchedField: "other", matchedText: keyword.slice(0, 80) };
}

function availableMetric(row: Row, aliases: readonly string[], field: string): number | undefined {
  if (nullableNumber(row, aliases) === null) return undefined;
  const value = metricValue(row, field);
  return Number.isFinite(value) ? value : undefined;
}

export interface AgentKeywordMatch {
  readonly merchantId: string;
  readonly merchantName: string;
  readonly tier?: string;
  readonly category?: string;
  readonly matchedField: string;
  readonly matchedText: string;
  readonly rank?: number;
  readonly ranked?: boolean;
  readonly salesAmount?: number;
  readonly orders?: number;
  readonly aov?: number;
  readonly affCommission?: number;
  readonly conversionRate?: number;
  readonly epc?: number;
  readonly clicks?: number;
}

export interface AgentKeywordResult {
  readonly keyword: string;
  readonly matchedKeyword: string;
  readonly matchType: "exact" | "semantic";
  readonly mode: "search" | "recommendation";
  readonly rows: readonly AgentKeywordMatch[];
  readonly matchedCount: number;
  readonly returnedCount: number;
  readonly truncated: boolean;
  readonly unrankedCount: number;
  readonly headline: string;
  readonly note: string;
  readonly partial: boolean;
  readonly appliedFilters: AgentKeywordConstraints;
  readonly eligibleCount: number;
  readonly excludedMissingMetricsCount: number;
  readonly matchSetComplete: boolean;
}

export function searchAgentKeywords(
  keyword: string,
  mode: "search" | "recommendation",
  limit: number,
  offers: readonly ReportRow[],
  productKeywords: unknown,
  language: UiLanguage,
  partial: boolean,
  semanticAlternatives: readonly string[] = [],
  constraints: AgentKeywordConstraints = {}
): AgentKeywordResult {
  const query = resolveReportQuery(`/keyword: ${keyword}`, { language, categories: [] });
  const report = buildEntityReport({ ...query, semanticAlternatives }, offers, productKeywords, language);
  const matchedKeyword = report.matchedKeyword || keyword;
  const semantic = normalizeChatbotText(matchedKeyword) !== normalizeChatbotText(keyword);
  const offerById = new Map(offers.map((row) => [rowMerchantId(row), row]));
  const matches = report.rows.flatMap((row) => {
    const merchantId = rowMerchantId(row);
    const merchantName = rowMerchantName(row);
    if (!merchantId || !merchantName) return [];
    const offer = offerById.get(merchantId);
    const salesAmount = offer && availableMetric(offer, ["salesAmount", "revenue", "Revenue", "sales", "totalSales"], "salesAmount");
    const orders = offer && availableMetric(offer, ["orders", "orderCount", "Order count", "Orders"], "orders");
    const affCommission = offer && availableMetric(offer, ["affCommission", "affiliatePayout", "commissionMade", "AFF Commission", "commission"], "affCommission");
    const clicks = offer && availableMetric(offer, ["clicks", "Clicks", "totalClicks"], "clicks");
    const explicitConversion = offer && availableMetric(offer, ["conversionRate", "conversion", "CVR", "Conversion Rate"], "conversionRate");
    const explicitEpc = offer && availableMetric(offer, ["epc", "affEpc", "EPC", "EPC(Aff)", "Backend EPC"], "epc");
    const explicitAov = offer && availableMetric(offer, ["aov", "AOV"], "aov");
    const conversionRate = explicitConversion ?? (offer && orders !== undefined && clicks !== undefined && clicks > 0 ? metricValue(offer, "conversionRate") : undefined);
    const epc = explicitEpc ?? (offer && affCommission !== undefined && clicks !== undefined && clicks > 0 ? metricValue(offer, "epc") : undefined);
    const aov = explicitAov ?? (offer && salesAmount !== undefined && orders !== undefined && orders > 0 ? metricValue(offer, "aov") : undefined);
    const ranked = Boolean(offer && [salesAmount, orders, aov, affCommission, clicks, conversionRate, epc].some((value) => value !== undefined));
    const match: AgentKeywordMatch = {
      merchantId: merchantId.slice(0, 80), merchantName: merchantName.slice(0, 120),
      ...(typeof row.tier === "string" && row.tier ? { tier: row.tier.slice(0, 40) } : {}),
      ...(typeof row.category === "string" && row.category ? { category: row.category.slice(0, 120) } : {}),
      ...evidence(row, matchedKeyword),
      ...(mode === "recommendation" ? { ranked } : {}),
      ...(salesAmount !== undefined ? { salesAmount } : {}),
      ...(orders !== undefined ? { orders } : {}),
      ...(aov !== undefined ? { aov } : {}),
      ...(affCommission !== undefined ? { affCommission } : {}),
      ...(clicks !== undefined ? { clicks } : {}),
      ...(conversionRate !== undefined ? { conversionRate } : {}),
      ...(epc !== undefined ? { epc } : {})
    };
    return [{ match, offer, ranked }];
  });
  const appliedFilters = { tiers: constraints.tiers || [], metricFilters: constraints.metricFilters || [], ...(constraints.metricSort ? { metricSort: constraints.metricSort } : {}) };
  let excludedMissingMetricsCount = 0;
  const eligible = matches.filter(({ match }) => {
    if (appliedFilters.tiers.length && !appliedFilters.tiers.includes(canonicalChatbotTier(match.tier))) return false;
    const required = [...appliedFilters.metricFilters.map(filter => filter.field), ...(appliedFilters.metricSort ? [appliedFilters.metricSort.field] : [])];
    if (required.some(field => typeof match[field as AgentKeywordMetric] !== "number")) {
      excludedMissingMetricsCount++;
      return false;
    }
    return appliedFilters.metricFilters.every(filter => {
      const value = match[filter.field as AgentKeywordMetric] as number;
      switch (filter.operator) {
        case ">": return value > filter.value;
        case ">=": return value >= filter.value;
        case "<": return value < filter.value;
        case "<=": return value <= filter.value;
        case "=": return value === filter.value;
        default: return false;
      }
    });
  });
  const ordered = appliedFilters.metricSort
    ? eligible.sort((left, right) => {
      const sort = appliedFilters.metricSort!;
      const delta = (left.match[sort.field as AgentKeywordMetric] as number) - (right.match[sort.field as AgentKeywordMetric] as number);
      return (sort.direction === "asc" ? delta : -delta) || left.match.merchantId.localeCompare(right.match.merchantId, undefined, { numeric: true });
    })
    : mode === "recommendation"
    ? [
      ...eligible.filter((item) => item.ranked).sort((left, right) => compareRecommendationOffers(left.offer!, right.offer!)),
      ...eligible.filter((item) => !item.ranked)
    ]
    : eligible;
  let rank = 0;
  const rows = ordered.slice(0, limit).map((item) => item.ranked && mode === "recommendation"
    ? { ...item.match, rank: ++rank }
    : item.match);
  const unrankedCount = mode === "recommendation" ? eligible.filter((item) => !item.ranked).length : 0;
  const headline = language === "zh"
    ? `${keyword}${semantic ? ` → ${matchedKeyword}` : ""} ${mode === "recommendation" ? "匹配商家推荐" : "关键词匹配商家"}`
    : `${keyword}${semantic ? ` → ${matchedKeyword}` : ""} ${mode === "recommendation" ? "matched merchant recommendations" : "keyword matches"}`;
  const notes = [
    ...(semantic && report.note ? [report.note] : []),
    ...(appliedFilters.tiers.length ? [`Tier: ${appliedFilters.tiers.join(language === "zh" ? "、" : ", ")}.`] : []),
    ...appliedFilters.metricFilters.map(filter => `${agentMetricLabel(filter.field, language)} ${filter.operator} ${filter.field === "conversionRate" ? `${filter.value * 100}%` : filter.value}.`),
    ...(appliedFilters.metricSort ? [`${agentMetricLabel(appliedFilters.metricSort.field, language)} ${language === "zh" ? (appliedFilters.metricSort.direction === "asc" ? "升序" : "降序") : appliedFilters.metricSort.direction}.`] : []),
    mode === "recommendation"
      ? (language === "zh" ? "按命中商家的整体快照表现排序，不代表该关键词商品销量。" : "Ranked by matched merchants' overall snapshot performance, not product sales.")
      : (language === "zh" ? "按产品关键词及商户搜索字段匹配，未按表现排序。" : "Matched search fields; not ranked by performance."),
    ...(unrankedCount ? [language === "zh" ? `${unrankedCount} 家仅在关键词目录中命中，未参与排序。` : `${unrankedCount} catalog-only merchants were not ranked.`] : []),
    ...(appliedFilters.tiers.length || appliedFilters.metricFilters.length || appliedFilters.metricSort ? [language === "zh" ? `应用全部筛选条件后 ${eligible.length} 家符合；${excludedMissingMetricsCount} 家因必要指标缺失排除。` : `${eligible.length} merchants meet all filters; ${excludedMissingMetricsCount} excluded for missing required metrics.`] : []),
    ...(eligible.length > limit ? [language === "zh" ? `仅显示前 ${limit} 家。` : `Showing only the first ${limit} merchants.`] : []),
    ...(partial ? [language === "zh" ? "关键词目录不可用，当前匹配可能不完整。" : "Keyword catalog unavailable; matches may be incomplete."] : []),
    ...(report.status === "needs_input" && report.note ? [report.note] : [])
  ];
  return { keyword, matchedKeyword, matchType: semantic ? "semantic" : "exact", mode, rows, matchedCount: matches.length, returnedCount: rows.length, truncated: eligible.length > limit, unrankedCount, headline, note: notes.join(" "), partial, appliedFilters, eligibleCount: eligible.length, excludedMissingMetricsCount, matchSetComplete: !partial };
}
