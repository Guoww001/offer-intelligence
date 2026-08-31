export type TargetMetricKey = "revenue" | "orders" | "clicks" | "conversion" | "brands";
export type TargetTrendView = "month" | "day";

type RawRecord = Readonly<Record<string, unknown>>;

export interface TargetSheetData {
  readonly name?: unknown;
  readonly sheetName?: unknown;
  readonly headers?: readonly unknown[];
  readonly rows?: readonly unknown[];
  readonly grid?: readonly unknown[][];
}

export interface TargetReportData {
  readonly sheets?: readonly TargetSheetData[];
  readonly tierSheets?: readonly unknown[];
}

export interface TargetRecord {
  readonly month: string;
  readonly monthKey: string;
  readonly tier: string;
  readonly brandCount: number;
  readonly clicks: number;
  readonly orders: number;
  readonly revenue: number;
  readonly payout: number | null;
  readonly conversionRate: number;
  readonly newEntries: number;
  readonly exits: number;
  readonly target: string;
  readonly source: string;
  readonly databaseOnly: boolean;
  readonly tierExitsAvailable: boolean;
  readonly targetPlaceholderOnly: boolean;
  readonly targetOverrideKey: string;
}

export interface TargetRecordLike {
  readonly month?: unknown;
  readonly monthKey?: unknown;
  readonly tier?: unknown;
  readonly brandCount?: unknown;
  readonly clicks?: unknown;
  readonly orders?: unknown;
  readonly revenue?: unknown;
  readonly payout?: unknown;
  readonly conversionRate?: unknown;
  readonly newEntries?: unknown;
  readonly exits?: unknown;
  readonly target?: unknown;
  readonly source?: unknown;
  readonly databaseOnly?: unknown;
  readonly tierExitsAvailable?: unknown;
  readonly targetPlaceholderOnly?: unknown;
  readonly targetOverrideKey?: unknown;
}

export interface TargetSummary {
  readonly brands: number;
  readonly clicks: number;
  readonly orders: number;
  readonly revenue: number;
  readonly payout: number;
  readonly conversionRate: number;
  readonly newEntries: number;
  readonly exits: number;
}

export interface TargetGoal {
  readonly type: "gmv" | "commission" | "removal" | "promotion" | "brand";
  readonly label: string;
  readonly target: number;
  readonly actual: number;
  readonly targetText: string;
  readonly actualText: string;
}

export interface TargetProgressDefinition {
  readonly tier: string;
  readonly type: "gmv" | "commission" | "removal";
  readonly label: string;
}

export interface TargetTrendRow {
  readonly label: string;
  readonly shortLabel: string;
  readonly monthKey?: string;
  readonly value: number | null;
  readonly selected?: boolean;
  readonly state: string;
  readonly detail: string;
}

export interface BuildTargetRecordsOptions {
  readonly today?: () => Date;
  readonly referenceMonthKey?: string;
  readonly targetOverrides?: Readonly<Record<string, string>>;
}

export interface TargetMonthlyTrendOptions {
  readonly selectedMonth: string;
  readonly tier?: string;
  readonly metric?: TargetMetricKey;
  readonly databaseRows?: readonly TargetTrendRow[];
}

export interface DbStatusPayload {
  readonly dailyTrend?: Readonly<Record<string, unknown>>;
  readonly recentMonths?: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

export const TARGET_TIER_ORDER = ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "Black Tier", "BLACK TIER"] as const;

export const TARGET_METRICS: readonly { key: TargetMetricKey; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "orders", label: "Orders" },
  { key: "clicks", label: "Clicks" },
  { key: "conversion", label: "Avg Conversion" },
  { key: "brands", label: "Active Brands" }
];

export const TARGET_TREND_VIEWS: readonly { key: TargetTrendView; label: string }[] = [
  { key: "month", label: "Monthly report" },
  { key: "day", label: "Daily report" }
];

export const TARGET_PROGRESS_DEFINITIONS: readonly TargetProgressDefinition[] = [
  { tier: "Tier 1", type: "gmv", label: "GMV target" },
  { tier: "Tier 2", type: "commission", label: "Commission target" },
  { tier: "Tier 3", type: "removal", label: "Merchant removal target" },
  { tier: "Tier 4", type: "removal", label: "Merchant removal target" }
];

const REPORT_OVERVIEW_MONTH_OFFSETS = [-2, -1, 0];
const REPORT_OVERVIEW_REQUIRED_MONTH_KEYS = ["2026-05", "2026-06"];

