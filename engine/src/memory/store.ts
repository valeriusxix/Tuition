// §7.7 memory store. WalrusMemoryStore writes through the Walrus Memory relayer on mainnet, with the
// local ledger as the guard against double writes. InMemoryStore is for tests and --dry runs only.
import { MemWal } from "@mysten-incubation/memwal";
import type { MemoryLedgerEntry, RecalledMemory } from "@tuition/shared";
import { requireEnv, type Config } from "../config";
import { log } from "../log";
import { sha256Hex } from "../util/hash";
import { realClock, type Clock } from "../util/ratelimit";
import { retry, statusOf } from "../util/retry";
import { decodeHeader } from "./format";
import { appendLedger, findByKey, readLedger } from "./ledger";

export const AUTH_HINT =
  "HTTP 401 from the relayer. Check: (1) MEMWAL_PRIVATE_KEY is the delegate key from memory.walrus.xyz → SDK credentials; " +
  "(2) that key is registered on this account; (3) MEMWAL_ACCOUNT_ID is the account OBJECT ID, not a wallet address; " +
  "(4) MEMWAL_SERVER_URL is the mainnet relayer and the credentials are mainnet credentials.";

export interface MemoryWrite {
  namespace: string;
  text: string;
  key: string;
  kind: MemoryLedgerEntry["kind"];
  simDate?: string;
}

export interface MemoryRecall {
  namespace: string;
  query: string;
  limit: number;
  maxDistance?: number;
  sort?: "relevance" | "recent";
}

export interface MemoryStore {
  write(input: MemoryWrite): Promise<{ blobId: string; jobId: string }>;
  recall(input: MemoryRecall): Promise<RecalledMemory[]>;
  health(): Promise<unknown>;
}

/** The part of the Walrus Memory SDK client the store uses; injectable for tests. */
export interface MemWalClient {
  remember(text: string, namespace: string, options: { idempotencyKey: string }): Promise<{ job_id: string }>;
  waitForRememberJob(jobId: string, opts: { pollIntervalMs: number; timeoutMs: number }): Promise<{ id: string; job_id?: string; blob_id: string }>;
  recall(params: { query: string; namespace: string; limit: number; maxDistance?: number; sort?: "relevance" | "recent" }): Promise<{
    results: { blob_id: string; text: string; distance: number }[];
  }>;
  health(): Promise<unknown>;
}

function recalledFrom(results: { blob_id: string; text: string; distance: number }[]): RecalledMemory[] {
  return results.flatMap((r) => {
    const kind = decodeHeader(r.text)?.kind;
    return kind === "lesson" || kind === "calibration" ? [{ blobId: r.blob_id, distance: r.distance, text: r.text, kind }] : [];
  });
}

export interface WalrusStoreOptions {
  concurrency: number;
  maxWritesPerHour: number;
  clock?: Clock;
}

export class WalrusMemoryStore implements MemoryStore {
  private readonly entries: MemoryLedgerEntry[];
  private active = 0;
  private readonly queue: (() => void)[] = [];
  private readonly writeTimes: number[] = [];
  private readonly clock: Clock;

  constructor(
    private readonly client: MemWalClient,
    private readonly ledgerFile: string,
    private readonly opts: WalrusStoreOptions,
  ) {
    this.entries = readLedger(ledgerFile);
    this.clock = opts.clock ?? realClock;
  }

  async write(input: MemoryWrite): Promise<{ blobId: string; jobId: string }> {
    const done = findByKey(this.entries, input.key);
    if (done) return { blobId: done.blobId, jobId: done.jobId }; // Walrus Memory is append-only: never write twice
    await this.acquire();
    try {
      const again = findByKey(this.entries, input.key); // a concurrent writer may have finished it
      if (again) return { blobId: again.blobId, jobId: again.jobId };
      await this.respectHourlyCap();
      const accepted = await this.call(() => this.client.remember(input.text, input.namespace, { idempotencyKey: input.key }));
      const result = await this.call(() => this.client.waitForRememberJob(accepted.job_id, { pollIntervalMs: 1000, timeoutMs: 90_000 }));
      if (!result.blob_id) throw new Error(`remember job ${accepted.job_id} finished without a blob_id`);
      const entry: MemoryLedgerEntry = {
        key: input.key,
        namespace: input.namespace,
        kind: input.kind,
        blobId: result.blob_id,
        jobId: result.job_id ?? accepted.job_id,
        createdAt: new Date(this.clock.now()).toISOString(),
        textSha256: sha256Hex(input.text),
        ...(input.simDate ? { createdSimDate: input.simDate } : {}),
      };
      appendLedger(this.ledgerFile, entry);
      this.entries.push(entry);
      this.writeTimes.push(this.clock.now());
      return { blobId: entry.blobId, jobId: entry.jobId };
    } finally {
      this.release();
    }
  }

