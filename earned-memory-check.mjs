import assert from "node:assert/strict";
import {memoryCodebook,memoryMeter,encodeMemory,decodeMemory,MemoryLimit} from "./earned-memory.mjs";

function* maps(keys,labels,limit,at=0,taken=[]) {
  if (at===keys) {yield taken;return;}
  yield* maps(keys,labels,limit,at+1,taken);
  if (taken.length<limit) for(let a=0;a<labels;a++)yield* maps(keys,labels,limit,at+1,[...taken,[at,a]]);
}
let count=0,domains=0;
for(let n=0;n<=7;n++)for(let l=1;l<=3;l++)for(let k=0;k<=Math.min(n,4);k++) {
  const meter=memoryMeter(100_000_000),book=memoryCodebook(n,l,k,meter),ranks=new Set();
  for(const observed of maps(n,l,k)) {
    const raw=encodeMemory(book,observed,meter), hex=raw.toString("hex");
    assert.equal(raw.length,book.bytes);
    assert.ok(!ranks.has(hex));ranks.add(hex);
    assert.deepEqual(decodeMemory(book,raw,meter),observed.map(pair=>pair.map(BigInt)));
    assert.deepEqual(encodeMemory(book,[...observed].reverse(),meter),raw);
    count++;
  }
  assert.equal(BigInt(ranks.size),book.states);
  assert.equal(book.bits,Math.ceil(Math.log2(ranks.size)));
  if (book.states < 2n**BigInt(book.bytes*8)) {
    assert.throws(()=>decodeMemory(book,Buffer.alloc(book.bytes,255),meter),/Unused/);
  }
  domains++;
}
const meter=memoryMeter(10000),big=2n**64n;
for(const [alphabet,width] of [[1,128],[2,130],[4,131]]) {
  const book=memoryCodebook(big,alphabet,2,meter);assert.equal(book.bits,width);
  const values=[[0n,0n],[big-1n,BigInt(alphabet-1)]];
  assert.deepEqual(decodeMemory(book,encodeMemory(book,values,meter),meter),values);
}
const b=memoryCodebook(5,2,2,meter);
assert.throws(()=>encodeMemory(b,[[1,0],[1,1]],meter),/Duplicate/);
assert.throws(()=>encodeMemory(b,[[5,1]],meter),/out-of-domain/);
assert.throws(()=>encodeMemory(b,[[1,2]],meter),/out-of-domain/);
assert.throws(()=>encodeMemory(b,[[0,0],[1,0],[2,0]],meter),/capacity/);
assert.throws(()=>decodeMemory(b,Buffer.alloc(0),meter),/width/);
assert.throws(()=>memoryCodebook(big+1n,1,2,meter),/dimensions/);
assert.throws(()=>encodeMemory(b,[[0,0]],memoryMeter(0)),MemoryLimit);
assert.throws(()=>decodeMemory(b,Buffer.alloc(b.bytes),memoryMeter(0)),MemoryLimit);
console.log(JSON.stringify({finiteContracts:domains,exhaustiveRoundTrips:count,two64BitKeys:[128,130,131]}));
