import { ref, type Ref } from "vue";

import type { ChatbotAnswerFeedbackState, ChatbotReportViewResult } from "./chatbotViewTypes";

export type DeepWindowStatus = "loading" | "ready" | "cancelled" | "error";
export type DeepWindowInteraction =
  | "trend-metric"
  | "trend-category"
  | "trend-column-toggle"
  | "trend-column-core"
  | "trend-column-all";

export interface DeepWindowSkeletonStep {
  readonly id: string;
  readonly label: string;
  readonly state: "pending" | "active" | "done";
}

export interface DeepWindowState {
  readonly id: string;
  readonly mode: "report" | "chat";
  readonly result: ChatbotReportViewResult;
  readonly title: string;
  readonly summary: string;
  readonly contentHtml?: string;
  readonly errorMessage?: string;
  readonly skeletonSteps?: readonly DeepWindowSkeletonStep[];
  readonly zIndex?: number;
  readonly minimized: boolean;
  readonly pinned: boolean;
  readonly overlay: boolean;
  readonly status: DeepWindowStatus;
  readonly position: { readonly x: number; readonly y: number };
  readonly canAddMemory: boolean;
  readonly addedToMemory: boolean;
  readonly canCancel: boolean;
  readonly canExport: boolean;
  readonly canMinimize: boolean;
  readonly canClose: boolean;
  readonly feedbackState?: ChatbotAnswerFeedbackState;
  readonly trendMetric?: string;
  readonly trendCategory?: string;
  readonly trendColumns?: readonly string[];
  readonly trendColumnsOpen?: boolean;
}

export interface DeepWindowViewState {
  readonly windows: readonly DeepWindowState[];
  readonly activeId: string | null;
}

export interface DeepWindowOpenOptions {
  readonly status?: DeepWindowStatus;
  readonly position?: { readonly x: number; readonly y: number };
}

export interface DeepWindowStoreOptions {
  readonly signal?: AbortSignal;
  readonly onAddToChat?: (window: DeepWindowState) => boolean | void;
  readonly onExport?: (window: DeepWindowState) => boolean;
}

export interface DeepWindowStore {
  readonly deepWindow: Ref<DeepWindowState | null>;
  readonly windows: Ref<readonly DeepWindowState[]>;
  getState(): DeepWindowViewState;
  open(result: ChatbotReportViewResult, options?: DeepWindowOpenOptions): string;
  activate(id: string): void;
  minimize(id?: string): void;
  restore(id?: string): void;
  close(id?: string): void;
  pin(id?: string, pinned?: boolean): boolean;
  move(id: string, x: number, y: number): boolean;
  clone(id?: string): string | null;
  toggleOverlay(id?: string): boolean;
  export(id?: string): ChatbotReportViewResult | null;
  cancel(id?: string): boolean;
  addToChat(id?: string): boolean;
  interact(id: string, action: DeepWindowInteraction, value?: string): boolean;
  setTrendColumns(id: string, columns: readonly string[]): boolean;
  onChange(listener: (state: DeepWindowViewState) => void): () => void;
  dispose(): void;
}

function boundedNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(10_000, numeric)) : fallback;
}

function safeId(value: unknown): string {
  return String(value ?? "").trim().slice(0, 120);
}

function safeColumns(columns: readonly string[]): string[] {
  return Array.from(new Set((Array.isArray(columns) ? columns : [])
    .map((column) => String(column).trim().slice(0, 80))
    .filter(Boolean))).slice(0, 32);
}

const DEFAULT_TREND_COLUMNS = [
  "revenue", "orders", "epc", "aov", "clicks", "affiliatePayout", "dpv", "atc", "conversionRate"
] as const;
const ALL_TREND_COLUMNS = [
  ...DEFAULT_TREND_COLUMNS, "payout", "directSales", "haloSales"
] as const;

