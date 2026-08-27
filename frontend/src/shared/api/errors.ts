export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly payload: unknown;

  constructor(
    message: string,
    status: number,
    code: string,
    payload: unknown = null,
    cause?: unknown
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorCodeFromPayload(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const candidate = payload.errorCode ?? payload.code;
  if (typeof candidate !== "string") return null;
  const code = candidate.trim();
  return code || null;
}

export function errorMessageFromPayload(payload: unknown, status: number): string {
  if (isRecord(payload)) {
    for (const key of ["error", "message", "detail"] as const) {
      const candidate = payload[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
  }
  return status > 0 ? `请求失败（${status}）` : "网络请求失败";
}

export function apiErrorFromPayload(
  status: number,
  payload: unknown,
  fallbackCode = "http_error"
): ApiError {
  return new ApiError(
    errorMessageFromPayload(payload, status),
    status,
    errorCodeFromPayload(payload) ?? fallbackCode,
    payload
  );
}
