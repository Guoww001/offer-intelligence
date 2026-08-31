import { computed, ref } from "vue";

import {
  buildTargetRecords,
  dbMonthlyTrendRows,
  monthKeyFromText,
  monthLabelFromKey,
  preferredTargetMonth,
  targetRowsForMonth,
  targetSummary,
  targetTierSortRank,
  type BuildTargetRecordsOptions,
  type DbStatusPayload,
  type TargetMetricKey,
  type TargetRecord,
  type TargetReportData,
  type TargetTrendRow
} from "./targetModel";

export interface TargetStatusRequest {
  readonly monthKey: string;
  readonly signal: AbortSignal;
}

export type TargetStatusLoader = (request: TargetStatusRequest) => Promise<unknown>;
export type TargetTierSummaryLoader = (request: TargetStatusRequest) => Promise<unknown>;

export interface TargetStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

export interface UseTargetsOptions extends BuildTargetRecordsOptions {
  readonly reportData?: TargetReportData;
  readonly initialMonth?: string;
  readonly targetStorage?: TargetStorage;
  readonly loadStatus?: TargetStatusLoader;
  readonly loadTierSummary?: TargetTierSummaryLoader;
}

const TARGET_OVERRIDES_KEY = "offerTargetTextOverrides.v1";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function monthForValue(records: readonly TargetRecord[], value: string): string {
  const key = monthKeyFromText(value);
  return records.find((record) => record.monthKey === key || record.month === value)?.month || value;
}

function storedOverrides(storage: TargetStorage | undefined): Record<string, string> {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(TARGET_OVERRIDES_KEY) || "{}");
    if (!isRecord(parsed)) return {};
    return Object.entries(parsed).reduce<Record<string, string>>((result, [key, value]) => {
      if (typeof value === "string" && value.trim()) result[key] = value.trim();
      return result;
    }, {});
  } catch {
    return {};
  }
}

function applyOverrides(records: readonly TargetRecord[], overrides: Readonly<Record<string, string>>): TargetRecord[] {
  return records.map((record) => {
    const override = text(overrides[`${record.monthKey}::${record.tier}`]);
    return override ? { ...record, target: override } : record;
  });
}

function tierSummaryRecords(payload: unknown, monthKey: string): TargetRecord[] {
  if (!isRecord(payload) || !Array.isArray(payload.tiers)) return [];
  const rows = payload.tiers.filter(isRecord).map((row) => {
    const tier = text(row.tier);
    const clicks = Number(row.clicks) || 0;
    const orders = Number(row.orders) || 0;
    return {
      month: monthLabelFromKey(monthKey),
      monthKey,
      tier,
      brandCount: Number(row.brandCount) || 0,
      clicks,
      orders,
      revenue: Number(row.revenue) || 0,
      payout: row.payout == null ? null : Number(row.payout) || 0,
      conversionRate: row.conversionRate == null ? (clicks ? orders / clicks : 0) : Number(row.conversionRate) || 0,
      newEntries: Number(row.newEntries) || 0,
      exits: Number(row.tierExits) || 0,
      target: "",
      source: "database",
      databaseOnly: true,
      tierExitsAvailable: row.tierExits !== undefined && row.tierExits !== null,
      targetPlaceholderOnly: false,
      targetOverrideKey: `${monthKey}::${tier}`
    } satisfies TargetRecord;
  }).filter((row) => row.tier);
  const total = isRecord(payload.total) ? payload.total : null;
  if (total) {
    const clicks = Number(total.clicks) || 0;
    const orders = Number(total.orders) || 0;
    rows.push({
      month: monthLabelFromKey(monthKey),
      monthKey,
      tier: "Total",
      brandCount: Number(total.brandCount) || 0,
      clicks,
      orders,
      revenue: Number(total.revenue) || 0,
      payout: total.payout == null ? null : Number(total.payout) || 0,
      conversionRate: total.conversionRate == null ? (clicks ? orders / clicks : 0) : Number(total.conversionRate) || 0,
      newEntries: Number(total.newEntries) || 0,
      exits: Number(total.tierExits) || 0,
      target: "",
      source: "database",
      databaseOnly: true,
      tierExitsAvailable: total.tierExits !== undefined && total.tierExits !== null,
      targetPlaceholderOnly: false,
      targetOverrideKey: `${monthKey}::Total`
    });
  }
  return rows;
}

