import { computed, ref } from "vue";

import {
  buildRevenueFlowModel,
  MAX_REVENUE_FLOW_BRANDS,
  normalizeRevenueFlowPayload,
  revenueFlowCatalogOptions,
  toggleRevenueFlowNode,
  type RevenueFlowCatalogOption,
  type RevenueFlowModel,
  type RevenueFlowPayload
} from "./revenueFlowModel";

export interface RevenueFlowTrendRequest {
  readonly merchantIds: readonly string[];
  readonly startDate: string;
  readonly endDate: string;
  readonly signal: AbortSignal;
}

export type RevenueFlowTrendLoader = (request: RevenueFlowTrendRequest) => Promise<unknown>;
export type RevenueFlowCatalogLoader = () => Promise<unknown>;

export interface UseRevenueFlowOptions {
  readonly catalogData?: unknown;
  readonly initialMerchants?: readonly RevenueFlowCatalogOption[];
  readonly initialStartDate?: string;
  readonly initialEndDate?: string;
  readonly loadCatalog?: RevenueFlowCatalogLoader;
  readonly loadTrend?: RevenueFlowTrendLoader;
  readonly today?: () => Date;
}

const REVENUE_FLOW_CACHE_LIMIT = 12;

interface RevenueFlowSharedRequest {
  readonly controller: AbortController;
  readonly promise: Promise<RevenueFlowPayload>;
  readonly consumers: Set<number>;
}

const revenueFlowPayloadCache = new Map<string, RevenueFlowPayload>();
const revenueFlowRequests = new Map<string, RevenueFlowSharedRequest>();
let nextRevenueFlowConsumerId = 0;

function localDateKey(date: Date): string {
  return date.getFullYear() + "-"
    + String(date.getMonth() + 1).padStart(2, "0") + "-"
    + String(date.getDate()).padStart(2, "0");
}

function errorStatus(error: unknown): number {
  if (typeof error !== "object" || error === null || !("status" in error)) return 0;
  const status = Number((error as { status?: unknown }).status);
  return Number.isFinite(status) ? status : 0;
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "name" in error
    && String((error as { name?: unknown }).name) === "AbortError";
}

function statusForError(error: unknown): "revenueFlow.noPermission" | "revenueFlow.loadError" {
  const status = errorStatus(error);
  return status === 401 || status === 403 ? "revenueFlow.noPermission" : "revenueFlow.loadError";
}

function requestKeyFor(
  merchantIds: readonly string[],
  startDate: string,
  endDate: string
): string {
  return [...merchantIds].sort((left, right) => left.localeCompare(right, undefined, { numeric: true })).join(",")
    + "|" + startDate + "|" + endDate;
}

function invalidRange(startDate: string, endDate: string): boolean {
  return !startDate || !endDate || startDate > endDate;
}

function cachePayload(
  cache: Map<string, RevenueFlowPayload>,
  key: string,
  payload: RevenueFlowPayload
): void {
  cache.delete(key);
  cache.set(key, payload);
  while (cache.size > REVENUE_FLOW_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (typeof oldest !== "string") break;
    cache.delete(oldest);
  }
}

function normalizedInitialMerchants(
  merchants: readonly RevenueFlowCatalogOption[] | undefined
): RevenueFlowCatalogOption[] {
  const seen = new Set<string>();
  return (merchants || []).filter((merchant) => {
    const merchantId = merchant.merchantId.trim();
    if (!merchantId || seen.has(merchantId)) return false;
    seen.add(merchantId);
    return true;
  }).slice(0, MAX_REVENUE_FLOW_BRANDS).map((merchant) => ({
    merchantId: merchant.merchantId.trim(),
    name: merchant.name.trim() || merchant.merchantId.trim(),
    count: Number.isFinite(merchant.count) ? Math.max(0, merchant.count) : 0
  }));
}

function releaseRevenueFlowRequest(key: string, consumerId: number): void {
  const request = revenueFlowRequests.get(key);
  if (!request) return;
  request.consumers.delete(consumerId);
  if (!request.consumers.size) request.controller.abort();
}

function sharedRevenueFlowRequest(
  key: string,
  loader: RevenueFlowTrendLoader,
  merchantIds: readonly string[],
  startDate: string,
  endDate: string
): RevenueFlowSharedRequest {
  const existing = revenueFlowRequests.get(key);
  if (existing) return existing;

  const controller = new AbortController();
  let request: RevenueFlowSharedRequest;
  let loaderResult: Promise<unknown>;
  try {
    loaderResult = Promise.resolve(loader({
      merchantIds,
      startDate,
      endDate,
      signal: controller.signal
    }));
  } catch (error) {
    loaderResult = Promise.reject(error);
  }
  const promise = loaderResult
    .then((rawPayload) => {
      const normalized = normalizeRevenueFlowPayload(rawPayload, { startDate, endDate });
      if (!normalized) throw new Error("revenueFlow.invalidPayload");
      cachePayload(revenueFlowPayloadCache, key, normalized);
      return normalized;
    })
    .finally(() => {
      if (revenueFlowRequests.get(key) === request) revenueFlowRequests.delete(key);
    });
  request = {
    controller,
    promise,
    consumers: new Set<number>()
  };
  revenueFlowRequests.set(key, request);
  return request;
}

