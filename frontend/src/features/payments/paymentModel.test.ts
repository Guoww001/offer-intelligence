import { describe, expect, it } from "vitest";

import {
  buildPaymentSummary,
  filterPaymentRecords,
  normalizePaymentRecord,
  paymentCurrencySymbol,
  paymentFilterOptions,
  sortPaymentRecords,
  visiblePaymentRecords,
  withPendingPaymentPlaceholders
} from "./paymentModel";

const baseRecord = {
  merchantId: "m-1",
  merchantName: "Acme",
  network: "Levanta",
  region: "US",
  tier: "Tier 2",
  reportMonth: "March",
  reportYear: 2026,
  reportMonthKey: "2026-03",
  revenueMade: 100,
  commissionMade: 20,
  expectedPaymentAmount: 20,
  paidAmount: 0,
  remainingAmount: 20,
  paymentCycle: 60,
  rawStatus: "pending"
};

describe("paymentModel", () => {
  it("将到期且仍有余额的记录派生为 Overdue", () => {
    const result = normalizePaymentRecord(baseRecord, { today: "2026-06-10" });

    expect(result?.paymentStatus).toBe("Overdue");
    expect(result?.expectedPaymentDate).toBe("2026-05-01");
  });

  it("生成 placeholder 但从可见记录中排除零金额行", () => {
    const normalized = normalizePaymentRecord(baseRecord, { today: "2026-08-27" });
    const withPlaceholders = withPendingPaymentPlaceholders([normalized!], ["May", "June"]);

    expect(withPlaceholders.some((row) => row.isPlaceholder && row.reportMonth === "May")).toBe(true);
    expect(visiblePaymentRecords(withPlaceholders).every(
      (row) => row.revenueMade > 0 || row.commissionMade > 0
    )).toBe(true);
  });

  it("按月份、状态和商户搜索过滤，并按状态优先级稳定排序", () => {
    const rows = [
      normalizePaymentRecord(baseRecord, { today: "2026-06-10" })!,
      normalizePaymentRecord({
        ...baseRecord,
        merchantId: "m-2",
        merchantName: "Beta",
        paymentStatus: "Paid",
        paidAmount: 20,
        remainingAmount: 0
      }, { today: "2026-06-10" })!
    ];

    expect(filterPaymentRecords(rows, {
      month: "March",
      network: "all",
      region: "all",
      tier: "all",
      status: "Overdue",
      search: "acme"
    })).toHaveLength(1);
    expect(sortPaymentRecords(rows, { key: "", direction: "asc" })[0]?.paymentStatus).toBe("Overdue");
  });

  it("按记录状态计算摘要，并保留区域币种符号规则", () => {
    const rows = [
      normalizePaymentRecord(baseRecord, { today: "2026-06-10" })!,
      normalizePaymentRecord({
        ...baseRecord,
        merchantId: "m-2",
        merchantName: "Beta",
        region: "UK",
        paymentStatus: "Paid",
        paidAmount: 20,
        remainingAmount: 0
      }, { today: "2026-06-10" })!
    ];
    const summary = buildPaymentSummary(rows);

    expect(summary).toMatchObject({
      recordCount: 2,
      merchantCount: 2,
      totalRevenueMade: 200,
      totalCommissionMade: 40,
      overdueMerchantCount: 1,
      paidMerchantCount: 1
    });
    expect(paymentCurrencySymbol({ region: "UK" })).toBe("£");
    expect(paymentCurrencySymbol({ currency: "EUR" })).toBe("€");
  });

  it("月份筛选使用稳定的月份名称，不重复暴露月份 key", () => {
    const rows = [
      normalizePaymentRecord(baseRecord, { today: "2026-06-10" })!,
      normalizePaymentRecord({ ...baseRecord, reportMonth: "June", reportMonthKey: "2026-06" }, { today: "2026-06-10" })!
    ];

    const months = paymentFilterOptions(rows).months;
    expect(months).toEqual(["February", "March", "April", "May", "June"]);
    expect(months).not.toContain("2026-03");
    expect(months).not.toContain("2026-06");
  });
});
