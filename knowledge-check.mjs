// Independent checks for the finite observer CLI. Budget feasibility is
// evaluated at each integer allowance rather than solving for a numerical cost.
import assert from "node:assert/strict";
import {knowledge,planKnowledge} from "./knowledge.mjs";

const source=["fact mark from lab.mark owner technician","fact permit from lab.permit owner technician",
  "fact label from lab.label owner technician","guarantee access when permit",
  "guarantee first when true","guarantee future when mark"].join("\n");
function makeSystem(records, edges, opts={}) {
  const actions=Object.keys(edges[0]);
  const states=records.map((facts,i)=>({id:String(i),facts,next:Object.fromEntries(actions.map(a=>[a,String(edges[i][a])]))}));
  const role={question:"future",observe:[],offers:{},signals:Object.fromEntries(actions.map(a=>[a,"tick"])),budget:9,...opts};
  return {regime:{questions:["first","future"],actions,observe:[],offers:{},budget:0,states},
    initial:states.map(s=>s.id),roles:{analyst:role}};
}
const packet = (at, reading)=>({at,asOf:at,subject:"subject",records:Object.entries(reading).map(([key,value])=>
  ({at,recorded:at,subject:"subject",by:"technician",source:"lab."+key,value}))});
const facts=(mark,label,permit)=>({mark,label,permit});
const sample=makeSystem([facts(false,false,true),facts(true,true,true),facts(false,false,false),facts(true,false,false)],
  [{next:2},{next:3},{next:2},{next:3}],{offers:{label:{cost:2,allowedWhen:"access"}},budget:2});
sample.initial=["0","1"];
let plan=planKnowledge(source,sample,"analyst",["first","future"]);
assert.equal(plan.minimumWorstCaseCost,2);
assert.equal(plan.policy[plan.initial[0].to].op,"read");
assert.equal(plan.policy[plan.initial[0].to].fact,"label");
assert.equal(planKnowledge(source,sample,"analyst",["first"]).minimumWorstCaseCost,0);
sample.roles.analyst.budget=1;
assert.equal(planKnowledge(source,sample,"analyst",["first","future"]).status,"over_budget");
sample.initial=["0","1","2","3"];
assert.equal(planKnowledge(source,sample,"analyst",["first","future"]).status,"unresolvable");
assert.equal(knowledge(source,sample,"analyst",{steps:[{packet:packet(0,{label:true}),buy:["label"]}]}).status,"grant_unresolved");
const deadEnd=structuredClone(sample);
deadEnd.enabled=Object.fromEntries(deadEnd.regime.states.map(s=>[s.id,[]]));
assert.equal(planKnowledge(source,deadEnd,"analyst",["first"]).status,"within_budget");
assert.equal(planKnowledge(source,deadEnd,"analyst",["first","first"]).status,"unresolvable");
const restricted=makeSystem([facts(false,true,false),facts(false,false,true),facts(true,true,true)],
  [{tick:0},{tick:1},{tick:2}],{offers:{permit:1,label:{cost:2,allowedWhen:"access"}}});
plan=planKnowledge(source,restricted,"analyst",["future"]);
assert.equal(plan.minimumWorstCaseCost,3);
assert.equal(plan.policy[plan.initial[0].to].fact,"permit");
const observed=knowledge(source,restricted,"analyst",{steps:[{packet:packet(0,{permit:true,label:true}),buy:["permit","label"]}]});
assert.equal(observed.status,"determined");
assert.equal(observed.spent,3);
assert.equal(observed.steps[0].answer,true);

