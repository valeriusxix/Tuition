import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const ENGINE_ROOT = resolve(here, "..");
export const REPO_ROOT = resolve(ENGINE_ROOT, "..");
export const ENV_FILE = resolve(REPO_ROOT, ".env");
export const FIXTURES_DIR = resolve(ENGINE_ROOT, "fixtures");
export const STATE_DIR = resolve(ENGINE_ROOT, "state");
export const CANDLES_DIR = resolve(ENGINE_ROOT, "data", "candles");
export const WEB_DATA_DIR = resolve(REPO_ROOT, "web", "public", "data");
