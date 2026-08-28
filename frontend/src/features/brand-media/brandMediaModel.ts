import { toFiniteNumber } from "../../shared/format/number";

export interface BrandMediaDateRange {
  readonly startDate: string;
  readonly endDate: string;
  readonly dayCount?: number;
}

export interface BrandMediaPoint {
  readonly date: string;
  readonly revenue: number;
  readonly orders: number;
  readonly clicks: number;
}

export interface BrandMediaClickPoint {
  readonly date: string;
  readonly clicks: number;
}

export interface BrandMediaPublisher {
  readonly userId: string | number;
  readonly userName: string;
  readonly adminName: string;
  readonly totalRevenue: number;
  readonly totalOrders: number;
  readonly totalClicks: number;
  readonly activeDays: number;
  readonly firstActiveDate: string;
  readonly lastActiveDate: string;
  readonly points: readonly BrandMediaPoint[];
  readonly clickPoints: readonly BrandMediaClickPoint[];
  readonly sourceIndex?: number;
  readonly publisherKey?: string;
}

export interface BrandMediaPublisherView extends BrandMediaPublisher {
  readonly sourceIndex: number;
  readonly publisherKey: string;
}

export interface BrandMediaSummary {
  readonly activePublisherCount: number;
  readonly totalRevenue: number;
  readonly totalOrders: number;
  readonly totalClicks: number;
  readonly activeDayCount: number;
  readonly observationCount: number;
  readonly clickActiveDayCount: number;
  readonly clickObservationCount: number;
}

export interface BrandMediaPayload {
  readonly ok?: boolean;
  readonly merchant: {
    readonly merchantId: string | number;
    readonly merchantName: string;
  };
  readonly dateRange: BrandMediaDateRange;
  readonly summary: BrandMediaSummary;
  readonly publishers: readonly BrandMediaPublisher[];
}

export interface BrandMediaCatalogOption {
  readonly merchantId: string;
  readonly name: string;
  readonly count: number;
}

export interface BrandMediaChartModel {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly plotWidth: number;
  readonly plotHeight: number;
  readonly startDate: string;
  readonly endDate: string;
  readonly startOrdinal: number;
  readonly endOrdinal: number;
  readonly daySpan: number;
  readonly publishers: readonly BrandMediaPublisherView[];
  readonly primaryMetric: "orders";
  readonly minOrders: number;
  readonly maxOrders: number;
  readonly dailyOrderTotals: Readonly<Record<string, number>>;
  readonly dailyRevenueTotals: Readonly<Record<string, number>>;
  readonly allDailyOrderTotals: Readonly<Record<string, number>>;
  readonly allDailyRevenueTotals: Readonly<Record<string, number>>;
  readonly showAllOrderLine: boolean;
  readonly publisherPointsByIndex: Readonly<Record<number, Readonly<Record<string, BrandMediaPoint>>>>;
  readonly publisherByIndex: Readonly<Record<number, BrandMediaPublisherView>>;
  readonly xFor: (date: string) => number;
  readonly yFor: (value: number) => number;
  readonly dateForOffset: (offset: number) => string;
}

export interface BrandMediaClickChartModel {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  readonly startDate: string;
  readonly endDate: string;
  readonly startOrdinal: number;
  readonly endOrdinal: number;
  readonly daySpan: number;
  readonly yMax: number;
  readonly publishers: readonly BrandMediaPublisherView[];
  readonly dailyTotals: Readonly<Record<string, number>>;
  readonly clickPointsByIndex: Readonly<Record<number, Readonly<Record<string, number>>>>;
  readonly publisherByIndex: Readonly<Record<number, BrandMediaPublisherView>>;
  readonly isCumulative: boolean;
  readonly hasData: boolean;
}

type RawRecord = Readonly<Record<string, unknown>>;

const BRAND_MEDIA_COLOR_GOLDEN_ANGLE = 137.508;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function validDateKey(value: unknown): string {
  const key = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return "";
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const day = Number(key.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return "";
  return key;
}

function rawArray(value: unknown): readonly RawRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is RawRecord => isRecord(item))
    : [];
}

