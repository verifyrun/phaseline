import assert from "node:assert/strict";
import {compareMachines} from "./machine-comparison.mjs";

const baseline={format:"phaseline.transducer/1",initial:"start",inputs:["edit","send"],missing:"unavailable",states:[
  {id:"start",edges:[{input:"edit",to:"prepared",output:{ok:true,lines:[2,"é"]}}]},
  {id:"prepared",edges:[{input:"send",to:"start",output:"delivered"}]}
]};
const clone=()=>structuredClone(baseline);
let other=clone();
other.states.reverse();
other.states[1].edges[0].output={lines:[2,"é"],ok:true};
assert.equal(compareMachines(baseline,other).status,"equivalent");
other.states[0].edges[0].output="queued";
assert.deepEqual(compareMachines(baseline,other).witness.actions,["edit","send"]);
other=clone(); other.states[1].edges=[];
assert.deepEqual(compareMachines(baseline,other).witness.proposed,{enabled:false});
other.missing="unobserved";
assert.equal(compareMachines(baseline,other).status,"hold");
other=clone(); other.inputs.push("🚲"); other.states[0].edges.push({input:"🚲",to:"start",output:null});
assert.deepEqual(compareMachines(baseline,other).alphabet.added,["🚲"]);
assert.deepEqual(compareMachines(baseline,other).witness.proposed,{enabled:true,output:null});
other=clone(); other.states[1].edges[0].output=null; other.states[0].edges[0].output={ok:true,lines:["2","é"]};
assert.deepEqual(compareMachines(baseline,other).witness.actions,["edit"]);
other=clone(); other.states[0].edges.push({input:"send",to:"start",output:false});
other.missing="unobserved"; assert.equal(compareMachines(baseline,other).status,"changed");
other=clone(); other.states[1].edges[0].to="absent"; assert.throws(()=>compareMachines(baseline,other));
other=clone(); other.states[1].edges.push({...other.states[1].edges[0]}); assert.throws(()=>compareMachines(baseline,other));
other=clone(); other.states[1].edges[0].output=0.01; assert.throws(()=>compareMachines(baseline,other));
other=clone(); other.initialReply="ready"; assert.equal(compareMachines(baseline,other).status,"hold");
assert.deepEqual(compareMachines({...baseline,initialReply:null},other).witness.actions,[]);
assert.equal(compareMachines(baseline,baseline,{maxPairs:1}).status,"hold");
assert.equal(compareMachines(baseline,baseline,{maxSteps:1}).status,"hold");
console.log("Two-edition transition checks passed, including partial observations, typed replies and exhausted search.");
