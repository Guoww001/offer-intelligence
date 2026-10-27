import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentNativeTrace } from "./agentNativeTrace";

const questionEventId = "11111111-1111-4111-8111-111111111111";
async function drain() { for (let index = 0; index < 80; index++) await Promise.resolve(); }

function fixture() {
  const bodies: Record<string, any>[] = [];
  const fetcher = vi.fn(async (_url: any, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response('{"ok":true}');
  });
  let clock = 1000;
  const trace = createAgentNativeTrace({ questionEventId, language: "zh", fetcher, now: () => clock, storage: localStorage });
  return { trace, fetcher, bodies, at: (value: number) => { clock = value; } };
}

afterEach(() => vi.useRealTimers());

describe("原生 Trace 白名单与队列", () => {
  it("每种请求都通过现有 Python 合同校验且不访问数据库", async () => {
    const f = fixture();
    f.trace.observePlanningState({ agentRunId: "原生规划", calls: [{ id: "r1c1", name: "trend" }] });
    f.trace.observeTool({ callId: "r1c1", toolName: "trend", status: "done" });
    f.trace.complete({ status: "done" }); await drain();
    const result = execFileSync("python", ["-c", "import json,sys; from agent_trace import validate_trace_run,normalize_trace_step; payloads=json.load(sys.stdin); [([normalize_trace_step(s) for s in p['steps']] if p['action']=='append' else validate_trace_run(p)) for p in payloads]; print('ok')"], { cwd: "..", input: JSON.stringify(f.bodies), encoding: "utf8" });
    expect(result.trim()).toBe("ok");
  });

  it("用本地时钟计算阶段耗时，忽略重复终态和未执行的计划项", async () => {
    const f = fixture(); f.at(1100);
    f.trace.observeStep({ id: "planning", phase: "planning", status: "done", elapsedMs: 999999 });
    f.trace.observePlanningState({ agentRunId: "原生规划", calls: [{ id: "a", name: "trend" }, { id: "b", name: "trend" }] });
    f.at(1200); f.trace.observeTool({ callId: "a", toolName: "trend", status: "running" });
    f.at(1400); f.trace.observeTool({ callId: "a", toolName: "trend", status: "done" });
    f.trace.observeStep({ id: "a", phase: "tool", status: "running" });
    f.trace.observeStep({ id: "a", phase: "tool", status: "done" });
    f.trace.observeStep({ id: "synthesis", phase: "synthesis", status: "running" });
    f.at(1700); f.trace.complete({ status: "stopped" }); f.trace.complete({ status: "done" }); await drain();
    const steps = f.bodies.flatMap(body => body.steps || []);
    expect(steps.map(step => [step.phase, step.durationMs, step.status])).toEqual([["planning", 100, "success"], ["tool", 200, "success"], ["synthesis", 300, "stopped"]]);
    expect(f.bodies.at(-1)).toMatchObject({ plannedToolCalls: 2, executedToolCalls: 1, failedToolCalls: 0, durationMs: 700, status: "stopped" });
    expect(f.bodies.filter(body => body.action === "complete")).toHaveLength(1);
  });

  it("未知阶段工具和错误正文不能进入请求，缺少用量保持空", async () => {
    const f = fixture();
    f.trace.observeStep({ id: "任意编号", phase: "敏感阶段", status: "error", detail: "敏感正文" });
    f.trace.observeTool({ callId: "敏感编号", toolName: "敏感工具", status: "error", errorCode: "敏感错误" });
    f.trace.observeStep({ id: "planning", phase: "planning", status: "error", detail: "敏感异常", inputTokens: 12, provider: "敏感模型" });
    f.trace.complete({ status: "error", errorCode: "敏感错误" }); await drain();
    expect(JSON.stringify(f.bodies)).not.toContain("敏感");
    const step = f.bodies.find(body => body.action === "append")!.steps[0];
    expect(step).toMatchObject({ errorCode: "agent_planning_unavailable", usageAvailable: false, inputTokens: null, outputTokens: null, totalTokens: null });
    expect(f.bodies.at(-1)).toMatchObject({ errorCode: "unknown", plannedToolCalls: 0, executedToolCalls: 0 });
  });

  it("写入悬挂超时后继续发送终态且不使用回答取消信号", async () => {
    vi.useFakeTimers(); const f = fixture();
    f.fetcher.mockImplementationOnce(async (_url, init) => { f.bodies.push(JSON.parse(String(init?.body))); return new Promise<Response>(() => {}); });
    f.trace.complete({ status: "error", errorCode: "agent_planning_unavailable" }); await drain();
    expect(f.bodies).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000); await drain();
    expect(f.bodies.at(-1)).toMatchObject({ action: "complete", status: "failed" });
    expect(f.fetcher.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    expect(f.fetcher.mock.calls.at(-1)![1]?.signal?.aborted).toBe(false);
  });

  it("没有原提问编号不补造编号也不写入", async () => {
    const fetcher = vi.fn();
    const trace = createAgentNativeTrace({ language: "zh", fetcher });
    trace.complete({ status: "done" }); await drain(); expect(fetcher).not.toHaveBeenCalled();
  });
});
