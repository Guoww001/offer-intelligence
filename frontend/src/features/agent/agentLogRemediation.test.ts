import { describe, expect, it, vi } from "vitest";
import { createAgentSession } from "./agentSession";

const offers = [
  { merchantId: "10001", merchantName: "家具甲", sheetCategory: "Home & Kitchen", mainCategory: "Home & Kitchen", mainCategoryCn: "家居", categoryPath: "Home & Kitchen > Furniture", salesAmount: 200, clicks: 20, orders: 2 },
  { merchantId: "10002", merchantName: "厨具乙", sheetCategory: "Kitchen & Dining", mainCategory: "Kitchen & Dining", mainCategoryCn: "厨具", salesAmount: 100, clicks: 10, orders: 1 },
  { merchantId: "20001", merchantName: "SIHOO", sheetCategory: "Home & Kitchen", tier: "Tier 3" },
  { merchantId: "20002", merchantName: "SIHOO", sheetCategory: "Home & Kitchen", tier: "Tier 1" }
];
const monthly = [
  { month: "2026-06", revenue: 100, clicks: 10, orders: 1 },
  { month: "2026-07", revenue: 200, clicks: 20, orders: 2 },
  { month: "2026-08", revenue: 100, clicks: 30, orders: 3 },
  { month: "2026-09", revenue: 150, clicks: 15, orders: 2 }
];
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
const execute = (session: ReturnType<typeof createAgentSession>, toolName: "category_analysis" | "trend" | "merchant_analysis", args: Record<string, unknown>, prompt = "查询数据") => session.executeTool({ callId: "case-1", toolName, arguments: args, prompt, signal: new AbortController().signal });

