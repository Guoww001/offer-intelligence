import { TIER_NAMES, isTierName, type TierName } from "../../shared/contracts/tier";

type RawRow = Readonly<Record<string, unknown>>;

export { TIER_NAMES, isTierName };
export type { TierName };

export const TIER_EXPANDABLE_NAMES: readonly TierName[] = ["Tier 1", "Tier 2", "Tier 3", "Tier 4"];
export const TIER_MOVE_STORAGE_KEY = "offerTierSheetManualMoves.v1";
export const TIER_COLUMN_STORAGE_KEY = "offerTierVisibleColumns.v4";
export const TIER_TABLE_PAGE_SIZE = 500;

export const DEFAULT_TIER_VISIBLE_COLUMNS = [
  "Merchant ID",
  "Merchant Name",
  "Brand",
  "Network",
  "ALL Commission",
  "AFF Commission",
  "Category",
  "Clicks",
  "DPV",
  "ATC",
  "AOV",
  "Conversion Rate",
  "Revenue",
  "EPC(All)",
  "EPC(Aff)"
] as const;

const DEFAULT_TIER_COLUMN_ALIASES: Readonly<Record<string, readonly string[]>> = {
  Network: ["Network", "Agency"],
  "ALL Commission": ["ALL Commission", "Commission Rate"],
  "AFF Commission": ["AFF Commission"],
  "Conversion Rate": ["Conversion Rate", "Conversion", "CVR"],
  "EPC(All)": ["EPC(All)", "All EPC"],
  "EPC(Aff)": ["EPC(Aff)", "Aff EPC", "Backend EPC", "EPC"]
};

const TIER_INTEGER_HEADERS = new Set([
  "clicks", "total clicks", "dpv", "atc", "order count", "orders",
  "brand count", "publisher count", "publisher count june", "new tier entries", "tier exits"
]);

export interface TierSheetData {
  readonly name?: unknown;
  readonly sheetName?: unknown;
  readonly title?: unknown;
  readonly headers?: readonly unknown[];
  readonly rows?: readonly unknown[];
  readonly grid?: readonly (readonly unknown[])[];
  readonly introRows?: readonly (readonly unknown[])[];
  readonly summaryCards?: readonly Readonly<Record<string, unknown>>[];
  readonly reportRange?: Readonly<Record<string, unknown>>;
}

export interface TierSheetReportData {
  readonly sheets?: readonly TierSheetData[];
  readonly tierSheets?: readonly unknown[];
  readonly offers?: readonly unknown[];
}

export interface TierSheetLivePayload {
  readonly rows?: readonly unknown[];
  readonly headers?: readonly unknown[];
  readonly startDate?: unknown;
  readonly endDate?: unknown;
  readonly source?: unknown;
  readonly [key: string]: unknown;
}

export interface TierMove {
  readonly sourceTier: TierName;
  readonly targetTier: TierName;
  readonly merchantId?: string;
  readonly merchantName?: string;
  readonly movedAt?: string;
}

export type TierMoveMap = Readonly<Record<string, TierMove>>;

export interface TierFilters {
  readonly search: string;
  readonly network: string;
  readonly country: string;
  readonly minEpc: string;
  readonly minRevenue: string;
}

export interface TierRow {
  readonly key: string;
  readonly sourceTier: TierName;
  readonly currentTier: TierName;
  readonly merchantId: string;
  readonly merchantName: string;
  readonly category: string;
  readonly raw: RawRow;
  readonly visualStatus: string;
}

export interface TierSummary {
  readonly rowCount: number;
  readonly merchantCount: number;
  readonly clicks: number;
  readonly orders: number;
  readonly revenue: number;
  readonly avgConversion: number;
}

export interface TierCategorySummary {
  readonly category: string;
  readonly rows: readonly TierRow[];
  readonly rowCount: number;
  readonly merchantCount: number;
  readonly revenue: number;
  readonly orders: number;
  readonly clicks: number;
  readonly avgConversion: number | null;
  readonly avgEpc: number | null;
  readonly avgAov: number | null;
  readonly topMerchant: string;
  readonly previewMerchants: string;
  readonly tierBreakdown: Readonly<Record<string, number>>;
}