function normalizePoint(value: unknown): BrandMediaPoint | null {
  if (!isRecord(value)) return null;
  const date = validDateKey(value.date);
  if (!date) return null;
  return {
    date,
    revenue: toFiniteNumber(value.revenue),
    orders: Math.max(0, toFiniteNumber(value.orders)),
    clicks: Math.max(0, toFiniteNumber(value.clicks))
  };
}

function normalizeClickPoint(value: unknown): BrandMediaClickPoint | null {
  if (!isRecord(value)) return null;
  const date = validDateKey(value.date);
  if (!date) return null;
  return { date, clicks: Math.max(0, toFiniteNumber(value.clicks)) };
}

function normalizePublisher(value: unknown): BrandMediaPublisher | null {
  if (!isRecord(value)) return null;
  const userId = text(value.userId);
  if (!userId) return null;
  const points = rawArray(value.points)
    .map(normalizePoint)
    .filter((point): point is BrandMediaPoint => point !== null)
    .sort((left, right) => left.date.localeCompare(right.date));
  const clickPoints = rawArray(value.clickPoints)
    .map(normalizeClickPoint)
    .filter((point): point is BrandMediaClickPoint => point !== null)
    .sort((left, right) => left.date.localeCompare(right.date));
  return {
    userId,
    userName: text(value.userName, userId),
    adminName: text(value.adminName, "Unknown"),
    totalRevenue: toFiniteNumber(value.totalRevenue),
    totalOrders: Math.max(0, toFiniteNumber(value.totalOrders)),
    totalClicks: Math.max(0, toFiniteNumber(value.totalClicks)),
    activeDays: Math.max(0, toFiniteNumber(value.activeDays, points.length)),
    firstActiveDate: validDateKey(value.firstActiveDate) || points[0]?.date || "",
    lastActiveDate: validDateKey(value.lastActiveDate) || points.at(-1)?.date || "",
    points,
    clickPoints
  };
}

function normalizedSummary(value: unknown, publishers: readonly BrandMediaPublisher[]): BrandMediaSummary {
  const source = isRecord(value) ? value : {};
  const dates = publishers.flatMap((publisher) => publisher.points.map((point) => point.date));
  const clickDates = publishers.flatMap((publisher) => publisher.clickPoints.map((point) => point.date));
  return {
    activePublisherCount: Math.max(0, toFiniteNumber(source.activePublisherCount, publishers.length)),
    totalRevenue: toFiniteNumber(source.totalRevenue, publishers.reduce((total, publisher) => total + publisher.totalRevenue, 0)),
    totalOrders: Math.max(0, toFiniteNumber(source.totalOrders, publishers.reduce((total, publisher) => total + publisher.totalOrders, 0))),
    totalClicks: Math.max(0, toFiniteNumber(source.totalClicks, publishers.reduce((total, publisher) => total + publisher.totalClicks, 0))),
    activeDayCount: Math.max(0, toFiniteNumber(source.activeDayCount, new Set(dates).size)),
    observationCount: Math.max(0, toFiniteNumber(source.observationCount, dates.length)),
    clickActiveDayCount: Math.max(0, toFiniteNumber(source.clickActiveDayCount, new Set(clickDates).size)),
    clickObservationCount: Math.max(0, toFiniteNumber(source.clickObservationCount, publishers.reduce((total, publisher) => total + publisher.clickPoints.length, 0)))
  };
}

export function brandMediaDateKey(value: unknown): string {
  return validDateKey(value);
}

export function brandMediaDayOrdinal(value: unknown): number {
  const key = brandMediaDateKey(value);
  if (!key) return Number.NaN;
  return Date.UTC(
    Number(key.slice(0, 4)),
    Number(key.slice(5, 7)) - 1,
    Number(key.slice(8, 10))
  ) / 86_400_000;
}

