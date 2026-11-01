import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig, requireEnv } from "../src/config";

const HEX64 = "a".repeat(64);
const ACCOUNT = `0x${"b".repeat(64)}`;

function errorOf(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ConfigError) return e;
    throw e;
  }
  throw new Error("expected a ConfigError");
}

describe("parseConfig", () => {
  it("applies every §3 default to an empty environment", () => {
    const c = parseConfig({});
    expect(c).toMatchObject({
      ANTHROPIC_BASE_URL: "https://api.anthropic.com",
      FORECAST_MODEL: "claude-haiku-5-5",
      REFLECT_MODEL: "claude-sonnet-5-5",
      TATUM_OHLCV_BATCH_URL: "https://api.tatum.io/v4/data/rate/symbol/OHLCV/batch",
      TATUM_OHLCV_URL: "https://api.tatum.io/v4/data/rate/symbol/OHLCV",
      TATUM_SUI_RPC_URL: "https://sui-mainnet.gateway.tatum.io",
      MEMWAL_SERVER_URL: "https://relayer.memory.walrus.xyz",
      WALRUS_AGGREGATOR_URL: "https://aggregator.walrus-mainnet.walrus.space",
      MEMORY_BACKEND: "walrus",
      ASSETS: ["BTC", "ETH", "SOL", "SUI"],
      REPLAY_START: "2026-03-02",
      REPLAY_END: "2026-10-12",
      DEV_SPLIT_END: "2026-05-25",
      HORIZON_DAYS: 7,
      MEMWAL_WRITE_CONCURRENCY: 2,
      MEMWAL_MAX_WRITES_PER_HOUR: 120,
      LLM_CONCURRENCY: 4,
      RECALL_LIMIT: 5,
      RECALL_MAX_DISTANCE: 0.8,
      LESSON_ERROR_THRESHOLD: 0.45,
      LIVE_LESSON_NAMESPACES: [],
      SEED: 42,
    });
    expect(c.ANTHROPIC_API_KEY).toBeUndefined();
    expect(c.TATUM_API_KEY).toBeUndefined();
    expect(c.MEMWAL_PRIVATE_KEY).toBeUndefined();
    expect(c.MEMWAL_ACCOUNT_ID).toBeUndefined();
  });

  it("treats blank values, as in a copied .env.example, as unset", () => {
    const c = parseConfig({ FORECAST_MODEL: "", RECALL_LIMIT: "  ", ANTHROPIC_API_KEY: "", ASSETS: "" });
    expect(c.FORECAST_MODEL).toBe("claude-haiku-5-5");
    expect(c.RECALL_LIMIT).toBe(5);
    expect(c.ANTHROPIC_API_KEY).toBeUndefined();
    expect(c.ASSETS).toEqual(["BTC", "ETH", "SOL", "SUI"]);
  });

  it("coerces numbers and normalises lists", () => {
    const c = parseConfig({ RECALL_LIMIT: "7", RECALL_MAX_DISTANCE: "0.65", ASSETS: " btc, eth ,,sol ", LIVE_LESSON_NAMESPACES: "a.lessons, b.lessons" });
    expect(c.RECALL_LIMIT).toBe(7);
    expect(c.RECALL_MAX_DISTANCE).toBe(0.65);
    expect(c.ASSETS).toEqual(["BTC", "ETH", "SOL"]);
    expect(c.LIVE_LESSON_NAMESPACES).toEqual(["a.lessons", "b.lessons"]);
  });

  it("names the variable when a value is invalid", () => {
    expect(errorOf(() => parseConfig({ REPLAY_START: "2026-03-03" })).message).toMatch(/REPLAY_START: must be a Monday/);
    expect(errorOf(() => parseConfig({ RECALL_LIMIT: "abc" })).message).toMatch(/RECALL_LIMIT/);
    expect(errorOf(() => parseConfig({ RECALL_LIMIT: "101" })).message).toMatch(/RECALL_LIMIT/);
    expect(errorOf(() => parseConfig({ MEMORY_BACKEND: "redis" })).message).toMatch(/MEMORY_BACKEND/);
    expect(errorOf(() => parseConfig({ TATUM_SUI_RPC_URL: "not a url" })).message).toMatch(/TATUM_SUI_RPC_URL/);
  });

  it("keeps the dev split inside the replay window", () => {
    expect(errorOf(() => parseConfig({ DEV_SPLIT_END: "2026-11-01" })).message).toMatch(/DEV_SPLIT_END/);
    expect(errorOf(() => parseConfig({ REPLAY_START: "2026-10-19", DEV_SPLIT_END: "2026-10-19" })).message).toMatch(/REPLAY_START/);
  });

  it("rejects a malformed account ID without echoing it", () => {
    const bad = "0xabc123notanobjectid";
    const err = errorOf(() => parseConfig({ MEMWAL_ACCOUNT_ID: bad }));
    expect(err.message).toContain("MEMWAL_ACCOUNT_ID");
    expect(err.message).not.toContain(bad);
  });

  it("never echoes a malformed private key", () => {
    const bad = `oops-${"z".repeat(40)}`;
    const err = errorOf(() => parseConfig({ MEMWAL_PRIVATE_KEY: bad }));
    expect(err.message).toContain("MEMWAL_PRIVATE_KEY");
    expect(err.message).not.toContain(bad);
  });

  it("accepts delegate keys as hex (with or without 0x) or suiprivkey1…", () => {
    expect(parseConfig({ MEMWAL_PRIVATE_KEY: HEX64 }).MEMWAL_PRIVATE_KEY).toBe(HEX64);
    expect(parseConfig({ MEMWAL_PRIVATE_KEY: `0x${HEX64}` }).MEMWAL_PRIVATE_KEY).toBe(`0x${HEX64}`);
    const fakeSui = `${"sui"}privkey1${"q".repeat(30)}`; // built at runtime: no credential-shaped literal in the repo
    expect(parseConfig({ MEMWAL_PRIVATE_KEY: fakeSui }).MEMWAL_PRIVATE_KEY).toBe(fakeSui);
    expect(parseConfig({ MEMWAL_ACCOUNT_ID: ACCOUNT }).MEMWAL_ACCOUNT_ID).toBe(ACCOUNT);
  });

  it("refuses a staging relayer", () => {
    expect(errorOf(() => parseConfig({ MEMWAL_SERVER_URL: "https://relayer.staging.memory.walrus.xyz" })).message).toMatch(
      /MEMWAL_SERVER_URL/,
    );
  });
});