function statusForPayload(payload: RevenueFlowPayload): string {
  if (!payload.sankey.available && payload.sankey.reason) return "revenueFlow.unavailable";
  return buildRevenueFlowModel(payload) ? "" : "revenueFlow.empty";
}

export function useRevenueFlow(options: UseRevenueFlowOptions = {}) {
  const catalogData = ref<unknown>(options.catalogData || null);
  const selectedMerchants = ref<RevenueFlowCatalogOption[]>(
    normalizedInitialMerchants(options.initialMerchants)
  );
  const merchantSearch = ref("");
  const dropdownOpen = ref(false);
  const chartExpanded = ref(false);
  const chartZoom = ref(1);
  const lockedNodeId = ref("");
  const startDate = ref((options.initialStartDate || "").trim());
  const endDate = ref((options.initialEndDate || "").trim());
  const quickRange = ref(startDate.value && endDate.value ? "" : "90");
  const payload = ref<RevenueFlowPayload | null>(null);
  const loading = ref(false);
  const error = ref("");
  const status = ref("revenueFlow.selectBrand");
  const statusKind = ref<"info" | "loading" | "error" | "">("info");
  const catalogLoading = ref(false);
  const catalogError = ref("");
  const requestKey = ref("");
  const consumerId = ++nextRevenueFlowConsumerId;
  let requestSequence = 0;
  let activeRequestKey = "";
  let activeRequest: RevenueFlowSharedRequest | null = null;

  function invalidateTrendRequest(): void {
    requestSequence += 1;
    if (activeRequestKey) releaseRevenueFlowRequest(activeRequestKey, consumerId);
    activeRequestKey = "";
    activeRequest = null;
    loading.value = false;
  }

  function setStatus(nextStatus: string, kind: "info" | "loading" | "error" | "" = ""): void {
    status.value = nextStatus;
    statusKind.value = kind;
  }

  const merchantOptions = computed<readonly RevenueFlowCatalogOption[]>(() =>
    revenueFlowCatalogOptions(catalogData.value)
  );
  const filteredMerchantOptions = computed<readonly RevenueFlowCatalogOption[]>(() => {
    const query = merchantSearch.value.trim().toLowerCase();
    return merchantOptions.value
      .filter((option) => !query
        || option.name.toLowerCase().includes(query)
        || option.merchantId.toLowerCase().includes(query))
      .slice(0, 80);
  });
  const selectedIds = computed<readonly string[]>(() =>
    selectedMerchants.value.map((merchant) => merchant.merchantId)
  );
  const model = computed<RevenueFlowModel | null>(() =>
    payload.value ? buildRevenueFlowModel(payload.value) : null
  );
  const summary = computed(() => ({
    brandCount: model.value?.brandCount || 0,
    productCount: model.value?.productCount || 0,
    mediaCount: model.value?.mediaCount || 0,
    linkCount: model.value?.linkCount || 0,
    totalRevenue: model.value?.totalRevenue || 0
  }));

  function clearPayload(): void {
    payload.value = null;
    error.value = "";
    requestKey.value = "";
    lockedNodeId.value = "";
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
    clearPayload();
    setStatus(selectedMerchants.value.length ? "" : "revenueFlow.selectBrand", "info");
  }

  function setDateRange(nextStartDate: string, nextEndDate: string): void {
    invalidateTrendRequest();
    startDate.value = nextStartDate.trim();
    endDate.value = nextEndDate.trim();
    quickRange.value = "";
    clearPayload();
    setStatus(selectedMerchants.value.length ? "" : "revenueFlow.selectBrand", "info");
  }

  function setSearch(value: string): void {
    merchantSearch.value = value;
  }

  function toggleMerchant(option: RevenueFlowCatalogOption): boolean {
    const merchantId = option.merchantId.trim();
    if (!merchantId) return false;
    const existing = selectedMerchants.value.some((merchant) => merchant.merchantId === merchantId);
    if (existing) {
      selectedMerchants.value = selectedMerchants.value.filter((merchant) => merchant.merchantId !== merchantId);
    } else {
      if (selectedMerchants.value.length >= MAX_REVENUE_FLOW_BRANDS) {
        setStatus("revenueFlow.brandLimit", "info");
        return false;
      }
      selectedMerchants.value = [...selectedMerchants.value, {
        ...option,
        merchantId,
        name: option.name.trim() || merchantId
      }];
    }
    invalidateTrendRequest();
    clearPayload();
    error.value = "";
    setStatus(selectedMerchants.value.length ? "" : "revenueFlow.selectBrand", "info");
    return true;
  }

  function removeMerchant(merchantId: string): void {
    const id = merchantId.trim();
    if (!id) return;
    const next = selectedMerchants.value.filter((merchant) => merchant.merchantId !== id);
    if (next.length === selectedMerchants.value.length) return;
    selectedMerchants.value = next;
    invalidateTrendRequest();
    clearPayload();
    setStatus(next.length ? "" : "revenueFlow.selectBrand", "info");
  }

  function clearMerchants(): void {
    if (!selectedMerchants.value.length && !payload.value) {
      setStatus("revenueFlow.selectBrand", "info");
      return;
    }
    selectedMerchants.value = [];
    invalidateTrendRequest();
    clearPayload();
    setStatus("revenueFlow.selectBrand", "info");
  }

  function setCatalogData(value: unknown): void {
    catalogData.value = value;
  }

  function setDropdownOpen(open: boolean): void {
    dropdownOpen.value = open;
  }

  function setChartExpanded(expanded: boolean): void {
    chartExpanded.value = expanded;
  }

  function setChartZoom(zoom: number): void {
    chartZoom.value = Math.min(1.6, Math.max(0.7, Number.isFinite(zoom) ? zoom : 1));
  }

  function toggleNode(nodeId: string): void {
    if (!model.value) return;
    lockedNodeId.value = toggleRevenueFlowNode(model.value, lockedNodeId.value, nodeId);
  }

  function resetChartZoom(): void {
    chartZoom.value = 1;
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

  function clearWithoutMerchants(): void {
    invalidateTrendRequest();
    clearPayload();
    setStatus("revenueFlow.selectBrand", "info");
  }

  async function loadTrend(): Promise<boolean> {
    const merchantIds = selectedIds.value;
    if (!merchantIds.length) {
      clearWithoutMerchants();
      return false;
    }
    if (invalidRange(startDate.value, endDate.value)) {
      error.value = "revenueFlow.loadError";
      setStatus(error.value, "error");
      return false;
    }
    if (!options.loadTrend) {
      error.value = "revenueFlow.loadError";
      setStatus(error.value, "error");
      return false;
    }

    const nextKey = requestKeyFor(merchantIds, startDate.value, endDate.value);
    if (requestKey.value === nextKey && payload.value && !error.value) return true;
    const cached = revenueFlowPayloadCache.get(nextKey);
    if (cached) {
      payload.value = cached;
      requestKey.value = nextKey;
      error.value = "";
      setStatus(statusForPayload(cached), statusForPayload(cached) ? "info" : "");
      return true;
    }

    if (activeRequestKey && activeRequestKey !== nextKey) invalidateTrendRequest();
    const loadTrend = options.loadTrend;
    const sharedRequest = sharedRevenueFlowRequest(
      nextKey,
      loadTrend,
      merchantIds,
      startDate.value,
      endDate.value
    );
    sharedRequest.consumers.add(consumerId);
    activeRequestKey = nextKey;
    activeRequest = sharedRequest;
    const sequence = ++requestSequence;
    requestKey.value = nextKey;
    loading.value = true;
    error.value = "";
    setStatus("revenueFlow.loading", "loading");
    try {
      const normalized = await sharedRequest.promise;
      if (sequence !== requestSequence || sharedRequest.controller.signal.aborted) return false;
      payload.value = normalized;
      error.value = "";
      const nextStatus = statusForPayload(normalized);
      setStatus(nextStatus, nextStatus ? "info" : "");
      return true;
    } catch (caughtError) {
      if (
        sequence !== requestSequence
        || sharedRequest.controller.signal.aborted
        || isAbortError(caughtError)
      ) return false;
      payload.value = null;
      error.value = statusForError(caughtError);
      setStatus(error.value, "error");
      return false;
    } finally {
      if (sequence === requestSequence) {
        loading.value = false;
        if (activeRequestKey === nextKey && activeRequest === sharedRequest) {
          activeRequestKey = "";
          activeRequest = null;
        }
      }
    }
  }

  function unmount(): void {
    invalidateTrendRequest();
    chartExpanded.value = false;
    chartZoom.value = 1;
    lockedNodeId.value = "";
  }

  if (!startDate.value || !endDate.value) setQuickRange(90);
  else if (selectedMerchants.value.length) setStatus("", "");

  return {
    catalogData,
    merchantOptions,
    filteredMerchantOptions,
    selectedMerchants,
    selectedIds,
    merchantSearch,
    dropdownOpen,
    chartExpanded,
    chartZoom,
    lockedNodeId,
    startDate,
    endDate,
    quickRange,
    payload,
    model,
    summary,
    loading,
    error,
    status,
    statusKind,
    catalogLoading,
    catalogError,
    requestKey,
    setCatalogData,
    loadCatalog,
    setQuickRange,
    setDateRange,
    setSearch,
    toggleMerchant,
    removeMerchant,
    clearMerchants,
    setDropdownOpen,
    setChartExpanded,
    setChartZoom,
    resetChartZoom,
    toggleNode,
    loadTrend,
    unmount
  };
}
