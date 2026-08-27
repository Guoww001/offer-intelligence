import type { OfferRecord } from "../../shared/contracts/offer";
import { toFiniteNumber } from "../../shared/format/number";
import type {
  PaymentFilters,
  PaymentRecord,
  PaymentSort,
  PaymentSortKey,
  PaymentStatus,
  PaymentSummary
} from "../../shared/contracts/payment";

export const PAYMENT_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
] as const;

export const ACTIVE_PAYMENT_MONTHS = ["February", "March", "April", "May", "June"] as const;

const PAYMENT_STATUS_ORDER: readonly PaymentStatus[] = [
  "Overdue",
  "Unpaid",
  "Partial",
  "Unknown",
  "Pending",
  "Paid"
];

type RawRecord = Readonly<Record<string, unknown>>;

export interface PaymentModelOptions {
  readonly offers?: readonly OfferRecord[];
  readonly sheetRows?: readonly RawRecord[];
  readonly today?: string;
}

export interface PaymentFilterOptions {
  readonly months: readonly string[];
  readonly networks: readonly string[];
  readonly regions: readonly string[];
  readonly tiers: readonly string[];
  readonly statuses: readonly PaymentStatus[];
}

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function firstText(source: RawRecord, keys: readonly string[], fallback = ""): string {
  for (const key of keys) {
    const value = text(source[key]);
    if (value) return value;
  }
  return fallback;
}

function firstNumber(source: RawRecord, keys: readonly string[], fallback = 0): number {
  for (const key of keys) {
    const value = source[key];
    if (value === undefined || value === null || String(value).trim() === "") continue;
    return toFiniteNumber(value, fallback);
  }
  return fallback;
}

