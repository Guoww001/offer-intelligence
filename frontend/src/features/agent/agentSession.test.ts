import { describe, expect, it, vi } from "vitest";

import { createAgentSession, type AgentSessionRequest } from "./agentSession";

const offers = [
  {
    merchantId: "398679",
    merchantName: "Tapo",
    brand: "Tapo",
    tier: "Tier 1",
    category: "Electronics",
    clicks: 100,
    orders: 12,
    salesAmount: 1200,
    affCommission: 120,
    conversionRate: 0.12,
    epc: 12
  },
  {
    merchantId: "398680",
    merchantName: "Home Lamp",
    brand: "Home Lamp",
    tier: "Tier 2",
    category: "Home",
    clicks: 50,
    orders: 5,
    salesAmount: 500,
    affCommission: 50,
    conversionRate: 0.1,
    epc: 10
  }
];

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function streamResponse(content: string): Response {
  return new Response(`data: ${JSON.stringify({ token: content })}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" }
  });
}

describe("createAgentSession", () => {
  it("sends the v2 planning contract without leaking tool schemas", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      calls.push({ url, body });
      return response({
        ok: true,
        contractVersion: "v2",
        registryVersion: "agent-tools-v1",
        agentRunId: "ar_test_planning_1234",
        content: "概念说明",
        toolCalls: [],
        finishReason: "stop"
      });
    });
    const session = createAgentSession({
      offers,
      language: "zh",
      fetcher,
      enableQuestionLogging: false,
      enableTrace: false
    });

    const result = await session.submit({
      prompt: "EPC 是什么",
      language: "zh",
      history: [],
      memoryText: "",
      signal: new AbortController().signal
    });

    expect(result).toMatchObject({ ok: true, status: "done", response: "概念说明" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/chat/agent");
    expect(calls[0]!.body).toMatchObject({
      contractVersion: "v2",
      question: "EPC 是什么",
      language: "zh",
      enabledTools: expect.arrayContaining(["merchant_analysis", "trend"])
    });
    expect(calls[0]!.body.messages).toBeUndefined();
    expect(calls[0]!.body.tools).toBeUndefined();
  });

  it("executes planned tools in parallel and sends only projected results to synthesis", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    let firstToolStarted = false;
    let secondToolStarted = false;
    let releaseTools: (() => void) | undefined;
    const toolsReleased = new Promise<void>((resolve) => { releaseTools = resolve; });
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      calls.push({ url, body });
      if (url === "/api/chat/agent") {
        return response({
          ok: true,
          contractVersion: "v2",
          registryVersion: "agent-tools-v1",
          agentRunId: "ar_test_parallel_1234",
          planProof: "signed-proof",
          content: null,
          toolCalls: [
            { id: "r1c1", name: "merchant_analysis", arguments: { merchant: "Tapo" } },
            { id: "r1c2", name: "merchant_analysis", arguments: { merchant: "Home Lamp" } }
          ],
          finishReason: "tool_calls"
        });
      }
      if (url.startsWith("/api/ui/db/merchant")) {
        if (url.includes("398679")) firstToolStarted = true;
        if (url.includes("398680")) secondToolStarted = true;
        if (firstToolStarted && secondToolStarted) releaseTools?.();
        await toolsReleased;
        return response({ ok: true, monthlyAmazonMetrics: [] });
      }
      if (url === "/api/chat/stream") return streamResponse("两家商户均已完成分析");
      if (url.includes("operation=questions")) return response({ ok: true });
      throw new Error(`unexpected URL ${url}`);
    });
    const session = createAgentSession({
      offers,
      language: "zh",
      fetcher,
      enableQuestionLogging: false,
      enableTrace: false
    });

    const views: unknown[] = [];
    const result = await session.submit({
      prompt: "分别查询 Tapo 和 Home Lamp 的表现",
      language: "zh",
      history: [],
      memoryText: "",
      signal: new AbortController().signal
    }, {
      onResultView: (view) => views.push(view)
    });

    expect(result).toMatchObject({ ok: true, status: "done", response: "两家商户均已完成分析" });
    expect(firstToolStarted).toBe(true);
    expect(secondToolStarted).toBe(true);
    const synthesis = calls.find((call) => call.url === "/api/chat/stream");
    expect(synthesis?.body).toMatchObject({
      contractVersion: "v2",
      agentRunId: "ar_test_parallel_1234",
      planProofs: ["signed-proof"],
      context: { history: [], memory: "" }
    });
    const toolResults = synthesis?.body.toolResults as Array<Record<string, unknown>>;
    expect(toolResults).toHaveLength(2);
    expect(toolResults[0]).toMatchObject({ callId: "r1c1", toolName: "merchant_analysis" });
    expect((toolResults[0]!.result as Record<string, unknown>).error).toBeUndefined();
    expect(views).toHaveLength(2);
    expect(result.resultViews).toHaveLength(2);
  });

  it("does not commit a stopped turn to history", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => {
      await new Promise<void>((resolve) => controller.signal.addEventListener("abort", () => resolve(), { once: true }));
      throw new DOMException("aborted", "AbortError");
    });
    const session = createAgentSession({
      offers,
      language: "en",
      fetcher,
      enableQuestionLogging: false,
      enableTrace: false
    });
    const request: AgentSessionRequest = {
      prompt: "show a trend",
      language: "en",
      history: [],
      memoryText: "",
      signal: controller.signal
    };
    const pending = session.submit(request);
    controller.abort();
    const result = await pending;

    expect(result).toMatchObject({ ok: false, status: "stopped" });
    expect(session.getState().history).toEqual([]);
    expect(session.getState().messages).toEqual([]);
  });

  it("executes CopilotKit frontend tools without the Legacy bridge", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("/api/ui/db/merchant?");
      return response({ ok: true, monthlyAmazonMetrics: [], checkedAt: "2026-09-03" });
    });
    const session = createAgentSession({
      offers,
      language: "zh",
      fetcher,
      enableQuestionLogging: false,
      enableTrace: false
    });

    const result = await session.executeTool({
      callId: "tool-merchant-1",
      toolName: "merchant_analysis",
      arguments: { merchant: "Tapo" },
      prompt: "查询 Tapo 的 EPC",
      signal: new AbortController().signal
    });

    expect(result.toolResult).toMatchObject({
      callId: "tool-merchant-1",
      toolName: "merchant_analysis",
      result: { ok: true, source: { dataSource: "cache" } }
    });
    expect(result.memoryEvent).toMatchObject({ kind: "tool_success" });
    expect(result.resultView).toMatchObject({
      id: "tool-merchant-1",
      toolName: "merchant_analysis",
      status: "done"
    });
  });
});
