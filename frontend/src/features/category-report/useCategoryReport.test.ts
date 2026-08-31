import { describe, expect, it } from "vitest";

import { useCategoryReport } from "./useCategoryReport";

const report = {
  sheets: [
    {
      name: "Tier 1",
      rows: [
        { "Merchant ID": "101", "Merchant Name": "Alpha", Category: "Home", Revenue: "1,000", "Order count": "10", Clicks: "100" },
        { "Merchant ID": "102", "Merchant Name": "Beta", Category: "Beauty", Revenue: "500", "Order count": "5", Clicks: "50" }
      ]
    },
    {
      name: "Tier 2",
      rows: [{ "Merchant ID": "201", "Merchant Name": "Gamma", Category: "Home", Revenue: "2,000", "Order count": "20", Clicks: "200" }]
    }
  ]
};

describe("useCategoryReport", () => {
  it("initializes the legacy tier selection and exposes grouped rows", () => {
    const category = useCategoryReport({ reportData: report, autoLoad: false });

    expect(category.selectedTiers.value).toEqual(["Tier 1", "Tier 2", "Tier 3", "Tier 4"]);
    expect(category.groups.value.map((group) => group.category)).toEqual(["Home", "Beauty"]);
    expect(category.summary.value).toMatchObject({ merchantCount: 3, revenue: 3500, orders: 35, clicks: 350 });
    expect(category.searchEntries.value.some((entry) => entry.type === "merchant" && entry.value === "Gamma · 201")).toBe(true);
  });

  it("links search selection, pie focus, expansion, and sort state", () => {
    const category = useCategoryReport({ reportData: report, autoLoad: false });

    expect(category.applySearch("Home")).toBe(true);
    expect(category.selection.value).toMatchObject({ type: "category", category: "Home" });
    expect(category.groups.value).toHaveLength(1);
    category.setSort("category");
    expect(category.sortKey.value).toBe("category");
    expect(category.sortDirection.value).toBe("asc");
    category.clearSearch();
    category.setFocus("beauty");
    expect(category.visibleGroups.value[0]?.category).toBe("Beauty");
    category.toggleExpanded("beauty");
    expect(category.expandedKey.value).toBe("beauty");
  });

  it("drops stale tier-sheet responses after a date-range change", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const category = useCategoryReport({
      reportData: report,
      selectedTiers: ["Tier 1"],
      autoLoad: false,
      loadTier: ({ tier }) => new Promise((resolve) => {
        resolvers.push((value) => resolve({ ...(value as object), tier }));
      })
    });

    const first = category.loadSelectedTiers();
    category.setDateRange("2026-08-01", "2026-08-31");
    const second = category.loadSelectedTiers();
    resolvers[0]?.({ rows: [{ "Merchant ID": "101", "Merchant Name": "Stale", Category: "Stale", Revenue: "999" }] });
    await first;
    expect(category.groups.value.some((group) => group.category === "Stale")).toBe(false);
    for (const resolve of resolvers.slice(1)) {
      resolve({ rows: [{ "Merchant ID": "101", "Merchant Name": "Live", Category: "Live", Revenue: "2,000" }] });
    }
    await second;
    expect(category.loading.value).toBe(false);
    expect(category.source.value).toBe("database");
  });
});
