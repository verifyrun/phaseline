// Strong planning with a priced observation interface and adversarial service outcomes.
import {readSystem, observation} from "./knowledge.mjs";
import {CostFrontier} from "./priced-machines.mjs";

const maxBeliefs = 8192;
const maxSteps = 500000;
class SearchLimit extends Error {}

function configuration(task, model, system) {
  const fields = (value, names) => value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every(name => names.includes(name));
  if (!fields(task, ["goal", "safe", "settle", "commands"])) throw Error("Invalid control task.");
  const question = name => {
    const index = model.questions.indexOf(name);
    if (index < 0) throw Error("Name a declared regime question: " + name);
    return index;
  };
  const goal = question(task.goal);
  const safe = Object.hasOwn(task, "safe") ? question(task.safe) : null;
  const settle = task.settle ?? [];
  if (!Array.isArray(settle) || new Set(settle).size !== settle.length) throw Error("Invalid terminal questions.");
  const terminal = settle.map(question);
  const specs = task.commands;
  if (!specs || typeof specs !== "object" || Array.isArray(specs) || Object.keys(specs).length > 32)
    throw Error("Supply up to 32 commands with their costs and possible effects.");
  const commands = Object.entries(specs).map(([name, spec]) => {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(name) || !fields(spec, ["cost", "effects", "requires"])
        || !Number.isSafeInteger(spec.cost) || spec.cost < 1 || spec.cost > 1e9
        || !Array.isArray(spec.effects) || !spec.effects.length || new Set(spec.effects).size !== spec.effects.length
        || !spec.effects.every(effect => system.regime.actions.includes(effect))) throw Error("Invalid command " + name);
    return {name, cost:spec.cost, effects:new Set(spec.effects),
      requires:Object.hasOwn(spec, "requires") ? question(spec.requires) : null};
  });
  return {goal, safe, terminal, settle, commands};
}

function construct(system, {goal, safe, terminal, settle, commands}, pay) {
  const {rows, view, moves, initial, grants, edition} = system;
  const observed = rows.map(row => observation(row, view));
  const allowedState = index => safe === null || rows[index].answers[safe];
  const indexByKey = new Map();
  const nodes = [];
  let steps = 0;
  const meter = (count = 1) => {
    pay(count);
    steps += count;
    if (steps > maxSteps) throw new SearchLimit("transition work limit");
  };

  function intern(indices) {
    pay(1 + indices.length);
    const states = [...new Set(indices)].sort((a,b) => a-b);
    const key = states.join(",");
    if (indexByKey.has(key)) return indexByKey.get(key);
    if (nodes.length === maxBeliefs) throw new SearchLimit("belief limit");
    const id = nodes.length;
    indexByKey.set(key, id);
    nodes.push({states, choices:[], blocked:[], parents:[], value:Infinity});
    return id;
  }

  function branches(emissions) {
    pay(1 + emissions.length);
    const groups = new Map();
    for (const {output, state} of emissions) {
      const key = JSON.stringify(output);
      if (!groups.has(key)) groups.set(key, {output, states:[]});
      groups.get(key).states.push(state);
    }
    return Array.from(groups.values(), part => ({output:part.output, to:intern(part.states)}));
  }

  function option(parent, op, fee, responses) {
    if (!responses.length) throw Error("Empty control outcome.");
    pay(1 + responses.length);
    const children = new Set(responses.map(r => r.to));
    const choice = {parent, op, cost:fee, responses, pending:children.size, worst:0};
    nodes[parent].choices.push(choice);
    for (const child of children) nodes[child].parents.push(choice);
  }

  const roots = branches(initial.map(state => ({state, output:observed[state]})));
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i], states = node.states;
    if (!states.every(allowedState)) {
      node.blocked.push({reason:"the safety condition already fails in a possible history"});
      continue;
    }
    if (states.every(state => rows[state].answers[goal]) &&
        terminal.every(q => states.every(state => rows[state].answers[q] === rows[states[0]].answers[q]))) {
      node.answer = Object.fromEntries(settle.map((name, j) => [name, rows[states[0]].answers[terminal[j]]]));
      continue;
    }
    for (const [fact, grant] of grants) {
      meter(states.length);
      const op = {read:fact, source:edition.bindings.get(fact).source};
      if (!states.every(state => grant.allowed[state])) {
        node.blocked.push({...op, reason:"read grant unresolved"});
        continue;
      }
      const responses = branches(states.map(state => ({state, output:rows[state].facts[fact]})));
      if (responses.length > 1) option(i, op, grant.price, responses);
      else node.blocked.push({...op, reason:"all remaining histories return the same value"});
    }
    for (const cmd of commands) {
      const op = {command:cmd.name};
      if (cmd.requires !== null && !states.every(state => rows[state].answers[cmd.requires])) {
        node.blocked.push({...op, reason:"command grant unresolved"});
        continue;
      }
      const outcomes = [];
      let obstruction;
      for (const state of states) {
        meter(1 + moves[state].length);
        const exits = moves[state].filter(edge => cmd.effects.has(edge.action));
        if (!exits.length) { obstruction = {reason:"command unavailable", history:rows[state].id}; break; }
        const unsafe = exits.find(edge => !allowedState(edge.to));
        if (unsafe) {
          obstruction = {reason:"possible unsafe effect", history:rows[state].id, successor:rows[unsafe.to].id};
          break;
        }
        for (const edge of exits) outcomes.push({state:edge.to, output:{signal:edge.signal, observe:observed[edge.to]}});
      }
      if (obstruction) node.blocked.push({...op, ...obstruction});
      else option(i, op, cmd.cost, branches(outcomes));
    }
  }
  return {nodes, roots, steps};
}

