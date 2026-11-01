// Raw HTTP for probes: retries 429/5xx/network errors (util/retry) behind a rate limiter, and
// returns the final response whatever its status, so error bodies get recorded too.
import { log } from "../log";
import { sha256Hex } from "../util/hash";
import type { TokenBucket } from "../util/ratelimit";
import { HttpError, parseRetryAfter, retry } from "../util/retry";

export interface RawResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  ms: number;
  attempts: number;
  /** Parsed JSON when the body is JSON, else the text (text mode only). */
  body?: unknown;
  /** Binary mode only: size and hash of the bytes, never the bytes. */
  byteLength?: number;
  sha256?: string;
}

export interface FetchRawOptions {
  limiter?: TokenBucket;
  timeoutMs?: number;
  binary?: boolean;
}

async function read(res: Response, started: number, attempts: number, binary: boolean): Promise<RawResponse> {
  const base = {
    status: res.status,
    statusText: res.statusText,
    headers: Object.fromEntries(res.headers.entries()),
    ms: Date.now() - started,
    attempts,
  };
  if (binary) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { ...base, byteLength: bytes.byteLength, sha256: sha256Hex(bytes) };
  }
  const text = await res.text();
  try {
    return { ...base, body: JSON.parse(text) as unknown };
  } catch {
    return { ...base, body: text };
  }
}

export async function fetchRaw(url: string, init: RequestInit, opts: FetchRawOptions = {}): Promise<RawResponse> {
  let last: RawResponse | undefined;
  try {
    return await retry(
      async (attempt) => {
        await opts.limiter?.take();
        const started = Date.now();
        const res = await fetch(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) });
        last = await read(res, started, attempt + 1, opts.binary ?? false);
        if (res.status === 429 || res.status >= 500) {
          throw new HttpError(res.status, `HTTP ${res.status}`, undefined, parseRetryAfter(res.headers.get("retry-after")));
        }
        return last;
      },
      { onRetry: ({ attempt, delayMs, error }) => log.warn("retrying request", { url, attempt, delayMs, error }) },
    );
  } catch (error) {
    if (last && error instanceof HttpError) return last; // retries exhausted: hand back the final response
    throw error;
  }
}

/** Short summary of a JSON value's shape: key → type (and an example), for writing parsers from fixtures. */
export function describeShape(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { value: typeof value };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    const example = typeof v === "object" ? "" : ` (${JSON.stringify(v)})`;
    out[k] = `${Array.isArray(v) ? "array" : v === null ? "null" : typeof v}${example}`;
  }
  return out;
}