// A second oracle groups all possible current states by the actual words a
// role could have received. The implementation checks pairs of histories.
function partition(items,fn) {
  const map=new Map();
  for(const item of items) {
    const k=JSON.stringify(fn(item));
    if(!map.has(k)) map.set(k,new Set());
    map.get(k).add(item);
  }
  return [...map.values()].map(v=>[...v]);
}
function worldsAfter(sys,ids) {
  const results=new Map(),role=sys.roles.analyst;
  for(const id of ids) {
    const s=sys.regime.states[Number(id)];
    for(const a of (sys.enabled?.[id]??sys.regime.actions)) {
      const to=s.next[a],obs=role.observe.map(f=>sys.regime.states[Number(to)].facts[f]);
      const key=JSON.stringify([role.signals[a],obs]);
      if(!results.has(key)) results.set(key,new Set());
      results.get(key).add(to);
    }
  }
  return [...results.values()].map(v=>[...v].sort());
}
function start(sys) {
  return partition(sys.initial,id=>sys.roles.analyst.observe.map(f=>sys.regime.states[Number(id)].facts[f]));
}
function unknownDepth(sys) {
  let level=start(sys),depth=0;
  const seen=new Set();
  while(level.length) {
    const nxt=[];
    for(const group of level) {
      const key=group.slice().sort().join(",");
      if(seen.has(key)) continue;
      seen.add(key);
      if(new Set(group.map(id=>sys.regime.states[Number(id)].facts.mark)).size>1) return depth;
      nxt.push(...worldsAfter(sys,group));
    }
    level=nxt;
    depth++;
  }
  return null;
}
// Enumerate possible actions at each balance. A fixed-width cutoff is not
// used to infer impossibility; a separate oracle bound follows from at most
// one acquisition of each field per stage on any strictly informative path.
function feasible(sys, schedule, balance) {
  const role=sys.roles.analyst;
  function win(ids,i,remaining,read) {
    const vals=f=>ids.map(id=>sys.regime.states[Number(id)].facts[f]);
    if(schedule[i]==="first" || new Set(vals("mark")).size===1) {
      const continues=ids.every(id=>(sys.enabled?.[id]??sys.regime.actions).length>0);
      if(i+1===schedule.length || (continues && worldsAfter(sys,ids).every(next=>win(next,i+1,remaining,[])))) return true;
    }
    for(const [fact,offer] of Object.entries(role.offers)) {
      if(read.includes(fact)) continue;
      const fee=typeof offer==="number"?offer:offer.cost;
      if(fee>remaining || (typeof offer==="object" && vals("permit").includes(false))) continue;
      const groups=partition(ids,id=>sys.regime.states[Number(id)].facts[fact]);
      if(groups.length>1 && groups.every(group=>win(group,i,remaining-fee,[...read,fact]))) return true;
    }
    return false;
  }
  return start(sys).every(ids=>win(ids,0,balance,[]));
}
let seed=7733;
function rand(n){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return Math.floor(seed*n/2**32);}
const bit=()=>Boolean(rand(2));
let known=0,unknown=0,resolvable=0,impossible=0,containsLater=0;
for(let i=0;i<240;i++) {
  const n=2+rand(3);
  const rec=Array.from({length:n},()=>facts(bit(),bit(),bit()));
  const edges=Array.from({length:n},()=>({a:rand(n),b:rand(n)}));
  const offers={},observe=bit()?["label"]:[];
  if(!observe.length && bit()) offers.label=1+rand(2);
  if(bit()) offers.permit=1;
  if(bit()) offers.mark=bit()?2:{cost:2,allowedWhen:"access"};
  const sys=makeSystem(rec,edges,{observe,offers,signals:{a:"tick",b:bit()?"tick":"change"},budget:25});
  sys.initial=sys.initial.filter((_,j)=>j===0 || bit());
  sys.enabled=Object.fromEntries(sys.regime.states.map(r=>[r.id,["a","b"].filter(()=>rand(4)!==0)]));
  const expected=unknownDepth(sys), checked=knowledge(source,sys,"analyst");
  assert.equal(checked.status,expected===null?"always_known":"not_always_known");
  if(expected===null) known++;
  else {unknown++;assert.equal(checked.witness.length-1,expected);if(expected>0) containsLater++;}
  const schedule=Array.from({length:2+rand(2)},()=>bit()?"first":"future");
  const candidate=planKnowledge(source,sys,"analyst",schedule);
  const max=schedule.length*Object.values(offers).reduce((acc,v)=>acc+(typeof v==="number"?v:v.cost),0);
  let cost=null;
  for(let budget=0;budget<=max;budget++) if(feasible(sys,schedule,budget)){cost=budget;break;}
  assert.equal(candidate.minimumWorstCaseCost,cost,"minimum on generated system "+i);
  if(cost===null) impossible++;else resolvable++;
}
assert.ok(known && unknown && impossible && resolvable && containsLater);
console.log(JSON.stringify({randomSystems:240,known,unknown,laterAmbiguity:containsLater,funded:resolvable,unresolvable:impossible,
  earlyAcquisition:2,conditionalAccess:3}));