export function brandMediaDateAtOrdinal(ordinal: number): string {
  return Number.isFinite(ordinal)
    ? new Date(ordinal * 86_400_000).toISOString().slice(0, 10)
    : "";
}

export function brandMediaLineSegments<T extends { readonly date?: unknown }>(points: readonly T[]): Array<Array<T & { readonly date: string }>> {
  const sorted = points
    .map((point) => {
      const date = brandMediaDateKey(point.date);
      return date ? { ...point, date } : null;
    })
    .filter((point): point is T & { readonly date: string } => point !== null)
    .sort((left, right) => left.date.localeCompare(right.date));
  const segments: Array<Array<T & { readonly date: string }>> = [];
  let current: Array<T & { readonly date: string }> = [];
  for (const point of sorted) {
    const previous = current.at(-1);
    const isNextDay = previous !== undefined
      && brandMediaDayOrdinal(point.date) - brandMediaDayOrdinal(previous.date) === 1;
    if (previous === undefined || isNextDay) {
      current.push(point);
      continue;
    }
    if (current.length) segments.push(current);
    current = [point];
  }
  if (current.length) segments.push(current);
  return segments;
}

export function brandMediaColor(index: number): string {
  const hue = Math.round((Number(index || 0) * BRAND_MEDIA_COLOR_GOLDEN_ANGLE) % 360);
  return `hsl(${hue} 72% 48%)`;
}

export function brandMediaPublisherKey(publisher: Pick<BrandMediaPublisher, "userId" | "userName">, index: number): string {
  const userId = text(publisher.userId);
  if (userId) return `id:${userId}`;
  return `name:${text(publisher.userName).toLowerCase()}|${index}`;
}

function sourceIndex(publisher: BrandMediaPublisher, fallback: number): number {
  return Number.isFinite(publisher.sourceIndex) ? Number(publisher.sourceIndex) : fallback;
}

function viewPublisher(publisher: BrandMediaPublisher, index: number): BrandMediaPublisherView {
  const indexValue = sourceIndex(publisher, index);
  return {
    ...publisher,
    sourceIndex: indexValue,
    publisherKey: publisher.publisherKey || brandMediaPublisherKey(publisher, indexValue)
  };
}

function publisherViews(publishers: readonly BrandMediaPublisher[]): BrandMediaPublisherView[] {
  return publishers.map(viewPublisher);
}

