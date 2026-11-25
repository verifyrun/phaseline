import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {analyze} from "./inquiry.mjs";
const file = name => readFileSync(new URL(name,import.meta.url),"utf8");
for (const [sample,field] of [["inquiry","checked"],["course","embargoed"],["plant","peak_reading"],["plans","grandfathered"]]) {
  const source=file(sample+(sample==="plant"?"-issued.phase":"-proposed.phase"));
  const model=JSON.parse(file(sample+"-histories.json"));
  const observer=file(sample+"-observer.phase");
  const check=(code,rows=model)=>analyze(source,code,rows).cells;
  const result=check(observer)[0];
  assert.equal(result.status,"inquiry_available");
  assert.equal(result.firstObservation.fact,field);
  assert.equal(result.worstCaseCost,result.firstObservation.cost);
  assert.equal(check(observer.replace(/budget \d+/, "budget 0"))[0].status,"over_budget");
  const noOffer=observer.replace(/^offer .+$/m,"");
  const blocked=check(noOffer)[0];
  assert.equal(blocked.status,"indistinguishable");
  const pair=blocked.witness.map(w=>model.histories.find(h=>h.id===w.history));
  for(const key of blocked.equalOn) assert.equal(pair[0].facts[key],pair[1].facts[key]);
  assert.notEqual(blocked.witness[0].answer,blocked.witness[1].answer);
  const withMeasurement=noOffer.replace(/^observe (.+)$/m,(_,fields)=>"observe "+(fields==="none"?field:fields+", "+field));
  assert(check(withMeasurement).every(c=>c.status==="determined"));
  assert.throws(()=>check(observer,{histories:[]}));
  assert.throws(()=>check(observer,{histories:[{id:"missing",facts:{}}]}));
  assert.throws(()=>check(observer.replace(/^observe .+$/m,"observe unrecorded_typo")));
  assert.throws(()=>check(observer+"\nbudget 7"));
}
// Independent exhaustive strategy enumeration on every Boolean function of three
// fields. The expected answers are constructed directly from the truth-table mask.
const names=["a","b","c"];
const declarations=names.map(n=>"fact "+n+" from record."+n+" owner author missing hold_dependents").join("\n");
const rows=Array.from({length:8},(_,i)=>({id:"h"+i,facts:Object.fromEntries(names.map((n,j)=>[n,Boolean(i&(1<<j))]))}));
const offers={a:1,b:2,c:4};
function oracle(mask,indices,available) {
  const answers=indices.map(i=>(mask>>i)&1);
  if(answers.every(v=>v===answers[0])) return 0;
  return Math.min(...available.map(k=>{
    const rest=available.filter(n=>n!==k);
    const positive=indices.filter(i=>rows[i].facts[k]);
    const negative=indices.filter(i=>!rows[i].facts[k]);
    if(!positive.length||!negative.length) return Infinity;
    return offers[k]+Math.max(oracle(mask,positive,rest),oracle(mask,negative,rest));
  }));
}
for(let mask=0;mask<256;mask++) {
  const positive=rows.filter((_,i)=>(mask>>i)&1);
  const expression=positive.map(row=>"("+names.map(n=>(row.facts[n]?"":"not ")+n).join(" and ")+")").join(" or ") || "false";
  const source=declarations+"\nguarantee answer when "+expression;
  const observer="question answer\nobserve none\noffer a cost 1\noffer b cost 2\noffer c cost 4\nbudget 7";
  const expected=oracle(mask,[0,1,2,3,4,5,6,7],names);
  assert.equal(analyze(source,observer,{histories:rows}).cells[0].worstCaseCost,expected);
  const partial=analyze(source,observer.replace(/^offer [bc].+$/gm,""),{histories:rows}).cells[0];
  if(partial.status==="indistinguishable") {
    const indices=partial.witness.map(w=>Number(w.history.slice(1)));
    assert.equal(rows[indices[0]].facts.a,rows[indices[1]].facts.a);
    assert.notEqual((mask>>indices[0])&1,(mask>>indices[1])&1);
  }
}
// Two different instruments can be correlated on the supplied histories.
const src=declarations+"\nguarantee answer when c";
const history=rows.filter(r=>r.facts.a===r.facts.c);
const proxy=analyze(src,"question answer\nobserve none\noffer a cost 1\noffer c cost 4\nbudget 1",{histories:history}).cells[0];
assert.equal(proxy.firstObservation.fact,"a"); assert.equal(proxy.worstCaseCost,1);
console.log("Four domains and 256 Boolean questions passed against independent decision-tree enumeration.");
