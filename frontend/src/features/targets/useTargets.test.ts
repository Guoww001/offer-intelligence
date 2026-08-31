import { describe, expect, it } from "vitest";

import { useTargets } from "./useTargets";

const report = {
  sheets: [
    {
      name: "Tier 1",
      rows: [{ "Merchant ID": "101", Clicks: "100", "Order count": "10", Revenue: "1,000" }]
    }
  ]
};

describe("useTargets", () => {
  it("initializes the latest report month, comparison month and target filters", () => {
    const targets = useTargets({
      reportData: report,
      today: () => new Date("2026-07-15T12:00:00")
    });

    expect(targets.month.value).toBe("July 2026");
    expect(targets.compareMonth.value).toBe("June 2026");
    expect(targets.tier.value).toBe("all");
    expect(targets.filteredRecords.value.length).toBeGreaterThan(0);
  });

  it("persists a target edit by month and tier, then exposes the updated goal", () => {
    const storage = new Map<string, string>();
    const targets = useTargets({
      reportData: report,
      targetStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value)
      },
      today: () => new Date("2026-07-15T12:00:00")
    });

    targets.setTarget("2026-07::Tier 1", "Revenue Target: $700K+");
    expect(targets.targetOverrides.value["2026-07::Tier 1"]).toBe("Revenue Target: $700K+");
    expect(targets.records.value.find((record) => record.monthKey === "2026-07" && record.tier === "Tier 1")?.target)
      .toBe("Revenue Target: $700K+");
    expect(storage.size).toBe(1);
  });

  it("drops stale status responses when the selected month changes", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const targets = useTargets({
      reportData: report,
      loadStatus: ({ monthKey }) => new Promise((resolve) => {
        resolvers.push((value) => resolve({ ...(value as object), month: monthKey }));
      }),
      today: () => new Date("2026-07-15T12:00:00")
    });

    const first = targets.loadStatusForMonth("2026-06");
    const second = targets.loadStatusForMonth("2026-07");
    resolvers[0]?.({ recentMonths: { aggregateOrders: [{ month: "2026-06", revenue: 1 }] } });
    await first;
    expect(targets.statusData.value).toBeNull();
    resolvers[1]?.({ recentMonths: { aggregateOrders: [{ month: "2026-07", revenue: 2 }] } });
    await second;
    expect(targets.statusData.value?.month).toBe("2026-07");
  });
});