describe("十月日志问题集成回归", () => {
  it("中文品类查询能输出真实商户名称和编号", async () => {
    const session = createAgentSession({ offers, language: "zh", enableTrace: false, enableQuestionLogging: false });
    const result = await execute(session, "category_analysis", { category: "家居" });
    expect(result.toolResult.result).toMatchObject({ ok: true });
    expect(result.resultView?.rows?.some(row => row.label.includes("家具甲"))).toBe(true);
    expect(result.resultView?.rows?.some(row => row.values.includes("10001"))).toBe(true);
  });

  it("英文品类成功时也不能丢掉已有 Top 商户名单", async () => {
    const session = createAgentSession({ offers, language: "zh", enableTrace: false, enableQuestionLogging: false });
    const result = await execute(session, "category_analysis", { category: "Home & Kitchen" });
    expect(result.resultView?.rows?.length).toBeGreaterThan(0);
    expect(result.resultView?.columns).toContain("商户 ID");
  });

  it("同名商户的选择提示包含不同编号", async () => {
    const session = createAgentSession({ offers, language: "zh", enableTrace: false, enableQuestionLogging: false });
    const result = await execute(session, "merchant_analysis", { merchant: "SIHOO" });
    expect(result.toolResult.result).toMatchObject({ ok: false });
    expect(result.resultView?.message).toContain("20001");
    expect(result.resultView?.message).toContain("20002");
  });

  it("品类趋势使用一次批量数据库查询并保留明确区间和环比基期", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => response({ ok: true, checkedAt: "2026-10-26T09:00:00Z", previousMonth: monthly[0], monthly: monthly.slice(1), merchantCount: 3, categories: ["Home & Kitchen"] }));
    const session = createAgentSession({ offers, language: "zh", fetcher, enableTrace: false, enableQuestionLogging: false });
    const result = await execute(session, "trend", { entityType: "category", target: "家居", months: 3, metric: "revenue", startMonth: "2026-07", endMonth: "2026-09" });
    expect(result.toolResult.result).toMatchObject({ ok: true, source: { dataSource: "database", estimated: false } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = String(fetcher.mock.calls[0]?.[0]);
    expect(url).toContain("/api/ui/db/category-monthly?");
    expect(url).toContain("startMonth=2026-07");
    const data = (result.toolResult.result as { data: { months: { month: string; metrics: Record<string, number> }[] } }).data;
    expect(data.months.map(row => row.month)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(data.months[0]?.metrics.revenueMoM).toBe(1);
    expect(data.months[1]?.metrics.revenueMoM).toBe(-0.5);
    expect(result.toolResult.result).toMatchObject({ data: { merchantCount: 3, summary: { requestedMonths: 3 } } });
    expect((result.toolResult.result as { data: { note: string } }).data.note).not.toContain("最近");
  });

  it("明确商户年月范围通过接口传递，环比不依赖模型临时计算", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => response({ ok: true, checkedAt: "2026-10-26T09:00:00Z", previousMonth: monthly[0], monthly: monthly.slice(1) }));
    const session = createAgentSession({ offers, language: "zh", fetcher, enableTrace: false, enableQuestionLogging: false });
    const result = await execute(session, "trend", { entityType: "merchant", target: "10001", months: 3, metric: "revenue", startMonth: "2026-07", endMonth: "2026-09" }, "月份 GMV GMV环比 点击量 点击环比 订单量 订单环比新增 转化率");
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("startMonth=2026-07");
    expect(result.toolResult.result).toMatchObject({ ok: true });
    expect(result.resultView?.trend?.months[1]).toMatchObject({ month: "2026-08", revenue: 100, revenueMoM: -0.5, clicksMoM: 0.5, ordersDelta: 1 });
    expect(result.resultView?.trend?.metrics).toContain("revenueMoM");
  });

  it("规划选择环比指标时图表保留计算值而不是覆盖为空", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => response({ ok: true, checkedAt: "2026-10-26T09:00:00Z", previousMonth: monthly[0], monthly: monthly.slice(1) }));
    const session = createAgentSession({ offers, language: "zh", fetcher, enableTrace: false, enableQuestionLogging: false });
    const result = await execute(session, "trend", { entityType: "merchant", target: "10001", metric: "revenueMoM", startMonth: "2026-07", endMonth: "2026-09" });
    expect(result.resultView?.trend?.metric).toBe("revenueMoM");
    expect(result.resultView?.trend?.months[1]?.revenueMoM).toBe(-0.5);
  });

  it("备用 Trace 使用服务端要求的 action 且不携带正文", async () => {
    const traces: Record<string, unknown>[] = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      if (String(url).includes("operation=agent_trace")) { traces.push(body); return response({ ok: true }); }
      return response({ ok: true, contractVersion: "v2", registryVersion: "agent-tools-v1", agentRunId: "ar_diagnosis_123456", content: "你好", toolCalls: [], finishReason: "stop" });
    });
    const session = createAgentSession({ offers, language: "zh", fetcher, enableQuestionLogging: false });
    await session.submit({ prompt: "你好", language: "zh", history: [], memoryText: "", signal: new AbortController().signal });
    await vi.waitFor(() => expect(traces.some(row => row.action === "complete")).toBe(true));
    expect(traces.map(row => row.action)).toContain("start");
    expect(traces.map(row => row.action)).toContain("append");
    expect(traces.find(row => row.action === "start")).not.toHaveProperty("status");
    expect(traces.every(row => !("prompt" in row) && !("answer" in row))).toBe(true);
  });

  it("明确年月即使未被规划参数提取也不会变成最近三个月", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => response({ ok: true, checkedAt: "2026-10-26T09:00:00Z", previousMonth: monthly[0], monthly: monthly.slice(1) }));
    const session = createAgentSession({ offers, language: "zh", fetcher, enableTrace: false, enableQuestionLogging: false });
    await execute(session, "trend", { entityType: "merchant", target: "10001", months: 3 }, "2026年7月、8月、9月的GMV与环比");
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("startMonth=2026-07");
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("endMonth=2026-09");
  });

  it("同维度更换商户时承接用户明确给出的期间", async () => {
    const urls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); urls.push(url);
      if (url === "/api/chat/agent") return response({ ok: true, agentRunId: "ar_followup_test_1234", planProof: "test-proof", toolCalls: [{ id: "trend-1", name: "trend", arguments: { entityType: "merchant", target: "10001", months: 12 } }] });
      if (url.startsWith("/api/ui/db/merchant")) return response({ ok: true, checkedAt: "2026-10-26T09:00:00Z", previousMonth: monthly[0], monthly: monthly.slice(1) });
      return new Response('data: {"token":"已按原期间整理"}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } });
    });
    const session = createAgentSession({ offers, language: "zh", fetcher, enableTrace: false, enableQuestionLogging: false });
    await session.submit({ prompt: "接下来查询10001", language: "zh", history: [{ role: "user", content: "2026年7-9月的GMV、点击、订单和环比" }, { role: "assistant", content: "已整理" }], memoryText: "", signal: new AbortController().signal });
    expect(urls.find(url => url.startsWith("/api/ui/db/merchant"))).toContain("startMonth=2026-07");
  });
});
