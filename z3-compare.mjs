// Optional Node CLI backend. Source names never enter solver syntax. Each input
// variable ranges over indexes of the exact cut-point partition shared by both editions.
import {spawnSync} from "node:child_process";
import {performance} from "node:perf_hooks";
import {evaluate} from "./contract-language.mjs";

function integer(n) {
  if (!Number.isSafeInteger(n) || n < 0) throw Error("Invalid solver index.");
  return String(n);
}

function queryFor(id, before, after, axes) {
  const terms = [];
  const variables = new Map();
  for (const [i, [name, values]] of axes.entries()) {
    const variable = "x" + i;
    variables.set(name, {variable, values});
    terms.push(`(declare-const ${variable} Int)`,
      `(assert (and (<= 0 ${variable}) (< ${variable} ${integer(values.length)})))`);
  }
  function editionTerm(edition, prefix) {
    const named = new Map();
    function guarantee(name) {
      if (!edition.rules.has(name)) return "false";
      if (named.has(name)) return named.get(name);
      const body = expression(edition.rules.get(name));
      const symbol = prefix + named.size;
      named.set(name, symbol);
      terms.push(`(declare-const ${symbol} Bool)`, `(assert (= ${symbol} ${body}))`);
      return symbol;
    }
    function expression(n) {
      if (n.op === "literal") return String(n.value);
      if (n.op === "and" || n.op === "or") return `(${n.op} ${expression(n.left)} ${expression(n.right)})`;
      if (n.op === "not") return `(not ${expression(n.left)})`;
      if (n.op === "name" && edition.rules.has(n.id)) return guarantee(n.id);
      const {variable, values} = variables.get(n.id);
      if (n.op === "name") return `(= ${variable} 1)`;
      if (n.op !== "compare") throw Error("Unsupported Phaseline expression.");
      // A comparison with a constant is true on one consecutive interval of representatives.
      const matches = values.map(v => {
        switch (n.operator) {
          case "=": return v === n.amount;
          case "<": return v < n.amount;
          case "<=": return v <= n.amount;
          case ">": return v > n.amount;
          case ">=": return v >= n.amount;
          default: throw Error("Unsupported Phaseline comparison.");
        }
      });
      const first = matches.indexOf(true), last = matches.lastIndexOf(true);
      if (first === -1) return "false";
      if (first === 0 && last === values.length - 1) return "true";
      if (first === last) return `(= ${variable} ${integer(first)})`;
      return `(and (<= ${integer(first)} ${variable}) (<= ${variable} ${integer(last)}))`;
    }
    return guarantee(id);
  }
  const left = editionTerm(before, "a"), right = editionTerm(after, "b");
  terms.push(`(assert (distinct ${left} ${right}))`);
  return terms.join("\n");
}

// Create one deadline per complete compare/check, including all named guarantees
// and independent checks of the returned witness.
export function z3Differences() {
  const deadline = performance.now() + 15000;
  function solve(base, suffix) {
    const remaining = Math.floor(deadline - performance.now());
    if (remaining <= 0) throw Error("Z3 comparison exceeded the shared 15-second time allowance.");
    const run = spawnSync("z3", ["-in", "-memory:256"], {encoding:"utf8",
      timeout:remaining, killSignal:"SIGKILL", maxBuffer:1024 * 1024,
      input:`(set-option :timeout ${remaining})\n${base}\n${suffix}\n`});
    if (run.error?.code === "ENOENT") throw Error("Install Z3 on PATH to use --solver z3.");
    if (run.error?.code === "ETIMEDOUT") throw Error("Z3 comparison exceeded the shared 15-second time allowance.");
    if (run.error || run.status !== 0) throw Error("Z3 could not complete the comparison.");
    return run.stdout.trim();
  }

  return function findDifference(id, before, after, axes) {
    if (!axes.length) return evaluate(before,id,{}) === evaluate(after,id,{}) ? undefined : {};
    const base = queryFor(id, before, after, axes);
    const status = solve(base,"(check-sat)");
    if (status === "unsat") return undefined;
    if (status !== "sat") throw Error("Z3 did not settle whether the rules differ.");
    const symbols = axes.map((_, i) => "x" + i);
    const values = `(get-value (${symbols.join(" ")}))`;
    function read(answer) {
      // Only accept the exact expected response; a missing or malformed result is unresolved.
      const output = /^sat\s+\(((?:\s*\(x\d+\s+\d+\)\s*)+)\)$/.exec(answer);
      if (!output) throw Error("Z3 did not return a complete distinguishing assignment.");
      const entries = [...output[1].matchAll(/\((x\d+)\s+(\d+)\)/g)];
      const indexes = new Map(entries.map(([,key,value]) => [key,Number(value)]));
      if (entries.length !== axes.length || indexes.size !== axes.length) throw Error("Incomplete Z3 witness.");
      return indexes;
    }
    // The assignments ordered before this one, with the first axis most significant.
    function earlierThan(indexes) {
      let earlier = "false";
      for (let i = axes.length - 1; i >= 0; i--) {
        const symbol = symbols[i], index = indexes.get(symbol);
        if (!Number.isSafeInteger(index) || index < 0 || index >= axes[i][1].length) throw Error("Invalid Z3 witness index.");
        earlier = `(or (< ${symbol} ${index}) (and (= ${symbol} ${index}) ${earlier}))`;
      }
      return earlier;
    }
    // Descend from any model while an earlier one exists. Each step is an ordinary
    // satisfiability query. A wide rule with one distinguishing assignment is settled
    // by the first certificate; the optimizer remains the bounded fallback.
    let indexes = read(solve(base,`(check-sat)\n${values}`)), certified = false;
    for (let step = 0; step < 6 && !certified; step++) {
      const earlier = earlierThan(indexes), found = solve(base,`(assert ${earlier})\n(check-sat)`);
      if (found === "unsat") certified = true;
      else if (found !== "sat") throw Error("Z3 did not certify the first distinguishing assignment.");
      else indexes = read(solve(base,`(assert ${earlier})\n(check-sat)\n${values}`));
    }
    if (!certified) {
      const objectives = symbols.map(symbol => `(minimize ${symbol})`).join("\n");
      indexes = read(solve(base,`${objectives}\n(check-sat)\n${values}`));
      if (solve(base,`(assert ${earlierThan(indexes)})\n(check-sat)`) !== "unsat")
        throw Error("Z3 did not certify the first distinguishing assignment.");
    }
    const witness = Object.create(null);
    for (const [i, [name, domain]] of axes.entries()) witness[name] = domain[indexes.get(symbols[i])];
    if (evaluate(before,id,witness) === evaluate(after,id,witness)) throw Error("Z3 witness failed evaluator replay.");
    return Object.fromEntries(axes.map(([name]) => [name,witness[name]]));
  };
}
