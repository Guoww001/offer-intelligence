import { describe, expect, it, vi } from "vitest";

import {
  createLegacyAgentSessionBridge,
  createLegacyChatSessionBridge,
  createLegacyDeepWindowsBridge,
  createModernAppApi,
  getLegacyAgentViewSession
} from "./bridge";
import type {
  LegacyAgentViewState,
  LegacyChatViewResult,
  LegacyChatViewState,
  LegacyDeepWindowsViewState
} from "./contracts";

function chatState(overrides: Partial<LegacyChatViewState> = {}): LegacyChatViewState {
  return {
    mode: "report",
    language: "zh",
    hasMemory: false,
    source: "cache",
    status: "idle",
    history: [],
    messages: [],
    memory: [],
    currentResult: null,
    ...overrides
  };
}

function agentState(overrides: Partial<LegacyAgentViewState> = {}): LegacyAgentViewState {
  return {
    status: "idle",
    history: [],
    steps: [],
    response: "",
    partial: false,
    omittedTargets: [],
    hasMemory: false,
    ...overrides
  };
}

describe("Legacy session bridge contracts", () => {
  it("mounts a standalone modern shell and replaces the active page on navigation", () => {
    const events: string[] = [];
    const api = createModernAppApi({
      agent: (element) => {
        element.dataset.page = "agent";
        events.push("agent-mount");
        return { unmount: () => events.push("agent-unmount") };
      },
      dashboard: (element) => {
        element.dataset.page = "dashboard";
        events.push("dashboard-mount");
        return { unmount: () => events.push("dashboard-unmount") };
      }
    }, (element) => {
      element.dataset.shell = "mounted";
      events.push("shell-mount");
      return { unmount: () => events.push("shell-unmount") };
    });
    api.bootstrap({ chatbotData: {}, sheetReportData: {}, productKeywords: {}, language: "zh", llmEnabled: false, agentEnabled: false });
    const root = document.createElement("div");
    expect(api.mountApplication(root, "agent")).toBe(true);
    expect(root.querySelector<HTMLElement>("[data-modern-shell-host]")?.dataset.shell).toBe("mounted");
    expect(root.querySelector<HTMLElement>("[data-modern-page-host]")?.dataset.page).toBe("agent");
    api.setPage("dashboard");
    expect(root.querySelector<HTMLElement>("[data-modern-page-host]")?.dataset.page).toBe("dashboard");
    expect(events).toEqual(["shell-mount", "agent-mount", "agent-unmount", "dashboard-mount"]);
  });

  it("preserves answer-level metadata and utility state in the screen-safe snapshot", () => {
    const bridge = createLegacyChatSessionBridge({
      getState: () => chatState({
        messages: [{
          role: "assistant",
          content: "Tapo report",
          id: "answer-1",
          answerId: "answer-1",
          contentHtml: "<p>Tapo report</p>",
          deepWindowId: "deep-1",
          canOpenDeep: true,
          feedbackState: "available"
        }],
        utility: {
          helpOpen: true,
          guideOpen: false,
          helpHtml: "<p>Help</p>",
          guideHtml: "",
          guideLoading: false,
          onboardingOpen: false,
          onboardingStep: 0,
          onboardingTotal: 3,
          reminderVisible: true,
          reminderCollapsed: false
        }
      } as unknown as Partial<LegacyChatViewState>),
      setMode: vi.fn(),
      submit: vi.fn(),
      removeMemory: vi.fn(),
      clearConversation: vi.fn()
    });

    expect(bridge.getState()).toMatchObject({
      messages: [{
        id: "answer-1",
        answerId: "answer-1",
        contentHtml: "<p>Tapo report</p>",
        deepWindowId: "deep-1",
        canOpenDeep: true,
        feedbackState: "available"
      }],
      utility: {
        helpOpen: true,
        onboardingTotal: 3,
        reminderVisible: true
      }
    });
  });

  it("normalizes Deep Window state and forwards controlled panel actions", () => {
    const state: LegacyDeepWindowsViewState = {
      activeId: "legacy-1",
      windows: [{
        id: "legacy-1",
        mode: "report",
        status: "content",
        title: "Tier 1",
        prompt: "查询 Tier 1",
        summary: "报告摘要",
        contentHtml: "<p>报告内容</p>",
        source: "db",
        minimized: false,
        pinned: false,
        overlay: false,
        position: { x: 12, y: 24 },
        canCancel: false,
        canAddMemory: true,
        addedToMemory: false
      }]
    };
    const actions = {
      activate: vi.fn(),
      minimize: vi.fn(),
      restore: vi.fn(),
      close: vi.fn(),
      pin: vi.fn(() => true),
      move: vi.fn(() => true),
      clone: vi.fn(() => "legacy-2"),
      toggleOverlay: vi.fn(() => true),
      export: vi.fn(() => true),
      cancel: vi.fn(() => true),
      addToChat: vi.fn(() => true),
      interact: vi.fn(() => true),
      setTrendColumns: vi.fn(() => true)
    };
    const bridge = createLegacyDeepWindowsBridge({ getState: () => state, ...actions });
    const listener = vi.fn();
    bridge.onChange(listener);

    expect(bridge.getState()).toMatchObject({ activeId: "legacy-1", windows: [{ source: "db" }] });
    expect(bridge.getState().windows[0]).not.toHaveProperty("planProof");
    expect(bridge.getState().windows[0]).not.toHaveProperty("toolPayload");
    bridge.activate("legacy-1");
    bridge.minimize("legacy-1");
    bridge.move("legacy-1", 20, 30);
    expect(bridge.clone("legacy-1")).toBe("legacy-2");
    expect(bridge.toggleOverlay("legacy-1")).toBe(true);
    expect(bridge.export("legacy-1")).toBe(true);
    expect(bridge.cancel("legacy-1")).toBe(true);
    expect(bridge.addToChat("legacy-1")).toBe(true);
    expect(bridge.interact("legacy-1", "trend-metric", "revenue")).toBe(true);
    expect(bridge.setTrendColumns("legacy-1", ["orders", "revenue"])).toBe(true);
    expect(actions.activate).toHaveBeenCalledWith("legacy-1");
    expect(actions.move).toHaveBeenCalledWith("legacy-1", 20, 30);
    expect(actions.interact).toHaveBeenCalledWith("legacy-1", "trend-metric", "revenue");
    expect(actions.setTrendColumns).toHaveBeenCalledWith("legacy-1", ["orders", "revenue"]);
    expect(listener).toHaveBeenCalled();
  });

  it("validates the exposed chat state, forwards mode and unsubscribes listeners", async () => {
    let state = chatState();
    const signal = new AbortController().signal;
    const submit = vi.fn(async (): Promise<LegacyChatViewResult> => ({
      ok: true,
      status: "success",
      mode: "report",
      source: "db",
      intent: "payment",
      response: "只返回给用户看的内容",
      contentHtml: "<p>只返回给用户看的内容</p>"
    }));
    const setMode = vi.fn((mode: "report" | "chat") => {
      state = { ...state, mode };
    });
    const bridge = createLegacyChatSessionBridge({
      getState: () => state,
      setMode,
      submit,
      removeMemory: vi.fn(),
      clearConversation: vi.fn()
    });
    const listener = vi.fn();
    const unsubscribe = bridge.onChange(listener);

    expect(bridge.getState()).toMatchObject({ mode: "report", language: "zh", source: "cache" });
    bridge.setMode("chat");
    expect(setMode).toHaveBeenCalledWith("chat");
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ mode: "chat" }));

    const result = await bridge.submit("付款状态");
    expect(result).toMatchObject({ ok: true, status: "success", source: "db", intent: "payment" });
    expect(result).not.toHaveProperty("planProof");
    expect(result).not.toHaveProperty("toolPayload");
    expect(result).not.toHaveProperty("trace");
    expect(result).not.toHaveProperty("errorStack");
    expect(submit).toHaveBeenCalledWith("付款状态", expect.any(Object));

    await bridge.submit("可取消查询", { signal });
    expect(submit).toHaveBeenLastCalledWith("可取消查询", expect.objectContaining({ signal }));

    const listenerCallsBeforeUnsubscribe = listener.mock.calls.length;
    unsubscribe();
    bridge.setMode("report");
    expect(listener).toHaveBeenCalledTimes(listenerCallsBeforeUnsubscribe);
    expect(() => bridge.submit("   ")).not.toThrow();
    await expect(bridge.submit("   ")).resolves.toMatchObject({
      ok: false,
      status: "error",
      errorCode: "empty_prompt"
    });
  });

  it("exposes the rendered Legacy context panel for Modern parity", () => {
    const addMemory = vi.fn(() => true);
    const bridge = createLegacyChatSessionBridge({
      getState: () => chatState({
        contextTitle: "上下文概览",
        contextSubtitle: "整体 offer 快照",
        contextHtml: "<div data-legacy-context>5 offers</div>"
      }),
      setMode: vi.fn(),
      submit: vi.fn(),
      removeMemory: vi.fn(),
      clearConversation: vi.fn(),
      addMemory
    });

    expect(bridge.addMemory?.({
      ok: true,
      status: "success",
      mode: "report",
      source: "cache",
      response: "报告"
    })).toBe(true);
    expect(addMemory).toHaveBeenCalledWith(expect.objectContaining({ response: "报告" }));

    expect(bridge.getState()).toMatchObject({
      contextTitle: "上下文概览",
      contextSubtitle: "整体 offer 快照",
      contextHtml: "<div data-legacy-context>5 offers</div>"
    });
  });

  it("does not leak provider payloads or stack traces through an error fallback", async () => {
    const bridge = createLegacyChatSessionBridge({
      getState: () => chatState(),
      setMode: vi.fn(),
      submit: vi.fn(async () => {
        throw new Error("provider secret stack should not cross the bridge");
      }),
      removeMemory: vi.fn(),
      clearConversation: vi.fn()
    });

    await expect(bridge.submit("查询")).resolves.toEqual(expect.objectContaining({
      ok: false,
      status: "error",
      errorCode: "legacy_chat_bridge_error"
    }));
    const serialized = JSON.stringify(await bridge.submit("再次查询"));
    expect(serialized).not.toContain("provider secret");
    expect(serialized).not.toContain("stack");
  });

  it("forwards Agent token/timeline callbacks and preserves session state", async () => {
    let state = agentState();
    const submit = vi.fn(async (_request, callbacks) => {
      callbacks.onToken?.("EPC ");
      callbacks.onTimeline?.({
        id: "tool-1",
        phase: "tool",
        status: "done",
        label: "商户分析",
        dataSource: "database",
        estimated: false
      });
      state = {
        ...state,
        status: "done",
        response: "EPC 1.23",
        steps: [{ id: "tool-1", phase: "tool", status: "done", label: "商户分析" }],
        history: [{ role: "user", content: "查询 EPC" }, { role: "assistant", content: "EPC 1.23" }]
      };
      return {
        ok: true,
        status: "done" as const,
        response: "EPC 1.23",
        steps: state.steps,
        memoryEvents: []
      };
    });
    const bridge = createLegacyAgentSessionBridge({
      getState: () => state,
      submit,
      stop: vi.fn(),
      newConversation: vi.fn(() => { state = agentState(); })
    });
    const tokens: string[] = [];
    const timeline: unknown[] = [];
    const listener = vi.fn();
    const unsubscribe = bridge.onChange(listener);

    const result = await bridge.submit({
      prompt: "查询 EPC",
      language: "zh",
      history: [],
      memoryText: "",
      signal: new AbortController().signal
    }, {
      onToken: (token) => tokens.push(token),
      onTimeline: (step) => timeline.push(step)
    });

    expect(result.status).toBe("done");
    expect(tokens).toEqual(["EPC "]);
    expect(timeline).toHaveLength(1);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ prompt: "查询 EPC" }), expect.any(Object));
    expect(bridge.getState()).toMatchObject({ status: "done", response: "EPC 1.23" });
    expect(bridge.getState().history).toHaveLength(2);
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    bridge.newConversation();
    expect(bridge.getState()).toMatchObject({ status: "idle", response: "" });
  });

  it("adapts the explicit Legacy Agent fallback without changing the Modern session contract", async () => {
    let state = agentState();
    const legacy = createLegacyAgentSessionBridge({
      getState: () => state,
      submit: vi.fn(async (_request, callbacks) => {
        callbacks.onToken?.("legacy answer");
        state = { ...state, status: "done", response: "legacy answer" };
        callbacks.onChange?.(state);
        return { ok: true, status: "done" as const, response: "legacy answer", steps: [] };
      }),
      stop: vi.fn(),
      newConversation: vi.fn()
    });
    const previous = window.OI_LEGACY_BRIDGE;
    window.OI_LEGACY_BRIDGE = {
      navigate: vi.fn(),
      setLanguage: vi.fn(),
      download: vi.fn(() => false),
      ...(previous || {}),
      agentSession: legacy
    };
    try {
      const session = getLegacyAgentViewSession();
      expect(session).not.toBeNull();
      const tokens: string[] = [];
      const result = await session!.submit({
        prompt: "legacy",
        language: "zh",
        history: [],
        memoryText: "",
        signal: new AbortController().signal
      }, { onToken: (token) => tokens.push(token) });
      expect(tokens).toEqual(["legacy answer"]);
      expect(result).toMatchObject({ ok: true, status: "done", response: "legacy answer" });
      expect(session!.getState()).toMatchObject({ status: "done", response: "legacy answer" });
    } finally {
      window.OI_LEGACY_BRIDGE = previous;
    }
  });

  it("keeps Agent result views structured and drops arbitrary markup/payloads", async () => {
    let state = agentState();
    const bridge = createLegacyAgentSessionBridge({
      getState: () => state,
      submit: vi.fn(async (_request, callbacks) => {
        callbacks.onResultView?.({
          id: "metric-1",
          toolName: "merchant_analysis",
          kind: "metric",
          status: "done",
          title: "EPC",
          source: "database",
          dataAsOf: "2026-08",
          estimated: false,
          partial: false,
          metrics: [{ label: "EPC", value: "1.23", delta: "<script>bad</script>" }],
          columns: [],
          rows: [],
          message: "safe",
          html: "<script>must not cross</script>",
          toolPayload: { secret: "must not cross" }
        } as never);
        return { ok: true, status: "done" as const, response: "ok", steps: [] };
      }),
      stop: vi.fn(),
      newConversation: vi.fn()
    });
    const views: unknown[] = [];
    const result = await bridge.submit({ prompt: "查询", language: "zh", history: [], memoryText: "", signal: new AbortController().signal }, {
      onResultView: (view) => views.push(view)
    });

    expect(views[0]).toMatchObject({ id: "metric-1", kind: "metric" });
    expect(JSON.stringify(views[0])).not.toContain("<script>");
    expect(JSON.stringify(views[0])).not.toContain("toolPayload");
    expect(result).not.toHaveProperty("toolPayload");
  });

  it("whitelists Agent memory state and events before exposing them", async () => {
    let state = agentState({
      hasMemory: true,
      memory: {
        version: 1,
        focus: { merchants: [{ id: "398679", name: "Tapo", planProof: "secret" }], categories: ["Smart Home"], tiers: ["Tier 1"] },
        query: { startMonth: "2026-01", endMonth: "2026-02", months: 2, metrics: ["EPC"] },
        lastTool: { toolName: "merchant_analysis", headline: "EPC", trace: "secret" },
        candidates: { pending: [], confirmed: [], rejected: [] },
        planProof: "secret",
        toolPayload: { rows: [{ merchantId: "398679" }] }
      }
    });
    const bridge = createLegacyAgentSessionBridge({
      getState: () => state,
      submit: vi.fn(async () => ({
        ok: true,
        status: "done" as const,
        response: "已完成",
        steps: [],
        memoryEvents: [{
          kind: "tool_success",
          focus: {
            merchants: [{ id: "398679", name: "Tapo", toolPayload: { secret: true } }],
            categories: ["Smart Home"],
            tiers: ["Tier 1"]
          },
          query: { startMonth: "2026-01", endMonth: "2026-02", months: 2, metrics: ["EPC"] },
          lastTool: {
            toolName: "merchant_analysis",
            headline: "EPC",
            dataSource: "database",
            dataAsOf: "2026-02-28",
            estimated: false,
            partial: false,
            trace: "secret"
          },
          resolvedEntities: [{ type: "merchant", id: "398679", name: "Tapo", planProof: "secret" }],
          planProof: "secret",
          toolPayload: { rows: [{ merchantId: "398679" }] },
          trace: { runId: "secret" }
        }]
      })),
      stop: vi.fn(),
      newConversation: vi.fn()
    });

    const exposedState = JSON.stringify(bridge.getState());
    expect(exposedState).not.toContain("planProof");
    expect(exposedState).not.toContain("toolPayload");
    expect(exposedState).not.toContain("trace");

    const result = await bridge.submit({
      prompt: "查询 Tapo",
      language: "zh",
      history: [],
      memoryText: "",
      signal: new AbortController().signal
    });
    expect(result.memoryEvents).toEqual([{
      kind: "tool_success",
      focus: {
        merchants: [{ id: "398679", name: "Tapo" }],
        categories: ["Smart Home"],
        tiers: ["Tier 1"]
      },
      query: { startMonth: "2026-01", endMonth: "2026-02", months: 2, metrics: ["EPC"] },
      lastTool: {
        toolName: "merchant_analysis",
        headline: "EPC",
        dataSource: "database",
        dataAsOf: "2026-02-28",
        estimated: false,
        partial: false
      },
      resolvedEntities: [{ type: "merchant", id: "398679", name: "Tapo" }]
    }]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
