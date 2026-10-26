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
  readonly site: string;
  readonly contractNumber: string;
  readonly notes: string;
  readonly contactName: string;
  readonly category: string;
  readonly onboardingDate: string;
  readonly sourceSection: string;
  readonly sourceFile: string;
  readonly merchantStatus: string;
  readonly sourceMerchantId: string;

  readonly gmvRequirement: string;
  readonly pastMonthPurchase: string;
  readonly independentWebsites: string;
  readonly reviewSummary: string;
  readonly ourCommission: number | null;
  readonly presetCommission: number | null;
  readonly isPriority: boolean;
  readonly gmvMonthlyTarget: number | null;
  readonly completionReward: string;
  readonly identityWarning: string;
  readonly tier1Eligible: boolean;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MonthlyNewMerchantPayload {
  readonly action: "upsert";
  readonly mergeOnly?: boolean;
  readonly recordId?: number;
  readonly reportMonth: string;
  readonly merchantId: string;
  readonly merchantName: string;
  readonly businessManager: string;
  readonly program: string;
  readonly platform: string;
  readonly site: string;
  readonly contractNumber: string;
  readonly notes: string;
  readonly contactName: string;
  readonly category: string;
  readonly onboardingDate: string;
  readonly sourceSection: string;
  readonly sourceFile: string;
  readonly merchantStatus: string;
  readonly sourceMerchantId: string;

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

export const IMPORT_HEADERS: Readonly<Record<string, string>> = {
  'brand name': "merchantName",
  '品牌名': "merchantName",
  '编号': "merchantId",
  '站点': "site",
  'site': "site",
  'country': "site",
  'contract': "contractNumber",
  'contract number': "contractNumber",
  'contractnumber': "contractNumber",
  '合同': "contractNumber",
  'target': "gmvRequirement",
  '备注': "notes",
  'notes': "notes",
  '对接人': "contactName",
  'contact': "contactName",
  'contactname': "contactName",
  '品类': "category",
  'category': "category",
  '日期': "onboardingDate",
  'date': "onboardingDate",
  'onboardingdate': "onboardingDate",
  '来源分类': "sourceSection",
  'sourcesection': "sourceSection",
  '来源文件': "sourceFile",
  'sourcefile': "sourceFile",
  '状态': "merchantStatus",
  'merchantstatus': "merchantStatus",
  'sourcemerchantid': "sourceMerchantId",
  'merchantname': "merchantName",
  'merchantid': "merchantId",
  'businessmanager': "businessManager",
  'program': "program",
  'platform': "platform",
  'gmvrequirement': "gmvRequirement",
  'pastmonthpurchase': "pastMonthPurchase",
  'independentwebsites': "independentWebsites",
  'reviewsummary': "reviewSummary",
  'ourcommission': "ourCommission",
  'presetcommission': "presetCommission",
  'ispriority': "isPriority",
  'gmvmonthlytarget': "gmvMonthlyTarget",
  'completionreward': "completionReward",
  brand: "merchantName",
  merchant: "merchantName",
  "merchant name": "merchantName",
  "品牌": "merchantName",
  "商家": "merchantName",
  "商家名称": "merchantName",
  "merchant id": "merchantId",
  id: "merchantId",
  "商家 id": "merchantId",
  "商家id": "merchantId",
  "program name": "program",
  "项目": "program",
  "计划": "program",
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
    site: text(source.site),
    contractNumber: text(source.contractNumber),
    notes: text(source.notes),
    contactName: text(source.contactName),
    category: text(source.category),
    onboardingDate: text(source.onboardingDate),
    sourceSection: text(source.sourceSection),
    sourceFile: text(source.sourceFile),
    merchantStatus: text(source.merchantStatus),
    sourceMerchantId: text(source.sourceMerchantId),

    gmvRequirement: text(source.gmvRequirement),
    pastMonthPurchase: text(source.pastMonthPurchase),
    independentWebsites: text(source.independentWebsites),
    reviewSummary: text(source.reviewSummary),
    ourCommission: parseMonthlyNewMerchantCommission(source.ourCommission).value,
    presetCommission: parseMonthlyNewMerchantCommission(source.presetCommission).value,
    isPriority: source.isPriority === true || source.isPriority === 1 || source.isPriority === "1" || source.isPriority === "true",
    gmvMonthlyTarget: parsedTarget !== null && Number.isFinite(parsedTarget) ? parsedTarget : null,
    completionReward: text(source.completionReward),
    identityWarning: text(source.identityWarning),
    tier1Eligible: source.tier1Eligible === true,
    createdBy: text(source.createdBy),
    updatedBy: text(source.updatedBy),
    createdAt: text(source.createdAt),
    updatedAt: text(source.updatedAt)
  };
  return normalized;
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
    record.completionReward,
    record.site,
    record.contractNumber,
    record.notes,
    record.contactName,
    record.category,
    record.onboardingDate,
    record.sourceSection,
    record.sourceFile,
    record.merchantStatus,
    record.sourceMerchantId,
    record.identityWarning
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
    ...(source.mergeOnly ? { mergeOnly: true } : {}),
    ...(recordId ? { recordId } : {}),
    reportMonth: text(source.reportMonth),
    merchantId: text(source.merchantId),
    merchantName: text(source.merchantName),
    businessManager: text(source.businessManager),
    program: text(source.program),
    platform: text(source.platform),
    site: text(source.site),
    contractNumber: text(source.contractNumber),
    notes: text(source.notes),
    contactName: text(source.contactName),
    category: text(source.category),
    onboardingDate: text(source.onboardingDate),
    sourceSection: text(source.sourceSection),
    sourceFile: text(source.sourceFile),
    merchantStatus: text(source.merchantStatus),
    sourceMerchantId: text(source.sourceMerchantId),

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
  const fields = merchantImportFields(sourceRows);
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
    // Raw multi-ID and not-yet-connected values are preserved by the registry.

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
        mergeOnly: true,
        site: mapped.site,
        contractNumber: mapped.contractNumber,
        notes: mapped.notes,
        contactName: mapped.contactName,
        category: mapped.category,
        onboardingDate: mapped.onboardingDate,
        sourceSection: mapped.sourceSection,
        sourceFile: mapped.sourceFile,
        merchantStatus: mapped.merchantStatus,
        sourceMerchantId: mapped.sourceMerchantId,

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

  // Only identical ID+brand rows are duplicates. Distinct IDs under one brand
  // remain separate accounts; conflicting names under one ID reach the server
  // as separate profiles and are explicitly marked for ID confirmation.
  const unique = new Map<string, MonthlyNewMerchantImportRow>();
  rows.forEach((row) => {
    const identity = `${row.payload.merchantId.trim()}::${row.payload.merchantName.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim()}`;
    const previous = unique.get(identity);
    if (!previous || row.errors.length || previous.errors.length) {
      unique.set(previous ? `${identity}::${row.rowNumber}` : identity, row);
      return;
    }
    const merged: Record<string, unknown> = { ...previous.payload };
    Object.entries(row.payload).forEach(([field, value]) => {
      if ((merged[field] === "" || merged[field] === null) && value !== "" && value !== null) merged[field] = value;
    });
    unique.set(identity, { ...previous, payload: buildMonthlyNewMerchantPayload(merged) });
  });
  const deduplicatedRows = [...unique.values()];
  return { headers, recognizedHeaders, rows: deduplicatedRows, errors };
}