export interface TierPagination<T> {
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
  readonly totalRows: number;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly rows: readonly T[];
}

function isRecord(value: unknown): value is RawRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function firstValue(row: RawRow, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && text(row[key])) return row[key];
  }
  return "";
}

function sheetName(sheet: TierSheetData | undefined): string {
  return text(sheet?.name || sheet?.sheetName);
}

function sheetRows(sheet: TierSheetData | undefined): RawRow[] {
  return Array.isArray(sheet?.rows) ? sheet.rows.filter(isRecord) : [];
}

function sheetHeaders(sheet: TierSheetData | undefined): string[] {
  if (Array.isArray(sheet?.headers)) return sheet.headers.map(text).filter(Boolean);
  const keys = new Set<string>();
  sheetRows(sheet).forEach((row) => Object.keys(row).forEach((key) => keys.add(key)));
  return Array.from(keys);
}

function reportSheets(data: TierSheetReportData): TierSheetData[] {
  return Array.isArray(data.sheets) ? data.sheets.filter(isRecord) : [];
}

function tierSheet(data: TierSheetReportData, tier: string): TierSheetData | undefined {
  const canonical = canonicalTierName(tier);
  return reportSheets(data).find((sheet) => canonicalTierName(sheetName(sheet)) === canonical);
}

export function canonicalTierName(value: unknown): string {
  const raw = text(value).toLowerCase();
  if (raw === "black" || raw === "black tier") return "BLACK TIER";
  const match = raw.match(/tier\s*([1-4])/);
  return match ? `Tier ${match[1]}` : text(value);
}

function asTierName(value: unknown): TierName | null {
  const canonical = canonicalTierName(value);
  return isTierName(canonical) ? canonical : null;
}

