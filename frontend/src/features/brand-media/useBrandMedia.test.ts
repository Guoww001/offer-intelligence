import { describe, expect, it } from "vitest";

import { useBrandMedia } from "./useBrandMedia";

const catalog = {
  merchantNameMap: { "101": "Alpha" },
  publishers: [{ merchantIds: [101] }]
};

const trendPayload = {
  ok: true,
  merchant: { merchantId: 101, merchantName: "Alpha" },
  dateRange: { startDate: "2026-05-01", endDate: "2026-05-05" },
  summary: { activePublisherCount: 1, totalRevenue: 10, totalOrders: 2, observationCount: 1 },
  publishers: [{
    userId: 9,
    userName: "Media Nine",
    adminName: "timmy",
    totalRevenue: 10,
    totalOrders: 2,
    activeDays: 1,
    firstActiveDate: "2026-05-05",
    lastActiveDate: "2026-05-05",
    points: [{ date: "2026-05-05", revenue: 10, orders: 2, clicks: 0 }],
    clickPoints: []
  }]
};

describe("useBrandMedia", () => {
  it("设置快捷日期时使用昨天作为结束日期，并在未选择品牌时不发请求", async () => {
    let calls = 0;
    const media = useBrandMedia({
      catalogData: catalog,
      today: () => new Date("2026-08-28T12:00:00"),
      loadTrend: async () => {
        calls += 1;
        return trendPayload;
      }
    });

    media.setQuickRange(30);
    expect(media.quickRange.value).toBe("30");
    expect(media.startDate.value).toBe("2026-07-29");
    expect(media.endDate.value).toBe("2026-08-27");

    await media.loadTrend();
    expect(calls).toBe(0);
    expect(media.status.value).toBe("brandMedia.selectBrand");
  });

  it("新趋势请求会取消旧请求，旧响应不能覆盖当前 payload", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const signals: AbortSignal[] = [];
    const media = useBrandMedia({
      catalogData: catalog,
      loadTrend: ({ signal }) => {
        signals.push(signal);
        return new Promise((resolve) => resolvers.push(resolve));
      }
    });

    media.selectMerchant({ merchantId: "101", name: "Alpha" });
    const first = media.loadTrend();
    media.setDateRange("2026-05-01", "2026-05-05");
    const second = media.loadTrend();

    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);

    resolvers[0]?.(trendPayload);
    await first;
    expect(media.payload.value).toBeNull();

    resolvers[1]?.(trendPayload);
    await second;
    expect(media.payload.value?.merchant.merchantName).toBe("Alpha");
    expect(media.loading.value).toBe(false);
  });

  it("趋势接口返回 403 时保留权限错误，普通错误与空数据保持可区分", async () => {
    const media = useBrandMedia({
      catalogData: catalog,
      loadTrend: async () => {
        const error = new Error("forbidden") as Error & { status?: number };
        error.status = 403;
        throw error;
      }
    });

    media.selectMerchant({ merchantId: "101", name: "Alpha" });
    await media.loadTrend();
    expect(media.status.value).toBe("brandMedia.noPermission");
    expect(media.error.value).toBe("brandMedia.noPermission");
  });
  it("日期改变后，即使不立即发起第二个请求，旧请求响应也不能回写", async () => {
    let resolveRequest: ((value: unknown) => void) | undefined;
    const media = useBrandMedia({
      catalogData: catalog,
      loadTrend: () => new Promise((resolve) => {
        resolveRequest = resolve;
      })
    });

    media.selectMerchant({ merchantId: "101", name: "Alpha" });
    const request = media.loadTrend();
    media.setDateRange("2026-05-01", "2026-05-05");
    resolveRequest?.(trendPayload);
    await request;

    expect(media.payload.value).toBeNull();
    expect(media.loading.value).toBe(false);
  });
});
