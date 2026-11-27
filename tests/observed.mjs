// This consumer supplies SQL and grants; it never supplies the expected answers to the checker.
import assert from "node:assert/strict";
import {spawnSync, execFileSync} from "node:child_process";
import {mkdtempSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {createRequire} from "node:module";
import {observeSqlite, observeSqliteViews} from "@verifyrun/phaseline";

const require = createRequire(import.meta.url);
const pkg = require.resolve("@verifyrun/phaseline/package.json");
const cli = join(dirname(pkg), require(pkg).bin.phaseline);
const dir = mkdtempSync(join(tmpdir(), "phaseline-observe-"));
const db = join(dir, "archive.db");
const before = "SELECT id FROM recordings WHERE ready=1";
const after = before + " AND EXISTS (SELECT 1 FROM consent WHERE consent.id=recordings.id AND valid=1)";
const terms = {recipient: "id", budget: 4, grants: {recordings: {id: 1, ready: 1}, consent: {id: 1, valid: 1}}};
function run(first, second, grants = terms, database = db) {
  const paths = ["first.sql", "second.sql", "terms.json"].map(name => join(dir, name));
  [first, second, JSON.stringify(grants)].forEach((v, i) => writeFileSync(paths[i], v));
  const r = spawnSync(process.execPath, [cli, "observe", "sqlite", database, ...paths], {encoding: "utf8"});
  assert.ok([0, 2].includes(r.status), r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(r.status, report.status === "observed" ? 0 : 2);
  if (report.status === "hold") assert.equal("after" in report, false);
  return report;
}
try {
  execFileSync("python3", ["-c", `import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
 db.executescript("create table recordings(id text,ready int,private_note text); create table consent(id text,valid int); insert into recordings values ('A',1,'private'),('B',1,'private'); insert into consent values('A',1);")`, db]);
  const changed = run(before, after);
  assert.deepEqual(changed.before, ["A", "B"]);
  assert.deepEqual(changed.after, ["A"]);
  assert.deepEqual(changed.removed, ["B"]);
  assert.equal(changed.spent, 4);
  assert.deepEqual(changed.newReads, [["consent", "id"], ["consent", "valid"]]);
  const denied = run(before, after, {...terms, grants: {recordings: terms.grants.recordings}});
  assert.equal(denied.reason, "missing_grant");
  assert.equal(denied.need.table, "consent");
  assert.equal(run(before, after, {...terms, budget: 3}).reason, "over_budget");
  assert.equal(run(before, before, {...terms, budget: 2}).status, "observed");
  assert.equal(run(before, "SELECT private_note AS id FROM recordings").reason, "missing_grant");
  assert.equal(run(before, "SELECT id AS other FROM recordings").reason, "recipient_column");
  assert.equal(run(before, "SELECT NULL AS id").reason, "recipient_value");
  assert.equal(run(before, "SELECT NULL AS id WHERE 0").after.length, 0);
  assert.equal(run(before, after, terms, join(dir, "absent")).reason, "source_unavailable");
  assert.equal(run(before, "DELETE FROM recordings").status, "hold");
  assert.deepEqual(run(before, before).after, ["A", "B"]);
  const withViews = {...terms, budget: 9, grants: {...terms.grants,
    sqlite_master: {type: 1, name: 1, sql: 1}, issued: {id: 1}, revised: {id: 1}}};
  const setup = "import sqlite3,sys\nwith sqlite3.connect(sys.argv[1]) as d: d.executescript(sys.argv[2])";
  execFileSync("python3", ["-c", setup, db, "CREATE VIEW issued AS " + before + "; CREATE VIEW revised AS " + after]);
  const installed = observeSqliteViews(db, "issued", "revised", withViews);
  assert.equal(installed.status, "observed", JSON.stringify(installed));
  assert.deepEqual(installed.removed, ["B"]);
  assert.equal(installed.spent, 9);
  const pinned = {...withViews, editionDigests: installed.editions};
  assert.equal(observeSqliteViews(db, "issued", "revised", pinned).status, "observed");
  execFileSync("python3", ["-c", setup, db, "drop view revised; create view revised as " + before]);
  assert.equal(observeSqliteViews(db, "issued", "revised", pinned).reason, "edition_mismatch");
  assert.deepEqual(observeSqliteViews(db, "issued", "revised", withViews).removed, []);
  assert.equal(observeSqliteViews(db, "issued", "other", withViews).reason, "view_unavailable");
  assert.equal(observeSqliteViews(db, "issued", "revised", terms).reason, "missing_grant");
  assert.equal(observeSqliteViews(db, "issued", "revised", {...withViews, recipient: "absent"}).status, "hold");
  assert.throws(() => observeSqlite(db, before, after, {...terms, editionDigests: []}), /digests/);
  console.log("Observed recipients, discovered join, grants, cost, empty result, refusal and unchanged source passed.");
} finally {
  rmSync(dir, {recursive: true, force: true});
}
