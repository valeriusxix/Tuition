// Node runtime guard (§1). The Walrus Memory SDK README asks for the October 2026
// security releases: 22.23.4+ within 22.x, 24.22.1+ within 24.x, 26.12.1+ within 26.x.

const MINIMUMS: Record<number, [number, number, number]> = {
  22: [22, 23, 4],
  24: [24, 22, 1],
  26: [26, 12, 1],
};
const FIRST_UNLISTED_MAJOR = 27; // majors released after the security release are accepted

export const NODE_UPGRADE_HINT =
  "Install Node 24.22.1 or newer: `winget install -e --id OpenJS.NodeJS.LTS` or https://nodejs.org/en/download";

export interface NodeVersionCheck {
  ok: boolean;
  version: string;
  message: string;
}

export function parseNodeVersion(version: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function atLeast(v: [number, number, number], min: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (v[i]! !== min[i]!) return v[i]! > min[i]!;
  }
  return true;
}

export function checkNodeVersion(version: string): NodeVersionCheck {
  const v = parseNodeVersion(version);
  if (!v) return { ok: false, version, message: `Cannot parse Node version "${version}". ${NODE_UPGRADE_HINT}` };
  const [major] = v;
  const min = MINIMUMS[major];
  if (min) {
    return atLeast(v, min)
      ? { ok: true, version, message: `Node ${version} meets the minimum ${min.join(".")} for ${major}.x` }
      : {
          ok: false,
          version,
          message: `Node ${version} is below the required ${min.join(".")} for ${major}.x (October 2026 security release). ${NODE_UPGRADE_HINT}`,
        };
  }
  if (major >= FIRST_UNLISTED_MAJOR) return { ok: true, version, message: `Node ${version} is newer than every listed minimum` };
  return {
    ok: false,
    version,
    message: `Node ${version} is not supported (use 22.23.4+, 24.22.1+ or 26.12.1+). ${NODE_UPGRADE_HINT}`,
  };
}
