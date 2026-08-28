import { describe, expect, it } from "vitest";

import { normalizePublishersPayload } from "./publisherModel";
import { usePublishers } from "./usePublishers";

const rawPayload = {
  publishers: [{ userId: 1, userName: "Media One", adminName: "Dora", networks: [], linkTypes: {}, merchantIds: [], markets: {}, total: { clicks: 1 } }],
  markets: [],
  networks: [],
  linkTypes: [],
  merchantNameMap: {},
  dailyRows: {}
};

describe("usePublishers", () => {
  it("loads the publisher payload and reports a controlled error", async () => {
    const publishers = usePublishers({
      loadData: async () => rawPayload
    });

    expect(publishers.loading.value).toBe(false);
    await publishers.load();
    expect(publishers.rows.value).toHaveLength(1);
    expect(publishers.rows.value[0]?.userName).toBe("Media One");
    expect(publishers.error.value).toBe("");
  });

  it("caches portfolio requests by publisher and date range", async () => {
    let calls = 0;
    const publishers = usePublishers({
      loadData: async () => rawPayload,
      loadPortfolio: async () => {
        calls += 1;
        return { merchants: [] };
      }
    });

    const first = await publishers.loadPortfolio("1", "2026-08-01", "2026-08-02");
    const second = await publishers.loadPortfolio("1", "2026-08-01", "2026-08-02");
    expect(first).toBe(second);
    expect(calls).toBe(1);
  });

  it("restores and persists the six-section layout while leaving edit mode controllable", () => {
    const publishers = usePublishers({ loadData: async () => rawPayload });
    publishers.setLayout(["table", "filters", "kpi", "affinity", "overview", "chart"]);
    publishers.setLayoutEditing(true);
    expect(publishers.layout.value[0]).toBe("table");
    expect(publishers.layoutEditing.value).toBe(true);
    publishers.setLayoutEditing(false);
    expect(publishers.layoutEditing.value).toBe(false);
  });

  it("normalizes the public payload before exposing rows", () => {
    expect(normalizePublishersPayload(rawPayload).publishers[0]?.userId).toBe("1");
  });
});
