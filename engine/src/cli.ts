// Command router (§10). The Node check runs before any command module (and its SDKs) is loaded.
import { UsageError } from "./errors";
import { redact } from "./log";
import { checkNodeVersion } from "./util/node";

const node = checkNodeVersion(process.version);
if (!node.ok) {
  console.error(`process.version = ${process.version}`);
  console.error(`FAIL: ${node.message}`);
  process.exit(1);
}

type Command = (args: string[]) => Promise<void>;

const COMMANDS: Record<string, { describe: string; load: () => Promise<Command> }> = {
  "probe:node": {
    describe: "Print the Node version; exit 1 if below the minimum",
    load: async () => (await import("./probes/node")).probeNode,
  },
  "smoke:memwal": {
    describe: "Walrus Memory health, one mainnet write, recall, agent public key",
    load: async () => (await import("./probes/memwal")).smokeMemwal,
  },
  "probe:ohlcv": {
    describe: "One Tatum OHLCV batch call, saved to fixtures",
    load: async () => (await import("./probes/ohlcv")).probeOhlcv,
  },
  "probe:sui": {
    describe: "Read the account object via Tatum Sui RPC, saved to fixtures",
    load: async () => (await import("./probes/sui")).probeSui,
  },
  "probe:aggregator": {
    describe: "Fetch the smoke blob from the Walrus aggregator (status, size, hash)",
    load: async () => (await import("./probes/aggregator")).probeAggregator,
  },
  "probe:llm": {
    describe: "Confirm the Claude model IDs and record how the API treats the forecast settings",
    load: async () => (await import("./probes/llm")).probeLlm,
  },
  candles: {
    describe: "Fetch and cache daily candles for every asset (--refresh refetches)",
    load: async () => (await import("./commands/candles")).candlesCommand,
  },
  questions: {
    describe: "Print question counts per split/type and the BREAKOUT base rate",
    load: async () => (await import("./commands/questions")).questionsCommand,
  },
  replay: {
    describe: "The memory ON vs OFF experiment (--arms, --limit N, --dry, --official, --resume runId)",
    load: async () => (await import("./commands/replay")).replayCommand,
  },
  score: {
    describe: "Score a replay run: metrics, bootstrap, influence (--run runId [--compare refRunId,…])",
    load: async () => (await import("./commands/score")).scoreCommand,
  },
  export: {
    describe: "Write the web data files for a run (--run runId [--out dir]; dev runs need --out)",
    load: async () => (await import("./commands/export")).exportCommand,
  },
  live: {
    describe: "Daily live forecasts committed to Walrus before the outcome (--dry: no mainnet, no LLM)",
    load: async () => (await import("./commands/live")).liveCommand,
  },
};

function usage(): string {
  const width = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  const lines = Object.entries(COMMANDS).map(([name, c]) => `  ${name.padEnd(width)}  ${c.describe}`);
  return `Usage: npm run engine -- <command> [options]\n\nCommands:\n${lines.join("\n")}`;
}

async function main(): Promise<void> {
  const [name, ...args] = process.argv.slice(2);
  if (!name || name === "help" || name === "--help") {
    console.log(usage());
    return;
  }
  const command = COMMANDS[name];
  if (!command) throw new UsageError(`Unknown command "${name}".\n\n${usage()}`);
  const run = await command.load();
  await run(args);
}

main().catch((error: unknown) => {
  if (error instanceof UsageError) {
    console.error(redact(error.message));
  } else if (error instanceof Error) {
    console.error(redact(process.env.DEBUG && error.stack ? error.stack : `${error.name}: ${error.message}`));
  } else {
    console.error(redact(String(error)));
  }
  process.exitCode = 1;
});
