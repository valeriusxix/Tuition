// §7.10 forecast call. Same settings for every LLM arm: effort low, max_tokens 2048, schema-constrained
// JSON, no temperature (D16–D18). Invalid output is retried once with the error appended.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireEnv, type Config } from "../config";
import { log } from "../log";
import { clampP } from "../score/metrics";
import { isRetryableError, retry } from "../util/retry";

/**
 * Retry rule for every Claude call. The SDK runs with maxRetries 0, so util/retry is the only retry
 * layer (D7). Its APIConnectionError ("Connection error.", and the APIConnectionTimeoutError subclass)
 * has no status and may carry no cause, so it is recognised by class.
 */
export const isRetryableClaudeError = (error: unknown): boolean => error instanceof Anthropic.APIConnectionError || isRetryableError(error);

export const FORECAST_MAX_TOKENS = 2048;
export const RATIONALE_MAX_WORDS = 60;

export const ForecastOutputSchema = z.object({
  probability: z.number(),
  rationale: z.string(),
  cited_lessons: z.array(z.string()),
});

export interface ForecastResult {
  p: number; // clamped to [0.02, 0.98]
  rationale: string;
  cited: string[]; // only blob IDs that were actually offered
  model: string;
  costUsd?: number;
}

export interface Forecaster {
  forecast(prompt: { system: string; user: string }, offeredBlobIds: readonly string[]): Promise<ForecastResult>;
  /** Cheapest possible real call, proving the key and model ID work; returns the serving model. */
  ping?(): Promise<string>;
}

export function limitWords(text: string, max: number): string {
  const words = text.trim().split(/\s+/);
  return words.length <= max ? text.trim() : `${words.slice(0, max).join(" ")}…`;
}

/** Pure: validate one parsed model output into a ForecastResult, or explain why it is invalid. */
export function interpretOutput(raw: unknown, offered: readonly string[], model: string): ForecastResult | string {
  const parsed = ForecastOutputSchema.safeParse(raw);
  if (!parsed.success) return `output did not match the schema: ${parsed.error.issues.map((i) => i.message).join("; ")}`;
  const { probability, rationale, cited_lessons } = parsed.data;
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) return `probability ${probability} is outside [0, 1]`;
  return {
    p: clampP(probability),
    rationale: limitWords(rationale, RATIONALE_MAX_WORDS),
    cited: [...new Set(cited_lessons.filter((id) => offered.includes(id)))],
    model,
  };
}

export class ClaudeForecaster implements Forecaster {
  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
  ) {}

  async forecast(prompt: { system: string; user: string }, offered: readonly string[]): Promise<ForecastResult> {
    let problem = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const user = attempt === 0 ? prompt.user : `${prompt.user}\n\nYour previous reply was invalid (${problem}). Reply again with the JSON object only.`;
      try {
        const res = await retry(
          () =>
            this.client.messages.parse({
              model: this.model,
              max_tokens: FORECAST_MAX_TOKENS,
              system: prompt.system,
              output_config: { effort: "low", format: zodOutputFormat(ForecastOutputSchema) },
              messages: [{ role: "user", content: user }],
            }),
          { isRetryable: isRetryableClaudeError, onRetry: ({ attempt: n, delayMs, error }) => log.warn("Claude retry", { attempt: n, delayMs, error }) },
        );
        if (res.stop_reason === "refusal") {
          problem = "the model declined";
          continue;
        }
        const out = interpretOutput(res.parsed_output, offered, res.model);
        if (typeof out !== "string") {
          const cost = (res.usage as { cost?: unknown }).cost; // reported by the Orbio gateway
          return typeof cost === "number" ? { ...out, costUsd: cost } : out;
        }
        problem = out;
      } catch (error) {
        if (error instanceof Anthropic.APIError) throw error; // HTTP failures were already retried
        problem = error instanceof Error ? error.message : String(error); // unparsable output
      }
      log.warn("invalid forecast output", { attempt: attempt + 1, problem });
    }
    throw new Error(`forecast failed twice: ${problem}`);
  }

  async ping(): Promise<string> {
    const res = await retry(
      () => this.client.messages.create({ model: this.model, max_tokens: 16, messages: [{ role: "user", content: "Reply with the single word: ok" }] }),
      { isRetryable: isRetryableClaudeError },
    );
    return res.model;
  }
}

/** --dry runs: no LLM, always 0.5 (§10). */
export class StubForecaster implements Forecaster {
  async forecast(): Promise<ForecastResult> {
    return { p: 0.5, rationale: "Stub forecast (dry run).", cited: [], model: "stub" };
  }
}

export function createClaudeForecaster(config: Config): ClaudeForecaster {
  const { ANTHROPIC_API_KEY } = requireEnv(config, ["ANTHROPIC_API_KEY"]);
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY, baseURL: config.ANTHROPIC_BASE_URL, maxRetries: 0 });
  return new ClaudeForecaster(client, config.FORECAST_MODEL);
}