export function brandMediaCatalogOptions(data: unknown): BrandMediaCatalogOption[] {
  if (!isRecord(data)) return [];
  const nameMap = isRecord(data.merchantNameMap) ? data.merchantNameMap : {};
  const counts = new Map<string, number>();
  for (const publisher of rawArray(data.publishers)) {
    const merchantIds = Array.isArray(publisher.merchantIds) ? publisher.merchantIds : [];
    for (const value of merchantIds) {
      const merchantId = text(value);
      if (merchantId) counts.set(merchantId, (counts.get(merchantId) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([merchantId, count]) => ({
      merchantId,
      name: text(nameMap[merchantId], merchantId),
      count
    }))
    .sort((left, right) => right.count - left.count
      || left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
      || left.merchantId.localeCompare(right.merchantId, undefined, { numeric: true }));
}

export function normalizeBrandMediaPayload(value: unknown, fallbackRange?: BrandMediaDateRange): BrandMediaPayload | null {
  if (!isRecord(value)) return null;
  const merchant = isRecord(value.merchant) ? value.merchant : {};
  const publishers = rawArray(value.publishers)
    .map(normalizePublisher)
    .filter((publisher): publisher is BrandMediaPublisher => publisher !== null);
  const rawRange = isRecord(value.dateRange) ? value.dateRange : {};
  const startDate = brandMediaDateKey(rawRange.startDate) || fallbackRange?.startDate || "";
  const endDate = brandMediaDateKey(rawRange.endDate) || fallbackRange?.endDate || "";
  if (!startDate || !endDate || brandMediaDayOrdinal(endDate) < brandMediaDayOrdinal(startDate)) return null;
  return {
    ok: typeof value.ok === "boolean" ? value.ok : undefined,
    merchant: {
      merchantId: text(merchant.merchantId, text(value.merchantId)),
      merchantName: text(merchant.merchantName, text(value.merchantName, text(merchant.merchantId)))
    },
    dateRange: {
      startDate,
      endDate,
      dayCount: Math.round(brandMediaDayOrdinal(endDate) - brandMediaDayOrdinal(startDate)) + 1
    },
    summary: normalizedSummary(value.summary, publishers),
    publishers
  };
}

export function brandMediaManagerOptions(payload: BrandMediaPayload | null): string[] {
  if (!payload) return [];
  return [...new Set(payload.publishers.map((publisher) => publisher.adminName || "Unknown"))]
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

export function filterBrandMediaPublishers(
  payload: BrandMediaPayload | null,
  manager = ""
): BrandMediaPublisherView[] {
  if (!payload) return [];
  const normalizedManager = manager.trim().toLowerCase();
  return payload.publishers
    .map(viewPublisher)
    .filter((publisher) => !normalizedManager || publisher.adminName.toLowerCase() === normalizedManager);
}

export function visibleBrandMediaPublishers(
  payload: BrandMediaPayload | null,
  manager = "",
  lockedKeys: readonly string[] = []
): BrandMediaPublisherView[] {
  const publishers = filterBrandMediaPublishers(payload, manager);
  const locks = new Set(lockedKeys.map((key) => key.trim()).filter(Boolean));
  return locks.size ? publishers.filter((publisher) => locks.has(publisher.publisherKey)) : publishers;
}

export function summarizeBrandMediaView(
  payload: BrandMediaPayload | null,
  publishers: readonly BrandMediaPublisher[],
  _lockedKeys: readonly string[] = [],
  _manager = ""
): BrandMediaSummary {
  if (!payload) return normalizedSummary(null, publishers);
  const dates = publishers.flatMap((publisher) => publisher.points.map((point) => point.date));
  const clickDates = publishers.flatMap((publisher) => publisher.clickPoints.map((point) => point.date));
  return {
    activePublisherCount: publishers.length,
    totalRevenue: publishers.reduce((total, publisher) => total + publisher.totalRevenue, 0),
    totalOrders: publishers.reduce((total, publisher) => total + publisher.totalOrders, 0),
    totalClicks: publishers.reduce((total, publisher) => total + publisher.totalClicks, 0),
    activeDayCount: new Set(dates).size,
    observationCount: dates.length,
    clickActiveDayCount: new Set(clickDates).size,
    clickObservationCount: publishers.reduce((total, publisher) => total + publisher.clickPoints.length, 0)
  };
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCountValue(value: number): string {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatMoneyValue(value: number): string {
  return `$${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function buildAxisTicks(daySpan: number): number[] {
  const offsets: number[] = [];
  for (let index = 0; index <= 4; index += 1) {
    const offset = Math.round(daySpan * index / 4);
    if (!offsets.includes(offset)) offsets.push(offset);
  }
  return offsets;
}

function pathForSegment(
  segment: readonly BrandMediaPoint[],
  xFor: (date: string) => number,
  yFor: (value: number) => number
): string {
  return segment.map((point, index) => `${index ? "L" : "M"}${xFor(point.date).toFixed(2)} ${yFor(point.orders).toFixed(2)}`).join(" ");
}

export function buildBrandMediaChartModel(
  payload: BrandMediaPayload,
  publishersInput: readonly BrandMediaPublisher[],
  options: {
    readonly allPublishers?: readonly BrandMediaPublisher[];
    readonly lockedKeys?: readonly string[];
  } = {}
): BrandMediaChartModel | null {
  const publishers = publisherViews(publishersInput);
  const allPublishers = publisherViews(options.allPublishers || payload.publishers);
  const startDate = brandMediaDateKey(payload.dateRange.startDate);
  const endDate = brandMediaDateKey(payload.dateRange.endDate);
  const startOrdinal = brandMediaDayOrdinal(startDate);
  const endOrdinal = brandMediaDayOrdinal(endDate);
  if (!publishers.length || !Number.isFinite(startOrdinal) || !Number.isFinite(endOrdinal) || endOrdinal < startOrdinal) return null;

  const daySpan = endOrdinal - startOrdinal;
  const dailyOrderTotals: Record<string, number> = {};
  const dailyRevenueTotals: Record<string, number> = {};
  const allDailyOrderTotals: Record<string, number> = {};
  const allDailyRevenueTotals: Record<string, number> = {};
  const publisherPointsByIndex: Record<number, Readonly<Record<string, BrandMediaPoint>>> = {};
  const publisherByIndex: Record<number, BrandMediaPublisherView> = {};
  const segmentMap: Array<Array<Array<BrandMediaPoint>>> = [];
  let maxOrders = 0;

  for (const publisher of publishers) {
    const points = publisher.points.filter((point) => {
      const ordinal = brandMediaDayOrdinal(point.date);
      return Number.isFinite(ordinal) && ordinal >= startOrdinal && ordinal <= endOrdinal;
    });
    const pointsByDate: Record<string, BrandMediaPoint> = {};
    for (const point of points) {
      pointsByDate[point.date] = point;
      dailyOrderTotals[point.date] = (dailyOrderTotals[point.date] || 0) + point.orders;
      dailyRevenueTotals[point.date] = (dailyRevenueTotals[point.date] || 0) + point.revenue;
      maxOrders = Math.max(maxOrders, point.orders);
    }
    publisherPointsByIndex[publisher.sourceIndex] = pointsByDate;
    publisherByIndex[publisher.sourceIndex] = publisher;
    segmentMap.push(brandMediaLineSegments(points).map((segment) => segment as BrandMediaPoint[]));
  }

  for (const publisher of allPublishers) {
    for (const point of publisher.points) {
      const ordinal = brandMediaDayOrdinal(point.date);
      if (!Number.isFinite(ordinal) || ordinal < startOrdinal || ordinal > endOrdinal) continue;
      allDailyOrderTotals[point.date] = (allDailyOrderTotals[point.date] || 0) + point.orders;
      allDailyRevenueTotals[point.date] = (allDailyRevenueTotals[point.date] || 0) + point.revenue;
    }
  }

  const locks = new Set((options.lockedKeys || []).map((key) => key.trim()).filter(Boolean));
  const showAllOrderLine = locks.size === 0 && publishers.length === allPublishers.length;
  if (showAllOrderLine) {
    maxOrders = Math.max(maxOrders, ...Object.values(allDailyOrderTotals));
  }
  if (maxOrders <= 0) maxOrders = 1;

  const width = 1180;
  const height = 560;
  const left = 82;
  const right = 28;
  const top = 34;
  const bottom = 62;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const xFor = (date: string): number => {
    const ordinal = brandMediaDayOrdinal(date);
    const day = Number.isFinite(ordinal) ? ordinal - startOrdinal : 0;
    return left + Math.max(0, Math.min(daySpan, day)) / Math.max(1, daySpan) * plotWidth;
  };
  const yFor = (value: number): number => top + plotHeight - Math.max(0, Number(value || 0)) / maxOrders * plotHeight;
  const svg: string[] = [`<svg class="brand-media-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true" data-brand-media-day-span="${daySpan}">`];
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = Math.round(maxOrders * tick / 4);
    const y = yFor(value);
    svg.push(`<line class="brand-media-grid-line" x1="${left}" x2="${width - right}" y1="${y}" y2="${y}"></line>`);
    svg.push(`<text class="brand-media-axis-label" x="${left - 12}" y="${y + 4}" text-anchor="end">${escapeHtml(formatCountValue(value))}</text>`);
  }
  for (const offset of buildAxisTicks(daySpan)) {
    const date = brandMediaDateAtOrdinal(startOrdinal + offset);
    const x = xFor(date);
    svg.push(`<line class="brand-media-x-tick" x1="${x}" x2="${x}" y1="${top + plotHeight}" y2="${top + plotHeight + 6}"></line>`);
    svg.push(`<text class="brand-media-axis-label brand-media-axis-date" x="${x}" y="${height - 22}" text-anchor="middle" data-brand-media-date="${date}">${escapeHtml(date.slice(5))}</text>`);
  }
  svg.push(`<rect class="brand-media-hit-area" x="${left}" y="${top}" width="${plotWidth}" height="${plotHeight}" tabindex="0" data-brand-media-hit-area="true" aria-label="Select a date"></rect>`);
  publishers.forEach((publisher, index) => {
    for (const segment of segmentMap[index] || []) {
      const path = pathForSegment(segment, xFor, yFor);
      if (path) svg.push(`<path class="brand-media-series" d="${path}" stroke="${brandMediaColor(publisher.sourceIndex)}" data-brand-media-publisher-index="${publisher.sourceIndex}"></path>`);
    }
  });
  if (showAllOrderLine) {
    const totalPoints = Object.keys(allDailyOrderTotals).sort().map((date) => ({ date, revenue: 0, orders: allDailyOrderTotals[date] || 0, clicks: 0 }));
    for (const segment of brandMediaLineSegments(totalPoints)) {
      const path = pathForSegment(segment, xFor, yFor);
      if (path) svg.push(`<path class="brand-media-total-series" d="${path}" data-brand-media-total="true" data-brand-media-total-metric="orders"></path>`);
    }
  }
  svg.push(`<line class="brand-media-crosshair brand-media-crosshair-date" x1="${left}" x2="${left}" y1="${top}" y2="${top + plotHeight}" style="display:none"></line>`);
  svg.push(`<line class="brand-media-crosshair brand-media-crosshair-value" x1="${left}" x2="${width - right}" y1="${top + plotHeight}" y2="${top + plotHeight}" style="display:none"></line>`);
  svg.push("</svg>");

  return {
    svg: svg.join(""),
    width,
    height,
    left,
    right,
    top,
    bottom,
    plotWidth,
    plotHeight,
    startDate,
    endDate,
    startOrdinal,
    endOrdinal,
    daySpan,
    publishers,
    primaryMetric: "orders",
    minOrders: 0,
    maxOrders,
    dailyOrderTotals,
    dailyRevenueTotals,
    allDailyOrderTotals,
    allDailyRevenueTotals,
    showAllOrderLine,
    publisherPointsByIndex,
    publisherByIndex,
    xFor,
    yFor,
    dateForOffset: (offset: number) => brandMediaDateAtOrdinal(startOrdinal + Math.max(0, Math.min(daySpan, offset)))
  };
}

export function buildBrandMediaClickChartModel(
  payload: BrandMediaPayload,
  publishersInput: readonly BrandMediaPublisher[]
): BrandMediaClickChartModel | null {
  const publishers = publisherViews(publishersInput);
  const startDate = brandMediaDateKey(payload.dateRange.startDate);
  const endDate = brandMediaDateKey(payload.dateRange.endDate);
  const startOrdinal = brandMediaDayOrdinal(startDate);
  const endOrdinal = brandMediaDayOrdinal(endDate);
  if (!publishers.length || !Number.isFinite(startOrdinal) || !Number.isFinite(endOrdinal) || endOrdinal < startOrdinal) return null;
  const daySpan = endOrdinal - startOrdinal;
  const dailyTotals: Record<string, number> = {};
  const clickPointsByIndex: Record<number, Readonly<Record<string, number>>> = {};
  const publisherByIndex: Record<number, BrandMediaPublisherView> = {};
  let maxClicks = 0;
  for (const publisher of publishers) {
    const source = publisher.clickPoints.length
      ? publisher.clickPoints
      : publisher.points.filter((point) => point.clicks > 0).map((point) => ({ date: point.date, clicks: point.clicks }));
    const points: Record<string, number> = {};
    for (const point of source) {
      const ordinal = brandMediaDayOrdinal(point.date);
      if (!Number.isFinite(ordinal) || ordinal < startOrdinal || ordinal > endOrdinal) continue;
      points[point.date] = (points[point.date] || 0) + point.clicks;
      dailyTotals[point.date] = (dailyTotals[point.date] || 0) + point.clicks;
      maxClicks = Math.max(maxClicks, dailyTotals[point.date] || 0);
    }
    clickPointsByIndex[publisher.sourceIndex] = points;
    publisherByIndex[publisher.sourceIndex] = publisher;
  }
  const width = 1180;
  const height = 440;
  const left = 82;
  const right = 28;
  const top = 34;
  const bottom = 62;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const yMax = maxClicks > 0 ? maxClicks : 1;
  const xFor = (date: string): number => {
    const ordinal = brandMediaDayOrdinal(date);
    const day = Number.isFinite(ordinal) ? ordinal - startOrdinal : 0;
    return daySpan <= 0 ? left + plotWidth / 2 : left + Math.max(0, Math.min(daySpan, day)) / daySpan * plotWidth;
  };
  const yFor = (value: number): number => top + plotHeight - Number(value || 0) / yMax * plotHeight;
  const cumulative = publishers.length > 1;
  const barWidth = Math.max(2, Math.min(34, plotWidth / Math.max(1, daySpan + 1) * 0.72));
  const svg: string[] = [`<svg class="brand-media-click-svg ${cumulative ? "is-cumulative" : "is-single"}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">`];
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = yMax * tick / 4;
    const y = yFor(value);
    svg.push(`<line class="brand-media-grid-line" x1="${left}" x2="${width - right}" y1="${y}" y2="${y}"></line>`);
    svg.push(`<text class="brand-media-axis-label" x="${left - 12}" y="${y + 4}" text-anchor="end">${escapeHtml(formatCountValue(value))}</text>`);
  }
  for (const offset of buildAxisTicks(daySpan)) {
    const date = brandMediaDateAtOrdinal(startOrdinal + offset);
    const x = xFor(date);
    svg.push(`<line class="brand-media-x-tick" x1="${x}" x2="${x}" y1="${top + plotHeight}" y2="${top + plotHeight + 6}"></line>`);
    svg.push(`<text class="brand-media-axis-label brand-media-axis-date" x="${x}" y="${height - 22}" text-anchor="middle" data-brand-media-date="${date}">${escapeHtml(date.slice(5))}</text>`);
  }
  for (const date of Object.keys(dailyTotals).sort()) {
    const x = xFor(date);
    let offset = 0;
    for (const publisher of publishers) {
      const value = clickPointsByIndex[publisher.sourceIndex]?.[date] || 0;
      if (!(value > 0)) continue;
      const yTop = yFor(offset + value);
      const yBottom = yFor(offset);
      const className = cumulative ? " is-cumulative" : " is-single";
      svg.push(`<rect class="brand-media-click-bar${className}" x="${(x - barWidth / 2).toFixed(2)}" y="${yTop.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${Math.max(0.75, yBottom - yTop).toFixed(2)}" fill="${brandMediaColor(publisher.sourceIndex)}" data-brand-media-click-date="${date}" data-brand-media-publisher-index="${publisher.sourceIndex}"><title>${escapeHtml(`${date} · ${publisher.userName}: ${formatCountValue(value)} clicks`)}</title></rect>`);
      offset += value;
    }
  }
  svg.push("</svg>");
  return {
    svg: svg.join(""),
    width,
    height,
    startDate,
    endDate,
    startOrdinal,
    endOrdinal,
    daySpan,
    yMax,
    publishers,
    dailyTotals,
    clickPointsByIndex,
    publisherByIndex,
    isCumulative: cumulative,
    hasData: maxClicks > 0
  };
}

export function formatBrandMediaCount(value: number): string {
  return formatCountValue(value);
}

export function formatBrandMediaMoney(value: number): string {
  return formatMoneyValue(value);
}

export function formatBrandMediaDate(value: unknown): string {
  return brandMediaDateKey(value) || "-";
}
