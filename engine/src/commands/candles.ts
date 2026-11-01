// `candles [--refresh]`: fetch and cache daily candles for every configured asset (§10).
import { loadConfig } from "../config";
import { ensureCandles, historyWindow } from "../data/candles";
import { say } from "../log";
import { formatDate } from "../util/dates";

export async function candlesCommand(args: string[]): Promise<void> {
  const config = loadConfig();
  const window = historyWindow(config);
  say(`history window ${window.start} → ${window.end}${args.includes("--refresh") ? " (refresh)" : ""}`);
  const candles = await ensureCandles(config, { refresh: args.includes("--refresh") });
  for (const [symbol, c] of candles) {
    say(`  ${symbol.padEnd(5)} ${String(c.length).padStart(4)} candles  ${formatDate(c[0]!.t)} → ${formatDate(c[c.length - 1]!.t)}`);
  }
}
