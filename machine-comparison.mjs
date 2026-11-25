// Compare declared deterministic input/output behavior from each edition's own origin.
// Missing observations stay unknown. A declared unavailable operation has no outgoing edge.
import {canonical} from "./carry.mjs";

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const named = value => typeof value === "string" && value.length > 0;
const own = (value, key) => Object.hasOwn(value,key);
const MAX_STATES = 100000, MAX_INPUTS = 10000, MAX_EDGES = 1000000;

function keys(value, permitted, description) {
  if (!object(value) || Object.keys(value).some(key => !permitted.includes(key)))
    throw Error("Invalid " + description + ". Supported fields: " + permitted.join(", "));
}

function checkOutput(value, depth=0) {
  if (depth > 64) throw Error("Receiver output exceeds 64 levels of nesting.");
  if (value === null || typeof value === "boolean" || typeof value === "string" || Number.isSafeInteger(value)) return;
  if (Array.isArray(value) || object(value)) {
    for (const item of Object.values(value)) checkOutput(item,depth+1);
  } else throw Error("Use strings, Booleans, exact integers, null, lists or records for receiver outputs.");
}

export function readMachine(model, priced=false) {
  const fields=["format","initial","initialReply","inputs","missing","states"];
  if (priced) fields.push("onExhaustion");
  keys(model,fields,"transition edition");
  if (priced && !["keep","consume"].includes(model.onExhaustion)) throw Error("Select keep or consume for the remaining balance after exhaustion.");
  if (model.format !== (priced?"phaseline.priced-transducer/1":"phaseline.transducer/1") || !named(model.initial) ||
      !["unavailable","unobserved"].includes(model.missing)) throw Error("Declare a transition edition, initial state and missing-edge semantics.");
  if (!Array.isArray(model.inputs) || model.inputs.length > MAX_INPUTS || model.inputs.some(name => !named(name)) ||
      new Set(model.inputs).size !== model.inputs.length) throw Error("Declare distinct input names within the supported limit.");
  if (!Array.isArray(model.states) || !model.states.length || model.states.length > MAX_STATES) throw Error("Declare 1–100000 states.");
  if (own(model,"initialReply")) checkOutput(model.initialReply);
  const ids = new Map(), inputs = new Set(model.inputs);
  for (const row of model.states) {
    keys(row,["id","edges"],"transition state");
    if (!named(row.id) || ids.has(row.id) || !Array.isArray(row.edges)) throw Error("Declare each state and its edges exactly once.");
    ids.set(row.id,ids.size);
  }
  if (!ids.has(model.initial)) throw Error("The declared initial state is absent.");
  let count = 0;
  const cheapest=[];
  const table = model.states.map(row => {
    const edges = new Map();
    let leastCost=null;
    for (const edge of row.edges) {
      keys(edge,priced?["input","to","output","work"]:["input","to","output"],"transition");
      if (priced && (!Number.isSafeInteger(edge.work) || edge.work<1)) throw Error("Every priced edge needs a positive exact work charge.");
      if (!inputs.has(edge.input) || !ids.has(edge.to) || edges.has(edge.input) || !own(edge,"output"))
        throw Error("Each edge needs a declared input, a unique deterministic successor and an observed output.");
      if (++count > MAX_EDGES) throw Error("Transition edition exceeds one million edges.");
      checkOutput(edge.output);
      const entry={to:ids.get(edge.to),out:edge.output,key:JSON.stringify(canonical(edge.output))};
      if (priced) {
        entry.work=BigInt(edge.work);
        if (!leastCost || entry.work<leastCost.work) leastCost={input:edge.input,work:entry.work};
      }
      edges.set(edge.input,entry);
    }
    if (priced) cheapest.push(leastCost);
    return edges;
  });
  return {model, inputs, table, cheapest, start:ids.get(model.initial)};
}

function describe(edge) {
  return edge ? {enabled:true,output:edge.out} : {enabled:false};
}

export function compareMachines(oldEdition, newEdition, {maxPairs=200000,maxSteps=2000000}={}) {
  if (!Number.isSafeInteger(maxPairs) || maxPairs<1 || maxPairs>200000 ||
      !Number.isSafeInteger(maxSteps) || maxSteps<1 || maxSteps>2000000) throw Error("Invalid finite comparison work limit.");
  const a = readMachine(oldEdition), b = readMachine(newEdition);
  const inputs = Array.from(new Set([...a.inputs,...b.inputs])).sort();
  const alphabet = {added:[...b.inputs].filter(i=>!a.inputs.has(i)).sort(),removed:[...a.inputs].filter(i=>!b.inputs.has(i)).sort()};
  const queue = [{a:a.start,b:b.start,parent:-1,input:null}];
  const key = (x,y) => x*b.table.length+y;
  const reached = new Set([key(a.start,b.start)]);
  let steps=0, firstUnknown=null;
  const report = (status,details={}) => ({status,alphabet,pairsReached:reached.size,inputsExamined:steps,...details});
  function word(index, last) {
    const result = last===undefined ? [] : [last];
    while (queue[index].parent !== -1) {
      result.push(queue[index].input);
      index=queue[index].parent;
    }
    return result.reverse();
  }
  const oldReset = own(oldEdition,"initialReply"), newReset = own(newEdition,"initialReply");
  if (oldReset !== newReset) firstUnknown={actions:[],missing:oldReset?"proposed reset output":"issued reset output"};
  else if (oldReset && JSON.stringify(canonical(oldEdition.initialReply)) !== JSON.stringify(canonical(newEdition.initialReply)))
    return report("changed",{witness:{actions:[],issued:oldEdition.initialReply,proposed:newEdition.initialReply}});
  for (let index=0; index<queue.length; index++) {
    const at = queue[index];
    for (const input of inputs) {
      if (steps >= maxSteps) return report("hold",{reason:"transition work limit",firstUnknown});
      steps++;
      const l=a.table[at.a].get(input), r=b.table[at.b].get(input);
      const leftMissing=!l && a.inputs.has(input) && a.model.missing==="unobserved";
      const rightMissing=!r && b.inputs.has(input) && b.model.missing==="unobserved";
      if (leftMissing || rightMissing) {
        firstUnknown ??= {actions:word(index,input),missing:leftMissing && rightMissing?"both edges":leftMissing?"issued edge":"proposed edge"};
        continue;
      }
      if (Boolean(l) !== Boolean(r) || (l && l.key !== r.key))
        return report("changed",{witness:{actions:word(index,input),issued:describe(l),proposed:describe(r)}});
      if (!l) continue;
      const pair=key(l.to,r.to);
      if (!reached.has(pair)) {
        if (reached.size >= maxPairs) return report("hold",{reason:"reachable pair limit",firstUnknown});
        reached.add(pair);
        queue.push({a:l.to,b:r.to,parent:index,input});
      }
    }
  }
  if (firstUnknown) return report("hold",{reason:"reachable behavior is unobserved",firstUnknown});
  return report("equivalent",{scope:"all finite input sequences from the two declared origins under the declared edge semantics"});
}
