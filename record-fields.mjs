// A fixed set of accessible observations must separate all pairs with distinct
// future answers. Equivalent or correlated observations are allowed.
import {compileRegime, minimize, witness} from "./retention.mjs";

const exhausted = Symbol("record analysis limit");
const isScalar = v => typeof v === "boolean" || Number.isSafeInteger(v) ||
  (typeof v === "string" && v.length <= 8192);
const boundedName = v => typeof v === "string" && v.length > 0 && v.length <= 128;
function object(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(k => !keys.includes(k))) throw Error("Unknown or invalid record property.");
}
function names(items, max) {
  if (!Array.isArray(items) || items.length > max || items.some(x => !boundedName(x)) ||
      new Set(items).size !== items.length) throw Error("Invalid or duplicate record name.");
}
function values(items, size) {
  if (!Array.isArray(items) || items.length !== size || items.some(x => !isScalar(x)))
    throw Error("Supply every record cell as a string, exact integer, or Boolean.");
}
function meter(terms = {}) {
  object(terms, ["workLimit"]);
  const limit = terms.workLimit ?? 20_000_000;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 100_000_000) throw Error("Invalid record work limit.");
  return {used:0,limit, charge(n) {
    if (n > limit - this.used) throw exhausted;
    this.used += n;
  }};
}
export function regimeTable(source, model) {
  const {rows} = compileRegime(source,model);
  const fields = [...model.observe.map(name => ({name,price:0})),
    ...Object.entries(model.offers).map(([name,price]) => ({name,price}))];
  return {format:"retained-fields/1", basis:"declared", observationBudget:model.budget, fields, questions:model.questions, actions:model.actions,
    rows:rows.map(r => ({id:r.id, values:fields.map(f => r.facts[f.name]), answers:r.answers,
      next:r.successors.map(i => rows[i].id)}))};
}
function prepare(table, charge) {
  object(table, ["format","basis","fields","questions","actions","rows","observationBudget"]);
  if (Object.hasOwn(table,"observationBudget") && (!Number.isSafeInteger(table.observationBudget) || table.observationBudget<0))
    throw Error("Invalid one-time observation budget.");
  const {fields,questions,actions} = table;
  if (table.format !== "retained-fields/1" || !["sample","declared"].includes(table.basis))
    throw Error("Declare retained-fields/1 and sample or declared basis.");
  if (!Array.isArray(fields) || fields.length > 64) throw Error("Supply at most 64 accessible fields.");
  names(fields.map(f => f?.name),64); names(questions,16); names(actions,16);
  if (!questions.length) throw Error("Supply at least one question.");
  for (const field of fields) {
    object(field, ["name","price"]);
    if (!Number.isSafeInteger(field.price) || field.price < 0 || field.price > 1e9)
      throw Error("Each observation needs an exact nonnegative price.");
  }
  if (!Array.isArray(table.rows) || !table.rows.length || table.rows.length > 100_000)
    throw Error("Supply 1 to 100,000 admissible records.");
  const index = new Map();
  for (const [i,r] of table.rows.entries()) {
    charge(1 + fields.length + questions.length + actions.length);
    object(r, ["id","values","answers","next"]);
    if (!boundedName(r.id) || index.has(r.id)) throw Error("Duplicate or invalid record ID.");
    values(r.values,fields.length); values(r.answers,questions.length);
    if (!Array.isArray(r.next) || r.next.length !== actions.length) throw Error("Incomplete action table.");
    index.set(r.id,i);
  }
  const rows = table.rows.map((r,i) => ({...r,index:i,successors:r.next.map(id => {
    if (!index.has(id)) throw Error("Unknown successor record.");
    return index.get(id);
  })}));
  return {rows, fields, quotient:minimize(rows,charge)};
}
const allIndices = fields => fields.map((_,i) => i);
function collision(rows, labels, indices, charge) {
  const seen = new Map();
  for (const r of rows) {
    charge(1 + indices.length);
    const key = JSON.stringify(indices.map(i => r.values[i]));
    const first = seen.get(key);
    if (first === undefined) seen.set(key,r.index);
    else if (labels[first] !== labels[r.index]) return [first,r.index];
  }
  return null;
}
const bit = i => 1n << BigInt(i);
export function retainedFields(table, terms={}) {
  const work = meter(terms);
  const charge = n => work.charge(n);
  let best, solved, explored=0;
  const report = result => ({basis:table.basis,scope:"supplied_histories",...result,
    exploredSelections:explored,work:work.used,workLimit:work.limit});
  try {
    const {rows,fields,quotient} = prepare(table,charge);
    const all = allIndices(fields);
    const pair = collision(rows,quotient.labels,all,charge);
    if (pair) return report({status:"unavailable",witness:witness(rows,table,...pair,charge)});
    best = {price:fields.reduce((sum,f) => sum+f.price,0),indices:all};
    const visited = new Set();
    function search(mask, indices, price) {
      if (price > best.price || (price === best.price && indices.length >= best.indices.length)) return;
      if (visited.has(mask)) return;
      charge(1);
      visited.add(mask); explored++;
      const conflict = collision(rows,quotient.labels,indices,charge);
      if (!conflict) {best = {price,indices};return;}
      const [a,b] = conflict.map(i => rows[i]);
      // Every feasible extension must choose at least one field that separates this pair.
      const choices = all.filter(i => a.values[i] !== b.values[i]);
      choices.sort((x,y) => fields[x].price-fields[y].price || x-y);
      for (const i of choices) search(mask | bit(i), [...indices,i], price+fields[i].price);
    }
    search(0n, [], 0);
    solved = {fields:best.indices.map(i => fields[i].name),minimumPrice:best.price,
      minimumFieldCountAtThatPrice:best.indices.length,futureClasses:quotient.classes.length};
    const necessities = [];
    for (const i of best.indices) {
      const clash = collision(rows,quotient.labels,best.indices.filter(j => j!==i),charge);
      if (!clash) throw Error("Minimum record had a redundant field.");
      necessities.push({without:fields[i].name,witness:witness(rows,table,...clash,charge)});
    }
    const funded = table.observationBudget === undefined ? {} : {
      observationBudget:table.observationBudget, shortfall:Math.max(0,best.price-table.observationBudget)};
    return report({status:funded.shortfall>0?"over_budget":"minimum",...solved,...funded,necessities});
  } catch (error) {
    if (error !== exhausted) throw error;
    // A verified upper bound survives an exhausted optimization or witness search.
    return report({status:"hold",reason:"work_limit",...(best?{feasibleUpperBound:best.price,
      feasibleFields:best.indices.map(i=>table.fields[i].name)}:{})});
  }
}

