// zod-validated environment (§3). parseConfig() is pure; loadConfig() reads .env and process.env.
// Secrets are optional at parse time and required per command through requireEnv(), so tests,
// CI and --dry runs work without keys while real commands fail fast with a clear message.
import { existsSync } from "node:fs";
import { z } from "zod";
import { UsageError } from "./errors";
import { registerSecret } from "./log";
import { ENV_FILE } from "./paths";
import { isMonday, isValidDate } from "./util/dates";

export const ENV_SOURCES = {
  ANTHROPIC_API_KEY: "console.anthropic.com → API Keys (or an Orbio gateway key, with ANTHROPIC_BASE_URL=https://api.orbio.so/api)",
  TATUM_API_KEY: "dashboard.tatum.io → API keys (a mainnet key)",
  MEMWAL_PRIVATE_KEY: "memory.walrus.xyz → SDK credentials (the Ed25519 delegate private key, hex)",
  MEMWAL_ACCOUNT_ID: "memory.walrus.xyz (the account OBJECT ID, 0x + 64 hex; NOT your wallet address)",
} as const;
export type SecretName = keyof typeof ENV_SOURCES;
const SECRET_VALUES: readonly SecretName[] = ["ANTHROPIC_API_KEY", "TATUM_API_KEY", "MEMWAL_PRIVATE_KEY"];

export class ConfigError extends UsageError {
  override name = "ConfigError";
}

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const str = (def: string) => z.preprocess(blankToUndefined, z.string().trim().default(def));
const url = (def: string) => z.preprocess(blankToUndefined, z.url().default(def));
const int = (def: number, min: number, max = Number.MAX_SAFE_INTEGER) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().min(min).max(max).default(def));
const num = (def: number, gt: number, lte: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().gt(gt).lte(lte).default(def));
const date = (def: string) =>
  z.preprocess(blankToUndefined, z.string().trim().refine(isValidDate, "must be a valid YYYY-MM-DD date").default(def));
const monday = (def: string) => date(def).refine(isMonday, "must be a Monday (UTC)");
const list = (def: string, upper = false) =>
  z.preprocess(blankToUndefined, z.string().default(def)).transform((s) =>
    s
      .split(",")
      .map((x) => (upper ? x.trim().toUpperCase() : x.trim()))
      .filter(Boolean),
  );
const secret = (schema: z.ZodString = z.string().trim().min(1)) => z.preprocess(blankToUndefined, schema.optional());

const EnvSchema = z
  .object({
    ANTHROPIC_API_KEY: secret(),
    // Anthropic-compatible endpoint: the Anthropic API itself, or a gateway such as Orbio
    // (https://api.orbio.so/api, which takes OpenRouter model IDs like anthropic/claude-haiku-5.5).
    ANTHROPIC_BASE_URL: url("https://api.anthropic.com"),
    FORECAST_MODEL: str("claude-haiku-5-5"),
    REFLECT_MODEL: str("claude-sonnet-5-5"),
    TATUM_API_KEY: secret(),
    TATUM_OHLCV_BATCH_URL: url("https://api.tatum.io/v4/data/rate/symbol/OHLCV/batch"),
    TATUM_OHLCV_URL: url("https://api.tatum.io/v4/data/rate/symbol/OHLCV"),
    TATUM_SUI_RPC_URL: url("https://sui-mainnet.gateway.tatum.io"),
    MEMWAL_PRIVATE_KEY: secret(
      z
        .string()
        .trim()
        .regex(
          /^((0x)?[0-9a-fA-F]{64}|suiprivkey1[0-9a-z]+)$/,
          "must be the Ed25519 delegate private key: 64 hex characters (0x optional) or a suiprivkey1… string",
        ),
    ),
    MEMWAL_ACCOUNT_ID: secret(
      z.string().trim().regex(/^0x[0-9a-fA-F]{64}$/, "must be the account object ID: 0x followed by 64 hex characters"),
    ),
    MEMWAL_SERVER_URL: url("https://relayer.memory.walrus.xyz"),
    WALRUS_AGGREGATOR_URL: url("https://aggregator.walrus-mainnet.walrus.space"),
    MEMORY_BACKEND: z.preprocess(blankToUndefined, z.enum(["walrus", "memory"]).default("walrus")),
    ASSETS: list("BTC,ETH,SOL,SUI", true).refine((a) => a.length > 0, "must list at least one symbol"),
    REPLAY_START: monday("2026-03-02"),
    REPLAY_END: monday("2026-10-12"),
    DEV_SPLIT_END: date("2026-05-25"),
    HORIZON_DAYS: int(7, 1, 60),
    MEMWAL_WRITE_CONCURRENCY: int(2, 1, 16),
    MEMWAL_MAX_WRITES_PER_HOUR: int(120, 1, 100_000),
    LLM_CONCURRENCY: int(4, 1, 64),
    RECALL_LIMIT: int(5, 1, 100), // the relayer caps recall at 100
    RECALL_MAX_DISTANCE: num(0.8, 0, 2), // cosine distance lies in [0, 2]
    LESSON_ERROR_THRESHOLD: num(0.45, 0, 1),
    LIVE_LESSON_NAMESPACES: list(""),
    SEED: int(42, 0, 2 ** 32 - 1),
  })
  .superRefine((c, ctx) => {
    if (c.REPLAY_START > c.REPLAY_END) {
      ctx.addIssue({ code: "custom", path: ["REPLAY_START"], message: "must be on or before REPLAY_END" });
    }
    if (c.DEV_SPLIT_END < c.REPLAY_START || c.DEV_SPLIT_END >= c.REPLAY_END) {
      ctx.addIssue({ code: "custom", path: ["DEV_SPLIT_END"], message: "must fall within [REPLAY_START, REPLAY_END)" });
    }
    if (/staging/i.test(c.MEMWAL_SERVER_URL)) {
      ctx.addIssue({
        code: "custom",
        path: ["MEMWAL_SERVER_URL"],
        message: "points at a staging relayer; Tuition uses mainnet credentials, so use the mainnet relayer",
      });
    }
  });

export type Config = z.infer<typeof EnvSchema>;

/** Pure: validate an env-like record. Error messages name the variable and never echo its value. */
export function parseConfig(env: Record<string, string | undefined>): Config {
  const result = EnvSchema.safeParse(env);
  if (result.success) return result.data;
  const lines = result.error.issues.map((i) => `  - ${i.path.join(".") || "(env)"}: ${i.message}`);
  throw new ConfigError(`Invalid environment configuration:\n${lines.join("\n")}`);
}

let cached: Config | undefined;

/** Read the repo-root .env (if present) into process.env, validate, and register secrets for redaction. */
export function loadConfig(): Config {
  if (cached) return cached;
  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
  cached = parseConfig(process.env);
  for (const name of SECRET_VALUES) registerSecret(cached[name]);
  return cached;
}

/** Fail fast when a command needs secrets that are not configured. */
export function requireEnv<K extends SecretName>(config: Config, names: readonly K[]): { [P in K]: string } {
  const missing = names.filter((n) => !config[n]);
  if (missing.length > 0) {
    const them = missing.length > 1 ? "them" : "it";
    throw new ConfigError(
      [
        ...missing.map((n) => `${n} is not set. Get it from ${ENV_SOURCES[n]}.`),
        `Add ${them} to ${ENV_FILE} (copy .env.example), or export ${them} in the shell.`,
      ].join("\n"),
    );
  }
  const out = {} as { [P in K]: string };
  for (const n of names) out[n] = config[n] as string;
  return out;
}
