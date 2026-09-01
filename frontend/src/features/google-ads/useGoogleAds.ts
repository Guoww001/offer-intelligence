import { computed, ref } from "vue";

import {
  buildGoogleAdsChartModel,
  normalizeGoogleAdsPayload,
  type GoogleAdsChartModel,
  type GoogleAdsPayload
} from "./googleAdsModel";

export type GoogleAdsLoadRequest = Readonly<Record<string, unknown>> & {
  readonly userId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly forceRefresh: boolean;
  readonly signal: AbortSignal;
};

export type GoogleAdsLoader = (request: GoogleAdsLoadRequest) => Promise<unknown>;

export interface UseGoogleAdsOptions {
  readonly userId?: string;
  readonly loadData?: GoogleAdsLoader;
  readonly today?: () => Date;
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function textError(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { readonly message?: unknown }).message;
    if (message) return String(message);
  }
  if (typeof error === "string" && error.trim()) return error;
  return "googleAds.error";
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error
    && String((error as { readonly name?: unknown }).name) === "AbortError";
}

export function useGoogleAds(options: UseGoogleAdsOptions = {}) {
  const userId = ref(options.userId?.trim() || "19");
  const startDate = ref("");
  const endDate = ref("");
  const quickRange = ref("60");
  const payload = ref<GoogleAdsPayload | null>(null);
  const loading = ref(false);
  const error = ref("");
  const status = ref("googleAds.loading");
  const statusKind = ref<"info" | "loading" | "success" | "error">("info");
  const requestKey = ref("");
  let requestSequence = 0;
  let activeController: AbortController | null = null;

  function invalidateRequest(): void {
    requestSequence += 1;
    activeController?.abort();
    activeController = null;
    loading.value = false;
  }

  function setQuickRange(days: number, referenceDate?: Date): void {
    invalidateRequest();
    const end = new Date((referenceDate || options.today?.() || new Date()).getTime());
    end.setHours(12, 0, 0, 0);
    end.setDate(end.getDate() - 1);
    const start = new Date(end.getTime());
    start.setDate(start.getDate() - Math.max(1, Number(days) || 60) + 1);
    quickRange.value = String(days || 60);
    startDate.value = localDateKey(start);
    endDate.value = localDateKey(end);
    payload.value = null;
    requestKey.value = "";
    error.value = "";
    status.value = "googleAds.loading";
    statusKind.value = "info";
  }

  function setDateRange(nextStartDate: string, nextEndDate: string): void {
    const normalizedStartDate = nextStartDate.trim();
    const normalizedEndDate = nextEndDate.trim();
    if (
      quickRange.value === ""
      && normalizedStartDate === startDate.value
      && normalizedEndDate === endDate.value
    ) return;
    invalidateRequest();
    startDate.value = normalizedStartDate;
    endDate.value = normalizedEndDate;
    quickRange.value = "";
    payload.value = null;
    requestKey.value = "";
    error.value = "";
    status.value = "googleAds.loading";
    statusKind.value = "info";
  }

  async function load(forceRefresh = false): Promise<boolean> {
    if (!startDate.value || !endDate.value) setQuickRange(Number(quickRange.value) || 60);
    if (startDate.value > endDate.value) {
      error.value = "googleAds.error";
      status.value = error.value;
      statusKind.value = "error";
      return false;
    }
    if (!options.loadData) {
      error.value = "googleAds.error";
      status.value = error.value;
      statusKind.value = "error";
      return false;
    }
    const nextKey = `${userId.value}|${startDate.value}|${endDate.value}`;
    if (!forceRefresh && requestKey.value === nextKey && payload.value && !error.value) return true;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    const sequence = ++requestSequence;
    requestKey.value = nextKey;
    loading.value = true;
    error.value = "";
    status.value = "googleAds.loading";
    statusKind.value = "loading";
    try {
      const rawPayload = await options.loadData({
        userId: userId.value,
        startDate: startDate.value,
        endDate: endDate.value,
        forceRefresh,
        signal: controller.signal
      });
      if (sequence !== requestSequence || controller.signal.aborted) return false;
      const normalized = normalizeGoogleAdsPayload(rawPayload);
      if (!normalized || !normalized.ok) throw new Error("googleAds.invalidPayload");
      payload.value = normalized;
      error.value = "";
      status.value = "googleAds.loaded";
      statusKind.value = "success";
      return true;
    } catch (caughtError) {
      if (sequence !== requestSequence || controller.signal.aborted || isAbortError(caughtError)) return false;
      payload.value = null;
      error.value = "googleAds.error";
      status.value = error.value;
      statusKind.value = "error";
      return false;
    } finally {
      if (sequence === requestSequence) {
        loading.value = false;
        activeController = null;
      }
    }
  }

  function unmount(): void {
    invalidateRequest();
  }

  setQuickRange(60);

  const chartModel = computed<GoogleAdsChartModel>(() => buildGoogleAdsChartModel(payload.value));

  return {
    userId,
    startDate,
    endDate,
    quickRange,
    payload,
    loading,
    error,
    status,
    statusKind,
    requestKey,
    chartModel,
    setQuickRange,
    setDateRange,
    load,
    unmount,
    textError
  };
}
