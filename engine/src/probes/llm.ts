// §4.6 probe:llm — confirm the model IDs are accepted, and record (rather than assume) how the
// API treats the §7.10 settings: temperature 0, max_tokens 400, and strict-JSON output.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { loadConfig, requireEnv } from "../config";
import { say } from "../log";
import { retry } from "../util/retry";
import { saveFixture } from "./fixture";

const PROBE = "probe:llm";
const TINY = [{ role: "user" as const, content: "Reply with the single word: ok" }];

function summarize(label: string, msg: Anthropic.Message): void {
  const blocks = msg.content.map((b) => b.type).join(", ");
  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ").trim();
  say(`${label}: model=${msg.model} stop_reason=${msg.stop_reason} blocks=[${blocks}]`);
  say(`  usage: input=${msg.usage.input_tokens} output=${msg.usage.output_tokens}; text: ${JSON.stringify(text.slice(0, 160))}`);
}

export async function probeLlm(): Promise<void> {
  const config = loadConfig();
  const { ANTHROPIC_API_KEY } = requireEnv(config, ["ANTHROPIC_API_KEY"]);
  // util/retry owns retries, so the SDK's own are off.
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY, baseURL: config.ANTHROPIC_BASE_URL, maxRetries: 0 });
  const model = config.FORECAST_MODEL;
  say(`endpoint ${config.ANTHROPIC_BASE_URL}; forecast model ${model}; reflection model ${config.REFLECT_MODEL}`);

  // 1. The §4.6 call, with AGENT.md's max_tokens.
  const basicRequest = { model, max_tokens: 400, messages: TINY };
  const basic = await retry(() => client.messages.create(basicRequest));
  summarize("forecast model", basic);
  say(`  saved ${saveFixture("llm-basic.json", { probe: PROBE, request: basicRequest, response: basic })}`);

  // 2. §7.1/§7.10 ask for temperature 0. Record what the API does with it.
  const tempRequest = { model, max_tokens: 50, temperature: 0, messages: TINY };
  try {
    const accepted = await client.messages.create(tempRequest as unknown as Anthropic.MessageCreateParamsNonStreaming);
    say("temperature 0: ACCEPTED");
    saveFixture("llm-temperature0.json", { probe: PROBE, request: tempRequest, response: accepted });
  } catch (error) {
    if (!(error instanceof Anthropic.APIError)) throw error;
    say(`temperature 0: rejected with HTTP ${error.status}: ${error.message.slice(0, 200)}`);
    saveFixture("llm-temperature0.json", {
      probe: PROBE,
      request: tempRequest,
      response: { status: error.status, error: error.error ?? error.message },
    });
  }

  // 3. The settings planned for agent/forecast.ts: low effort, schema-constrained JSON, room for thinking.
  const ForecastShape = z.object({ probability: z.number(), rationale: z.string(), cited_lessons: z.array(z.string()) });
  const prompt =
    "Asset A, closes rebased so day 0 = 100.00: day -4 96.10, day -3 97.40, day -2 98.00, day -1 99.20, day 0 100.00. " +
    "Question: will the close on day +7 be higher than the close on day 0? Give a probability between 0 and 1, " +
    "a rationale of at most 60 words, and cited_lessons as an empty list.";
  const structured = await retry(() =>
    client.messages.parse({
      model,
      max_tokens: 2048,
      output_config: { effort: "low", format: zodOutputFormat(ForecastShape) },
      messages: [{ role: "user", content: prompt }],
    }),
  );
  summarize("structured forecast", structured);
  say(`  parsed_output: ${JSON.stringify(structured.parsed_output)}`);
  saveFixture("llm-structured.json", {
    probe: PROBE,
    request: { model, max_tokens: 2048, output_config: { effort: "low", format: "zodOutputFormat({probability, rationale, cited_lessons})" }, prompt },
    response: structured,
  });

  // 4. The reflection model ID.
  const reflectRequest = { model: config.REFLECT_MODEL, max_tokens: 1024, output_config: { effort: "low" as const }, messages: TINY };
  const reflect = await retry(() => client.messages.create(reflectRequest));
  summarize("reflection model", reflect);
  saveFixture("llm-reflect-model.json", { probe: PROBE, request: reflectRequest, response: reflect });
}
