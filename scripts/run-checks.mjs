// Run every packaged check and stop on the first failure.
import {readdirSync} from "node:fs";
import {spawnSync} from "node:child_process";
const checks = readdirSync(".").filter(name => name.endsWith("-check.mjs")).sort();
for (const check of checks) {
  const run = spawnSync(process.execPath, [check], {stdio: ["ignore", "pipe", "inherit"], encoding: "utf8"});
  if (run.status !== 0) { console.error(`FAILED ${check}`); process.exit(run.status ?? 1); }
  console.log(`ok ${check}`);
}
console.log(`${checks.length} checks passed`);
