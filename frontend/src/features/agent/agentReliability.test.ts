import { describe, expect, it, vi } from "vitest";
import { createAgentSession, type AgentSessionOptions } from "./agentSession";
import { searchAgentKeywords } from "./agentKeywordSearch";

const signal = () => new AbortController().signal;
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
const fixtureOffers = [
  { merchantId: "1001", merchantName: "甲商户", tier: "Tier 1", productTitles: ["vacuum cleaner"], salesAmount: 1000, affCommission: 100, clicks: 100, orders: 6, conversionRate: 0.06, epc: 1 },
  { merchantId: "1002", merchantName: "乙商户", tier: "Tier 2", productTitles: ["vacuum cleaner"], salesAmount: 900, affCommission: 200, clicks: 100, orders: 10, conversionRate: 0.1, epc: 2 }
];
function session(options: Partial<AgentSessionOptions> = {}) {
  return createAgentSession({ offers: fixtureOffers, language: "zh", enableTrace: false, enableQuestionLogging: false, ...options });
}
function monthlySession(rows: readonly Record<string, unknown>[]) {
  return session({ dataAsOf: "2026-10-13T02:00:00Z", fetcher: async () => json({ ok: true, merchantId: "1001", checkedAt: "2026-10-13T02:00:00Z", monthlyAmazonMetrics: rows, monthlyAggregateMetrics: [] }) });
}

