// Exact for an enumerated, total deterministic regime. The analyst can read
// the supplied model. The encoder can read only its declared observations.
import {readEdition, evaluate, validObservation} from "./contract-language.mjs";
import {symbolicRetain,symbolicChallenge} from "./symbolic-retention.mjs";
import {groupBy, observationPlanner} from "./observation-plan.mjs";

const isMap = value => value !== null && typeof value === "object" && !Array.isArray(value);
function keys(value, allowed, label) {
  if (!isMap(value) || Object.keys(value).some(k => !allowed.includes(k))) throw Error("Unknown or invalid "+label+" field.");
}
function names(values, limit, label) {
  if (!Array.isArray(values) || values.length > limit ||
      values.some(v => typeof v !== "string" || !/^[a-z][a-z0-9_]{0,39}$/.test(v)) ||
      new Set(values).size !== values.length) throw Error("Invalid or duplicate "+label+" name.");
}
export function compileRegime(source, model) {
  const edition = readEdition(source);
  const {questions, actions, observe, states, offers, budget} = model;
  keys(model, ["questions","actions","observe","states","offers","budget"], "regime");
  names(questions,16,"question"); names(actions,16,"action"); names(observe,64,"observation");
  if (!questions.length || questions.some(q => !edition.rules.has(q))) throw Error("Name at least one declared guarantee.");
  if (!isMap(offers)) throw Error("Declare priced offers, or use an empty object.");
  names(Object.keys(offers),12,"offer");
  for (const [key, cost] of Object.entries(offers)) {
    if (observe.includes(key) || !Number.isSafeInteger(cost) || cost < 1 || cost > 1e9) throw Error("Invalid price or already observed field: "+key);
  }
  if (!Number.isSafeInteger(budget) || budget < 0) throw Error("Supply a nonnegative observation budget.");
  if (!Array.isArray(states) || !states.length || states.length > 128) throw Error("Supply 1–128 admissible states.");
  const required = new Set([...observe,...Object.keys(offers),...questions.flatMap(q => [...edition.dependencies.get(q).keys()])]);
  for (const key of required) if (!edition.bindings.has(key)) throw Error("Declare an evidence source for "+key);
  const index = new Map();
  for (const [i, state] of states.entries()) {
    keys(state, ["id","facts","next"], "state");
    if (typeof state.id !== "string" || !state.id.trim() || state.id.length > 80 || index.has(state.id)) throw Error("State IDs must be distinct names of 1–80 characters.");
    index.set(state.id,i);
  }
  const rows = states.map((state,i) => {
    const {id,facts,next} = state;
    if (!isMap(facts)) throw Error("Supply a fact map for "+id);
    for (const key of new Set([...Object.keys(facts),...required])) {
      const binding = edition.bindings.get(key);
      if (!binding || !Object.hasOwn(facts,key) || !validObservation(key,binding,facts[key])) throw Error("Missing or invalid fact "+key+" in "+id);
    }
    keys(next,actions,"transition");
    const successors = actions.map(action => {
      if (!Object.hasOwn(next,action) || !index.has(next[action])) throw Error("Missing destination for "+id+" / "+action);
      return index.get(next[action]);
    });
    const cache = new Map();
    return {id,index:i,facts,successors,answers:questions.map(q => evaluate(edition,q,facts,cache))};
  });
  return {rows,edition};
}
function assign(signatures) {
  const unique = new Map();
  return signatures.map(signature => {
    const key = JSON.stringify(signature);
    if (!unique.has(key)) unique.set(key,unique.size);
    return unique.get(key);
  });
}
export function minimize(rows, charge = () => {}) {
  charge(rows.length);
  let labels = assign(rows.map(r => r.answers));
  let passes = 0;
  while (true) {
    charge(rows.length * (1 + rows[0].successors.length));
    const refined = assign(rows.map(r => [labels[r.index], ...r.successors.map(i => labels[i])]));
    passes++;
    if (refined.every((code,i) => code === labels[i])) break;
    labels = refined;
  }
  const classes = [...groupBy(rows,r => labels[r.index]).values()].map(group => ({
    code:labels[group[0].index], histories:group.map(r => r.id), answers:group[0].answers,
    next:group[0].successors.map(i => labels[i])
  }));
  return {labels,classes,passes};
}
// Product-graph BFS returns a shortest experiment that exposes a difference.
export function witness(rows, model, left, right, charge = () => {}) {
  const queue = [{left,right,parent:-1}], seen = new Set([left+","+right]);
  for (let head=0; head<queue.length; head++) {
    charge(1 + model.actions.length + model.questions.length);
    const pair = queue[head], a = rows[pair.left], b = rows[pair.right];
    const q = a.answers.findIndex((answer,i) => answer !== b.answers[i]);
    if (q !== -1) {
      const after = [];
      for (let p=pair; p.parent !== -1; p=queue[p.parent]) after.push(p.action);
      return {histories:[rows[left].id,rows[right].id], after:after.reverse(), question:model.questions[q], answers:[a.answers[q],b.answers[q]]};
    }
    for (const [j,action] of model.actions.entries()) {
      const x = a.successors[j], y = b.successors[j], key = x+","+y;
      if (x !== y && !seen.has(key)) {seen.add(key);queue.push({left:x,right:y,parent:head,action});}
    }
  }
  throw Error("Could not reproduce the distinguishing experiment.");
}
const bits = count => Math.ceil(Math.log2(count));
function encoder(rows, quotient, model) {
  const entries = [];
  for (const group of groupBy(rows,r => JSON.stringify(model.observe.map(k => r.facts[k]))).values()) {
    const a = group[0], code = quotient.labels[a.index];
    const other = group.find(r => quotient.labels[r.index] !== code);
    const observations = Object.fromEntries(model.observe.map(k => [k,a.facts[k]]));
    if (other) return {status:"unavailable_from_snapshot",observations,witness:witness(rows,model,a.index,other.index)};
    entries.push({observations,code});
  }
  return {status:"encodable",entries};
}
function describe(rows, quotient, model) {
  return {classes:quotient.classes, fixedWidthBits:bits(quotient.classes.length), refinementPasses:quotient.passes, encoder:encoder(rows,quotient,model)};
}
function migrate(rows, old, revised, model, edition) {
  const blocks = [...groupBy(rows,r => old.labels[r.index]).values()];
  const decoder = blocks.map(block => [...new Set(block.map(r => revised.labels[r.index]))]);
  const split = blocks.find((block,i) => decoder[i].length > 1);
  const a = split?.[0], b = split?.find(row => revised.labels[row.index] !== revised.labels[a.index]);
  const {plan,memo} = observationPlanner(Object.entries(model.offers));
  const groups = groupBy(rows,r => JSON.stringify([old.labels[r.index],...model.observe.map(k => r.facts[k])]));
  // Reconstruct the funded policy. Its branches use only actual offered
  // measurements; row IDs never appear in an executable decision.
  function strategy(subset) {
    const best = plan(subset);
    if (best.cost === 0) return {code:subset[0].answer};
    const fact = best.fact;
    return {read:fact, ...edition.bindings.get(fact), cost:model.offers[fact],
      branches:[...groupBy(subset,r => r.facts[fact])].map(([value,part]) => ({value,then:strategy(part)}))};
  }
  const cells = [];
  for (const group of groups.values()) {
    const first = group[0];
    const targets = group.map(r => ({...r,answer:revised.labels[r.index]}));
    const best = plan(targets);
    const observations = Object.fromEntries(model.observe.map(k => [k,first.facts[k]]));
    const cell = {oldCode:old.labels[first.index], observations, cost:Number.isFinite(best.cost)?best.cost:null};
    if (best.cost === 0) cell.revisedCode = revised.labels[first.index];
    else if (Number.isFinite(best.cost)) cell.firstObservation = best.fact;
    else {
      for (const same of groupBy(group,r => JSON.stringify(Object.keys(model.offers).map(k => r.facts[k]))).values()) {
        const other = same.find(r => revised.labels[r.index] !== revised.labels[same[0].index]);
        if (other) {cell.witness=witness(rows,model,same[0].index,other.index);break;}
      }
    }
    if (best.cost <= model.budget) cell.strategy = strategy(targets);
    cells.push(cell);
  }
  const costs = cells.map(c => c.cost);
  const cost = costs.includes(null)?null:Math.max(...costs);
  return {basis:"conditional_on_an_obtained_issued_code",status:split?"old_code_insufficient":"old_code_suffices",
    extraFixedWidthBits:bits(Math.max(...decoder.map(row => row.length))), decoder,
    ...(split?{witness:witness(rows,model,a.index,b.index)}:{}),
    recovery:{status:cost === null?"unavailable":cost > model.budget?"over_budget":"within_budget",
      worstCaseObservationCost:cost,planningStates:memo.size,cells}};
}
export function retain(source, model, proposed) {
  if(model?.form==="finite-variables/1") return symbolicRetain(source,model,proposed);
  const initial = compileRegime(source,model);
  const old = minimize(initial.rows);
  const result = {scope:"declared_finite_deterministic_regime",states:model.states.length,
    questions:model.questions,actions:model.actions,observe:model.observe,budget:model.budget,
    issued:describe(initial.rows,old,model)};
  if (proposed !== undefined) {
    const revised = compileRegime(proposed,model);
    for (const field of new Set(model.states.flatMap(state => Object.keys(state.facts)))) {
      if (JSON.stringify(initial.edition.bindings.get(field)) !== JSON.stringify(revised.edition.bindings.get(field)))
        throw Error("Evidence binding changed for "+field+". Supply a separately justified observation translation.");
    }
    const quotient = minimize(revised.rows);
    result.proposed = describe(revised.rows,quotient,model);
    result.migration = migrate(revised.rows,old,quotient,model,revised.edition);
  }
  return result;
}