describe("requireEnv", () => {
  it("returns the requested secrets when present", () => {
    const c = parseConfig({ MEMWAL_PRIVATE_KEY: HEX64, MEMWAL_ACCOUNT_ID: ACCOUNT });
    expect(requireEnv(c, ["MEMWAL_PRIVATE_KEY", "MEMWAL_ACCOUNT_ID"])).toEqual({ MEMWAL_PRIVATE_KEY: HEX64, MEMWAL_ACCOUNT_ID: ACCOUNT });
  });

  it("names every missing variable and where to get it", () => {
    const err = errorOf(() => requireEnv(parseConfig({}), ["MEMWAL_PRIVATE_KEY", "MEMWAL_ACCOUNT_ID"]));
    expect(err.message).toMatch(/MEMWAL_PRIVATE_KEY is not set\. Get it from memory\.walrus\.xyz → SDK credentials/);
    expect(err.message).toMatch(/MEMWAL_ACCOUNT_ID is not set\..*NOT your wallet address/);
    expect(err.message).toMatch(/\.env/);
  });

  it("only complains about what the command needs", () => {
    const c = parseConfig({ TATUM_API_KEY: "t-123" });
    expect(requireEnv(c, ["TATUM_API_KEY"])).toEqual({ TATUM_API_KEY: "t-123" });
    expect(errorOf(() => requireEnv(c, ["ANTHROPIC_API_KEY"])).message).not.toMatch(/TATUM/);
  });
});
