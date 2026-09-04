import { describe, expect, it, vi } from "vitest";

import { createChatbotSession } from "./chatbotSession";
import type { ChatbotChatRunner } from "./chatbotViewTypes";

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
  }
];

describe("createChatbotSession", () => {
  it("uses the cached report model and exposes a structured snapshot", async () => {
    const session = createChatbotSession({ offers, language: "zh", llmEnabled: false, enableQuestionLogging: false });

    const result = await session.submit("Tapo ID398679");

    expect(result).toMatchObject({ ok: true, mode: "report", source: "cache" });
    expect(result.report).toMatchObject({ intent: "merchant", query: "Tapo ID398679", rows: offers });
    expect(session.getState()).toMatchObject({ status: "success", hasMemory: false });
  });

  it("keeps Chat Mode streaming, usage, and successful history separate from stopped turns", async () => {
    const calls: string[] = [];
    const runChat: ChatbotChatRunner = vi.fn(async (request, onToken) => {
      calls.push(request.prompt);
      if (request.prompt === "stop") return { ok: false, stopped: true, response: "" };
      onToken?.("hello");
      return { ok: true, response: "hello", usage: { usageAvailable: true, outputTokens: 1 } };
    });
    const session = createChatbotSession({ offers, language: "en", llmEnabled: false, runChat, enableQuestionLogging: false });
    session.setMode("chat");

    const stopped = await session.submit("stop");
    const done = await session.submit("continue");

    expect(stopped.stopped).toBe(true);
    expect(done).toMatchObject({ ok: true, response: "hello", usage: { outputTokens: 1 } });
    expect(calls).toEqual(["stop", "continue"]);
    expect(session.getState().history).toEqual([
      { role: "user", content: "continue" },
      { role: "assistant", content: "hello" }
    ]);
    expect(session.getState().messages.map(({ role, content }) => ({ role, content }))).toEqual(session.getState().history);
  });

  it("adds bounded report memory and routes Deep Window memory actions", async () => {
    const session = createChatbotSession({ offers, language: "en", llmEnabled: false, enableQuestionLogging: false });
    const result = await session.submit("Tapo");

    expect(session.addMemory?.(result)).toBe(true);
    expect(session.getState().memory).toHaveLength(1);
    const windowId = session.openDeepWindow?.();
    expect(windowId).toBeTruthy();
    expect(session.deepWindows.addToChat(windowId!)).toBe(true);
    expect(session.getState().memory).toHaveLength(1);
  });

  it("does not leave a stopped request in the formal conversation", async () => {
    const session = createChatbotSession({
      offers,
      language: "en",
      llmEnabled: false,
      enableQuestionLogging: false,
      runChat: vi.fn(async () => ({ ok: false, stopped: true, response: "" }))
    });
    session.setMode("chat");
    await session.submit("live query");

    expect(session.getState().messages).toEqual([]);
    expect(session.getState().history).toEqual([]);
  });

  it("exports the current report and Deep Window without a Legacy bridge", async () => {
    const downloadReport = vi.fn(() => true);
    const session = createChatbotSession({
      offers,
      language: "en",
      llmEnabled: false,
      enableQuestionLogging: false,
      downloadReport
    });
    await session.submit("Tapo");

    expect(session.downloadOverview?.()).toBe(true);
    const windowId = session.openDeepWindow?.();
    expect(session.deepWindows.export(windowId!)).toBeTruthy();
    expect(downloadReport).toHaveBeenCalledTimes(2);
  });

  it("keeps Chat answers addressable for feedback, Deep Window, and context controls", async () => {
    const session = createChatbotSession({
      offers,
      language: "en",
      llmEnabled: false,
      enableQuestionLogging: false,
      runChat: vi.fn(async () => ({ ok: true, response: "Revenue is stable." }))
    });
    session.setMode("chat");

    const result = await session.submit("Explain the trend");
    const answerId = result.answerId;

    expect(answerId).toBeTruthy();
    expect(result.feedbackState).toBe("available");
    expect(session.getState().messages.at(-1)).toMatchObject({
      role: "assistant",
      answerId,
      canOpenDeep: true,
      feedbackState: "available"
    });
    expect(session.feedbackForAnswer?.(answerId!)).toMatchObject({ isAvailable: expect.any(Function) });
    expect(session.feedbackForAnswer?.(answerId!)?.isAvailable()).toBe(true);

    const deepWindowId = session.openChatAnswer?.(answerId!);
    expect(deepWindowId).toBeTruthy();
    expect(session.feedbackForDeepWindow?.(deepWindowId!)?.isAvailable()).toBe(true);
    expect(session.deepWindows.getState().windows[0]).toMatchObject({
      mode: "chat",
      contentHtml: expect.stringContaining("Revenue is stable")
    });
    expect(session.interactContext?.("reminder-toggle")).toBe(true);
    expect(session.getState().utility?.reminderCollapsed).toBe(true);
  });
});
