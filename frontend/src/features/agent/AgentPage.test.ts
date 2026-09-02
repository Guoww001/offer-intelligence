import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";

import AgentPage, { type AgentRunResult, type AgentRunner } from "./AgentPage.vue";
import type { LegacyAgentViewState, LegacyAgentRunResult } from "../../legacy/contracts";

describe("AgentPage", () => {
  it("renders the streamed response while the shared Agent session is still running", async () => {
    let release: (() => void) | undefined;
    let state: LegacyAgentViewState = {
      status: "idle",
      history: [],
      messages: [],
      steps: [],
      response: "",
      partial: false,
      omittedTargets: [],
      hasMemory: false
    };
    const listeners = new Set<(next: LegacyAgentViewState) => void>();
    const session = {
      getState: () => state,
      submit: vi.fn(async (_request: unknown, callbacks: { onToken?: (token: string) => void }) => {
        state = {
          ...state,
          status: "running",
          messages: [{ role: "user", content: "查询 EPC" }, { role: "assistant", content: "" }]
        };
        listeners.forEach((listener) => listener(state));
        callbacks.onToken?.("EPC 正在计算…");
        await new Promise<void>((resolve) => { release = resolve; });
        state = {
          ...state,
          status: "done",
          response: "EPC 正在计算…",
          history: [{ role: "user", content: "查询 EPC" }, { role: "assistant", content: "EPC 正在计算…" }],
          messages: [{ role: "user", content: "查询 EPC" }, { role: "assistant", content: "EPC 正在计算…" }]
        };
        listeners.forEach((listener) => listener(state));
        return { ok: true as const, status: "done" as const, response: state.response, steps: [] };
      }),
      stop: vi.fn(),
      newConversation: vi.fn(),
      onChange: vi.fn((listener: (next: LegacyAgentViewState) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      })
    };
    const wrapper = mount(AgentPage, { props: { language: "zh", run: vi.fn(), session, autoFocus: false } });

    await wrapper.get('[data-agent-input]').setValue("查询 EPC");
    void wrapper.get('[data-agent-form]').trigger("submit");
    await nextTick();

    expect(wrapper.find('[data-agent-streaming-response]').text()).toContain("EPC 正在计算");
    release?.();
    await flushPromises();
  });

  it("uses the shared Agent session, renders streamed tokens and survives remount", async () => {
    let state: LegacyAgentViewState = {
      status: "idle",
      history: [],
      messages: [],
      steps: [],
      response: "",
      partial: false,
      omittedTargets: [],
      hasMemory: false
    };
    const listeners = new Set<(next: LegacyAgentViewState) => void>();
    const result: LegacyAgentRunResult = {
      ok: true,
      status: "done",
      response: "EPC 1.23",
      steps: [{ id: "tool-1", phase: "tool", status: "done", label: "商户分析", dataSource: "database" }],
      memoryEvents: []
    };
    const session = {
      getState: () => state,
      submit: vi.fn(async (_request: unknown, callbacks: { onToken?: (token: string) => void; onTimeline?: (step: unknown) => void }) => {
        state = { ...state, status: "running", messages: [{ role: "user", content: "查询 EPC" }, { role: "assistant", content: "" }] };
        listeners.forEach((listener) => listener(state));
        callbacks.onTimeline?.(result.steps[0]);
        callbacks.onToken?.("EPC ");
        state = {
          ...state,
          status: "done",
          response: result.response,
          steps: result.steps,
          history: [{ role: "user", content: "查询 EPC" }, { role: "assistant", content: result.response }],
          messages: [{ role: "user", content: "查询 EPC" }, { role: "assistant", content: result.response }]
        };
        listeners.forEach((listener) => listener(state));
        return result;
      }),
      stop: vi.fn(),
      newConversation: vi.fn(() => { state = { ...state, status: "idle", history: [], messages: [], response: "", steps: [] }; }) ,
      onChange: vi.fn((listener: (next: LegacyAgentViewState) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      })
    };
    const wrapper = mount(AgentPage, {
      props: { language: "zh", run: vi.fn(), session, autoFocus: false }
    });

    await wrapper.get('[data-agent-input]').setValue("查询 EPC");
    await wrapper.get('[data-agent-form]').trigger("submit");
    await flushPromises();

    expect(session.submit).toHaveBeenCalledWith(expect.objectContaining({ prompt: "查询 EPC" }), expect.objectContaining({
      onToken: expect.any(Function),
      onTimeline: expect.any(Function)
    }));
    expect(wrapper.find('[data-agent-response]').text()).toContain("EPC 1.23");
    expect(wrapper.find('[data-agent-timeline-step]').attributes("data-step-status")).toBe("done");

    wrapper.unmount();
    const remounted = mount(AgentPage, { props: { language: "zh", run: vi.fn(), session, autoFocus: false } });
    await nextTick();
    expect(remounted.text()).toContain("EPC 1.23");
  });

  it("submits through the runner, displays structured timeline and response", async () => {
    const run = vi.fn(async () => ({
      ok: true as const,
      status: "done" as const,
      response: "### Tapo\n\nEPC 已返回。",
      steps: [
        { id: "planning", phase: "planning" as const, status: "done" as const, label: "规划", detail: "已生成数据步骤" },
        { id: "synthesis", phase: "synthesis" as const, status: "done" as const, label: "综合", detail: "已完成" }
      ],
      memoryEvents: []
    }));
    const wrapper = mount(AgentPage, { props: { language: "zh", run, autoFocus: false } });

    await wrapper.get('[data-agent-input]').setValue("查询 Tapo");
    await wrapper.get('[data-agent-form]').trigger("submit");
    await flushPromises();

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ prompt: "查询 Tapo", language: "zh" }));
    expect(wrapper.find('[data-agent-timeline]').exists()).toBe(true);
    expect(wrapper.find('[data-agent-response] h3').exists()).toBe(true);
    expect(wrapper.find('[data-agent-response]').text()).toContain("Tapo");
  });

  it("keeps Agent feedback and question-log downloads on the shared session", async () => {
    let state: LegacyAgentViewState = {
      status: "idle",
      history: [],
      messages: [],
      steps: [],
      response: "",
      partial: false,
      omittedTargets: [],
      hasMemory: false
    };
    const listeners = new Set<(next: LegacyAgentViewState) => void>();
    const feedback = {
      isAvailable: vi.fn(() => state.status === "done"),
      submit: vi.fn(async () => ({ ok: true as const }))
    };
    const session = {
      getState: () => state,
      submit: vi.fn(async () => {
        state = {
          ...state,
          status: "done",
          response: "EPC 1.23",
          history: [{ role: "user" as const, content: "show EPC" }, { role: "assistant" as const, content: "EPC 1.23" }],
          messages: [{ role: "user" as const, content: "show EPC" }, { role: "assistant" as const, content: "EPC 1.23" }]
        };
        listeners.forEach((listener) => listener(state));
        return { ok: true as const, status: "done" as const, response: "EPC 1.23", steps: [] };
      }),
      stop: vi.fn(),
      newConversation: vi.fn(),
      feedback,
      downloadLogs: vi.fn(() => true),
      onChange: vi.fn((listener: (next: LegacyAgentViewState) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      })
    };
    const wrapper = mount(AgentPage, {
      props: { language: "en", run: vi.fn(), session, autoFocus: false }
    });

    await wrapper.get('[data-agent-input]').setValue("show EPC");
    await wrapper.get('[data-agent-form]').trigger("submit");
    await flushPromises();
    await wrapper.get('[data-feedback-action="open"]').trigger("click");
    await wrapper.get('[data-feedback-reason="inaccurate"]').setValue(true);
    await wrapper.get('[data-feedback-form]').trigger("submit");
    await flushPromises();
    await wrapper.get('[data-agent-log="questions-csv"]').trigger("click");

    expect(feedback.submit).toHaveBeenCalledWith("inaccurate", "");
    expect(session.downloadLogs).toHaveBeenCalledWith("questions", "csv");
  });

  it("aborts an active run and clears the conversation", async () => {
    let resolveRun: ((value: AgentRunResult) => void) | undefined;
    const run: AgentRunner = vi.fn(() => new Promise<AgentRunResult>((resolve) => { resolveRun = resolve; }));
    const wrapper = mount(AgentPage, { props: { language: "en", run, autoFocus: false } });

    await wrapper.get('[data-agent-input]').setValue("show a trend");
    await wrapper.get('[data-agent-form]').trigger("submit");
    await flushPromises();
    expect(wrapper.find('[data-agent-action="stop"]').exists()).toBe(true);
    await wrapper.get('[data-agent-action="stop"]').trigger("click");
    resolveRun?.({ ok: false, status: "stopped", response: "", steps: [], memoryEvents: [] });
    await flushPromises();
    expect(wrapper.find('[data-agent-status="stopped"]').exists()).toBe(true);

    await wrapper.get('[data-agent-action="new"]').trigger("click");
    expect(wrapper.find('[data-agent-response]').exists()).toBe(false);
    expect(wrapper.find('[data-agent-welcome]').exists()).toBe(true);
  });

  it("aborts a shared Agent request when the page is unmounted", async () => {
    let state: LegacyAgentViewState = {
      status: "idle",
      history: [],
      messages: [],
      steps: [],
      response: "",
      partial: false,
      omittedTargets: [],
      hasMemory: false
    };
    let release: (() => void) | undefined;
    let requestSignal: AbortSignal | undefined;
    const session = {
      getState: () => state,
      submit: vi.fn((request: { signal: AbortSignal }) => new Promise<LegacyAgentRunResult>((resolve) => {
        requestSignal = request.signal;
        release = () => resolve({ ok: false, status: "stopped", response: "", steps: [] });
      })),
      stop: vi.fn(),
      newConversation: vi.fn(),
      onChange: vi.fn(() => () => undefined)
    };
    const wrapper = mount(AgentPage, { props: { language: "en", run: vi.fn(), session, autoFocus: false } });

    await wrapper.get('[data-agent-input]').setValue("live query");
    void wrapper.get('[data-agent-form]').trigger("submit");
    await nextTick();

    expect(requestSignal).toBeDefined();
    wrapper.unmount();
    expect(requestSignal?.aborted).toBe(true);
    release?.();
    await flushPromises();
  });
});
