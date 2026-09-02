import type {
  ChatbotIntent,
  ChatbotMerchantResolution,
  ChatbotMetricFilter,
  ChatbotSearchMatch,
  ChatbotSearchOptions
} from "./chatbotTypes";

export type {
  ChatbotIntent,
  ChatbotMerchantResolution,
  ChatbotMetricFilter,
  ChatbotSearchMatch,
  ChatbotSearchOptions
} from "./chatbotTypes";

type RecordValue = Readonly<Record<string, unknown>>;

const STOP_WORDS = new Set([
  "a", "about", "all", "and", "are", "as", "at", "brand", "brands", "by", "category",
  "categories", "for", "from", "give", "has", "have", "in", "info", "information", "list",
  "me", "merchant", "merchants", "of", "offers", "on", "please", "recommend", "show", "the",
  "to", "top", "with", "查询", "分析", "帮我", "品牌", "商家", "商户", "品类", "类别", "推荐",
  "显示", "查看", "给我", "请", "的", "和", "与", "以及"
]);

const CATEGORY_KEYS = [
  "sheetCategory", "Sheet Category", "sheet_category", "mainCategory", "Main Category",
  "main_category", "feishuMainCategory", "Feishu Main Category", "feishuCategory",
  "category", "Category", "levantaCategory", "Levanta Category", "levanta_category"
] as const;

const MERCHANT_ID_KEYS = ["merchantId", "merchant_id", "Merchant ID", "MerchantID", "id"] as const;
const MERCHANT_NAME_KEYS = ["brand", "merchantName", "merchant_name", "Merchant Name", "Merchant"] as const;
const ASIN_KEYS = ["topAsins", "topRankAsins", "productAsins", "asins", "ASIN", "asin"] as const;
const KEYWORD_KEYS = [
  "productNameKeywords", "product_name_keywords", "productKeywords", "product_keywords",
  "keywords", "keyword", "productTitles", "productTitle"
] as const;

const SAFE_RESULT_KEYS = new Set([
  "merchantId", "merchantName", "brand", "tier", "category", "mainCategory", "sheetCategory",
  "network", "country", "month", "monthKey", "reportMonth", "reportYear", "date", "id", "name",
  "type", "label", "status", "paymentStatus", "paymentCycle", "expectedPaymentDate",
  "paymentAvailabilityDate", "revenue", "salesAmount", "revenueMade", "commissionMade",
  "remainingAmount", "orders", "orderCount", "clicks", "epc", "aov", "conversionRate",
  "affCommission", "affCommissionRate", "commissionRate", "count", "total", "value", "share",
  "rows", "items", "metrics", "summary", "totals", "trend"
]);

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function normalizeRecordKey(value: unknown): string {
  return text(value).replace(/\.0$/, "");
}

function firstText(record: RecordValue, keys: readonly string[]): string {
  for (const key of keys) {
    const value = text(record[key]);
    if (value) return value;
  }
  return "";
}

function valuesFor(record: RecordValue, keys: readonly string[]): string[] {
  const values: string[] = [];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      values.push(...value.map(text).filter(Boolean));
    } else {
      const stringValue = text(value);
      if (stringValue) values.push(stringValue);
    }
  }
  return values;
}

