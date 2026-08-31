import { computed, ref } from "vue";

import {
  buildMonthlyNewMerchantPayload,
  filterMonthlyNewMerchantRecords,
  monthlyNewMerchantImportRows,
  normalizeMonthlyNewMerchantRecord,
  type MonthlyNewMerchantImportResult,
  type MonthlyNewMerchantImportRow,
  type MonthlyNewMerchantOfferLookup,
  type MonthlyNewMerchantPayload,
  type MonthlyNewMerchantRecord
} from "./monthlyNewMerchantsModel";

export interface MonthlyNewMerchantLoadRequest {
  readonly month: string;
  readonly signal: AbortSignal;
}

export type MonthlyNewMerchantLoader = (request: MonthlyNewMerchantLoadRequest) => Promise<unknown>;
export type MonthlyNewMerchantSaver = (payload: MonthlyNewMerchantPayload) => Promise<unknown>;
export type MonthlyNewMerchantDeleter = (recordId: number) => Promise<unknown>;

export interface UseMonthlyNewMerchantsOptions {
  readonly initialMonth?: string;
  readonly records?: readonly unknown[];
  readonly offers?: readonly MonthlyNewMerchantOfferLookup[];
  readonly loadData?: MonthlyNewMerchantLoader;
  readonly saveData?: MonthlyNewMerchantSaver;
  readonly deleteData?: MonthlyNewMerchantDeleter;
  readonly today?: () => Date;
}

