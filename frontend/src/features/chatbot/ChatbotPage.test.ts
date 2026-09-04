import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";

import ChatbotPage from "./ChatbotPage.vue";
import { createChatbotSession } from "./chatbotSession";
import type { ChatbotChatRequest } from "./chatbotViewTypes";
import type { LegacyChatRunCallbacks, LegacyChatViewResult, LegacyChatViewState } from "../../legacy/contracts";

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
    affCommission: 120
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
    affCommission: 50
  }
];

describe("ChatbotPage", () => {
  it("uses the Legacy Report Mode copy and keeps the original control row", () => {
    const wrapper = mount(ChatbotPage, {
      props: { language: "zh", offers, autoFocus: false }
    });

    expect(wrapper.get('[data-chatbot-mode-button="report"]').text()).toContain("报告模式");
    expect(wrapper.get('[data-chatbot-mode-button="chat"]').text()).toContain("聊天模式");
    expect(wrapper.get('[data-chatbot-report-input]').attributes("placeholder")).toBe("询问 EPC、分层、AOV、转化率、未付款 offer...");
    expect(wrapper.get('[data-chatbot-action="report-submit"]').text()).toContain("发送");
    expect(wrapper.get('[data-chatbot-action="download-overview"]').text()).toContain("下载");
    expect(wrapper.get(".report-mode-guide").text()).toContain("先获取数据报告");
    expect(wrapper.get(".report-mode-guide").text()).toContain("具体要求请转至聊天模式");
    expect(wrapper.find('[data-chatbot-action="onboarding"]').exists()).toBe(false);
    expect(wrapper.find('[data-chatbot-action="clear"]').exists()).toBe(false);
  });

  it("reuses the Legacy Chatbot two-panel shell for both modes", async () => {
    const wrapper = mount(ChatbotPage, {
      props: { language: "zh", offers, autoFocus: false }
    });

    expect(wrapper.find('[data-chatbot-mode="report"] .insight-panel').exists()).toBe(true);
    expect(wrapper.find('[data-chatbot-mode="report"] .chat-panel').exists()).toBe(true);
    expect(wrapper.find('[data-chatbot-mode="report"] .context-panel').exists()).toBe(true);
    expect(wrapper.find('[data-chatbot-mode="report"] .chat-mode-toggle').exists()).toBe(true);
    expect(wrapper.find('[data-chatbot-mode="report"] .chat-input input[data-chatbot-report-input]').exists()).toBe(true);

    await wrapper.get('[data-chatbot-mode-button="chat"]').trigger("click");

    expect(wrapper.find('[data-chatbot-mode="chat"] .insight-panel').exists()).toBe(true);
    expect(wrapper.find('[data-chatbot-mode="chat"] .chat-panel').exists()).toBe(true);
    expect(wrapper.find('[data-chatbot-mode="chat"] .chat-log').exists()).toBe(true);
    expect(wrapper.find('[data-chatbot-mode="chat"] .chat-mode-toggle').exists()).toBe(true);
    expect(wrapper.find('[data-chatbot-mode="chat"] .chat-input .chat-input-field input[data-chatbot-input]').exists()).toBe(true);
  });

  it("uses the Legacy session bridge for Report routes and renders its controlled result", async () => {
    let state: LegacyChatViewState = {
      mode: "report",
      language: "zh",
      hasMemory: false,
      source: "cache",
      status: "idle",
      history: [],
      messages: [],
      memory: [],
      currentResult: null
    };
    const listeners = new Set<(next: LegacyChatViewState) => void>();
    const result: LegacyChatViewResult = {
      ok: true,
      status: "success",
      mode: "report",
      source: "db",
      intent: "payment",
      response: "付款状态已从实时数据返回",
      contentHtml: "<p data-legacy-report>付款状态已从实时数据返回</p>",
      recommendationHtml: "<div data-legacy-context>5 offers</div>"
    };
    const downloadOverview = vi.fn(() => true);
    const session = {
      getState: () => state,
      setMode: vi.fn(),
      submit: vi.fn(async () => {
        state = { ...state, source: "db", status: "success", currentResult: result };
        listeners.forEach((listener) => listener(state));
        return result;
      }),
      addMemory: vi.fn(),
      removeMemory: vi.fn(),
      clearConversation: vi.fn(),
      downloadOverview,
      onChange: vi.fn((listener: (next: LegacyChatViewState) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      })
    };
    const wrapper = mount(ChatbotPage, {
      props: { language: "zh", offers, session, autoFocus: false }
    });

    await wrapper.get('[data-chatbot-report-input]').setValue("show payment status");
    await wrapper.get('[data-chatbot-report-form]').trigger("submit");
    await flushPromises();

    expect(session.submit).toHaveBeenCalledWith("show payment status", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(wrapper.find(".chatbot-report-output-head").text()).toContain("DB");
    expect(wrapper.find('[data-chatbot-result-source]').text()).toContain("DB");
    expect(wrapper.find('[data-chatbot-report-summary]').exists()).toBe(true);
    expect(wrapper.find('[data-chatbot-report-summary]').text()).toContain("show payment status");
    expect(wrapper.find('[data-legacy-report]').exists()).toBe(false);
    expect(wrapper.find('[data-chatbot-context-html] [data-legacy-context]').exists()).toBe(true);
    expect(wrapper.find('[data-chatbot-report-log]').text()).not.toContain("付款状态已从实时数据返回");

    state = {
      ...state,
      currentResult: {
        ...result,
        response: '<div class="merchant-card">Shokz Official</div>'
      }
    };
    listeners.forEach((listener) => listener(state));
    await nextTick();
    expect(wrapper.get('[data-chatbot-mode="report"] .message.user').text()).toBe("show payment status");

    await wrapper.get('[data-chatbot-action="download-overview"]').trigger("click");
    expect(downloadOverview).toHaveBeenCalledTimes(1);
  });

  it("keeps feedback, logs, help, guide, onboarding, and clear actions on the shared session", async () => {
    let state: LegacyChatViewState = {
      mode: "report",
      language: "en",
      hasMemory: false,
      source: "cache",
      status: "idle",
      history: [],
      messages: [],
      memory: [],
      currentResult: null
    };
    let feedbackAvailable = false;
    const feedback = {
      isAvailable: vi.fn(() => feedbackAvailable),
      submit: vi.fn(async () => ({ ok: true as const }))
    };
    const listeners = new Set<(next: LegacyChatViewState) => void>();
    const session = {
      getState: () => state,
      setMode: vi.fn(),
      submit: vi.fn(async () => {
        feedbackAvailable = true;
        state = {
          ...state,
          status: "success",
          currentResult: {
            ok: true,
            status: "success",
            mode: "report",
            source: "cache",
            response: "Report ready"
          }
        };
        listeners.forEach((listener) => listener(state));
        return state.currentResult!;
      }),
      addMemory: vi.fn(),
      removeMemory: vi.fn(),
      clearConversation: vi.fn(),
      feedback,
      downloadLogs: vi.fn(() => true),
      toggleHelp: vi.fn(() => true),
      toggleGuide: vi.fn(() => true),
      startOnboarding: vi.fn(() => true),
      onChange: vi.fn((listener: (next: LegacyChatViewState) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      })
    };
    const wrapper = mount(ChatbotPage, { props: { language: "en", offers, session, autoFocus: false } });

    const reportToggle = wrapper.get('[data-chatbot-mode="report"] .chat-mode-toggle');
    expect(reportToggle.get('[data-chatbot-mode-button="chat"]').element.nextElementSibling?.classList.contains("chatbot-utility-panels")).toBe(true);
    expect(reportToggle.find(':scope > [data-chatbot-action="onboarding"]').exists()).toBe(false);

    await wrapper.get('[data-chatbot-report-input]').setValue("show report");
    await wrapper.get('[data-chatbot-report-form]').trigger("submit");
    await flushPromises();
    expect(wrapper.find('[data-feedback-action="open"]').exists()).toBe(true);

    await wrapper.get('[data-feedback-action="open"]').trigger("click");
    await wrapper.get('[data-feedback-reason="unclear"]').setValue(true);
    await wrapper.get('[data-feedback-detail]').setValue("Needs more context");
    await wrapper.get('[data-feedback-form]').trigger("submit");
    await flushPromises();
    expect(feedback.submit).toHaveBeenCalledWith("unclear", "Needs more context");

    await wrapper.get('[data-chatbot-action="help"]').trigger("click");
    await wrapper.get('[data-chatbot-action="guide"]').trigger("click");
    await wrapper.get('[data-chatbot-action="logs"]').trigger("click");
    await wrapper.get('[data-chatbot-log="questions-csv"]').trigger("click");
    await wrapper.get('[data-chatbot-log="feedback-jsonl"]').trigger("click");
    expect(session.toggleHelp).toHaveBeenCalledTimes(1);
    expect(session.toggleGuide).toHaveBeenCalledTimes(1);
    expect(session.downloadLogs).toHaveBeenNthCalledWith(1, "questions", "csv");
    expect(session.downloadLogs).toHaveBeenNthCalledWith(2, "feedback", "jsonl");
    expect(wrapper.find('[data-chatbot-action="onboarding"]').exists()).toBe(true);
    expect(wrapper.find('[data-chatbot-action="clear"]').exists()).toBe(true);
    await wrapper.get('[data-chatbot-action="onboarding"]').trigger("click");
    await wrapper.get('[data-chatbot-action="clear"]').trigger("click");
    expect(session.startOnboarding).toHaveBeenCalledTimes(1);
    expect(session.clearConversation).toHaveBeenCalledTimes(1);
  });

  it("delegates mode switching and memory removal to the shared session", async () => {
    const session = {
      getState: () => ({
        mode: "report" as const,
        language: "en" as const,
        hasMemory: true,
        source: "db" as const,
        status: "idle" as const,
        history: [],
        messages: [],
        memory: [{ id: "m1", title: "Tapo", text: "report", source: "db" as const }],
        currentResult: null
      }),
      setMode: vi.fn(),
      submit: vi.fn(),
      removeMemory: vi.fn(),
      clearConversation: vi.fn(),
      onChange: vi.fn(() => () => undefined)
    };
    const wrapper = mount(ChatbotPage, { props: { language: "en", offers, session, autoFocus: false } });

    await wrapper.get('[data-chatbot-mode-button="chat"]').trigger("click");
    expect(session.setMode).toHaveBeenCalledWith("chat");
    await wrapper.get('[data-chatbot-memory-remove]').trigger("click");
    expect(session.removeMemory).toHaveBeenCalledWith("m1");
  });

  it("starts in Report Mode and switches to Chat Mode without losing the page shell", async () => {
    const wrapper = mount(ChatbotPage, {
      props: { language: "zh", offers, autoFocus: false }
    });

    expect(wrapper.find('[data-page="chatbot"]').exists()).toBe(true);
    expect(wrapper.find('[data-chatbot-mode="report"]').exists()).toBe(true);
    expect(wrapper.find('[data-chatbot-result]').exists()).toBe(false);

    await wrapper.get('[data-chatbot-mode-button="chat"]').trigger("click");
    expect(wrapper.find('[data-chatbot-mode="chat"]').exists()).toBe(true);
    expect(wrapper.find('[data-chatbot-composer]').exists()).toBe(true);
  });

  it("renders a deterministic cached report and exposes a deep window snapshot", async () => {
    const wrapper = mount(ChatbotPage, {
      props: { language: "zh", offers, autoFocus: false }
    });
    const input = wrapper.get('[data-chatbot-report-input]');

    await input.setValue("Tapo ID398679");
    await wrapper.get('[data-chatbot-report-form]').trigger("submit");
    await flushPromises();

    expect(wrapper.find('[data-chatbot-result-status]').attributes("data-status")).toBe("resolved");
    expect(wrapper.text()).toContain("Tapo");
    await wrapper.get('[data-chatbot-action="open-deep"]').trigger("click");
    expect(wrapper.find('[data-deep-window]').exists()).toBe(true);
    expect(wrapper.find('[data-deep-window-content]').text()).toContain("Tapo");
    await wrapper.get('[data-deep-window-action="minimize"]').trigger("click");
    expect(wrapper.find('[data-deep-window]').classes()).toContain("is-minimized");
    await wrapper.get('[data-deep-window-action="close"]').trigger("click");
    expect(wrapper.find('[data-deep-window]').exists()).toBe(false);

    // Closing a report must not leave a stale deepWindowId that makes the
    // next "Open Deep Window" click a no-op.
    await wrapper.get('[data-chatbot-action="open-deep"]').trigger("click");
    expect(wrapper.find('[data-deep-window]').exists()).toBe(true);
  });

  it("reopens a session-owned report window after the user closes it", async () => {
    const session = createChatbotSession({
      offers,
      language: "en",
      llmEnabled: false,
      enableQuestionLogging: false
    });
    const wrapper = mount(ChatbotPage, {
      props: { language: "en", offers, session, deepWindows: session.deepWindows, autoFocus: false }
    });

    await wrapper.get('[data-chatbot-report-input]').setValue("Tapo ID398679");
    await wrapper.get('[data-chatbot-report-form]').trigger("submit");
    await flushPromises();
    await wrapper.get('[data-chatbot-action="open-deep"]').trigger("click");
    expect(wrapper.find('[data-deep-window]').exists()).toBe(true);
    await wrapper.get('[data-deep-window-action="close"]').trigger("click");
    expect(wrapper.find('[data-deep-window]').exists()).toBe(false);

    await wrapper.get('[data-chatbot-action="open-deep"]').trigger("click");
    expect(wrapper.find('[data-deep-window]').exists()).toBe(true);
    session.dispose?.();
  });

  it("keeps the report memory bar structured and removable", async () => {
    const wrapper = mount(ChatbotPage, {
      props: { language: "en", offers, autoFocus: false }
    });
    await wrapper.get('[data-chatbot-report-input]').setValue("Tier 1");
    await wrapper.get('[data-chatbot-report-form]').trigger("submit");
    await flushPromises();
    await wrapper.get('[data-chatbot-action="add-memory"]').trigger("click");

    expect(wrapper.find('[data-chatbot-memory-item]').exists()).toBe(true);
    await wrapper.get('[data-chatbot-memory-remove]').trigger("click");
    expect(wrapper.find('[data-chatbot-memory-item]').exists()).toBe(false);
  });

  it("does not carry a stopped or failed turn into the next request history", async () => {
    const runChat = vi.fn(async (request: ChatbotChatRequest) => request.prompt === "stop this"
      ? { ok: false as const, stopped: true as const, response: "" }
      : { ok: true as const, response: "done" });
    const wrapper = mount(ChatbotPage, {
      props: { language: "en", offers, runChat, autoFocus: false }
    });

    await wrapper.get('[data-chatbot-mode-button="chat"]').trigger("click");
    await wrapper.get('[data-chatbot-input]').setValue("stop this");
    await wrapper.get('[data-chatbot-composer]').trigger("submit");
    await flushPromises();
    expect(wrapper.find('[data-chatbot-chat-log]').text()).not.toContain("stop this");

    await wrapper.get('[data-chatbot-input]').setValue("continue");
    await wrapper.get('[data-chatbot-composer]').trigger("submit");
    await flushPromises();

    expect(runChat).toHaveBeenLastCalledWith(expect.objectContaining({ history: [] }), expect.any(Function));
  });

  it("delegates report download cards to the Legacy exporter", async () => {
    const downloadRecommendation = vi.fn(() => true);
    const result: LegacyChatViewResult = {
      ok: true,
      status: "success",
      mode: "report",
      source: "db",
      intent: "recommendation",
      response: "Recommendations ready",
      contentHtml: '<button type="button" data-download-id="recommendation-1">Download Excel</button>'
    };
    let state: LegacyChatViewState = {
      mode: "report",
      language: "en",
      hasMemory: false,
      source: "cache",
      status: "idle",
      history: [],
      messages: [],
      memory: [],
      currentResult: null
    };
    const listeners = new Set<(next: LegacyChatViewState) => void>();
    const session = {
      getState: () => state,
      setMode: vi.fn(),
      submit: vi.fn(async () => {
        state = { ...state, status: "success", currentResult: result };
        listeners.forEach((listener) => listener(state));
        return result;
      }),
      addMemory: vi.fn(),
      removeMemory: vi.fn(),
      clearConversation: vi.fn(),
      downloadRecommendation,
      onChange: vi.fn((listener: (next: LegacyChatViewState) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      })
    };
    const wrapper = mount(ChatbotPage, { props: { language: "en", offers, session, autoFocus: false } });

    await wrapper.get('[data-chatbot-report-input]').setValue("recommendations");
    await wrapper.get('[data-chatbot-report-form]').trigger("submit");
    await flushPromises();
    await wrapper.get('[data-download-id="recommendation-1"]').trigger("click");

    expect(downloadRecommendation).toHaveBeenCalledWith("recommendation-1");
  });

  it("aborts a Legacy chat request when the page is unmounted", async () => {
    let state: LegacyChatViewState = {
      mode: "chat",
      language: "en",
      hasMemory: false,
      source: "db",
      status: "idle",
      history: [],
      messages: [],
      memory: [],
      currentResult: null
    };
    let release: (() => void) | undefined;
    let requestSignal: AbortSignal | undefined;
    const session = {
      getState: () => state,
      setMode: vi.fn(),
      submit: vi.fn((_prompt: string, callbacks: LegacyChatRunCallbacks) => new Promise<LegacyChatViewResult>((resolve) => {
        requestSignal = callbacks.signal;
        release = () => resolve({
          ok: false,
          status: "stopped",
          mode: "chat",
          source: "db",
          response: "",
          errorCode: "stopped_by_user"
        });
      })),
      removeMemory: vi.fn(),
      clearConversation: vi.fn(),
      onChange: vi.fn(() => () => undefined)
    };
    const wrapper = mount(ChatbotPage, { props: { language: "en", offers, session, autoFocus: false } });

    await wrapper.get('[data-chatbot-mode-button="chat"]').trigger("click");
    await wrapper.get('[data-chatbot-input]').setValue("live query");
    void wrapper.get('[data-chatbot-composer]').trigger("submit");
    await nextTick();

    expect(requestSignal).toBeDefined();
    wrapper.unmount();
    expect(requestSignal?.aborted).toBe(true);
    release?.();
    await flushPromises();
  });

  it("aborts a Legacy report request when the page is unmounted", async () => {
    let requestSignal: AbortSignal | undefined;
    let release: (() => void) | undefined;
    const result: LegacyChatViewResult = {
      ok: false,
      status: "stopped",
      mode: "report",
      source: "db",
      response: "",
      errorCode: "stopped_by_user"
    };
    const state: LegacyChatViewState = {
      mode: "report",
      language: "en",
      hasMemory: false,
      source: "db",
      status: "idle",
      history: [],
      messages: [],
      memory: [],
      currentResult: null
    };
    const session = {
      getState: () => state,
      setMode: vi.fn(),
      submit: vi.fn((_prompt: string, callbacks: LegacyChatRunCallbacks) => new Promise<LegacyChatViewResult>((resolve) => {
        requestSignal = callbacks.signal;
        release = () => resolve(result);
      })),
      addMemory: vi.fn(),
      removeMemory: vi.fn(),
      clearConversation: vi.fn(),
      onChange: vi.fn(() => () => undefined)
    };
    const wrapper = mount(ChatbotPage, { props: { language: "en", offers, session, autoFocus: false } });

    await wrapper.get('[data-chatbot-report-input]').setValue("live report");
    void wrapper.get('[data-chatbot-report-form]').trigger("submit");
    await nextTick();

    expect(requestSignal).toBeDefined();
    wrapper.unmount();
    expect(requestSignal?.aborted).toBe(true);
    release?.();
    await flushPromises();
  });

  it("marks only the current assistant message as streaming", async () => {
    let state: LegacyChatViewState = {
      mode: "chat",
      language: "en",
      hasMemory: false,
      source: "db",
      status: "idle",
      history: [
        { role: "user", content: "previous" },
        { role: "assistant", content: "previous answer" }
      ],
      messages: [
        { role: "user", content: "previous" },
        { role: "assistant", content: "previous answer" }
      ],
      memory: [],
      currentResult: null
    };
    let notify: (next: LegacyChatViewState) => void = () => undefined;
    const session = {
      getState: () => state,
      setMode: vi.fn(),
      submit: vi.fn(),
      removeMemory: vi.fn(),
      clearConversation: vi.fn(),
      onChange: vi.fn((listener: (next: LegacyChatViewState) => void) => {
        notify = listener;
        return () => undefined;
      })
    };
    const wrapper = mount(ChatbotPage, { props: { language: "en", offers, session, autoFocus: false } });

    state = {
      ...state,
      status: "running",
      messages: [...state.messages, { role: "user", content: "current" }, { role: "assistant", content: "partial" }]
    };
    notify(state);
    await nextTick();

    expect(wrapper.findAll('[data-chatbot-chat-log] .chatbot-chat-cursor')).toHaveLength(1);
  });
});