export function parseTierNumber(value: unknown): number {
  const cleaned = text(value).replace(/[$,%]/g, "").replace(/,/g, "");
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableTierNumber(value: unknown): number | null {
  const raw = text(value);
  return raw ? parseTierNumber(raw) : null;
}

function merchantId(row: RawRow): string {
  return text(firstValue(row, ["Merchant ID", "Merchant Id", "MerchantID", "merchantId", "ID"])).replace(/\.0$/, "");
}

function merchantName(row: RawRow): string {
  return text(firstValue(row, ["Merchant Name", "Brand", "Merchant", "brand"]));
}

function offerCategory(offer: RawRow | undefined): string {
  if (!offer) return "";
  return text(firstValue(offer, [
    "sheetCategory", "Sheet Category", "sheet_category",
    "mainCategory", "Main Category", "main_category",
    "feishuMainCategory", "Feishu Main Category", "feishuCategory", "Feishu Category",
    "category", "Category",
    "levantaCategory", "Levanta Category", "levanta_category"
  ]));
}

function offerIndex(data: TierSheetReportData): ReadonlyMap<string, RawRow> {
  const index = new Map<string, RawRow>();
  for (const value of data.offers || []) {
    if (!isRecord(value)) continue;
    const id = merchantId(value);
    if (id && !index.has(id)) index.set(id, value);
  }
  return index;
}

function rowCategory(row: RawRow, offer?: RawRow): string {
  if (offer) return offerCategory(offer) || "Uncategorized";
  return text(firstValue(row, ["Category", "Main Category", "Main category", "Sheet Category"])) || "Uncategorized";
}

function rowKey(row: RawRow, tier: TierName, index: number): string {
  const id = merchantId(row);
  if (id) return `merchant:${id}:${tier}`;
  const name = merchantName(row).toLowerCase().replace(/\s+/g, " ");
  return name ? `row:${tier}:${name}` : `row:${tier}:${index}:unknown`;
}

function liveRowsForTier(
  data: TierSheetReportData,
  tier: TierName,
  livePayloads?: ReadonlyMap<TierName, TierSheetLivePayload>
): RawRow[] {
  const payload = livePayloads?.get(tier);
  if (!payload) return sheetRows(tierSheet(data, tier));
  const snapshotByMerchant = new Map<string, RawRow>();
  reportSheets(data).forEach((sheet) => sheetRows(sheet).forEach((row) => {
    const id = merchantId(row);
    if (id && !snapshotByMerchant.has(id)) snapshotByMerchant.set(id, row);
  }));
  return Array.isArray(payload.rows)
    ? payload.rows.filter(isRecord).map((row) => ({ ...(snapshotByMerchant.get(merchantId(row)) || {}), ...row }))
    : [];
}

function tierRowsBySource(
  data: TierSheetReportData,
  livePayloads?: ReadonlyMap<TierName, TierSheetLivePayload>
): ReadonlyMap<TierName, RawRow[]> {
  return new Map(TIER_NAMES.map((tier) => [tier, liveRowsForTier(data, tier, livePayloads)]));
}

export function buildTierRows(
  data: TierSheetReportData,
  selectedTier: TierName,
  livePayloads?: ReadonlyMap<TierName, TierSheetLivePayload>,
  moves: TierMoveMap = {}
): TierRow[] {
  const sources = tierRowsBySource(data, livePayloads);
  const offers = offerIndex(data);
  const output: TierRow[] = [];
  const incoming: TierRow[] = [];
  TIER_NAMES.forEach((sourceTier) => {
    (sources.get(sourceTier) || []).forEach((raw, index) => {
      const key = rowKey(raw, sourceTier, index);
      const move = moves[key];
      const targetTier = move ? asTierName(move.targetTier) : null;
      const currentTier = targetTier && targetTier !== sourceTier ? targetTier : sourceTier;
      if (currentTier !== selectedTier) return;
      const model: TierRow = {
        key,
        sourceTier,
        currentTier,
        merchantId: merchantId(raw),
        merchantName: merchantName(raw),
        category: rowCategory(raw, offers.get(merchantId(raw))),
        raw,
        visualStatus: text(firstValue(raw, ["visualStatusColor", "visual_status_color", "Visual Status Color", "Visual Status", "Color"]))
      };
      if (sourceTier === selectedTier) output.push(model);
      else incoming.push(model);
    });
  });
  return output.concat(incoming);
}

export function headersForTier(
  data: TierSheetReportData,
  tier: TierName,
  livePayloads?: ReadonlyMap<TierName, TierSheetLivePayload>
): string[] {
  const headers = new Set(sheetHeaders(tierSheet(data, tier)));
  const payload = livePayloads?.get(tier);
  if (Array.isArray(payload?.headers)) payload.headers.forEach((header) => {
    const value = text(header);
    if (value) headers.add(value);
  });
  const result = Array.from(headers).filter((header) => !new Set(["May Revenue", "June Revenue"]).has(header));
  if (tier === "Tier 1" && result.includes("Order count") && result.includes("Completion Rate")) {
    const completionIndex = result.indexOf("Completion Rate");
    result.splice(completionIndex, 1);
    result.splice(result.indexOf("Order count") + 1, 0, "Completion Rate");
  }
  return result;
}

export function defaultVisibleHeadersForTier(tier: TierName, headers: readonly string[]): string[] {
  const available = new Set(headers);
  const selected: string[] = [];
  DEFAULT_TIER_VISIBLE_COLUMNS.forEach((preferred) => {
    const candidates = DEFAULT_TIER_COLUMN_ALIASES[preferred] || [preferred];
    const match = candidates.find((candidate) => available.has(candidate));
    if (match && !selected.includes(match)) selected.push(match);
  });
  if (tier === "Tier 1" && available.has("Agency") && !selected.includes("Agency")) {
    const index = selected.indexOf("Network");
    selected.splice(index >= 0 ? index + 1 : 0, 0, "Agency");
  }
  if (tier === "Tier 1" && available.has("BD") && !selected.includes("BD")) {
    const agencyIndex = selected.indexOf("Agency");
    const networkIndex = selected.indexOf("Network");
    selected.splice((agencyIndex >= 0 ? agencyIndex : networkIndex) + 1, 0, "BD");
  }
  return selected.length ? selected : headers.slice();
}

export function visibleHeadersForTier(tier: TierName, headers: readonly string[], saved?: readonly string[]): string[] {
  if (!Array.isArray(saved) || !saved.length) return defaultVisibleHeadersForTier(tier, headers);
  const migrated = saved.flatMap((header) => {
    if (header === "Business Manager") return ["BD"];
    if (header === "Commission Rate") return ["ALL Commission", "AFF Commission"];
    if (header === "Backend EPC") return ["EPC(All)", "EPC(Aff)"];
    return [header];
  });
  const selected = migrated.filter((header) => headers.includes(header));
  return selected.length ? Array.from(new Set(selected)) : defaultVisibleHeadersForTier(tier, headers);
}

function isRateHeader(header: string): boolean {
  const lower = header.toLowerCase();
  return /(all commission|aff commission|commission rate|success rate|conversion rate|avg conversion|\bconversion\b|\bcvr\b)/.test(lower)
    && !/count/.test(lower);
}

function currencySymbol(row: RawRow, preferredCurrency = ""): string {
  const currency = text(preferredCurrency || firstValue(row, ["Currency", "currency"])).toUpperCase();
  const country = text(firstValue(row, ["COUNTRY", "Country", "country", "countryCode"])).toUpperCase();
  const symbols: Readonly<Record<string, string>> = { USD: "$", GBP: "£", EUR: "€", CAD: "C$", AUD: "A$", JPY: "¥" };
  if (symbols[currency]) return symbols[currency];
  if (["US", "USA", "UNITED STATES"].includes(country)) return "$";
  if (["UK", "GB", "UNITED KINGDOM"].includes(country)) return "£";
  if (["DE", "FR", "EU", "GERMANY", "FRANCE"].includes(country)) return "€";
  if (["CA", "CANADA"].includes(country)) return "C$";
  if (["AU", "AUSTRALIA"].includes(country)) return "A$";
  if (["JP", "JAPAN"].includes(country)) return "¥";
  return "";
}

export function formatTierCell(tier: TierName, row: RawRow, header: string): string {
  const raw = text(row[header]);
  if (!raw) return "";
  const lower = header.toLowerCase();
  const numeric = nullableTierNumber(raw);
  if (numeric === null) return raw.includes("%") ? raw : raw;
  if (TIER_INTEGER_HEADERS.has(lower)) return numeric.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (lower === "aov" || lower === "revenue") {
    const symbol = currencySymbol(row, lower === "aov" ? text(row["AOV Currency"]) : "");
    return symbol + numeric.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (isRateHeader(header)) {
    const percentage = raw.includes("%") || Math.abs(numeric) > 1 ? numeric : numeric * 100;
    const decimals = /(all commission|aff commission|commission rate)/i.test(header) ? 2 : 2;
    return percentage.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals }) + "%";
  }
  return raw;
}

