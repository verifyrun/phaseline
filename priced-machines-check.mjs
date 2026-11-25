import assert from "node:assert/strict";
import {comparePricedMachines} from "./priced-machines.mjs";

function model(rows,mode="keep") {
  const inputs=[...new Set(rows.flatMap(row=>row.map(e=>e[0])))];
  return {format:"phaseline.priced-transducer/1",initial:"0",missing:"unavailable",onExhaustion:mode,inputs,
    states:rows.map((list,i)=>({id:String(i),edges:list.map(([input,work,output,to])=>({input,work,output,to:String(to)}))}))};
}
const old=model([[["run",1,"ok",1]],[["run",100,"done",1]]]);
const next=model([[["run",2,"ok",1]],[["run",100,"done",1]]]);
const compare=(a,b,w="any",limits)=>comparePricedMachines(a,b,w,limits);
assert.equal(compare(old,next).minimumOpeningBalance,"1");
assert.equal(compare(old,next,"0").status,"equivalent");
assert.equal(compare(old,next,"1").status,"changed");
assert.equal(compare(old,next,"2").status,"equivalent");
assert.equal(compare(old,next,"101").status,"changed");
assert.equal(compare(old,old).status,"equivalent");
assert.equal(compare(old,old,"99999999999999999999999").certifiedBy,"all-wallet equivalence");
const keep=model([[["heavy",3,"x",0],["light",1,"y",0]]]);
const drain={...keep,onExhaustion:"consume"};
const split=compare(keep,drain);
assert.deepEqual(split.witness.actions,["heavy","light"]);
assert.equal(split.minimumOpeningBalance,"1");
assert.equal(compare(drain,keep,"1").witness.issued.status,"exhausted");
assert.equal(compare(keep,drain,"0").status,"equivalent");
const save=9007199254740991;
const a=model([[["a",save,"x",1]],[["b",save,"x",2]],[["c",1,{"hold":true},2]]]);
const z=structuredClone(a);z.states[2].edges[0].output={hold:false};
assert.equal(compare(a,z).minimumOpeningBalance,String(2n*BigInt(save)+1n));
const exact=String(2n*BigInt(save));
assert.equal(compare(a,z,exact).status,"equivalent");
assert.equal(compare(a,z,String(BigInt(exact)+1n)).status,"changed");
const gaps=structuredClone(old);gaps.states[1].edges=[];gaps.missing="unobserved";
assert.equal(compare(old,gaps).status,"hold");
assert.equal(compare(old,gaps,"0").status,"equivalent");
const uncertain=structuredClone(next);uncertain.inputs.push("anything");uncertain.missing="unobserved";
const partial=compare(old,uncertain);
assert.equal(partial.status,"hold");assert.equal(partial.knownWitness.openingBalance,"1");
const unavailable=structuredClone(old);unavailable.states[0].edges=[];
assert.equal(compare(old,unavailable).minimumOpeningBalance,"0");
const initial=compare({...old,initialReply:"live"},{...next,initialReply:"draft"});
assert.deepEqual(initial.witness.actions,[]);assert.equal(initial.minimumOpeningBalance,"0");
assert.equal(compare({...old,initialReply:"live"},old).status,"hold");
assert.equal(compare(keep,{...keep,initialReply:"draft"},"4").status,"hold");
assert.equal(compare(a,z,"any",{maxSteps:1}).status,"hold");
assert.throws(()=>compare(a,z,"-1"));
assert.throws(()=>compare(a,model([[["q",0,true,0]]])));
console.log("Priced behaviors verified for exact wallets, later exhaustion, different shortfall policies, partial evidence and large sums.");
