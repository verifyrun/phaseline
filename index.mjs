// The library entry: import {decide, gate, compare, serve} from "@verifyrun/phaseline".
import {compareContracts, decide} from "./evidence-source.mjs";
export {decide};
export {serve} from "./serve.mjs";

// True only when the named guarantee is released for this case. Held and withheld are both false.
export function gate(rules, subjectCase, guarantee) {
  const actions = decide(rules, subjectCase);
  if (!Object.hasOwn(actions, guarantee)) throw Error("Name a declared guarantee: " + guarantee);
  return actions[guarantee].status === "release";
}

// What a rule edit changes, with an example input for each changed guarantee.
export function compare(oldRules, newRules) {
  const {result, bindings} = compareContracts(oldRules, newRules);
  return {status: result.changes.length || bindings.length ? "review" : "preserved", changes: result.changes, bindings};
}
export {inquireOutput} from "./output-inquiry.mjs";
