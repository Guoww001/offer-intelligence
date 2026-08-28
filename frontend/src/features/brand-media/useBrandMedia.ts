import { computed, ref } from "vue";

import {
  brandMediaCatalogOptions,
  brandMediaManagerOptions,
  buildBrandMediaChartModel,
  buildBrandMediaClickChartModel,
  filterBrandMediaPublishers,
  normalizeBrandMediaPayload,
  summarizeBrandMediaView,
  visibleBrandMediaPublishers,
  type BrandMediaCatalogOption,
  type BrandMediaChartModel,
  type BrandMediaClickChartModel,
  type BrandMediaDateRange,
  type BrandMediaPayload
} from "./brandMediaModel";

export interface BrandMediaTrendRequest {
  readonly merchantId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly signal: AbortSignal;
}

export type BrandMediaTrendLoader = (request: BrandMediaTrendRequest) => Promise<unknown>;
export type BrandMediaCatalogLoader = () => Promise<unknown>;

export interface UseBrandMediaOptions {
  readonly catalogData?: unknown;
  readonly loadCatalog?: BrandMediaCatalogLoader;
  readonly loadTrend?: BrandMediaTrendLoader;
  readonly today?: () => Date;
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function errorStatus(error: unknown): number {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = Number((error as { status?: unknown }).status);
    return Number.isFinite(status) ? status : 0;
  }
  return 0;
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error
    && String((error as { name?: unknown }).name) === "AbortError";
}

function statusForError(error: unknown): "brandMedia.noPermission" | "brandMedia.loadError" {
  const status = errorStatus(error);
  return status === 401 || status === 403 ? "brandMedia.noPermission" : "brandMedia.loadError";
}

