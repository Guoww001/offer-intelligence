import { onBeforeUnmount, ref } from "vue";

import {
  DEFAULT_PUBLISHER_FILTERS,
  normalizePublisherPortfolioPayload,
  normalizePublishersPayload,
  type PublisherFilters,
  type PublisherPortfolioPayload,
  type PublisherRecord,
  type PublishersPayload
} from "./publisherModel";

export type PublisherLoader = () => Promise<unknown>;
export type PublisherPortfolioLoader = (userId: string, startDate: string, endDate: string) => Promise<unknown>;

export interface UsePublishersOptions {
  readonly loadData: PublisherLoader;
  readonly loadPortfolio?: PublisherPortfolioLoader;
}

const DEFAULT_LAYOUT = ["filters", "kpi", "affinity", "overview", "chart", "table"] as const;
const LAYOUT_STORAGE_KEY = "publisherLayoutOrder";

function readLayout(): readonly string[] {
  try {
    const value = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!value) return [...DEFAULT_LAYOUT];
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length !== DEFAULT_LAYOUT.length) return [...DEFAULT_LAYOUT];
    const normalized = parsed.filter((item): item is string => typeof item === "string");
    return DEFAULT_LAYOUT.every((id) => normalized.includes(id)) ? normalized : [...DEFAULT_LAYOUT];
  } catch (_error) {
    return [...DEFAULT_LAYOUT];
  }
}

function persistLayout(layout: readonly string[]): void {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch (_error) {
    // 浏览器禁用 storage 时保留内存中的布局即可。
  }
}

function emptyPayload(): PublishersPayload {
  return normalizePublishersPayload({
    publishers: [],
    markets: [],
    networks: [],
    linkTypes: [],
    merchantNameMap: {},
    dailyRows: {}
  });
}

function isFailedPayload(value: unknown): value is Readonly<{ ok: false; error?: unknown }> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (value as { ok?: unknown }).ok === false;
}

export function usePublishers(options: UsePublishersOptions) {
  const payload = ref<PublishersPayload>(emptyPayload());
  const rows = ref<readonly PublisherRecord[]>([]);
  const filters = ref<PublisherFilters>({ ...DEFAULT_PUBLISHER_FILTERS });
  const loading = ref(false);
  const error = ref("");
  const layout = ref<readonly string[]>(readLayout());
  const layoutEditing = ref(false);
  const layoutBeforeEdit = ref<readonly string[]>(layout.value);
  const portfolio = ref<PublisherPortfolioPayload | null>(null);
  const portfolioLoading = ref(false);
  const portfolioError = ref("");
  const portfolioCache = new Map<string, Promise<PublisherPortfolioPayload>>();
  let loadSequence = 0;
  let portfolioSequence = 0;

  async function load(): Promise<PublishersPayload | null> {
    const sequence = ++loadSequence;
    loading.value = true;
    error.value = "";
    try {
      const raw = await options.loadData();
      if (isFailedPayload(raw)) throw new Error(String(raw.error || "Publishers API returned an error"));
      const next = normalizePublishersPayload(raw);
      if (sequence !== loadSequence) return null;
      payload.value = next;
      rows.value = next.publishers;
      return next;
    } catch (caughtError) {
      if (sequence === loadSequence) {
        error.value = caughtError instanceof Error ? caughtError.message : String(caughtError);
      }
      return null;
    } finally {
      if (sequence === loadSequence) loading.value = false;
    }
  }

  async function loadPortfolio(
    userId: string,
    startDate = "",
    endDate = ""
  ): Promise<PublisherPortfolioPayload> {
    const key = `${userId}|${startDate}|${endDate}`;
    const cached = portfolioCache.get(key);
    if (cached) return cached;
    const request = (async () => {
      if (!options.loadPortfolio) return { merchants: [] };
      const raw = await options.loadPortfolio(userId, startDate, endDate);
      if (isFailedPayload(raw)) throw new Error(String(raw.error || "Publisher portfolio API returned an error"));
      return normalizePublisherPortfolioPayload(raw);
    })();
    portfolioCache.set(key, request);
    try {
      return await request;
    } catch (caughtError) {
      portfolioCache.delete(key);
      throw caughtError;
    }
  }

  async function requestPortfolio(userId: string, startDate = "", endDate = ""): Promise<PublisherPortfolioPayload | null> {
    const sequence = ++portfolioSequence;
    portfolioLoading.value = true;
    portfolioError.value = "";
    try {
      const next = await loadPortfolio(userId, startDate, endDate);
      if (sequence !== portfolioSequence) return null;
      portfolio.value = next;
      return next;
    } catch (caughtError) {
      if (sequence === portfolioSequence) {
        portfolio.value = { merchants: [] };
        portfolioError.value = caughtError instanceof Error ? caughtError.message : String(caughtError);
      }
      return null;
    } finally {
      if (sequence === portfolioSequence) portfolioLoading.value = false;
    }
  }

  function setFilters(next: Partial<PublisherFilters>): void {
    filters.value = { ...filters.value, ...next };
  }

  function setLayout(next: readonly string[]): void {
    const normalized = next.filter((id, index, values) => DEFAULT_LAYOUT.includes(id as (typeof DEFAULT_LAYOUT)[number]) && values.indexOf(id) === index);
    if (normalized.length !== DEFAULT_LAYOUT.length) return;
    layout.value = [...normalized];
  }

  function beginLayoutEdit(): void {
    layoutBeforeEdit.value = [...layout.value];
    layoutEditing.value = true;
  }

  function saveLayout(): void {
    persistLayout(layout.value);
    layoutEditing.value = false;
  }

  function cancelLayout(): void {
    layout.value = [...layoutBeforeEdit.value];
    layoutEditing.value = false;
  }

  function resetLayout(): void {
    layout.value = [...DEFAULT_LAYOUT];
  }

  function setLayoutEditing(value: boolean): void {
    if (value) beginLayoutEdit();
    else layoutEditing.value = false;
  }

  onBeforeUnmount(() => {
    layoutEditing.value = false;
    ++portfolioSequence;
    ++loadSequence;
  });

  return {
    payload,
    rows,
    filters,
    loading,
    error,
    layout,
    layoutEditing,
    portfolio,
    portfolioLoading,
    portfolioError,
    load,
    loadPortfolio,
    requestPortfolio,
    setFilters,
    setLayout,
    beginLayoutEdit,
    saveLayout,
    cancelLayout,
    resetLayout,
    setLayoutEditing
  };
}
