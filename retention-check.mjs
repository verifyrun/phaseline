import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {retain,challenge} from "./retention.mjs";
const file = name => readFileSync(new URL("./retention-"+name,import.meta.url),"utf8");
const issued=file("issued.phase"), proposed=file("proposed.phase"), model=JSON.parse(file("regime.json"));
const both = m => retain(issued,m,proposed);
const test=both(model);
assert.deepEqual(test.issued.classes.map(c=>c.histories),[["draft_a","draft_b"],["issued_a","issued_b","copy_b"]]);
assert.deepEqual(test.proposed.classes.map(c=>c.histories),[["draft_a","issued_a"],["draft_b"],["issued_b","copy_b"]]);
assert.deepEqual(test.migration.witness.after,["publish"]);
assert.deepEqual([test.migration.extraFixedWidthBits,test.migration.recovery.worstCaseObservationCost],[1,3]);
assert.equal(test.proposed.encoder.status,"unavailable_from_snapshot");
assert.equal(both({...model,offers:{},observe:["checked","released"]}).proposed.encoder.status,"encodable");
assert.equal(both({...model,budget:2}).migration.recovery.status,"over_budget");
const lost=both({...model,offers:{}}).migration.recovery;
assert.equal(lost.status,"unavailable");assert.deepEqual(lost.cells[0].witness.after,["publish"]);
assert.equal(both({...model,states:model.states.filter(s=>s.facts.checked)}).migration.status,"old_code_suffices");
assert.equal(retain(issued,{...model,states:[...model.states].reverse()},proposed).proposed.classes.length,3);
assert.throws(()=>retain(issued,model,proposed.replace("review.signed","review.claim")),/binding changed/);
assert.throws(()=>both({...model,actions:["typo"]}),/transition/);
assert.throws(()=>both({...model,observe:["id"]}),/source/);
assert.throws(()=>both({...model,questions:["typo"]}),/guarantee/);
const malformed=structuredClone(model);delete malformed.states[0].facts.checked;
assert.throws(()=>both(malformed),/checked/);
// Independent lower bound: try every labeling into k slots and check output
// and successor consistency directly. First feasible k is the optimum.
function sufficient(labels,answers,next) {
  for (let a=0; a<labels.length; a++) for (let b=0; b<a; b++) {
    if (labels[a]!==labels[b]) continue;
    if (answers[a]!==answers[b] || next[a].some((d,i)=>labels[d]!==labels[next[b][i]])) return false;
  }
  return true;
}
function minimum(answers,next) {
  const n=answers.length;
  for(let k=1;k<=n;k++) for(let code=0;code<k**n;code++) {
    const labels=Array.from({length:n},(_,i)=>Math.floor(code/k**i)%k);
    if (sufficient(labels,answers,next)) return k;
  }
  throw Error("No encoding found");
}
function replay(result, states, next) {
  for (const r of [result.issued,result.proposed]) {
    const labels=states.map(s=>r.classes.find(c=>c.histories.includes(s.id)).code);
    for(const c of r.classes) for(const id of c.histories) {
      const i=states.findIndex(s=>s.id===id);
      assert.deepEqual(c.next,next[i].map(j=>labels[j]));
    }
  }
  for (const s of states) {
    const issuedCode=result.issued.classes.find(c=>c.histories.includes(s.id)).code;
    const target=result.proposed.classes.find(c=>c.histories.includes(s.id)).code;
    const cell=result.migration.recovery.cells.find(c=>c.oldCode===issuedCode &&
      Object.entries(c.observations).every(([k,v])=>s.facts[k]===v));
    let policy=cell.strategy, cost=0;
    while (policy.read) {
      assert.equal(policy.source,"review.signed");
      cost+=policy.cost;
      policy=policy.branches.find(b=>b.value===s.facts[policy.read]).then;
    }
    assert.equal(policy.code,target);assert.ok(cost<=cell.cost);
  }
}
let count=0;
for (const [n, actions] of [[3,["one"]],[2,["one","two"]]]) {
  for (let edges=0; edges<n**(n*actions.length); edges++) {
    const next=Array.from({length:n},(_,i)=>actions.map((_,j)=>Math.floor(edges/n**(i*actions.length+j))%n));
    for (let mask=0;mask<2**n;mask++) {
      const answers=Array.from({length:n},(_,i)=>Boolean(mask&(1<<i)));
      const states=answers.map((released,i)=>({id:String(i),facts:{released,checked:released},next:Object.fromEntries(actions.map((a,j)=>[a,String(next[i][j])]))}));
      const m={...model,states,actions};
      const r=both(m);
      const k=minimum(answers,next);
      assert.equal(r.issued.classes.length,k); assert.equal(r.issued.fixedWidthBits,Math.ceil(Math.log2(k)));
      assert.equal(r.migration.status,"old_code_suffices");
      // A snapshot may be insufficient even with all facts: hidden dynamics
      // in the supplied machine can make equal current outputs diverge later.
      const w=r.issued.encoder.witness;
      if(w) {
        const end=w.histories.map(id=>w.after.reduce((i,a)=>next[i][actions.indexOf(a)],Number(id)));
        assert.notEqual(answers[end[0]],answers[end[1]]);assert.deepEqual(w.answers,end.map(i=>answers[i]));
      }
      replay(r,states,next);count++;
    }
  }
}
replay(test,model.states,model.states.map(s=>model.actions.map(a=>model.states.findIndex(t=>t.id===s.next[a]))));
// Neither single cheap observation identifies a four-way decision.
const fields=issued.split("guarantee")[0], two=fields+"guarantee x when released\nguarantee y when checked";
const empty=fields+"guarantee x when false\nguarantee y when false";
const four={...model,questions:["x","y"],actions:[],observe:[],offers:{checked:2,released:5},budget:7,
  states:[0,1,2,3].map(i=>({id:String(i),facts:{released:Boolean(i&2),checked:Boolean(i&1)},next:{}}))};
const repaired=retain(empty,four,two);
assert.equal(repaired.migration.extraFixedWidthBits,2);
assert.equal(repaired.migration.recovery.worstCaseObservationCost,7);
assert.equal(repaired.migration.recovery.cells[0].strategy.branches[0].then.branches.length,2);
const trace=JSON.parse(file("trace.json"));
assert.equal(challenge(proposed,model,trace).status,"consistent");
const omitted={...model,states:model.states.filter(s=>s.facts.checked)};
const conflict=challenge(proposed,omitted,trace);
assert.equal(conflict.firstIncompatibleStep,1);
assert.deepEqual(conflict.recorded.answers,{rely:false});
assert.ok(conflict.possibilitiesBeforeReading.every(p=>p.answers.rely===true));
assert.throws(()=>challenge(proposed,model,{steps:[...trace.steps,{action:"publish",observe:{checked:false},answers:{}}]}),/observation/);
assert.throws(()=>challenge(proposed,model,{steps:[{observe:{},answers:{}}]}),/needs evidence/);
console.log(count+" finite machines matched exhaustive minimum-code search; migration, priced recovery and omission controls passed.");
