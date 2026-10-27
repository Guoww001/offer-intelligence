import { describe, expect, it } from "vitest";

import { deriveAgentMonthlyMetrics, parseAgentMonthRange, selectAgentMonthRange } from "./agentMonthlyMetrics";

describe("Agent 月度派生指标", () => {
  it("按紧邻月份计算小数比例并保留原始字段和顺序", () => {
    const rows = [
      { month: "2026-08", value: 150, metrics: { revenue: 150, clicks: 80, orders: 0, conversionRate: 0 } },
      { month: "2026-07", value: 100, metrics: { revenue: 100, clicks: 100, orders: 5, conversionRate: 0.05 } }
    ];
    const result = deriveAgentMonthlyMetrics(rows);
    expect(result[0]).toEqual({ ...rows[0], metrics: { ...rows[0]!.metrics, revenueMoM: 0.5, clicksMoM: -0.2, ordersDelta: -5 } });
    expect(result[1]!.metrics).toMatchObject({ revenueMoM: null, clicksMoM: null, ordersDelta: null });
    expect(rows[0]!.metrics).not.toHaveProperty("revenueMoM");
  });

  it("跨缺月和缺失不补零，零基期没有比例但订单新增可用", () => {
    const result = deriveAgentMonthlyMetrics([
      { month: "2026-01", metrics: { revenue: 0, clicks: 0, orders: 0 } },
      { month: "2026-02", metrics: { revenue: 0, clicks: 50, orders: 3 } },
      { month: "2026-04", metrics: { revenue: 100, clicks: null, orders: 5 } },
      { month: "2026-05", metrics: { revenue: null, clicks: 0, orders: null } }
    ]);
    expect(result[1]!.metrics).toMatchObject({ revenueMoM: null, clicksMoM: null, ordersDelta: 3 });
    expect(result[2]!.metrics).toMatchObject({ revenueMoM: null, clicksMoM: null, ordersDelta: null });
    expect(result[3]!.metrics).toMatchObject({ revenue: null, clicks: 0, revenueMoM: null, clicksMoM: null, ordersDelta: null });
  });

  it("跨年紧邻月份可计算，真实零变化保留", () => {
    const result = deriveAgentMonthlyMetrics([
      { month: "2025-12", metrics: { revenue: 20, clicks: 20, orders: 2 } },
      { month: "2026-01", metrics: { revenue: 0, clicks: 20, orders: 2 } }
    ]);
    expect(result[1]!.metrics).toMatchObject({ revenueMoM: -1, clicksMoM: 0, ordersDelta: 0 });
  });
});

describe("Agent 明确月份区间", () => {
  it.each(["2026年7-9月", "2026年7月到9月", "2026年7月、8月、9月", "2026-07 至 2026-09"])("解析%s而不把年份当作月份", (prompt) => {
    expect(parseAgentMonthRange(prompt)).toEqual({ startMonth: "2026-07", endMonth: "2026-09" });
  });

  it("无年份使用传入基准而非系统时钟", () => {
    expect(parseAgentMonthRange("7-9月", [], "2026-10")).toEqual({ startMonth: "2026-07", endMonth: "2026-09" });
    expect(parseAgentMonthRange("7-9月")).toBeNull();
    expect(parseAgentMonthRange("2026年10月")).toEqual({ startMonth: "2026-10", endMonth: "2026-10" });
  });

  it("仅显式承接时间语义时读取最近明确历史月份", () => {
    const history = ["合成商户2026年7-9月的GMV"];
    expect(parseAgentMonthRange("同期点击呢", history)).toEqual({ startMonth: "2026-07", endMonth: "2026-09" });
    expect(parseAgentMonthRange("GMV环比呢", history)).toEqual({ startMonth: "2026-07", endMonth: "2026-09" });
    expect(parseAgentMonthRange("根据上述维度", history)).toEqual({ startMonth: "2026-07", endMonth: "2026-09" });
    expect(parseAgentMonthRange("另一家商户的GMV", history)).toBeNull();
    expect(parseAgentMonthRange("2026年5月", history)).toEqual({ startMonth: "2026-05", endMonth: "2026-05" });
    expect(parseAgentMonthRange("最近3个月", history)).toBeNull();
    expect(parseAgentMonthRange("2026年13月同期", history)).toBeNull();
  });

  it("拒绝逆序、非法月份和超过24个月的范围", () => {
    for (const prompt of ["2026年9-7月", "2026年13月", "2024-01到2026-02"]) expect(parseAgentMonthRange(prompt)).toBeNull();
    expect(parseAgentMonthRange("2025年12月到2026年2月")).toEqual({ startMonth: "2025-12", endMonth: "2026-02" });
  });

  it("选择明确范围并可额外保留紧邻前月基期", () => {
    const rows = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map(month => ({ month, metrics: {} }));
    const range = { startMonth: "2026-07", endMonth: "2026-09" };
    expect(selectAgentMonthRange(rows, range).map(row => row.month)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(selectAgentMonthRange(rows, range, true).map(row => row.month)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(selectAgentMonthRange(rows, null)).toEqual(rows);
  });
});