const TARGET_MONTH_PRESETS: Readonly<Record<string, Readonly<Record<string, {
  readonly target?: string;
  readonly actuals?: Readonly<Record<string, number>>;
}>>>> = {
  "2026-06": {
    "Tier 1": {
      target: "Revenue Target: $500K+",
      actuals: { brandCount: 42, clicks: 75460, orders: 47854, revenue: 655419.44, payout: 106170.6, conversion: 0.634164 }
    },
    "Tier 2": {
      target: "Revenue Target:$800K+; Brand Target: 60+",
      actuals: { brandCount: 52, clicks: 368157, orders: 130672, revenue: 1163175.35, payout: 196701.35, conversion: 0.354936 }
    },
    "Tier 3": {
      target: "Revenue Target:$250K+; Brand Target: Promote 10 Brands to Tier 2",
      actuals: { brandCount: 370, clicks: 108203, orders: 68965, revenue: 578972.2, payout: 77950.96, conversion: 0.637367, tierExits: 140 }
    },
    "Tier 4": {
      target: "Brand Target: Promote 30 Brands to Tier 3",
      actuals: { brandCount: 5807, clicks: 8513, orders: 4337, revenue: 6415.42, payout: 1011.87, conversion: 0.509456, tierExits: 212 }
    },
    "BLACK TIER": {
      actuals: { brandCount: 8, clicks: 9298, orders: 4305, revenue: 21843.58, payout: 2102.77, conversion: 0.463003 }
    },
    Total: {
      actuals: { brandCount: 6279, clicks: 569631, orders: 256133, revenue: 2425825.99, payout: 383937.55, conversion: 0.449647 }
    }
  }
};

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function firstValue(record: RawRecord, headers: readonly string[]): unknown {
  for (const header of headers) {
    if (record[header] !== undefined && record[header] !== null && text(record[header])) return record[header];
  }
  return "";
}

function rowValue(record: TargetRecordLike, keys: readonly string[]): unknown {
  const source = record as RawRecord;
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && text(source[key])) return source[key];
  }
  return "";
}

export function parseSheetNumber(value: unknown): number {
  const cleaned = text(value).replace(/[$,%]/g, "").replace(/,/g, "");
  if (!cleaned) return 0;
  const numberValue = Number(cleaned);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function isRateColumn(header: unknown): boolean {
  const lower = text(header).toLowerCase();
  return /(all commission|aff commission|commission rate|success rate|conversion rate|avg conversion|\bconversion\b|\bcvr\b)/.test(lower)
    && !/count/.test(lower);
}

export function percentageNumberForHeader(header: unknown, value: unknown): number | null {
  if (!isRateColumn(header)) return null;
  const rawText = text(value);
  if (!rawText) return null;
  const cleaned = rawText.replace(/%$/, "").replace(/,/g, "").trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const raw = Number(cleaned);
  if (!Number.isFinite(raw)) return null;
  return rawText.includes("%") || Math.abs(raw) > 1 ? raw : raw * 100;
}

export function monthKeyFromText(value: unknown): string {
  const raw = text(value);
  const numeric = raw.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?/);
  if (numeric) return `${numeric[1]}-${String(Number(numeric[2])).padStart(2, "0")}`;
  const label = raw.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!label) return "";
  const monthName = label[1] || "";
  const year = label[2] || "";
  const index = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"
  ].indexOf(monthName.toLowerCase());
  return index < 0 ? "" : `${year}-${String(index + 1).padStart(2, "0")}`;
}

export function monthLabelFromKey(value: unknown): string {
  const key = monthKeyFromText(value);
  if (!key) return "Reporting";
  const date = new Date(`${key}-01T00:00:00`);
  return Number.isNaN(date.getTime()) ? key : date.toLocaleString("en-US", { month: "long", year: "numeric" });
}

export function monthAxisLabel(value: unknown, short = false): string {
  const key = monthKeyFromText(value);
  if (!key) return text(value) || "-";
  const date = new Date(`${key}-01T00:00:00`);
  return Number.isNaN(date.getTime())
    ? key
    : date.toLocaleDateString("en-US", { month: short ? "short" : "long", year: "numeric" });
}

