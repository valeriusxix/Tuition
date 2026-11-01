import { describe, expect, it } from "vitest";
import { TokenBucket, type Clock } from "../src/util/ratelimit";

class FakeClock implements Clock {
  t = 0;
  now() {
    return this.t;
  }
  async sleep(ms: number) {
    this.t += ms;
  }
}

describe("TokenBucket", () => {
  it("spaces requests 400 ms apart at 2.5 rps", async () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket(2.5, 1, clock);
    const times: number[] = [];
    for (let i = 0; i < 4; i++) {
      await bucket.take();
      times.push(clock.t);
    }
    expect(times).toEqual([0, 400, 800, 1200]);
  });

  it("never lets more than 3 requests into any 1-second window (Tatum's limit)", async () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket(2.5, 1, clock);
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      await bucket.take();
      times.push(clock.t);
    }
    for (const start of times) expect(times.filter((t) => t >= start && t < start + 1000).length).toBeLessThanOrEqual(3);
  });

  it("serves concurrent callers in FIFO order", async () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket(2.5, 1, clock);
    const order: number[] = [];
    await Promise.all([0, 1, 2].map((i) => bucket.take().then(() => order.push(i))));
    expect(order).toEqual([0, 1, 2]);
    expect(clock.t).toBe(800);
  });

  it("refills while idle, up to capacity", async () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket(2, 3, clock);
    for (let i = 0; i < 3; i++) await bucket.take();
    expect(clock.t).toBe(0); // burst of 3
    await bucket.take();
    expect(clock.t).toBe(500);
    clock.t += 10_000; // long idle: refill caps at 3
    const before = clock.t;
    for (let i = 0; i < 3; i++) await bucket.take();
    expect(clock.t).toBe(before);
  });

  it("schedule() runs the task after taking a token", async () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket(1, 1, clock);
    await bucket.take();
    await expect(bucket.schedule(async () => clock.t)).resolves.toBe(1000);
  });

  it("rejects nonsense parameters", () => {
    expect(() => new TokenBucket(0)).toThrow();
    expect(() => new TokenBucket(1, 0)).toThrow();
  });
});
