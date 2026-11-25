// Determine what a specified observer can learn on an explicitly supplied finite model.
import { readEdition, evaluate, validObservation } from "./contract-language.mjs";

import {groupBy, observationPlanner} from "./observation-plan.mjs";

// Edition rules define outcomes; a separately versioned observer declares access.
function readObserver(text) {
  if (typeof text !== "string" || text.length > 10000) throw Error("Supply the observer program (up to 10,000 characters).");
  const observer = { offers:Object.create(null) };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let match;
    if ((match = /^question ([a-z][a-z0-9_]*)$/.exec(line)) && !Object.hasOwn(observer,"question")) observer.question = match[1];
    else if ((match = /^observe ([a-z][a-z0-9_]*(?:\s*,\s*[a-z][a-z0-9_]*)*)$/.exec(line)) && !Object.hasOwn(observer,"observed"))
      observer.observed = match[1] === "none" ? [] : match[1].split(/\s*,\s*/);
    else if ((match = /^offer ([a-z][a-z0-9_]*) cost (\d+)$/.exec(line)) && !Object.hasOwn(observer.offers,match[1])) observer.offers[match[1]] = Number(match[2]);
    else if ((match = /^budget (\d+)$/.exec(line)) && !Object.hasOwn(observer,"budget")) observer.budget = Number(match[1]);
    else throw Error("Invalid or duplicate observer declaration: "+line);
  }
  return observer;
}

export function analyze(source, observerSource, model) {
  const inquiry = readObserver(observerSource);
  const edition = readEdition(source);
  if (!inquiry || !edition.rules.has(inquiry.question)) throw Error("Name a declared guarantee as the question.");
  const { question, observed, offers, budget } = inquiry;
  const histories = model?.histories;
  if (!model || Object.keys(model).some(key => key !== "histories")) throw Error("Put only histories in the model; declare observation access in the observer program.");
  if (!Array.isArray(histories) || !histories.length || histories.length > 128)
    throw Error("Supply 1–128 possible histories.");
  if (!Array.isArray(observed) || new Set(observed).size !== observed.length ||
      !offers || typeof offers !== "object" || Array.isArray(offers) || Object.keys(offers).length > 12 ||
      !Number.isSafeInteger(budget) || budget < 0) throw Error("Supply distinct observed fields, up to 12 priced offers and a nonnegative integer budget.");
  const candidates = Object.entries(offers);
  for (const [name, cost] of candidates) {
    if (observed.includes(name) || !Number.isSafeInteger(cost) || cost < 1 || cost > 1_000_000_000)
      throw Error("Each offer needs an unobserved field and an integer price of 1–1,000,000,000 units.");
  }
  const needed = new Set([...edition.dependencies.get(question).keys(), ...observed, ...Object.keys(offers)]);
  for (const name of needed) if (!edition.bindings.has(name)) throw Error("Declare the fact and evidence binding for "+name);
  const ids = new Set();
  const rows = histories.map((history, index) => {
    if (!history || typeof history.id !== "string" || !history.id.trim() || ids.has(history.id) ||
        !history.facts || typeof history.facts !== "object" || Array.isArray(history.facts)) throw Error("Each history needs a unique name and a fact map.");
    ids.add(history.id);
    for (const name of Object.keys(history.facts)) if (!edition.bindings.has(name)) throw Error("Undeclared history field "+name);
    for (const name of new Set([...needed, ...Object.keys(history.facts)])) {
      if (!Object.hasOwn(history.facts, name) || !validObservation(name, edition.bindings.get(name), history.facts[name]))
        throw Error("History "+history.id+" needs a valid value for "+name);
    }
    return { index, id:history.id, facts:history.facts, answer:evaluate(edition, question, history.facts) };
  });
  const view = (row, fields) => Object.fromEntries(fields.map(name => [name,row.facts[name]]));
  const {plan, memo} = observationPlanner(candidates);
  const cells = [];
  for (const members of groupBy(rows, row => JSON.stringify(view(row,observed))).values()) {
    const first = members[0];
    const cell = { observations:view(first,observed), histories:members.map(row=>row.id) };
    const best = plan(members);
    if (best.cost === 0) {
      cells.push({...cell, status:"determined", answer:first.answer, worstCaseCost:0});
      continue;
    }
    // For impossibility, exhibit two histories equal even on every offered measurement.
    const fields = Number.isFinite(best.cost) ? observed : [...observed,...Object.keys(offers)];
    const groups = groupBy(members,row=>JSON.stringify(view(row,fields)));
    let witness;
    for (const group of groups.values()) {
      const other = group.find(row=>row.answer !== group[0].answer);
      if (other) { witness=[group[0],other].map(row=>({history:row.id,answer:row.answer})); break; }
    }
    if (!witness) throw Error("Missing witness for an unresolved question.");
    if (!Number.isFinite(best.cost)) cells.push({...cell,status:"indistinguishable",witness,equalOn:fields,worstCaseCost:null});
    else cells.push({...cell,status:best.cost<=budget?"inquiry_available":"over_budget",witness,
      worstCaseCost:best.cost,firstObservation:{fact:best.fact,...edition.bindings.get(best.fact),cost:offers[best.fact]}});
  }
  return { scope:"supplied_histories_and_observation_offers", question, budget, historiesChecked:rows.length, planningStates:memo.size, cells };
}
