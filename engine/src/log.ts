// Tiny structured logger. Every line passes through redact(), so registered secrets
// (API keys, the delegate private key) never reach the terminal or CI logs.

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const registered = new Set<string>();

// Credential shapes redacted even when not registered.
const SECRET_PATTERNS: RegExp[] = [/sk-ant-[A-Za-z0-9_-]{8,}/g, /sk-orbio-[A-Za-z0-9_-]{8,}/g, /suiprivkey1[0-9a-z]{20,}/g];

/** Register a secret value so it is masked in all log output. */
export function registerSecret(value: string | undefined): void {
  if (!value || value.length < 8) return;
  registered.add(value);
  if (value.startsWith("0x")) registered.add(value.slice(2));
  else if (/^[0-9a-fA-F]+$/.test(value)) registered.add(`0x${value}`);
}

export function redactSecrets(text: string, secrets: Iterable<string>): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join("***");
  for (const re of SECRET_PATTERNS) out = out.replace(re, "***");
  return out;
}

export function redact(text: string): string {
  return redactSecrets(text, registered);
}

function format(value: unknown): string {
  if (typeof value === "string") return /[\s="]/.test(value) ? JSON.stringify(value) : value;
  if (value instanceof Error) return JSON.stringify(value.message);
  return JSON.stringify(value);
}

function emit(level: Level, msg: string, fields?: Fields): void {
  if (level === "debug" && !process.env.DEBUG) return;
  const time = new Date().toISOString().slice(11, 19);
  const extra = fields
    ? Object.entries(fields)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${format(v)}`)
        .join(" ")
    : "";
  const line = redact(`${time} ${level.toUpperCase().padEnd(5)} ${msg}${extra ? ` ${extra}` : ""}`);
  (level === "error" || level === "warn" ? console.error : console.log)(line);
}

export const log = {
  debug: (msg: string, fields?: Fields) => emit("debug", msg, fields),
  info: (msg: string, fields?: Fields) => emit("info", msg, fields),
  warn: (msg: string, fields?: Fields) => emit("warn", msg, fields),
  error: (msg: string, fields?: Fields) => emit("error", msg, fields),
};

/** Print a plain line (no timestamp) for probe and CLI output, still redacted. */
export function say(text = ""): void {
  console.log(redact(text));
}
