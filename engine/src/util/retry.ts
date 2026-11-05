// Retry with backoff for every external call (§7.7, §18): up to 3 retries waiting 1s, 4s, 10s,
// on network errors, HTTP 429 and 5xx. Everything else (400, 401, 404, ...) fails at once.

export const DEFAULT_BACKOFF_MS: readonly number[] = [1_000, 4_000, 10_000];
const DEFAULT_MAX_RETRY_AFTER_MS = 10 * 60_000;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface RetryInfo {
  attempt: number; // 1 for the first retry
  delayMs: number;
  error: unknown;
}

export interface RetryOptions {
  /** Wait before each retry; its length is the number of retries. */
  delaysMs?: readonly number[];
  isRetryable?: (error: unknown) => boolean;
  /** A server Retry-After longer than this is not waited out; the error is rethrown. */
  maxRetryAfterMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: RetryInfo) => void;
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function statusOf(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error && typeof error.status === "number") {
    return error.status;
  }
  return undefined;
}

const NETWORK_CODES = /^(ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|UND_ERR_\w+)$/;

/**
 * True for a network-level failure anywhere in the error's cause chain. SDKs wrap fetch failures
 * (e.g. Anthropic's APIConnectionError → TypeError "fetch failed" → { code: "UND_ERR_SOCKET" }), so the
 * socket code can sit several causes deep.
 */
export function isNetworkError(error: unknown): boolean {
  let e: unknown = error;
  for (let depth = 0; depth < 6 && e instanceof Error; depth++) {
    if (e.name === "TimeoutError") return true; // AbortSignal.timeout() and SDK request deadlines
    if (e instanceof TypeError && /fetch failed|network/i.test(e.message)) return true;
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && NETWORK_CODES.test(code)) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

export function isRetryableError(error: unknown): boolean {
  const status = statusOf(error);
  if (status !== undefined) return status === 429 || status >= 500;
  return isNetworkError(error);
}

/** Server-requested wait carried by an error (HttpError.retryAfterMs or MemWalRateLimitedError.retryAfterSeconds). */
export function retryAfterMsOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const e = error as { retryAfterMs?: unknown; retryAfterSeconds?: unknown };
  if (typeof e.retryAfterMs === "number") return e.retryAfterMs;
  if (typeof e.retryAfterSeconds === "number") return e.retryAfterSeconds * 1000;
  return undefined;
}

/** Parse a Retry-After header (delta-seconds or HTTP-date) into milliseconds. */
export function parseRetryAfter(header: string | null | undefined, now: number = Date.now()): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

export async function retry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const delays = opts.delaysMs ?? DEFAULT_BACKOFF_MS;
  const isRetryable = opts.isRetryable ?? isRetryableError;
  const maxRetryAfterMs = opts.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS;
  const wait = opts.sleep ?? sleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      const base = delays[attempt];
      if (base === undefined || !isRetryable(error)) throw error;
      const retryAfter = retryAfterMsOf(error) ?? 0;
      if (retryAfter > maxRetryAfterMs) throw error;
      const delayMs = Math.max(base, retryAfter);
      opts.onRetry?.({ attempt: attempt + 1, delayMs, error });
      await wait(delayMs);
    }
  }
}
