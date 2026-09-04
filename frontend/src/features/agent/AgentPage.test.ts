import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AgentPage, { type AgentRunResult, type AgentRunner } from "./AgentPage.vue";
import { normalizeAgentResultView } from "../../shared/contracts/agentResult";
import type { AgentSessionResult, AgentSessionState } from "./agentSession";
import { clearAgentViewSnapshot } from "./agentViewState";

describe("AgentPage", () => {
  beforeEach(() => clearAgentViewSnapshot("modern-agent"));

  it("keeps result components with their answer after a follow-up and clears them on new conversation", async () => {
    const view = normalizeAgentResultView({ id: "result-1", toolName: "merchant_analysis", kind: "metric", status: "done", title: "Merchant metrics", metrics: [{ label: "EPC", value: "1.2" }] })!;
    const run = vi.fn<AgentRunner>()
      .mockResolvedValueOnce({ ok: true, status: "done", response: "First answer", steps: [], resultViews: [view] })
      .mockResolvedValueOnce({ ok: true, status: "done", response: "Follow-up answer", steps: [] });
    const wrapper = mount(AgentPage, { props: { language: "en", run, autoFocus: false } });
    await wrapper.get('[data-agent-input]').setValue("Show merchant metrics");
    await wrapper.get('[data-agent-form]').trigger("submit");
    await flushPromises();
    await wrapper.get('[data-agent-input]').setValue("Why?");
    await wrapper.get('[data-agent-form]').trigger("submit");
    await flushPromises();
    expect(wrapper.findAll('[data-result-id="result-1"]')).toHaveLength(1);
    expect(wrapper.text()).toContain("Follow-up answer");
    expect(run.mock.calls[1]![0].history).toEqual([{ role: "user", content: "Show merchant metrics" }, { role: "assistant", content: "First answer" }]);
    await wrapper.get('[data-agent-action="new"]').trigger("click");
    expect(wrapper.find('[data-result-id="result-1"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("keeps the details rail and result workspace in the new layout", () => {
    const wrapper = mount(AgentPage, {
      props: { language: "zh", run: vi.fn(), autoFocus: false }
    });

    expect(wrapper.find(".aw-header").exists()).toBe(true);
    expect(wrapper.find('[data-agent-details]').exists()).toBe(true);
    expect(wrapper.find('[data-agent-surface="workspace"]').exists()).toBe(true);
    expect(wrapper.find('textarea[data-agent-input]').exists()).toBe(true);
    expect(wrapper.find('.aw-composer-note').exists()).toBe(false);
    wrapper.unmount();
  });

  it("filters all slash commands, keeps IME Enter safe, and runs the selected command", async () => {
    const run = vi.fn<AgentRunner>().mockResolvedValue({ ok: true, status: "done", response: "Answer", steps: [] });
    const wrapper = mount(AgentPage, { props: { language: "en", run, autoFocus: false } });
    const field = wrapper.get('[data-agent-input]');
    await field.setValue('/');
    expect(wrapper.findAll('[role="option"]')).toHaveLength(14);
    await field.setValue('/pub');
    expect(wrapper.findAll('[role="option"]')).toHaveLength(2);
    await field.trigger('keydown', { key: 'Enter', isComposing: true });
    expect(run).not.toHaveBeenCalled();
    await field.setValue('/merch');
    await field.trigger('keydown', { key: 'Enter' });
    expect((field.element as HTMLTextAreaElement).value).toBe('/merchant ');
    await field.trigger('keydown', { key: 'Enter' });
    expect(run).not.toHaveBeenCalled();
    await field.setValue('/merchant Tapo');
    await field.trigger('keydown', { key: 'Enter', shiftKey: true });
    expect(run).not.toHaveBeenCalled();
    await field.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Analyze merchant Tapo' }));
    wrapper.unmount();
  });

  it("uses the existing publisher renderer without asking the model to invent a publisher tool", async () => {
    const run = vi.fn<AgentRunner>().mockResolvedValue({ ok: true, status: 'done', response: 'Publisher follow-up', steps: [] });
    const bridge = vi.fn(async () => ({ html: '<table><tr><td>Publisher fixture</td></tr></table>', text: 'Publisher fixture', source: 'db' as const }));
    const previous = window.OI_MODERN_RUNTIME;
    window.OI_MODERN_RUNTIME = { ...previous, runAgentPublisher: bridge };
    const session = { getState: () => ({ status: 'idle' as const, history: [], steps: [], response: '', partial: false, omittedTargets: [], hasMemory: false }), submit: vi.fn(), stop: vi.fn(), newConversation: vi.fn(), onChange: () => () => undefined };
    const wrapper = mount(AgentPage, { props: { language: 'en', run, session, autoFocus: false } });
    await wrapper.get('[data-agent-input]').setValue('/publisher 1022');
    await wrapper.get('[data-agent-form]').trigger('submit');
    await flushPromises();
    expect(bridge).toHaveBeenCalledWith(expect.objectContaining({ kind: 'publisher', query: '1022' }));
    expect(run).not.toHaveBeenCalled();
    expect(wrapper.get('[data-chatbot-rich-result] td').text()).toBe('Publisher fixture');
    await wrapper.get('[data-agent-input]').setValue('Explain that publisher');
    await wrapper.get('[data-agent-form]').trigger('submit'); await flushPromises();
    expect(run.mock.calls[0]![0].history).toEqual([{ role: 'user', content: '/publisher 1022' }, { role: 'assistant', content: 'Publisher fixture' }]);
    expect(session.submit).not.toHaveBeenCalled();
    expect(wrapper.get('[data-chatbot-rich-result] td').text()).toBe('Publisher fixture');
    wrapper.unmount(); window.OI_MODERN_RUNTIME = previous;
  });

  it("captures a failed prompt for replay, restoring its original history", async () => {
    const run = vi.fn<AgentRunner>()
      .mockResolvedValueOnce({ ok: true, status: 'done', response: 'First answer', steps: [] })
      .mockResolvedValueOnce({ ok: false, status: 'error', response: '', steps: [], errorCode: 'agent_synthesis_unavailable' })
      .mockResolvedValueOnce({ ok: true, status: 'done', response: 'Fixed answer', steps: [] });
    const wrapper = mount(AgentPage, { props: { language: 'en', run, autoFocus: false } });
    for (const prompt of ['Show Tapo', 'And its trend?']) {
      await wrapper.get('[data-agent-input]').setValue(prompt);
      await wrapper.get('[data-agent-form]').trigger('submit'); await flushPromises();
    }
    expect(wrapper.find('[data-agent-diagnostics]').exists()).toBe(true);
    await wrapper.get('[data-agent-log-replay]').trigger('click'); await flushPromises();
    expect(run.mock.calls[2]![0].history).toEqual(run.mock.calls[1]![0].history);
    expect(run.mock.calls[2]![0].prompt).toBe('And its trend?');
    expect(wrapper.get('[data-agent-replay-comparison]').text()).toContain('Fixed answer');
    wrapper.unmount();
  });

  it("collapses the empty composer while reading older content and preserves drafts", async () => {
    const run = vi.fn<AgentRunner>().mockResolvedValue({ ok: true, status: 'done', response: 'Answer', steps: [] });
    const wrapper = mount(AgentPage, { props: { language: 'en', run, autoFocus: false } });
    await wrapper.get('[data-agent-input]').setValue('Tapo');
    await wrapper.get('[data-agent-form]').trigger('submit'); await flushPromises();
    const log = wrapper.get('[data-agent-log]').element;
    Object.defineProperties(log, { scrollHeight: { value: 2000, configurable: true }, clientHeight: { value: 500, configurable: true }, scrollTop: { value: 120, writable: true, configurable: true } });
    await wrapper.get('[data-agent-log]').trigger('scroll');
    expect(wrapper.get('[data-agent-composer]').classes()).toContain('aw-composer-collapsed');
    await wrapper.get('[data-agent-action="expand-composer"]').trigger('click');
    await wrapper.get('[data-agent-input]').setValue('Draft question');
    log.scrollTop = 200;
    await wrapper.get('[data-agent-log]').trigger('scroll');
    expect(wrapper.get('[data-agent-composer]').classes()).not.toContain('aw-composer-collapsed');
    expect((wrapper.get('[data-agent-input]').element as HTMLTextAreaElement).value).toBe('Draft question');
    wrapper.unmount();
  });

  it("renders the streamed response while the shared Agent session is still running", async () => {
    let release: (() => void) | undefined;
    let state: AgentSessionState = {
      status: "idle",
      history: [],
      messages: [],
      steps: [],
      response: "",
      partial: false,
      omittedTargets: [],
      hasMemory: false
    };
    const listeners = new Set<(next: AgentSessionState) => void>();
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
      onChange: vi.fn((listener: (next: AgentSessionState) => void) => {
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
    let state: AgentSessionState = {
      status: "idle",
      history: [],
      messages: [],
      steps: [],
      response: "",
      partial: false,
      omittedTargets: [],
      hasMemory: false
    };
    const listeners = new Set<(next: AgentSessionState) => void>();
    const result: AgentSessionResult = {
      ok: true,
      status: "done" as const,
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
      onChange: vi.fn((listener: (next: AgentSessionState) => void) => {
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

  it("restores the CopilotKit runner view after a navigation remount", async () => {
    const run: AgentRunner = vi.fn(async () => ({
      ok: true as const,
      status: "done" as const,
      response: "Tapo EPC 1.23",
      steps: [{ id: "tool-restore", phase: "tool" as const, status: "done" as const, label: "Tapo" }],
      memoryEvents: []
    }));
    const stateKey = "agent-remount-test";
    const wrapper = mount(AgentPage, { props: { language: "zh", run, stateKey, autoFocus: false } });

    await wrapper.get('[data-agent-input]').setValue("查询 Tapo EPC");
    await wrapper.get('[data-agent-form]').trigger("submit");
    await flushPromises();
    wrapper.unmount();

    const remounted = mount(AgentPage, { props: { language: "zh", run, stateKey, autoFocus: false } });
    await nextTick();

    expect(remounted.find('[data-agent-response]').text()).toContain("Tapo EPC 1.23");
    expect(remounted.find('[data-agent-timeline-step]').attributes("data-step-status")).toBe("done");
    await remounted.get('[data-agent-action="new"]').trigger("click");
    remounted.unmount();
  });

  it("renders bounded tool result views through the local component registry", async () => {
    const run: AgentRunner = vi.fn(async () => ({
      ok: true as const,
      status: "done" as const,
      response: "EPC 已返回。",
      steps: [],
      resultViews: [{
        id: "metric-1",
        toolName: "merchant_analysis",
        kind: "metric" as const,
        status: "done" as const,
        title: "EPC",
        source: "database" as const,
        dataAsOf: "2026-08",
        estimated: false,
        partial: false,
        metrics: [{ label: "EPC", value: "1.23" }],
        columns: [],
        rows: [],
        message: ""
      }]
    }));
    const wrapper = mount(AgentPage, { props: { language: "zh", run, autoFocus: false } });

    await wrapper.get('[data-agent-input]').setValue("查询 EPC");
    await wrapper.get('[data-agent-form]').trigger("submit");
    await flushPromises();

    expect(wrapper.find('[data-result-kind="metric"]').exists()).toBe(true);
    expect(wrapper.find('[data-result-kind="metric"]').text()).toContain("1.23");
    expect(wrapper.find('[data-result-kind="metric"]').html()).not.toContain("<script");
  });

  it("keeps Agent feedback and question-log downloads on the shared session", async () => {
    let state: AgentSessionState = {
      status: "idle",
      history: [],
      messages: [],
      steps: [],
      response: "",
      partial: false,
      omittedTargets: [],
      hasMemory: false
    };
    const listeners = new Set<(next: AgentSessionState) => void>();
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
      onChange: vi.fn((listener: (next: AgentSessionState) => void) => {
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
    let state: AgentSessionState = {
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
      submit: vi.fn((request: { signal: AbortSignal }) => new Promise<AgentSessionResult>((resolve) => {
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