function sortableValue(header: string, value: unknown): { readonly empty: boolean; readonly value: number | string } {
  const raw = text(value);
  if (!raw) return { empty: true, value: "" };
  if (isRateHeader(header)) {
    const numeric = parseTierNumber(raw);
    return { empty: false, value: raw.includes("%") || Math.abs(numeric) > 1 ? numeric : numeric * 100 };
  }
  const fraction = raw.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  if (fraction && Number(fraction[2]) !== 0) return { empty: false, value: Number(fraction[1]) / Number(fraction[2]) };
  const numericText = raw.replace(/[$,%]/g, "").replace(/,/g, "");
  if (/^-?\d+(?:\.\d+)?$/.test(numericText)) return { empty: false, value: Number(numericText) };
  return { empty: false, value: raw.toLowerCase() };
}

export function sortTierRows(rows: readonly TierRow[], header: string, direction: "asc" | "desc"): TierRow[] {
  const multiplier = direction === "desc" ? -1 : 1;
  return rows.map((row, index) => ({ row, index })).sort((left, right) => {
    const a = sortableValue(header, left.row.raw[header]);
    const b = sortableValue(header, right.row.raw[header]);
    if (a.empty || b.empty) return a.empty === b.empty ? left.index - right.index : a.empty ? 1 : -1;
    const result = typeof a.value === "number" && typeof b.value === "number"
      ? a.value - b.value
      : String(a.value).localeCompare(String(b.value), undefined, { numeric: true, sensitivity: "base" });
    return result ? result * multiplier : left.index - right.index;
  }).map((item) => item.row);
}

