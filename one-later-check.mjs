import assert from "node:assert/strict";
import {earlyRecord,oneLater,returnQuestion} from "./one-later.mjs";
const cube=(early,menu)=>{
  const probes=["a","b","c"],dot=(x,v)=>Boolean((x&v).toString(2).split("1").length%2===0);
  return {format:"one-later/1",probes,questions:menu.map(([q,right],i)=>({id:"q"+i,permitted:probes.filter((_,j)=>right>>j&1)})),
    rows:Array.from({length:8},(_,w)=>({early:early&w,replies:probes.map((_,i)=>Boolean(w>>i&1)),answers:menu.map(([q])=>dot(q,w))}))};
};
function checkAnswers(table,plan) {
  for(const row of table.rows) {
    const chosen=earlyRecord(plan,row.early);assert.equal(chosen.status,"encoded");
    for(const [i,q] of table.questions.entries()){
      let answer=returnQuestion(plan,chosen.code,q.id);
      if(answer.status==="needs_observation") {
        assert.ok(q.permitted.includes(answer.probe));
        answer=returnQuestion(plan,chosen.code,q.id,{probe:answer.probe,value:row.replies[table.probes.indexOf(answer.probe)]});
      }
      assert.deepEqual(answer,{status:"determined",value:row.answers[i]});
    }
  }
}
for(const [access,policy,expected] of [[7,7,2],[7,"endpoints",4],[3,7,4],[1,7,null]]) {
  const t=cube(access,[3,5,6].map(q=>[q,policy==="endpoints"?q:policy])),out=oneLater(t);
  if(expected===null)assert.equal(out.status,"unachievable");
  else {assert.equal(out.distinctRecords,expected);checkAnswers(t,out);}
}
// Every pair admits a single probe, but the three together require two records.
const tri={format:"one-later/1",probes:["p","q","r"],questions:[{id:"symbol",permitted:["p","q","r"]}],
  rows:[[0,1,0],[0,0,1],[1,0,0]].map((r,i)=>({early:i,replies:r,answers:[i]}))};
const genuine=oneLater(tri);assert.equal(genuine.distinctRecords,2);checkAnswers(tri,genuine);
assert.equal(earlyRecord(genuine,17).status,"hold");
assert.equal(returnQuestion(genuine,88,"symbol").status,"hold");
assert.equal(oneLater(tri,{workLimit:1}).status,"hold");
const refused=oneLater({...tri,rows:tri.rows.map(row=>({...row,early:null}))});
assert.equal(refused.status,"unachievable");
assert.ok(refused.cases.every(v=>v.rows.length===2 && v.rows[0]!==v.rows[1]));
const typed={format:"one-later/1",probes:["p"],questions:[{id:"question",permitted:["p"]}],
  rows:[null,"null",false,0].map(x=>({early:[],replies:[x],answers:[x]}))};
const out=oneLater(typed);checkAnswers(typed,out);assert.equal(out.payloadBits,0);
assert.equal(returnQuestion(out,0,"question",{probe:"p",value:"absent"}).status,"hold");
assert.equal(returnQuestion(out,0,"question",{probe:"ungranted",value:null}).status,"hold");
assert.throws(()=>oneLater({...tri,questions:[{id:"test",permitted:["outside"]}]}),/Unknown/);
assert.equal(oneLater({...tri,rows:Array.from({length:257},(_,i)=>({early:i,replies:[true,true,true],answers:[1]}))}).status,"hold");
console.log("One-later finite retention, non-pairwise compatibility, typed replies and limits passed.");
