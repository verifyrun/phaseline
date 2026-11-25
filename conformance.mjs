// A complete test for one declared deterministic, resettable, finite receiver.
// The planner knows the specification. Only independently received observations
// enter the verdict. A finite state bound and reset conditions are assumptions.
import {canonical, digest} from "./carry.mjs";
import {compileRegime, minimize} from "./retention.mjs";
import {variableCodebook} from "./symbolic-retention.mjs";

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const named = value => typeof value === "string" && value.trim().length > 0 && value.length <= 512;
const units = value => Number.isSafeInteger(value) && value >= 0 && value <= 1e9;
const keyOf = word => JSON.stringify(word);
const hold = (reason, detail = {}) => ({status: "hold", reason, ...detail});
const MAX_WORDS = 8192;
const MAX_STEPS = 200000;
const MAX_WORK = 2000000;

function fields(value, allowed, label) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw Error("Invalid " + label + " fields.");
}
function permitted(value, possible) {
  return Array.isArray(value) && new Set(value).size === value.length && value.every(key => possible.includes(key));
}

function validate(terms, actions, questions) {
  fields(terms, ["format","subject","edition","receiver","origin","resetState","maxStates","basis","key","access","costs","budget"], "conformance contract");
  if (terms.format !== "phaseline.test-contract/1" || ![terms.subject,terms.edition,terms.receiver,terms.origin].every(named))
    throw Error("Identify the receiver, subject, edition and physical reset in a versioned test contract.");
  if (terms.maxStates !== null && (!Number.isSafeInteger(terms.maxStates) || terms.maxStates < 1 || terms.maxStates > 65536))
    throw Error("State bound must be null or an integer from 1 through 65536.");
  if (terms.basis !== null && !named(terms.basis)) throw Error("Name the source of the state bound, or supply null.");
  if (typeof terms.key !== "string" || !/^[0-9a-f]{64}$/.test(terms.key)) throw Error("Pin the receiver's raw Ed25519 verification key.");
  fields(terms.access, ["reset","actions","questions"], "test grant");
  if (typeof terms.access.reset !== "boolean" || !permitted(terms.access.actions,actions) || !permitted(terms.access.questions,questions))
    throw Error("Declare reset permission and the permitted actions and questions.");
  fields(terms.costs, ["attestation","reset","action","snapshot"], "trial tariff");
  if (!["attestation","reset","action","snapshot"].every(k => units(terms.costs[k])) || !units(terms.budget))
    throw Error("Declare nonnegative integer prices for the bound attestation, reset, input and snapshot, and one budget.");
}

function reference(source, spec, resetState) {
  if (spec.form === "finite-variables/1") {
    if (resetState !== null) throw Error("Use resetState null for a finite-variable model. Its initial predicate defines the origin.");
    const {machine,quotient} = variableCodebook(source,spec);
    const origins = quotient.leaves.filter(cell => machine.d.and(cell.region,machine.initial));
    if (origins.length !== 1) throw Error("The reset predicate leaves several observably different origins.");
    return {classes:quotient.classes, start:origins[0].code, actions:machine.actions.map(a => a.name), questions:spec.questions};
  }
  const {rows} = compileRegime(source,spec);
  const origin = rows.find(row => row.id === resetState);
  if (!origin) throw Error("Name the reset state for the enumerated model.");
  const {labels,classes} = minimize(rows);
  return {classes,start:labels[origin.index],actions:spec.actions,questions:spec.questions};
}

function move(ref, state, index) {
  const destination = ref.classes[state].next[index];
  return {state:destination ?? state, accepted:destination !== null};
}

// Access sequences P reach every distinct behavior from the reset point.
function accessSequences(ref) {
  const found = new Map([[ref.start,[]]]);
  for (const [state,word] of found) for (let a=0; a<ref.actions.length; a++) {
    const next = move(ref,state,a).state;
    if (!found.has(next)) found.set(next,[...word,a]);
  }
  return found;
}

// Construct a distinguishing set W by refining blocks. A separator is either
// an immediate observation, the acceptance of an input, or an input followed
// by a suffix which separated two predecessor blocks. Measured traces contain
// the output at every prefix, including reset.
function distinguishingSuffixes(ref, states, charge) {
  const suffixes = [[]];
  const separates = (x,y,word) => {
    if (ref.classes[x].answers.some((v,i) => v !== ref.classes[y].answers[i])) return true;
    for (const a of word) {
      charge();
      const l=move(ref,x,a), r=move(ref,y,a);
      if (l.accepted !== r.accepted) return true;
      x=l.state; y=r.state;
      if (ref.classes[x].answers.some((v,i) => v !== ref.classes[y].answers[i])) return true;
    }
    return false;
  };
  // Each added suffix splits at least one previous block. All candidate
  // predecessors of the current suffix set are sufficient to refine again.
  for (;;) {
    let pending, unresolved=false;
    for (let i=0; i<states.length && !pending; i++) for (let j=i+1; j<states.length && !pending; j++) {
      charge();
      const x=states[i],y=states[j];
      if (suffixes.some(w => separates(x,y,w))) continue;
      unresolved=true;
      for (let a=0; a<ref.actions.length && !pending; a++) for (const w of suffixes) {
        const extended=[a,...w];
        if (separates(x,y,extended)) {pending=extended;break;}
      }
    }
    if (!pending) {
      if (unresolved) throw Error("Reference states could not be distinguished. A minimal reachable model is required.");
      return suffixes;
    }
    suffixes.push(pending);
  }
}