export function useTargets(options: UseTargetsOptions = {}) {
  const overrides = ref<Record<string, string>>(storedOverrides(options.targetStorage));
  const rawRecords = ref<TargetRecord[]>(buildTargetRecords(options.reportData || { sheets: [] }, {
    today: options.today,
    referenceMonthKey: options.referenceMonthKey,
    targetOverrides: overrides.value
  }));
  const records = computed(() => applyOverrides(rawRecords.value, overrides.value));
  const initialMonth = monthForValue(records.value, options.initialMonth?.trim() || preferredTargetMonth(records.value));
  const month = ref(initialMonth);
  const availableMonths = computed(() => Array.from(new Set(records.value.map((record) => record.month))).sort((left, right) => {
    const leftKey = monthKeyFromText(left);
    const rightKey = monthKeyFromText(right);
    return leftKey.localeCompare(rightKey);
  }));
  const compareMonth = ref("");
  const tier = ref("all");
  const metric = ref<TargetMetricKey>("revenue");
  const trendView = ref<"month" | "day">("month");
  const targetEditingKey = ref("");
  const statusData = ref<DbStatusPayload | null>(null);
  const statusLoading = ref(false);
  const statusError = ref("");
  const statusMonthKey = ref("");
  const tierSummaryData = ref<unknown>(null);
  const tierSummaryLoading = ref(false);
  const tierSummaryError = ref("");
  let statusSequence = 0;
  let tierSummarySequence = 0;
  let statusController: AbortController | null = null;
  let tierSummaryController: AbortController | null = null;

  function syncComparisonMonth(): void {
    if (compareMonth.value && compareMonth.value !== month.value) return;
    const index = availableMonths.value.indexOf(month.value);
    compareMonth.value = index > 0 ? availableMonths.value[index - 1] || "" : "";
  }
  syncComparisonMonth();

  const databaseRecords = computed(() => {
    const selectedKey = monthKeyFromText(month.value);
    const loaded = tierSummaryRecords(tierSummaryData.value, selectedKey);
    if (!loaded.length) return records.value;
    const targetByTier = new Map(
      records.value
        .filter((record) => record.monthKey === selectedKey)
        .map((record) => [record.tier.toLowerCase(), record.target] as const)
    );
    return applyOverrides([
      ...records.value.filter((record) => record.monthKey !== selectedKey),
      ...loaded.map((record) => ({
        ...record,
        target: targetByTier.get(record.tier.toLowerCase()) || record.target
      }))
    ], overrides.value).sort((left, right) => left.monthKey.localeCompare(right.monthKey) || targetTierSortRank(left.tier) - targetTierSortRank(right.tier));
  });

  const filteredRecords = computed(() => targetRowsForMonth(databaseRecords.value, month.value, tier.value));
  const comparisonRecords = computed(() => compareMonth.value
    ? targetRowsForMonth(databaseRecords.value, compareMonth.value, tier.value)
    : []);
  const summary = computed(() => targetSummary(filteredRecords.value));
  const tierOptions = computed(() => Array.from(new Set(records.value
    .map((record) => record.tier)
    .filter((value) => value.toLowerCase() !== "total")))
    .sort((left, right) => targetTierSortRank(left) - targetTierSortRank(right)));
  const monthlyTrendRows = computed<TargetTrendRow[]>(() => {
    const databaseRows = tier.value === "all" ? dbMonthlyTrendRows(statusData.value, metric.value) : [];
    return (databaseRows.length && !statusError.value
      ? databaseRows
      : []) as TargetTrendRow[];
  });

  function setMonth(value: string): void {
    const next = monthForValue(records.value, value.trim());
    if (!next || next === month.value) return;
    month.value = next;
    syncComparisonMonth();
    statusData.value = null;
    statusError.value = "";
    statusMonthKey.value = "";
    tierSummaryData.value = null;
    tierSummaryError.value = "";
  }

  function setCompareMonth(value: string): void {
    compareMonth.value = value === month.value ? "" : value;
  }

  function setTier(value: string): void {
    tier.value = value === "all" ? "all" : tierOptions.value.includes(value) ? value : "all";
  }

  function setMetric(value: TargetMetricKey): void {
    metric.value = ["revenue", "orders", "clicks", "conversion", "brands"].includes(value) ? value : "revenue";
  }

  function setTrendView(value: "month" | "day"): void {
    trendView.value = value === "day" ? "day" : "month";
  }

  function setTarget(key: string, value: string): void {
    const clean = text(value);
    if (clean) overrides.value = { ...overrides.value, [key]: clean };
    else {
      const next = { ...overrides.value };
      delete next[key];
      overrides.value = next;
    }
    options.targetStorage?.setItem(TARGET_OVERRIDES_KEY, JSON.stringify(overrides.value));
    targetEditingKey.value = "";
  }

  function cancelTargetEdit(): void {
    targetEditingKey.value = "";
  }

  async function loadStatusForMonth(nextMonthKey = monthKeyFromText(month.value)): Promise<boolean> {
    if (!options.loadStatus || !nextMonthKey) return false;
    const sequence = ++statusSequence;
    statusController?.abort();
    const controller = new AbortController();
    statusController = controller;
    statusLoading.value = true;
    statusError.value = "";
    statusMonthKey.value = nextMonthKey;
    try {
      const payload = await options.loadStatus({ monthKey: nextMonthKey, signal: controller.signal });
      if (sequence !== statusSequence || nextMonthKey !== monthKeyFromText(month.value)) return false;
      if (!isRecord(payload)) throw new Error("targets.invalidStatusPayload");
      statusData.value = payload as DbStatusPayload;
      return true;
    } catch (error) {
      if (sequence !== statusSequence || nextMonthKey !== monthKeyFromText(month.value)) return false;
      if (error instanceof Error && error.name === "AbortError") return false;
      statusData.value = null;
      statusError.value = error instanceof Error ? error.message : String(error || "targets.statusUnavailable");
      return false;
    } finally {
      if (sequence === statusSequence) {
        statusLoading.value = false;
        statusController = null;
      }
    }
  }

  async function loadTierSummaryForMonth(nextMonthKey = monthKeyFromText(month.value)): Promise<boolean> {
    if (!options.loadTierSummary || !nextMonthKey) return false;
    const sequence = ++tierSummarySequence;
    tierSummaryController?.abort();
    const controller = new AbortController();
    tierSummaryController = controller;
    tierSummaryLoading.value = true;
    tierSummaryError.value = "";
    try {
      const payload = await options.loadTierSummary({ monthKey: nextMonthKey, signal: controller.signal });
      if (sequence !== tierSummarySequence || nextMonthKey !== monthKeyFromText(month.value)) return false;
      if (!isRecord(payload)) throw new Error("targets.invalidTierSummaryPayload");
      tierSummaryData.value = payload;
      return true;
    } catch (error) {
      if (sequence !== tierSummarySequence || nextMonthKey !== monthKeyFromText(month.value)) return false;
      tierSummaryData.value = null;
      tierSummaryError.value = error instanceof Error ? error.message : String(error || "targets.tierSummaryUnavailable");
      return false;
    } finally {
      if (sequence === tierSummarySequence) {
        tierSummaryLoading.value = false;
        tierSummaryController = null;
      }
    }
  }

  function unmount(): void {
    statusSequence += 1;
    tierSummarySequence += 1;
    statusController?.abort();
    tierSummaryController?.abort();
    statusController = null;
    tierSummaryController = null;
    statusLoading.value = false;
    tierSummaryLoading.value = false;
  }

  return {
    records,
    targetOverrides: overrides,
    databaseRecords,
    month,
    compareMonth,
    tier,
    metric,
    trendView,
    targetEditingKey,
    availableMonths,
    tierOptions,
    filteredRecords,
    comparisonRecords,
    summary,
    statusData,
    statusLoading,
    statusError,
    statusMonthKey,
    tierSummaryData,
    tierSummaryLoading,
    tierSummaryError,
    monthlyTrendRows,
    setMonth,
    setCompareMonth,
    setTier,
    setMetric,
    setTrendView,
    setTarget,
    cancelTargetEdit,
    loadStatusForMonth,
    loadTierSummaryForMonth,
    unmount
  };
}
