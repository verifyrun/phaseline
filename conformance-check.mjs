// Installed CLI regression for receiver evidence. Never ship a production key.
import assert from "node:assert/strict";
import {prepareConformance, assessConformance, observationBytes} from "./conformance.mjs";
const pair=await crypto.subtle.generateKey("Ed25519",true,["sign","verify"]);
const hex=bytes=>Buffer.from(bytes).toString("hex");
const key=hex(await crypto.subtle.exportKey("raw",pair.publicKey));
const source="fact ready from desk.ready owner operator\nguarantee open when ready";
const spec={questions:["open"],actions:["advance"],observe:["ready"],offers:{},budget:0,states:[
  {id:"idle",facts:{ready:false},next:{advance:"live"}},
  {id:"live",facts:{ready:true},next:{advance:"idle"}}
]};
const terms={format:"phaseline.test-contract/1",subject:"display",edition:"test-v1",receiver:"local fixture",
  origin:"start with display off",resetState:"idle",maxStates:2,basis:"two-position control circuit",
  key,access:{reset:true,actions:["advance"],questions:["open"]},costs:{attestation:2,reset:2,action:1,snapshot:1},budget:100};
const prep=await prepareConformance(source,spec,terms);
assert.equal(prep.plan.status,"planned");assert.equal(prep.plan.referenceStates,2);
const facts={deterministic:true,fixedEdition:true,resetToOrigin:true,completeAlphabet:true,stateBound:2};
function observations(words) {
  return words.map(actions=>({actions,initial:{open:false},responses:actions.map((_,i)=>({accepted:true,answers:{open:i%2===0}}))}));
}
async function signed(p=prep,runs=observations(p.plan.words),attestation=facts) {
  const body={binding:p.plan.binding,attestation,runs};
  return {body,signature:hex(await crypto.subtle.sign("Ed25519",pair.privateKey,observationBytes(body)))};
}
const packet=await signed();
const ok=await assessConformance(prep,packet);
assert.equal(ok.status,"conditionally_conformant");assert.equal(ok.spent,prep.plan.cost);
const incomplete=structuredClone(packet.body.runs);
delete incomplete[0].responses[0].answers.open;
assert.equal((await assessConformance(prep,await signed(prep,incomplete))).reason,"missing complete observations");
const mismatch=structuredClone(packet.body.runs);
mismatch[0].responses[0].answers.open=false;
assert.deepEqual((await assessConformance(prep,await signed(prep,mismatch))).witness,{actions:["advance"],field:"open",expected:true,observed:false});
assert.equal((await assessConformance(prep,{...packet,signature:"0".repeat(128)})).status,"hold");
assert.equal((await assessConformance(prep,{...packet,body:{...packet.body,runs:mismatch}})).status,"hold");
for (const change of [{edition:"next"},{subject:"different"},{budget:99}]) {
  const p=await prepareConformance(source,spec,{...terms,...change});
  assert.equal((await assessConformance(p,packet)).status,"hold");
}
for (const field of ["deterministic","completeAlphabet","fixedEdition","resetToOrigin"]) {
  assert.equal((await assessConformance(prep,await signed(prep,packet.body.runs,{...facts,[field]:false}))).status,"hold");
}
const missing=await prepareConformance(source,spec,{...terms,maxStates:null,basis:null});
assert.equal(missing.plan.status,"hold");
assert.equal((await assessConformance(missing,await signed(missing,mismatch,{...facts,stateBound:null}))).status,"inconsistent");
const short=await prepareConformance(source,spec,{...terms,budget:ok.spent-1});
assert.equal(short.plan.status,"hold");
assert.equal((await assessConformance(short,await signed(short,packet.body.runs))).reason,"observed trials exceeded the shared account");
const cannotBuy=await prepareConformance(source,spec,{...terms,budget:terms.costs.attestation+terms.costs.reset+terms.costs.snapshot});
const fundedPrefix=await prepareConformance(source,spec,{...terms,budget:terms.costs.attestation+terms.costs.reset+2*terms.costs.snapshot+terms.costs.action});
const missed=await assessConformance(cannotBuy,await signed(cannotBuy,mismatch));
assert.equal(missed.status,"hold");assert.equal(missed.witness,undefined);
assert.equal((await assessConformance(fundedPrefix,await signed(fundedPrefix,mismatch))).status,"inconsistent");
const denied=await prepareConformance(source,spec,{...terms,access:{...terms.access,actions:[]}});
assert.equal(denied.plan.status,"hold");
assert.equal((await assessConformance(denied,await signed(denied,packet.body.runs))).reason,"report includes operations outside the grant");
const fixed=await prepareConformance(source,spec,{...terms,maxStates:1});
assert.equal(fixed.plan.status,"hold");
const noInputs=await prepareConformance(source,{...spec,actions:[],states:[{id:"idle",facts:{ready:false},next:{}}]},{...terms,maxStates:1,access:{...terms.access,actions:[]}});
assert.deepEqual(noInputs.plan.words,[[]]);
assert.equal((await assessConformance(noInputs,await signed(noInputs,observations([[]]),{...facts,stateBound:1}))).status,"conditionally_conformant");
console.log("Receiver evidence checks passed, including signature, missing reading, budgets, edition transfer and observed contradiction.");