// A trace is supplied separately. Omitted truth values stay unknown.
export function challenge(source, model, trace) {
  if(model?.form==="finite-variables/1") return symbolicChallenge(source,model,trace);
  const {edition,rows} = compileRegime(source,model);
  keys(trace,["steps"],"trace");
  if (!Array.isArray(trace.steps) || !trace.steps.length || trace.steps.length > 256) throw Error("Supply 1–256 trace steps.");
  for (const [i,step] of trace.steps.entries()) {
    keys(step,i===0?["observe","answers"]:["action","observe","answers"],"step");
    keys(step.observe,model.observe,"trace observation");
    keys(step.answers,model.questions,"trace answer");
    if ((i && !model.actions.includes(step.action)) || (!Object.keys(step.observe).length && !Object.keys(step.answers).length))
      throw Error("Each step needs evidence and each later step needs a declared action.");
    for (const [fact,value] of Object.entries(step.observe))
      if (!validObservation(fact,edition.bindings.get(fact),value)) throw Error("Invalid recorded observation for "+fact);
    for (const answer of Object.values(step.answers)) if (typeof answer!=="boolean") throw Error("Record a Boolean outcome or omit it.");
  }
  let candidates = rows;
  for (const [i,step] of trace.steps.entries()) {
    if (i) {
      const action = model.actions.indexOf(step.action);
      candidates = [...new Set(candidates.map(row=>rows[row.successors[action]]))];
    }
    const fits = candidates.filter(row => Object.entries(step.observe).every(([k,v]) => row.facts[k]===v) &&
      Object.entries(step.answers).every(([k,v])=>row.answers[model.questions.indexOf(k)]===v));
    if (!fits.length) return {scope:"supplied_trace",status:"inconsistent",firstIncompatibleStep:i,
      recorded:step, possibilitiesBeforeReading:candidates.map(row=>({id:row.id,
        observations:Object.fromEntries(Object.keys(step.observe).map(k=>[k,row.facts[k]])),
        answers:Object.fromEntries(Object.keys(step.answers).map(k=>[k,row.answers[model.questions.indexOf(k)]]))}))};
    candidates = fits;
  }
  return {scope:"supplied_trace",status:"consistent",steps:trace.steps.length,remainingStates:candidates.map(row=>row.id)};
}