export function createDeepWindowStore(options: DeepWindowStoreOptions = {}): DeepWindowStore {
  const deepWindow = ref<DeepWindowState | null>(null);
  const windows = ref<DeepWindowState[]>([]);
  const listeners = new Set<(state: DeepWindowViewState) => void>();
  const controllers = new Map<string, AbortController>();
  let activeId: string | null = null;
  let idCounter = 0;
  let disposed = false;

  function cloneWindow(item: DeepWindowState): DeepWindowState {
    return {
      ...item,
      result: { ...item.result, rows: item.result.rows.slice(), summary: { ...item.result.summary } },
      position: { ...item.position },
      ...(item.trendColumns ? { trendColumns: item.trendColumns.slice() } : {}),
      ...(item.trendColumnsOpen !== undefined ? { trendColumnsOpen: item.trendColumnsOpen } : {})
    };
  }

  function getState(): DeepWindowViewState {
    return {
      windows: windows.value.map(cloneWindow),
      activeId: activeId && windows.value.some((item) => item.id === activeId) ? activeId : null
    };
  }

  function notify(): void {
    deepWindow.value = activeId ? windows.value.find((item) => item.id === activeId) || null : null;
    const snapshot = getState();
    listeners.forEach((listener) => listener(snapshot));
  }

  function selectedId(id?: string): string | null {
    const candidate = safeId(id);
    return candidate || activeId;
  }

  function find(id?: string): DeepWindowState | undefined {
    const target = selectedId(id);
    return target ? windows.value.find((item) => item.id === target) : undefined;
  }

  function update(id: string, updater: (item: DeepWindowState) => DeepWindowState): boolean {
    if (disposed) return false;
    const index = windows.value.findIndex((item) => item.id === id);
    if (index < 0) return false;
    const next = windows.value.slice();
    next[index] = updater(next[index]!);
    windows.value = next;
    notify();
    return true;
  }

  function open(result: ChatbotReportViewResult, openOptions: DeepWindowOpenOptions = {}): string {
    if (disposed) return "";
    idCounter += 1;
    const id = `deep-${idCounter}`;
    const offset = windows.value.length % 4;
    const position = openOptions.position || { x: 24 + offset * 28, y: 24 + offset * 28 };
    windows.value = [...windows.value, {
      id,
      mode: result.sessionResult?.mode || "report",
      result,
      title: result.title || result.category || result.tier || result.message || result.intent,
      summary: result.message,
      ...(result.contentHtml ? { contentHtml: result.contentHtml } : {}),
      zIndex: 1300 + windows.value.length,
      minimized: false,
      pinned: false,
      overlay: false,
      status: openOptions.status || "ready",
      position: { x: boundedNumber(position.x, 24), y: boundedNumber(position.y, 24) },
      canCancel: openOptions.status === "loading",
      canAddMemory: true,
      addedToMemory: false,
      canExport: openOptions.status !== "loading",
      canMinimize: true,
      canClose: true,
      trendColumnsOpen: false,
      ...(result.sessionResult?.feedbackState ? { feedbackState: result.sessionResult.feedbackState } : {})
    }];
    if (openOptions.status === "loading") controllers.set(id, new AbortController());
    activeId = id;
    notify();
    return id;
  }

  function activate(id: string): void {
    const target = safeId(id);
    if (target && windows.value.some((item) => item.id === target)) {
      activeId = target;
      notify();
    }
  }

  function minimize(id?: string): void {
    const target = selectedId(id);
    if (target) update(target, (item) => ({ ...item, minimized: true }));
  }

  function restore(id?: string): void {
    const target = selectedId(id);
    if (target) update(target, (item) => ({ ...item, minimized: false }));
  }

  function close(id?: string): void {
    const target = selectedId(id);
    if (!target) return;
    controllers.get(target)?.abort();
    controllers.delete(target);
    windows.value = windows.value.filter((item) => item.id !== target);
    if (activeId === target) activeId = windows.value.at(-1)?.id || null;
    notify();
  }

  function pin(id?: string, pinned?: boolean): boolean {
    const target = selectedId(id);
    return target ? update(target, (item) => ({ ...item, pinned: pinned ?? !item.pinned })) : false;
  }

  function move(id: string, x: number, y: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    return update(safeId(id), (item) => ({
      ...item,
      position: { x: boundedNumber(x, item.position.x), y: boundedNumber(y, item.position.y) }
    }));
  }

  function clone(id?: string): string | null {
    const source = find(id);
    if (!source || disposed) return null;
    idCounter += 1;
    const cloneId = `deep-${idCounter}`;
    windows.value = [...windows.value, {
      ...cloneWindow(source),
      id: cloneId,
      minimized: false,
      pinned: false,
      position: { x: boundedNumber(source.position.x + 32, 0), y: boundedNumber(source.position.y + 32, 0) },
      canAddMemory: true,
      addedToMemory: false
    }];
    activeId = cloneId;
    notify();
    return cloneId;
  }

  function toggleOverlay(id?: string): boolean {
    const target = selectedId(id);
    if (!target) return false;
    const item = find(target);
    if (!item) return false;
    const next = !item.overlay;
    update(target, (current) => ({ ...current, overlay: next }));
    return next;
  }

  function exportWindow(id?: string): ChatbotReportViewResult | null {
    const item = find(id);
    if (!item) return null;
    options.onExport?.(cloneWindow(item));
    return item.result;
  }

  function cancel(id?: string): boolean {
    const target = selectedId(id);
    if (!target) return false;
    const item = find(target);
    if (!item || item.status !== "loading") {
      return item ? update(target, (current) => ({
        ...current,
        status: "cancelled",
        minimized: false,
        canCancel: false,
        canAddMemory: false,
        canExport: false
      })) : false;
    }
    controllers.get(target)?.abort();
    controllers.delete(target);
    return update(target, (current) => ({
      ...current,
      status: "cancelled",
      minimized: false,
      canCancel: false,
      canAddMemory: false,
      canExport: false
    }));
  }

  function addToChat(id?: string): boolean {
    const target = selectedId(id);
    const item = target ? find(target) : undefined;
    if (!item || item.status === "cancelled" || item.status === "error" || item.addedToMemory) return false;
    const accepted = options.onAddToChat?.(cloneWindow(item));
    if (accepted === false) return false;
    return update(item.id, (current) => ({ ...current, canAddMemory: false, addedToMemory: true }));
  }

  function interact(id: string, action: DeepWindowInteraction, value?: string): boolean {
    const target = safeId(id);
    if (!target || !["trend-metric", "trend-category", "trend-column-toggle", "trend-column-core", "trend-column-all"].includes(action)) return false;
    if (!find(target)) return false;
    if (action === "trend-metric") {
      const metric = safeId(value);
      return metric ? update(target, (item) => ({ ...item, trendMetric: metric })) : false;
    }
    if (action === "trend-category") {
      const category = safeId(value);
      return category ? update(target, (item) => ({ ...item, trendCategory: category })) : false;
    }
    if (action === "trend-column-toggle") {
      return update(target, (item) => ({ ...item, trendColumnsOpen: item.trendColumnsOpen !== true }));
    }
    const columns = action === "trend-column-core" ? DEFAULT_TREND_COLUMNS : ALL_TREND_COLUMNS;
    return update(target, (item) => ({ ...item, trendColumns: columns.slice(), trendColumnsOpen: true }));
  }

  function setTrendColumns(id: string, columns: readonly string[]): boolean {
    const target = safeId(id);
    if (!target || !find(target)) return false;
    const next = safeColumns(columns);
    return update(target, (item) => ({ ...item, trendColumns: next }));
  }

  function onChange(listener: (state: DeepWindowViewState) => void): () => void {
    if (disposed) return () => undefined;
    listeners.add(listener);
    listener(getState());
    return () => listeners.delete(listener);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    controllers.forEach((controller) => controller.abort());
    controllers.clear();
    windows.value = [];
    activeId = null;
    listeners.clear();
    deepWindow.value = null;
  }

  const abortParent = (): void => {
    windows.value.forEach((item) => {
      if (item.status === "loading") controllers.get(item.id)?.abort();
    });
    windows.value = windows.value.map((item) => item.status === "loading"
      ? { ...item, status: "cancelled", canCancel: false, canAddMemory: false, canExport: false }
      : item);
    notify();
  };
  options.signal?.addEventListener("abort", abortParent, { once: true });

  return {
    deepWindow,
    windows,
    getState,
    open,
    activate,
    minimize,
    restore,
    close,
    pin,
    move,
    clone,
    toggleOverlay,
    export: exportWindow,
    cancel,
    addToChat,
    interact,
    setTrendColumns,
    onChange,
    dispose
  };
}
