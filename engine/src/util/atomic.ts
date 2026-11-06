// Atomic replace (tmp + rename). On Windows, renaming over a file that another process has open for a
// moment (an indexer or scanner) fails with EPERM, EACCES or EBUSY, so those are retried briefly.
import { renameSync } from "node:fs";

const TRANSIENT = new Set(["EPERM", "EACCES", "EBUSY"]);
const ATTEMPTS = 20;
const WAIT_MS = 25;

const blockFor = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function replaceFile(from: string, to: string, rename: (a: string, b: string) => void = renameSync, wait: (ms: number) => void = blockFor): void {
  for (let attempt = 1; ; attempt++) {
    try {
      rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= ATTEMPTS || !code || !TRANSIENT.has(code)) throw error;
      wait(WAIT_MS);
    }
  }
}
