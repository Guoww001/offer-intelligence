import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AgentPage, { type AgentRunRequest } from "./AgentPage.vue";
import CopilotKitAgentRuntime from "./CopilotKitAgentRuntime.vue";
import { emptyAgentMemory } from "./agentModel";

const sdk = vi.hoisted(() => ({ run: vi.fn(), stop: vi.fn(), subscribe: vi.fn(), setState: vi.fn(), setMessages: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("@copilotkit/vue/v2", () => ({
  useAgent: () => ({ agent: ref({ subscribe: sdk.subscribe, setState: sdk.setState, setMessages: sdk.setMessages, messages: [] }) }),
  useCopilotKit: () => ({ copilotkit: ref({ runAgent: sdk.run, stopAgent: sdk.stop }) })
}));

let events: Record<"onStateSnapshotEvent" | "onTextMessageContentEvent" | "onCustomEvent" | "onRunErrorEvent", (payload: any) => void>;
const traceFetch = vi.fn(async () => new Response('{"ok":true}'));
beforeEach(() => {
  vi.clearAllMocks();
  sdk.run.mockReset();
  traceFetch.mockReset().mockResolvedValue(new Response('{"ok":true}'));
  vi.stubGlobal("fetch", traceFetch);
  sdk.subscribe.mockImplementation((value) => { events = value; return { unsubscribe: sdk.unsubscribe }; });
});
afterEach(() => vi.unstubAllGlobals());

function fixture(bypassPlanning = false) {
  const session = {
    language: "zh" as const, history: [{ role: "assistant" as const, content: "EPC: 1.2" }], bypassPlanning,
    direct: vi.fn(async () => ({ ok: true, status: "done" as const, response: "历史上下文解释", steps: [] })),
    execute: vi.fn(), dispose: vi.fn(),
    complete: vi.fn(async (response, options) => ({ ok: true, status: "done" as const, response: options.synthesisFailed ? "已保留工具数据" : response,
      steps: [], fallbackDelivered: options.synthesisFailed === true, partial: false, omittedTargets: [], memoryEvents: [], resultViews: [] }))
  };
  let nativeToolStep: ((step: unknown) => void) | undefined;
  const wrapper = mount(CopilotKitAgentRuntime, { props: { language: "zh", beginRun: (request: any) => { nativeToolStep = request.onNativeToolStep; return session; } } });
  let request: AgentRunRequest = { prompt: "分析商户", language: "zh", history: [], memory: emptyAgentMemory(), memoryText: "Tier 2", signal: new AbortController().signal };
  request = { ...request, questionEventId: "11111111-1111-4111-8111-111111111111" };
  return { session, wrapper, request, run: wrapper.findComponent(AgentPage).props("run"), toolStep: (step: unknown) => nativeToolStep?.(step) };
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

function traceBodies(): Record<string, any>[] {
  return traceFetch.mock.calls.map((args) => JSON.parse(String((args as unknown as [string, RequestInit])[1]?.body)));
}

describe("原生 Trace 闭环", () => {
  it("成功关联原提问，阶段与执行计数去重且不记录正文", async () => {
    const f = fixture();
    sdk.run.mockImplementation(async () => {
      events.onCustomEvent({ event: { name: "oi.timeline", value: { id: "planning", phase: "planning", status: "running", label: "敏感问题" } } });
      events.onStateSnapshotEvent({ event: { snapshot: { offerIntelligence: { agentRunId: "native", calls: [{ id: "r1c1", name: "trend", arguments: { target: "敏感参数" } }] } } } });
      f.toolStep({ callId: "r1c1", toolName: "trend", status: "running" });
      f.toolStep({ callId: "r1c1", toolName: "trend", status: "done" });
      for (let index = 0; index < 2; index++) events.onCustomEvent({ event: { name: "oi.timeline", value: { id: "r1c1", phase: "tool", status: "done", label: "trend", detail: "敏感结果" } } });
      events.onCustomEvent({ event: { name: "oi.timeline", value: { id: "synthesis", phase: "synthesis", status: "running" } } });
      events.onTextMessageContentEvent({ event: { delta: "敏感回答" } });
    });
    expect(await f.run(f.request)).toMatchObject({ ok: true, status: "done" });
    await flushPromises();
    const bodies = traceBodies();
    expect(bodies[0]).toMatchObject({ action: "start", questionEventId: f.request.questionEventId });
    expect(bodies.at(-1)).toMatchObject({ action: "complete", status: "success", plannedToolCalls: 1, executedToolCalls: 1, failedToolCalls: 0 });
    const steps = bodies.flatMap(body => body.steps || []);
    expect(steps.filter(step => step.phase === "tool")).toHaveLength(1);
    expect(steps.every(step => step.usageAvailable === false && step.inputTokens === null && step.outputTokens === null && step.totalTokens === null)).toBe(true);
    expect(JSON.stringify(bodies)).not.toMatch(/敏感|分析商户|Tier 2|arguments|response|prompt|messages/);
    f.wrapper.unmount();
  });

  it.each(["agent_plan_truncated", "agent_no_tool_plan", "agent_planning_unavailable"])("规划失败 %s 保留原提问且闭环", async code => {
    const f = fixture();
    sdk.run.mockImplementation(async () => events.onRunErrorEvent({ event: { code } }));
    expect(await f.run(f.request)).toMatchObject({ status: "error" });
    await flushPromises();
    expect(traceBodies().at(-1)).toMatchObject({ action: "complete", status: "failed", errorCode: code, executedToolCalls: 0 });
    f.wrapper.unmount();
  });

  it("工具失败在 SDK 中断时准确计数并闭环", async () => {
    const f = fixture(); Object.assign(f.session, { hasPlanned: () => true });
    sdk.run.mockImplementation(async () => {
      f.toolStep({ callId: "r1c1", toolName: "trend", status: "running" });
      f.toolStep({ callId: "r1c1", toolName: "trend", status: "error", errorCode: "tool_error" });
      throw new Error("敏感异常");
    });
    expect(await f.run(f.request)).toMatchObject({ status: "error" }); await flushPromises();
    expect(traceBodies().at(-1)).toMatchObject({ action: "complete", status: "failed", plannedToolCalls: 1, executedToolCalls: 1, failedToolCalls: 1 });
    expect(JSON.stringify(traceBodies())).not.toContain("敏感异常"); f.wrapper.unmount();
  });

  it("停止立即终结原生 Trace，即使 SDK 没有返回", async () => {
    const f = fixture(); const controller = new AbortController(); let release: () => void = () => {};
    sdk.run.mockImplementation(async () => {
      events.onCustomEvent({ event: { name: "oi.timeline", value: { id: "planning", phase: "planning", status: "running" } } });
      await new Promise<void>(resolve => { release = resolve; });
    });
    const pending = f.run({ ...f.request, signal: controller.signal }); controller.abort(); await flushPromises();
    expect(traceBodies().at(-1)).toMatchObject({ action: "complete", status: "stopped", stoppedByUser: true, errorCode: "stopped_by_user" });
    release(); expect(await pending).toMatchObject({ status: "stopped" }); await flushPromises();
    expect(traceBodies().filter(body => body.action === "complete")).toHaveLength(1); f.wrapper.unmount();
  });

  it.each(["bypass", "empty", "fallback"])("直接备用执行 %s 不创建第二条 Trace", async mode => {
    const f = fixture(mode === "bypass");
    sdk.run.mockImplementation(async () => {
      if (mode === "fallback") {
        events.onCustomEvent({ event: { name: "oi.timeline", value: { id: "planning", phase: "planning", status: "done" } } });
        events.onCustomEvent({ event: { name: "oi.planning_fallback", value: { content: "无需工具" } } });
      }
    });
    await f.run(f.request); await flushPromises(); expect(traceFetch).not.toHaveBeenCalled(); f.wrapper.unmount();
  });

  it.each(["规划", "工具"])("已经建立%s后重规划无工具，只整理已有结果并闭环一条 Trace", async established => {
    const f = fixture();
    Object.assign(f.session, { hasPlanned: () => established === "规划" });
    sdk.run.mockImplementation(async () => {
      if (established === "规划") events.onStateSnapshotEvent({ event: { snapshot: { offerIntelligence: { agentRunId: "native", calls: [{ id: "r1c1", name: "trend" }] } } } });
      else {
        f.toolStep({ callId: "r1c1", toolName: "trend", status: "done" });
        events.onCustomEvent({ event: { name: "oi.timeline", value: { id: "r1c1", phase: "tool", status: "done" } } });
      }
      events.onCustomEvent({ event: { name: "oi.planning_fallback", value: { content: "不可重新规划" } } });
    });
    expect(await f.run(f.request)).toMatchObject({ ok: true, status: "done", response: "已保留工具数据" });
    expect(f.session.direct).not.toHaveBeenCalled();
    expect(f.session.complete).toHaveBeenCalledWith("", { synthesisFailed: true, partial: false, omittedTargets: [] });
    await flushPromises();
    expect(traceBodies().filter(body => body.action === "start")).toHaveLength(1);
    expect(traceBodies().filter(body => body.action === "complete")).toHaveLength(1);
    expect(traceBodies().at(-1)).toMatchObject({ status: "success", fallbackDelivered: true }); f.wrapper.unmount();
  });

  it("已有工具结果但整理失败时保留失败状态和原生结果", async () => {
    const f = fixture(); Object.assign(f.session, { hasPlanned: () => true });
    f.session.complete.mockResolvedValue({ ok: false, status: "error", response: "已有查询结果仍保留", steps: [], fallbackDelivered: false, partial: false, omittedTargets: [], memoryEvents: [], resultViews: [], errorCode: "synthesis_unavailable" } as never);
    sdk.run.mockImplementation(async () => events.onCustomEvent({ event: { name: "oi.planning_fallback", value: {} } }));
    expect(await f.run(f.request)).toMatchObject({ ok: false, status: "error", response: "已有查询结果仍保留", errorCode: "agent_no_tool_plan" });
    expect(f.session.direct).not.toHaveBeenCalled(); await flushPromises();
    expect(traceBodies().at(-1)).toMatchObject({ action: "complete", status: "failed", errorCode: "agent_no_tool_plan" }); f.wrapper.unmount();
  });

  it("Trace 写入悬挂与失败都不阻塞回答和后续运行", async () => {
    const f = fixture(); let release: (response: Response) => void = () => {};
    traceFetch.mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; }));
    sdk.run.mockImplementation(async () => events.onTextMessageContentEvent({ event: { delta: "完成" } }));
    expect(await f.run(f.request)).toMatchObject({ ok: true, response: "完成" });
    release(new Response('{"ok":true}'));
    traceFetch.mockRejectedValue(new Error("写入失败"));
    expect(await f.run(f.request)).toMatchObject({ ok: true, response: "完成" });
    await flushPromises(); f.wrapper.unmount();
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
