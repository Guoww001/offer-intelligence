import { describe, expect, it, vi } from "vitest";

import { createCopilotKitAgentRunner } from "./copilotkitTransport";
import type { AgentRunRequest } from "./AgentPage.vue";
import { emptyAgentMemory } from "./agentModel";

function request(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    prompt: "查询 EPC",
    language: "zh",
    history: [],
    memory: emptyAgentMemory(),
    memoryText: "",
    signal: new AbortController().signal,
    ...overrides
  };
}

describe("copilotkitTransport", () => {
  it("sends a bounded OI payload and maps runtime events to Vue callbacks", async () => {
    const fetcher = vi.fn(async () => new Response([
      "event: timeline",
      'data: {"type":"timeline","step":{"id":"planning","phase":"planning","status":"done","label":"规划"}}',
      "",
      "event: result_view",
      'data: {"type":"result_view","view":{"id":"metric-1","toolName":"merchant_analysis","kind":"metric","status":"done","title":"EPC","source":"database","metrics":[{"label":"EPC","value":"1.23"}]}}',
      "",
      "event: token",
      'data: {"type":"token","token":"EPC 1.23"}',
      "",
      "event: done",
      'data: {"type":"done"}',
      "",
      "data: [DONE]",
      ""
    ].join("\n")));
    const tokens: string[] = [];
    const views: string[] = [];
    const runner = createCopilotKitAgentRunner({ endpoint: "/api/copilotkit", fetcher });
    const result = await runner(request({
      onToken: (token) => tokens.push(token),
      onResultView: (view) => views.push(view.id)
    }));

    expect(fetcher).toHaveBeenCalledWith("/api/copilotkit", expect.objectContaining({
      credentials: "same-origin",
      headers: expect.objectContaining({
        "X-OI-Agent-Authority": "python-registry",
        Accept: "text/event-stream"
      })
    }));
    const calls = fetcher.mock.calls as unknown as [RequestInfo | URL, RequestInit | undefined][];
    const body = JSON.parse(String(calls[0]?.[1]?.body));
    expect(body).toEqual({ messages: [{ role: "user", content: "查询 EPC" }], context: { language: "zh", memoryText: "" } });
    expect(result).toMatchObject({ ok: true, status: "done", response: "EPC 1.23" });
    expect(result.steps).toHaveLength(1);
    expect(result.resultViews?.[0]).toMatchObject({ id: "metric-1", kind: "metric" });
    expect(tokens).toEqual(["EPC 1.23"]);
    expect(views).toEqual(["metric-1"]);
  });

  it("turns an aborted runtime request into a stopped result", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });
    const runner = createCopilotKitAgentRunner({ fetcher });
    await expect(runner(request({ signal: controller.signal }))).resolves.toMatchObject({
      ok: false,
      status: "stopped"
    });
  });
});
