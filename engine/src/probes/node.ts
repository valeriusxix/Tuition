// §4.1 probe:node — print process.version; exit 1 if below the §1 minimum.
import { say } from "../log";
import { checkNodeVersion } from "../util/node";

export async function probeNode(): Promise<void> {
  const check = checkNodeVersion(process.version);
  say(`process.version = ${process.version}`);
  say(`${check.ok ? "OK" : "FAIL"}: ${check.message}`);
  if (!check.ok) process.exitCode = 1;
}
