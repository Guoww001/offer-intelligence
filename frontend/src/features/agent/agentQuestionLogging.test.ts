import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CopilotKitAgentHost from "./CopilotKitAgentHost.vue";
import { createAgentActivity } from "./agentActivity";
import { createAgentSession } from "./agentSession";
import { clearAgentViewSnapshot } from "./agentViewState";

const sdk = vi.hoisted(() => ({ run: vi.fn(), subscribe: vi.fn(), setState: vi.fn(), setMessages: vi.fn(), stop: vi.fn() }));
vi.mock("@copilotkit/vue/v2", () => ({
  CopilotKitProvider: { inheritAttrs: false, props: ["frontendTools"], template: "<slot />" },
  useAgent: () => ({ agent: ref({ subscribe: sdk.subscribe, setState: sdk.setState, setMessages: sdk.setMessages, messages: [] }) }),
  useCopilotKit: () => ({ copilotkit: ref({ runAgent: sdk.run, stopAgent: sdk.stop }) })
}));

type Request = { url: string; body: Record<string, any> };
let events: Record<string, (payload: any) => void>;
const originalRuntime = window.OI_MODERN_RUNTIME;
beforeEach(() => {
  vi.clearAllMocks();
  sdk.run.mockReset();
  sdk.subscribe.mockImplementation(value => { events = value; return { unsubscribe: vi.fn() }; });
  clearAgentViewSnapshot("modern-agent");
  localStorage.clear();
});
afterEach(() => { window.OI_MODERN_RUNTIME = originalRuntime; });

function fixture(enabled = true, outcome: "done" | "failed" | "stopped" = "done") {
  const requests: Request[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input), body = JSON.parse(String(init?.body || "{}"));
    requests.push({ url, body });
    if (url === "/api/chat/agent" && outcome === "stopped") return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("已停止", "AbortError")), { once: true });
    });
    const payload = url === "/api/chat/agent"
      ? outcome === "failed" ? { ok: false, round: 2, errorCode: "agent_planning_unavailable" }
      : { ok: true, agentRunId: "ar_log_regression_123456", round: 1, content: "EPC 为每次点击的联盟佣金。", toolCalls: [] }
      : { ok: true, recordId: body.eventId || body.recordId };
    return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
  });
  const activity = createAgentActivity({ fetcher, storage: localStorage });
  window.OI_MODERN_RUNTIME = { createAgentActivity: () => activity } as never;
  const session = createAgentSession({ offers: [], language: "zh", fetcher, storage: localStorage });
  const fallbackRun = vi.fn(request => session.submit(request));
  const wrapper = mount(CopilotKitAgentHost, { props: { language: "zh", enabled, endpoint: "/api/copilotkit", storage: localStorage,
    fallbackRun, fallbackSession: session, toolExecutor: session.executeTool } });
  const questionRequests = (action: string) => requests.filter(row => row.url.includes("operation=questions") && row.body.action === action);
  async function submit(prompt: string) {
    await wrapper.get("[data-agent-input]").setValue(prompt);
    await wrapper.get("[data-agent-form]").trigger("submit");
    await flushPromises();
  }
  return { requests, wrapper, session, activity, fallbackRun, questionRequests, submit };
}

