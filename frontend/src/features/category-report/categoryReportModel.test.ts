import { describe, expect, it } from "vitest";

import {
  aggregateCategoryGroups,
  buildCategoryPieSlices,
  buildCategoryRows,
  buildCategoryTrendRows,
  categoryKey,
  filterCategoryGroups,
  resolveCategory,
  sortCategoryGroups,
  type CategoryReportRow
} from "./categoryReportModel";

const report = {
  offers: [
    {
      merchantId: "101",
      merchantName: "Alpha",
      sheetCategory: "Sheet Priority",
      mainCategory: "Main Priority",
      feishuMainCategory: "Feishu Priority",
      category: "Other Priority",
      levantaCategory: "Levanta Priority"
    },
    {
      merchantId: "102",
      merchantName: "Beta",
      mainCategory: "Main Only",
      category: "Other Fallback"
    }
  ],
  sheets: [
    {
      name: "Tier 1",
      rows: [
        {
          "Merchant ID": "101",
          "Merchant Name": "Alpha",
          Category: "Sheet Row Category",
          Revenue: "1,000",
          "Order count": "10",
          Clicks: "100",
          "EPC(Aff)": "1.20"
        },
        {
          "Merchant ID": "102",
          "Merchant Name": "Beta",
          Category: "Main Only",
          Revenue: "500",
          "Order count": "5",
          Clicks: "50",
          "EPC(Aff)": "0.80"
        }
      ]
    },
    {
      name: "Tier 2",
      rows: [
        {
          "Merchant ID": "201",
          "Merchant Name": "Gamma",
          "Sheet Category": "Beauty",
          Revenue: "2,000",
          "Order count": "20",
          Clicks: "200"
        }
      ]
    }
  ]
};

describe("categoryReportModel", () => {
  it("keeps the documented category source precedence", () => {
    expect(resolveCategory({
      sheetCategory: "Sheet",
      mainCategory: "Main",
      feishuMainCategory: "Feishu",
      category: "Other",
      levantaCategory: "Levanta"
    })).toMatchObject({ category: "Sheet", source: "sheetCategory" });
    expect(resolveCategory({
      mainCategory: "Main",
      feishuMainCategory: "Feishu",
      category: "Other",
      levantaCategory: "Levanta"
    })).toMatchObject({ category: "Main", source: "mainCategory" });
    expect(resolveCategory({
      feishuMainCategory: "Feishu",
      category: "Other",
      categorySource: "Feishu",
      levantaCategory: "Levanta"
    })).toMatchObject({ category: "Feishu", source: "feishu" });
    expect(resolveCategory({ category: "Other", levantaCategory: "Levanta" }))
      .toMatchObject({ category: "Other", source: "other" });
    expect(resolveCategory({ levantaCategory: "Levanta" }))
      .toMatchObject({ category: "Levanta", source: "levantaCategory" });
    expect(resolveCategory({})).toMatchObject({ category: "Uncategorized", source: "uncategorized" });
  });

  it("does not use category paths as the main category fallback", () => {
    expect(resolveCategory({ categoryPath: "Uncategorized > Robotic Vacuums" }))
      .toMatchObject({ category: "Uncategorized", source: "uncategorized" });
  });

  it("normalizes rows, joins offer metadata, and aggregates unique merchants", () => {
    const rows = buildCategoryRows(report, ["Tier 1", "Tier 2"]);
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.merchantId === "101")).toMatchObject({
      category: "Sheet Priority",
      tier: "Tier 1",
      revenue: 1000,
      orders: 10,
      clicks: 100
    });
    const groups = aggregateCategoryGroups(rows);
    expect(groups.find((group) => group.category === "Sheet Priority")).toMatchObject({
      merchantCount: 1,
      revenue: 1000,
      avgCvr: 0.1,
      avgEpc: 1.2,
      avgAov: 100
    });
    expect(groups.find((group) => group.category === "Beauty")).toMatchObject({
      tierBreakdown: { "Tier 2": 1 }
    });
  });

  it("filters and sorts exact category or merchant selections", () => {
    const groups = aggregateCategoryGroups(buildCategoryRows(report, ["Tier 1", "Tier 2"]));
    expect(sortCategoryGroups(groups, "revenue", "desc")[0]?.category).toBe("Beauty");
    expect(sortCategoryGroups(groups, "category", "asc").map((group) => group.category))
      .toEqual(["Beauty", "Main Only", "Sheet Priority"]);
    expect(filterCategoryGroups(groups, { type: "category", category: "Main Only" })[0]?.category)
      .toBe("Main Only");
    expect(filterCategoryGroups(groups, { type: "merchant", merchantId: "101", merchantName: "Alpha" })[0]?.category)
      .toBe("Sheet Priority");
  });

  it("creates a drillable top-seven pie and aggregates overflow as Other", () => {
    const pieRow = (index: number): CategoryReportRow => ({
      key: "pie-" + String(index),
      tier: "Tier 1",
      merchantId: String(index + 1),
      merchantName: "Merchant " + String(index + 1),
      category: "Category " + String(index + 1),
      categorySource: "mainCategory",
      network: "",
      country: "",
      revenue: 0,
      orders: 0,
      clicks: 0,
      payout: 0,
      epc: null,
      aov: null,
      cvr: null,
      monthKey: "",
      raw: {}
    });
    const groups = Array.from({ length: 9 }, (_, index) => ({
      category: "Category " + String(index + 1),
      rows: [pieRow(index)],
      merchantCount: 1,
      rowCount: 1,
      revenue: 1000 - index * 50,
      orders: 100 - index,
      clicks: 200 - index,
      avgCvr: 0.5,
      avgEpc: 2,
      avgAov: 10,
      topMerchant: "Merchant " + String(index + 1),
      previewMerchants: "Merchant " + String(index + 1),
      tierBreakdown: { "Tier 1": 1 }
    }));
    const slices = buildCategoryPieSlices(groups, ["Tier 1", "Tier 2", "Tier 3", "Tier 4"]);
    expect(slices).toHaveLength(8);
    expect(slices.at(-1)?.key).toBe("other-categories");
    expect(slices.at(-1)?.group.rows).toHaveLength(2);
    expect(slices.reduce((sum, slice) => sum + slice.share, 0)).toBeCloseTo(1, 6);
    expect(categoryKey("Beauty & Personal Care")).toBe("beauty-personal-care");
  });

  it("aggregates category trend rows without truncating merchants", () => {
    const rows = buildCategoryRows({
      sheets: [{
        name: "Tier 1",
        rows: Array.from({ length: 3 }, (_, index) => ({
          "Merchant ID": String(300 + index),
          "Merchant Name": "Trend " + String(index),
          Category: "Trend Category",
          Month: "2026-08",
          Revenue: String(100 + index),
          "Order count": "2",
          Clicks: "10"
        }))
      }]
    }, ["Tier 1"]);
    const trend = buildCategoryTrendRows(rows, "Trend Category");
    expect(trend).toHaveLength(1);
    expect(trend[0]).toMatchObject({ monthKey: "2026-08", revenue: 303, orders: 6, clicks: 30 });
  });
});
