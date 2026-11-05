// §7.5 reflection: after a bad miss, the reflection model writes a post-mortem lesson that is stored on
// Walrus Memory and recalled by later forecasts in matching regimes. Same call pattern as forecast.ts:
// schema-constrained JSON, validated with zod, one retry with the problem appended, then skip.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Lesson, Question } from "@tuition/shared";
import { z } from "zod";
import { requireEnv, type Config } from "../config";
import { regimeOf } from "../features/regime";
import { log } from "../log";
import { encodeMemory } from "../memory/format";
import { APPLIES_WHEN_MAX_CHARS, isPromptSafe, LESSON_MAX_CHARS, MAX_MAGNITUDE } from "../prompt/render";
import { retry } from "../util/retry";
import { isRetryableClaudeError } from "./forecast";

export const REFLECT_MAX_TOKENS = 2048;

// No length or range constraints here: structured outputs do not enforce them reliably, so
// interpretReflection() trims and clamps instead (same policy as the forecast rationale, D29).
export const ReflectOutputSchema = z.object({
  lesson: z.string(),
  applies_when: z.string(),
  adjustment: z.enum(["raise", "lower", "none"]),
  magnitude: z.number(),
});

export interface ReflectResult {
  lesson: string;
  appliesWhen: string;
  adjustment: Lesson["adjustment"];
  magnitude: number; // 0–0.3; 0 when adjustment is "none"
  model: string;
  costUsd?: number;
}

export interface Reflector {
  reflect(prompt: { system: string; user: string }): Promise<ReflectResult>;
  ping?(): Promise<string>;
}

