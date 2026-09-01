import { describe, expect, it } from "vitest";

import { useTierSheet } from "./useTierSheet";

const report = {
  sheets: [
    { name: "Tier 1", headers: ["Merchant ID", "Merchant Name", "Network", "Revenue", "Clicks"], rows: [{ "Merchant ID": "101", "Merchant Name": "Alpha", Network: "Levanta", Revenue: "100", Clicks: "10" }] },
    { name: "Tier 2", headers: ["Merchant ID", "Merchant Name", "Network", "Revenue", "Clicks"], rows: [{ "Merchant ID": "202", "Merchant Name": "Beta", Network: "Archer", Revenue: "200", Clicks: "20" }] },
    { name: "Tier 3", headers: [], rows: [] },
    { name: "Tier 4", headers: [], rows: [] },
    { name: "BLACK TIER", headers: [], rows: [] }
  ]
};

function storage() {
  const values = new Map<string, string>([["offerTierVisibleColumns.v4", JSON.stringify({ "Tier 1": ["Merchant ID", "Revenue"] })]]);
  return {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    values
  };
}

describe("useTierSheet", () => {
  it("coordinates filters, columns, selection, overlay, and persisted moves", async () => {
    const local = storage();
    const tier = useTierSheet({ reportData: report, initialTier: "Tier 1", autoLoad: false, storage: local });
    expect(tier.displayHeaders.value).toEqual(["Merchant ID", "Revenue"]);
    expect(tier.filteredRows.value).toHaveLength(1);

    tier.toggleRowSelection(tier.rows.value[0]?.key || "", true);
    expect(tier.selectedCount.value).toBe(1);
    expect(tier.openMoveDialog()).toBe(true);
    tier.setMoveTarget("Tier 2");
    await tier.moveSelectedRows();
    expect(tier.manualMoves.value["merchant:101:Tier 1"]?.targetTier).toBe("Tier 2");
    expect(tier.rows.value).toHaveLength(0);
    expect(JSON.parse(local.values.get("offerTierSheetManualMoves.v1") || "{}")["merchant:101:Tier 1"].targetTier).toBe("Tier 2");

    tier.selectTier("Tier 2");
    expect(tier.rows.value.map((row) => row.merchantId)).toEqual(["202", "101"]);
    tier.openOverlay();
    expect(tier.expanded.value).toBe(true);
    tier.closeOverlay();
    expect(tier.expanded.value).toBe(false);
  });

  it("drops an old tier API response after the date range changes", async () => {
    let resolveRequest: ((value: unknown) => void) | null = null;
    const tier = useTierSheet({
      reportData: report,
      initialTier: "Tier 1",
      autoLoad: false,
      loadTier: () => new Promise((resolve) => { resolveRequest = resolve; })
    });
    tier.setDateRange("2026-08-01", "2026-08-31");
    const request = tier.loadSelectedTier();
    tier.setDateRange("2026-09-01", "2026-09-30");
    const resolve = resolveRequest as ((value: unknown) => void) | null;
    if (resolve) resolve({ rows: [{ "Merchant ID": "101", Revenue: "999" }] });
    await request;
    expect(tier.loadedTiers.value).toEqual([]);
    expect(tier.loading.value).toBe(false);
  });

  it("uses the cached report range when refreshing live tier metrics", async () => {
    const cachedTierOne = report.sheets[0];
    if (!cachedTierOne) throw new Error("Tier 1 test fixture is missing");
    const cachedReport = {
      ...report,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      sheets: [
        {
          ...cachedTierOne,
          rows: [{ ...cachedTierOne.rows[0], "Order count": "1" }]
        },
        ...report.sheets.slice(1)
      ]
    };
    const requests: Array<{ startDate: string; endDate: string }> = [];
    const tier = useTierSheet({
      reportData: cachedReport,
      initialTier: "Tier 1",
      today: () => new Date("2026-09-01T00:00:00"),
      autoLoad: false,
      loadTier: async ({ startDate, endDate }) => {
        requests.push({ startDate, endDate });
        return {
          rows: [{
            "Merchant ID": "101",
            Revenue: startDate === "2026-08-01" ? "100" : "0",
            Clicks: startDate === "2026-08-01" ? "10" : "0",
            "Order count": startDate === "2026-08-01" ? "1" : "0"
          }]
        };
      }
    });

    await tier.loadSelectedTier();

    expect(requests).toEqual([{ startDate: "2026-08-01", endDate: "2026-08-31" }]);
    expect(tier.summary.value).toMatchObject({ clicks: 10, orders: 1, revenue: 100, avgConversion: 0.1 });
  });

  it("keeps one visible row selected when selecting all and prevents empty columns", () => {
    const tier = useTierSheet({ reportData: report, initialTier: "Tier 1", autoLoad: false, storage: storage() });
    tier.selectAllVisible(true);
    expect(tier.selectedCount.value).toBe(1);
    tier.setVisibleHeaders([]);
    expect(tier.displayHeaders.value.length).toBeGreaterThan(0);
  });
});
