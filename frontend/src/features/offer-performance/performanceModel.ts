export const METRICS = [
  "revenue",
  "clicks",
  "dpv",
  "atc",
  "orders",
  "commission",
] as const;
export type Metric = (typeof METRICS)[number];
export type Metrics = Record<Metric, number | null>;
export interface TrackedOffer {
  merchantId: string;
  merchantName: string;
  category: string;
  asins: string[];
  commissionRate?: number | null;
  referenceAov?: number | null;
  notes?: string;
}
export interface PromotionBatch {
  id: string;
  name: string;
  sourceFile: string;
  launchDate: string;
  observationStart?: string;
  observationEnd?: string;
  comparisonStart?: string;
  comparisonEnd?: string;
  offers: TrackedOffer[];
  local?: boolean;
  customized?: boolean;
}
export interface PerformanceRow {
  merchantId: string;
  before: Metrics;
  after: Metrics;
  daily: (Metrics & { date: string })[];
  monthly: (Metrics & { month: string })[];
}
export interface MediaRow {
  merchantId: string;
  publisherId: string;
  publisherName: string;
  before: Metrics;
  after: Metrics;
  linkType: "asin" | "product" | "storefront" | "unknown";
  asin: string;
  purchasedAsin: string;
}
export interface PerformanceReport {
  ok: boolean;
  availableThrough: string;
  generatedAt: string;
  clickSource: string;
  dateRange: {
    startDate: string;
    endDate: string;
    beforeStart: string;
    beforeEnd: string;
    days: number;
  };
  supported: Record<Metric, boolean>;
  merchants: PerformanceRow[];
  media?: MediaRow[];
  links?: MediaRow[];
}
export interface ReportRequest {
  periodMode?: "observation";
  action?: "relations";
  batchId: string;
  merchantIds: string;
  launchDate: string;
  startDate?: string;
  endDate?: string;
  beforeStart?: string;
  beforeEnd?: string;
  merchantId?: string;
}
export interface PromotionWindow {
  startDate: string;
  endDate: string;
  beforeStart: string;
  beforeEnd: string;
  days: number;
}
export interface TrackedOfferParseDiagnostics {
  totalRows: number;
  invalidIdRows: number;
  duplicateRows: number;
  missingNameRows: number;
  sheetsWithMerchantHeader: number;
}
export interface ParsedTrackedOffers {
  offers: TrackedOffer[];
  diagnostics: TrackedOfferParseDiagnostics;
}
export const emptyMetrics = (): Metrics => ({
  revenue: null,
  clicks: null,
  dpv: null,
  atc: null,
  orders: null,
  commission: null,
});
export function addDays(date: string, days: number): string {
  const value = new Date(date + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return Number.isFinite(value.getTime())
    ? value.toISOString().slice(0, 10)
    : "";
}
export function windowDates(launch: string, start?: string, end?: string, beforeStart?: string, beforeEnd?: string): PromotionWindow | null {
  if (Boolean(start) !== Boolean(end) || Boolean(beforeStart) !== Boolean(beforeEnd)) return null;
  const valid = (v: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(v) && addDays(v, 0) === v;
  const from = start || launch,
    to = end || addDays(from, 6);
  if (!valid(launch) || !valid(from) || !valid(to) || from < launch) return null;
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  if (days < 1 || days > 92) return null;
  const previousStart = beforeStart || addDays(launch, -days);
  const previousEnd = beforeEnd || addDays(launch, -1);
  if (!valid(previousStart) || !valid(previousEnd) || previousEnd >= launch || periodDays(previousStart, previousEnd) < 1 || periodDays(previousStart, previousEnd) > 366) return null;
  return {
    startDate: from,
    endDate: to,
    beforeStart: previousStart,
    beforeEnd: previousEnd,
    days,
  };
}
export function observationWindow(batch: PromotionBatch) {
  const observation = (
    (batch.observationStart &&
      batch.observationEnd &&
      windowDates(
        batch.launchDate,
        batch.observationStart,
        batch.observationEnd,
      )) ||
    windowDates(batch.launchDate)
  );
  if (!observation) return null;
  return windowDates(batch.launchDate, observation.startDate, observation.endDate, batch.comparisonStart, batch.comparisonEnd) || observation;
}
export function periodDays(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
}
export function dailyAverage(value: number | null, days: number): number | null {
  return value === null || days <= 0 ? null : value / days;
}

export function dailyObservation(rows: PerformanceRow[], window: PromotionWindow, availableThrough: string, metric: Metric, supported: boolean) {
  const valueAt = (date: string) => {
    if (!supported || !rows.length || !availableThrough || date > availableThrough) return null;
    const values = rows.map(row => {
      const daily = row.daily.find(day => day.date === date);
      if (daily) return daily[metric];
      return row.after[metric] === null ? null : 0;
    });
    return values.some(value => value === null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  };
  return Array.from({ length: window.days }, (_, index) => {
      const date = addDays(window.startDate, index);
      return { date, value: valueAt(date) };
    });
}
export function observedDays(
  start: string,
  end: string,
  availableThrough: string,
): number {
  if (!availableThrough || availableThrough < start) return 0;
  return (
    Math.round(
      (Date.parse(end < availableThrough ? end : availableThrough) -
        Date.parse(start)) /
        86400000,
    ) + 1
  );
}
export function sumMetrics(rows: readonly Metrics[]): Metrics {
  const result = emptyMetrics();
  for (const key of METRICS) {
    const values = rows.map((row) => row[key]);
    if (
      values.length &&
      values.every((value) => value !== null && Number.isFinite(value))
    )
      result[key] = values.reduce<number>(
        (sum, value) => sum + Number(value),
        0,
      );
  }
  return result;
}
export function change(
  before: number | null,
  after: number | null,
  complete = true,
): number | null {
  if (!complete || before === null || after === null || before <= 0)
    return null;
  return (after - before) / before;
}
export function monthlyBaseline(
  row: PerformanceRow | undefined,
  availableThrough: string,
) {
  const months = (row?.monthly || []).filter(
    (m) =>
      addDays(m.month + "-01", 32).slice(0, 7) + "-01" <=
      addDays(availableThrough, 1),
  );
  const revenue = months
    .map((m) => m.revenue)
    .filter((n): n is number => n !== null);
  return {
    months,
    average: revenue.length
      ? revenue.reduce((a, b) => a + b, 0) / revenue.length
      : null,
    peak: revenue.length ? Math.max(...revenue) : null,
  };
}
export function parseTrackedOffers(tables: unknown[][][]): ParsedTrackedOffers {
  const offers = new Map<string, TrackedOffer>();
  let totalRows = 0;
  let invalidIdRows = 0;
  let duplicateRows = 0;
  let sheetsWithMerchantHeader = 0;
  for (const table of tables) {
    const index = table.findIndex((row) =>
      row.some((cell) =>
        /^(merchant\s*id|商家\s*id)$/i.test(String(cell).trim()),
      ),
    );
    if (index < 0) continue;
    sheetsWithMerchantHeader += 1;
    const headers = table[index]!.map((cell) =>
      String(cell).trim().toLowerCase(),
    );
    const idIndex = headers.findIndex((h) =>
      /^(merchant\s*id|商家\s*id)$/.test(h),
    );
    for (const row of table.slice(index + 1)) {
      if (row.some((cell) => String(cell ?? "").trim())) totalRows += 1;
      const id = String(row[idIndex] ?? "").trim();
      if (!/^[1-9]\d{0,12}$/.test(id)) {
        if (row.some((cell) => String(cell ?? "").trim())) invalidIdRows += 1;
        continue;
      }
      if (offers.has(id)) duplicateRows += 1;
      const field = (pattern: RegExp) =>
        String(row[headers.findIndex((h) => pattern.test(h))] ?? "").trim();
      const item = offers.get(id) || {
        merchantId: id,
        merchantName: "",
        category: "",
        asins: [],
      };
      item.merchantName =
        field(/^(merchant\s*name|商家名(?:称)?)$/) || item.merchantName;
      item.category = field(/^(category|品类)$/) || item.category;
      item.notes = field(/^(推荐信息|notes)$/) || item.notes;
      const asins =
        (field(/asin/) + " " + (item.notes || ""))
          .toUpperCase()
          .match(/\bB[A-Z0-9]{9}\b/g) || [];
      item.asins = [...new Set([...item.asins, ...asins])];
      offers.set(id, item);
    }
  }
  const parsedOffers = [...offers.values()];
  return {
    offers: parsedOffers,
    diagnostics: {
      totalRows,
      invalidIdRows,
      duplicateRows,
      missingNameRows: parsedOffers.filter((offer) => !offer.merchantName).length,
      sheetsWithMerchantHeader,
    },
  };
}

export function parseBatch(
  tables: unknown[][][],
  sourceFile: string,
  launchDate: string,
): PromotionBatch {
  const { offers } = parseTrackedOffers(tables);
  if (!offers.length || offers.length > 200) throw new Error("IMPORT_IDS");
  if (offers.some((o) => !o.merchantName))
    throw new Error("IMPORT_NAMES");
  return {
    id: `local-${Date.now()}`,
    name: sourceFile.replace(/\.[^.]+$/, ""),
    sourceFile,
    launchDate,
    offers: [...offers.values()],
    local: true,
  };
}

export function upsertTrackedMerchant(
  offers: readonly TrackedOffer[],
  merchantId: string,
  merchantName: string,
) {
  const id = merchantId.trim(),
    name = merchantName.trim();
  if (!/^[1-9]\d{0,12}$/.test(id)) throw new Error("MERCHANT_ID");
  if (!name || name.length > 160) throw new Error("MERCHANT_NAME");
  const existing = offers.find((o) => o.merchantId === id);
  if (!existing && offers.length >= 200) throw new Error("IMPORT_IDS");
  return {
    added: !existing,
    offers: existing
      ? offers.map((o) =>
          o.merchantId === id ? { ...o, merchantName: name } : o,
        )
      : [
          ...offers,
          { merchantId: id, merchantName: name, category: "", asins: [] },
        ],
  };
}

export function restoreBatches(
  catalog: PromotionBatch[],
  raw: unknown,
): PromotionBatch[] {
  const saved: PromotionBatch[] = Array.isArray(raw)
    ? raw.filter(
        (b) =>
          b &&
          typeof b.id === "string" &&
          typeof b.name === "string" &&
          typeof b.sourceFile === "string" &&
          windowDates(b.launchDate) &&
          Array.isArray(b.offers) &&
          b.offers.length > 0 &&
          b.offers.length <= 200 &&
          b.offers.every(
            (o: TrackedOffer) =>
              o &&
              /^[1-9]\d{0,12}$/.test(o.merchantId) &&
              typeof o.merchantName === "string" &&
              o.merchantName.trim() &&
              typeof o.category === "string" &&
              Array.isArray(o.asins) &&
              o.asins.every((a) => typeof a === "string"),
          ),
      )
    : [];
  const items = new Map(
    catalog.map((b) => {
      const override = saved.find((s) => s.id === b.id);
      return [
        b.id,
        {
          ...b,
          launchDate: override?.launchDate || b.launchDate,
          ...(override?.observationStart &&
          override?.observationEnd &&
          windowDates(
            override.launchDate,
            override.observationStart,
            override.observationEnd,
          )
            ? {
                observationStart: override.observationStart,
                observationEnd: override.observationEnd,
                comparisonStart: override.comparisonStart,
                comparisonEnd: override.comparisonEnd,
              }
            : {}),
          ...(override?.customized
            ? { offers: override.offers, customized: true }
            : {}),
        },
      ];
    }),
  );
  for (const item of saved)
    if (item.local && !items.has(item.id)) items.set(item.id, item);
  return [...items.values()];
}
