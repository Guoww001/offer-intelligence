import { describe, expect, it } from "vitest";
import { createAgentResultReuse } from "./agentResultReuse";
const result = { callId: "c1", toolName: "trend", arguments: { target: "Shokz", months: 12 }, result: { ok: true, data: { target: "Shokz Official", months: [{ month: "2026-09", metrics: { revenue: 12, orders: 2, conversionRate: .07, epc: .2 } }] } } };
const source = { originalQuestion: "分析 Shokz 收入订单 CVR EPC", sourceQuestionEventId: "q1", agentRunId: "r1", planProofs: ["proof"], toolResults: [result], resultViews: [] };
describe("临时结果复用", () => {
 it("连续月份范围包含中间月份，不只取端点", () => {
  const cache = createAgentResultReuse();
  cache.retain({ ...source, toolResults: [{ ...result, result: { ok: true, data: { target: "Shokz", months: ["2026-06", "2026-07", "2026-08", "2026-09"].map(month => ({ month, metrics: { revenue: 1 } })) } } }] });
  const decision = cache.decide("把已有结果整理成表，只比较2026-06 至 2026-09的收入，不要重新查询");
  expect(decision.kind).toBe("reuse"); if (decision.kind === "reuse") expect(decision.scope.months).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
 });
 it("改变商户时不能把原商户数据当新商户结论", () => {
  const cache = createAgentResultReuse(); cache.retain(source);
  expect(cache.decide("用刚才的数据分析 Roborock", false, ["Shokz", "Roborock"]).kind).toBe("query");
  expect(cache.decide("用刚才的数据分析 MoonVacuumXYZ，不要重新查询").kind).toBe("unavailable");
 });
 it("保留原问题绑定，并允许已有数据的表格与继续请求", () => { const cache = createAgentResultReuse(); cache.retain(source); expect(cache.decide("把刚才的数据用一张表对比，只列收入、订单、CVR、EPC").kind).toBe("reuse"); expect(cache.decide("继续使用已查到的数据，不要重新查询", true).kind).toBe("reuse"); expect(cache.get()?.originalQuestion).toBe(source.originalQuestion); });
 it("新范围重新查询，禁止重查时返回明确失败；失败结果不缓存", () => { const cache = createAgentResultReuse(); cache.retain(source); expect(cache.decide("重新查询 Shokz").kind).toBe("query"); expect(cache.decide("用刚才的数据展示 2025-01 的收入，不要重新查询").kind).toBe("unavailable"); cache.clear(); cache.retain({ ...source, toolResults: [{ ...result, result: { ok: false } }] }); expect(cache.get()).toBeNull(); });
 it("只有成功结果、至多六个调用，复制隔离且十分钟后过期", () => { let now = 10; const cache = createAgentResultReuse(() => now); cache.retain(source); const copy = cache.get()!; copy.toolResults[0]!.arguments = {}; expect(cache.get()?.toolResults[0]!.arguments).toEqual(result.arguments); now += 600001; expect(cache.decide("继续使用已有结果", true).kind).toBe("unavailable"); });
});