/** Cut at a word boundary so the result (with an ellipsis) fits in `max` characters. */
export function limitChars(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

/** Pure: validate one parsed reflection into a ReflectResult, or explain why it is unusable. */
export function interpretReflection(raw: unknown, tickers: readonly string[], model: string): ReflectResult | string {
  const parsed = ReflectOutputSchema.safeParse(raw);
  if (!parsed.success) return `output did not match the schema: ${parsed.error.issues.map((i) => i.message).join("; ")}`;
  const { lesson, applies_when, adjustment, magnitude } = parsed.data;
  if (lesson.trim().length < 10) return "the lesson is empty";
  if (!Number.isFinite(magnitude)) return "magnitude is not a number";
  const text = `${lesson} ${applies_when}`;
  if (!isPromptSafe(text, tickers)) return "the lesson names a ticker or a calendar date; describe the regime only";
  return {
    lesson: limitChars(lesson, LESSON_MAX_CHARS),
    appliesWhen: limitChars(applies_when, APPLIES_WHEN_MAX_CHARS),
    adjustment,
    magnitude: adjustment === "none" ? 0 : Math.round(Math.min(MAX_MAGNITUDE, Math.max(0, magnitude)) * 100) / 100,
    model,
  };
}

const TREND_WORDS = { up: "uptrend", down: "downtrend", flat: "no clear trend" } as const;
const VOL_WORDS = { low: "low volatility", normal: "normal volatility", high: "high volatility" } as const;
const VOLTREND_WORDS = { expanding: "volatility expanding", contracting: "volatility contracting", stable: "volatility stable" } as const;

/** "BREAKOUT, downtrend, high volatility, volatility expanding": the human words the relayer embeds. */
export function regimeWords(q: Pick<Question, "type" | "features">): string {
  const f = q.features;
  return `${q.type}, ${TREND_WORDS[f.trend]}, ${VOL_WORDS[f.volRegime]}, ${VOLTREND_WORDS[f.volTrend]}`;
}

function sentence(s: string): string {
  const t = s.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

/**
 * §7.6 lesson memory text. The header carries the machine fields (including the question ID, which names
 * the ticker); only the body ever reaches a forecast prompt (D18).
 */
export function lessonMemoryText(args: { runId: string; question: Question; simDate: string; result: ReflectResult }): string {
  const { runId, question: q, simDate, result: r } = args;
  const next =
    r.adjustment === "none"
      ? "No probability adjustment: treat this as noise, not a pattern."
      : `Next time, ${r.adjustment} my P(YES) by about ${r.magnitude.toFixed(2)}.`;
  const body = `LESSON (${regimeWords(q)}): ${sentence(r.lesson)} Applies when ${sentence(r.appliesWhen)} ${next}`;
  return encodeMemory(
    "lesson",
    { run: runId, q: q.id, type: q.type, regime: regimeOf(q.features), sim: simDate, adj: r.adjustment, mag: r.magnitude.toFixed(2) },
    body,
  );
}

export class ClaudeReflector implements Reflector {
  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
    private readonly tickers: readonly string[],
  ) {}

  async reflect(prompt: { system: string; user: string }): Promise<ReflectResult> {
    let problem = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const user = attempt === 0 ? prompt.user : `${prompt.user}\n\nYour previous reply was invalid (${problem}). Reply again with the JSON object only.`;
      try {
        const res = await retry(
          () =>
            this.client.messages.parse({
              model: this.model,
              max_tokens: REFLECT_MAX_TOKENS,
              system: prompt.system,
              output_config: { effort: "low", format: zodOutputFormat(ReflectOutputSchema) },
              messages: [{ role: "user", content: user }],
            }),
          { isRetryable: isRetryableClaudeError, onRetry: ({ attempt: n, delayMs, error }) => log.warn("Claude retry (reflect)", { attempt: n, delayMs, error }) },
        );
        if (res.stop_reason === "refusal") {
          problem = "the model declined";
          continue;
        }
        const out = interpretReflection(res.parsed_output, this.tickers, res.model);
        if (typeof out !== "string") {
          const cost = (res.usage as { cost?: unknown }).cost; // reported by the Orbio gateway
          return typeof cost === "number" ? { ...out, costUsd: cost } : out;
        }
        problem = out;
      } catch (error) {
        if (error instanceof Anthropic.APIError) throw error; // HTTP failures were already retried
        problem = error instanceof Error ? error.message : String(error);
      }
      log.warn("invalid reflection output", { attempt: attempt + 1, problem });
    }
    throw new ReflectionSkipped(`reflection failed twice: ${problem}`);
  }

  async ping(): Promise<string> {
    const res = await retry(
      () => this.client.messages.create({ model: this.model, max_tokens: 16, messages: [{ role: "user", content: "Reply with the single word: ok" }] }),
      { isRetryable: isRetryableClaudeError },
    );
    return res.model;
  }
}

/** Thrown when the model's output is unusable twice; the caller logs it and skips the lesson (§7.5). */
export class ReflectionSkipped extends Error {
  override name = "ReflectionSkipped";
}

/** --dry runs and tests: a deterministic lesson from the forecast error, no LLM. */
export class StubReflector implements Reflector {
  async reflect(prompt: { system: string; user: string }): Promise<ReflectResult> {
    const p = Number(/P\(YES\) = (\d\.\d\d)/.exec(prompt.user)?.[1] ?? "0.5");
    const yes = /Outcome: YES/.test(prompt.user);
    const regime = /\(([a-z]+\/[a-z]+\/[a-z]+)\)/.exec(prompt.user)?.[1] ?? "this regime";
    return {
      lesson: `In ${regime.replaceAll("/", ", ")} conditions I put P(YES) at ${p.toFixed(2)} and the answer was ${yes ? "YES" : "NO"}.`,
      appliesWhen: `regime is ${regime}`,
      adjustment: yes ? "raise" : "lower",
      magnitude: 0.1,
      model: "stub",
    };
  }
}

export function createClaudeReflector(config: Config): ClaudeReflector {
  const { ANTHROPIC_API_KEY } = requireEnv(config, ["ANTHROPIC_API_KEY"]);
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY, baseURL: config.ANTHROPIC_BASE_URL, maxRetries: 0 });
  return new ClaudeReflector(client, config.REFLECT_MODEL, config.ASSETS);
}
