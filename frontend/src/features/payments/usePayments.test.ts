import { describe, expect, it } from "vitest";

import { usePayments } from "./usePayments";

const savedRecord = {
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

describe("usePayments", () => {
  it("live sync 成功后替换可见记录并保存 checkedAt", async () => {
    const payments = usePayments({
      records: [savedRecord],
      today: "2026-08-27",
      loadLive: async () => ({
        records: [{
          ...savedRecord,
          merchantId: "m-2",
          merchantName: "Beta",
          paymentStatus: "Paid",
          paidAmount: 20,
          remainingAmount: 0
        }],
        checkedAt: "2026-08-27"
      })
    });

    await payments.sync();

    expect(payments.rows.value).toHaveLength(1);
    expect(payments.rows.value[0]?.merchantName).toBe("Beta");
    expect(payments.source.value).toBe("live");
    expect(payments.checkedAt.value).toBe("2026-08-27");
    expect(payments.error.value).toBe("");
  });

  it("live sync 失败时保留 saved rows 并暴露受控错误", async () => {
    const payments = usePayments({
      records: [savedRecord],
      today: "2026-08-27",
      loadLive: async () => { throw new Error("503"); }
    });

    await payments.sync();

    expect(payments.rows.value).toHaveLength(1);
    expect(payments.rows.value[0]?.merchantName).toBe("Acme");
    expect(payments.source.value).toBe("saved");
    expect(payments.loading.value).toBe(false);
    expect(payments.error.value).toBe("payments.syncError");
  });

  it("筛选和排序只更新 derived rows，不清空已加载数据", () => {
    const payments = usePayments({ records: [savedRecord], today: "2026-08-27" });

    payments.setFilter("status", "Paid");

    expect(payments.rows.value).toHaveLength(1);
    expect(payments.filteredRows.value).toHaveLength(0);
    payments.setFilter("status", "all");
    expect(payments.filteredRows.value).toHaveLength(1);
  });
});
