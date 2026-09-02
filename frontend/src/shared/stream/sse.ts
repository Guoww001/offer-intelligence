export interface SseEvent {
  readonly event: string;
  readonly data: string;
  readonly id?: string;
}

export interface SseStreamOptions {
  readonly signal?: AbortSignal;
  readonly onEvent: (event: SseEvent) => void | Promise<void>;
}

export interface SseParser {
  readonly done: boolean;
  push(chunk: Uint8Array | string): void;
  finish(): void;
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

function eventNameFor(data: string, explicitName: string): string {
  if (explicitName) return explicitName;
  if (data === "[DONE]") return "done";
  try {
    const parsed = JSON.parse(data) as { readonly type?: unknown };
    if (parsed.type === "usage") return "usage";
  } catch {
    // 非 JSON 的增量文本按普通 message 事件处理。
  }
  return "message";
}

export function createSseParser(options: SseStreamOptions): SseParser {
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let eventName = "";
  let eventId: string | undefined;
  let dataLines: string[] = [];
  let completed = false;

  const resetEvent = (): void => {
    eventName = "";
    eventId = undefined;
    dataLines = [];
  };

  const dispatch = (): void => {
    if (!dataLines.length || completed) {
      resetEvent();
      return;
    }
    const eventData = dataLines.join("\n");
    const event = eventNameFor(eventData, eventName);
    const current: SseEvent = eventId === undefined
      ? { event, data: eventData }
      : { event, data: eventData, id: eventId };
    resetEvent();
    if (eventData === "[DONE]") completed = true;
    void options.onEvent(current);
  };

  const processLine = (line: string): void => {
    if (!line) {
      dispatch();
      return;
    }
    if (line.startsWith(":")) return;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    const rawValue = separator < 0 ? "" : line.slice(separator + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    if (field === "event") eventName = value;
    else if (field === "data") dataLines.push(value);
    else if (field === "id") eventId = value;
  };

  const parser: SseParser = {
    get done() {
      return completed;
    },
    push(chunk) {
      if (completed) return;
      buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        processLine(line);
        if (completed) {
          buffer = "";
          return;
        }
        newline = buffer.indexOf("\n");
      }
    },
    finish() {
      if (completed) return;
      buffer += decoder.decode();
      if (buffer) {
        processLine(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
        buffer = "";
      }
      dispatch();
    }
  };
  return parser;
}

export function parseSseChunk(parser: SseParser, chunk: Uint8Array | string): void {
  parser.push(chunk);
}

export async function consumeSseResponse(
  response: Response,
  options: SseStreamOptions
): Promise<void> {
  if (options.signal?.aborted) throw abortError();
  if (!response.ok) throw new Error(`SSE request failed with HTTP ${response.status}`);
  if (!response.body) return;

  const reader = response.body.getReader();
  let aborted = false;
  const pendingCallbacks: Promise<void>[] = [];
  const abortListener = (): void => {
    aborted = true;
    void reader.cancel();
  };
  options.signal?.addEventListener("abort", abortListener, { once: true });
  const parser = createSseParser({
    onEvent(event) {
      pendingCallbacks.push(Promise.resolve(options.onEvent(event)));
    }
  });

  try {
    while (true) {
      if (aborted) throw abortError();
      const result = await reader.read();
      if (aborted) throw abortError();
      if (result.done) break;
      if (result.value) parser.push(result.value);
      if (parser.done) break;
    }
    parser.finish();
    await Promise.all(pendingCallbacks);
  } catch (error) {
    if (aborted || options.signal?.aborted) throw abortError();
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abortListener);
    reader.releaseLock();
  }
}
