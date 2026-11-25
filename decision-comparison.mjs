// An open comparison of ways to decide from incomplete records.
//
//   node decision-comparison.mjs [--cases 400] [--seed 202]
//   node decision-comparison.mjs --write cases.json      write the cases, without answers
//   node decision-comparison.mjs --score answers.json    score [{"id":1,"answer":"release"|"withhold"|"hold"}, ...]
//
// Each case is one rule over yes-or-no facts and the facts that have a usable record.
// The right answer comes from trying every value of the facts without one:
// release if the rule holds for all of them, withhold if for none, otherwise hold.
// Phaseline and SQLite are run. "Default false" is computed by its rule, not by running a policy engine.
import {readFileSync, writeFileSync} from "node:fs";
import {decide} from "./evidence-source.mjs";

function generator(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rule(random, leaves) {
  const wrap = node => random() < 0.25 ? ["not", node] : node;
  if (leaves.length === 1) return wrap(["fact", leaves[0]]);
  const cut = 1 + Math.floor(random() * (leaves.length - 1));
  return wrap([random() < 0.5 ? "and" : "or", rule(random, leaves.slice(0, cut)), rule(random, leaves.slice(cut))]);
}

const text = node => node[0] === "fact" ? node[1] : node[0] === "not" ? "not (" + text(node[1]) + ")"
  : "(" + text(node[1]) + " " + node[0] + " " + text(node[2]) + ")";

function holds(node, value) {
  if (node[0] === "fact") return value(node[1]);
  if (node[0] === "not") return !holds(node[1], value);
  return node[0] === "and" ? holds(node[1], value) && holds(node[2], value) : holds(node[1], value) || holds(node[2], value);
}

// Two to eight facts; about half appear a second time in the rule; 10% to 60% have no usable record.
export function cases(count, seed) {
  const random = generator(seed), list = [];
  for (let id = 1; id <= count; id++) {
    const size = 2 + Math.floor(random() * 7), share = 0.1 + 0.5 * random();
    const facts = Array.from({length: size}, (_, i) => "p" + (i + 1));
    const leaves = [...facts];
    for (let i = Math.max(1, Math.floor(size / 2)); i > 0; i--) leaves.push(facts[Math.floor(random() * size)]);
    const tree = rule(random, leaves.map(f => [random(), f]).sort((x, y) => x[0] - y[0]).map(x => x[1]));
    const known = {}, records = [];
    const row = (fact, value, recorded, by) => ({subject: "s1", at: 5, recorded, source: "s." + fact, by: by ?? "o_" + fact, value});
    for (const fact of facts) {
      const value = random() < 0.5;
      if (random() >= share) { known[fact] = value; records.push(row(fact, value, 5)); continue; }
      const kind = random();
      if (kind < 0.25) records.push(row(fact, true, 5), row(fact, false, 6));   // two records that disagree
      else if (kind < 0.40) records.push(row(fact, value, 5, "someone_else"));  // signed by the wrong party
    }
    list.push({id, facts, rule: text(tree), tree, known, records});
  }
  return list;
}

export function rightAnswer(item) {
  const open = item.facts.filter(f => !Object.hasOwn(item.known, f)), values = {...item.known};
  let yes = false, no = false;
  for (let code = 0; code < 2 ** open.length; code++) {
    open.forEach((fact, i) => { values[fact] = Boolean(code >> i & 1); });
    if (holds(item.tree, f => values[f])) yes = true; else no = true;
  }
  return yes && no ? "hold" : yes ? "release" : "withhold";
}

const phaselineSource = item => item.facts.map(f => "fact " + f + " from s." + f + " owner o_" + f + "\n").join("") + "guarantee act when " + item.rule + "\n";
const phaseline = item => decide(phaselineSource(item), {subject: "s1", at: 5, asOf: 9, records: item.records}).act.status;

// SQLite with NULL for a fact that has no usable record.
const sqlNull = item => "SELECT " + item.rule + " AS answer FROM (SELECT " +
  item.facts.map(f => (Object.hasOwn(item.known, f) ? (item.known[f] ? 1 : 0) : "NULL") + " AS " + f).join(", ") + ")";
// SQLite, written to try both values of every such fact.
const sqlEvery = item => "SELECT min(answer) AS low, max(answer) AS high FROM (SELECT " + item.rule + " AS answer FROM " +
  item.facts.map(f => Object.hasOwn(item.known, f) ? "(SELECT " + (item.known[f] ? 1 : 0) + " AS " + f + ")"
    : "(SELECT 0 AS " + f + " UNION ALL SELECT 1)").join(", ") + ")";
const defaultFalse = item => holds(item.tree, f => item.known[f] === true) ? "release" : "withhold";

const kinds = ["right", "waited when the records were enough", "released when it should not have", "refused when it should have waited"];
function grade(answer, right) {
  return answer === right ? 0 : answer === "hold" ? 1 : answer === "release" ? 2 : 3;
}

async function main(args) {
  const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const count = Number(option("--cases") ?? 400), seed = Number(option("--seed") ?? 202);
  if (!Number.isSafeInteger(count) || count < 1 || count > 100000 || !Number.isSafeInteger(seed)) throw Error("Use --cases 1 to 100000 and a whole-number --seed.");
  const list = cases(count, seed), right = list.map(rightAnswer);
  if (option("--write")) {
    writeFileSync(option("--write"), JSON.stringify(list.map(({id, facts, rule, known, records}) => ({id, facts, rule, known, records})), null, 1));
    console.log("Wrote " + count + " cases to " + option("--write") + ". Score your answers with --score FILE.");
    return;
  }
  const table = {}, add = (name, answers) => {
    const row = Object.fromEntries(kinds.map(k => [k, 0]));
    answers.forEach((answer, i) => row[kinds[grade(answer, right[i])]]++);
    table[name] = row;
  };
  if (option("--score")) {
    const given = new Map(JSON.parse(readFileSync(option("--score"), "utf8")).map(row => [row.id, row.answer]));
    add("your answers", list.map(item => given.get(item.id) ?? "missing"));
  } else {
    add("Phaseline", list.map(phaseline));
    const {DatabaseSync} = await import("node:sqlite"), db = new DatabaseSync(":memory:");
    add("SQLite, NULL for a missing record", list.map(item => {
      const answer = db.prepare(sqlNull(item)).get().answer;
      return answer === null ? "hold" : answer ? "release" : "withhold";
    }));
    add("SQLite, trying every value", list.map(item => {
      const {low, high} = db.prepare(sqlEvery(item)).get();
      return low !== high ? "hold" : low ? "release" : "withhold";
    }));
    add("default false (computed, no engine run)", list.map(defaultFalse));
  }
  console.log(JSON.stringify({cases: count, seed, "right answers": Object.fromEntries(["release", "withhold", "hold"].map(k => [k, right.filter(r => r === k).length])), results: table}, null, 2));
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  process.emitWarning = () => {};
  main(process.argv.slice(2)).catch(error => { console.error(JSON.stringify({status: "hold", reason: error.message})); process.exitCode = 1; });
}