function currentMonth(today: () => Date = () => new Date()): string {
  const date = today();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function textError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (message) return String(message);
  }
  return String(error || "Unknown error");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function useMonthlyNewMerchants(options: UseMonthlyNewMerchantsOptions = {}) {
  const month = ref(options.initialMonth?.trim() || currentMonth(options.today));
  const offers = options.offers || [];
  const records = ref<MonthlyNewMerchantRecord[]>(
    (options.records || []).map((record) => normalizeMonthlyNewMerchantRecord(record, offers))
  );
  const loadedMonth = ref(options.records?.length ? month.value : "");
  const loading = ref(false);
  const error = ref("");
  const notice = ref("");
  const noticeType = ref<"success" | "error">("success");
  const search = ref("");
  const submitting = ref(false);
  const importRows = ref<MonthlyNewMerchantImportRow[]>([]);
  const importFileName = ref("");
  const importing = ref(false);
  let requestSequence = 0;
  let activeController: AbortController | null = null;

  const filteredRecords = computed(() => filterMonthlyNewMerchantRecords(
    records.value,
    search.value,
    offers
  ));
  const targetTotal = computed(() => filteredRecords.value.reduce(
    (total, record) => total + (record.gmvMonthlyTarget ?? 0),
    0
  ));
  const priorityCount = computed(() => filteredRecords.value.filter((record) => record.isPriority).length);

  function setNotice(message = "", type: "success" | "error" = "success"): void {
    notice.value = message;
    noticeType.value = type === "error" ? "error" : "success";
  }

  function invalidateRequest(): void {
    requestSequence += 1;
    activeController?.abort();
    activeController = null;
    loading.value = false;
  }

  function setMonth(nextMonth: string): void {
    const value = nextMonth.trim();
    if (!value || value === month.value) return;
    invalidateRequest();
    month.value = value;
    records.value = [];
    loadedMonth.value = "";
    error.value = "";
  }

  function setSearch(value: string): void {
    search.value = value;
  }

  async function loadMonth(force = false): Promise<boolean> {
    if (!force && loadedMonth.value === month.value && !error.value) return true;
    if (!options.loadData) {
      error.value = "monthlyNewMerchants.loadError";
      records.value = [];
      loadedMonth.value = "";
      return false;
    }
    const requestedMonth = month.value;
    const sequence = ++requestSequence;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    loading.value = true;
    error.value = "";
    try {
      const payload = await options.loadData({ month: requestedMonth, signal: controller.signal });
      if (sequence !== requestSequence || requestedMonth !== month.value) return false;
      if (!isRecord(payload) || !Array.isArray(payload.records)) {
        throw new Error("monthlyNewMerchants.invalidPayload");
      }
      records.value = payload.records.map((record) => normalizeMonthlyNewMerchantRecord(record, offers));
      loadedMonth.value = requestedMonth;
      return true;
    } catch (caughtError) {
      if (sequence !== requestSequence || requestedMonth !== month.value) return false;
      records.value = [];
      loadedMonth.value = "";
      error.value = textError(caughtError);
      return false;
    } finally {
      if (sequence === requestSequence && requestedMonth === month.value) {
        loading.value = false;
        activeController = null;
      }
    }
  }

  function updateRecord(nextRecord: MonthlyNewMerchantRecord): void {
    const index = records.value.findIndex((record) => record.recordId === nextRecord.recordId);
    records.value = index < 0
      ? [nextRecord, ...records.value]
      : records.value.map((record, recordIndex) => recordIndex === index ? nextRecord : record);
  }

  async function saveRecord(payload: MonthlyNewMerchantPayload): Promise<boolean> {
    if (!options.saveData || submitting.value) return false;
    submitting.value = true;
    error.value = "";
    try {
      const response = await options.saveData(payload);
      const saved = isRecord(response) && isRecord(response.record)
        ? normalizeMonthlyNewMerchantRecord(response.record, offers)
        : null;
      if (saved && saved.recordId) {
        updateRecord(saved);
        loadedMonth.value = month.value;
      } else {
        loadedMonth.value = "";
        await loadMonth(true);
      }
      return true;
    } catch (caughtError) {
      error.value = textError(caughtError);
      return false;
    } finally {
      submitting.value = false;
    }
  }

  async function togglePriority(record: MonthlyNewMerchantRecord): Promise<boolean> {
    if (!record.recordId) return false;
    return saveRecord(buildMonthlyNewMerchantPayload({
      ...record,
      isPriority: !record.isPriority
    }));
  }

  async function deleteRecord(record: MonthlyNewMerchantRecord): Promise<boolean> {
    if (!options.deleteData || !record.recordId || submitting.value) return false;
    submitting.value = true;
    error.value = "";
    try {
      await options.deleteData(record.recordId);
      records.value = records.value.filter((item) => item.recordId !== record.recordId);
      loadedMonth.value = month.value;
      return true;
    } catch (caughtError) {
      error.value = textError(caughtError);
      return false;
    } finally {
      submitting.value = false;
    }
  }

  function previewImport(table: readonly unknown[][]): MonthlyNewMerchantImportResult {
    const result = monthlyNewMerchantImportRows(table, month.value);
    importRows.value = result.rows;
    return result;
  }

  function setImportFileName(fileName: string): void {
    importFileName.value = fileName;
  }

  function resetImport(): void {
    importRows.value = [];
    importFileName.value = "";
    importing.value = false;
  }

  async function importReadyRows(): Promise<{ readonly saved: number; readonly failed: number }> {
    if (!options.saveData || importing.value) return { saved: 0, failed: 0 };
    const readyRows = importRows.value.filter((row) => !row.errors.length && row.status !== "saved");
    if (!readyRows.length) return { saved: 0, failed: 0 };
    importing.value = true;
    let savedCount = 0;
    for (const row of readyRows) {
      row.status = "saving";
      row.saveError = "";
      try {
        await options.saveData(row.payload);
        row.status = "saved";
        savedCount += 1;
      } catch (caughtError) {
        row.status = "error";
        row.saveError = textError(caughtError);
      }
    }
    importing.value = false;
    loadedMonth.value = "";
    await loadMonth(true);
    return { saved: savedCount, failed: readyRows.length - savedCount };
  }

  return {
    month,
    records,
    loadedMonth,
    loading,
    error,
    notice,
    noticeType,
    search,
    filteredRecords,
    targetTotal,
    priorityCount,
    submitting,
    importRows,
    importFileName,
    importing,
    setNotice,
    setMonth,
    setSearch,
    loadMonth,
    saveRecord,
    togglePriority,
    deleteRecord,
    previewImport,
    setImportFileName,
    resetImport,
    importReadyRows
  };
}
