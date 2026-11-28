import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";

const [cliPath, oldFile, newFile] = process.argv.slice(2);
const cli = resolve(cliPath);
const history = [];
for (const [i, path] of [oldFile, newFile].entries()) {
  const run = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(run.rich, ["9.11.0","9.12.0"][i]);
  assert.equal(run.parser, "0.9.2");
  for (const [key,ordered] of Object.entries(run.outcomes)) {
    const [spacing, surface] = key.split(":");
    history.push({id: run.rich + "-" + key, facts: {
      revised: i === 1, terminal: surface === "consumer_terminal", spacing: Number(spacing), ordered}});
  }
}
assert.equal(history.length, 12);
const fields = ["revised", "terminal", "spacing", "ordered"];
const rules = fields.map(k => `fact ${k}${k==="spacing"?" in lines":""} from test.${k} owner runner missing hold_dependents`);
const work = mkdtempSync(join(tmpdir(), "markdown-receiver-"));
try {
  writeFileSync(join(work,"rule.phase"), [...rules,"guarantee preserved when ordered"].join("\n"));
  writeFileSync(join(work,"model.json"), JSON.stringify({histories:history}));
  // The measured outcome stays hidden. The reader may ask either remaining input at equal cost.
  for (const [known, other] of [["terminal","revised"],["revised","terminal"]]) {
    writeFileSync(join(work,"observer.phase"), `question preserved\nobserve ${known}\noffer spacing cost 1\noffer ${other} cost 1\nbudget 1`);
    const report = JSON.parse(execFileSync(process.execPath,
      [cli,"analyze","rule.phase","observer.phase","model.json"], {cwd:work, encoding:"utf8"}));
    for (const cell of report.cells) {
      const canAnswer = known === "terminal" ? !cell.observations.terminal : cell.observations.revised;
      if (canAnswer) {
        assert.equal(cell.status,"determined"); assert.equal(cell.answer,true);
      } else {
        assert.equal(cell.status,"inquiry_available"); assert.equal(cell.firstObservation.fact,other);
      }
    }
    console.log(known, report.cells.map(c=>[c.observations,c.firstObservation?.fact ?? c.answer]));
  }
} finally {
  rmSync(work,{recursive:true,force:true});
}
