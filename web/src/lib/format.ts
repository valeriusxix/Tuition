import type { Arm, Comparison } from "@tuition/shared";

const MINUS = "−";

export const num = (x: number, digits = 3): string => (x < 0 ? MINUS : "") + Math.abs(x).toFixed(digits);
export const signed = (x: number, digits = 4): string => (x >= 0 ? "+" : MINUS) + Math.abs(x).toFixed(digits);
export const percent = (x: number): string => `${Math.round(x * 100)}%`;

export const shortDate = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export const dateTime = (iso: string): string =>
  `${new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;

export const shortBlob = (id: string): string => (id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id);

export const ARM_LABEL: Record<Arm, string> = {
  base: "Base rate (no LLM)",
  nomem: "Memory OFF",
  nomem2: "Memory OFF, second pass",
  mem: "Memory ON",
};

/** What a comparison supports, decided by its interval. All published wording comes from here. */
export function verdict(c: Comparison): { label: string; sentence: string } {
  const change = `Brier ${num(c.referenceBrier)} to ${num(c.candidateBrier)}`;
  if (c.ci95[0] > 0) return { label: "Reliable improvement", sentence: `Memory improved ${change}, and the 95% interval is above zero.` };
  if (c.ci95[1] < 0) return { label: "Reliably worse", sentence: `Memory worsened ${change}, and the 95% interval is below zero.` };
  return {
    label: "Not statistically significant",
    sentence: `Memory moved ${change}, but the 95% interval spans zero, so this run does not show a reliable improvement.`,
  };
}
