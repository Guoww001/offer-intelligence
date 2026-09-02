import { describe, expect, it } from "vitest";

import {
  applyAgentMemoryEvents,
  createAgentRunState,
  emptyAgentMemory,
  normalizeAgentTimelineStep,
  type AgentMemoryEvent
} from "./agentModel";

describe("agentModel", () => {
  it("keeps timeline metadata bounded and drops answer/tool payloads", () => {
    const step = normalizeAgentTimelineStep({
      id: "tool-1",
      phase: "tool",
      status: "done",
      label: "merchant_analysis",
      detail: "Tapo",
      prompt: "secret prompt",
      answer: "secret answer",
      result: { rows: [{ merchant: "secret" }] }
    });

    expect(step).toMatchObject({ id: "tool-1", phase: "tool", status: "done", label: "merchant_analysis" });
    expect(step).not.toHaveProperty("prompt");
    expect(step).not.toHaveProperty("answer");
    expect(step).not.toHaveProperty("result");
  });

  it("applies only structured memory events and ignores raw content", () => {
    const events: AgentMemoryEvent[] = [{
      kind: "tool_success",
      focus: { merchants: [{ id: "398679", name: "Tapo" }], categories: ["Electronics"], tiers: ["Tier 1"] },
      query: { months: 12, metrics: ["epc", "conversionRate"] },
      lastTool: { toolName: "merchant_analysis", headline: "Tapo", dataSource: "mixed", estimated: false },
      rawQuestion: "must not persist",
      rawAnswer: "must not persist"
    } as unknown as AgentMemoryEvent];

    const next = applyAgentMemoryEvents(createAgentRunState().memory, events, Date.parse("2026-09-02T00:00:00.000Z"));
    expect(next.focus.merchants).toEqual([{ id: "398679", name: "Tapo" }]);
    expect(next.focus.categories).toEqual(["Electronics"]);
    expect(next.query.metrics).toEqual(["epc", "conversionRate"]);
    expect(JSON.stringify(next)).not.toContain("must not persist");
  });

  it("keeps ambiguous candidates structured and resolves them without storing raw text", () => {
    const current = emptyAgentMemory(Date.parse("2026-09-02T00:00:00.000Z"));
    const next = applyAgentMemoryEvents(current, [
      {
        kind: "candidates",
        candidates: [
          { type: "merchant", id: "1", name: "Alpha" },
          { type: "merchant", id: "2", name: "Beta" }
        ]
      },
      {
        kind: "tool_success",
        focus: { merchants: [{ id: "2", name: "Beta" }] },
        resolvedEntities: [{ type: "merchant", id: "2", name: "Beta" }],
        lastTool: { toolName: "merchant_analysis", headline: "Beta", dataSource: "database" }
      }
    ], Date.parse("2026-09-02T00:00:00.000Z"));

    expect(next.candidates.pending).toEqual([]);
    expect(next.candidates.confirmed).toEqual([{ type: "merchant", id: "2", name: "Beta" }]);
    expect(next.candidates.rejected).toEqual([{ type: "merchant", id: "1", name: "Alpha" }]);
  });
});
