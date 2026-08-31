import { describe, expect, it } from "vitest";

import {
  buildTierRows,
  defaultVisibleHeadersForTier,
  filterTierRows,
  formatTierCell,
  sortTierRows,
  tierCategorySummaries,
  tierPagination,
  tierReportDependencies,
  tierSummary,
  visibleHeadersForTier
} from "./tierSheetModel";

const report = {
  sheets: [
    {
      name: "Tier 1",
      headers: ["Merchant ID", "Merchant Name", "Network", "AOV", "Revenue", "Clicks", "Order count", "Conversion Rate", "Color"],
      rows: [
        { "Merchant ID": "101", "Merchant Name": "Alpha", Network: "Levanta", AOV: "154.489751", Revenue: "1000", Clicks: "100", "Order count": "10", "Conversion Rate": "0.1", Color: "yellow" }
      ]
    },
    {
      name: "Tier 2",
      headers: ["Merchant ID", "Merchant Name", "Network", "AOV", "Revenue", "Clicks", "Order count", "Conversion Rate", "Color"],
      rows: [
        { "Merchant ID": "202", "Merchant Name": "Beta", Network: "Archer", AOV: "22", Revenue: "500", Clicks: "50", "Order count": "5", "Conversion Rate": "0.1", Color: "green" }
      ]
    },
    { name: "Tier 3", headers: [], rows: [] },
    { name: "Tier 4", headers: [], rows: [] },
    { name: "BLACK TIER", headers: [], rows: [] }
  ]
};

describe("tierSheetModel", () => {
  it("keeps stable row keys and applies incoming manual moves", () => {
    const moves = {
      "merchant:101:Tier 1": {
        sourceTier: "Tier 1",
        targetTier: "Tier 2",
        merchantId: "101",
        merchantName: "Alpha"
      }
    } as const;
    const tierOne = buildTierRows(report, "Tier 1", undefined, moves);
    const tierTwo = buildTierRows(report, "Tier 2", undefined, moves);

    expect(tierOne).toHaveLength(0);
    expect(tierTwo.map((row) => [row.key, row.merchantId, row.sourceTier, row.currentTier])).toEqual([
      ["merchant:202:Tier 2", "202", "Tier 2", "Tier 2"],
      ["merchant:101:Tier 1", "101", "Tier 1", "Tier 2"]
    ]);
  });

  it("merges compact live metrics without losing snapshot fields", () => {
    const live = new Map<"Tier 1", { rows: readonly Readonly<Record<string, unknown>>[] }>([
      ["Tier 1", { rows: [{ "Merchant ID": "101", Revenue: "2500", Clicks: "200" }] }]
    ]);
    const rows = buildTierRows(report, "Tier 1", live);
    expect(rows[0]?.raw["Merchant Name"]).toBe("Alpha");
    expect(rows[0]?.raw.Revenue).toBe("2500");
    expect(rows[0]?.raw.Category).toBeUndefined();
  });

  it("resolves Tier categories from the first matching offer and keeps legacy summary math", () => {
    const rows = buildTierRows({
      ...report,
      offers: [{ merchantId: "101", sheetCategory: "Offer Priority" }]
    }, "Tier 1");
    expect(rows[0]?.category).toBe("Offer Priority");

    const summaryRows = [
      {
        ...rows[0]!,
        raw: { ...rows[0]!.raw, Revenue: "100", Clicks: "100", "Order count": "10", "EPC(Aff)": "1" }
      },
      {
        ...rows[0]!,
        key: "merchant:102:Tier 1",
        merchantId: "102",
        merchantName: "Beta",
        raw: { ...rows[0]!.raw, "Merchant ID": "102", "Merchant Name": "Beta", Revenue: "300", Clicks: "50", "Order count": "5", "EPC(Aff)": "2" }
      }
    ];
    expect(tierCategorySummaries(summaryRows)).toMatchObject([{
      category: "Offer Priority",
      revenue: 400,
      orders: 15,
      clicks: 150,
      avgEpc: (100 * 1 + 50 * 2) / 150,
      avgAov: 400 / 15,
      topMerchant: "Beta"
    }]);
  });

  it("preserves the legacy default column order and saved aliases", () => {
    const headers = ["Revenue", "BD", "Merchant ID", "Network", "AOV", "Clicks", "Conversion", "EPC(All)", "EPC(Aff)", "Order count", "Category"];
    expect(defaultVisibleHeadersForTier("Tier 2", headers)).toEqual([
      "Merchant ID", "Network", "Category", "Clicks", "AOV", "Conversion", "Revenue", "EPC(All)", "EPC(Aff)"
    ]);
    expect(visibleHeadersForTier("Tier 1", ["Merchant ID", "BD", "Clicks"], ["Merchant ID", "Business Manager", "Clicks"])).toEqual([
      "Merchant ID", "BD", "Clicks"
    ]);
  });

  it("filters, sorts, summarizes, paginates, and formats using legacy metric rules", () => {
    const rows = buildTierRows(report, "Tier 1");
    const filtered = filterTierRows(rows, { search: "alpha", network: "all", country: "all", minEpc: "", minRevenue: "900" });
    expect(filtered).toHaveLength(1);
    const firstRow = rows[0];
    if (!firstRow) throw new Error("expected a tier row");
    expect(sortTierRows([...rows, { ...firstRow, key: "merchant:999:Tier 1", merchantId: "999", raw: { ...firstRow.raw, Revenue: "50" } }], "Revenue", "desc").map((row) => row.raw.Revenue)).toEqual(["1000", "50"]);
    expect(tierSummary(rows)).toMatchObject({ rowCount: 1, revenue: 1000, orders: 10, clicks: 100, avgConversion: 0.1 });
    expect(tierPagination(Array.from({ length: 501 }, (_, index) => ({ ...firstRow, key: String(index) })), 2, 500).rows).toHaveLength(1);
    expect(formatTierCell("Tier 1", { AOV: "154.489751", COUNTRY: "US" }, "AOV")).toBe("$154.49");
    expect(formatTierCell("Tier 1", { "Conversion Rate": "0.125" }, "Conversion Rate")).toBe("12.5%");
  });

  it("loads incoming move sources with the selected tier", () => {
    expect(tierReportDependencies("Tier 2", {
      first: { sourceTier: "Tier 1", targetTier: "Tier 2" },
      second: { sourceTier: "Tier 4", targetTier: "Tier 2" },
      unrelated: { sourceTier: "Tier 3", targetTier: "Tier 1" }
    })).toEqual(["Tier 2", "Tier 1", "Tier 4"]);
  });
});
