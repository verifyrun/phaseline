// Run from an ordinary consumer project containing only the installed package.
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {createRequire} from "node:module";
import {compare, decide, gate} from "@verifyrun/phaseline";

const facts = [
  "fact open from archive.open owner archive",
  "fact consent from donor.consent owner donor",
];
const first = [...facts, "guarantee publish when open"].join("\n");
const second = [...facts, "guarantee publish when open and consent"].join("\n");

const packet = {subject: "interview", at: 10, asOf: 12, records: [
  {subject: "interview", at: 10, recorded: 10, source: "archive.open", by: "archive", value: true},
  {subject: "interview", at: 10, recorded: 15, source: "donor.consent", by: "donor", value: true},
]};
const change = compare(first, second);
assert.equal(change.status, "review");
assert.deepEqual(change.changes[0].witness, {open: true, consent: false});
assert.equal(gate(first, packet, "publish"), true);
assert.equal(decide(second, packet).publish.status, "hold");
assert.equal(gate(second, {...packet, asOf: 15}, "publish"), true);
assert.equal(gate(second, packet, "publish"), false);

const states = [
  ["closed_yes", false, true, "open_yes"], ["closed_no", false, false, "open_no"],
  ["open_yes", true, true, "open_yes"], ["open_no", true, false, "open_no"],
].map(([id, open, consent, afterOpening]) => ({id, facts: {open, consent}, next: {open_archive: afterOpening}}));
const model = {questions: ["publish"], actions: ["open_archive"], states,
  observe: ["open"], offers: {consent: 1}, budget: 1};
const dir = mkdtempSync(join(tmpdir(), "archive-contract-"));
const require = createRequire(import.meta.url);
const manifest = require.resolve("@verifyrun/phaseline/package.json");
const cli = join(dirname(manifest), require(manifest).bin.phaseline);
let report;
try {
  writeFileSync(join(dir, "first.phase"), first);
  writeFileSync(join(dir, "second.phase"), second);
  writeFileSync(join(dir, "archive.json"), JSON.stringify(model));
  const args = [cli, "retain", "first.phase", "archive.json", "second.phase"];
  const run = args => JSON.parse(execFileSync(process.execPath, args, {cwd: dir, encoding: "utf8"}));
  report = run(args);
  writeFileSync(join(dir, "archive.json"), JSON.stringify({...model, budget: 0}));
  assert.equal(run(args).migration.recovery.status, "over_budget");
  writeFileSync(join(dir, "case.json"), JSON.stringify(packet));
  assert.equal(run([cli, "decide", "second.phase", "case.json"]).publish.status, "hold");
} finally {
  rmSync(dir, {recursive: true, force: true});
}
const together = (edition, left, right) => edition.classes.some(c => c.histories.includes(left) && c.histories.includes(right));
assert.equal(together(report.issued, "closed_yes", "closed_no"), true);
assert.equal(together(report.proposed, "closed_yes", "closed_no"), false);
assert.equal(report.migration.extraFixedWidthBits, 1);
assert.equal(report.migration.recovery.worstCaseObservationCost, 1);
console.log("Outside consumer passed: original decision, revised hold, late evidence, historical replay, future distinction and cost.");
