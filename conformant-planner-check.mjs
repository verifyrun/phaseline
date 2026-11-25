import assert from "node:assert/strict";
import {constructSequence} from "./conformant-planner.mjs";
import {constructPhysical} from "./physical-planner.mjs";
const op=(name,cost,requires,outcomes,observe=[])=>({name,cost,requires,outcomes,observe});
const write=(i,v,when=true)=>({when,write:[i,v]});
const source={format:"factored-control/1",variables:[2,3,2],initial:{all:[[1,0],[2,0]]},goal:[2,1],safe:true,
  commands:[op("look",0,true,[[]],[[0,1]]),op("right",1,[0,1],[[write(2,1)]]),op("left",2,[0,0],[[write(2,1)]]),
  op("prepare",1,true,[[write(1,2),write(0,0)]]),op("ship",3,[1,2],[[write(2,1)]])]};
const plan=constructSequence(source);
assert.equal(plan.status,"certified_policy");assert.equal(plan.minimumSequenceCost,3);
assert.equal(constructPhysical(source).minimumWorstCaseCost,2);
assert.equal(constructSequence(source,{budget:2}).status,"hold");
const onlyObserved={...source,commands:source.commands.slice(0,3)};
assert.equal(constructSequence(onlyObserved).sequenceStatus,"unachievable");
assert.equal(constructPhysical(onlyObserved).status,"certified_policy");
const adverse={...source,commands:[op("try",0,true,[[write(2,1)],[]])]};
assert.equal(constructSequence(adverse).sequenceStatus,"unachievable");
const conditional={...source,commands:[op("copy",1,true,[[write(2,1,[0,0]),write(2,1,[0,1])]],[[0,1]])]};
assert.equal(constructSequence(conditional).minimumSequenceCost,1);
assert.equal(constructSequence({...conditional,initial:false}).status,"hold");
assert.equal(constructSequence(conditional,{workLimit:1}).status,"hold");
assert.equal(constructSequence({...source,variables:Array(257).fill(2)}).status,"hold");
assert.throws(()=>constructSequence({...source,variables:[-1]}),/Invalid finite variable/);
const wide={...source,variables:Array(120).fill(2),initial:[1,0],goal:[1,1],commands:[op("choose",1,true,[[write(1,1)]])]};
assert.equal(constructSequence(wide).minimumSequenceCost,1);
assert.equal(constructPhysical(wide,{worldLimit:12}).status,"hold");
console.log("Backward construction, strict shared work, paid execution and distinct limits for observation-independent plans passed.");
