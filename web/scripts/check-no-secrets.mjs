// CI guard (AGENT.md §15): nothing under web/src may reference secrets, process.env, or engine code.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const srcDir = join(webRoot, "src");

const RULES = [
  { re: /MEMWAL_/, why: "references a MEMWAL_ variable" },
  { re: /TATUM_/, why: "references a TATUM_ variable" },
  { re: /ANTHROPIC_/, why: "references an ANTHROPIC_ variable" },
  { re: /process\.env/, why: "reads process.env" },
  { re: /@tuition\/engine|from\s+["'](\.\.\/)+engine\//, why: "imports engine code" },
];

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

const problems = [];
let checked = 0;
for (const file of walk(srcDir)) {
  checked++;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const { re, why } of RULES) {
      if (re.test(line)) problems.push(`${relative(webRoot, file)}:${i + 1} ${why}`);
    }
  });
}

if (problems.length > 0) {
  console.error(`guard: FAIL, web/src must never touch secrets or engine code:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`guard: OK (${checked} files under web/src checked)`);
