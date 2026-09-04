import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import CopilotKitAgentHost from "./CopilotKitAgentHost.vue";
import { emptyAgentMemory } from "./agentModel";

vi.mock("@copilotkit/vue/v2", () => ({ CopilotKitProvider: { name: "Provider", props: ["frontendTools"], template: "<slot />" } }));
vi.mock("./CopilotKitAgentRuntime.vue", () => ({ default: { name: "Runtime", props: ["beginRun"], template: "<div />" } }));

describe("CopilotKit local result projection", () => {
  it("sends only the bounded tool result to Python, keeping charts and full UI rows local", async () => {
    const toolResult = { callId: "r1c1", result: { ok: true } };
    const toolExecutor = vi.fn(async () => ({ toolResult, resultView: { trend: "local chart" }, memoryEvent: { kind: "tool_success" } }));
    const wrapper = mount(CopilotKitAgentHost, { props: { language: "en", endpoint: "/api/copilotkit", enabled: true, fallbackRun: vi.fn(), toolExecutor } });
    wrapper.findComponent({ name: "Runtime" }).props("beginRun")({
      prompt: "Show a trend",
      language: "en",
      history: [],
      memory: emptyAgentMemory(),
      memoryText: "",
      signal: new AbortController().signal
    });
    const tool = wrapper.findComponent({ name: "Provider" }).props("frontendTools")[0];
    const output = await tool.handler({ merchant: "Fixture" }, { toolCall: { id: "r1c1" }, signal: new AbortController().signal });
    expect(output).toEqual({ toolResult });
    expect(toolExecutor).toHaveBeenCalledWith(expect.objectContaining({ prompt: "Show a trend", toolName: "merchant_analysis" }));
    wrapper.unmount();
  });
});
