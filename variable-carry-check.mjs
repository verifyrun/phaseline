import assert from "node:assert/strict";
import {makeBook,captureRecord,carryRecord,bridgeBytes} from "./carry.mjs";
import {variableCodebook,correspondenceRegion} from "./symbolic-retention.mjs";

const src="fact consent from home.consent owner steward\nfact tag from home.tag owner steward\nguarantee usable when consent";
const dst="fact flag from team.flag owner steward\nfact staff from team.staff owner lead\nguarantee usable when flag and staff";
const oldRegime={form:"finite-variables/1",variables:{consent:"boolean",tag:"boolean"},questions:["usable"],actions:{},
  observe:[],offers:{consent:1},budget:3};
const revisedRegime={form:"finite-variables/1",variables:{staff:"boolean",flag:"boolean"},questions:["usable"],actions:{},
  observe:[],offers:{staff:2},budget:3};
const [before,after]=await Promise.all([makeBook(src,oldRegime),makeBook(dst,revisedRegime)]);
const pair=await crypto.subtle.generateKey("Ed25519",true,["sign","verify"]);
const trust={owner:"lead",key:Buffer.from(await crypto.subtle.exportKey("raw",pair.publicKey)).toString("hex")};
function packet(records,asOf=2) {
  return {subject:"lot",at:1,asOf,records:records.map(([source,by,value])=>({subject:"lot",at:1,recorded:1,source,by,value}))};
}
const obtained=await captureRecord(before,packet([["home.consent","steward",true]],1));
assert.equal(obtained.status,"obtained");assert.equal(obtained.receipt.spent,1);
async function authorize(issued,revised,capture,rel,delta={}) {
  const bridge={from:issued.id,to:revised.id,receipt:capture.receipt.id,owner:"lead",status:"approved",
    reference:"case_314",effectiveFrom:1,validThrough:3,correspondence:{form:"shared-variables/1",equal:rel},...delta};
  return {bridge,signature:Buffer.from(await crypto.subtle.sign("Ed25519",pair.privateKey,bridgeBytes(bridge))).toString("hex")};
}
const direct=[{from:"consent",to:"flag"}];
const signed=await authorize(before,after,obtained,direct);
const p=packet([["team.staff","lead",true]]);
const delivered=await carryRecord(before,after,obtained,signed,trust,p);
assert.equal(delivered.status,"obtained");
assert.equal(after.classes[delivered.receipt.code].answers[0],true);
assert.equal(delivered.receipt.spent,3);
assert.equal(delivered.receipt.predecessor,obtained.receipt.id);
const without=await carryRecord(before,after,obtained,signed,trust,packet([]));
assert.equal(without.status,"hold");assert.equal(without.spent,3);
const different=await carryRecord(before,after,obtained,signed,trust,packet([["team.staff","lead",false]]));
assert.equal(after.classes[different.receipt.code].answers[0],false);
const wrongSubject=await carryRecord(before,after,obtained,signed,trust,{...p,subject:"other"});
assert.equal(wrongSubject.status,"hold");
assert.equal((await carryRecord(before,after,obtained,signed,trust,{...p,asOf:4})).status,"hold");
assert.equal((await carryRecord(before,after,obtained,{...signed,bridge:{...signed.bridge,correspondence:{form:"shared-variables/1",equal:[]}}},trust,p)).status,"hold");
const low=await makeBook(src,{...oldRegime,budget:2}),limited=await captureRecord(low,packet([["home.consent","steward",true]],1));
const below=await carryRecord(low,after,limited,await authorize(low,after,limited,direct),trust,p);
assert.equal(below.status,"hold");assert.equal(below.spent,1);
const initiallyFalse=await captureRecord(before,packet([["home.consent","steward",false]],1));
const settled=await carryRecord(before,after,initiallyFalse,await authorize(before,after,initiallyFalse,direct),trust,packet([]));
assert.equal(settled.status,"obtained");assert.equal(settled.receipt.spent,1);
assert.equal(after.classes[settled.receipt.code].answers[0],false);

// A signed statement can be total as a mathematical relation yet untrue of
// the measured destination. Expose the exact external failure, not a pass.
const actuallyFalse=await captureRecord(await makeBook(dst,{...revisedRegime,observe:["flag","staff"],offers:{}}),
  packet([["team.flag","steward",false],["team.staff","lead",true]]));
assert.equal(after.classes[actuallyFalse.receipt.code].answers[0],false);
assert.equal(after.classes[delivered.receipt.code].answers[0],true);

// Unequal domain sizes exercise the case where reduction erases a mapped
// variable at the root. A supposedly unchanged value still must exist there.
const range="fact a in unit range 0..3 from home.a owner reader\nguarantee fixed when true";
const small=(values)=>({form:"finite-variables/1",variables:{a:values},questions:["fixed"],actions:{}});
const narrow=variableCodebook(range,small([0,1])),wide=variableCodebook(range,small([0,1,2]));
const equal={form:"shared-variables/1",equal:[{from:"a",to:"a"}]};
const intoWide=correspondenceRegion(narrow,wide,0,equal);
assert.equal(intoWide.status,"covered");
assert.equal(wide.machine.count(intoWide.image),2n);
const intoNarrow=correspondenceRegion(wide,narrow,0,equal);
assert.equal(intoNarrow.status,"incomplete");assert.equal(intoNarrow.unmatchedPredecessor.a,2);
assert.throws(()=>correspondenceRegion(narrow,wide,0,{...equal,equal:[...equal.equal,...equal.equal]}),/once each/);
console.log(JSON.stringify({signedCarrySpent:3,belowMinimum:below.reason,settledSpent:1,
  signedButFalse:after.classes[delivered.receipt.code].answers[0],independentRecord:after.classes[actuallyFalse.receipt.code].answers[0],
  missingSuccessor:intoNarrow.unmatchedPredecessor}));
