import { mount } from "@vue/test-utils";
import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AgentPage, { type AgentRunRequest } from "./AgentPage.vue";
import CopilotKitAgentRuntime from "./CopilotKitAgentRuntime.vue";
import { emptyAgentMemory } from "./agentModel";

const sdk = vi.hoisted(() => ({ run: vi.fn(), stop: vi.fn(), subscribe: vi.fn(), setState: vi.fn(), setMessages: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("@copilotkit/vue/v2", () => ({
  useAgent: () => ({ agent: ref({ subscribe: sdk.subscribe, setState: sdk.setState, setMessages: sdk.setMessages, messages: [] }) }),
  useCopilotKit: () => ({ copilotkit: ref({ runAgent: sdk.run, stopAgent: sdk.stop }) })
}));

let events: Record<string, (payload: any) => void>;
beforeEach(() => {
  vi.clearAllMocks();
  sdk.run.mockReset();
  sdk.subscribe.mockImplementation((value) => { events = value; return { unsubscribe: sdk.unsubscribe }; });
});

function fixture(bypassPlanning = false) {
  const session = {
    language: "zh" as const, history: [{ role: "assistant" as const, content: "EPC: 1.2" }], bypassPlanning,
    direct: vi.fn(async () => ({ ok: true, status: "done" as const, response: "历史上下文解释", steps: [] })),
    execute: vi.fn(), dispose: vi.fn(),
    complete: vi.fn(async (response, options) => ({ ok: true, status: "done" as const, response: options.synthesisFailed ? "已保留工具数据" : response,
      steps: [], fallbackDelivered: options.synthesisFailed === true, partial: false, omittedTargets: [], memoryEvents: [], resultViews: [] }))
  };
  const wrapper = mount(CopilotKitAgentRuntime, { props: { language: "zh", beginRun: () => session } });
  const request: AgentRunRequest = { prompt: "分析商户", language: "zh", history: [], memory: emptyAgentMemory(), memoryText: "Tier 2", signal: new AbortController().signal };
  return { session, wrapper, request, run: wrapper.findComponent(AgentPage).props("run") };
}

describe("CopilotKit behavior parity", () => {
  it("已取得原生规划后传输中断也不启动第二条规划链", async () => {
    const f = fixture(); Object.assign(f.session, { hasPlanned: () => true });
    sdk.run.mockRejectedValue(new TypeError("规划后连接中断"));
    expect(await f.run(f.request)).toMatchObject({ ok: false, status: "error" });
    expect(f.session.direct).not.toHaveBeenCalled(); f.wrapper.unmount();
  });
  it("原生运行时未建立会话且未规划时进入一次备用链", async () => {
    const f = fixture(); sdk.run.mockResolvedValue(undefined);
    expect((await f.run(f.request)).response).toBe("历史上下文解释");
    expect(f.session.direct).toHaveBeenCalledOnce(); expect(f.session.complete).not.toHaveBeenCalled(); f.wrapper.unmount();
  });
  it.each([false, true])("截断规划失败展示未执行提示，不触发备用规划（SDK抛错=%s）", async rejects => {
    const f = fixture();
    sdk.run.mockImplementation(async () => {
      events.onRunErrorEvent?.({ event: { code: "agent_plan_truncated" } });
      if (rejects) throw new Error("规划失败");
    });
    const result = await f.run(f.request);
    expect(result).toMatchObject({ ok: false, status: "error", errorCode: "agent_plan_truncated" });
    expect(result.response).toContain("尚未执行");
    expect(f.session.direct).not.toHaveBeenCalled();
    expect(f.session.complete).not.toHaveBeenCalled();
    f.wrapper.unmount();
  });
  it("将上一轮 ASIN 引用传入 AG-UI 规划状态", async () => {
    const f = fixture();
    sdk.run.mockResolvedValue(undefined);
    await f.run({ ...f.request, prompt: "给我这5个ASIN的信息", asinContext: ["B0D2HKCMBP", "B09BVXT8TJ"] });
    expect(sdk.setState.mock.calls[0]![0].offerIntelligence.asinContext).toEqual(["B0D2HKCMBP", "B09BVXT8TJ"]);
    f.wrapper.unmount();
  });
  it("routes methodology directly with no extra model/planning call", async () => {
    const f = fixture(true);
    expect((await f.run(f.request)).response).toBe("历史上下文解释");
    expect(sdk.run).not.toHaveBeenCalled();
    expect(f.session.dispose).toHaveBeenCalled();
    f.wrapper.unmount();
  });

  it("uses the local source policy when planning returns without tools", async () => {
    const f = fixture();
    sdk.run.mockImplementation(async () => { events.onCustomEvent?.({ event: { name: "oi.planning_fallback", value: { content: "planner text" } } }); });
    await f.run(f.request);
    expect(f.session.direct).toHaveBeenCalledWith({ content: "planner text" });
    expect(sdk.setState.mock.calls[0]![0].offerIntelligence).toMatchObject({ history: f.session.history, memory: "Tier 2", legacyParity: true });
    expect(sdk.setState.mock.calls[0]![0].offerIntelligence.behaviorParity).toBeUndefined();
    f.wrapper.unmount();
  });

  it("keeps tool data when the provider fails and the SDK rejects", async () => {
    const f = fixture();
    sdk.run.mockImplementation(async () => {
      events.onCustomEvent?.({ event: { name: "oi.timeline", value: { step: { id: "synthesis", phase: "synthesis", status: "running" } } } });
      events.onRunErrorEvent?.({ event: { code: "llm_unavailable" } });
      throw new Error("run failed");
    });
    expect(await f.run(f.request)).toMatchObject({ ok: true, status: "done", response: "已保留工具数据" });
    f.wrapper.unmount();
  });

  it("uses the original planning fallback after a transport failure before tools", async () => {
    const f = fixture();
    sdk.run.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await f.run(f.request)).toMatchObject({ ok: true, status: "done" });
    expect(f.session.direct).toHaveBeenCalledWith({});
    f.wrapper.unmount();
  });

  it("does not mask proof-binding failures with a successful fallback", async () => {
    const f = fixture();
    sdk.run.mockImplementation(async () => { events.onRunErrorEvent?.({ event: { code: "run_binding_failed" } }); });
    expect(await f.run(f.request)).toMatchObject({ ok: false, status: "error", response: "" });
    expect(f.session.complete).not.toHaveBeenCalled();
    f.wrapper.unmount();
  });

  it("stops without accepting late tokens or committing fallback data", async () => {
    const f = fixture();
    const controller = new AbortController();
    const onToken = vi.fn();
    sdk.run.mockImplementation(async () => {
      controller.abort();
      events.onTextMessageContentEvent?.({ event: { delta: "late token" } });
    });
    expect(await f.run({ ...f.request, signal: controller.signal, onToken })).toMatchObject({ ok: false, status: "stopped" });
    expect(onToken).not.toHaveBeenCalled();
    expect(f.session.complete).not.toHaveBeenCalled();
    expect(sdk.stop).toHaveBeenCalled();
    f.wrapper.unmount();
  });
});

it("尊重综合校验的失败状态，提示文字不能冒充成功", async () => {
 const f = fixture(); f.session.complete.mockResolvedValue({ ok: false, status: "error", response: "未找到商户", steps: [], fallbackDelivered: false, partial: false, omittedTargets: [], memoryEvents: [], resultViews: [] } as never);
 sdk.run.mockImplementation(async () => { events.onTextMessageContentEvent?.({ event: { delta: "无法回答" } }); });
 expect(await f.run(f.request)).toMatchObject({ ok: false, status: "error", response: "未找到商户" }); f.wrapper.unmount();
});
it("停止后终止仍在运行的综合节点", async () => {
 const f = fixture(); const controller = new AbortController();
 sdk.run.mockImplementation(async () => { events.onCustomEvent?.({ event: { name: "oi.timeline", value: { step: { id: "synthesis", phase: "synthesis", status: "running" } } } }); controller.abort(); });
 const result = await f.run({ ...f.request, signal: controller.signal });
 expect(result.status).toBe("stopped"); expect((result.steps[0] as { status: string }).status).toBe("stopped"); f.wrapper.unmount();
});
