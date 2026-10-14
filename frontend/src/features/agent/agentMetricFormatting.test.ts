import { describe, expect, it } from "vitest";
import { formatAgentMetric } from "./agentMetricFormatting";

describe("Agent 指标格式", () => {
  it("使用明确指标单位并保留真实零与缺失", () => {
    expect(formatAgentMetric("conversionRate", 0.072, "zh")).toBe("7.20%");
    expect(formatAgentMetric("conversionRate", 1.2, "zh")).toBe("120.00%");
    expect(formatAgentMetric("revenue", 12.345, "zh")).toBe("12.35");
    expect(formatAgentMetric("epc", 0.12345, "zh")).toBe("0.123");
    expect(formatAgentMetric("orders", 12, "zh")).toBe("12");
    expect(formatAgentMetric("revenue", 0, "zh")).toBe("0.00");
    expect(formatAgentMetric("epc", null, "zh")).toBe("未提供");
    expect(formatAgentMetric("epc", Number.NaN, "en")).toBe("Not provided");
    expect(formatAgentMetric("changePercent", 125.55, "zh")).toBe("125.55%");
  });
});