export function discriminationSuite(ref, bound) {
  const paths=accessSequences(ref), n=paths.size;
  if (bound < n) return hold("the declared implementation bound is below the number of distinguishable reference states",{referenceStates:n});
  let work=0;
  function charge() {if (++work>MAX_WORK) throw Error("Conformance construction work limit reached. No coverage verdict.");}
  const suffixes=distinguishingSuffixes(ref,[...paths.keys()],charge);
  // P · A^{<=m-n+1} · W is the transition-cover W-method suite.
  // Retain only maximal words: a reset experiment records every prefix.
  const tree={children:new Map()}, maxDepth=bound-n+1;
  let nodes=1;
  function insert(word) {
    let node=tree;
    for (const a of word) {
      charge();
      if (!node.children.has(a)) {
        if (++nodes>MAX_STEPS) throw Error("Conformance prefix limit reached. No coverage verdict.");
        node.children.set(a,{children:new Map()});
      }
      node=node.children.get(a);
    }
  }
  let middle=[[]];
  for (let level=0; level<=maxDepth && middle.length; level++) {
    const following=[];
    for (const m of middle) {
      for (const p of paths.values()) for (const suffix of suffixes) insert([...p,...m,...suffix]);
      if (level<maxDepth) for (let a=0; a<ref.actions.length; a++) {
        charge();
        if (following.length>=MAX_STEPS || m.length>=1024) throw Error("Conformance schedule limit reached. No coverage verdict.");
        following.push([...m,a]);
      }
    }
    middle=following;
  }
  const stack=[[tree,[]]],words=[];
  let symbols=0;
  while (stack.length) {
    const [node,word]=stack.pop();
    if (node.children.size) for (const [a,child] of [...node.children].reverse()) stack.push([child,[...word,a]]);
    else {
      symbols+=word.length;
      if (words.length>=MAX_WORDS || symbols>MAX_STEPS) throw Error("Conformance output limit reached. No coverage verdict.");
      words.push(word.map(a => ref.actions[a]));
    }
  }
  return {status:"planned",referenceStates:n,characterizingSuffixes:suffixes.length,words,symbols};
}

function trialCost(costs, trials, symbols) {
  return costs.attestation + trials*(costs.reset+costs.snapshot) + symbols*(costs.action+costs.snapshot);
}

export async function prepareConformance(source,spec,terms) {
  const actions=spec.form==="finite-variables/1" ? Object.keys(spec.actions) : spec.actions;
  validate(terms,actions,spec.questions);
  const ref=reference(source,spec,terms.resetState);
  const binding=await digest(["phaseline.receiver-test/1",source,spec,terms]);
  const base={binding,subject:terms.subject,edition:terms.edition,receiver:terms.receiver,actions:ref.actions,questions:ref.questions};
  let plan;
  if (!terms.access.reset || ref.actions.some(a=>!terms.access.actions.includes(a)) || ref.questions.some(q=>!terms.access.questions.includes(q)))
    plan=hold("the declared access cannot exercise or observe the whole interface");
  else if (terms.maxStates===null || terms.basis===null) plan=hold("no externally supported implementation state bound supplied");
  else {
    plan=discriminationSuite(ref,terms.maxStates);
    if (plan.status==="planned") {
      plan.cost=trialCost(terms.costs,plan.words.length,plan.symbols);
      if (plan.cost>terms.budget) plan={...plan,status:"hold",reason:"the complete schedule exceeds the account"};
    }
  }
  return {ref,terms,plan:{...base,...plan}};
}

export function observationBytes(body) {
  return new TextEncoder().encode(JSON.stringify(canonical(["phaseline.receiver-observations/1",body])));
}
const bytes=hex=>Uint8Array.from(hex.match(/../g),pair=>parseInt(pair,16));