// Read against exactly recorded tuples. Keeping the complete tuple here is
// deliberate: an unseen history can share a projected empirical signature.
export function recordedReader(table, terms={}) {
  const work=meter(terms), charge=n=>work.charge(n);
  try {
    const {rows,fields,quotient} = prepare(table,charge);
    const groups = new Map();
    for (const r of rows) {
      charge(1+fields.length+table.questions.length);
      const key=JSON.stringify(r.values);
      let g=groups.get(key);
      if (!g) {
        g={first:r,conflict:null,answers:r.answers.map(v=>new Set([v]))};
        groups.set(key,g);
      } else {
        for (const [i,v] of r.answers.entries()) g.answers[i].add(v);
        if (quotient.labels[g.first.index]!==quotient.labels[r.index]) g.conflict ??= r;
      }
    }
    return {
      status:"ready", basis:table.basis, indexWork:work.used,
      get work() { return work.used; },
      read(packet) {
        try {
          charge(1 + fields.length);
          values(packet,fields.length);
          const g = groups.get(JSON.stringify(packet));
          if (!g) return {status:"unseen_record",basis:table.basis};
          charge(table.questions.length);
          return {status:g.conflict?"ambiguous_record":"recorded",basis:table.basis,
            futureClass:g.conflict?null:quotient.labels[g.first.index],
            answers:table.questions.map((q,i)=>({question:q,known:g.answers[i].size===1,
              ...(g.answers[i].size===1?{value:g.answers[i].values().next().value}:{})}))};
        } catch (error) {
          if (error !== exhausted) throw error;
          return {status:"hold",basis:table.basis,reason:"work_limit"};
        }
      }
    };
  } catch (error) {
    if (error!==exhausted) throw error;
    return {status:"hold",basis:table.basis,reason:"work_limit",work:work.used};
  }
}

export function readRecordBatch(table, queries, terms={}) {
  if (!Array.isArray(queries) || queries.length > 100_000) {
    throw Error("Supply up to 100,000 record queries.");
  }
  if (queries.length === 0) return {status:"hold",reason:"no_observations",calls:[]};
  const reader = recordedReader(table,terms);
  if (reader.status !== "ready") return {...reader,requested:queries.length,unprocessed:queries.length,calls:[]};
  const calls=[];
  let recorded=0;
  for (const packet of queries) {
    const call = reader.read(packet);
    calls.push(call);
    if (call.status === "recorded") recorded++;
    if (call.status === "hold") break;
  }
  return {status:recorded === queries.length?"read":"read_with_holds",basis:reader.basis,
    requested:queries.length,recorded,held:queries.length-recorded,unprocessed:queries.length-calls.length,
    indexWork:reader.indexWork,queryWork:reader.work-reader.indexWork,work:reader.work,calls};
}
