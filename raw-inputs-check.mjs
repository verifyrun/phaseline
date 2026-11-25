import assert from "node:assert/strict";
import {rawInterface,rawSchedule,rawObservationBytes,assessRaw} from "./raw-inputs.mjs";

const pair=await crypto.subtle.generateKey("Ed25519",true,["sign","verify"]);
const key=Buffer.from(await crypto.subtle.exportKey("raw",pair.publicKey)).toString("hex");
const base={format:"raw-inputs/1",subject:"session",edition:"one",source:"clock",demand:"open",basis:"finite exported raw domain",key,
  axes:[{name:"clock",min:-3,max:3},{name:"mode",values:["native","repeat"]}],
  keep:[{axis:"clock",width:3,origin:0},"mode"],costs:{attest:2,read:1},budget:1000};
async function packet(c,rows,extra={}) {
  const body={binding:c.binding,fixedEdition:true,deterministic:true,rawPortComplete:true,rows,...extra};
  const signature=Buffer.from(await crypto.subtle.sign("Ed25519",pair.privateKey,rawObservationBytes(body))).toString("hex");
  return {body,signature};
}
const c=await rawInterface(base);
const rows=[];
for (let t=-3;t<=3;t++) for (const mode of ["native","repeat"]) rows.push({input:[t,mode],answer:t>=0});
let cases=0;
async function status(c,rows,expected,extra={}) {
  const result=await assessRaw(c,await packet(c,rows,extra));
  assert.equal(result.status,expected,JSON.stringify(result));cases++;return result;
}
const sufficient=await status(c,rows,"conditionally_sufficient");
assert.deepEqual(sufficient.leastSufficientAxes,["clock"]);
const planned=rawSchedule(c,100);
assert.equal(planned.readsForWorstCase,"12");
const needed=rows.filter(r=>r.input[0]!==3);
assert.deepEqual(new Set(planned.inputs.map(v=>JSON.stringify(v))),new Set(needed.map(r=>JSON.stringify(r.input))));
await status(c,needed,"conditionally_sufficient");
const missing=await status(c,needed.slice(1),"hold");assert.equal(missing.missingRequiredReadings,"1");
assert.deepEqual(missing.unresolved.missing,needed[0].input);
assert.notDeepEqual(missing.unresolved.missing,missing.unresolved.sibling);
assert.equal(missing.unresolved.cellAnswerInConstantCompletion,!missing.unresolved.missingAnswerInAlternative);
const bad=rows.map(r=>({...r,answer:r.input[0]===1}));const contradicted=await status(c,bad,"inconsistent");
assert.notDeepEqual(contradicted.witness.first,contradicted.witness.second);
await status(c,[rows[0],{...rows[0],answer:!rows[0].answer}],"hold");
await status(c,[...needed,needed[0]],"conditionally_sufficient");
await status(c,needed,"hold",{rawPortComplete:false});
await status(c,bad,"inconsistent",{rawPortComplete:false});
await status(c,bad,"hold",{deterministic:false});
await status(c,bad,"hold",{fixedEdition:false});
const denied=await rawInterface({...base,budget:3});
await status(denied,needed,"hold");
const identity=await rawInterface({...base,keep:["clock","mode"]});
await status(identity,[],"conditionally_sufficient");
const report=await packet(c,rows);report.body.rows[0]={...rows[0],answer:!rows[0].answer};
assert.equal((await assessRaw(c,report)).status,"hold");cases++;
assert.equal((await assessRaw(denied,await packet(c,rows))).status,"hold");cases++;
for (const k of [0,1,3,7,12,100]) {
  const first=rawSchedule(c,Math.max(k,1),0n), second=rawSchedule(c,100,BigInt(first.inputs.length));
  assert.deepEqual([...first.inputs,...second.inputs],planned.inputs);cases++;
}
// Independently identify required rows by all pairs, including disjoint
// singleton ends in two dimensions and negative origins.
for (let width1=1;width1<=5;width1++) for(let width2=1;width2<=4;width2++) for(let origin=-2;origin<=2;origin++) {
  const axes=[{name:"a",min:-2,max:2},{name:"b",min:-2,max:0}];
  const terms={...base,axes,keep:[{axis:"a",width:width1,origin},{axis:"b",width:width2,origin}]};
  const caseContract=await rawInterface(terms);
  const points=[];for(let a=-2;a<=2;a++)for(let b=-2;b<=0;b++)points.push([a,b]);
  const equiv=(x,y)=>[width1,width2].every((width,i)=>Math.floor((x[i]-origin)/width)===Math.floor((y[i]-origin)/width));
  const all=points.filter(x=>points.some(y=>x!==y&&equiv(x,y)));
  const schedule=rawSchedule(caseContract,256);
  assert.deepEqual(new Set(schedule.inputs.map(v=>JSON.stringify(v))),new Set(all.map(v=>JSON.stringify(v))));
  assert.equal(schedule.readsForWorstCase,String(all.length));cases++;
}
console.log(JSON.stringify({rawProjectionChecks:cases}));