export async function assessConformance(prepared,packet) {
  const {ref,terms,plan}=prepared;
  fields(packet,["body","signature"],"observed suite");
  const body=packet.body;
  fields(body,["binding","attestation","runs"],"receiver report");
  const facts=body.attestation;
  fields(facts,["deterministic","fixedEdition","resetToOrigin","completeAlphabet","stateBound"],"receiver attestation");
  if (!["deterministic","fixedEdition","resetToOrigin","completeAlphabet"].every(k=>typeof facts[k]==="boolean") ||
      (facts.stateBound!==null && (!Number.isSafeInteger(facts.stateBound)||facts.stateBound<1))) throw Error("Malformed fault-domain attestation.");
  if (body.binding!==plan.binding) return hold("records belong to a different model, grant, subject, edition or tariff");
  if (!Array.isArray(body.runs) || body.runs.length>MAX_WORDS) throw Error("Observed trial count exceeds the supported limit.");
  if (typeof packet.signature!=="string" || !/^[0-9a-f]{128}$/.test(packet.signature)) return hold("missing receiver signature");
  const key=await crypto.subtle.importKey("raw",bytes(terms.key),"Ed25519",false,["verify"]);
  if (!await crypto.subtle.verify("Ed25519",key,bytes(packet.signature),observationBytes(body))) return hold("receiver signature failed");

  let symbols=0,completeRuns=0;
  const leaves=new Set((plan.words??[]).map(keyOf));
  const leafLengths=new Set((plan.words??[]).map(word=>word.length));
  const actionIndex=new Map(ref.actions.map((a,i)=>[a,i]));
  let difference;
  // The source is paid to attest the edition and origin even when it cannot
  // attest a state bound. A later externally signed answer may exceed the
  // observer's balance; it cannot become this observer's funded witness.
  let debit=terms.costs.attestation;
  for (const run of body.runs) {
    fields(run,["actions","initial","responses"],"observed run");
    if (!Array.isArray(run.actions)||!Array.isArray(run.responses)||run.actions.length!==run.responses.length ||
        run.actions.some(a=>!actionIndex.has(a))) throw Error("Every attempted input needs one response entry on the declared interface.");
    symbols+=run.actions.length;
    if (symbols>MAX_STEPS) throw Error("Observed input count exceeds the supported limit.");
    if (!terms.access.reset || run.actions.some(a=>!terms.access.actions.includes(a))) return hold("report includes operations outside the grant");
    debit+=terms.costs.reset+terms.costs.snapshot;
    let state=ref.start, fullyObserved=true;
    function compareAnswers(observed,prefix) {
      fields(observed,terms.access.questions,"permitted answers");
      for (let i=0;i<ref.questions.length;i++) {
        const q=ref.questions[i];
        if (!Object.hasOwn(observed,q)) {fullyObserved=false;continue;}
        if (typeof observed[q]!=="boolean") throw Error("Observed answers must be Boolean. Omit an unread answer.");
        const expected=ref.classes[state].answers[i];
        if (observed[q]!==expected && !difference && debit<=terms.budget) difference={actions:run.actions.slice(0,prefix),field:q,expected,observed:observed[q]};
      }
    }
    compareAnswers(run.initial,0);
    if (fullyObserved) leaves.delete(keyOf([]));
    for (let i=0;i<run.actions.length;i++) {
      debit+=terms.costs.action+terms.costs.snapshot;
      const r=run.responses[i];
      fields(r,["accepted","answers"],"receiver response");
      const next=move(ref,state,actionIndex.get(run.actions[i]));
      if (r.accepted===undefined) fullyObserved=false;
      else if (typeof r.accepted!=="boolean") throw Error("Input acceptance must be Boolean when observed.");
      else if (r.accepted!==next.accepted && !difference && debit<=terms.budget) difference={actions:run.actions.slice(0,i+1),field:"input acceptance",expected:next.accepted,observed:r.accepted};
      state=next.state;
      compareAnswers(r.answers,i+1);
      if (fullyObserved && leafLengths.has(i+1)) leaves.delete(keyOf(run.actions.slice(0,i+1)));
    }
    if (fullyObserved) completeRuns++;
  }
  const spent=trialCost(terms.costs,body.runs.length,symbols);
  const result={binding:plan.binding,receiver:terms.receiver,runs:body.runs.length,completeRuns,symbols,spent,budget:terms.budget};
  // Without a fixed edition or reset there is no established starting point
  // from which a signed prefix could contradict this specification.
  if (!facts.fixedEdition || !facts.resetToOrigin) return {...result,...hold("receiver did not attest the fixed edition and reset origin")};
  if (difference) return {...result,status:"inconsistent",witness:difference};
  if (spent>terms.budget) return {...result,...hold("observed trials exceeded the shared account")};
  if (!facts.deterministic || !facts.completeAlphabet || terms.maxStates===null || facts.stateBound!==terms.maxStates || terms.basis===null)
    return {...result,...hold("receiver did not substantiate all declared fault-domain assumptions")};
  if (!plan.words || plan.status!=="planned") return {...result,...hold(plan.reason??"no complete schedule")};
  if (leaves.size) return {...result,...hold("missing complete observations",{missingTrials:leaves.size,firstMissing:JSON.parse(leaves.values().next().value)})};
  return {...result,status:"conditionally_conformant",stateBound:terms.maxStates,boundSource:terms.basis,
    scope:"declared deterministic resettable receiver, fixed edition, stated bound, alphabet, tariff and trusted observation source"};
}
