import { describe, expect, it } from "vitest";

import {
  buildTargetRecords,
  formatTargetMetricValue,
  parseSheetNumber,
  targetGoal,
  targetMonthlyTrendRows,
  targetSummary,
  type TargetReportData
} from "./targetModel";

const report: TargetReportData = {
  sheets: [
    {
      name: "Tier 1",
      rows: [
        { "Merchant ID": "101", Clicks: "100", "Order count": "10", Revenue: "$1,000.00", Payout: "100", Category: "Home" },
        { "Merchant ID": "102", Clicks: "50", "Order count": "5", Revenue: "500", Payout: "50", Category: "Home" }
      ]
    },
    {
      name: "Tier 2",
      rows: [
        { "Merchant ID": "201", Clicks: "200", "Order count": "20", Revenue: "2,000", Payout: "250", Category: "Beauty" }
      ]
    }
  ]
};

describe("targetModel", () => {
  it("derives tier target records from the existing sheet report and keeps the June preset", () => {
    const records = buildTargetRecords(report, {
      today: () => new Date("2026-07-15T12:00:00")
    });
    const juneTierOne = records.find((record) => record.monthKey === "2026-06" && record.tier === "Tier 1");
    const julyTotal = records.find((record) => record.monthKey === "2026-07" && record.tier === "Total");

    expect(juneTierOne?.target).toBe("Revenue Target: $500K+");
    expect(julyTotal?.brandCount).toBe(3);
    expect(julyTotal?.revenue).toBe(3500);
    expect(records.some((record) => record.monthKey === "2026-05")).toBe(true);
  });

  it("parses targets, totals and metric formatting without changing business units", () => {
    expect(parseSheetNumber("$1,234.50")).toBe(1234.5);
    const record = {
      tier: "Tier 1",
      target: "Revenue Target: $500K+; Brand Target: 20+",
      revenue: 655419.44,
      clicks: 75460,
      orders: 47854,
      brandCount: 42,
      exits: 0
    };
    expect(targetGoal(record)).toMatchObject({ type: "gmv", target: 500000, actual: 655419.44 });
    expect(targetSummary([record]).conversionRate).toBeCloseTo(47854 / 75460, 8);
    expect(formatTargetMetricValue("revenue", 1234567)).toBe("$1.23M");
    expect(formatTargetMetricValue("conversion", 0.125)).toBe("12.5%");
  });

  it("keeps a six-month monthly trend window ending at the selected month", () => {
    const records = buildTargetRecords(report, {
      today: () => new Date("2026-07-15T12:00:00")
    });
    const rows = targetMonthlyTrendRows(records, {
      selectedMonth: "July 2026",
      tier: "all",
      metric: "revenue"
    });

    expect(rows.at(-1)?.label).toBe("July 2026");
    expect(rows.at(-1)?.value).toBe(3500);
    expect(rows.length).toBeLessThanOrEqual(6);
  });
});
