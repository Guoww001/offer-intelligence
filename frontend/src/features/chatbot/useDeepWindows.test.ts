import { describe, expect, it } from "vitest";

import { useDeepWindows } from "./useDeepWindows";
import type { ChatbotReportViewResult } from "./chatbotViewTypes";

const result = (query: string): ChatbotReportViewResult => ({
  intent: "merchant",
  status: "resolved",
  query,
  source: "db",
  rows: [],
  summary: { offerCount: 0, clicks: 0, orders: 0, revenue: 0, commission: 0, conversionRate: null },
  message: query
});

describe("useDeepWindows", () => {
  it("keeps multiple panels and supports active-panel lifecycle controls", () => {
    const windows = useDeepWindows();
    const first = windows.open(result("Tapo"));
    const second = windows.open(result("Shokz"));

    expect(windows.windows.value).toHaveLength(2);
    expect(windows.deepWindow.value?.id).toBe(second);
    windows.pin(first);
    windows.move(first, 48, 72);
    windows.minimize(first);
    expect(windows.windows.value.find((item) => item.id === first)).toMatchObject({
      pinned: true,
      minimized: true,
      position: { x: 48, y: 72 }
    });

    windows.restore(first);
    windows.activate(first);
    expect(windows.deepWindow.value?.result.query).toBe("Tapo");
    expect(windows.clone(first)).not.toBeNull();
    expect(windows.windows.value).toHaveLength(3);
    expect(windows.toggleOverlay(first)).toBe(true);
    expect(windows.export(first)?.query).toBe("Tapo");
    expect(windows.cancel(first)).toBe(true);
    expect(windows.windows.value.find((item) => item.id === first)?.status).toBe("cancelled");

    windows.close(second);
    expect(windows.windows.value.some((item) => item.id === second)).toBe(false);
    windows.clear();
    expect(windows.windows.value).toHaveLength(0);
    expect(windows.deepWindow.value).toBeNull();
  });
});
