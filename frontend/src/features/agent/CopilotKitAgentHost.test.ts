import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import CopilotKitAgentHost from "./CopilotKitAgentHost.vue";
import { emptyAgentMemory } from "./agentModel";
import type { AgentPromotionAttachment } from "./agentAttachment";
import type { AgentToolExecutionResponse } from "./agentSession";
import { createAgentSession } from "./agentSession";

vi.mock("@copilotkit/vue/v2", () => ({ CopilotKitProvider: { name: "Provider", props: ["frontendTools"], template: "<slot />" } }));
vi.mock("./CopilotKitAgentRuntime.vue", () => ({ default: { name: "Runtime", props: ["beginRun"], template: "<div />" } }));

describe("CopilotKit local result projection", () => {
  it("登出后迟到工具不能回写来源缓存", async () => {
    const shared = createAgentSession({ offers: [], language: "zh", enableTrace: false, enableQuestionLogging: false });
    let release: (value: AgentToolExecutionResponse) => void = () => {};
    const toolExecutor = vi.fn(() => new Promise<AgentToolExecutionResponse>(resolve => { release = resolve; }));
    const wrapper = mount(CopilotKitAgentHost, { props: { language: "zh", endpoint: "/api/copilotkit", enabled: true, fallbackSession: shared, fallbackRun: vi.fn(), toolExecutor } });
    const source = wrapper.findComponent({ name: "Runtime" }).props("beginRun")({ prompt: "分析 Shokz", language: "zh", history: [], memory: emptyAgentMemory(), memoryText: "", signal: new AbortController().signal });
    source.setPlanningState({ agentRunId: "ar_native_12345678", planProofs: ["proof"] });
    const pending = source.execute({ callId: "r1c1", toolName: "trend", arguments: { target: "Shokz", months: 12 } });
    source.dispose(); shared.dispose?.();
    release({ toolResult: { callId: "r1c1", toolName: "trend", arguments: {}, result: { ok: true, data: { target: "Shokz" } } } });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" }); expect(shared.getReusableResult()).toBeNull(); wrapper.unmount();
  });
  it("趋势综合失败仅保留来源，不把标题作为成功答案", async () => {
    const fallbackRun = vi.fn();
    const toolExecutor = vi.fn(async () => ({ toolResult: { callId: "r1c1", toolName: "trend", arguments: { target: "Shokz" }, result: { ok: true, data: { target: "Shokz" } } }, resultView: { id: "trend", toolName: "trend", kind: "trend", status: "done", title: "Shokz 趋势", source: "cache", dataAsOf: null, estimated: false, partial: false, metrics: [], rows: [], columns: [], message: "来源说明" } } as AgentToolExecutionResponse));
    const wrapper = mount(CopilotKitAgentHost, { props: { language: "zh", endpoint: "/api/copilotkit", enabled: true, fallbackRun, toolExecutor } });
    const source = wrapper.findComponent({ name: "Runtime" }).props("beginRun")({ prompt: "分析 Shokz", language: "zh", history: [], memory: emptyAgentMemory(), memoryText: "", signal: new AbortController().signal });
    await source.execute({ callId: "r1c1", toolName: "trend", arguments: { target: "Shokz" } });
    expect(await source.complete("", { synthesisFailed: true, partial: false, omittedTargets: [] })).toMatchObject({ ok: false, status: "error", errorCode: "synthesis_unavailable" });
    expect(fallbackRun).not.toHaveBeenCalled(); wrapper.unmount();
  });
  it("原生链的规划凭据与成功结果进入同一临时缓存，停止后可绕过规划", async () => {
    const shared = createAgentSession({ offers: [], language: "zh", enableTrace: false, enableQuestionLogging: false });
    const toolExecutor = vi.fn(async () => ({ toolResult: { callId: "r1c1", toolName: "trend", arguments: { target: "Shokz", months: 12 }, result: { ok: true, data: { target: "Shokz", months: [] } } } }));
    const fallbackRun = vi.fn(async () => ({ ok: true, status: "done" as const, response: "已有结果", steps: [] }));
    const wrapper = mount(CopilotKitAgentHost, { props: { language: "zh", endpoint: "/api/copilotkit", enabled: true, fallbackSession: shared, fallbackRun, toolExecutor } });
    const begin = wrapper.findComponent({ name: "Runtime" }).props("beginRun");
    const request = { prompt: "分析 Shokz 和 Roborock", questionEventId: "q-original", language: "zh", history: [], memory: emptyAgentMemory(), memoryText: "", signal: new AbortController().signal };
    const source = begin(request);
    source.setPlanningState({ agentRunId: "ar_native_12345678", planProofs: ["original-proof"], calls: [
      { id: "r1c1", name: "trend", arguments: { target: "Shokz", months: 12 } },
      { id: "r1c2", name: "trend", arguments: { target: "Roborock", months: 12 } }
    ] });
    await source.execute({ callId: "r1c1", toolName: "trend", arguments: { target: "Shokz", months: 12 } });
    source.stop(); source.dispose();
    expect(shared.getReusableResult()).toMatchObject({ originalQuestion: "分析 Shokz 和 Roborock", sourceQuestionEventId: "q-original", restoreViews: true, partial: true });
    const continued = begin({ ...request, prompt: "继续使用已有结果，不要重新查询", reuseResult: true });
    expect(continued.bypassPlanning).toBe(true); await continued.direct(); expect(toolExecutor).toHaveBeenCalledTimes(1);
    shared.newConversation(); expect(shared.getReusableResult()).toBeNull(); wrapper.unmount();
  });
  it("关键词推荐没有工具结果时不展示模型直接生成的品牌", async () => {
    const wrapper = mount(CopilotKitAgentHost, { props: {
      language: "en", endpoint: "/api/copilotkit", enabled: true,
      fallbackRun: vi.fn(), toolExecutor: vi.fn()
    } });
    const run = wrapper.findComponent({ name: "Runtime" }).props("beginRun")({
      prompt: "vacuum cleaner brand recommendation", language: "en", history: [],
      memory: emptyAgentMemory(), memoryText: "", signal: new AbortController().signal
    });
    const result = await run.complete("Brand X is the best vacuum cleaner brand.", { synthesisFailed: false, partial: false, omittedTargets: [] });
    expect(result.response).not.toContain("Brand X");
    expect(result.response).toContain("verifiable data source");
    wrapper.unmount();
  });

  it("关键词推荐即使执行了错误类型的工具，也不采信模型品牌名单", async () => {
    const toolExecutor = vi.fn(async (): Promise<AgentToolExecutionResponse> => ({
      toolResult: { callId: "r1c1", result: { ok: true } },
      resultView: { id: "wrong-tool", toolName: "merchant_analysis", kind: "table", status: "done", title: "Wrong tool", source: "cache", dataAsOf: null, estimated: false, partial: false, metrics: [], columns: [], rows: [], message: "" }
    }));
    const wrapper = mount(CopilotKitAgentHost, { props: { language: "en", endpoint: "/api/copilotkit", enabled: true, fallbackRun: vi.fn(), toolExecutor } });
    const runtime = wrapper.findComponent({ name: "Runtime" });
    const run = runtime.props("beginRun")({ prompt: "vacuum cleaner brand recommendation", language: "en", history: [], memory: emptyAgentMemory(), memoryText: "", signal: new AbortController().signal });
    const tool = wrapper.findComponent({ name: "Provider" }).props("frontendTools")
      .find((candidate: { name: string }) => candidate.name === "merchant_analysis");
    await tool.handler({ merchant: "vacuum cleaner" }, { toolCall: { id: "r1c1" }, signal: new AbortController().signal });
    const result = await run.complete("Brand X is the best vacuum cleaner brand.", { synthesisFailed: false, partial: false, omittedTargets: [] });
    expect(result.response).toContain("verifiable data source");
    expect(result.response).not.toContain("Brand X");
    wrapper.unmount();
  });


  it("ASIN 详情综合失败时保留价格和商品链接，不重新查询", async () => {
    const agent = createAgentSession({ offers: [], language: "zh", enableTrace: false, enableQuestionLogging: false,
      fetcher: vi.fn(async () => new Response(JSON.stringify({ ok: true, rows: [{ asin: "B09DPRB3TR",
        merchantId: "406220", merchantName: "AOCHUAN", dealPrice: "$51.99", productUrl: "https://www.amazon.com/dp/B09DPRB3TR", monthly: [] }] }),
        { headers: { "Content-Type": "application/json" } })) });
    const fallbackRun = vi.fn();
    const wrapper = mount(CopilotKitAgentHost, { props: { language: "zh", endpoint: "/api/copilotkit", enabled: true,
      fallbackRun, toolExecutor: agent.executeTool } });
    const session = wrapper.findComponent({ name: "Runtime" }).props("beginRun")({ prompt: "ASIN B09DPRB3TR 详情", language: "zh",
      history: [], memory: emptyAgentMemory(), memoryText: "", signal: new AbortController().signal });
    await session.execute({ callId: "r1c1", toolName: "asin_analysis", arguments: { asins: ["B09DPRB3TR"], view: "details" } });
    const result = await session.complete("", { synthesisFailed: true, partial: false, omittedTargets: [] });
    expect(fallbackRun).not.toHaveBeenCalled();
    expect(result.response).toContain("https://www.amazon.com/dp/B09DPRB3TR");
    expect(result.response).toContain("$51.99");
    expect(result.response).not.toContain("| Orders |");
    wrapper.unmount();
  });
  it("Top ASIN 综合失败时保留本轮真实工具结果，不重复规划", async () => {
    const agent = createAgentSession({ offers: [{ merchantId: "362448", merchantName: "Midland Radio", topAsins: ["B09PFBWV55"] }],
      language: "zh", enableTrace: false, enableQuestionLogging: false });
    const fallbackRun = vi.fn();
    const wrapper = mount(CopilotKitAgentHost, { props: { language: "zh", endpoint: "/api/copilotkit", enabled: true,
      fallbackRun, toolExecutor: agent.executeTool } });
    const session = wrapper.findComponent({ name: "Runtime" }).props("beginRun")({ prompt: "Midland Radio top asin", language: "zh",
      history: [], memory: emptyAgentMemory(), memoryText: "", signal: new AbortController().signal });
    await session.execute({ callId: "r1c1", toolName: "merchant_analysis", arguments: { merchant: "362448", view: "top_asins" } });
    await session.execute({ callId: "r1c2", toolName: "merchant_analysis", arguments: { merchant: "999999", view: "top_asins" } });
    const result = await session.complete("", { synthesisFailed: true, partial: true, omittedTargets: [] });
    expect(fallbackRun).not.toHaveBeenCalled();
    expect(result.response).toContain("B09PFBWV55");
    expect(result.response).toContain("Midland Radio");
    expect(result.response).toContain("999999");
    expect(result).toMatchObject({ ok: true, partial: true, fallbackDelivered: true });
    expect(result.resultViews).toHaveLength(2);
    wrapper.unmount();
  });
  it("sends only the bounded tool result to Python, keeping charts and full UI rows local", async () => {
    const toolResult = { callId: "r1c1", result: { ok: true } };
    const toolExecutor = vi.fn(async (): Promise<AgentToolExecutionResponse> => ({ toolResult, resultView: { id: "trend-1", toolName: "trend", kind: "table", status: "done", title: "Trend", source: "cache", dataAsOf: null, estimated: false, partial: false, metrics: [], columns: [], rows: [], message: "" }, memoryEvent: { kind: "tool_success" } }));
    const wrapper = mount(CopilotKitAgentHost, { props: { language: "en", endpoint: "/api/copilotkit", enabled: true, fallbackRun: vi.fn(), toolExecutor } });
    const toolNames = wrapper.findComponent({ name: "Provider" }).props("frontendTools").map((tool: { name: string }) => tool.name);
    expect(toolNames).toContain("asin_analysis");
    wrapper.findComponent({ name: "Runtime" }).props("beginRun")({
      prompt: "Show a trend",
      language: "en",
      history: [],
      memory: emptyAgentMemory(),
      memoryText: "",
      signal: new AbortController().signal
    });
    const tool = wrapper.findComponent({ name: "Provider" }).props("frontendTools")[0];
    const output = await tool.handler({ merchant: "Fixture" }, { toolCall: { id: "r1c1" }, signal: new AbortController().signal });
    expect(output).toEqual({ toolResult });
    expect(toolExecutor).toHaveBeenCalledWith(expect.objectContaining({ prompt: "Show a trend", toolName: "merchant_analysis" }));
    wrapper.unmount();
  });

  it("passes the run attachment to a frontend promotion tool call", async () => {
    const promotionAttachment = {
      manifest: {
        attachmentId: "attachment-a",
        fileName: "campaign.csv",
        merchantCount: 1,
        merchants: [{ merchantId: "101", merchantName: "First merchant" }],
        window: {
          launchDate: "2026-09-07", startDate: "2026-09-07", endDate: "2026-09-13",
          beforeStart: "2026-08-31", beforeEnd: "2026-09-06", days: 7,
        },
      },
      offers: [{ merchantId: "101", merchantName: "First merchant", category: "Home", asins: [] }],
      diagnostics: { totalRows: 1, invalidIdRows: 0, duplicateRows: 0, missingNameRows: 0, sheetsWithMerchantHeader: 1 },
    } as AgentPromotionAttachment;
    const toolResult = { callId: "r1c1", result: { ok: true } };
    const toolExecutor = vi.fn(async (): Promise<AgentToolExecutionResponse> => ({ toolResult }));
    const wrapper = mount(CopilotKitAgentHost, { props: { language: "zh", endpoint: "/api/copilotkit", enabled: true, fallbackRun: vi.fn(), toolExecutor } });
    wrapper.findComponent({ name: "Runtime" }).props("beginRun")({
      prompt: "统计媒体数量",
      language: "zh",
      history: [],
      memory: emptyAgentMemory(),
      memoryText: "",
      signal: new AbortController().signal,
      promotionAttachment,
    });
    const promotionTool = wrapper.findComponent({ name: "Provider" }).props("frontendTools")
      .find((tool: { name: string }) => tool.name === "promotion_analysis");
    expect(promotionTool).toBeDefined();
    await promotionTool.handler({ attachmentId: "attachment-a", view: "file" }, { toolCall: { id: "r1c1" }, signal: new AbortController().signal });
    expect(toolExecutor).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "promotion_analysis",
      promotionAttachment,
    }));
    wrapper.unmount();
  });
});
