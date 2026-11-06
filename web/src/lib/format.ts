import type { Arm } from "@tuition/shared";

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
