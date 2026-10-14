import { describe, expect, it } from "vitest";

import { searchAgentKeywords } from "./agentKeywordSearch";

describe("searchAgentKeywords", () => {
  it.each(["search", "recommendation"] as const)("%s 显式 EPC 排序只有实际排序说明", (mode) => {
    const result = searchAgentKeywords("vacuum", mode, 10, [{ merchantId: "1", merchantName: "Vacuum Shop", productTitles: ["vacuum"], epc: 2 }], {}, "zh", false, [], { metricSort: { field: "epc", direction: "desc" } });
    expect(result.note).toContain("联盟 EPC 降序");
    expect(result.note).not.toContain("未按表现排序");
    expect(result.note).not.toContain("整体快照表现排序");
  });
  it("原词未命中时沿用 Report Mode 的候选词匹配并标记来源", () => {
    const result = searchAgentKeywords("mobilityscooter", "search", 10, [
      { merchantId: "1001", merchantName: "Scooter Shop", tier: "Tier 1", productTitles: ["scooter board"] }
    ], {}, "zh", false, ["mobility scooter", "scooter"]);

    expect(result.rows.map((row) => row.merchantId)).toEqual(["1001"]);
    expect(result).toMatchObject({ matchedKeyword: "scooter", matchType: "semantic" });
    expect(result.note).toContain("mobilityscooter");
  });
});