export function useBrandMedia(options: UseBrandMediaOptions = {}) {
  const catalogData = ref<unknown>(options.catalogData || null);
  const merchantId = ref("");
  const merchantName = ref("");
  const merchantSearch = ref("");
  const managerFilter = ref("");
  const lockedPublisherKeys = ref<string[]>([]);
  const chartExpanded = ref(false);
  const startDate = ref("");
  const endDate = ref("");
  const quickRange = ref("90");
  const payload = ref<BrandMediaPayload | null>(null);
  const loading = ref(false);
  const error = ref("");
  const status = ref("brandMedia.selectBrand");
  const statusKind = ref<"info" | "loading" | "error" | "">("info");
  const catalogLoading = ref(false);
  const catalogError = ref("");
  const requestKey = ref("");
  let requestSequence = 0;
  let activeController: AbortController | null = null;

  function invalidateTrendRequest(): void {
    requestSequence += 1;
    activeController?.abort();
    activeController = null;
    loading.value = false;
  }

  const merchantOptions = computed<readonly BrandMediaCatalogOption[]>(() => brandMediaCatalogOptions(catalogData.value));
  const managerOptions = computed(() => brandMediaManagerOptions(payload.value));
  const managerPublishers = computed(() => filterBrandMediaPublishers(payload.value, managerFilter.value));
  const visiblePublishers = computed(() => visibleBrandMediaPublishers(
    payload.value,
    managerFilter.value,
    lockedPublisherKeys.value
  ));
  const summary = computed(() => summarizeBrandMediaView(
    payload.value,
    visiblePublishers.value,
    lockedPublisherKeys.value,
    managerFilter.value
  ));
  const chartModel = computed<BrandMediaChartModel | null>(() => {
    if (!payload.value) return null;
    return buildBrandMediaChartModel(payload.value, visiblePublishers.value, {
      allPublishers: managerPublishers.value,
      lockedKeys: lockedPublisherKeys.value
    });
  });
  const clickChartModel = computed<BrandMediaClickChartModel | null>(() => {
    if (!payload.value || !lockedPublisherKeys.value.length) return null;
    return buildBrandMediaClickChartModel(payload.value, visiblePublishers.value);
  });

  function setStatus(nextStatus: string, kind: "info" | "loading" | "error" | "" = ""): void {
    status.value = nextStatus;
    statusKind.value = kind;
  }

  function setQuickRange(days: number, referenceDate?: Date): void {
    invalidateTrendRequest();
    const end = new Date((referenceDate || options.today?.() || new Date()).getTime());
    end.setHours(12, 0, 0, 0);
    end.setDate(end.getDate() - 1);
    const start = new Date(end.getTime());
    start.setDate(start.getDate() - Math.max(1, Number(days) || 90) + 1);
    quickRange.value = String(days);
    startDate.value = localDateKey(start);
    endDate.value = localDateKey(end);
    payload.value = null;
    requestKey.value = "";
  }

  function setDateRange(nextStartDate: string, nextEndDate: string): void {
    invalidateTrendRequest();
    startDate.value = nextStartDate.trim();
    endDate.value = nextEndDate.trim();
    quickRange.value = "";
    payload.value = null;
    requestKey.value = "";
  }

  function setSearch(value: string): void {
    merchantSearch.value = value;
    if (value.trim() === merchantName.value.trim()) return;
    merchantId.value = "";
    merchantName.value = "";
    invalidateTrendRequest();
    managerFilter.value = "";
    lockedPublisherKeys.value = [];
    payload.value = null;
    requestKey.value = "";
    setStatus("brandMedia.selectBrand", "info");
  }

  function selectMerchant(option: { readonly merchantId: string; readonly name: string }): void {
    invalidateTrendRequest();
    merchantId.value = option.merchantId.trim();
    merchantName.value = option.name.trim();
    merchantSearch.value = merchantName.value;
    managerFilter.value = "";
    lockedPublisherKeys.value = [];
    payload.value = null;
    requestKey.value = "";
    error.value = "";
  }

  function setManagerFilter(value: string): void {
    const matching = managerOptions.value.find((manager) => manager.toLowerCase() === value.trim().toLowerCase());
    managerFilter.value = matching || "";
    lockedPublisherKeys.value = [];
  }

  function togglePublisherLock(publisherKey: string): void {
    const key = publisherKey.trim();
    if (!key) return;
    lockedPublisherKeys.value = lockedPublisherKeys.value.includes(key)
      ? lockedPublisherKeys.value.filter((item) => item !== key)
      : [...lockedPublisherKeys.value, key];
  }

  function setChartExpanded(expanded: boolean): void {
    chartExpanded.value = expanded;
  }

  function setCatalogData(value: unknown): void {
    catalogData.value = value;
  }

  async function loadCatalog(): Promise<boolean> {
    if (!options.loadCatalog || catalogLoading.value || merchantOptions.value.length) return true;
    catalogLoading.value = true;
    catalogError.value = "";
    try {
      setCatalogData(await options.loadCatalog());
      return true;
    } catch (caughtError) {
      catalogError.value = statusForError(caughtError);
      setStatus(catalogError.value, "error");
      return false;
    } finally {
      catalogLoading.value = false;
    }
  }

  function clearWithoutMerchant(): void {
    invalidateTrendRequest();
    payload.value = null;
    error.value = "";
    loading.value = false;
    requestKey.value = "";
    setStatus("brandMedia.selectBrand", "info");
  }

  async function loadTrend(): Promise<boolean> {
    if (!merchantId.value) {
      clearWithoutMerchant();
      return false;
    }
    if (!startDate.value || !endDate.value || startDate.value > endDate.value) {
      error.value = "brandMedia.loadError";
      setStatus("brandMedia.loadError", "error");
      return false;
    }
    if (!options.loadTrend) {
      error.value = "brandMedia.loadError";
      setStatus("brandMedia.loadError", "error");
      return false;
    }
    const nextKey = `${merchantId.value}|${startDate.value}|${endDate.value}`;
    if (requestKey.value === nextKey && payload.value && !error.value) return true;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    const sequence = ++requestSequence;
    requestKey.value = nextKey;
    loading.value = true;
    error.value = "";
    setStatus("brandMedia.loading", "loading");
    try {
      const rawPayload = await options.loadTrend({
        merchantId: merchantId.value,
        startDate: startDate.value,
        endDate: endDate.value,
        signal: controller.signal
      });
      if (sequence !== requestSequence || controller.signal.aborted) return false;
      const normalized = normalizeBrandMediaPayload(rawPayload, {
        startDate: startDate.value,
        endDate: endDate.value
      });
      if (!normalized) throw new Error("brandMedia.invalidPayload");
      payload.value = normalized;
      merchantName.value = normalized.merchant.merchantName || merchantName.value || merchantId.value;
      merchantSearch.value = merchantName.value;
      error.value = "";
      setStatus(normalized.publishers.length ? "" : "brandMedia.noData", normalized.publishers.length ? "" : "info");
      return true;
    } catch (caughtError) {
      if (sequence !== requestSequence || controller.signal.aborted || isAbortError(caughtError)) return false;
      payload.value = null;
      error.value = statusForError(caughtError);
      setStatus(error.value, "error");
      return false;
    } finally {
      if (sequence === requestSequence) {
        loading.value = false;
        activeController = null;
      }
    }
  }

  function unmount(): void {
    invalidateTrendRequest();
    chartExpanded.value = false;
  }

  if (!startDate.value || !endDate.value) setQuickRange(90);

  return {
    catalogData,
    merchantOptions,
    merchantId,
    merchantName,
    merchantSearch,
    managerFilter,
    managerOptions,
    lockedPublisherKeys,
    chartExpanded,
    startDate,
    endDate,
    quickRange,
    payload,
    loading,
    error,
    status,
    statusKind,
    catalogLoading,
    catalogError,
    requestKey,
    managerPublishers,
    visiblePublishers,
    summary,
    chartModel,
    clickChartModel,
    setCatalogData,
    loadCatalog,
    setQuickRange,
    setDateRange,
    setSearch,
    selectMerchant,
    setManagerFilter,
    togglePublisherLock,
    setChartExpanded,
    loadTrend,
    unmount
  };
}