export function currentReportingMonthKey(today: () => Date = () => new Date()): string {
  const date = today();
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonthKey(monthKey: string, offset: number): string {
  const normalized = monthKeyFromText(monthKey);
  if (!normalized) return "";
  const date = new Date(`${normalized}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setMonth(date.getMonth() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function reportOverviewMonthKeys(referenceMonthKey: string): string[] {
  return Array.from(new Set([
    ...REPORT_OVERVIEW_REQUIRED_MONTH_KEYS,
    ...REPORT_OVERVIEW_MONTH_OFFSETS.map((offset) => shiftMonthKey(referenceMonthKey, offset))
  ])).filter(Boolean).sort();
}

export function targetTierSortRank(tier: unknown): number {
  const normalized = text(tier).toLowerCase();
  const exact = TARGET_TIER_ORDER.findIndex((item) => item.toLowerCase() === normalized);
  if (exact >= 0) return exact;
  const match = normalized.match(/tier\s*([1-4])/);
  return match ? Number(match[1]) - 1 : 99;
}

export function targetOverrideKey(record: TargetRecordLike): string {
  return `${monthKeyFromText(record.monthKey || record.month) || "unknown"}::${text(record.tier) || "unknown"}`;
}

function applyTargetOverride(record: TargetRecord, overrides: Readonly<Record<string, string>> = {}): TargetRecord {
  const key = targetOverrideKey(record);
  const override = text(overrides[key]);
  return override ? { ...record, target: override, targetOverrideKey: key } : { ...record, targetOverrideKey: key };
}

function targetRecordFromRaw(raw: RawRecord, monthKey: string, tier: string, source: string, databaseOnly = false): TargetRecord {
  const month = monthLabelFromKey(monthKey) === "Reporting" ? text(raw.Month || raw.month) || monthKey : monthLabelFromKey(monthKey);
  const clicks = parseSheetNumber(firstValue(raw, ["Total Clicks", "Clicks", "clicks"]));
  const orders = parseSheetNumber(firstValue(raw, ["Order Count", "Order count", "Orders", "orders"]));
  const revenue = parseSheetNumber(firstValue(raw, ["Revenue", "revenue", "GMV"]));
  const payoutValue = firstValue(raw, ["Payout", "payout", "Total Commission", "Affiliate Payout"]);
  const conversionRaw = firstValue(raw, ["Avg Conversion", "Conversion Rate", "Conversion", "CVR"]);
  const conversionPercent = percentageNumberForHeader("Avg Conversion", conversionRaw);
  return {
    month,
    monthKey,
    tier,
    brandCount: parseSheetNumber(firstValue(raw, ["Brand Count", "Active Brands", "brandCount"])),
    clicks,
    orders,
    revenue,
    payout: text(payoutValue) ? parseSheetNumber(payoutValue) : null,
    conversionRate: conversionPercent === null ? (clicks ? orders / clicks : 0) : conversionPercent / 100,
    newEntries: parseSheetNumber(firstValue(raw, ["New Tier Entries", "New Entries", "newEntries"])),
    exits: parseSheetNumber(firstValue(raw, ["Tier Exits", "Exits", "exits"])),
    target: text(firstValue(raw, ["Target", "target"])),
    source,
    databaseOnly,
    tierExitsAvailable: firstValue(raw, ["Tier Exits", "Exits", "exits"]) !== "",
    targetPlaceholderOnly: false,
    targetOverrideKey: `${monthKey}::${tier}`
  };
}

function normalizeRows(sheet: TargetSheetData): RawRecord[] {
  const directRows = Array.isArray(sheet.rows) ? sheet.rows : [];
  const gridRows = Array.isArray(sheet.grid) ? sheet.grid : [];
  const headers = (Array.isArray(sheet.headers) ? sheet.headers : []).map(text);
  const rows = directRows.length ? directRows : gridRows;
  if (!rows.length) return [];
  if (rows.every(isRecord)) return rows.filter(isRecord);
  const inferredHeaders = headers.length
    ? headers
    : (Array.isArray(rows[0]) ? rows[0].map(text) : []);
  const source = headers.length ? rows : rows.slice(1);
  return source.filter(Array.isArray).map((values) => {
    const record: Record<string, unknown> = {};
    inferredHeaders.forEach((header, index) => {
      if (header) record[header] = values[index] ?? "";
    });
    return record;
  });
}

function normalizedSheets(reportData: TargetReportData): Array<{ name: string; rows: RawRecord[] }> {
  const sheets = Array.isArray(reportData.sheets) ? reportData.sheets : [];
  return sheets.map((sheet) => ({
    name: text(sheet.name || sheet.sheetName),
    rows: normalizeRows(sheet)
  })).filter((sheet) => sheet.name || sheet.rows.length);
}

function targetPresetRecord(monthKey: string, tier: string, preset: { readonly target?: string; readonly actuals?: Readonly<Record<string, number>> }): TargetRecord {
  const actuals = preset.actuals || {};
  const clicks = actuals.clicks || 0;
  const orders = actuals.orders || 0;
  return {
    month: monthLabelFromKey(monthKey),
    monthKey,
    tier,
    brandCount: actuals.brandCount || 0,
    clicks,
    orders,
    revenue: actuals.revenue || 0,
    payout: actuals.payout === undefined ? null : actuals.payout,
    conversionRate: actuals.conversion === undefined ? (clicks ? orders / clicks : 0) : actuals.conversion,
    newEntries: actuals.newTierEntries || 0,
    exits: actuals.tierExits || 0,
    target: preset.target || "",
    source: "verified-tier-snapshot",
    databaseOnly: true,
    tierExitsAvailable: actuals.tierExits !== undefined,
    targetPlaceholderOnly: false,
    targetOverrideKey: `${monthKey}::${tier}`
  };
}

function withTargetMonthPresets(records: readonly TargetRecord[]): TargetRecord[] {
  const merged = records.map((record) => ({ ...record }));
  Object.entries(TARGET_MONTH_PRESETS).forEach(([monthKey, tiers]) => {
    Object.entries(tiers).forEach(([tier, preset]) => {
      const index = merged.findIndex((record) => record.monthKey === monthKey && record.tier.toLowerCase() === tier.toLowerCase());
      if (index < 0) {
        merged.push(targetPresetRecord(monthKey, tier, preset));
        return;
      }
      const current = merged[index];
      if (!current) return;
      const fallback = targetPresetRecord(monthKey, tier, preset);
      const hasMetrics = current.brandCount > 0 || current.clicks > 0 || current.orders > 0 || current.revenue > 0;
      const hydrated = hasMetrics || current.source === "database" ? current : { ...current, ...fallback };
      merged[index] = {
        ...hydrated,
        target: hydrated.target || fallback.target,
        exits: hydrated.tierExitsAvailable ? hydrated.exits : fallback.exits,
        tierExitsAvailable: hydrated.tierExitsAvailable || fallback.tierExitsAvailable
      };
    });
  });
  return merged;
}

function ensureReportingMonthRecord(records: readonly TargetRecord[], monthKey: string): TargetRecord[] {
  const normalized = monthKeyFromText(monthKey);
  if (!normalized || records.some((record) => record.monthKey === normalized)) return records.slice();
  return records.concat({
    month: monthLabelFromKey(normalized),
    monthKey: normalized,
    tier: "Total",
    brandCount: 0,
    clicks: 0,
    orders: 0,
    revenue: 0,
    payout: null,
    conversionRate: 0,
    newEntries: 0,
    exits: 0,
    target: "",
    source: "target-placeholder",
    databaseOnly: true,
    tierExitsAvailable: false,
    targetPlaceholderOnly: true,
    targetOverrideKey: `${normalized}::Total`
  });
}

function parseSummaryRows(sheet: { name: string; rows: RawRecord[] }): TargetRecord[] {
  if (!/tier\s*summary|target/i.test(sheet.name)) return [];
  return sheet.rows.flatMap((row) => {
    const monthKey = monthKeyFromText(firstValue(row, ["Month", "month", "Report Month", "reportMonth"]));
    const tier = text(firstValue(row, ["Tier", "tier"]));
    return monthKey && tier ? [targetRecordFromRaw(row, monthKey, tier, "sheet-summary")] : [];
  });
}

function deriveTargetRecordsFromTierSheets(sheets: readonly { name: string; rows: RawRecord[] }[], monthKey: string): TargetRecord[] {
  const tierSheets = new Map(sheets.map((sheet) => [sheet.name.toLowerCase(), sheet]));
  const records: TargetRecord[] = TARGET_TIER_ORDER.filter((tier) => tier !== "Black Tier").flatMap((tier) => {
    const canonical = tier === "BLACK TIER" ? "black tier" : tier.toLowerCase();
    const sheet = tierSheets.get(canonical) || tierSheets.get(tier.toLowerCase());
    const rows = sheet?.rows || [];
    if (!rows.length) return [];
    const clicks = rows.reduce((sum, row) => sum + parseSheetNumber(firstValue(row, ["Total Clicks", "Clicks"])), 0);
    const orders = rows.reduce((sum, row) => sum + parseSheetNumber(firstValue(row, ["Order Count", "Order count", "Orders"])), 0);
    const revenue = rows.reduce((sum, row) => sum + parseSheetNumber(firstValue(row, ["Revenue", "GMV"])), 0);
    const payout = rows.reduce((sum, row) => sum + parseSheetNumber(firstValue(row, ["Payout", "Affiliate Payout"])), 0);
    return [{
      month: monthLabelFromKey(monthKey),
      monthKey,
      tier,
      brandCount: rows.length,
      clicks,
      orders,
      revenue,
      payout,
      conversionRate: clicks ? orders / clicks : 0,
      newEntries: 0,
      exits: 0,
      target: "",
      source: "tier-sheets",
      databaseOnly: false,
      tierExitsAvailable: true,
      targetPlaceholderOnly: false,
      targetOverrideKey: `${monthKey}::${tier}`
    } satisfies TargetRecord];
  });
  const totals = records.reduce((total, record) => ({
    brandCount: total.brandCount + record.brandCount,
    clicks: total.clicks + record.clicks,
    orders: total.orders + record.orders,
    revenue: total.revenue + record.revenue,
    payout: total.payout + (record.payout || 0)
  }), { brandCount: 0, clicks: 0, orders: 0, revenue: 0, payout: 0 });
  records.push({
    month: monthLabelFromKey(monthKey),
    monthKey,
    tier: "Total",
    brandCount: totals.brandCount,
    clicks: totals.clicks,
    orders: totals.orders,
    revenue: totals.revenue,
    payout: totals.payout,
    conversionRate: totals.clicks ? totals.orders / totals.clicks : 0,
    newEntries: 0,
    exits: 0,
    target: "",
    source: "tier-sheets",
    databaseOnly: false,
    tierExitsAvailable: true,
    targetPlaceholderOnly: false,
    targetOverrideKey: `${monthKey}::Total`
  });
  return records;
}

export function buildTargetRecords(reportData: TargetReportData, options: BuildTargetRecordsOptions = {}): TargetRecord[] {
  const referenceMonthKey = monthKeyFromText(options.referenceMonthKey || currentReportingMonthKey(options.today));
  if (!referenceMonthKey) return [];
  const sheets = normalizedSheets(reportData);
  const summaryRows = sheets.flatMap(parseSummaryRows);
  const base = summaryRows.length
    ? summaryRows
    : deriveTargetRecordsFromTierSheets(sheets, referenceMonthKey);
  let records = withTargetMonthPresets(base);
  reportOverviewMonthKeys(referenceMonthKey).forEach((monthKey) => {
    records = ensureReportingMonthRecord(records, monthKey);
  });
  return records
    .map((record) => applyTargetOverride(record, options.targetOverrides))
    .sort((left, right) => left.monthKey.localeCompare(right.monthKey) || targetTierSortRank(left.tier) - targetTierSortRank(right.tier));
}

export function targetRecordMetricTotal(record: TargetRecordLike): number {
  return parseSheetNumber(record.brandCount) + parseSheetNumber(record.clicks) + parseSheetNumber(record.orders) + parseSheetNumber(record.revenue);
}

export function targetMonthHasMetrics(records: readonly TargetRecordLike[], month: string): boolean {
  return records.filter((record) => text(record.month) === month || monthKeyFromText(record.monthKey) === monthKeyFromText(month))
    .some((record) => targetRecordMetricTotal(record) > 0);
}

export function preferredTargetMonth(records: readonly TargetRecord[], fallback = ""): string {
  const months = Array.from(new Set(records.map((record) => record.month).filter(Boolean)))
    .sort((left, right) => monthKeyFromText(left).localeCompare(monthKeyFromText(right)));
  const active = months.filter((month) => targetMonthHasMetrics(records, month));
  return active.at(-1) || months.at(-1) || fallback;
}

export function targetRowsForMonth(records: readonly TargetRecord[], month: string, tier = "all"): TargetRecord[] {
  return records.filter((record) => (!month || month === "all" || record.month === month) && (tier === "all" || record.tier === tier));
}

export function targetMetricRows(records: readonly TargetRecord[]): TargetRecord[] {
  return records.filter((record) => record.tier.toLowerCase() !== "total")
    .slice()
    .sort((left, right) => targetTierSortRank(left.tier) - targetTierSortRank(right.tier));
}

export function targetRowMetricValue(record: TargetRecordLike, key: TargetMetricKey): number {
  if (key === "orders") return parseSheetNumber(record.orders);
  if (key === "clicks") return parseSheetNumber(record.clicks);
  if (key === "conversion") return Number(record.conversionRate) || 0;
  if (key === "brands") return parseSheetNumber(record.brandCount);
  return parseSheetNumber(record.revenue);
}

export function targetSummaryMetricValue(summary: TargetSummary, key: TargetMetricKey): number {
  if (key === "orders") return summary.orders;
  if (key === "clicks") return summary.clicks;
  if (key === "conversion") return summary.conversionRate;
  if (key === "brands") return summary.brands;
  return summary.revenue;
}

export function targetSummary(records: readonly TargetRecordLike[]): TargetSummary {
  const source: readonly TargetRecordLike[] = records.some((record) => text(record.tier).toLowerCase() === "total")
    ? records.filter((record) => text(record.tier).toLowerCase() === "total")
    : targetMetricRows(records as readonly TargetRecord[]);
  const totals = source.reduce<TargetSummary>((summary, record) => ({
    brands: summary.brands + parseSheetNumber(record.brandCount),
    clicks: summary.clicks + parseSheetNumber(record.clicks),
    orders: summary.orders + parseSheetNumber(record.orders),
    revenue: summary.revenue + parseSheetNumber(record.revenue),
    payout: summary.payout + parseSheetNumber(record.payout),
    conversionRate: summary.conversionRate,
    newEntries: summary.newEntries + parseSheetNumber(record.newEntries),
    exits: summary.exits + parseSheetNumber(record.exits)
  }), { brands: 0, clicks: 0, orders: 0, revenue: 0, payout: 0, conversionRate: 0, newEntries: 0, exits: 0 });
  const conversionRate = totals.clicks ? totals.orders / totals.clicks : source.length
    ? source.reduce((sum, record) => sum + (Number(record.conversionRate) || 0), 0) / source.length
    : 0;
  return { ...totals, conversionRate };
}

export function targetProgressDefinition(tier: unknown): TargetProgressDefinition | null {
  const normalized = text(tier).toLowerCase();
  return TARGET_PROGRESS_DEFINITIONS.find((definition) => definition.tier.toLowerCase() === normalized) || null;
}

function scaledNumber(value: string, suffix = ""): number {
  const scale = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[suffix.toUpperCase() as "K" | "M" | "B"] || 1;
  return parseSheetNumber(value) * scale;
}

export function compactNumber(value: unknown): string {
  const numberValue = Number(value) || 0;
  if (Math.abs(numberValue) >= 1_000_000) return `${(numberValue / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}M`;
  if (Math.abs(numberValue) >= 1_000) return `${(numberValue / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}K`;
  return numberValue.toLocaleString();
}

export function compactMoney(value: unknown): string {
  const numberValue = Number(value) || 0;
  if (Math.abs(numberValue) >= 1_000_000) return `$${(numberValue / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}M`;
  if (Math.abs(numberValue) >= 1_000) return `$${(numberValue / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}K`;
  return `$${numberValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function formatTargetMetricValue(key: TargetMetricKey, value: unknown): string {
  if (key === "revenue") return compactMoney(value);
  if (key === "conversion") return `${(Number(value || 0) * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  return compactNumber(value);
}

export function targetGoal(record: TargetRecordLike): TargetGoal | null {
  const targetText = text(record.target);
  const definition = targetProgressDefinition(record.tier);
  const revenue = targetText.match(/(?:GMV|Revenue) Target:\s*\$?\s*([\d,.]+)\s*([KMB])?\+?/i);
  const commission = targetText.match(/Commission Target:\s*\$?\s*([\d,.]+)\s*([KMB])?\+?/i);
  const removal = targetText.match(/Merchant Removal Target:\s*([\d,.]+)\+?/i);
  const promotion = targetText.match(/Brand Target:\s*Promote\s*([\d,.]+)\s*Brands?/i);
  const brand = targetText.match(/Brand Target:\s*([\d,.]+)\+?/i);
  if (definition?.type === "gmv" && revenue) {
    const target = scaledNumber(revenue[1] || "0", revenue[2] || "");
    const actual = parseSheetNumber(record.revenue);
    return { type: "gmv", label: definition.label, target, actual, targetText: compactMoney(target), actualText: compactMoney(actual) };
  }
  if (definition?.type === "commission" && commission) {
    const target = scaledNumber(commission[1] || "0", commission[2] || "");
    const actual = parseSheetNumber(record.payout);
    return { type: "commission", label: definition.label, target, actual, targetText: compactMoney(target), actualText: compactMoney(actual) };
  }
  if (definition?.type === "removal" && (removal || promotion)) {
    const match = removal || promotion;
    const target = parseSheetNumber(match?.[1]);
    const actual = parseSheetNumber(record.exits);
    return { type: "removal", label: definition.label, target, actual, targetText: `${target.toLocaleString()} merchants`, actualText: `${actual.toLocaleString()} removed` };
  }
  if (revenue) {
    const target = scaledNumber(revenue[1] || "0", revenue[2] || "");
    const actual = parseSheetNumber(record.revenue);
    return { type: "gmv", label: "Revenue target", target, actual, targetText: compactMoney(target), actualText: compactMoney(actual) };
  }
  if (commission) {
    const target = scaledNumber(commission[1] || "0", commission[2] || "");
    const actual = parseSheetNumber(record.payout);
    return { type: "commission", label: "Commission target", target, actual, targetText: compactMoney(target), actualText: compactMoney(actual) };
  }
  if (removal || promotion) {
    const match = removal || promotion;
    const target = parseSheetNumber(match?.[1]);
    const actual = parseSheetNumber(record.exits);
    return { type: removal ? "removal" : "promotion", label: removal ? "Merchant removal target" : "Promotion target", target, actual, targetText: `${target.toLocaleString()} ${removal ? "merchants" : "brands"}`, actualText: `${actual.toLocaleString()} ${removal ? "removed" : "moved"}` };
  }
  if (brand) {
    const target = parseSheetNumber(brand[1]);
    const actual = parseSheetNumber(record.brandCount);
    return { type: "brand", label: "Brand target", target, actual, targetText: `${target.toLocaleString()} brands`, actualText: `${actual.toLocaleString()} active` };
  }
  return null;
}

export function targetActualAvailable(record: TargetRecordLike, goal: TargetGoal | null): boolean {
  if (!goal || record.targetPlaceholderOnly || !Number.isFinite(goal.actual)) return false;
  return !(goal.type === "removal" && record.source === "database" && record.tierExitsAvailable === false);
}

export function targetEditableRecord(definition: TargetProgressDefinition, record: TargetRecord | null, month: string): TargetRecord | null {
  if (record) return record;
  const monthKey = monthKeyFromText(month);
  if (!monthKey || month === "all") return null;
  return {
    month: monthLabelFromKey(monthKey),
    monthKey,
    tier: definition.tier,
    brandCount: 0,
    clicks: 0,
    orders: 0,
    revenue: 0,
    payout: null,
    conversionRate: 0,
    newEntries: 0,
    exits: 0,
    target: "",
    source: "target-placeholder",
    databaseOnly: true,
    tierExitsAvailable: false,
    targetPlaceholderOnly: true,
    targetOverrideKey: `${monthKey}::${definition.tier}`
  };
}

export function targetTextFromEditValue(record: TargetRecordLike, value: string, definition?: TargetProgressDefinition | null): string {
  const clean = text(value);
  if (!clean) return "";
  const current = text(record.target);
  const goal = targetGoal(record);
  const type = goal?.type || definition?.type;
  const replace = (pattern: RegExp, replacement: string) => pattern.test(current) ? current.replace(pattern, replacement) : `${current}${current ? "; " : ""}${replacement}`;
  if (type === "gmv") return replace(/(?:GMV|Revenue) Target:\s*[^;]+/i, `GMV Target: ${clean}`);
  if (type === "commission") return replace(/Commission Target:\s*[^;]+/i, `Commission Target: ${clean}`);
  if (type === "removal") return replace(/(?:Merchant Removal Target:\s*|Brand Target:\s*Promote\s*)[^;]+/i, `Merchant Removal Target: ${(clean.match(/[\d,.]+/) || [clean])[0]}`);
  if (type === "promotion") return replace(/Brand Target:\s*Promote\s*[^;]+/i, `Brand Target: Promote ${(clean.match(/[\d,.]+/) || [clean])[0]} Brands`);
  if (type === "brand") return replace(/Brand Target:\s*(?!Promote)[^;]+/i, `Brand Target: ${clean}`);
  return clean;
}

function valueFromDbRow(row: RawRecord, keys: readonly string[]): number {
  return parseSheetNumber(firstValue(row, keys));
}

export function dbMonthlyTrendRows(payload: DbStatusPayload | null, metric: TargetMetricKey = "revenue"): TargetTrendRow[] {
  const recent = isRecord(payload?.recentMonths) ? payload.recentMonths : {};
  const aggregateRows = Array.isArray(recent.aggregateOrders) ? recent.aggregateOrders.filter(isRecord) : [];
  const clickRows = Array.isArray(recent.amazonClicks) ? recent.amazonClicks.filter(isRecord) : [];
  const byMonth = new Map<string, { monthKey: string; revenue: number; orders: number; clicks: number; activeBrands: number }>();
  aggregateRows.forEach((row) => {
    const monthKey = monthKeyFromText(row.month);
    if (monthKey) byMonth.set(monthKey, { monthKey, revenue: valueFromDbRow(row, ["revenue"]), orders: valueFromDbRow(row, ["orders"]), clicks: 0, activeBrands: valueFromDbRow(row, ["activeBrands", "brandCount"]) });
  });
  clickRows.forEach((row) => {
    const monthKey = monthKeyFromText(row.month);
    if (!monthKey) return;
    const current = byMonth.get(monthKey) || { monthKey, revenue: 0, orders: 0, clicks: 0, activeBrands: 0 };
    current.clicks = valueFromDbRow(row, ["clicks"]);
    byMonth.set(monthKey, current);
  });
  return Array.from(byMonth.values()).sort((left, right) => left.monthKey.localeCompare(right.monthKey)).map((row) => {
    const value = metric === "orders"
      ? row.orders
      : metric === "clicks"
        ? row.clicks
        : metric === "brands"
          ? row.activeBrands
          : metric === "conversion"
            ? (row.clicks ? row.orders / row.clicks : 0)
            : row.revenue;
    return {
      label: monthAxisLabel(row.monthKey),
      shortLabel: monthAxisLabel(row.monthKey, true),
      monthKey: row.monthKey,
      value,
      state: "month database",
      detail: `${monthAxisLabel(row.monthKey)}: ${formatTargetMetricValue(metric, value)}`
    };
  });
}

export function dbMonthlyRowForKey(monthKey: string, payload: DbStatusPayload | null): TargetTrendRow | null {
  return dbMonthlyTrendRows(payload).find((row) => row.monthKey === monthKeyFromText(monthKey)) || null;
}

export function targetMonthlyTrendRows(records: readonly TargetRecord[], options: TargetMonthlyTrendOptions): TargetTrendRow[] {
  if (options.tier === "all" && options.databaseRows?.length) return [...options.databaseRows];
  const metric = options.metric || "revenue";
  const months = Array.from(new Set(records.map((record) => record.month))).sort((left, right) => monthKeyFromText(left).localeCompare(monthKeyFromText(right)));
  const selectedIndex = options.selectedMonth && options.selectedMonth !== "all" ? months.indexOf(options.selectedMonth) : months.length - 1;
  const end = selectedIndex >= 0 ? selectedIndex + 1 : months.length;
  return months.slice(Math.max(0, end - 6), end).map((month) => {
    const summary = targetSummary(targetRowsForMonth(records, month, options.tier || "all"));
    const value = targetSummaryMetricValue(summary, metric);
    return {
      label: month,
      shortLabel: monthAxisLabel(month, true),
      monthKey: monthKeyFromText(month),
      value,
      selected: month === options.selectedMonth,
      state: "month snapshot",
      detail: `${month}: ${formatTargetMetricValue(metric, value)}`
    };
  });
}

export function dbDailyTrendRows(payload: DbStatusPayload | null): Array<{ readonly date: string; readonly orders: number | null; readonly revenue: number | null; readonly clicks: number | null; readonly state: string }> {
  const daily = isRecord(payload?.dailyTrend) ? payload.dailyTrend : {};
  const rows = Array.isArray(daily.rows) ? daily.rows.filter(isRecord) : [];
  return rows.map((row) => ({
    date: text(row.date || row.day),
    orders: row.orders == null ? null : parseSheetNumber(row.orders),
    revenue: row.revenue == null ? null : parseSheetNumber(row.revenue),
    clicks: row.clicks == null ? null : parseSheetNumber(row.clicks),
    state: text(row.state) || "observed"
  })).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date));
}

export function targetDailyTrendRows(payload: DbStatusPayload | null, metric: TargetMetricKey): TargetTrendRow[] {
  return dbDailyTrendRows(payload).map((row) => {
    const value = metric === "orders" ? row.orders : metric === "clicks" ? row.clicks : metric === "conversion" ? (row.clicks ? (row.orders || 0) / row.clicks : 0) : metric === "brands" ? 0 : row.revenue;
    const date = new Date(`${row.date}T00:00:00`);
    const shortLabel = Number.isNaN(date.getTime()) ? row.date : date.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
    const label = Number.isNaN(date.getTime()) ? row.date : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return {
      label,
      shortLabel,
      value,
      state: row.state,
      detail: `${label}: ${value == null ? "Pending" : formatTargetMetricValue(metric, value)}`
    };
  });
}
