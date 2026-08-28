import { flushPromises } from "@vue/test-utils";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import type { PaymentExportPayload } from "../../shared/contracts/payment";
import PaymentsPage from "./PaymentsPage.vue";

const records = [
  {
    merchantId: "m-1",
    merchantName: "Acme",
    network: "Levanta",
    region: "US",
    tier: "Tier 2",
    category: "Beauty",
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
  },
  {
    merchantId: "m-2",
    merchantName: "Beta",
    network: "Levanta",
    region: "UK",
    tier: "Tier 1",
    category: "Home",
    reportMonth: "June",
    reportYear: 2026,
    reportMonthKey: "2026-06",
    revenueMade: 200,
    commissionMade: 40,
    expectedPaymentAmount: 40,
    paidAmount: 40,
    remainingAmount: 0,
    paymentCycle: 60,
    rawStatus: "paid",
    paymentMadeDate: "2026-08-01"
  },
  {
    merchantId: "zero",
    merchantName: "Zero Amount",
    reportMonth: "June",
    reportYear: 2026,
    reportMonthKey: "2026-06",
    revenueMade: 0,
    commissionMade: 0,
    rawStatus: "pending"
  }
];

function mountPayments(
  props: Partial<{
    records: readonly unknown[];
    language: "zh" | "en";
    autoSync: boolean;
    loadLive: () => Promise<{ records: readonly unknown[]; checkedAt?: string }>;
    download: (payload: PaymentExportPayload) => void;
  }> = {}
) {
  return mount(PaymentsPage, {
    attachTo: document.body,
    props: {
      records,
      language: "zh",
      today: "2026-08-27",
      ...props
    }
  });
}

describe("PaymentsPage", () => {
  it("保留旧页面的付款摘要、筛选和结果面板层级", () => {
    const wrapper = mountPayments();

    expect(wrapper.find(".payment-summary").exists()).toBe(true);
    expect(wrapper.find(".payment-status-row").exists()).toBe(true);
    expect(wrapper.find(".panel.payment-filters").exists()).toBe(true);
    expect(wrapper.find(".payment-layout").exists()).toBe(true);
    expect(wrapper.find(".table-panel.payment-table-panel").exists()).toBe(true);
    expect(wrapper.find(".table-toolbar").exists()).toBe(true);
    expect(wrapper.find(".table-wrap.payment-table-wrap").exists()).toBe(true);
    expect(wrapper.find("table.payment-table").exists()).toBe(true);
  });

  it("保留截图中的紧凑四列两行付款摘要结构", () => {
    const wrapper = mountPayments();

    expect(wrapper.get("h1").text()).toBe("付款");
    expect(wrapper.get(".payments-modern-summary").attributes("data-layout")).toBe("four-by-two");
    expect(wrapper.findAll(".payments-modern-summary-card")).toHaveLength(8);
    expect(wrapper.find(".payments-modern-table-heading .payments-modern-download").exists()).toBe(true);
    expect(wrapper.find(".payments-modern-export-bar").exists()).toBe(false);
    expect(wrapper.find('td[data-column="merchantName"] small').text()).toBe("Beauty");
    expect(wrapper.find(".payments-modern-results").exists()).toBe(true);
    expect(wrapper.find(".payments-modern-results .payments-modern-table-panel").exists()).toBe(true);
  });

  it("以中文渲染 modern root、筛选器、状态和可见记录", () => {
    const wrapper = mountPayments();

    expect(wrapper.find('.oi-modern-page[data-page="payments"]').exists()).toBe(true);
    expect(wrapper.find('select[aria-label="月份"]').exists()).toBe(true);
    expect(wrapper.find('input[aria-label="商家搜索"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("已付款");
    expect(wrapper.findAll("tbody tr[data-merchant-id]")).toHaveLength(2);
    expect(wrapper.text()).not.toContain("Zero Amount");
  });

  it("按状态和搜索筛选，并通过下载回调传出当前 rows", async () => {
    const downloads: PaymentExportPayload[] = [];
    const wrapper = mountPayments({ download: (payload) => downloads.push(payload) });

    await wrapper.get('select[aria-label="状态"]').setValue("Paid");
    expect(wrapper.findAll("tbody tr[data-merchant-id]")).toHaveLength(1);
    expect(wrapper.text()).toContain("Beta");

    await wrapper.get('select[aria-label="状态"]').setValue("all");
    await wrapper.get('input[aria-label="商家搜索"]').setValue("Acme");
    expect(wrapper.findAll("tbody tr[data-merchant-id]")).toHaveLength(1);

    await wrapper.get('button[aria-label="下载付款记录"]').trigger("click");
    expect(downloads[0]?.rows).toHaveLength(1);
    expect(downloads[0]?.rows[0]?.merchantName).toBe("Acme");
  });

  it("同步失败时保留已保存记录并显示 alert", async () => {
    const wrapper = mountPayments({
      autoSync: false,
      loadLive: async () => { throw new Error("503"); }
    });

    await wrapper.get('button[aria-label="同步 Levanta"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain("实时付款同步失败");
    expect(wrapper.findAll("tbody tr[data-merchant-id]")).toHaveLength(2);
  });

  it("英文文案和同步按钮保持可访问焦点", () => {
    const wrapper = mountPayments({ language: "en", autoSync: false });
    const syncButton = wrapper.get('button[aria-label="Sync Levanta"]');
    const syncButtonElement = syncButton.element as HTMLButtonElement;

    syncButtonElement.focus();

    expect(document.activeElement).toBe(syncButtonElement);
    expect(wrapper.find('select[aria-label="Status"]').exists()).toBe(true);
    expect(wrapper.find('button[aria-label="Download payment records"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Paid");
  });

  it("无可见记录时显示空状态并禁用下载", () => {
    const wrapper = mountPayments({ records: [] });

    expect(wrapper.find('[data-empty-state]').exists()).toBe(true);
    expect(wrapper.get('button[aria-label="下载付款记录"]').attributes("disabled")).toBeDefined();
  });
});