describe("一次 Agent 提问仅登记一次日志", () => {
  it.each([
    { scenario: "传输失败", prompt: "EPC 是什么", question: "EPC 是什么" },
    { scenario: "斜杠命令回退", prompt: "/merchant Shokz", question: "分析商户 Shokz" },
    { scenario: "无工具规划回退", prompt: "EPC 是什么", question: "EPC 是什么" },
    { scenario: "综合失败回退", prompt: "EPC 是什么", question: "EPC 是什么" }
  ])("$scenario 复用页面事件，保留原问题及反馈关联", async ({ scenario, prompt, question }) => {
    const f = fixture();
    sdk.run.mockImplementation(async () => {
      if (scenario === "无工具规划回退") events.onCustomEvent?.({ event: { name: "oi.planning_fallback", value: { content: "定义" } } });
      else {
        if (scenario === "综合失败回退") events.onCustomEvent?.({ event: { name: "oi.timeline", value: { step: { id: "synthesis", phase: "synthesis", status: "running" } } } });
        throw new TypeError("模拟传输失败");
      }
    });
    try {
      await f.submit(prompt);
      const created = f.questionRequests("create"), completed = f.questionRequests("complete");
      expect(created).toHaveLength(1);
      expect(completed).toHaveLength(1);
      expect(created[0]!.body.prompt).toBe(prompt);
      expect(completed[0]!.body.recordId).toBe(created[0]!.body.eventId);
      const plan = f.requests.find(row => row.url === "/api/chat/agent");
      if (scenario === "综合失败回退") {
        expect(plan).toBeUndefined();
        expect(f.fallbackRun).not.toHaveBeenCalled();
        expect(completed[0]!.body.status).toBe("failed");
      } else {
        expect(plan!.body.question).toBe(question);
        expect(plan!.body.trace.questionEventId).toBe(created[0]!.body.eventId);
        expect(f.requests.filter(row => row.url.includes("operation=agent_trace"))).not.toHaveLength(0);
      }
      expect(f.requests.filter(row => row.url.includes("operation=agent_trace")).every(row => row.body.questionEventId === created[0]!.body.eventId)).toBe(true);
      const feedback = f.wrapper.findComponent({ name: "AgentPage" }).props("session");
      expect(feedback).toBeUndefined();
      const answerFeedback = f.activity.feedbackForAnswer(created[0]!.body.eventId)!;
      expect(answerFeedback.isAvailable()).toBe(true);
      expect(await answerFeedback.submit("unclear")).toEqual({ ok: true });
      const submitted = f.requests.find(row => row.url.includes("operation=feedback"))!;
      expect(submitted.body.questionEventId).toBe(created[0]!.body.eventId);
      expect(submitted.body.prompt).toBe(prompt);
    } finally { f.wrapper.unmount(); f.session.dispose?.(); }
  });

  it.each([true, false])("正常执行 enabled=%s 仍只创建和完成一条记录", async enabled => {
    const f = fixture(enabled);
    sdk.run.mockImplementation(async () => { events.onTextMessageContentEvent?.({ event: { delta: "EPC 是每次点击的联盟佣金。" } }); });
    try {
      await f.submit("EPC 是什么");
      expect(f.questionRequests("create")).toHaveLength(1);
      expect(f.questionRequests("complete")).toHaveLength(1);
    } finally { f.wrapper.unmount(); f.session.dispose?.(); }
  });

  it.each(["failed", "stopped"] as const)("备用执行 %s 仅完成页面记录，并可反馈空回答", async outcome => {
    const f = fixture(true, outcome);
    sdk.run.mockRejectedValue(new TypeError("模拟传输失败"));
    try {
      await f.submit("EPC 是什么");
      if (outcome === "stopped") {
        expect(f.wrapper.find("[data-agent-action=stop]").exists()).toBe(true);
        await f.wrapper.get("[data-agent-action=stop]").trigger("click");
        await flushPromises();
      }
      const created = f.questionRequests("create");
      expect(created).toHaveLength(1);
      expect(f.questionRequests("complete")).toHaveLength(1);
      expect(f.questionRequests("complete")[0]!.body).toMatchObject({ recordId: created[0]!.body.eventId, status: "failed" });
      expect(await f.activity.feedbackForAnswer(created[0]!.body.eventId)!.submit("not_answered")).toEqual({ ok: true });
      expect(f.requests.find(row => row.url.includes("operation=feedback"))!.body).toMatchObject({ questionEventId: created[0]!.body.eventId, answer: "" });
    } finally { f.wrapper.unmount(); f.session.dispose?.(); }
  });

  it("数据规划失败仅完成原事件为 failed，并保留反馈关联", async () => {
    const f = fixture(true, "failed");
    sdk.run.mockRejectedValue(new TypeError("模拟传输失败"));
    try {
      await f.submit("分析Shokz最近12个月收入、订单、CVR和EPC");
      const created = f.questionRequests("create");
      expect(created).toHaveLength(1);
      expect(f.questionRequests("complete")).toHaveLength(1);
      expect(f.questionRequests("complete")[0]!.body).toMatchObject({ recordId: created[0]!.body.eventId, status: "failed" });
      expect(f.session.getState().history).toHaveLength(0);
      expect(await f.activity.feedbackForAnswer(created[0]!.body.eventId)!.submit("not_answered")).toEqual({ ok: true });
      expect(f.requests.find(row => row.url.includes("operation=feedback"))!.body.questionEventId).toBe(created[0]!.body.eventId);
    } finally { f.wrapper.unmount(); f.session.dispose?.(); }
  });

  it("用户再次提交相同问题仍记录为新的独立提问", async () => {
    const f = fixture();
    sdk.run.mockRejectedValue(new TypeError("模拟传输失败"));
    try {
      await f.submit("EPC 是什么");
      await f.submit("EPC 是什么");
      const created = f.questionRequests("create");
      expect(created).toHaveLength(2);
      expect(new Set(created.map(row => row.body.eventId)).size).toBe(2);
      expect(f.questionRequests("complete")).toHaveLength(2);
      expect(await f.activity.feedbackForAnswer(created[0]!.body.eventId)!.submit("unclear")).toEqual({ ok: true });
      expect(f.requests.find(row => row.url.includes("operation=feedback"))!.body.questionEventId).toBe(created[0]!.body.eventId);
    } finally { f.wrapper.unmount(); f.session.dispose?.(); }
  });
});
