import { describe, expect, it, vi } from "vitest";
import { createAgentSession } from "./agentSession";
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
const req = (prompt: string, reuseResult = false) => ({ prompt, reuseResult, language: "zh" as const, history: [], memoryText: "", signal: new AbortController().signal });
describe("执行链结果生命周期", () => {
 it("只取得部分工具的原结果继续时保留部分完成标记", async () => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL) => new Response('data: {"token":"仅已取得的 Shokz 数据可用，其他查询未完成。"}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } }));
  const session = createAgentSession({ offers: [], language: "zh", fetcher, enableTrace: false, enableQuestionLogging: false });
  session.retainReusableResult({ originalQuestion: "分析 Shokz 和 Roborock", sourceQuestionEventId: "original", agentRunId: "ar_partial_reuse_1234", planProofs: ["proof"], partial: true, resultViews: [], toolResults: [{ callId: "r1c1", toolName: "merchant_analysis", arguments: { merchant: "Shokz" }, result: { ok: true, data: { merchant: { name: "Shokz" }, metrics: { revenue: 100 } } } }] });
  expect(await session.submit(req("继续使用已有结果，不要重新查询", true))).toMatchObject({ ok: true, status: "done", partial: true });
  expect(fetcher.mock.calls.every(([url]) => String(url) === "/api/chat/stream")).toBe(true);
 });
 it("综合中停止仍保留已完成工具，继续不增加数据库查询", async () => {
  let dbCalls = 0, planCalls = 0;
  const controller = new AbortController();
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
   if (String(input) === "/api/chat/agent") { planCalls++; return json({ ok: true, agentRunId: "ar_stop_reuse_1234", planProof: "proof", toolCalls: [{ id: "r1c1", name: "merchant_analysis", arguments: { merchant: "Shokz" } }] }); }
   if (String(input).startsWith("/api/ui/db/merchant")) { dbCalls++; return json({ ok: true, monthlyAmazonMetrics: [] }); }
   if (init?.signal?.aborted) throw new DOMException("停止", "AbortError");
   return new Response('data: {"token":"已复用结果"}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } });
  });
  const session = createAgentSession({ offers: [{ merchantId: "362653", merchantName: "Shokz", orders: 10 }], language: "zh", fetcher, enableTrace: false, enableQuestionLogging: false });
  const stopped = await session.submit({ ...req("分析 Shokz"), signal: controller.signal }, { onTimeline: step => { if (step.phase === "synthesis" && step.status === "running") controller.abort(); } });
  expect(stopped.status).toBe("stopped"); expect(session.getReusableResult()?.toolResults).toHaveLength(1);
  expect(stopped.steps.every(step => step.status !== "running")).toBe(true);
  expect((await session.submit(req("继续使用已有结果，不要重新查询", true))).ok).toBe(true);
  expect(planCalls).toBe(1); expect(dbCalls).toBe(1);
  session.dispose?.(); expect(session.getReusableResult()).toBeNull();
 });
 it("已完成数据的继续请求只综合，不重新规划和查询", async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => String(input) === "/api/chat/agent" ? json({ ok: true, agentRunId: "ar_reuse_12345678", planProof: "proof", toolCalls: [{ id: "r1c1", name: "merchant_analysis", arguments: { merchant: "Shokz" } }] }) : String(input).startsWith("/api/ui/db/merchant") ? json({ ok: true, monthlyAmazonMetrics: [] }) : new Response('data: {"token":"已有数据结论"}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } }));
  const session = createAgentSession({ offers: [{ merchantId: "362653", merchantName: "Shokz", revenue: 100, orders: 10 }], language: "zh", fetcher, enableTrace: false, enableQuestionLogging: false });
  expect((await session.submit(req("分析 Shokz"))).ok).toBe(true);
  expect((await session.submit(req("继续用已有数据给出结论，不要重新查询", true))).ok).toBe(true);
  expect(fetcher.mock.calls.filter(([url]) => String(url) === "/api/chat/agent")).toHaveLength(1);
  const bodies = fetcher.mock.calls.filter(([url]) => String(url).includes("stream")).map(([, init]) => JSON.parse(String(init?.body)));
  expect(bodies.at(-1).reuse).toMatchObject({ originalQuestion: "分析 Shokz", scope: { targets: [], months: [], metrics: [] } });
  session.newConversation(); expect(session.getReusableResult?.()).toBeNull();
 });
 it("没有原结果且禁止重查时明确失败，不发请求", async () => {
  const fetcher = vi.fn(); const session = createAgentSession({ offers: [], language: "zh", fetcher, enableTrace: false, enableQuestionLogging: false });
  const result = await session.submit(req("继续用已有结果，不要重新查询", true));
  expect(result).toMatchObject({ ok: false, status: "error", errorCode: "agent_reuse_scope_unavailable" }); expect(fetcher).not.toHaveBeenCalled();
 });
});
