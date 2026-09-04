import { describe, expect, it, vi } from "vitest";

import { createDeepWindowStore, type DeepWindowStore } from "./deepWindowStore";
import type { ChatbotReportViewResult } from "./chatbotViewTypes";

const result = (query: string): ChatbotReportViewResult => ({
  intent: "merchant",
  status: "resolved",
  query,
  source: "cache",
  rows: [],
  summary: { offerCount: 0, clicks: 0, orders: 0, revenue: 0, commission: 0, conversionRate: null },
  message: `${query} report`
});

function store(): DeepWindowStore {
  return createDeepWindowStore();
}

describe("createDeepWindowStore", () => {
  it("keeps the active window and supports the modern lifecycle controls", () => {
    const windows = store();
    const first = windows.open(result("Tapo"));
    const second = windows.open(result("Shokz"));

    windows.pin(first);
    windows.move(first, 48, 72);
    windows.minimize(first);
    expect(windows.getState().windows.find((item) => item.id === first)).toMatchObject({
      mode: "report",
      title: "Tapo report",
      summary: "Tapo report",
      pinned: true,
      minimized: true,
      position: { x: 48, y: 72 },
      canExport: true,
      canMinimize: true,
      canClose: true
    });

    windows.restore(first);
    windows.activate(first);
    expect(windows.getState().activeId).toBe(first);
    expect(windows.clone(first)).not.toBeNull();
    expect(windows.getState().windows).toHaveLength(3);
    expect(windows.toggleOverlay(first)).toBe(true);
    expect(windows.export(first)?.query).toBe("Tapo");
    expect(windows.cancel(first)).toBe(true);
    expect(windows.getState().windows.find((item) => item.id === first)?.status).toBe("cancelled");

    windows.close(second);
    expect(windows.getState().windows.some((item) => item.id === second)).toBe(false);
  });

  it("notifies subscribers and routes memory drops without exposing raw internals", () => {
    const onAddToChat = vi.fn(() => true);
    const windows = createDeepWindowStore({ onAddToChat });
    const listener = vi.fn();
    const unsubscribe = windows.onChange(listener);
    const id = windows.open(result("Tapo"));

    expect(listener).toHaveBeenCalled();
    expect(windows.addToChat(id)).toBe(true);
    expect(onAddToChat).toHaveBeenCalledWith(expect.objectContaining({ id, result: expect.any(Object) }));
    expect(windows.getState().windows.find((item) => item.id === id)?.addedToMemory).toBe(true);

    unsubscribe();
    windows.close(id);
    expect(windows.getState().windows).toHaveLength(0);
  });

  it("aborts and marks only the selected loading window", () => {
    const controller = new AbortController();
    const windows = createDeepWindowStore({ signal: controller.signal });
    const id = windows.open(result("Tapo"), { status: "loading" });

    expect(windows.cancel(id)).toBe(true);
    expect(windows.getState().windows.find((item) => item.id === id)?.status).toBe("cancelled");
    controller.abort();
    expect(windows.getState().windows.find((item) => item.id === id)?.status).toBe("cancelled");
  });
});
