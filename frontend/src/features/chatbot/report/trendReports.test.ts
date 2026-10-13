import { describe, expect, it } from "vitest";
import { parityOffers } from "./fixtures/parityData";
import { buildTrendReport, mergeMerchantMonths } from "./trendReports";
import { resolveReportQuery } from "./reportQuery";

describe("trendReports", () => {
  it("跨年合并保留十月至十二月，不误读为一月", () => {
    const monthly = ["2025-10", "2025-11", "2025-12", "2026-01"].map(month => ({ month, revenue: 1 }));
    const result = mergeMerchantMonths({ merchantId: "362737", monthlyAmazonMetrics: monthly });
    expect(result[0]?.monthly).toMatchObject(monthly);
  });
  it("优先使用真实月度数据并计算首末月变化", () => {
    const rows = [{
      ...parityOffers[0],
      monthly: [
        { month: "2026-06", clicks: 100, orders: 5, salesAmount: 500, affCommission: 25 },
        { month: "2026-07", clicks: 200, orders: 12, salesAmount: 1200, affCommission: 60 },
        { month: "2026-08", clicks: 300, orders: 18, salesAmount: 1800, affCommission: 90 }
      ]
    }];
    const result = buildTrendReport(resolveReportQuery("Alpha Audio 近 3 个月趋势", { language: "zh", categories: [] }), rows, "zh");
    expect(result.estimated).toBe(false);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.at(-1)).toMatchObject({ month: "2026-08", value: 1800, delta: 600 });
  });

  it("trend 命令在没有候选表时仍按冒号后的商户目标筛选", () => {
    const rows = [
      {
        ...parityOffers[0],
        monthly: [
          { month: "2026-06", clicks: 100, orders: 5, salesAmount: 500 },
          { month: "2026-07", clicks: 200, orders: 12, salesAmount: 1200 },
          { month: "2026-08", clicks: 300, orders: 18, salesAmount: 1800 }
        ]
      },
      {
        ...parityOffers[2],
        monthly: [
          { month: "2026-06", clicks: 50, orders: 2, salesAmount: 200 },
          { month: "2026-07", clicks: 60, orders: 3, salesAmount: 300 },
          { month: "2026-08", clicks: 70, orders: 4, salesAmount: 400 }
        ]
      }
    ];
    const query = resolveReportQuery("trend: Alpha Audio", { language: "en", categories: [] });
    const result = buildTrendReport(query, rows, "en", new Date("2026-09-08T00:00:00Z"));

    expect(query).toMatchObject({ intent: "analysis", analysisType: "trend", analysisTargets: ["Alpha Audio"] });
    expect(result.rows).toHaveLength(3);
    expect(result.rows.at(-1)).toMatchObject({ month: "2026-08", value: 1800 });
  });

  it("没有月度数据时标记 estimated，且品类趋势排除 Tier 4/BLACK TIER", () => {
    const query = resolveReportQuery("Electronics 趋势", { language: "en", categories: ["Electronics"] });
    const result = buildTrendReport(query, parityOffers, "en");
    expect(result.estimated).toBe(true);
    expect(result.rows.length).toBeGreaterThanOrEqual(2);
    expect(result.note).toContain("estimated");
  });

  it("合并商户详情的重复月度字段，并拒绝单月趋势范围", () => {
    const merged = mergeMerchantMonths({
      merchant: { merchantId: "1001", brand: "Alpha Audio" },
      monthlyAmazonMetrics: [{ month: "2026-08", clicks: 100, orders: 5, salesAmount: 500 }],
      monthlyAggregateMetrics: [{ month: "2026-08", affCommission: 25 }, { month: "2026-09", affCommission: 30 }]
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.monthly).toMatchObject([
      { month: "2026-08", clicks: 100, orders: 5, salesAmount: 500, affCommission: 25 },
      { month: "2026-09", affCommission: 30 }
    ]);

    const query = resolveReportQuery("Alpha Audio 2026-08 至 2026-08 趋势", { language: "zh", categories: [] });
    const singleMonth = buildTrendReport(query, parityOffers, "zh");
    expect(singleMonth.status).toBe("needs_input");
  });

  it("品类趋势显式指定 Tier 4 时不会被默认排除", () => {
    const rows = [{
      ...parityOffers[3],
      monthly: [
        { month: "2026-07", clicks: 10, orders: 1, salesAmount: 100 },
        { month: "2026-08", clicks: 20, orders: 2, salesAmount: 240 }
      ]
    }];
    const query = resolveReportQuery("Electronics Tier 4 趋势", { language: "zh", categories: ["Electronics"] });
    const result = buildTrendReport(query, rows, "zh");

    expect(query.tiers).toEqual(["Tier 4"]);
    expect(result.status).toBe("resolved");
    expect(result.rows.some((row) => row.month === "2026-08" && row.value === 240)).toBe(true);
  });
});