export function monthlyNewMerchantTemplateCsv(): string {
  return "\uFEFFBrand,Merchant ID,Site,Contract,Platform,Target,Notes,BD,Contact,Category,Date,状态,来源分类,Program,Past Month Purchase,Independent Websites,Reviews Numbers,Our Commission,Preset Commission,Priority,Completion Reward\r\n";
}


export function combineMerchantWorkbookTables(tables: readonly (readonly unknown[][])[]): unknown[][] {
  const fields: string[] = [];
  const mappedTables = tables.map((table) => {
    const nonempty = table.filter((row) => row.some((cell) => text(cell)));
    const headers = merchantImportFields(nonempty);
    if (!headers.includes("merchantName")) return { headers: [], rows: [] };
    headers.forEach((field) => { if (field && !fields.includes(field)) fields.push(field); });
    return { headers, rows: nonempty.slice(1) };
  });
  return [fields, ...mappedTables.flatMap(({ headers, rows }) => rows.map((row) => fields.map((field) => {
    const index = headers.indexOf(field);
    return index < 0 ? "" : row[index] ?? "";
  })))];
}

function merchantImportFields(table: readonly (readonly unknown[])[]): string[] {
  return (table[0] || []).map((cell, index) => {
    const header = normalizeMonthlyNewMerchantImportHeader(cell);
    if (!header && index === 0 && table.slice(1).some((row) => text(row[0]))) return "merchantStatus";
    return IMPORT_HEADERS[header] || "";
  });
}
