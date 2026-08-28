import { describe, expect, it } from "vitest";

import {
  brandMediaCatalogOptions,
  brandMediaColor,
  brandMediaDateKey,
  brandMediaDayOrdinal,
  brandMediaLineSegments,
  brandMediaManagerOptions,
  brandMediaPublisherKey,
  buildBrandMediaChartModel,
  buildBrandMediaClickChartModel,
  filterBrandMediaPublishers,
  summarizeBrandMediaView,
  visibleBrandMediaPublishers
} from "./brandMediaModel";

const payload = {
  merchant: { merchantId: 101, merchantName: "Alpha" },
  dateRange: { startDate: "2026-05-01", endDate: "2026-05-05" },
  summary: {
    activePublisherCount: 2,
    totalRevenue: 49,
    totalOrders: 7,
    totalClicks: 240,
    activeDayCount: 3,
    observationCount: 4,
    clickActiveDayCount: 3,
    clickObservationCount: 3
  },
  publishers: [
    {
      userId: 9,
      userName: "Media Nine",
      adminName: "timmy",
      totalRevenue: 41,
      totalOrders: 5,
      totalClicks: 200,
      activeDays: 3,
      firstActiveDate: "2026-05-01",
      lastActiveDate: "2026-05-05",
      points: [
        { date: "2026-05-01", revenue: 19, orders: 2, clicks: 0 },
        { date: "2026-05-02", revenue: 0, orders: 0, clicks: 0 },
        { date: "2026-05-05", revenue: 22, orders: 3, clicks: 0 }
      ],
      clickPoints: [
        { date: "2026-05-01", clicks: 120 },
        { date: "2026-05-02", clicks: 80 }
      ]
    },
    {
      userId: 12,
      userName: "Media Twelve",
      adminName: "stella",
      totalRevenue: 8,
      totalOrders: 2,
      totalClicks: 40,
      activeDays: 1,
      firstActiveDate: "2026-05-03",
      lastActiveDate: "2026-05-03",
      points: [{ date: "2026-05-03", revenue: 8, orders: 2, clicks: 0 }],
      clickPoints: [{ date: "2026-05-03", clicks: 40 }]
    }
  ]
} as const;

describe("brandMediaModel", () => {
  it("保留有效日期和真实零点，并在缺少源记录的日期断开折线", () => {
    expect(brandMediaDateKey("2026-03-08T12:00:00Z")).toBe("2026-03-08");
    expect(brandMediaDateKey("not-a-date")).toBe("");
    expect(brandMediaDayOrdinal("2026-03-08") - brandMediaDayOrdinal("2026-03-07")).toBe(1);

    expect(brandMediaLineSegments([
      { date: "2026-05-01", orders: 2 },
      { date: "2026-05-02", orders: 0 },
      { date: "2026-05-05", orders: 3 }
    ]).map((segment) => segment.map((point) => point.date))).toEqual([
      ["2026-05-01", "2026-05-02"],
      ["2026-05-05"]
    ]);
  });

  it("从 Publishers 目录生成品牌选项，并按 Manager 和锁定媒体筛选而不改写源数据", () => {
    const catalog = brandMediaCatalogOptions({
      merchantNameMap: { "101": "Alpha", "202": "Beta" },
      publishers: [
        { merchantIds: [101] },
        { merchantIds: [101, 202] },
        { merchantIds: [101] }
      ]
    });

    expect(catalog[0]).toEqual({ merchantId: "101", name: "Alpha", count: 3 });
    expect(brandMediaManagerOptions(payload)).toEqual(["stella", "timmy"]);
    const timmy = filterBrandMediaPublishers(payload, "timmy");
    expect(timmy.map((publisher) => publisher.userId)).toEqual([9]);

    const key = brandMediaPublisherKey(payload.publishers[0], 0);
    expect(visibleBrandMediaPublishers(payload, "", [key]).map((publisher) => publisher.userId))
      .toEqual([9]);
    expect(payload.publishers).toHaveLength(2);
    expect(summarizeBrandMediaView(payload, timmy, []).totalOrders).toBe(5);
  });

  it("按订单数生成带断线和全部媒体黑线的趋势模型，并保留 Revenue hover 数据", () => {
    const model = buildBrandMediaChartModel(payload, payload.publishers);

    expect(model).not.toBeNull();
    if (!model) return;
    expect(model.primaryMetric).toBe("orders");
    expect(model.xFor("2026-05-01")).toBe(82);
    expect(model.xFor("2026-05-05")).toBe(1152);
    expect(model.dailyOrderTotals["2026-05-01"]).toBe(2);
    expect(model.dailyRevenueTotals["2026-05-01"]).toBe(19);
    expect(model.svg.match(/class="brand-media-series"/g)).toHaveLength(3);
    expect(model.svg).toContain('class="brand-media-total-series"');
    expect(model.svg).toContain('data-brand-media-total-metric="orders"');
  });

  it("一个锁定媒体显示普通点击柱，多媒体锁定显示堆叠点击柱", () => {
    const single = buildBrandMediaClickChartModel(payload, [payload.publishers[0]]);
    const cumulative = buildBrandMediaClickChartModel(payload, payload.publishers);

    expect(single).not.toBeNull();
    expect(cumulative).not.toBeNull();
    if (!single || !cumulative) return;
    expect(single.isCumulative).toBe(false);
    expect(single.hasData).toBe(true);
    expect(single.svg).toContain("brand-media-click-svg is-single");
    expect(cumulative.isCumulative).toBe(true);
    expect(cumulative.svg).toContain("brand-media-click-svg is-cumulative");
    expect(cumulative.svg).toContain("brand-media-click-bar is-cumulative");
    expect(brandMediaColor(0)).not.toBe(brandMediaColor(1));
  });
});