describe("月度统一来源", () => {
  it("aggregate 点击单列保留，金额覆盖后按同月输入重算比率", () => {
    const rows = mergeMerchantMonths({ merchantId: "1",
      monthlyAmazonMetrics: [{ month: "2026-10", clicks: 100, orders: 5, revenue: 500, affiliatePayout: 20, payout: 30, epc: 99, conversionRate: 0.9, aov: 99 }],
      monthlyAggregateMetrics: [{ month: "2026-10", clicks: 0, orders: 10, revenue: 800, payout: 40 }]
    });
    expect((rows[0]?.monthly as Record<string, unknown>[])[0]).toMatchObject({ clicks: 100, aggregateClicks: 0, orders: 10, revenue: 800, salesAmount: 800, payout: 40, epc: 0.2, affEpc: 0.2, allEpc: 0.4, conversionRate: 0.1, aov: 80 });
  });
  it("aggregate 缺失值不能覆盖 Amazon，真实零仍可覆盖", () => {
    const rows = mergeMerchantMonths({ merchantId: "1",
      monthlyAmazonMetrics: [{ month: "2026-10", clicks: 100, orders: 5, revenue: 500, payout: 30 }],
      monthlyAggregateMetrics: [{ month: "2026-10", orders: null, revenue: 0, payout: null }]
    });
    expect((rows[0]?.monthly as Record<string, unknown>[])[0]).toMatchObject({ clicks: 100, orders: 5, revenue: 0, salesAmount: 0, payout: 30, epc: null, affEpc: null, allEpc: 0.3, aov: 0, conversionRate: 0.05 });
  });
  it("aggregate 独有月份不借用其点击或旧源比率", () => {
    const rows = mergeMerchantMonths({ merchantId: "1", monthlyAggregateMetrics: [{ month: "2026-10", revenue: 500, orders: 5, clicks: 100, epc: 3, conversionRate: 0.2 }] });
    expect((rows[0]?.monthly as Record<string, unknown>[])[0]).toMatchObject({ aggregateClicks: 100, epc: null, conversionRate: null, aov: 100 });
    expect((rows[0]?.monthly as Record<string, unknown>[])[0]?.clicks).toBeUndefined();
  });
});


describe("月度缺失比率消费", () => {
  it("订单或点击缺失时不把 CVR 当作零", () => {
    const merged = mergeMerchantMonths({ merchant: { merchantId: "1001", brand: "Alpha Audio" }, monthlyAmazonMetrics: [
      { month: "2026-08", orders: 5 }, { month: "2026-09", orders: 10, clicks: 0 }
    ] });
    const query = resolveReportQuery("Alpha Audio 2026-08 至 2026-09 CVR 趋势", { language: "zh", categories: [] });
    const result = buildTrendReport(query, merged, "zh");
    expect(result.status).toBe("not_found");
    expect(result.rows).toEqual([]);
  });
});


