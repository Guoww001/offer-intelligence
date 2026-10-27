export interface AgentMonthRange {
  startMonth: string;
  endMonth: string;
}

interface MonthlyRow {
  month: unknown;
  metrics: Readonly<Record<string, unknown>>;
}

function monthIndex(value: unknown): number | null {
  if (typeof value !== "string" || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(value)) return null;
  return Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function deriveAgentMonthlyMetrics<T extends MonthlyRow>(rows: readonly T[]): (T & {
  metrics: T["metrics"] & { revenueMoM: number | null; clicksMoM: number | null; ordersDelta: number | null };
})[] {
  const byMonth = new Map<number, T>();
  rows.forEach(row => { const index = monthIndex(row.month); if (index !== null) byMonth.set(index, row); });
  return rows.map(row => {
    const index = monthIndex(row.month);
    const previous = index === null ? undefined : byMonth.get(index - 1);
    const change = (key: string, ratio: boolean): number | null => {
      const current = finite(row.metrics[key]);
      const baseline = finite(previous?.metrics[key]);
      if (current === null || baseline === null || (ratio && baseline === 0)) return null;
      return ratio ? (current - baseline) / baseline : current - baseline;
    };
    return { ...row, metrics: { ...row.metrics, revenueMoM: change("revenue", true), clicksMoM: change("clicks", true), ordersDelta: change("orders", false) } };
  });
}

function validRange(startMonth: string, endMonth: string): AgentMonthRange | null {
  const start = monthIndex(startMonth);
  const end = monthIndex(endMonth);
  return start !== null && end !== null && end >= start && end - start < 24 ? { startMonth, endMonth } : null;
}

function explicitRange(prompt: string, referenceMonth?: string): AgentMonthRange | null {
  const explicitYear = prompt.match(/\b(20\d{2})\s*年/)?.[1];
  let year = explicitYear || (monthIndex(referenceMonth) !== null ? referenceMonth?.slice(0, 4) : undefined);
  const months: string[] = [];
  const tokens = [...prompt.matchAll(/(20\d{2})\s*[-/]\s*(\d{1,2})(?!\d)|(20\d{2})\s*年|(?<!\d)(\d{1,2})\s*月|(?<!\d)(\d{1,2})\s*[-~～–—至到]\s*(\d{1,2})\s*月/g)];
  for (const token of tokens) {
    if (token[1]) {
      year = token[1];
      months.push(`${year}-${token[2]!.padStart(2, "0")}`);
    } else if (token[3]) {
      year = token[3];
    } else if (year && token[4]) {
      months.push(`${year}-${token[4].padStart(2, "0")}`);
    } else if (year && token[5] && token[6]) {
      months.push(`${year}-${token[5].padStart(2, "0")}`, `${year}-${token[6].padStart(2, "0")}`);
    }
  }
  return months.length ? validRange(months[0]!, months.at(-1)!) : null;
}

export function parseAgentMonthRange(prompt: string, history: readonly string[] = [], referenceMonth?: string): AgentMonthRange | null {
  const range = explicitRange(prompt, referenceMonth);
  if (range) return range;
  if (/20\d{2}\s*(?:年|[-/])|\d+\s*月/.test(prompt)) return null;
  // 相对月份仍由原有 months 参数处理；只有明确的时间指代才承接历史区间。
  const refersToHistory = /同期|同一(?:时间|期间|区间)|上述(?:时间|月份|期间|维度)|这些月份|same\s+(?:period|months?)/i.test(prompt);
  const metricFollowup = /^(?:那|那么|再|看下|看看)?\s*(?:GMV|收入|营收|点击|订单|转化率|CVR|EPC|revenue|clicks|orders)\s*(?:环比|新增|变化|趋势|同比|MoM)?\s*(?:呢|如何|怎么样)?[？?。!！\s]*$/i.test(prompt.trim());
  if (/最近|近\s*\d+\s*个?月|last\s+\d+\s+months?/i.test(prompt) || (!refersToHistory && !metricFollowup)) return null;
  for (const previous of [...history].reverse()) {
    const inherited = explicitRange(previous, referenceMonth);
    if (inherited) return inherited;
  }
  return null;
}

export function selectAgentMonthRange<T extends { month?: unknown }>(rows: readonly T[], range: AgentMonthRange | null, includePreviousMonth = false): T[] {
  if (!range) return [...rows];
  const start = monthIndex(range.startMonth);
  const end = monthIndex(range.endMonth);
  if (start === null || end === null || end < start) return [];
  return rows.filter(row => {
    const index = monthIndex(row.month);
    return index !== null && index >= start - (includePreviousMonth ? 1 : 0) && index <= end;
  });
}