export function normalizeChatbotText(value: unknown): string {
  return text(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactToken(value: unknown): string {
  return normalizeChatbotText(value).replace(/\s+/g, "");
}

function tokens(value: unknown): string[] {
  const normalized = normalizeChatbotText(value);
  if (!normalized) return [];
  return normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && !STOP_WORDS.has(token));
}

function containsToken(haystack: string, needle: string): boolean {
  if (!needle) return false;
  if (haystack.includes(needle)) return true;
  return compactToken(haystack).includes(compactToken(needle));
}

export function canonicalChatbotTier(value: unknown): string {
  const raw = text(value);
  const lower = raw.toLowerCase();
  if (lower === "black" || lower === "black tier" || /黑名单|黑色\s*tier|屏蔽|暂停/.test(raw)) {
    return "BLACK TIER";
  }
  const match = lower.match(/tier\s*([1-4])/i) || raw.match(/(?:第\s*)?([一二三四1-4])\s*(?:层|级|档)/);
  if (!match?.[1]) return raw;
  const digit = { 一: "1", 二: "2", 三: "3", 四: "4" }[match[1]] || match[1];
  return `Tier ${digit}`;
}

export function detectChatbotIntent(
  prompt: string,
  options: Readonly<Record<string, unknown>> = {}
): ChatbotIntent {
  const textValue = text(prompt);
  const lower = textValue.toLowerCase();
  const combined = lower + textValue;
  if (/\bB0[A-Z0-9]{8}\b/i.test(textValue) || /\basin\b/i.test(lower) || /亚马逊商品编号|商品编号/.test(textValue)) {
    return "asin";
  }
  if (options.intent === "payment" || /payment|paid|unpaid|overdue|pending|commission due|付款|支付|结算|逾期|未付款|待处理/.test(combined)) {
    return "payment";
  }
  if (options.intent === "analysis" || /分析|趋势|trend|compare|comparison|对比|比较|why|为什么|原因/.test(combined)) {
    return "analysis";
  }
  if (options.intent === "recommendation" || /recommend|recommendation|top\s+\d+|best|排行|排名|推荐|前\s*\d+/.test(combined)) {
    return "recommendation";
  }
  if (options.intent === "tier" || /\btier\s*[1-4]\b|black\s*tier|分层|层级|档位|黑名单/.test(combined)) {
    return "tier";
  }
  if (options.intent === "category" || /category|categories|subcategory|品类|类别|类目|分类/.test(combined)) {
    return "category";
  }
  return "merchant";
}

function categoryMatchScore(query: string, category: string): number {
  const normalizedQuery = normalizeChatbotText(query);
  const normalizedCategory = normalizeChatbotText(category);
  if (!normalizedQuery || !normalizedCategory) return 0;
  if (normalizedQuery === normalizedCategory) return 100;
  if (normalizedCategory.includes(normalizedQuery) || normalizedQuery.includes(normalizedCategory)) return 90;
  const queryTokens = tokens(query);
  const categoryTokens = tokens(category);
  const matched = queryTokens.filter((queryToken) => categoryTokens.some((categoryToken) => (
    categoryToken === queryToken
      || (queryToken.length > 2 && categoryToken.startsWith(queryToken))
      || (categoryToken.length > 2 && queryToken.startsWith(categoryToken))
  )));
  if (!matched.length) return 0;
  return (matched.length / Math.max(1, queryTokens.length)) * 70
    + (matched.length / Math.max(1, categoryTokens.length)) * 30;
}

export function resolveChatbotCategory(prompt: string, categories: readonly string[]): string | null {
  const known = categories.map(text).filter((category) => category && category.toLowerCase() !== "uncategorized");
  const normalizedPrompt = normalizeChatbotText(prompt);
  const direct = known.find((category) => containsToken(normalizedPrompt, normalizeChatbotText(category)));
  if (direct) return direct;
  const scored = known
    .map((category) => ({ category, score: categoryMatchScore(prompt, category) }))
    .sort((left, right) => right.score - left.score);
  const best = scored[0];
  return best && best.score >= 42 ? best.category : null;
}

function merchantIdFromPrompt(prompt: string): string {
  const labeled = text(prompt).match(/(?:merchant\s*id|merchantid|商户\s*id|商家\s*id|id)\s*[:#]?\s*([a-z0-9_-]+)/i);
  if (labeled?.[1]) return normalizeRecordKey(labeled[1]);
  const numeric = text(prompt).match(/\b\d{4,}\b/);
  return numeric?.[0] || "";
}

function merchantMatches(offers: readonly RecordValue[], prompt: string): ChatbotSearchMatch[] {
  const query = normalizeChatbotText(prompt);
  const id = merchantIdFromPrompt(prompt);
  const matches = offers.flatMap((offer) => {
    const merchantId = normalizeRecordKey(firstText(offer, MERCHANT_ID_KEYS));
    const merchantName = firstText(offer, MERCHANT_NAME_KEYS);
    const normalizedName = normalizeChatbotText(merchantName);
    if (id && merchantId === id) {
      return [{ offer, score: 120, matchType: "merchant" as const, matchedTerms: [merchantId] }];
    }
    if (!query || !normalizedName) return [];
    const score = normalizedName === query
      ? 110
      : normalizedName.startsWith(query) || query.startsWith(normalizedName)
        ? 90
        : containsToken(query, normalizedName)
          ? 70
          : 0;
    return score ? [{ offer, score, matchType: "merchant" as const, matchedTerms: [merchantName] }] : [];
  });
  return matches.sort((left, right) => right.score - left.score || String(firstText(left.offer, MERCHANT_ID_KEYS)).localeCompare(String(firstText(right.offer, MERCHANT_ID_KEYS))));
}

export function resolveChatbotMerchant(
  prompt: string,
  offers: readonly RecordValue[]
): ChatbotMerchantResolution {
  const matches = merchantMatches(offers, prompt);
  if (!matches.length) return { status: "not_found", matches: [] };
  const id = merchantIdFromPrompt(prompt);
  if (id) return { status: "resolved", matches: matches.filter((match) => normalizeRecordKey(firstText(match.offer, MERCHANT_ID_KEYS)) === id) };
  const first = matches[0];
  const second = matches[1];
  const ambiguous = Boolean(second && first && first.score === second.score);
  return { status: ambiguous ? "ambiguous" : "resolved", matches };
}

function metricNumber(offer: RecordValue, field: string): number {
  const value = Number(offer[field]);
  return Number.isFinite(value) ? value : 0;
}

function metricFilterMatches(offer: RecordValue, filter: ChatbotMetricFilter): boolean {
  const value = metricNumber(offer, filter.field);
  if (!Number.isFinite(filter.value)) return true;
  if (filter.operator === "gt") return value > filter.value;
  if (filter.operator === "gte") return value >= filter.value;
  if (filter.operator === "lt") return value < filter.value;
  if (filter.operator === "lte") return value <= filter.value;
  return value === filter.value;
}

function tierAllowed(offer: RecordValue, options: ChatbotSearchOptions): boolean {
  const tier = canonicalChatbotTier(firstText(offer, ["tier", "Tier"]));
  if (options.tier && canonicalChatbotTier(options.tier) !== tier) return false;
  if (tier === "BLACK TIER" && !options.includeBlack && !options.tier) return false;
  if (tier === "Tier 4" && !options.includeTier4 && !options.tier) return false;
  return true;
}

function offerSearchFields(offer: RecordValue): Array<{ readonly value: string; readonly type: ChatbotSearchMatch["matchType"] }> {
  const merchant = firstText(offer, MERCHANT_NAME_KEYS);
  const categories = valuesFor(offer, CATEGORY_KEYS);
  const asins = valuesFor(offer, ASIN_KEYS);
  const keywords = valuesFor(offer, KEYWORD_KEYS);
  return [
    ...(merchant ? [{ value: merchant, type: "merchant" as const }] : []),
    ...categories.map((value) => ({ value, type: "category" as const })),
    ...asins.map((value) => ({ value, type: "asin" as const })),
    ...keywords.map((value) => ({ value, type: "keyword" as const }))
  ];
}

export function searchChatbotOffers(
  offers: readonly RecordValue[],
  prompt: string,
  options: ChatbotSearchOptions = {}
): ChatbotSearchMatch[] {
  const query = normalizeChatbotText(prompt);
  const queryTokens = tokens(prompt);
  if (!query || !queryTokens.length) return [];
  return offers
    .filter((offer) => tierAllowed(offer, options))
    .filter((offer) => (options.metricFilters || []).every((filter) => metricFilterMatches(offer, filter)))
    .flatMap((offer) => {
      const fields = offerSearchFields(offer);
      const matches = fields.flatMap((field) => {
        const normalizedValue = normalizeChatbotText(field.value);
        const compactValue = compactToken(field.value);
        const exactAsin = field.type === "asin" && queryTokens.some((token) => compactValue === compactToken(token));
        const exact = normalizedValue === query || exactAsin;
        const tokenMatches = queryTokens.filter((token) => (
          normalizedValue.split(/\s+/).some((valueToken) => valueToken === token || valueToken.includes(token) || token.includes(valueToken))
            || compactValue.includes(compactToken(token))
        ));
        if (!exact && !tokenMatches.length) return [];
        const base = exact ? 120 : field.type === "asin" ? 115 : field.type === "merchant" ? 100 : field.type === "keyword" ? 90 : 80;
        return [{
          offer,
          score: base + tokenMatches.length / Math.max(1, queryTokens.length) * 20,
          matchType: field.type,
          matchedTerms: Array.from(new Set(tokenMatches.length ? tokenMatches : [field.value]))
        } satisfies ChatbotSearchMatch];
      });
      const best = matches.sort((left, right) => right.score - left.score)[0];
      return best ? [best] : [];
    })
    .sort((left, right) => right.score - left.score || String(firstText(left.offer, MERCHANT_ID_KEYS)).localeCompare(String(firstText(right.offer, MERCHANT_ID_KEYS))));
}

function compactResultValue(value: unknown, depth: number, limits: { readonly maxArray: number; readonly maxString: number }): unknown {
  if (depth > 4 || value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, limits.maxString);
  if (Array.isArray(value)) return value.slice(0, limits.maxArray).map((item) => compactResultValue(item, depth + 1, limits));
  if (typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (!SAFE_RESULT_KEYS.has(key)) continue;
    const compacted = compactResultValue(item, depth + 1, limits);
    if (compacted !== undefined) result[key] = compacted;
  }
  return result;
}

export function compactChatbotResult(
  value: unknown,
  limits: Readonly<Record<string, number>> = {}
): unknown {
  const maxArray = Number.isFinite(limits.maxArray) ? Math.max(1, Number(limits.maxArray)) : 50;
  const maxString = Number.isFinite(limits.maxString) ? Math.max(80, Number(limits.maxString)) : 500;
  return compactResultValue(value, 0, { maxArray, maxString });
}
