// Public executable regression, including a deliberately independent two-bit oracle.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {makeBook,captureRecord,carryRecord,bridgeBytes} from "./carry.mjs";
import {readJSON} from "./exact-json.mjs";

const file=name=>readFileSync(new URL("carry-"+name,import.meta.url),"utf8");
const json=name=>readJSON(file(name+".json"));
const old=await makeBook(file("old.phase"),json("old"));
const revised=await makeBook(file("new.phase"),json("new"));
const atIssue=json("at-issue"), atReview=json("at-review"), signed=json("bridge"), trust=json("trust");
const capture=await captureRecord(old,atIssue);
// The capture commits to the original effective timestamp even when the value is the same.
const standingBook=await makeBook(file("old.phase").replace("hold_dependents","hold_dependents standing"),json("old"));
const standingCapture=at=>captureRecord(standingBook,{...atIssue,records:[{...atIssue.records[0],at}]});
const earlier=await standingCapture(7),later=await standingCapture(8);
assert.equal(earlier.status,"obtained");
assert.equal(earlier.receipt.code,later.receipt.code);
assert.notEqual(earlier.receipt.evidence,later.receipt.evidence);
const migrate=(packet=atReview,grant=signed,previous=capture,from=old,to=revised,key=trust)=>
  carryRecord(from,to,previous,grant,key,packet);
const output=await migrate();
assert.equal(output.status,"obtained");
assert.deepEqual([capture.receipt.spent,output.receipt.spent],[1,3]);
const transferred=revised.classes.find(c=>c.code===output.receipt.code);
assert.deepEqual(transferred.answers,[true]);
assert.deepEqual(revised.classes[transferred.next[0]].answers,[false]);
assert.deepEqual(await migrate(),output); // Same pure replay, no external side effect.
const missing=await migrate({...atReview,records:[]});
assert.equal(missing.status,"hold");
assert.equal(missing.needs.source,"rota.evening");
assert.equal(missing.spent,3);
const wrongSource={...atReview.records[0],by:"other"};
assert.equal((await migrate({...atReview,records:[wrongSource]})).status,"hold");
assert.equal((await migrate({...atReview,records:[...atReview.records,{...atReview.records[0],value:false}]})).status,"hold");
for (const wrong of [{subject:"other"},{at:9},{asOf:10},{asOf:13}])
  assert.equal((await migrate({...atReview,...wrong})).status,"hold");
assert.equal((await migrate(atReview,signed,{status:"assumed",receipt:capture.receipt})).status,"hold");
assert.equal((await migrate(atReview,signed,{...capture,receipt:{...capture.receipt,code:0}})).status,"hold");
const shuffled=await makeBook(file("old.phase"),{...json("old"),states:[...old.regime.states].reverse()});
assert.notEqual(shuffled.id,old.id);
assert.equal((await migrate(atReview,signed,capture,shuffled)).status,"hold");
await assert.rejects(migrate(atReview,signed,capture,{...old,classes:[...old.classes].reverse()}),/contents/);
const changedTransitions=structuredClone(revised.regime);
changedTransitions.states.forEach(r=>{r.next.close=r.id;});
assert.equal((await migrate(atReview,signed,capture,old,await makeBook(file("new.phase"),changedTransitions))).status,"hold");
assert.equal((await migrate(atReview,{...signed,bridge:{...signed.bridge,reference:"altered"}})).status,"hold");
const initialWithoutRecords=await captureRecord(old,{...atIssue,records:[]});
assert.equal(initialWithoutRecords.status,"hold");
assert.equal(initialWithoutRecords.spent,1);

const pair=await crypto.subtle.generateKey("Ed25519",true,["sign","verify"]);
const testTrust={owner:trust.owner,key:Buffer.from(await crypto.subtle.exportKey("raw",pair.publicKey)).toString("hex")};
async function sign(bridge) {
  const signature=await crypto.subtle.sign("Ed25519",pair.privateKey,bridgeBytes(bridge));
  return {bridge,signature:Buffer.from(signature).toString("hex")};
}
for (const delta of [{successors:{}},{successors:{booked:["absent"]}},{status:"withdrawn"}]) {
  const grant=await sign({...signed.bridge,...delta});
  assert.equal((await migrate(atReview,grant,capture,old,revised,testTrust)).status,"hold");
}
assert.equal((await migrate(atReview,signed,capture,old,revised,testTrust)).status,"hold");

// A valid signature is insufficient to establish real coverage. Two external
// worlds can supply the same authorized incomplete bridge and no desk record.
const incomplete=await sign({...signed.bridge,successors:{booked:["booked_open"]}});
const assumed=await migrate({...atReview,records:[]},incomplete,capture,old,revised,testTrust);
assert.equal(assumed.status,"obtained");
assert.deepEqual(revised.classes[assumed.receipt.code].answers,[true]);
const observedClosed={...atReview,records:[{...atReview.records[0],value:false}]};
const measured=await migrate(observedClosed);
assert.deepEqual(revised.classes[measured.receipt.code].answers,[false]);

// Exhaust all old reservation values, new desk values, three evidence states
// and four total budgets. The oracle is written directly from the story.
let cases=0;
for (const limit of [0,1,2,3]) {
  const before=await makeBook(file("old.phase"),{...old.regime,budget:limit});
  for (const booked of [false,true]) {
    const packet={...atIssue,records:[{...atIssue.records[0],value:booked}]};
    const previous=await captureRecord(before,packet);
    for (const evening of [false,true]) for (const available of ["present","absent","wrong owner"]) {
      cases++;
      if (limit===0) {assert.equal(previous.status,"hold");continue;}
      const record={...atReview.records[0],value:evening,by:available==="wrong owner"?"other":"scheduler"};
      const fresh={...atReview,records:available==="absent"?[]:[record]};
      const grant=await sign({...signed.bridge,from:before.id,receipt:previous.receipt.id});
      const actual=await migrate(fresh,grant,previous,before,revised,testTrust);
      if (booked && (limit<3 || available!=="present")) {
        assert.equal(actual.status,"hold");
        if (limit<3) assert.equal(actual.reason,"observation budget exhausted");
      } else {
        assert.equal(actual.status,"obtained");
        assert.deepEqual(revised.classes[actual.receipt.code].answers,[booked&&evening]);
        assert.equal(actual.receipt.spent,booked?3:1);
      }
    }
  }
}
for (const n of ["1","1.0","1e0","0.1e1","10e-1"]) assert.equal(readJSON(n),1);
for (const n of ["1.0000000000000001","0.99999999999999999","1e-1000","9007199254740992","1e400"]) assert.throws(()=>readJSON(n));
assert.equal(readJSON("9007199254740991"),Number.MAX_SAFE_INTEGER);
assert.equal(readJSON("1.25"),1.25);
console.log(JSON.stringify({cases,oldSpend:capture.receipt.spent,totalSpend:output.receipt.spent,answerNow:transferred.answers[0],afterClose:revised.classes[transferred.next[0]].answers[0],missing:missing.reason,incompleteSignedMap:true,independentClosedDesk:false}));