  async recall(input: MemoryRecall): Promise<RecalledMemory[]> {
    const res = await this.call(() =>
      this.client.recall({
        query: input.query,
        namespace: input.namespace,
        limit: input.limit,
        ...(input.maxDistance !== undefined ? { maxDistance: input.maxDistance } : {}),
        ...(input.sort ? { sort: input.sort } : {}),
      }),
    );
    return recalledFrom(res.results);
  }

  health(): Promise<unknown> {
    return this.call(() => this.client.health());
  }

  /** Ledger entries written so far (including earlier runs that share the ledger file). */
  ledger(): readonly MemoryLedgerEntry[] {
    return this.entries;
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await retry(fn, { onRetry: ({ attempt, delayMs, error }) => log.warn("Walrus Memory retry", { attempt, delayMs, error }) });
    } catch (error) {
      if (statusOf(error) === 401) throw new Error(`${(error as Error).message}\n${AUTH_HINT}`);
      throw error;
    }
  }

  private async respectHourlyCap(): Promise<void> {
    const hour = 3_600_000;
    for (;;) {
      const now = this.clock.now();
      while (this.writeTimes.length > 0 && this.writeTimes[0]! <= now - hour) this.writeTimes.shift();
      if (this.writeTimes.length < this.opts.maxWritesPerHour) return;
      const waitMs = this.writeTimes[0]! + hour - now;
      log.warn("hourly Walrus Memory write cap reached; waiting", { cap: this.opts.maxWritesPerHour, waitSeconds: Math.ceil(waitMs / 1000) });
      await this.clock.sleep(waitMs);
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.opts.concurrency) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) next(); // hand the slot straight to the next waiter
    else this.active--;
  }
}

/** A WalrusMemoryStore backed by the real relayer client and the given ledger file. */
export function createWalrusStore(config: Config, ledgerFile: string): WalrusMemoryStore {
  const env = requireEnv(config, ["MEMWAL_PRIVATE_KEY", "MEMWAL_ACCOUNT_ID"]);
  const client = MemWal.create({ key: env.MEMWAL_PRIVATE_KEY, accountId: env.MEMWAL_ACCOUNT_ID, serverUrl: config.MEMWAL_SERVER_URL });
  return new WalrusMemoryStore(client, ledgerFile, {
    concurrency: config.MEMWAL_WRITE_CONCURRENCY,
    maxWritesPerHour: config.MEMWAL_MAX_WRITES_PER_HOUR,
  });
}

const tokens = (s: string): Set<string> => new Set(s.toLowerCase().match(/[a-z0-9.]+/g) ?? []);

/** Tests and --dry only: per-namespace arrays, token-overlap recall, fake blob IDs mem-<n>. */
export class InMemoryStore implements MemoryStore {
  readonly writes: (MemoryWrite & { blobId: string; order: number })[] = [];
  readonly recalls: MemoryRecall[] = [];

  async write(input: MemoryWrite): Promise<{ blobId: string; jobId: string }> {
    const existing = this.writes.find((w) => w.key === input.key);
    if (existing) return { blobId: existing.blobId, jobId: `job-${existing.order}` };
    const order = this.writes.length + 1;
    this.writes.push({ ...input, blobId: `mem-${order}`, order });
    return { blobId: `mem-${order}`, jobId: `job-${order}` };
  }

  async recall(input: MemoryRecall): Promise<RecalledMemory[]> {
    this.recalls.push(input);
    const q = tokens(input.query);
    const scored = this.writes
      .filter((w) => w.namespace === input.namespace)
      .map((w) => {
        const t = tokens(w.text);
        const overlap = [...q].filter((x) => t.has(x)).length;
        return { w, distance: q.size === 0 ? 1 : 1 - overlap / q.size };
      })
      .filter((s) => input.maxDistance === undefined || s.distance < input.maxDistance);
    scored.sort((a, b) => (input.sort === "recent" ? b.w.order - a.w.order : a.distance - b.distance || b.w.order - a.w.order));
    return recalledFrom(scored.slice(0, input.limit).map((s) => ({ blob_id: s.w.blobId, text: s.w.text, distance: s.distance })));
  }

  async health(): Promise<unknown> {
    return { status: "ok", backend: "memory" };
  }
}
