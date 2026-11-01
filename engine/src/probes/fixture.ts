// Probe outputs are saved verbatim to engine/fixtures/ (§4); parsers are written from these files.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { redact } from "../log";
import { FIXTURES_DIR, REPO_ROOT } from "../paths";

export interface Fixture {
  probe: string;
  recordedAt: string;
  request?: unknown;
  response: unknown;
  notes?: string[];
}

/** Write a fixture and return its repo-relative path. Secrets are masked as a safety net. */
export function saveFixture(name: string, fixture: Omit<Fixture, "recordedAt">): string {
  mkdirSync(FIXTURES_DIR, { recursive: true });
  const path = resolve(FIXTURES_DIR, name);
  const { probe, ...rest } = fixture;
  const body: Fixture = { probe, recordedAt: new Date().toISOString(), ...rest };
  writeFileSync(path, `${redact(JSON.stringify(body, null, 2))}\n`);
  return relative(REPO_ROOT, path).replaceAll("\\", "/");
}

export function readFixture(name: string): Fixture | undefined {
  const path = resolve(FIXTURES_DIR, name);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as Fixture;
}
