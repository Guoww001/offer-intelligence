import { ref, type Ref } from "vue";

import type { ChatbotAnswerFeedbackState, ChatbotReportViewResult } from "./chatbotViewTypes";
import type { DeepWindowSkeletonStep } from "./deepWindowStore";

export interface DeepWindowState {
  readonly id: string;
  readonly mode?: "report" | "chat";
  readonly result: ChatbotReportViewResult;
  readonly title?: string;
  readonly summary?: string;
  readonly contentHtml?: string;
  readonly errorMessage?: string;
  readonly skeletonSteps?: readonly DeepWindowSkeletonStep[];
  readonly zIndex?: number;
  readonly minimized: boolean;
  readonly pinned: boolean;
  readonly overlay: boolean;
  readonly status: "loading" | "ready" | "cancelled" | "error";
  readonly position: { readonly x: number; readonly y: number };
  readonly canCancel?: boolean;
  readonly canAddMemory?: boolean;
  readonly addedToMemory?: boolean;
  readonly canExport?: boolean;
  readonly canMinimize?: boolean;
  readonly canClose?: boolean;
  readonly feedbackState?: ChatbotAnswerFeedbackState;
}

export interface DeepWindowController {
  readonly deepWindow: Ref<DeepWindowState | null>;
  readonly windows: Ref<readonly DeepWindowState[]>;
  open(result: ChatbotReportViewResult): string;
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
  clear(): void;
}

export function useDeepWindows(): DeepWindowController {
  const deepWindow = ref<DeepWindowState | null>(null);
  const windows = ref<DeepWindowState[]>([]);
  let activeId: string | null = null;
  let idCounter = 0;

  function selectedId(id?: string): string | null {
    return id || activeId;
  }

  function syncActive(): void {
    deepWindow.value = activeId
      ? windows.value.find((item) => item.id === activeId) || null
      : null;
  }

  function update(id: string, updater: (item: DeepWindowState) => DeepWindowState): boolean {
    const index = windows.value.findIndex((item) => item.id === id);
    if (index < 0) return false;
    const next = windows.value.slice();
    next[index] = updater(next[index]!);
    windows.value = next;
    syncActive();
    return true;
  }

  function open(result: ChatbotReportViewResult): string {
    idCounter += 1;
    const id = `deep-${idCounter}`;
    windows.value = [...windows.value, {
      id,
      mode: result.sessionResult?.mode || "report",
      result,
      minimized: false,
      pinned: false,
      overlay: false,
      status: "ready",
      position: { x: 24 + (windows.value.length % 4) * 28, y: 24 + (windows.value.length % 4) * 28 }
    }];
    activeId = id;
    syncActive();
    return id;
  }

  function activate(id: string): void {
    if (windows.value.some((item) => item.id === id)) {
      activeId = id;
      syncActive();
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
    windows.value = windows.value.filter((item) => item.id !== target);
    if (activeId === target) activeId = windows.value.at(-1)?.id || null;
    syncActive();
  }

  function pin(id?: string, pinned?: boolean): boolean {
    const target = selectedId(id);
    return target ? update(target, (item) => ({ ...item, pinned: pinned ?? !item.pinned })) : false;
  }

  function move(id: string, x: number, y: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    return update(id, (item) => ({ ...item, position: { x: Math.max(0, x), y: Math.max(0, y) } }));
  }

  function clone(id?: string): string | null {
    const target = selectedId(id);
    const source = target ? windows.value.find((item) => item.id === target) : undefined;
    if (!source) return null;
    idCounter += 1;
    const cloneId = `deep-${idCounter}`;
    windows.value = [...windows.value, {
      ...source,
      id: cloneId,
      minimized: false,
      pinned: false,
      position: { x: source.position.x + 32, y: source.position.y + 32 }
    }];
    activeId = cloneId;
    syncActive();
    return cloneId;
  }

  function toggleOverlay(id?: string): boolean {
    const target = selectedId(id);
    if (!target) return false;
    let nextValue = false;
    update(target, (item) => {
      nextValue = !item.overlay;
      return { ...item, overlay: nextValue };
    });
    return nextValue;
  }

  function exportResult(id?: string): ChatbotReportViewResult | null {
    const target = selectedId(id);
    return target ? windows.value.find((item) => item.id === target)?.result || null : null;
  }

  function cancel(id?: string): boolean {
    const target = selectedId(id);
    return target ? update(target, (item) => ({ ...item, status: "cancelled", minimized: false })) : false;
  }

  function clear(): void {
    windows.value = [];
    activeId = null;
    syncActive();
  }

  return {
    deepWindow,
    windows,
    open,
    activate,
    minimize,
    restore,
    close,
    pin,
    move,
    clone,
    toggleOverlay,
    export: exportResult,
    cancel,
    clear
  };
}
