import { describe, expect, it } from "vitest";

import {
  consumeSseResponse,
  createSseParser,
  parseSseChunk,
  type SseEvent
} from "./sse";

describe("shared SSE parser", () => {
  it("joins line and UTF-8 boundaries before dispatching events", () => {
    const events: SseEvent[] = [];
    const parser = createSseParser({ onEvent: (event) => { events.push(event); } });
    const bytes = new TextEncoder().encode('data: {"delta":"你好"}\n\n');
    const split = bytes.findIndex((byte, index) => index > 15 && byte >= 0x80);

    parseSseChunk(parser, bytes.slice(0, split));
    parseSseChunk(parser, bytes.slice(split));
    parser.finish();

    expect(events).toEqual([{ event: "message", data: '{"delta":"你好"}' }]);
  });

  it("normalizes usage and done events and ignores duplicate data after done", () => {
    const events: SseEvent[] = [];
    const parser = createSseParser({ onEvent: (event) => { events.push(event); } });

    parseSseChunk(parser, [
      "event: message\n",
      "data: {\"delta\":\"Hi\"}\n\n",
      "data: {\"type\":\"usage\",\"total_tokens\":7}\n\n",
      "data: [DONE]\n\n",
      "data: ignored\n\n"
    ].join(""));

    expect(events.map((event) => event.event)).toEqual(["message", "usage", "done"]);
    expect(events[1]?.data).toContain("total_tokens");
    expect(parser.done).toBe(true);
  });

  it("rejects non-2xx responses without exposing response text", async () => {
    await expect(consumeSseResponse(
      new Response("sensitive provider response", { status: 502 }),
      { onEvent: () => undefined }
    )).rejects.toThrow("SSE request failed with HTTP 502");
    await expect(consumeSseResponse(
      new Response("sensitive provider response", { status: 502 }),
      { onEvent: () => undefined }
    )).rejects.not.toThrow("sensitive provider response");
  });

  it("fails closed when the caller has already aborted the stream", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(consumeSseResponse(
      new Response(null, { status: 200 }),
      { signal: controller.signal, onEvent: () => undefined }
    )).rejects.toMatchObject({ name: "AbortError" });
  });
});
