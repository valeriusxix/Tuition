// Token-bucket rate limiting. Tatum's free tier allows about 3 requests/second, so OHLCV and
// Sui RPC share one 2.5 rps bucket (§4); aggregator blob checks get their own 3 rps bucket (§11).
import { sleep } from "./retry";

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = { now: () => Date.now(), sleep };

export class TokenBucket {
  private tokens: number;
  private last: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly ratePerSec: number,
    private readonly capacity = 1,
    private readonly clock: Clock = realClock,
  ) {
    if (!(ratePerSec > 0)) throw new Error("ratePerSec must be > 0");
    if (!(capacity >= 1)) throw new Error("capacity must be >= 1");
    this.tokens = capacity;
    this.last = clock.now();
  }

  /** Resolves when the next request may be sent. Waiters are served in FIFO order. */
  take(): Promise<void> {
    const turn = this.queue.then(() => this.acquire());
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    await this.take();
    return fn();
  }

  private async acquire(): Promise<void> {
    this.refill();
    if (this.tokens < 1) {
      await this.clock.sleep(Math.ceil(((1 - this.tokens) / this.ratePerSec) * 1000));
      this.refill();
    }
    this.tokens -= 1;
  }

  private refill(): void {
    const now = this.clock.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.ratePerSec);
    this.last = now;
  }
}

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Shared by Tatum OHLCV and Sui RPC calls. */
export const tatumLimiter = new TokenBucket(2.5);
/** Walrus aggregator blob reads. */
export const aggregatorLimiter = new TokenBucket(3);