export function filterTierRows(rows: readonly TierRow[], filters: TierFilters): TierRow[] {
  const search = text(filters.search).toLowerCase();
  const network = text(filters.network);
  const country = text(filters.country);
  const minEpc = parseTierNumber(filters.minEpc);
  const minRevenue = parseTierNumber(filters.minRevenue);
  return rows.filter((row) => {
    const values = Object.values(row.raw).map(text).join(" ").toLowerCase();
    const rowNetwork = text(firstValue(row.raw, ["Network", "Agency"]));
    const rowCountry = text(firstValue(row.raw, ["COUNTRY", "Country"]));
    const epc = parseTierNumber(firstValue(row.raw, ["EPC(Aff)", "Aff EPC", "Backend EPC", "EPC", "EPC(All)", "All EPC"]));
    const revenue = parseTierNumber(firstValue(row.raw, ["Revenue", "Sales Amount", "Sales"]));
    return (!search || values.includes(search))
      && (network === "all" || !network || rowNetwork === network)
      && (country === "all" || !country || rowCountry === country)
      && epc >= minEpc
      && revenue >= minRevenue;
  });
}

export function tierSummary(rows: readonly TierRow[]): TierSummary {
  const ids = new Set(rows.map((row) => row.merchantId).filter(Boolean));
  const clicks = rows.reduce((sum, row) => sum + parseTierNumber(firstValue(row.raw, ["Clicks", "Total Clicks"])), 0);
  const orders = rows.reduce((sum, row) => sum + parseTierNumber(firstValue(row.raw, ["Order count", "Order Count", "Orders"])), 0);
  const revenue = rows.reduce((sum, row) => sum + parseTierNumber(firstValue(row.raw, ["Revenue", "Sales Amount", "Sales"])), 0);
  return { rowCount: rows.length, merchantCount: ids.size || rows.length, clicks, orders, revenue, avgConversion: clicks ? orders / clicks : 0 };
}

