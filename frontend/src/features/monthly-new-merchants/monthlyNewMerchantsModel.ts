import type { UiLanguage } from "../../shared/i18n";

type RawRecord = Readonly<Record<string, unknown>>;

export interface MonthlyNewMerchantOfferLookup {
  readonly merchantId?: unknown;
  readonly merchantName?: unknown;
  readonly brand?: unknown;
  readonly tier?: unknown;
  readonly network?: unknown;
}

export interface MonthlyNewMerchantRecord {
  readonly recordId: number;
  readonly reportMonth: string;
  readonly merchantId: string;
  readonly merchantName: string;
  readonly businessManager: string;
  readonly program: string;
  readonly platform: string;
  readonly gmvRequirement: string;
  readonly pastMonthPurchase: string;
  readonly independentWebsites: string;
  readonly reviewSummary: string;
  readonly ourCommission: number | null;
  readonly presetCommission: number | null;
  readonly isPriority: boolean;
  readonly gmvMonthlyTarget: number | null;
  readonly completionReward: string;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MonthlyNewMerchantPayload {
  readonly action: "upsert";
  readonly recordId?: number;
  readonly reportMonth: string;
  readonly merchantId: string;
  readonly merchantName: string;
  readonly businessManager: string;
  readonly program: string;
  readonly platform: string;
  readonly gmvRequirement: string;
  readonly pastMonthPurchase: string;
  readonly independentWebsites: string;
  readonly reviewSummary: string;
  readonly ourCommission: number | null;
  readonly presetCommission: number | null;
  readonly isPriority: boolean;
  readonly gmvMonthlyTarget: number | null;
  readonly completionReward: string;
}

export interface MonthlyNewMerchantImportRow {
  readonly rowNumber: number;
  readonly payload: MonthlyNewMerchantPayload;
  readonly errors: string[];
  status: "pending" | "saving" | "saved" | "error";
  saveError: string;
}

export interface MonthlyNewMerchantImportResult {
  readonly headers: readonly string[];
  readonly recognizedHeaders: number;
  readonly rows: MonthlyNewMerchantImportRow[];
  readonly errors: string[];
}

const IMPORT_HEADERS: Readonly<Record<string, string>> = {
  brand: "merchantName",
  merchant: "merchantName",
  "merchant name": "merchantName",
  merchantname: "merchantName",
  "品牌": "merchantName",
  "商家": "merchantName",
  "商家名称": "merchantName",
  "merchant id": "merchantId",
  merchantid: "merchantId",
  id: "merchantId",
  "商家 id": "merchantId",
  "商家id": "merchantId",
  program: "program",
  "program name": "program",
  "项目": "program",
  "计划": "program",
  platform: "platform",
  "平台": "platform",
  "gmv need to be reach": "gmvRequirement",
  "gmv need to be reached": "gmvRequirement",
  "gmv requirement": "gmvRequirement",
  "gmv target": "gmvRequirement",
  "monthly gmv target": "gmvRequirement",
  "需达到的 gmv": "gmvRequirement",
  "gmv 目标": "gmvRequirement",
  "gmv目标": "gmvRequirement",
  "numeric gmv target": "gmvMonthlyTarget",
  "past month purchase": "pastMonthPurchase",
  "past-month purchase": "pastMonthPurchase",
  "上月购买": "pastMonthPurchase",
  "上月购买情况": "pastMonthPurchase",
  "independent websites": "independentWebsites",
  "independent website": "independentWebsites",
  "独立站": "independentWebsites",
  "独立站数据": "independentWebsites",
  "reviews numbers": "reviewSummary",
  "review numbers": "reviewSummary",
  reviews: "reviewSummary",
  "评论数": "reviewSummary",
  "评论数据": "reviewSummary",
  "our commission": "ourCommission",
  commission: "ourCommission",
  "我们的佣金": "ourCommission",
  "佣金": "ourCommission",
  "preset commission": "presetCommission",
  "预设佣金": "presetCommission",
  bd: "businessManager",
  "business manager": "businessManager",
  "bd owner": "businessManager",
  "负责人": "businessManager",
  priority: "isPriority",
  "重点": "isPriority",
  reward: "completionReward",
  "completion reward": "completionReward",
  "商家奖励": "completionReward"
};

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function normalizedText(value: unknown): string {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function numericId(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeMonthlyNewMerchantImportHeader(value: unknown): string {
  return text(value)
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[._/\\()]+/g, " ")
    .replace(/\s+/g, " ");
}

export function parseMonthlyNewMerchantTable(value: unknown, delimiter = ""): string[][] {
  const source = text(value).replace(/^\uFEFF/, "");
  if (!source.trim()) return [];
  const firstLine = source.split(/\r?\n/).find((line) => line.trim()) || "";
  const separator = delimiter || (firstLine.includes("\t") ? "\t" : ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && !cell) {
      quoted = true;
    } else if (character === separator) {
      row.push(cell);
      cell = "";
    } else if (character === "\r" || character === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (character === "\r" && source[index + 1] === "\n") index += 1;
    } else {
      cell += character;
    }
  }
  row.push(cell);
  rows.push(row);
  while (rows.length && rows[rows.length - 1]?.every((value) => !text(value))) rows.pop();
  return rows;
}

export function parseMonthlyNewMerchantMoney(value: unknown): number | null {
  const raw = text(value);
  if (!raw) return null;
  const normalized = raw
    .replace(/\b(?:USD|US DOLLARS?)\b/gi, "")
    .replace(/[,$£€¥￥\s]/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export interface MonthlyNewMerchantCommissionResult {
  readonly value: number | null;
  readonly error: string;
}

export function parseMonthlyNewMerchantCommission(value: unknown): MonthlyNewMerchantCommissionResult {
  const raw = text(value);
  if (!raw || raw === "-") return { value: null, error: "" };
  const normalized = raw.replace(/%$/, "").replace(/[,\s]/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    return { value: null, error: `Invalid commission: ${raw}` };
  }
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100) {
    return { value: null, error: `Commission must be between 0% and 100%: ${raw}` };
  }
  return { value: amount, error: "" };
}

function canonicalTierName(value: unknown): string {
  const normalized = normalizedText(value);
  if (/^tier[1-4]$/.test(normalized)) return `Tier ${normalized.slice(-1)}`;
  return text(value);
}

function uniqueOfferId(offers: readonly MonthlyNewMerchantOfferLookup[]): string {
  const ids = [...new Set(offers.map((offer) => text(offer.merchantId)).filter(Boolean))];
  return ids.length === 1 ? ids[0] || "" : "";
}

export function resolveMonthlyNewMerchantId(
  record: unknown = {},
  offers: readonly MonthlyNewMerchantOfferLookup[] = []
): string {
  const source = isRecord(record) ? record : {};
  const explicitId = text(source.merchantId);
  if (explicitId) return explicitId;

  const merchantName = normalizedText(source.merchantName);
  if (!merchantName) return "";
  const exactMatches = offers.filter((offer) => [offer.merchantName, offer.brand]
    .some((value) => normalizedText(value) === merchantName));
  const tier1Id = uniqueOfferId(exactMatches.filter((offer) => canonicalTierName(offer.tier) === "Tier 1"));
  if (tier1Id) return tier1Id;

  const platform = normalizedText(source.platform);
  if (platform) {
    const platformId = uniqueOfferId(exactMatches.filter((offer) => normalizedText(offer.network) === platform));
    if (platformId) return platformId;
  }
  return uniqueOfferId(exactMatches);
}

export function normalizeMonthlyNewMerchantRecord(
  record: unknown = {},
  offers: readonly MonthlyNewMerchantOfferLookup[] = []
): MonthlyNewMerchantRecord {
  const source = isRecord(record) ? record : {};
  const rawTarget = source.gmvMonthlyTarget;
  const parsedTarget = rawTarget === null || rawTarget === undefined || rawTarget === ""
    ? null
    : Number(rawTarget);
  const normalized: MonthlyNewMerchantRecord = {
    recordId: numericId(source.recordId),
    reportMonth: text(source.reportMonth),
    merchantId: text(source.merchantId),
    merchantName: text(source.merchantName),
    businessManager: text(source.businessManager),
    program: text(source.program),
    platform: text(source.platform),
    gmvRequirement: text(source.gmvRequirement),
    pastMonthPurchase: text(source.pastMonthPurchase),
    independentWebsites: text(source.independentWebsites),
    reviewSummary: text(source.reviewSummary),
    ourCommission: parseMonthlyNewMerchantCommission(source.ourCommission).value,
    presetCommission: parseMonthlyNewMerchantCommission(source.presetCommission).value,
    isPriority: source.isPriority === true || source.isPriority === 1 || source.isPriority === "1" || source.isPriority === "true",
    gmvMonthlyTarget: parsedTarget !== null && Number.isFinite(parsedTarget) ? parsedTarget : null,
    completionReward: text(source.completionReward),
    createdBy: text(source.createdBy),
    updatedBy: text(source.updatedBy),
    createdAt: text(source.createdAt),
    updatedAt: text(source.updatedAt)
  };
  return { ...normalized, merchantId: resolveMonthlyNewMerchantId(normalized, offers) };
}

export function filterMonthlyNewMerchantRecords(
  records: readonly unknown[],
  search = "",
  offers: readonly MonthlyNewMerchantOfferLookup[] = []
): MonthlyNewMerchantRecord[] {
  const normalizedRecords = records.map((record) => normalizeMonthlyNewMerchantRecord(record, offers));
  const query = text(search).toLowerCase();
  if (!query) return normalizedRecords;
  return normalizedRecords.filter((record) => [
    record.merchantName,
    record.merchantId,
    record.businessManager,
    record.program,
    record.platform,
    record.gmvRequirement,
    record.pastMonthPurchase,
    record.independentWebsites,
    record.reviewSummary,
    record.completionReward
  ].some((value) => value.toLowerCase().includes(query)));
}

export function monthlyNewMerchantTargetTotal(records: readonly unknown[]): number {
  return records.reduce<number>((total, record) => {
    const value = isRecord(record) ? Number(record.gmvMonthlyTarget) : Number.NaN;
    return Number.isFinite(value) ? total + value : total;
  }, 0);
}

export function buildMonthlyNewMerchantPayload(source: RawRecord = {}): MonthlyNewMerchantPayload {
  const recordId = numericId(source.recordId);
  const rawTarget = text(source.gmvMonthlyTarget);
  const parsedTarget = rawTarget ? parseMonthlyNewMerchantMoney(rawTarget) : null;
  const ownCommission = parseMonthlyNewMerchantCommission(source.ourCommission);
  const presetCommission = parseMonthlyNewMerchantCommission(source.presetCommission);
  return {
    action: "upsert",
    ...(recordId ? { recordId } : {}),
    reportMonth: text(source.reportMonth),
    merchantId: text(source.merchantId),
    merchantName: text(source.merchantName),
    businessManager: text(source.businessManager),
    program: text(source.program),
    platform: text(source.platform),
    gmvRequirement: text(source.gmvRequirement),
    pastMonthPurchase: text(source.pastMonthPurchase),
    independentWebsites: text(source.independentWebsites),
    reviewSummary: text(source.reviewSummary),
    ourCommission: ownCommission.value,
    presetCommission: presetCommission.value,
    isPriority: Boolean(source.isPriority),
    gmvMonthlyTarget: parsedTarget,
    completionReward: text(source.completionReward)
  };
}

export function monthlyNewMerchantMonthLabel(month: string, language: UiLanguage): string {
  if (!/^\d{4}-\d{2}$/.test(month)) return month;
  const date = new Date(`${month}-01T12:00:00`);
  if (Number.isNaN(date.getTime())) return month;
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "long"
  }).format(date);
}