describe("月度审查消费回归", () => {
  it("已有月份的 null CVR 不会被有效月份补成估算数字", () => {
    const merged = mergeMerchantMonths({ merchant: { merchantId: "1001", brand: "Alpha Audio", conversionRate: 0.1 }, monthlyAmazonMetrics: [
      { month: "2026-08", orders: 5, clicks: 100 }, { month: "2026-09", orders: 10, clicks: 0 }
    ] });
    const result = buildTrendReport(resolveReportQuery("Alpha Audio 2026-08 至 2026-09 CVR 趋势", { language: "zh", categories: [] }), merged, "zh");
    expect(result.rows.find(row => row.month === "2026-09")).toBeUndefined();
    expect(result.rows[0]).toMatchObject({ month: "2026-08", value: 0.05, conversionRate: 0.05, estimated: false });
    expect(result.estimated).toBe(false);
  });
  it("全月 CVR 不可用时不会使用商户快照补值", () => {
    const merged = mergeMerchantMonths({ merchant: { merchantId: "1001", brand: "Alpha Audio", conversionRate: 0.1 }, monthlyAmazonMetrics: [
      { month: "2026-08", orders: 5 }, { month: "2026-09", orders: 10, clicks: 0 }
    ] });
    const result = buildTrendReport(resolveReportQuery("Alpha Audio 2026-08 至 2026-09 CVR 趋势", { language: "zh", categories: [] }), merged, "zh");
    expect(result.rows).toEqual([]);
    expect(result.estimated).toBe(false);
  });
  it("收入趋势的次级群体比率缺输入时保持缺失，不混入孤立分子", () => {
    const merged = [
      ...mergeMerchantMonths({ merchant: { merchantId: "1001", brand: "Alpha Audio" }, monthlyAmazonMetrics: [
        { month: "2026-08", revenue: 100, orders: 10, clicks: 100, affiliatePayout: 10, payout: 20 },
        { month: "2026-09", revenue: 100, orders: 10, clicks: 100, affiliatePayout: 10, payout: 20 }
      ] }),
      ...mergeMerchantMonths({ merchant: { merchantId: "1002", brand: "Beta Audio" }, monthlyAmazonMetrics: [
        { month: "2026-08", revenue: 200, orders: 20, affiliatePayout: 20, payout: 40 },
        { month: "2026-09", revenue: 200, orders: 20, clicks: 100, affiliatePayout: 20, payout: 40 }
      ] })
    ];
    const result = buildTrendReport({ ...resolveReportQuery("2026-08 至 2026-09 收入趋势", { language: "zh", categories: [] }), merchantIds: ["1001", "1002"] }, merged, "zh");
    expect(result.rows[0]).toMatchObject({ month: "2026-08", value: 300, orders: 30, clicks: 100, epc: null, conversionRate: null, aov: 10, allEpc: null });
    expect(result.rows[1]).toMatchObject({ month: "2026-09", value: 300, epc: 0.15, conversionRate: 0.15, aov: 10, allEpc: 0.3 });
  });
});


it("省略明确缺失月份后不跨月伪造环比", () => {
  const merged = mergeMerchantMonths({ merchant: { merchantId: "1001", brand: "Alpha Audio" }, monthlyAmazonMetrics: [
    { month: "2026-08", orders: 5, clicks: 100 }, { month: "2026-09", orders: 10, clicks: 0 }, { month: "2026-10", orders: 10, clicks: 100 }
  ] });
  const result = buildTrendReport(resolveReportQuery("Alpha Audio 2026-08 至 2026-10 CVR 趋势", { language: "zh", categories: [] }), merged, "zh");
  expect(result.rows.at(-1)).toMatchObject({ month: "2026-10", value: 0.1, previousValue: null, delta: null, deltaPct: null });
});


it("主收入缺失的商户仍贡献已知次级总量，与群体比率集合一致", () => {
  const merged = [
    ...mergeMerchantMonths({ merchant: { merchantId: "1001", brand: "Alpha Audio" }, monthlyAmazonMetrics: [
      { month: "2026-08", revenue: 100, orders: 10, clicks: 100, affiliatePayout: 10 },
      { month: "2026-09", revenue: 100, orders: 10, clicks: 100, affiliatePayout: 10 }
    ] }),
    ...mergeMerchantMonths({ merchant: { merchantId: "1002", brand: "Beta Audio" }, monthlyAmazonMetrics: [
      { month: "2026-08", orders: 20, clicks: 100, affiliatePayout: 20 },
      { month: "2026-09", orders: 20, clicks: 100, affiliatePayout: 20 }
    ] })
  ];
  const result = buildTrendReport({ ...resolveReportQuery("2026-08 至 2026-09 收入趋势", { language: "zh", categories: [] }), merchantIds: ["1001", "1002"] }, merged, "zh");
  expect(result.rows[0]).toMatchObject({ month: "2026-08", value: 100, orders: 30, clicks: 200, affiliatePayout: 30, epc: 0.15, conversionRate: 0.15, aov: null });
});
