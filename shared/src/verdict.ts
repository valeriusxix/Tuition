// What a comparison supports, decided only by its interval. The site, the README and the blog table all
// use this, so no published sentence can claim more than the interval does.
import type { Comparison } from "./schemas";

const b = (x: number): string => x.toFixed(3);

export function verdict(c: Comparison): { label: string; sentence: string } {
  const change = `Brier ${b(c.referenceBrier)} to ${b(c.candidateBrier)}`;
  if (c.ci95[0] > 0) return { label: "Reliable improvement", sentence: `Memory improved ${change}, and the 95% interval is above zero.` };
  if (c.ci95[1] < 0) return { label: "Reliably worse", sentence: `Memory worsened ${change}, and the 95% interval is below zero.` };
  return {
    label: "Not statistically significant",
    sentence: `Memory moved ${change}, but the 95% interval spans zero, so this run does not show a reliable improvement.`,
  };
}