export function monthlyNewMerchantUpdatedText(value: unknown, language: UiLanguage): string {
  const raw = text(value);
  if (!raw) return "—";
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(date);
}

export function formatMonthlyNewMerchantMoney(value: unknown): string {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `$${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
    : "—";
}

export function monthlyNewMerchantImportRows(
  table: readonly unknown[][],
  reportMonth: string
): MonthlyNewMerchantImportResult {
  const sourceRows = table.filter((row) => Array.isArray(row) && row.some((value) => text(value)));
  if (!sourceRows.length) {
    return { headers: [], recognizedHeaders: 0, rows: [], errors: ["No table rows found."] };
  }
  const headers = (sourceRows[0] || []).map((value) => text(value));
  const fields = headers.map((header) => IMPORT_HEADERS[normalizeMonthlyNewMerchantImportHeader(header)] || "");
  const recognizedHeaders = fields.filter(Boolean).length;
  const errors: string[] = [];
  if (!fields.includes("merchantName")) errors.push("A Brand or Merchant header is required.");

  const rows: MonthlyNewMerchantImportRow[] = sourceRows.slice(1).map((sourceRow, index) => {
    const mapped: Record<string, string> = {};
    fields.forEach((field, fieldIndex) => {
      const value = sourceRow[fieldIndex];
      if (field && mapped[field] === undefined) mapped[field] = text(value);
    });
    const rowErrors: string[] = [];
    if (!mapped.merchantName) rowErrors.push("Brand is required.");
    if (mapped.merchantId && !/^\d+$/.test(mapped.merchantId)) rowErrors.push("Merchant ID must be numeric.");
    const ownCommission = parseMonthlyNewMerchantCommission(mapped.ourCommission);
    const presetCommission = parseMonthlyNewMerchantCommission(mapped.presetCommission);
    if (ownCommission.error) rowErrors.push(ownCommission.error);
    if (presetCommission.error) rowErrors.push(presetCommission.error);
    const gmvTarget = mapped.gmvMonthlyTarget
      ? parseMonthlyNewMerchantMoney(mapped.gmvMonthlyTarget)
      : parseMonthlyNewMerchantMoney(mapped.gmvRequirement);
    return {
      rowNumber: index + 2,
      payload: buildMonthlyNewMerchantPayload({
        reportMonth,
        merchantId: mapped.merchantId,
        merchantName: mapped.merchantName,
        businessManager: mapped.businessManager,
        program: mapped.program,
        platform: mapped.platform,
        gmvRequirement: mapped.gmvRequirement,
        pastMonthPurchase: mapped.pastMonthPurchase,
        independentWebsites: mapped.independentWebsites,
        reviewSummary: mapped.reviewSummary,
        ourCommission: ownCommission.value,
        presetCommission: presetCommission.value,
        isPriority: ["1", "true", "yes", "y", "重点", "是"].includes((mapped.isPriority || "").toLowerCase()),
        gmvMonthlyTarget: gmvTarget,
        completionReward: mapped.completionReward
      }),
      errors: rowErrors,
      status: "pending",
      saveError: ""
    };
  });

  const seenNames = new Map<string, MonthlyNewMerchantImportRow>();
  const seenIds = new Map<string, MonthlyNewMerchantImportRow>();
  rows.forEach((row) => {
    const nameKey = row.payload.merchantName.toLowerCase();
    if (nameKey) {
      const previous = seenNames.get(nameKey);
      if (previous) {
        row.errors.push("Duplicate brand in this import.");
        previous.errors.push("Duplicate brand in this import.");
      } else {
        seenNames.set(nameKey, row);
      }
    }
    const idKey = row.payload.merchantId;
    if (idKey) {
      const previous = seenIds.get(idKey);
      if (previous) {
        row.errors.push("Duplicate Merchant ID in this import.");
        previous.errors.push("Duplicate Merchant ID in this import.");
      } else {
        seenIds.set(idKey, row);
      }
    }
  });
  return { headers, recognizedHeaders, rows, errors };
}

export function monthlyNewMerchantTemplateCsv(): string {
  return "\uFEFFBrand,Merchant ID,Program,Platform,GMV need to be reach,Past Month Purchase,Independent Websites,Reviews Numbers,Our Commission,Preset Commission,BD,Priority,Completion Reward\r\n";
}
