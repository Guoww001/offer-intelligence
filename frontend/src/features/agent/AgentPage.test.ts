import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AgentPage, { type AgentRunResult, type AgentRunner } from "./AgentPage.vue";
import { normalizeAgentResultView } from "../../shared/contracts/agentResult";
import { createAgentSession, type AgentSessionResult, type AgentSessionState, type AgentViewSession } from "./agentSession";
import { createAgentActivity } from "./agentActivity";
import { clearAgentViewSnapshot } from "./agentViewState";

describe("AgentPage", () => {
  it("只在静态回答折叠全文，按当前问句展开且保留原回答数据", async () => {
    const answer = "结论：表现不同。\n\n共同完整期间：2026-06 至 2026-09。\n\n| 商户 | 收入 |\n| --- | --- |\n| Shokz | 100 |\n\n- 发现一\n- 发现二\n- 发现三\n\n额外完整累计说明。";
    let resolveRun: ((result: AgentRunResult) => void) | undefined;
    const run = vi.fn<AgentRunner>((request) => { request.onToken?.(answer); return new Promise(resolve => { resolveRun = resolve; }); });
    const wrapper = mount(AgentPage, { props: { language: "zh", run, autoFocus: false } });
    await wrapper.get('[data-agent-input]').setValue("详细分析三家"); await wrapper.get('[data-agent-form]').trigger("submit"); await flushPromises();
    expect(wrapper.find('.agent-answer-details').exists()).toBe(false);
    resolveRun?.({ ok: true, status: "done", response: answer, steps: [] }); await flushPromises();
    expect(wrapper.find('.agent-answer-details').exists()).toBe(false);
    await wrapper.get('[data-agent-input]').setValue("同范围只整理为一张对比表"); await wrapper.get('[data-agent-form]').trigger("submit"); await flushPromises();
    expect(wrapper.find('.agent-answer-details').exists()).toBe(false);
    resolveRun?.({ ok: true, status: "done", response: answer, steps: [] }); await flushPromises();
    const second = wrapper.findAll('[data-agent-response]')[1]!;
    expect(second.get('.agent-answer-details').text()).toContain("额外完整累计说明");
    expect(second.findAll(':scope > ul')).toHaveLength(0);
    expect(run.mock.calls[1]?.[0].history.at(-1)?.content).toBe(answer);
    expect(wrapper.findAll('.agent-answer-details')).toHaveLength(1);
    wrapper.unmount();
  });
  it("停止来源在下一轮运行和失败后仍可查看", async () => {
    const source = normalizeAgentResultView({ id: "retained-source", kind: "table", toolName: "merchant_analysis", status: "done", title: "Shokz 数据", columns: ["收入"], rows: [{ label: "九月", values: ["100.00"] }] })!;
    let resolve: (value: Awaited<ReturnType<AgentRunner>>) => void = () => {};
    const run = vi.fn<AgentRunner>().mockResolvedValueOnce({ ok: false, status: "stopped", response: "已停止", steps: [], resultViews: [source] }).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const wrapper = mount(AgentPage, { props: { language: "zh", run, autoFocus: false } });
    await wrapper.get('[data-agent-input]').setValue("查询 Shokz"); await wrapper.get('[data-agent-form]').trigger("submit"); await flushPromises();
    await wrapper.get('[data-agent-input]').setValue("继续"); await wrapper.get('[data-agent-form]').trigger("submit"); await flushPromises();
    expect(wrapper.find('[data-result-id="retained-source"]').exists()).toBe(true);
    resolve({ ok: false, status: "error", response: "综合暂不可用", steps: [] }); await flushPromises();
    expect(wrapper.find('[data-result-id="retained-source"]').exists()).toBe(true);
    await wrapper.get('[data-agent-action="new"]').trigger("click"); expect(wrapper.find('[data-result-id="retained-source"]').exists()).toBe(false);
    wrapper.unmount();
  });
  it("零匹配恢复入口由用户点击预填，不擅自发起放宽查询", async () => {
    const view = normalizeAgentResultView({ id: "zero", kind: "table", toolName: "keyword_search", status: "done", title: "vacuum", message: "Tier 1；转化率 >= 5%；联盟 EPC 降序；应用全部筛选条件后 0 家符合", rows: [] })!;
    const run = vi.fn<AgentRunner>(async () => ({ ok: true, status: "done", response: "无符合条件结果", steps: [], resultViews: [view] }));
    const wrapper = mount(AgentPage, { props: { language: "zh", run, autoFocus: false } });
    await wrapper.get('[data-agent-input]').setValue("Tier 1 vacuum，CVR至少5%，EPC降序"); await wrapper.get('[data-agent-form]').trigger("submit"); await flushPromises();
    expect(run).toHaveBeenCalledOnce();
    await wrapper.get('[data-agent-action="adjust-filters"]').trigger("click");
    expect((wrapper.get('[data-agent-input]').element as HTMLTextAreaElement).value).toContain("CVR至少5%");
    expect(run).toHaveBeenCalledOnce();
    await wrapper.get('[data-agent-action="original-scope"]').trigger("click");
    expect((wrapper.get('[data-agent-input]').element as HTMLTextAreaElement).value).toContain("原匹配范围");
    expect(run).toHaveBeenCalledOnce();
    wrapper.unmount();
  });
  it("明确详细请求展开图表", async () => {
    const view = normalizeAgentResultView({ id: "detail-trend", kind: "trend", toolName: "trend", status: "done", title: "趋势", trend: { target: "Shokz", metric: "revenue", metrics: ["revenue"], months: [{ month: "2026-08", revenue: 1 }, { month: "2026-09", revenue: 2 }] } })!;
    const run = vi.fn<AgentRunner>(async () => ({ ok: true, status: "done", response: "详细说明", steps: [], resultViews: [view] }));
    const wrapper = mount(AgentPage, { props: { language: "zh", run, autoFocus: false } });
    await wrapper.get('[data-agent-input]').setValue("详细分析 Shokz 趋势"); await wrapper.get('[data-agent-form]').trigger("submit"); await flushPromises();
    expect(wrapper.get('[data-agent-trend-toggle]').attributes("aria-expanded")).toBe("true");
    wrapper.unmount();
  });
  it("同源视图不重复，不同期间仍保留，完成后不跟随展开变化", async () => {
    const source = normalizeAgentResultView({ id: "same-call", kind: "table", toolName: "merchant_comparison", status: "done", title: "对比", dataAsOf: "2026-09", columns: [], rows: [] })!;
    const run = vi.fn<AgentRunner>().mockResolvedValueOnce({ ok: true, status: "done", response: "结论一", steps: [], resultViews: [source] }).mockResolvedValueOnce({ ok: true, status: "done", response: "结论二", steps: [], resultViews: [source, { ...source, id: "different-period", dataAsOf: "2026-10" }] });
    const wrapper = mount(AgentPage, { props: { language: "zh", run, autoFocus: false } });
    const log = wrapper.get('[data-agent-log]').element as HTMLElement;
    const scrollTo = vi.fn(); Object.defineProperty(log, "scrollTo", { value: scrollTo });
    Object.defineProperty(log, "scrollHeight", { value: 2000 });
    for (const prompt of ["第一轮", "第二轮"]) { await wrapper.get('[data-agent-input]').setValue(prompt); await wrapper.get('[data-agent-form]').trigger("submit"); await flushPromises(); }
    expect(wrapper.findAll('[data-result-id]')).toHaveLength(2);
    if (!wrapper.find('[data-agent-details]').exists()) await wrapper.get('[data-agent-action="details"]').trigger("click");
    expect(wrapper.findAll('.aw-result-index button')).toHaveLength(2);
    expect(scrollTo.mock.calls.at(-1)?.[0].top).not.toBe(2000);
    scrollTo.mockClear();
    await wrapper.get('[data-agent-action="details"]').trigger("click"); await flushPromises();
    expect(scrollTo).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it("停止后继续明确复用原结果并在新对话清除", async () => {
    const run = vi.fn<AgentRunner>(async () => ({ ok: false, status: "stopped", response: "已停止", steps: [{ id: "synthesis", phase: "synthesis", status: "running", label: "整理" }] }));
    const clearReusableResults = vi.fn();
    const wrapper = mount(AgentPage, { props: { language: "zh", run, autoFocus: false, canContinue: () => true, clearReusableResults } });
    await wrapper.get('[data-agent-input]').setValue("查询 Shokz");
    await wrapper.get('[data-agent-form]').trigger("submit");
    await flushPromises();
    expect(wrapper.find('[data-agent-action="continue"]').exists()).toBe(true);
    expect(wrapper.find('[data-step-status="running"]').exists()).toBe(false);
    await wrapper.get('[data-agent-action="continue"]').trigger("click");
    await flushPromises();
    expect(run.mock.calls.at(-1)?.[0]).toMatchObject({ reuseResult: true });
    await wrapper.get('[data-agent-action="new"]').trigger("click");
    expect(clearReusableResults).toHaveBeenCalledOnce();
    wrapper.unmount();
  });
  beforeEach(() => clearAgentViewSnapshot("modern-agent"));

  it("主动停止使用停止反馈文案，不显示运行失败", async () => {
    const previousRuntime = window.OI_MODERN_RUNTIME;
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body || "{}"));
      return new Response(JSON.stringify(payload.action === "create" ? { recordId: "stopped-record" } : { ok: true }));
    };
    window.OI_MODERN_RUNTIME = { createAgentActivity: () => createAgentActivity({ fetcher }) } as never;
    const run: AgentRunner = async () => ({ ok: false, status: "stopped", response: "", steps: [] });
    const wrapper = mount(AgentPage, { props: { language: "zh", run, autoFocus: false } });
    try {
      await wrapper.get('[data-agent-input]').setValue("查询商户");
      await wrapper.get('[data-agent-form]').trigger("submit");
      await flushPromises();
      expect(wrapper.get('.aw-notice [data-feedback-action="open"]').text()).toContain("停止");
      expect(wrapper.get('.aw-notice [data-feedback-action="open"]').text()).not.toContain("失败");
    } finally { wrapper.unmount(); window.OI_MODERN_RUNTIME = previousRuntime; }
  });

  it.each(["error", "throw", "tool-error", "tool-timeout"])("%s 场景主动显示提醒气泡并提交本轮反馈", async (scenario) => {
    const previousRuntime = window.OI_MODERN_RUNTIME;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body || "{}"));
      return new Response(JSON.stringify(payload.action === "create" ? { recordId: "failed-record" } : { ok: true }), { status: 200 });
    });
    window.OI_MODERN_RUNTIME = { createAgentActivity: () => createAgentActivity({ fetcher }) } as never;
    const run = vi.fn<AgentRunner>(async () => {
      if (scenario === "throw") throw new Error("查询服务不可用");
      const recovered = scenario.startsWith("tool-");
      return {
        ok: recovered, status: recovered ? "done" : "error", response: recovered ? "部分查询结果" : "",
        steps: [{ id: "tool-data", phase: "tool", status: scenario === "tool-timeout" ? "timeout" : "error", label: "数据查询" }]
      };
    });
    const wrapper = mount(AgentPage, { props: { language: "zh", run, autoFocus: false } });
    try {
      await wrapper.get('[data-agent-input]').setValue("查询商户数据");
      await wrapper.get('[data-agent-form]').trigger("submit");
      await flushPromises();
      const prompt = wrapper.get('[data-feedback-prompt]');
      expect(prompt.text()).toContain("点击下方按钮反馈");
      expect(prompt.attributes("role")).toBe("status");
      const trigger = wrapper.get('[data-feedback-action="open"]');
      expect(trigger.attributes("aria-describedby")).toBe(prompt.attributes("id"));
      await trigger.trigger("click");
      expect(wrapper.find('[data-feedback-prompt]').exists()).toBe(false);
      const dialog = new DOMWrapper(document.querySelector('[data-answer-feedback-dialog]')!);
      await dialog.get('[data-feedback-reason="not_answered"]').setValue(true);
      await dialog.get('[data-feedback-form]').trigger("submit");
      await flushPromises();
      const feedbackCall = fetcher.mock.calls.find(([url]) => String(url).includes("operation=feedback"));
      expect(JSON.parse(String(feedbackCall?.[1]?.body))).toMatchObject({
        questionEventId: "failed-record", prompt: "查询商户数据", answer: scenario.startsWith("tool-") ? "部分查询结果" : "", reasonCode: "not_answered", mode: "agent"
      });
      expect(trigger.text()).toBe("已反馈");
      expect(trigger.attributes("disabled")).toBeDefined();
      await wrapper.get('[data-agent-action="new"]').trigger("click");
      expect(wrapper.find('[data-feedback-action="open"]').exists()).toBe(false);
    } finally {
      wrapper.unmount();
      window.OI_MODERN_RUNTIME = previousRuntime;
    }
  });

  it("受控 session 运行失败后也展示可提交的反馈入口", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      const logging = String(input).includes("operation=");
      return new Response(JSON.stringify(logging ? body.action === "create" ? { recordId: "session-failed-record" } : { ok: true } : { ok: false, errorCode: "agent_planning_unavailable" }), { status: logging ? 200 : 503 });
    });
    const session = createAgentSession({ offers: [], language: "zh", fetcher, enableTrace: false });
    const wrapper = mount(AgentPage, { props: { language: "zh", run: vi.fn(), session, autoFocus: false } });
    try {
      await wrapper.get('[data-agent-input]').setValue("你好");
      await wrapper.get('[data-agent-form]').trigger("submit");
      await flushPromises();
      expect(wrapper.get('[data-feedback-prompt]').text()).toContain("点击下方按钮反馈");
      await wrapper.get('.aw-notice [data-feedback-action="open"]').trigger("click");
      const dialog = new DOMWrapper(document.querySelector('[data-answer-feedback-dialog]')!);
      await dialog.get('[data-feedback-reason="not_answered"]').setValue(true);
      await dialog.get('[data-feedback-form]').trigger("submit");
      await flushPromises();
      const feedbackCall = fetcher.mock.calls.find(([url]) => String(url).includes("operation=feedback"));
      expect(JSON.parse(String(feedbackCall?.[1]?.body))).toMatchObject({ questionEventId: "session-failed-record", answer: "", mode: "agent" });
      expect(wrapper.get('.aw-notice [data-feedback-action="open"]').text()).toBe("已反馈");
    } finally { wrapper.unmount(); session.dispose?.(); }
  });

  it("追问只携带上一轮结果的 ASIN，新对话清空引用", async () => {
    const asins = ["B0D2HKCMBP", "B0GQ3MD31D", "B0CS3JBP67", "B0D2HHDKTD", "B09BVXT8TJ"];
    const view = normalizeAgentResultView({ id: "top", toolName: "merchant_analysis", kind: "table", status: "done", title: "Top ASIN",
      columns: ["商家 ID", "商家", "ASIN"], rows: asins.map((asin, i) => ({ label: String(i + 1), values: ["362653", "Shokz", asin] })) })!;
    const run = vi.fn<AgentRunner>().mockResolvedValue({ ok: true, status: "done", response: "商品详情", steps: [] })
      .mockResolvedValueOnce({ ok: true, status: "done", response: "Top ASIN 见表格", steps: [], resultViews: [view] });
    const wrapper = mount(AgentPage, { props: { language: "zh", run, autoFocus: false } });
    for (const prompt of ["Shokz top ASIN", "给我这5个ASIN的信息"]) {
      await wrapper.get('[data-agent-input]').setValue(prompt);
      await wrapper.get('[data-agent-form]').trigger("submit");
      await flushPromises();
    }
    expect(run.mock.calls[1]![0].asinContext).toEqual(asins);
    await wrapper.get('[data-agent-action="new"]').trigger("click");
    await wrapper.get('[data-agent-input]').setValue("这5个ASIN的信息");
    await wrapper.get('[data-agent-form]').trigger("submit");
    await flushPromises();
    expect(run.mock.calls[2]![0].asinContext).toEqual([]);
    wrapper.unmount();
  });

  it("受控 session 路径也把上一轮 ASIN 引用传给查询", async () => {
    const asins = ["B0D2HKCMBP", "B09BVXT8TJ"];
    const view = normalizeAgentResultView({ id: "top-session", toolName: "merchant_analysis", kind: "table", status: "done", title: "Top ASIN",
      columns: ["Merchant ID", "Merchant", "ASIN"], rows: asins.map((asin, i) => ({ label: String(i + 1), values: ["362653", "Shokz", asin] })) })!;
    const session = {
      getState: () => ({ status: "done", history: [{ role: "user", content: "Shokz top ASIN" }, { role: "assistant", content: "Top ASIN" }],
        steps: [], response: "Top ASIN", partial: false, omittedTargets: [], resultViews: [view], hasMemory: false }),
      submit: vi.fn(async () => ({ ok: true, status: "done" as const, response: "详情", steps: [] })),
      stop: vi.fn(), newConversation: vi.fn(), onChange: vi.fn(() => () => {})
    } as unknown as AgentViewSession;
    const wrapper = mount(AgentPage, { props: { language: "en", run: vi.fn(), session, autoFocus: false } });
    await wrapper.get('[data-agent-input]').setValue("Give me these ASIN details");
    await wrapper.get('[data-agent-form]').trigger("submit");
    await flushPromises();
    expect(session.submit).toHaveBeenCalledWith(expect.objectContaining({ asinContext: asins }), expect.anything());
    wrapper.unmount();
  });

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

  it("shows the new promotion tracking example with a new badge", async () => {
    const wrapper = mount(AgentPage, {
      props: { language: "zh", run: vi.fn(), autoFocus: false }
    });

    const promotionSuggestion = wrapper.get('[data-agent-example="promotion-tracking"]');
    expect(promotionSuggestion.text()).toContain("推广追踪");
    expect(promotionSuggestion.get('[data-agent-badge="new"]').text()).toBe("new");

    await promotionSuggestion.trigger("click");
    expect((wrapper.get('[data-agent-input]').element as HTMLTextAreaElement).value).toBe("/promotion 按商家统计媒体数量");
    wrapper.unmount();
  });

  it("点击 ASIN 示例卡片时预填对应斜杠命令和示例参数", async () => {
    const wrapper = mount(AgentPage, {
      props: { language: "en", run: vi.fn(), autoFocus: false }
    });

    await wrapper.get('[data-agent-example="asin"]').trigger("click");
    expect((wrapper.get('[data-agent-input]').element as HTMLTextAreaElement).value).toBe("/asin B0D2HKCMBP");
    wrapper.unmount();
  });

  it("separates suggestion metadata from copy in the bento card layout", () => {
    const wrapper = mount(AgentPage, {
      props: { language: "en", run: vi.fn(), autoFocus: false }
    });

    const cards = wrapper.findAll(".aw-suggestion");
    expect(cards).toHaveLength(6);
    cards.forEach((card) => {
      expect(card.find(".aw-suggestion-meta").exists()).toBe(true);
      expect(card.find(".aw-suggestion-meta .aw-suggestion-number").exists()).toBe(true);
      expect(card.find(".aw-suggestion-meta .aw-suggestion-arrow").exists()).toBe(true);
      expect(card.find(".aw-suggestion-copy").exists()).toBe(true);
    });
    wrapper.unmount();
  });

  it("filters all slash commands, keeps IME Enter safe, and runs the selected command", async () => {
    const run = vi.fn<AgentRunner>().mockResolvedValue({ ok: true, status: "done", response: "Answer", steps: [] });
    const wrapper = mount(AgentPage, { props: { language: "en", run, autoFocus: false } });
    const field = wrapper.get('[data-agent-input]');
    await field.setValue('/');
    expect(wrapper.findAll('[role="option"]')).toHaveLength(12);
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
    await field.setValue('/asin B0D2HKCMBP');
    await field.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: 'Look up ASIN B0D2HKCMBP' }));
    wrapper.unmount();
  });

  it("要求 /promotion 先上传推广清单", async () => {
    const run = vi.fn<AgentRunner>().mockResolvedValue({ ok: true, status: "done", response: "不应执行", steps: [] });
    const wrapper = mount(AgentPage, { props: { language: "zh", run, autoFocus: false } });
    await wrapper.get('[data-agent-input]').setValue("/promotion 按商家统计媒体数量");
    await wrapper.get('[data-agent-form]').trigger("submit");
    await flushPromises();
    expect(run).not.toHaveBeenCalled();
    expect(wrapper.get('[role="alert"]').text()).toContain("上传推广清单");
    wrapper.unmount();
  });

  it("在用户提问气泡中突出显示斜杠命令并保留参数", async () => {
    const run = vi.fn<AgentRunner>().mockResolvedValue({ ok: true, status: "done", response: "Answer", steps: [] });
    const wrapper = mount(AgentPage, { props: { language: "en", run, autoFocus: false } });
    await wrapper.get('[data-agent-input]').setValue("/merchant Tapo");
    await wrapper.get('[data-agent-form]').trigger("submit");
    await flushPromises();

    const prompt = wrapper.get('[data-agent-user-prompt]');
    expect(prompt.get('[data-agent-command]').text()).toBe("/merchant");
    expect(prompt.get('[data-agent-command-value]').text()).toBe("Tapo");
    expect(prompt.text()).toContain("Merchant");
    expect(run.mock.calls[0]![0].prompt).toBe("Analyze merchant Tapo");
    wrapper.unmount();
  });

  it("在输入框中实时突出显示斜杠命令", async () => {
    const run = vi.fn<AgentRunner>().mockResolvedValue({ ok: true, status: "done", response: "Answer", steps: [] });
    const wrapper = mount(AgentPage, { props: { language: "en", run, autoFocus: false } });
    const field = wrapper.get('[data-agent-input]');
    await field.setValue("/merchant shokz");
    await nextTick();

    expect(wrapper.get('[data-agent-composer-command]').text()).toBe("/merchant");
    expect(wrapper.get('[data-agent-composer-command-value]').text()).toBe("shokz");
    expect(field.attributes("spellcheck")).toBe("false");
    expect(run).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("中文输入法组合态保持真实输入文字可见并保留命令背景", async () => {
    const wrapper = mount(AgentPage, { props: { language: "zh", run: vi.fn(), autoFocus: false } });
    const field = wrapper.get('[data-agent-input]');
    await field.setValue("/asin ");

    await field.trigger("compositionstart");
    await nextTick();

    expect(field.classes()).not.toContain("aw-composer-textarea-command");
    expect(wrapper.get('[data-agent-composer-command]').text()).toBe("/asin");
    expect(field.attributes("spellcheck")).toBe("false");
    wrapper.unmount();
  });

  it("按 Backspace 时以整体删除提问框中的斜杠命令", async () => {
    const wrapper = mount(AgentPage, { props: { language: "en", run: vi.fn(), autoFocus: false } });
    const field = wrapper.get('[data-agent-input]');
    const element = field.element as HTMLTextAreaElement;
    await field.setValue("/merchant");
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);

    await field.trigger("keydown", { key: "Backspace" });
    await nextTick();

    expect(element.value).toBe("");
    expect(element.selectionStart).toBe(0);
    expect(element.selectionEnd).toBe(0);
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

  it("keeps the composer visible while a response is generating", async () => {
    let release: (() => void) | undefined;
    const run: AgentRunner = vi.fn(() => new Promise<AgentRunResult>((resolve) => {
      release = () => resolve({ ok: true, status: "done", response: "Answer", steps: [] });
    }));
    const wrapper = mount(AgentPage, { props: { language: "en", run, autoFocus: false } });

    await wrapper.get('[data-agent-input]').setValue("Show Tapo");
    void wrapper.get('[data-agent-form]').trigger("submit");
    await nextTick();

    const log = wrapper.get('[data-agent-log]').element;
    Object.defineProperties(log, {
      scrollHeight: { value: 2000, configurable: true },
      clientHeight: { value: 500, configurable: true },
      scrollTop: { value: 120, writable: true, configurable: true }
    });
    await wrapper.get('[data-agent-log]').trigger("scroll");

    expect(wrapper.get('[data-agent-composer]').classes()).not.toContain('aw-composer-collapsed');

    release?.();
    await flushPromises();
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

  it("preserves a session timeline when the completed state omits its steps", async () => {
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
      submit: vi.fn(async (_request: unknown, callbacks: { onTimeline?: (step: unknown) => void }) => {
        state = { ...state, status: "running", messages: [{ role: "user", content: "查询 EPC" }, { role: "assistant", content: "" }] };
        listeners.forEach((listener) => listener(state));
        callbacks.onTimeline?.({ id: "tool-session", phase: "tool", status: "done", label: "商户分析", elapsedMs: 180 });
        state = {
          ...state,
          status: "done",
          response: "EPC 1.23",
          steps: [],
          history: [{ role: "user", content: "查询 EPC" }, { role: "assistant", content: "EPC 1.23" }],
          messages: [{ role: "user", content: "查询 EPC" }, { role: "assistant", content: "EPC 1.23" }]
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
    await wrapper.get('[data-agent-form]').trigger("submit");
    await flushPromises();

    expect(wrapper.findAll('[data-agent-timeline-step]')).toHaveLength(1);
    expect(wrapper.find('[data-agent-timeline-step]').attributes("data-step-status")).toBe("done");
    wrapper.unmount();
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

  it("preserves streamed timeline steps when the completed result omits them", async () => {
    const run: AgentRunner = vi.fn(async (request) => {
      request.onTimeline?.({ id: "tool-streamed", phase: "tool", status: "running", label: "商户分析" });
      request.onTimeline?.({ id: "tool-streamed", phase: "tool", status: "done", label: "商户分析", elapsedMs: 120 });
      return { ok: true as const, status: "done" as const, response: "完成", steps: [] };
    });
    const wrapper = mount(AgentPage, { props: { language: "zh", run, autoFocus: false } });

    await wrapper.get('[data-agent-input]').setValue("查询商户");
    await wrapper.get('[data-agent-form]').trigger("submit");
    await flushPromises();

    expect(wrapper.findAll('[data-agent-timeline-step]')).toHaveLength(1);
    expect(wrapper.find('[data-agent-timeline-step]').attributes("data-step-status")).toBe("done");
    wrapper.unmount();
  });

  it("shows the completed execution duration in 0.1 second increments", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const run: AgentRunner = vi.fn(async () => {
        vi.advanceTimersByTime(1234);
        return { ok: true as const, status: "done" as const, response: "完成", steps: [] };
      });
      const wrapper = mount(AgentPage, { props: { language: "zh", run, autoFocus: false } });

      await wrapper.get('[data-agent-input]').setValue("查询商户");
      await wrapper.get('[data-agent-form]').trigger("submit");
      await flushPromises();

      expect(wrapper.get('[data-agent-duration]').text()).toBe("耗时 1.2s");
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("updates a running step duration every 0.1 second and freezes it after completion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let release: (() => void) | undefined;
    try {
      const run: AgentRunner = vi.fn((request) => {
        request.onTimeline?.({ id: "tool-live", phase: "tool", status: "running", label: "商户分析" });
        return new Promise<AgentRunResult>((resolve) => {
          release = () => resolve({ ok: true, status: "done", response: "完成", steps: [] });
        });
      });
      const wrapper = mount(AgentPage, { props: { language: "zh", run, autoFocus: false } });

      await wrapper.get('[data-agent-input]').setValue("查询商户");
      await wrapper.get('[data-agent-form]').trigger("submit");
      await nextTick();

      vi.advanceTimersByTime(800);
      await nextTick();
      expect(wrapper.get('[data-agent-timeline-step-duration]').text()).toBe("0.8s");

      release?.();
      await flushPromises();
      expect(wrapper.get('[data-agent-timeline-step-duration]').text()).toBe("0.8s");

      vi.advanceTimersByTime(5000);
      await nextTick();
      expect(wrapper.get('[data-agent-timeline-step-duration]').text()).toBe("0.8s");
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
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
    const dialog = new DOMWrapper(document.querySelector('[data-answer-feedback-dialog]')!);
    await dialog.get('[data-feedback-reason="inaccurate"]').setValue(true);
    await dialog.get('[data-feedback-form]').trigger("submit");
    await flushPromises();
    await wrapper.get('[data-agent-log="questions-csv"]').trigger("click");

    expect(feedback.submit).toHaveBeenCalledWith("inaccurate", "");
    expect(session.downloadLogs).toHaveBeenCalledWith("questions", "csv");
  });

  it("shows a separate dislike action under each completed Copilot Agent answer", async () => {
    const previousRuntime = window.OI_MODERN_RUNTIME;
    const submitFirst = vi.fn(async () => ({ ok: true as const }));
    const submitSecond = vi.fn(async () => ({ ok: true as const }));
    let count = 0;
    window.OI_MODERN_RUNTIME = {
      createAgentActivity: () => ({
        begin: () => `answer-${++count}`,
        finish: () => undefined,
        clear: () => undefined,
        feedbackForAnswer: (id: string) => id === "answer-1"
          ? { isAvailable: () => true, submit: submitFirst }
          : { isAvailable: () => true, submit: submitSecond }
      })
    } as never;
    try {
      const run = vi.fn<AgentRunner>()
        .mockResolvedValueOnce({ ok: true, status: "done", response: "First answer", steps: [] })
        .mockResolvedValueOnce({ ok: true, status: "done", response: "Second answer", steps: [] });
      const wrapper = mount(AgentPage, { props: { language: "zh", run, autoFocus: false } });
      for (const prompt of ["第一问", "第二问"]) {
        await wrapper.get('[data-agent-input]').setValue(prompt);
        await wrapper.get('[data-agent-form]').trigger("submit");
        await flushPromises();
      }
      const answers = wrapper.findAll(".aw-message-assistant");
      expect(answers).toHaveLength(2);
      expect(wrapper.find('[data-feedback-prompt]').exists()).toBe(false);
      expect(answers.map((answer) => answer.get('[data-chatbot-action="feedback"]').text()))
        .toEqual(["👎不满意该回复", "👎不满意该回复"]);
      await answers[0]!.get('[data-chatbot-action="feedback"]').trigger("click");
      const dialog = new DOMWrapper(document.querySelector('[data-answer-feedback-dialog]')!);
      await dialog.get('[data-feedback-reason="unclear"]').setValue(true);
      await dialog.get('[data-feedback-form]').trigger("submit");
      await flushPromises();
      expect(submitFirst).toHaveBeenCalledWith("unclear", "");
      expect(submitSecond).not.toHaveBeenCalled();
      wrapper.unmount();
    } finally {
      window.OI_MODERN_RUNTIME = previousRuntime;
    }
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
