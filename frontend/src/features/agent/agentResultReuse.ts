import type { AgentResultView } from "../../shared/contracts/agentResult";
export interface ReusableAgentResult {
  originalQuestion: string;
  sourceQuestionEventId: string;
  agentRunId: string;
  planProofs: string[];
  toolResults: Record<string, unknown>[];
  resultViews: AgentResultView[];
  partial?: boolean;
  restoreViews?: boolean;
}
export type AgentReuseDecision = { kind: "query" } | { kind: "unavailable" } | { kind: "reuse"; source: ReusableAgentResult; scope: { targets: string[]; months: string[]; metrics: string[] } };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const metricNames: readonly [string, RegExp][] = [["revenue", /收入|营收|revenue/i], ["orders", /订单|orders/i], ["clicks", /点击|clicks/i], ["conversionRate", /CVR|转化率/i], ["epc", /EPC/i], ["commission", /佣金|commission/i], ["aov", /AOV|客单价/i]];
// 只保存当前会话最近一组成功结果，不写入浏览器存储或日志。
export function createAgentResultReuse(now: () => number = Date.now) {
  let source: ReusableAgentResult | null = null;
  let retainedAt = 0;
  const get = () => source && now() - retainedAt <= 600_000 ? clone(source) : null;
  return {
    get,
    clear() { source = null; retainedAt = 0; },
    retain(next: ReusableAgentResult) {
      const successful = next.toolResults.filter(item => record(item.result).ok === true).slice(0, 6);
      if (!next.agentRunId || !next.originalQuestion || !next.planProofs.length || !successful.length) return;
      source = clone({ ...next, planProofs: next.planProofs.slice(0, 2), toolResults: successful, resultViews: next.resultViews.slice(0, 6) });
      retainedAt = now();
    },
    markStopped() { if (source) source.restoreViews = true; },
    markPresented() { if (source) source.restoreViews = false; },
    decide(prompt: string, explicit = false, knownTargets: readonly string[] = []): AgentReuseDecision {
      const noQuery = /不要(?:重新)?查询|不重新查询|不(?:要)?重查|without (?:requery|querying)|do not (?:requery|query)/i.test(prompt);
      const reference = /刚才|已有|已查|这些|这三家|上面|上述|previous|these|existing/i.test(prompt);
      const presentation = /继续|表格|一张表|对比|解释|为什么|说明|结论|总结|分析|continue|table|compare|explain|why|summari/i.test(prompt);
      if (!explicit && !noQuery && !(reference && presentation)) return { kind: "query" };
      if (/重新查询|重新查|刷新|最新|refresh|requery/i.test(prompt) && !noQuery) return { kind: "query" };
      const current = get();
      if (!current) return { kind: explicit || noQuery ? "unavailable" : "query" };
      const selectedMonths = new Set(prompt.match(/20\d{2}-(?:0[1-9]|1[0-2])/g) || []);
      let invalidRange = false;
      for (const match of prompt.matchAll(/(20\d{2}-(?:0[1-9]|1[0-2]))\s*(?:至|到|-|—|–|~|～|through|to)\s*(20\d{2}-(?:0[1-9]|1[0-2]))/gi)) {
        const ordinal = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) - 1;
        const first = ordinal(match[1]!), last = ordinal(match[2]!);
        if (last < first || last - first >= 24) { invalidRange = true; continue; }
        for (let month = first; month <= last; month++) selectedMonths.add(`${Math.floor(month / 12)}-${String(month % 12 + 1).padStart(2, "0")}`);
      }
      const months = [...selectedMonths].sort();
      const metrics = metricNames.filter(([, pattern]) => pattern.test(prompt)).map(([key]) => key);
      const data = current.toolResults.map(item => record(record(item.result).data));
      const normalized = (value: unknown) => String(value || "").toLowerCase().replace(/[\s_-]+/g, "");
      const sourceNames = current.toolResults.flatMap(item => {
        const args = record(item.arguments), value = record(record(item.result).data), merchant = record(value.merchant);
        return [args.target, args.merchant, value.target, merchant.name, merchant.id].map(normalized).filter(Boolean);
      });
      const requestedTargets = knownTargets.filter(name => normalized(name) && normalized(prompt).includes(normalized(name)));
      const outsideTarget = requestedTargets.some(name => !sourceNames.some(source => source === normalized(name) || source.includes(normalized(name))));
      // 未识别的新英文名称也不能悄悄套用原对象结果。
      const allowedWords = new Set("continue existing previous these table compare comparison explain explanation why summarize summary conclusion data results result use using the a an of for and to with in only no do not query querying requery revenue orders clicks cvr epc aov commission official amazon merchant months month complete common last through original queried incomplete parts without again from".split(" "));
      const unknownName = (prompt.match(/[a-zA-Z][a-zA-Z0-9_-]{2,}/g) || []).some(word => !allowedWords.has(word.toLowerCase()) && !sourceNames.some(source => source.includes(normalized(word))));
      const rows = data.flatMap(item => [item.months, item.monthly].filter(Array.isArray).flat() as unknown[]).map(record);
      const scopeOutside = invalidRange || outsideTarget || unknownName || months.some(month => !rows.some(row => row.month === month))
        || metrics.some(key => rows.length ? !rows.some(row => key in record(row.metrics) || key in row) : !data.some(item => key in record(item.metrics) || key in item))
        || /最近\s*\d+\s*(?:个)?月|近\s*\d+\s*(?:个)?月|去年|今年|最近两个完整月|last\s+\d+\s+months/i.test(prompt)
        || /(?:另外|新增|换成|改查|新商户|instead|another)/i.test(prompt);
      if (scopeOutside) return { kind: explicit || noQuery ? "unavailable" : "query" };
      const targets = [...new Set(requestedTargets.map(name => data.find(value => normalized(value.target) === normalized(name) || normalized(value.target).includes(normalized(name)))?.target).filter((value): value is string => typeof value === "string"))];
      return { kind: "reuse", source: current, scope: { targets, months, metrics } };
    }
  };
}