function normalizedText(value: unknown): string {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function validDateKey(value: unknown): string {
  const candidate = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return "";
  const date = new Date(`${candidate}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? "" : candidate;
}

function monthNameFromText(value: unknown): string {
  const raw = text(value);
  const lower = raw.toLowerCase();
  const direct = PAYMENT_MONTHS.find((month) => lower.includes(month.toLowerCase()));
  if (direct) return direct;
  const chinese = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
  const chineseIndex = chinese.findIndex((month) => raw.includes(month));
  if (chineseIndex >= 0) return PAYMENT_MONTHS[chineseIndex] || "";
  const numeric = raw.match(/(?:^|[^0-9])([1-9]|1[0-2])\s*(?:月|月份)/);
  if (numeric) return PAYMENT_MONTHS[Number(numeric[1]) - 1] || "";
  const key = raw.match(/\b\d{4}-(0[1-9]|1[0-2])\b/);
  if (key) return PAYMENT_MONTHS[Number(key[1]) - 1] || "";
  return "";
}

function reportYear(source: RawRecord): number {
  const value = Math.round(toFiniteNumber(source.reportYear, 2026));
  return value >= 2000 && value <= 2100 ? value : 2026;
}

function reportMonthKey(source: RawRecord, month: string, year: number): string {
  const explicit = text(source.reportMonthKey);
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(explicit)) return explicit;
  const monthIndex = PAYMENT_MONTHS.indexOf(month as typeof PAYMENT_MONTHS[number]);
  return monthIndex >= 0 ? `${year}-${String(monthIndex + 1).padStart(2, "0")}` : "";
}

function addDaysUtc(date: Date, days: number): string {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function normalizeRegion(value: unknown): string {
  const raw = text(value);
  if (!raw) return "";
  const compact = raw
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split(/[/?#]/)[0] || ""
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "");
  const aliases: Record<string, string> = {
    "amazon.com": "US",
    com: "US",
    us: "US",
    usa: "US",
    unitedstates: "US",
    "amazon.ca": "Canada",
    ca: "Canada",
    can: "Canada",
    canada: "Canada",
    "amazon.co.uk": "UK",
    "amazon.uk": "UK",
    "co.uk": "UK",
    uk: "UK",
    gb: "UK",
    gbr: "UK",
    unitedkingdom: "UK",
    "amazon.fr": "FR",
    fr: "FR",
    fra: "FR",
    france: "FR",
    "amazon.de": "DE",
    de: "DE",
    deu: "DE",
    germany: "DE",
    deutschland: "DE"
  };
  return aliases[compact] || raw.toUpperCase();
}

function inferRegion(source: RawRecord, offer: RawRecord | undefined): string {
  const explicit = firstText(source, ["region", "marketplace", "marketPlace", "market", "country", "countryCode"]);
  if (explicit) return normalizeRegion(explicit);
  const offerRegion = offer && firstText(offer, ["region", "country", "countryCode"]);
  if (offerRegion) return normalizeRegion(offerRegion);
  const name = firstText(source, ["merchantName", "brand"]) || (offer && firstText(offer, ["brand", "merchantName"]));
  const match = name?.match(/(?:^|[\s()[\]-])(US|USA|UK|GB|DE|FR|CA|AU)(?:$|[\s()[\]-])/i);
  return match ? normalizeRegion(match[1]) : "";
}

function matchedOffer(source: RawRecord, offers: readonly OfferRecord[]): RawRecord | undefined {
  const merchantId = text(source.merchantId);
  const merchantName = normalizedText(firstText(source, ["merchantName", "brand"]));
  return offers.find((offer) => merchantId && text(offer.merchantId) === merchantId)
    || offers.find((offer) => merchantName && normalizedText(offer.brand || offer.merchantName) === merchantName);
}

function explicitPaymentCycle(source: RawRecord | undefined): number {
  if (!source) return 0;
  for (const key of [
    "paymentCycle",
    "payment_cycle",
    "paymentCycleDays",
    "payment_cycle_days",
    "paymentTermDays",
    "payment_terms_days",
    "paymentTermsDays",
    "paymentDelayDays",
    "payoutDelayDays",
    "netDays",
    "net_days"
  ]) {
    const value = Math.round(toFiniteNumber(source[key]));
    if (value > 0) return value;
  }
  return 0;
}

function sheetPaymentCycle(source: RawRecord, sheetRows: readonly RawRecord[]): number {
  const merchantId = text(source.merchantId);
  const merchantName = normalizedText(firstText(source, ["merchantName", "brand"]));
  const match = sheetRows.find((row) => (
    (merchantId && text(row["Merchant ID"] || row.merchantId) === merchantId)
    || (merchantName && normalizedText(row["Merchant Name"] || row.Brand || row.brand) === merchantName)
  ));
  return explicitPaymentCycle(match);
}

function resolvePaymentCycle(source: RawRecord, offer: RawRecord | undefined, sheetRows: readonly RawRecord[]): number {
  const fromSheet = sheetPaymentCycle(source, sheetRows);
  if (fromSheet > 0) return fromSheet;
  const fromSource = explicitPaymentCycle(source);
  if (fromSource > 0) return fromSource;
  const fromOffer = explicitPaymentCycle(offer);
  if (fromOffer > 0) return fromOffer;
  return normalizedText(firstText(source, ["network"]) || (offer && firstText(offer, ["network"]))) === "wayward" ? 105 : 60;
}

function paymentAvailabilityDate(monthKey: string, paymentCycle: number): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) return "";
  const [yearText, monthText] = monthKey.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  return addDaysUtc(new Date(Date.UTC(year, monthIndex, 2)), paymentCycle > 0 ? paymentCycle : 60);
}

function paymentStatus(value: unknown): PaymentStatus {
  const candidate = text(value).toLowerCase();
  if (candidate === "paid") return "Paid";
  if (candidate === "pending") return "Pending";
  if (candidate === "unpaid") return "Unpaid";
  if (candidate === "overdue") return "Overdue";
  if (candidate === "partial") return "Partial";
  return "Unknown";
}

function derivePaymentStatus(
  source: RawRecord,
  expected: number,
  paid: number,
  remaining: number,
  dueDate: string,
  today: string
): PaymentStatus {
  const raw = text(source.rawStatus || source.paymentStatus).toLowerCase();
  if (raw === "paid" || (expected > 0 && paid >= expected - 0.01 && !raw.includes("late") && !raw.includes("unpaid"))) {
    return "Paid";
  }
  if (expected <= 0 && paid <= 0) return raw.includes("pending") ? "Pending" : "Unknown";
  const baselineDate = paymentAvailabilityDate(text(source.reportMonthKey), 60);
  if (!baselineDate || today <= baselineDate) return "Pending";
  if (dueDate && today > dueDate && remaining > 0.01) return "Overdue";
  if (paid > 0 && remaining > 0.01) return "Partial";
  if (raw.includes("pending") || raw.includes("late") || raw.includes("unpaid") || remaining > 0.01) return "Unpaid";
  return "Unknown";
}

export function normalizePaymentRecord(raw: unknown, options: PaymentModelOptions = {}): PaymentRecord | null {
  if (!isRecord(raw)) return null;
  const offers = options.offers || [];
  const sheetRows = options.sheetRows || [];
  const offer = matchedOffer(raw, offers);
  const sourceMerchantId = firstText(raw, ["merchantId"]);
  const matchedMerchantId = offer ? firstText(offer, ["merchantId"]) : "";
  const network = firstText(raw, ["network"], offer ? firstText(offer, ["network"], "Levanta") : "Levanta");
  const merchantId = normalizedText(network) === "levanta" && matchedMerchantId
    ? matchedMerchantId
    : sourceMerchantId || matchedMerchantId;
  const merchantName = firstText(raw, ["merchantName", "brand"], offer ? firstText(offer, ["brand", "merchantName"], "Unknown merchant") : "Unknown merchant");
  const month = firstText(raw, ["reportMonth"], monthNameFromText(raw.reportMonthKey)) || "Unknown";
  const year = reportYear(raw);
  const monthKey = reportMonthKey(raw, month, year);
  const paymentCycle = resolvePaymentCycle(raw, offer, sheetRows);
  const revenueMade = firstNumber(raw, ["revenueMade", "sales", "revenue", "salesAmount", "totalSales"]);
  const directCommission = firstNumber(raw, ["commissionMade", "totalCommission", "commissionOwed", "expectedPaymentAmount"], Number.NaN);
  const rawCommission = firstNumber(raw, ["commission"], 0);
  const cpcCommission = firstNumber(raw, ["cpcCommission", "cpc_commission"], 0);
  const commissionMade = Number.isNaN(directCommission) ? rawCommission + cpcCommission : directCommission;
  const expectedPaymentAmount = firstNumber(raw, ["expectedPaymentAmount"], commissionMade);
  const paidAmount = firstNumber(raw, ["paidAmount"]);
  const remainingAmount = Math.max(0, firstNumber(raw, ["remainingAmount"], expectedPaymentAmount - paidAmount));
  const expectedPaymentDate = paymentAvailabilityDate(monthKey, Math.max(60, paymentCycle));
  const today = validDateKey(options.today) || localDateKey(new Date());
  const status = derivePaymentStatus(
    { ...raw, reportMonthKey: monthKey },
    expectedPaymentAmount,
    paidAmount,
    remainingAmount,
    expectedPaymentDate,
    today
  );
  const paymentMadeDate = status === "Paid"
    ? validDateKey(raw.paymentMadeDate) || validDateKey(raw.lastCheckedDate) || validDateKey(raw.checkedAt)
    : "";
  const category = firstText(raw, ["category", "mainCategory", "levantaCategory"], offer ? firstText(offer, ["category", "mainCategory", "levantaCategory"], "Uncategorized") : "Uncategorized");
  const id = firstText(raw, ["id"], `${merchantId || normalizedText(merchantName)}::${monthKey}::${normalizeRegion(raw.region || raw.marketplace || "")}`);

  return {
    ...raw,
    id,
    merchantId,
    merchantName,
    network,
    region: inferRegion(raw, offer),
    tier: firstText(raw, ["tier"], offer ? firstText(offer, ["tier"], "Unknown") : "Unknown"),
    category,
    mainCategory: firstText(raw, ["mainCategory"], offer ? firstText(offer, ["mainCategory"], "") : ""),
    subCategory: firstText(raw, ["subCategory"], offer ? firstText(offer, ["subCategory"], "") : ""),
    reportMonth: month,
    reportYear: year,
    reportMonthKey: monthKey,
    revenueMade,
    commissionMade,
    expectedPaymentAmount,
    paidAmount,
    remainingAmount,
    paymentCycle,
    paymentStatus: status,
    rawStatus: text(raw.rawStatus || raw.paymentStatus),
    expectedPaymentDate,
    paymentAvailabilityDate: expectedPaymentDate,
    paymentMadeDate,
    lastCheckedDate: validDateKey(raw.lastCheckedDate) || validDateKey(raw.checkedAt),
    currency: firstText(raw, ["currency"], "USD"),
    isPlaceholder: Boolean(raw.isPlaceholder),
    notes: firstText(raw, ["notes"])
  };
}

function paymentIdentity(record: PaymentRecord): string {
  return text(record.merchantId) || normalizedText(record.merchantName);
}

export function withPendingPaymentPlaceholders(
  records: readonly PaymentRecord[],
  activeMonths: readonly string[] = ACTIVE_PAYMENT_MONTHS
): readonly PaymentRecord[] {
  const result = [...records];
  const existing = new Set(records.map((record) => `${paymentIdentity(record)}::${record.reportMonthKey}`));
  const merchants = Array.from(new Map(records
    .filter((record) => paymentIdentity(record))
    .map((record) => [paymentIdentity(record), record])).values());

  for (const merchant of merchants) {
    for (const month of activeMonths) {
      const monthIndex = PAYMENT_MONTHS.indexOf(month as typeof PAYMENT_MONTHS[number]);
      if (monthIndex < 0) continue;
      const year = merchant.reportYear || 2026;
      const monthKey = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
      const key = `${paymentIdentity(merchant)}::${monthKey}`;
      if (existing.has(key)) continue;
      result.push({
        ...merchant,
        id: `${paymentIdentity(merchant)}::${monthKey}::pending-placeholder`,
        reportMonth: month,
        reportYear: year,
        reportMonthKey: monthKey,
        revenueMade: 0,
        commissionMade: 0,
        expectedPaymentAmount: 0,
        paidAmount: 0,
        remainingAmount: 0,
        paymentStatus: "Pending",
        rawStatus: "pending",
        expectedPaymentDate: paymentAvailabilityDate(monthKey, Math.max(60, merchant.paymentCycle)),
        paymentAvailabilityDate: paymentAvailabilityDate(monthKey, Math.max(60, merchant.paymentCycle)),
        paymentMadeDate: "",
        isPlaceholder: true,
        notes: "No invoice row found for this month."
      });
      existing.add(key);
    }
  }
  return result;
}

export function visiblePaymentRecords(records: readonly PaymentRecord[]): readonly PaymentRecord[] {
  return records.filter((record) => record.revenueMade > 0 || record.commissionMade > 0);
}

export const DEFAULT_PAYMENT_FILTERS: PaymentFilters = Object.freeze({
  month: "all",
  network: "all",
  region: "all",
  tier: "all",
  status: "all",
  search: ""
});

function statusRank(status: PaymentStatus): number {
  const index = PAYMENT_STATUS_ORDER.indexOf(status);
  return index >= 0 ? index : PAYMENT_STATUS_ORDER.length;
}

export function filterPaymentRecords(
  records: readonly PaymentRecord[],
  filters: PaymentFilters
): readonly PaymentRecord[] {
  const search = normalizedText(filters.search);
  return records.filter((record) => {
    const monthMatches = filters.month === "all"
      || record.reportMonth === filters.month
      || record.reportMonthKey === filters.month;
    const searchMatches = !search || normalizedText(`${record.merchantName} ${record.merchantId} ${record.region}`).includes(search);
    return monthMatches
      && (filters.network === "all" || record.network === filters.network)
      && (filters.region === "all" || record.region === filters.region)
      && (filters.tier === "all" || record.tier === filters.tier)
      && (filters.status === "all" || record.paymentStatus === filters.status)
      && searchMatches;
  });
}

function monthSortValue(record: PaymentRecord): number {
  const monthIndex = PAYMENT_MONTHS.indexOf(record.reportMonth as typeof PAYMENT_MONTHS[number]);
  return record.reportYear * 100 + (monthIndex >= 0 ? monthIndex + 1 : 0);
}

function paymentField(record: PaymentRecord, key: PaymentSortKey): unknown {
  switch (key) {
    case "merchantId": return record.merchantId;
    case "merchantName": return record.merchantName;
    case "network": return record.network;
    case "region": return record.region;
    case "tier": return record.tier;
    case "reportMonth": return monthSortValue(record);
    case "paymentStatus": return statusRank(record.paymentStatus);
    case "revenueMade": return record.revenueMade;
    case "commissionMade": return record.commissionMade;
    case "paymentCycle": return record.paymentCycle;
    case "expectedPaymentDate": return record.expectedPaymentDate;
    case "paymentMadeDate": return record.paymentStatus === "Paid" ? record.paymentMadeDate : "";
    default: return "";
  }
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left ?? "").localeCompare(String(right ?? ""), undefined, { numeric: true });
}

export function sortPaymentRecords(
  records: readonly PaymentRecord[],
  sort: PaymentSort
): readonly PaymentRecord[] {
  const fallback = (left: PaymentRecord, right: PaymentRecord): number => (
    statusRank(left.paymentStatus) - statusRank(right.paymentStatus)
    || right.remainingAmount - left.remainingAmount
    || right.reportMonthKey.localeCompare(left.reportMonthKey)
    || left.merchantName.localeCompare(right.merchantName)
    || left.id.localeCompare(right.id)
  );
  return records
    .map((record, index) => ({ record, index }))
    .sort((left, right) => {
      if (!sort.key) return fallback(left.record, right.record) || left.index - right.index;
      const direction = sort.direction === "desc" ? -1 : 1;
      return direction * compareValues(paymentField(left.record, sort.key), paymentField(right.record, sort.key))
        || fallback(left.record, right.record)
        || left.index - right.index;
    })
    .map(({ record }) => record);
}

export function paymentFilterOptions(records: readonly PaymentRecord[]): PaymentFilterOptions {
  const unique = (values: readonly string[]) => Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const months = unique([
    ...ACTIVE_PAYMENT_MONTHS,
    ...records.map((record) => record.reportMonth)
  ]);
  const monthOrder = (value: string) => {
    const month = monthNameFromText(value);
    const index = PAYMENT_MONTHS.indexOf(month as typeof PAYMENT_MONTHS[number]);
    return index < 0 ? 99 : index;
  };
  return {
    months: months.sort((left, right) => monthOrder(left) - monthOrder(right) || left.localeCompare(right)),
    networks: unique(records.map((record) => record.network)),
    regions: unique(records.map((record) => record.region)),
    tiers: unique(records.map((record) => record.tier)),
    statuses: PAYMENT_STATUS_ORDER.filter((status) => records.some((record) => record.paymentStatus === status))
  };
}

export function buildPaymentSummary(records: readonly PaymentRecord[]): PaymentSummary {
  const merchantIds = new Set(records.map(paymentIdentity).filter(Boolean));
  const merchantCountByStatus = (status: PaymentStatus) => new Set(
    records.filter((record) => record.paymentStatus === status).map(paymentIdentity).filter(Boolean)
  ).size;
  const paidMerchantCount = merchantCountByStatus("Paid");
  const pendingMerchantCount = merchantCountByStatus("Pending");
  const unpaidMerchantCount = merchantCountByStatus("Unpaid");
  const overdueMerchantCount = merchantCountByStatus("Overdue");
  return {
    recordCount: records.length,
    merchantCount: merchantIds.size,
    totalRevenueMade: records.reduce((sum, record) => sum + record.revenueMade, 0),
    totalCommissionMade: records.reduce((sum, record) => sum + record.commissionMade, 0),
    totalPaidAmount: records.reduce((sum, record) => sum + record.paidAmount, 0),
    totalRemainingAmount: records.reduce((sum, record) => sum + record.remainingAmount, 0),
    paidMerchantCount,
    pendingMerchantCount,
    unpaidMerchantCount,
    overdueMerchantCount,
    overdueCount: records.filter((record) => record.paymentStatus === "Overdue").length,
    paymentRate: merchantIds.size ? paidMerchantCount / merchantIds.size : 0,
    paidCount: paidMerchantCount,
    outstandingCount: Math.max(0, merchantIds.size - paidMerchantCount)
  };
}

export function paymentCurrencySymbol(record: Pick<PaymentRecord, "region" | "currency"> | RawRecord): string {
  const rawRecord = record as RawRecord;
  const region = normalizeRegion(
    rawRecord.region
      || rawRecord.marketplace
      || rawRecord.country
      || rawRecord.countryCode
  );
  const currency = text(rawRecord.currency).toUpperCase();
  if (region === "UK" || currency === "GBP") return "£";
  if (region === "DE" || region === "FR" || currency === "EUR") return "€";
  return "$";
}
