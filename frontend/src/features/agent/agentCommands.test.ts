import { describe, expect, it } from "vitest";

import { AGENT_COMMANDS, AGENT_MENU_COMMANDS, parseAgentCommand } from "./agentCommands";

describe("Agent query commands", () => {
  it("只展示高频命令，同时保留历史别名的解析兼容性", () => {
    expect(AGENT_COMMANDS).toHaveLength(16);
    expect(AGENT_MENU_COMMANDS.map((command) => command.key)).toEqual([
      "merchant", "asin", "publisher", "publisherprofile", "trend", "tier",
      "category", "compare", "comparecategories", "payment", "promotion"
    ]);
    expect(parseAgentCommand("/revenue Tapo")?.command.key).toBe("revenue");
    expect(parseAgentCommand("/orders Tapo")?.command.key).toBe("orders");
    expect(parseAgentCommand("/promotion Tapo")).toMatchObject({
      command: { key: "promotion" },
      value: "Tapo"
    });
  });
});
