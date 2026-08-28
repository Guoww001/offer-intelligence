import { describe, expect, it } from "vitest";

import { useRevenueFlow } from "./useRevenueFlow";

const catalog = {
  merchantNameMap: {
    "101": "Alpha",
    "202": "Beta"
  },
  publishers: [
    { merchantIds: [101] },
    { merchantIds: [202] }
  ]
};

const trendPayload = {
  ok: true,
  merchants: [
    { merchantId: "101", merchantName: "Alpha" },
    { merchantId: "202", merchantName: "Beta" }
  ],
  dateRange: { startDate: "2026-08-01", endDate: "2026-08-27" },
  sankey: {
    available: true,
    nodes: [
      { id: "brand:101", type: "brand", label: "Alpha", merchantId: "101", value: 10 },
      { id: "brand:202", type: "brand", label: "Beta", merchantId: "202", value: 5 },
      { id: "product:101:A", type: "product", label: "Alpha A", merchantId: "101", productKey: "A", value: 10 },
      { id: "product:202:B", type: "product", label: "Beta B", merchantId: "202", productKey: "B", value: 5 },
      { id: "media:7", type: "media", label: "Media Seven", userId: "7", value: 15 }
    ],
    links: [
      { source: "brand:101", target: "product:101:A", value: 10 },
      { source: "brand:202", target: "product:202:B", value: 5 },
      { source: "product:101:A", target: "media:7", value: 10 },
      { source: "product:202:B", target: "media:7", value: 5 }
    ],
    summary: { totalRevenue: 15 }
  }
};

describe("useRevenueFlow", () => {
  it("使用昨天作为结束日期，并限制最多 12 个品牌", () => {
    const options = Array.from({ length: 14 }, (_, index) => ({
      merchantId: String(index + 1),
      name: "Brand " + String(index + 1),
      count: 1
    }));
    const flow = useRevenueFlow({
      catalogData: {
        merchants: options.map((option) => ({
          merchantId: option.merchantId,
          merchantName: option.name,
          count: option.count
        }))
      },
      today: () => new Date("2026-08-28T12:00:00")
    });

    flow.setQuickRange(30);
    expect(flow.startDate.value).toBe("2026-07-29");
    expect(flow.endDate.value).toBe("2026-08-27");

    options.slice(0, 12).forEach((option) => flow.toggleMerchant(option));
    flow.toggleMerchant(options[12]!);
    flow.toggleMerchant(options[0]!);
    expect(flow.selectedMerchants.value).toHaveLength(11);
    expect(flow.selectedMerchants.value.map((item) => item.merchantId)).not.toContain("1");
  });

  it("从 Brand Media 继承初始品牌和日期范围", () => {
    const flow = useRevenueFlow({
      initialMerchants: [{ merchantId: "101", name: "Alpha", count: 4 }],
      initialStartDate: "2026-08-01",
      initialEndDate: "2026-08-27",
      today: () => new Date("2026-08-28T12:00:00")
    });

    expect(flow.selectedIds.value).toEqual(["101"]);
    expect(flow.startDate.value).toBe("2026-08-01");
    expect(flow.endDate.value).toBe("2026-08-27");
  });

  it("相同品牌和日期范围命中缓存，不重复请求", async () => {
    let calls = 0;
    const flow = useRevenueFlow({
      catalogData: catalog,
      today: () => new Date("2026-08-28T12:00:00"),
      loadTrend: async () => {
        calls += 1;
        return trendPayload;
      }
    });

    flow.toggleMerchant({ merchantId: "101", name: "Alpha", count: 1 });
    await flow.loadTrend();
    flow.setDateRange(flow.startDate.value, flow.endDate.value);
    await flow.loadTrend();

    expect(calls).toBe(1);
    expect(flow.payload.value?.sankey.available).toBe(true);
    expect(flow.requestKey.value).toContain("101");
  });

  it("在多个 composable 实例之间复用进行中的请求和缓存数据", async () => {
    let calls = 0;
    let resolveRequest: ((value: unknown) => void) | undefined;
    const loadTrend = () => {
      calls += 1;
      return new Promise((resolve) => {
        resolveRequest = resolve;
      });
    };
    const first = useRevenueFlow({ catalogData: catalog, loadTrend });
    const second = useRevenueFlow({ catalogData: catalog, loadTrend });
    first.toggleMerchant({ merchantId: "101", name: "Alpha", count: 1 });
    second.toggleMerchant({ merchantId: "101", name: "Alpha", count: 1 });
    first.setDateRange("2026-07-01", "2026-07-31");
    second.setDateRange("2026-07-01", "2026-07-31");

    const firstRequest = first.loadTrend();
    const secondRequest = second.loadTrend();
    expect(calls).toBe(1);

    resolveRequest?.(trendPayload);
    await Promise.all([firstRequest, secondRequest]);

    const third = useRevenueFlow({ catalogData: catalog, loadTrend });
    third.toggleMerchant({ merchantId: "101", name: "Alpha", count: 1 });
    third.setDateRange("2026-07-01", "2026-07-31");
    await third.loadTrend();
    expect(calls).toBe(1);
  });

  it("新请求会取消旧请求，旧响应不能覆盖当前状态", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const signals: AbortSignal[] = [];
    const flow = useRevenueFlow({
      catalogData: catalog,
      loadTrend: ({ signal }) => {
        signals.push(signal);
        return new Promise((resolve) => resolvers.push(resolve));
      }
    });

    flow.toggleMerchant({ merchantId: "101", name: "Alpha", count: 1 });
    flow.setDateRange("2026-06-01", "2026-06-27");
    const first = flow.loadTrend();
    flow.setDateRange("2026-08-01", "2026-08-27");
    const second = flow.loadTrend();

    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);

    resolvers[0]?.(trendPayload);
    await first;
    expect(flow.payload.value).toBeNull();

    resolvers[1]?.(trendPayload);
    await second;
    expect(flow.payload.value?.sankey.available).toBe(true);
    expect(flow.loading.value).toBe(false);
  });

  it("清除品牌和卸载会清理 payload、展开态与进行中的请求", async () => {
    let resolveRequest: ((value: unknown) => void) | undefined;
    const flow = useRevenueFlow({
      catalogData: catalog,
      loadTrend: () => new Promise((resolve) => {
        resolveRequest = resolve;
      })
    });

    flow.toggleMerchant({ merchantId: "101", name: "Alpha", count: 1 });
    flow.setChartExpanded(true);
    const request = flow.loadTrend();
    flow.clearMerchants();
    expect(flow.selectedMerchants.value).toHaveLength(0);
    expect(flow.payload.value).toBeNull();
    expect(flow.status.value).toBe("revenueFlow.selectBrand");

    resolveRequest?.(trendPayload);
    await request;
    flow.setChartExpanded(true);
    flow.unmount();
    expect(flow.chartExpanded.value).toBe(false);
    expect(flow.loading.value).toBe(false);
  });

  it("区分单品字段不可用与普通加载错误", async () => {
    const flow = useRevenueFlow({
      catalogData: catalog,
      loadTrend: async () => ({
        ok: true,
        dateRange: { startDate: "2026-08-01", endDate: "2026-08-27" },
        sankey: { available: false, reason: "missing-product-field" }
      })
    });

    flow.toggleMerchant({ merchantId: "101", name: "Alpha", count: 1 });
    flow.setDateRange("2026-05-01", "2026-05-27");
    await flow.loadTrend();
    expect(flow.status.value).toBe("revenueFlow.unavailable");
    expect(flow.payload.value?.sankey.available).toBe(false);
  });
});