describe("Agent 线上可靠性回归", () => {
  it("月度服务超时不能误报为商户缺少历史月份", async () => {
    const agent = session({ fetcher: async () => { throw Object.assign(new Error("受控超时"), { code: "tool_timeout" }); } });
    const result = await agent.executeTool({ callId: "month-timeout", toolName: "trend", arguments: { target: "1001", months: 12 }, prompt: "收入趋势", signal: signal() });
    expect(result.toolResult.result).toMatchObject({ ok: false, errorCode: "tool_timeout", source: { dataSource: "unavailable" } });
    expect(result.resultView?.message).toContain("超时");
    expect(result.resultView?.message).not.toContain("足够的月度");
  });
  it("展示小数位不降低工具原始指标精度", async () => {
    const agent = session({ offers: [
      { merchantId: "1001", merchantName: "高精度甲", salesAmount: 12.34567, conversionRate: 0.072345, epc: 0.123456 },
      { merchantId: "1002", merchantName: "高精度乙", salesAmount: 1, conversionRate: 0.01, epc: 0.1 }
    ] });
    const result = await agent.executeTool({ callId: "precise", toolName: "merchant_comparison", arguments: { merchants: ["1001", "1002"] }, prompt: "比较", signal: signal() });
    expect(result.toolResult.result).toMatchObject({ data: { entities: [{ metrics: { revenue: 12.34567, conversionRate: 0.072345, epc: 0.123456 } }, { metrics: { revenue: 1 } }] } });
    expect(result.resultView?.rows[0]?.values).toEqual(expect.arrayContaining(["12.35", "7.23%", "0.123"]));
  });
  it("商户快照工具保留完整原始比例与金额", async () => {
    const agent = session({ offers: [{ merchantId: "1001", merchantName: "高精度", salesAmount: 12.34567, conversionRate: 0.072345, epc: 0.123456 }], fetcher: async () => json({ ok: true, monthlyAmazonMetrics: [] }) });
    const result = await agent.executeTool({ callId: "snapshot-precise", toolName: "merchant_analysis", arguments: { merchant: "1001" }, prompt: "商户分析", signal: signal() });
    expect(result.toolResult.result).toMatchObject({ data: { metrics: { revenue: 12.34567, conversionRate: 0.072345, epc: 0.123456 } } });
  });
  it.each([
    { target: "MoonVacuumXYZ2026", merchant: "YZ" },
    { target: "ShokzUnknown2026", merchant: "Shokz" }
  ])("明确商户名称 $target 不命中内部短词或拼接名称", async ({ target, merchant }) => {
    const fetcher = vi.fn(async () => json({ ok: true, monthlyAmazonMetrics: [] }));
    const agent = session({ offers: [{ merchantId: "368717", merchantName: merchant }], fetcher });
    const result = await agent.executeTool({ callId: "unknown", toolName: "trend", arguments: { target, months: 12 }, prompt: target, signal: signal() });
    expect(result.toolResult.result).toMatchObject({ ok: false, resolution: { field: "merchant", candidates: [] } });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("规划超过10秒但仍在服务端预算内时不提前终止", async () => {
    vi.useFakeTimers();
    try {
      const agent = session({ fetcher: async (_url, init) => new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(json({ ok: true, agentRunId: "ar_slow_plan_1234", content: "EPC定义", toolCalls: [] })), 12_000);
        init?.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("超时", "AbortError")); }, { once: true });
      }) });
      const pending = agent.submit({ prompt: "EPC是什么", language: "zh", history: [], memoryText: "", signal: signal() });
      await vi.advanceTimersByTimeAsync(12_100);
      expect(await pending).toMatchObject({ ok: true, status: "done", response: "EPC定义" });
    } finally { vi.useRealTimers(); }
  });

  it("规划请求超时标记失败而不是用户停止，并共享最多两轮", async () => {
    vi.useFakeTimers();
    try {
      let plans = 0;
      const agent = session({ fetcher: async (_url, init) => { plans++; return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("超时", "AbortError")), { once: true });
      }); } });
      const pending = agent.submit({ prompt: "Shokz收入趋势", language: "zh", history: [], memoryText: "", signal: signal() });
      await vi.advanceTimersByTimeAsync(100_100);
      expect(await pending).toMatchObject({ ok: false, status: "error", errorCode: "llm_timeout" });
      expect(plans).toBe(2);
      expect(agent.getState().history).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });
  it("倒序月份先按时间排序，再计算趋势方向和变化率", async () => {
    const agent = monthlySession([{ month: "2026-10", revenue: 60 }, { month: "2026-09", revenue: 100 }]);
    const result = await agent.executeTool({ callId: "trend", toolName: "trend", arguments: { target: "1001", metric: "revenue", months: 2 }, prompt: "最近两个月收入趋势", signal: signal() });
    expect(result.toolResult.result).toMatchObject({ ok: true, data: { summary: { first: 100, latest: 60, change: -40, changeRate: -0.4, startMonth: "2026-09", endMonth: "2026-10" }, months: [{ month: "2026-09" }, { month: "2026-10" }] } });
  });

  it("起点为零时不伪造变化率", async () => {
    const agent = monthlySession([{ month: "2026-09", revenue: 0 }, { month: "2026-10", revenue: 60 }]);
    const result = await agent.executeTool({ callId: "trend", toolName: "trend", arguments: { target: "1001", metric: "revenue", months: 2 }, prompt: "收入趋势", signal: signal() });
    expect(result.toolResult.result).toMatchObject({ data: { summary: { changeRate: null } } });
  });

  it("变化率超过100%时提供已格式化百分比，避免模型少乘100", async () => {
    const result = await monthlySession([{ month: "2026-09", revenue: 100 }, { month: "2026-10", revenue: 4300 }]).executeTool({ callId: "trend", toolName: "trend", arguments: { target: "1001", months: 2 }, prompt: "收入趋势", signal: signal() });
    expect(result.toolResult.result).toMatchObject({ data: { summary: { changeRate: 42, changeRateDisplay: "4200.00%" } } });
  });

  it("联盟 EPC 汇总用联盟佣金而不是收入", async () => {
    const agent = monthlySession([]);
    const result = await agent.executeTool({ callId: "merchant", toolName: "merchant_analysis", arguments: { merchant: "1001" }, prompt: "分析商户", signal: signal() });
    expect(result.toolResult.result).toMatchObject({ data: { metrics: { epc: 1 }, comparisons: { global: { epc: 1.5 } } } });
  });

  it("汇总完全缺失的字段不补零", async () => {
    const result = await session({ offers: [{ merchantId: "1001", merchantName: "甲商户", tier: "Tier 1" }] }).executeTool({ callId: "tier", toolName: "tier_analysis", arguments: { tier: "Tier 1" }, prompt: "Tier 1指标", signal: signal() });
    expect(result.toolResult.result).toMatchObject({ data: { aggregates: { clicks: null, orders: null, revenue: null, commission: null, epc: null } } });
  });

  it("真实零 EPC 保留，缺少联盟佣金或点击时标为缺失", async () => {
    const agent = session({ offers: [{ merchantId: "1001", merchantName: "甲商户", salesAmount: 1000, clicks: 100, orders: 10, affCommission: 100, epc: 0 }, { merchantId: "1002", merchantName: "乙商户", salesAmount: 900 }], fetcher: async () => json({ ok: true, monthlyAmazonMetrics: [] }) });
    const result = await agent.executeTool({ callId: "comparison", toolName: "merchant_comparison", arguments: { merchants: ["1001", "1002"] }, prompt: "比较商户", signal: signal() });
    expect(result.toolResult.result).toMatchObject({ data: { entities: [{ metrics: { epc: 0 } }, { metrics: { clicks: null, epc: null, conversionRate: null } }] } });
  });

  it("真实工具结果投影为趋势图，缺失指标不补零", async () => {
    const agent = monthlySession([{ month: "2026-10", revenue: 60, clicks: 20 }, { month: "2026-09", revenue: 100 }]);
    const result = await agent.executeTool({ callId: "trend", toolName: "trend", arguments: { target: "1001", metric: "revenue", months: 2 }, prompt: "画出收入趋势", signal: signal() });
    expect(result.resultView).toMatchObject({ kind: "trend", trend: { metric: "revenue", months: [{ month: "2026-09", revenue: 100, clicks: null }, { month: "2026-10", revenue: 60, clicks: 20 }] } });
  });

  it("商户对比保留收入、联盟 EPC 和 CVR 列", async () => {
    const result = await session().executeTool({ callId: "comparison", toolName: "merchant_comparison", arguments: { merchants: ["1001", "1002"] }, prompt: "比较收入、EPC和CVR", signal: signal() });
    expect(result.resultView?.columns).toEqual(expect.arrayContaining(["销售额", "联盟 EPC", "转化率"]));
    expect(result.resultView?.rows[0]?.values).toEqual(expect.arrayContaining(["1,000.00", "1.000", "6.00%"]));
  });

  it("带月份的 Tier 趋势使用加权比率，缺失输入不补零", async () => {
    const offers = [
      { ...fixtureOffers[0], reportMonth: "2026-08" },
      { ...fixtureOffers[1], tier: "Tier 1", reportMonth: "2026-08" },
      { merchantId: "1003", merchantName: "缺失商户", tier: "Tier 1", reportMonth: "2026-09", salesAmount: 500 }
    ];
    const result = await session({ offers }).executeTool({ callId: "tier-trend", toolName: "trend", arguments: { target: "Tier 1", entityType: "tier", metric: "epc", months: 2 }, prompt: "Tier 1 EPC 趋势", signal: signal() });
    expect(result.toolResult.result).toMatchObject({ data: { months: [{ value: 1.5 }, { value: null }] } });
  });

  it("带月份缓存的总佣金趋势保留真实零和可用值", async () => {
    const offers = [{ ...fixtureOffers[0], month: "2026-08", payout: 0 }, { ...fixtureOffers[1], tier: "Tier 1", month: "2026-09", payout: 30 }];
    const result = await session({ offers }).executeTool({ callId: "payout-trend", toolName: "trend", arguments: { target: "Tier 1", entityType: "tier", metric: "payout", months: 2 }, prompt: "Tier 1总佣金趋势", signal: signal() });
    expect(result.toolResult.result).toMatchObject({ data: { months: [{ value: 0 }, { value: 30 }] } });
  });

  it("综合不可用时仍把缺失指标写为未提供，不泄露汇总技术字段", async () => {
    const agent = session({ offers: [{ merchantId: "1001", merchantName: "甲商户" }], fetcher: async (input) => {
      if (String(input) === "/api/chat/agent") return json({ ok: true, agentRunId: "ar_fallback_1234", planProof: "proof", toolCalls: [{ id: "r1c1", name: "merchant_analysis", arguments: { merchant: "1001" } }] });
      if (String(input).startsWith("/api/ui/db/merchant")) return json({ ok: true, monthlyAmazonMetrics: [] });
      return new Response("", { status: 503 });
    } });
    const result = await agent.submit({ prompt: "查询甲商户 EPC", language: "zh", history: [], memoryText: "", signal: signal() });
    expect(result.response).toContain("未提供");
    expect(result.response).not.toContain("0.000");
    expect(result.response).not.toContain("Merchant:");
  });

  it("未找到目标的结果卡直接说明原因", async () => {
    const result = await session().executeTool({ callId: "missing", toolName: "trend", arguments: { target: "不存在商户" }, prompt: "查询商户趋势", signal: signal() });
    expect(result.resultView?.message).toContain("未找到");
    expect(result.resultView?.message).not.toContain("not_found");
  });

  it("页面传入的新历史进入规划，回退 session 不覆盖它", async () => {
    const bodies: Record<string, unknown>[] = [];
    const agent = session({ fetcher: async (_input, init) => { const body = JSON.parse(String(init?.body)); bodies.push(body); return json({ ok: true, agentRunId: "ar_context_test_1234", content: "概念说明", toolCalls: [] }); } });
    await agent.submit({ prompt: "概念说明", language: "zh", history: [], memoryText: "", signal: signal() });
    const history = [{ role: "user" as const, content: "只要 Tier 1，CVR 至少 5%" }, { role: "assistant" as const, content: "CVR 未提供，不能判断达标" }];
    await agent.submit({ prompt: "核对刚才的条件", language: "zh", history, memoryText: "甲商户 · Tier 1", signal: signal() });
    expect(bodies.at(-1)).toMatchObject({ context: { memory: "甲商户 · Tier 1", history } });
  });

  it("目标未找到不重新规划同一目标", async () => {
    let plans = 0;
    const agent = session({ fetcher: async (input) => {
      if (String(input) === "/api/chat/agent") { plans++; return json({ ok: true, agentRunId: "ar_not_found_1234", planProof: "proof", toolCalls: [{ id: "r1c1", name: "trend", arguments: { target: "不存在的商户", months: 2 } }] }); }
      return new Response('data: {"token":"未找到商户"}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } });
    } });
    await agent.submit({ prompt: "查询不存在的商户趋势", language: "zh", history: [], memoryText: "", signal: signal() });
    expect(plans).toBe(1);
  });

  it("后端已用第二轮纠正时不叠加第三轮规划", async () => {
    let plans = 0;
    const agent = session({ fetcher: async (input) => {
      if (String(input) === "/api/chat/agent") { plans++; return json({ ok: true, round: 2, agentRunId: "ar_round_limit_1234", planProof: "proof", toolCalls: [{ id: "r2c1", name: "asin_analysis", arguments: { asins: ["B000000001"] } }] }); }
      if (String(input).startsWith("/api/ui/db/asin")) return new Response(JSON.stringify({ ok: false }), { status: 500 });
      return new Response('data: {"token":"查询暂不可用"}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } });
    } });
    await agent.submit({ prompt: "查询ASIN表现", language: "zh", history: [], memoryText: "", signal: signal() });
    expect(plans).toBe(1);
  });

  it("无工具数据计划不采信模型数值，并说明真实失败阶段", async () => {
    const agent = session({ fetcher: async () => json({ ok: true, agentRunId: "ar_no_tool_1234", content: "收入是999999", toolCalls: [] }) });
    const result = await agent.submit({ prompt: "查询甲商户收入", language: "zh", history: [], memoryText: "", signal: signal() });
    expect(result.response).not.toContain("999999");
    expect(result.response).toContain("未生成可执行");
    expect(result.response).not.toContain("补充商户");
  });

  it("agent_no_tool_plan 不当作服务故障重试", async () => {
    let plans = 0;
    const agent = session({ fetcher: async () => { plans++; return json({ ok: false, errorCode: "agent_no_tool_plan" }); } });
    const result = await agent.submit({ prompt: "查询甲商户收入", language: "zh", history: [], memoryText: "", signal: signal() });
    expect(plans).toBe(1);
    expect(result.response).toContain("未生成可执行");
    expect(result).toMatchObject({ ok: false, status: "error", errorCode: "agent_no_tool_plan" });
    expect(agent.getState().history).toHaveLength(0);
  });

  it("截断规划返回真实失败且不再次请求或执行数据查询", async () => {
    const urls: string[] = [];
    const agent = session({ fetcher: async input => { urls.push(String(input)); return json({ ok: false, round: 2, errorCode: "agent_plan_truncated" }); } });
    const result = await agent.submit({ prompt: "分析甲商户最近12个月收入、订单、CVR和EPC", language: "zh", history: [], memoryText: "", signal: signal() });
    expect(result).toMatchObject({ ok: false, status: "error", errorCode: "agent_plan_truncated" });
    expect(result.response).toContain("尚未执行");
    expect(result.response).not.toContain("补充商户");
    expect(urls).toEqual(["/api/chat/agent"]);
    expect(agent.getState().history).toHaveLength(0);
  });

  it("请求12个月但只有2个月数据时保留覆盖和四个指标", async () => {
    const agent = monthlySession([{ month: "2026-09", revenue: 100, clicks: 100, orders: 10, affCommission: 20 }, { month: "2026-10", revenue: 0, clicks: 20, orders: 0, affCommission: 0 }]);
    const result = await agent.executeTool({ callId: "trend", toolName: "trend", arguments: { target: "1001", months: 12 }, prompt: "收入、订单、CVR和EPC趋势", signal: signal() });
    expect(result.toolResult.result).toMatchObject({ data: { summary: { requestedMonths: 12, availableMonths: 2, startMonth: "2026-09", endMonth: "2026-10" }, months: [{ metrics: { revenue: 100, orders: 10, conversionRate: 0.1, epc: 0.2 } }, { metrics: { revenue: 0, orders: 0, conversionRate: 0, epc: 0 } }] } });
    expect(result.resultView?.message).toContain("实际有2个月");
  });

  it("解释具体商户近期趋势仍需要数据查询", async () => {
    const agent = session({ fetcher: async () => json({ ok: true, agentRunId: "ar_explain_data_1234", content: "收入增长了999倍", toolCalls: [] }) });
    const result = await agent.submit({ prompt: "解释甲商户最近6个月收入趋势", language: "zh", history: [], memoryText: "", signal: signal() });
    expect(result.response).not.toContain("999倍");
  });

  it("带实体的是什么问法不能当作纯定义采信规划正文", async () => {
    for (const prompt of ["what is Shokz revenue?", "Shokz 的 EPC 是什么"]) {
      const result = await session({ fetcher: async () => json({ ok: true, agentRunId: "ar_definition_1234", content: "收入和EPC都是999999", toolCalls: [] }) }).submit({ prompt, language: "zh", history: [], memoryText: "", signal: signal() });
      expect(result.response).not.toContain("999999");
    }
  });

  it("后端已消耗两轮的失败不在前端再试", async () => {
    let plans = 0;
    const agent = session({ fetcher: async () => { plans++; return json({ ok: false, round: 2, errorCode: "agent_planning_unavailable" }); } });
    await agent.submit({ prompt: "查询甲商户收入", language: "zh", history: [], memoryText: "", signal: signal() });
    expect(plans).toBe(1);
  });

  it("首轮暂时失败后下一次请求明确只剩第二轮", async () => {
    const rounds: unknown[] = [];
    const agent = session({ fetcher: async (_url, init) => {
      const body = JSON.parse(String(init?.body)); rounds.push(body.planningRound);
      return json({ ok: false, round: rounds.length === 1 ? 1 : 2, errorCode: "agent_planning_unavailable" });
    } });
    await agent.submit({ prompt: "查询甲商户收入", language: "zh", history: [], memoryText: "", signal: signal() });
    expect(rounds).toEqual([1, 2]);
  });

  it("六个工具按每批四个执行，结果和签名调用全部保留", async () => {
    let active = 0;
    let maximum = 0;
    let completed = 0;
    const offers = Array.from({ length: 6 }, (_, index) => ({ merchantId: String(1001 + index), merchantName: `商户${index}` }));
    const agent = session({ offers, fetcher: async (input) => {
      if (String(input) === "/api/chat/agent") return json({ ok: true, agentRunId: "ar_batch_1234", planProof: "proof", toolCalls: offers.map((offer, index) => ({ id: `r1c${index + 1}`, name: "merchant_analysis", arguments: { merchant: offer.merchantId } })) });
      if (String(input).startsWith("/api/ui/db/merchant")) {
        active++; maximum = Math.max(maximum, active);
        await new Promise(resolve => setTimeout(resolve, 1));
        active--; completed++;
        return json({ ok: true, monthlyAmazonMetrics: [] });
      }
      return new Response('data: {"token":"六个商户已查询"}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } });
    } });
    const result = await agent.submit({ prompt: "分别查询六个商户", language: "zh", history: [], memoryText: "", signal: signal() });
    expect(maximum).toBeLessThanOrEqual(4);
    expect(completed).toBe(6);
    expect(result.resultViews).toHaveLength(6);
  });
});

describe("Agent 推荐条件回归", () => {
  const keywordOffers = [
    ...fixtureOffers,
    { merchantId: "1003", merchantName: "丙商户", tier: "Tier 1", productTitles: ["vacuum cleaner"], salesAmount: 800, affCommission: 80, clicks: 100, orders: 10, epc: 0.8, conversionRate: 0.1 },
    { merchantId: "1004", merchantName: "缺失商户", tier: "Tier 1", productTitles: ["vacuum cleaner"], salesAmount: 500, epc: 5 }
  ];
  const constraints = { tiers: ["Tier 1"], metricFilters: [{ field: "conversionRate", operator: ">=", value: 0.05 }], metricSort: { field: "epc", direction: "desc" } };

  it("先检查可用性、筛选和排序，再取数量", () => {
    const result = searchAgentKeywords("vacuum cleaner", "recommendation", 1, keywordOffers, {}, "zh", false, [], constraints);
    expect(result.rows.map(row => row.merchantId)).toEqual(["1001"]);
    expect(result).toMatchObject({ eligibleCount: 2, excludedMissingMetricsCount: 1, matchSetComplete: true, appliedFilters: constraints });
    expect(result.note).toContain("Tier 1");
    expect(result.note).toContain("转化率 >= 5%");
    expect(result.note).toContain("联盟 EPC 降序");
  });

  it("指定排序不再按收入或 Tier 隐式优先", () => {
    const result = searchAgentKeywords("vacuum cleaner", "recommendation", 10, fixtureOffers, {}, "zh", false, [], { metricSort: { field: "epc", direction: "desc" } });
    expect(result.rows.map(row => row.merchantId)).toEqual(["1002", "1001"]);
  });

  it("目录命中但 CVR 缺失不能达标，零家不放宽条件", () => {
    const result = searchAgentKeywords("vacuum cleaner", "recommendation", 3, [keywordOffers[3]!], {}, "zh", false, [], constraints);
    expect(result.rows).toEqual([]);
    expect(result).toMatchObject({ eligibleCount: 0, excludedMissingMetricsCount: 1 });
  });

  it("工具执行接收条件，结构化表与签名结果使用同一筛选集合", async () => {
    const result = await session({ offers: keywordOffers, getProductKeywords: () => ({ ok: true, merchants: [] }) }).executeTool({ callId: "keyword", toolName: "keyword_search", arguments: { keyword: "vacuum cleaner", mode: "recommendation", limit: 3, ...constraints }, prompt: "只要Tier 1且CVR至少5%", signal: signal() });
    expect(result.toolResult.result).toMatchObject({ ok: true, data: { rows: [{ merchantId: "1001" }, { merchantId: "1003" }], eligibleCount: 2 } });
    expect(result.resultView?.rows).toHaveLength(2);
    expect(result.resultView?.columns).toContain("转化率");
  });
});
