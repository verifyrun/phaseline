import assert from "node:assert/strict";
import {certifyPolicy} from "./policy-certificate.mjs";
import {clauseOrigins} from "./clause-origins.mjs";
import {symbolicOrigins} from "./factored-origins.mjs";

const stop={initial:0,nodes:[{finish:true}]};
const model=(variables,initial,goal=true)=>({format:"factored-control/1",variables,initial,goal,safe:true,commands:[]});
const opts={origins:"constraints",workLimit:1_000_000};
const once={one:[[0,1],[0,1]]};
assert.equal(certifyPolicy(model([2],once),stop,opts).status,"hold");
assert.equal(certifyPolicy(model([2],{one:[true,[0,1]]}),stop,opts).checkedOrigins,1);
assert.equal(certifyPolicy(model([2],{all:[]}),stop,opts).checkedOrigins,2);
assert.equal(certifyPolicy(model([2],{any:[]}),stop,opts).checkedOrigins,0);
assert.equal(certifyPolicy(model([1,1],[1,0]),stop,opts).checkedOrigins,1);
assert.equal(certifyPolicy(model([3,2],{not:{one:[[0,1],[1,0]]}}),stop,opts).originMethod.method,"decision_diagram");
const wide=model(Array(200).fill(2),{any:[[17,1],[18,1]]});
const keep=certifyPolicy(wide,stop,{...opts,project:true});
assert.equal(keep.originalInitialWorldsCovered,(3n*(2n**198n)).toString());
assert.ok(keep.inputValidationWork>0);
assert.equal(certifyPolicy(wide,stop,{...opts,project:true,workLimit:keep.verificationWork-1}).status,"hold");
assert.equal(certifyPolicy(wide,stop,{...opts,project:true,workLimit:keep.verificationWork}).status,"certified_policy");
const disagrees=model([2,2],{any:[[0,0],[1,0]]},[1,0]);
const counter=certifyPolicy(disagrees,stop,opts);
assert.equal(counter.status,"invalid_policy");assert.deepEqual(counter.witness.initialWorld,[0,1]);
assert.throws(()=>certifyPolicy(disagrees,stop,{origins:"list_of_claimed_origins"}));
assert.throws(()=>certifyPolicy({...disagrees,claimedOrigins:[[0,0]]},stop,opts));
assert.equal(certifyPolicy(disagrees,stop,{...opts,workLimit:1}).phase,"input_validation");

function actual(f,w) {
  if(typeof f==="boolean")return f;
  if(Array.isArray(f))return w[f[0]]===f[1];
  if(Object.hasOwn(f,"not"))return !actual(f.not,w);
  const [op]=Object.keys(f);const xs=f[op].map(x=>actual(x,w));
  if(op==="all")return xs.every(x=>x);
  if(op==="one")return xs.filter(x=>x).length===1;
  return xs.some(x=>x);
}
let state=230512;
function pick(n){state=(Math.imul(state,1664525)+1013904223)>>>0;return (state>>>8)%n;}
let fast=0,diagram=0,empty=0,worlds=0;
for(let trial=0;trial<800;trial++) {
  const dims=Array.from({length:1+pick(7)},()=>trial%3?2:1+pick(3));
  function atom(){const i=pick(dims.length);return [i,pick(dims[i])];}
  function literal(){const a=atom();return pick(5)===0?{not:a}:a;}
  function clause(){return {any:Array.from({length:pick(6)},literal)};}
  function generate(depth) {
    if(!depth||!pick(5))return pick(7)===0?!!pick(2):atom();
    if(pick(5)===0)return {not:generate(depth-1)};
    const k=["all","any","one"][pick(3)];return {[k]:Array.from({length:pick(4)},()=>generate(depth-1))};
  }
  const expr=trial%2?{all:Array.from({length:pick(12)},()=>pick(4)?clause():{one:Array.from({length:pick(5)},literal)})}:generate(3);
  const m=model(dims,expr),expected=[],out=[];
  function enumerate(w){
    if(w.length===dims.length){if(actual(expr,w))expected.push(w.join(","));return;}
    for(let i=0;i<dims[w.length];i++)enumerate([...w,i]);
  }
  enumerate([]);
  const add=w=>out.push(w.join(","));
  const stats=clauseOrigins(m,null,()=>{},add);
  if(stats)fast++;
  else {diagram++;symbolicOrigins(m,null,()=>{},add);}
  assert.deepEqual(out.sort(),expected.sort(),JSON.stringify(expr));
  if(!expected.length)empty++;worlds+=expected.length;
}
console.log(JSON.stringify({randomOriginFormulas:800,watchedClauses:fast,decisionDiagrams:diagram,
  exactWorldsCompared:worlds,emptySources:empty}));