export function tierCategorySummaries(rows: readonly TierRow[]): TierCategorySummary[] {
  const groups = new Map<string, TierRow[]>();
  rows.forEach((row) => {
    const list = groups.get(row.category) || [];
    list.push(row);
    groups.set(row.category, list);
  });
  return Array.from(groups.entries()).map(([category, groupRows]) => {
    const summary = tierSummary(groupRows);
    const revenue = summary.revenue;
    const orders = summary.orders;
    const clicks = summary.clicks;
    let epcWeightedByClicks = 0;
    let epcSum = 0;
    let epcCount = 0;
    groupRows.forEach((row) => {
      const epc = nullableTierNumber(firstValue(row.raw, ["EPC(Aff)", "Aff EPC", "Backend EPC", "EPC", "EPC(All)", "All EPC"]));
      if (epc === null || !epc) return;
      const rowClicks = parseTierNumber(firstValue(row.raw, ["Clicks", "Total Clicks"]));
      if (rowClicks) epcWeightedByClicks += epc * rowClicks;
      epcSum += epc;
      epcCount += 1;
    });
    const top = [...groupRows].sort((left, right) => parseTierNumber(firstValue(right.raw, ["Revenue", "Sales Amount", "Sales"])) - parseTierNumber(firstValue(left.raw, ["Revenue", "Sales Amount", "Sales"]))
        || parseTierNumber(firstValue(right.raw, ["Order count", "Order Count", "Orders"])) - parseTierNumber(firstValue(left.raw, ["Order count", "Order Count", "Orders"]))
        || parseTierNumber(firstValue(right.raw, ["Clicks", "Total Clicks"])) - parseTierNumber(firstValue(left.raw, ["Clicks", "Total Clicks"])))
      .slice(0, 3);
    const sortedRows = [...groupRows].sort((left, right) => parseTierNumber(firstValue(right.raw, ["Revenue", "Sales Amount", "Sales"])) - parseTierNumber(firstValue(left.raw, ["Revenue", "Sales Amount", "Sales"]))
      || parseTierNumber(firstValue(right.raw, ["Order count", "Order Count", "Orders"])) - parseTierNumber(firstValue(left.raw, ["Order count", "Order Count", "Orders"]))
      || parseTierNumber(firstValue(right.raw, ["Clicks", "Total Clicks"])) - parseTierNumber(firstValue(left.raw, ["Clicks", "Total Clicks"])));
    const breakdown = groupRows.reduce<Record<string, number>>((result, row) => {
      result[row.currentTier] = (result[row.currentTier] || 0) + 1;
      return result;
    }, {});
    return {
      category,
      rows: sortedRows,
      rowCount: groupRows.length,
      merchantCount: summary.merchantCount,
      revenue,
      orders,
      clicks,
      avgConversion: clicks ? orders / clicks : null,
      avgEpc: clicks && epcWeightedByClicks ? epcWeightedByClicks / clicks : (epcCount ? epcSum / epcCount : null),
      avgAov: orders ? revenue / orders : null,
      topMerchant: top[0]?.merchantName || top[0]?.merchantId || "",
      previewMerchants: top.map((row) => row.merchantName || row.merchantId).filter(Boolean).join(", "),
      tierBreakdown: breakdown
    } satisfies TierCategorySummary;
  }).sort((left, right) => {
    if (left.category === "Uncategorized" && right.category !== "Uncategorized") return 1;
    if (right.category === "Uncategorized" && left.category !== "Uncategorized") return -1;
    return right.revenue - left.revenue
      || right.orders - left.orders
      || right.merchantCount - left.merchantCount
      || left.category.localeCompare(right.category, undefined, { numeric: true, sensitivity: "base" });
  });
}

export function tierPagination<T>(rows: readonly T[], page: number, pageSize = TIER_TABLE_PAGE_SIZE): TierPagination<T> {
  const safePageSize = Math.max(1, Number(pageSize) || TIER_TABLE_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(rows.length / safePageSize));
  const currentPage = Math.min(totalPages, Math.max(1, Number(page) || 1));
  const startIndex = (currentPage - 1) * safePageSize;
  const endIndex = Math.min(rows.length, startIndex + safePageSize);
  return { page: currentPage, pageSize: safePageSize, totalPages, totalRows: rows.length, startIndex, endIndex, rows: rows.slice(startIndex, endIndex) };
}

export function tierReportDependencies(selectedTier: TierName, moves: TierMoveMap = {}): TierName[] {
  const dependencies = new Set<TierName>([selectedTier]);
  Object.values(moves).forEach((move) => {
    const source = asTierName(move?.sourceTier);
    const target = asTierName(move?.targetTier);
    if (source && target === selectedTier) dependencies.add(source);
  });
  return Array.from(dependencies);
}

export function validTierMoveMap(value: unknown): TierMoveMap {
  if (!isRecord(value)) return {};
  return Object.entries(value).reduce<Record<string, TierMove>>((result, [key, candidate]) => {
    if (!isRecord(candidate)) return result;
    const sourceTier = asTierName(candidate.sourceTier);
    const targetTier = asTierName(candidate.targetTier);
    if (!sourceTier || !targetTier || sourceTier === targetTier) return result;
    result[key] = {
      sourceTier,
      targetTier,
      ...(text(candidate.merchantId) ? { merchantId: text(candidate.merchantId) } : {}),
      ...(text(candidate.merchantName) ? { merchantName: text(candidate.merchantName) } : {}),
      ...(text(candidate.movedAt) ? { movedAt: text(candidate.movedAt) } : {})
    };
    return result;
  }, {});
}
