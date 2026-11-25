import assert from "node:assert/strict";
import {compileReview,constructReview,certifyReview,MAX_WORK,VERDICTS} from "./review-program.mjs";
let cases=0;
for (let left=0;left<12;left++) for(let right=0;right<12;right++) {
  const table=[left,right].map(v=>({verdict:VERDICTS[Math.floor(v/MAX_WORK)],work:v%MAX_WORK+1}));
  const source=constructReview(1,table), check=compileReview(1,source);
  assert.deepEqual(check(0,false),table[0]);assert.deepEqual(check(0,true),table[1]);
  assert.equal(certifyReview(1,source,table).status,"preserved");
  for (let i=0;i<2;i++) {
    const changed=structuredClone(table);
    changed[i].work=changed[i].work%MAX_WORK+1;
    const out=certifyReview(1,source,changed);
    assert.equal(out.witness.claim,Boolean(i));assert.equal(out.witness.expected.verdict,out.witness.proposed.verdict);
  }
  cases++;
}
const many=Array.from({length:32},(_,i)=>({verdict:VERDICTS[i%3],work:i%4+1}));
const full=constructReview(16,many);
assert.equal(certifyReview(16,full,many).cases,32);
assert.throws(()=>constructReview(16,many.slice(1)));
assert.throws(()=>compileReview(16,full.replace("owner receiver","owner guest")));
assert.throws(()=>compileReview(16,full.replace("item.claim","item.other")));
const both=full.replace(/guarantee permit when .+/,"guarantee permit when true").replace(/guarantee refuse when .+/,"guarantee refuse when true");
assert.throws(()=>certifyReview(16,both,many));
console.log("Verified every one-position priced reviewer ("+cases+" tables) and a 32-input case.");
