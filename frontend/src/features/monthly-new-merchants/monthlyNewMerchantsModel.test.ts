import { describe, expect, it } from "vitest";

import {
  buildMonthlyNewMerchantPayload,
  filterMonthlyNewMerchantRecords,
  monthlyNewMerchantImportRows,
  monthlyNewMerchantTargetTotal,
  normalizeMonthlyNewMerchantRecord,
  parseMonthlyNewMerchantTable,
  resolveMonthlyNewMerchantId
} from "./monthlyNewMerchantsModel";

const offers = [
  { merchantId: "380945", brand: "Merach", tier: "Tier 1", network: "Levanta" },
  { merchantId: "363268", brand: "Manspot", tier: "Tier 2", network: "Levanta" },
  { merchantId: "363269", brand: "Manspot", tier: "Tier 2", network: "Amazon" }
];

describe("monthlyNewMerchantsModel", () => {
  it("normalizes manual records and resolves a missing merchant ID from offers", () => {
    expect(normalizeMonthlyNewMerchantRecord({
      recordId: "12",
      reportMonth: "2026-08",
      merchantName: "  Merach  ",
      platform: "Levanta",
      ourCommission: "35.00",
      presetCommission: "20",
      isPriority: 1,
      gmvMonthlyTarget: "12500.50"
    }, offers)).toMatchObject({
      recordId: 12,
      merchantId: "380945",
      merchantName: "Merach",
      ourCommission: 35,
      presetCommission: 20,
      isPriority: true,
      gmvMonthlyTarget: 12500.5
    });
    expect(resolveMonthlyNewMerchantId({ merchantName: "Manspot", platform: "Amazon" }, offers)).toBe("363269");
    expect(resolveMonthlyNewMerchantId({ merchantId: "999", merchantName: "Merach" }, offers)).toBe("999");
  });

  it("parses quoted CSV cells and maps import rows with duplicate and field errors", () => {
    expect(parseMonthlyNewMerchantTable(
      'Brand,Program,Reviews Numbers\n"Acme, Inc.",Amazon,"4.8/5 from 1,250 ratings"'
    )).toEqual([
      ["Brand", "Program", "Reviews Numbers"],
      ["Acme, Inc.", "Amazon", "4.8/5 from 1,250 ratings"]
    ]);

    const result = monthlyNewMerchantImportRows(parseMonthlyNewMerchantTable(
      "Brand\tMerchant ID\tProgram\tGMV need to be reach\tOur Commission\n"
      + "Merach\t380945\tAmazon\t$ 100,000.00\t35%\n"
      + "Merach\tbad-id\tAmazon\tMake Money\t125%"
    ), "2026-08");

    expect(result.recognizedHeaders).toBe(5);
    expect(result.rows[0]?.payload.gmvMonthlyTarget).toBe(100000);
    expect(result.rows[1]?.errors).toEqual(expect.arrayContaining([
      "Merchant ID must be numeric.",
      "Commission must be between 0% and 100%: 125%",
      "Duplicate brand in this import."
    ]));
    expect(result.rows[0]?.errors).toContain("Duplicate brand in this import.");
  });

  it("filters the visible fields and totals only numeric GMV targets", () => {
    const records = [
      { recordId: 1, merchantId: "101", merchantName: "Alpha Home", businessManager: "Dora", gmvMonthlyTarget: 50000 },
      { recordId: 2, merchantId: "202", merchantName: "Beta Beauty", businessManager: "Alex", gmvMonthlyTarget: null }
    ];
    expect(filterMonthlyNewMerchantRecords(records, "dora").map((record) => record.recordId)).toEqual([1]);
    expect(filterMonthlyNewMerchantRecords(records, "202").map((record) => record.recordId)).toEqual([2]);
    expect(monthlyNewMerchantTargetTotal([
      { gmvMonthlyTarget: 50000 },
      { gmvMonthlyTarget: null },
      { gmvMonthlyTarget: "12500.50" }
    ])).toBe(62500.5);
  });

  it("serializes optional fields into the existing database API contract", () => {
    expect(buildMonthlyNewMerchantPayload({
      recordId: "8",
      reportMonth: "2026-08",
      merchantId: "380001",
      merchantName: " Full merchant ",
      businessManager: "Dora",
      platform: "Levanta",
      gmvMonthlyTarget: "50000.25",
      ourCommission: "35%",
      presetCommission: "20",
      isPriority: true
    })).toEqual({
      action: "upsert",
      recordId: 8,
      reportMonth: "2026-08",
      merchantId: "380001",
      merchantName: "Full merchant",
      businessManager: "Dora",
      program: "",
      platform: "Levanta",
      gmvRequirement: "",
      pastMonthPurchase: "",
      independentWebsites: "",
      reviewSummary: "",
      ourCommission: 35,
      presetCommission: 20,
      isPriority: true,
      gmvMonthlyTarget: 50000.25,
      completionReward: ""
    });
  });
});