// A command becomes a feasible candidate only after all of its distinct
// observable children have finite values. Positive costs allow label setting.
export function settleValues(nodes, pay) {
  pay(nodes.length);
  const frontier = new CostFrontier();
  for (const [id, node] of nodes.entries()) {
    if (node.answer !== undefined) frontier.push({id, cost:0});
  }
  while (frontier.nodes.length) {
    pay(1);
    const best = frontier.pop(), node = nodes[best.id];
    if (Number.isFinite(node.value)) continue;
    node.value = best.cost;
    node.choice = best.choice;
    pay(node.parents.length);
    for (const choice of node.parents) {
      choice.worst = Math.max(choice.worst, best.cost);
      if (--choice.pending === 0 && !Number.isFinite(nodes[choice.parent].value))
        frontier.push({id:choice.parent, cost:choice.cost + choice.worst, choice});
    }
  }
}

// Check both sides of the cost certificate against every admitted choice.
export function checkValues(nodes, pay) {
  for (const node of nodes) {
    pay(1);
    if (node.answer !== undefined) {
      if (node.value !== 0) throw Error("Terminal belief has nonzero cost.");
      continue;
    }
    let minimum = Infinity;
    for (const choice of node.choices) {
      pay(1 + choice.responses.length);
      let worst = 0;
      for (const branch of choice.responses) worst = Math.max(worst, nodes[branch.to].value);
      const price = choice.cost + worst;
      minimum = Math.min(minimum, price);
      if (choice === node.choice && price !== node.value) throw Error("Policy does not attain its claimed cost.");
    }
    if (node.value !== minimum || (Number.isFinite(minimum) && !node.choice))
      throw Error("A public outcome invalidates the computed cost certificate.");
  }
}

function losingCertificate(nodes, roots, rows, pay) {
  const indices = new Map(), queue = [];
  function add(id) {
    if (!indices.has(id)) { indices.set(id, queue.length); queue.push(id); }
    return indices.get(id);
  }
  const initial = roots.filter(b => !Number.isFinite(nodes[b.to].value)).map(b => ({output:b.output,to:add(b.to)}));
  const beliefs = [];
  for (const id of queue) {
    const node = nodes[id];
    pay(1 + node.states.length + node.choices.length + node.blocked.length);
    const counterOutcomes = node.choices.map(choice => {
      pay(choice.responses.length);
      const next = choice.responses.find(r => !Number.isFinite(nodes[r.to].value));
      return {...choice.op, output:next.output, to:add(next.to)};
    });
    beliefs.push({histories:node.states.map(i => rows[i].id), blocked:node.blocked, counterOutcomes});
  }
  return {initial, beliefs};
}

function policy(nodes, roots, pay) {
  const ids = new Map(), queue = [];
  function add(idx) {
    if (!ids.has(idx)) { ids.set(idx, queue.length); queue.push(idx); }
    return ids.get(idx);
  }
  const link = r => ({output:r.output, to:add(r.to)});
  const initial = roots.map(link);
  const actions = [];
  for (const id of queue) {
    const node = nodes[id], choice = node.choice;
    pay(1 + (choice?.responses.length ?? 0));
    actions.push(choice ? {operation:choice.op, cost:choice.cost, worstCaseRemaining:node.value,
      branches:choice.responses.map(link)} : {operation:{finish:true}, answers:node.answer, worstCaseRemaining:0});
  }
  return {initial, nodes:actions};
}

export function planControl(source, system, actor, task, workAllowance = Infinity) {
  const model = readSystem(source, system, actor);
  const settings = configuration(task, model, system);
  const scope = {scope:"declared_finite_strong_control", actor, goal:task.goal, budget:model.view.budget};
  let work = 0;
  const pay = count => {
    if (count > workAllowance-work) throw new SearchLimit("prepaid search allowance exhausted");
    work += count;
  };
  try {
    const {nodes, roots, steps} = construct(model, settings, pay);
    settleValues(nodes, pay);
    checkValues(nodes, pay);
    const cost = Math.max(...roots.map(branch => nodes[branch.to].value));
    const stats = {reachableBeliefs:nodes.length, transitionWork:steps, costCertificateChecked:true};
    let result;
    if (!Number.isFinite(cost)) {
      result={status:"unachievable", minimumWorstCaseCost:null,
        obstruction:losingCertificate(nodes, roots, model.rows, pay)};
    } else if (cost > model.view.budget) {
      result={status:"over_budget", minimumWorstCaseCost:cost};
    } else {
      result={status:"within_budget", minimumWorstCaseCost:cost, policy:policy(nodes, roots, pay)};
    }
    return {...scope, ...stats, ...result, meteredWork:work};
  } catch (error) {
    if (!(error instanceof SearchLimit)) throw error;
    return {...scope, status:"hold", reason:error.message, minimumWorstCaseCost:null, meteredWork:work};
  }
}
