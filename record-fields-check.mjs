import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {retainedFields, recordedReader, regimeTable} from "./record-fields.mjs";
const read = name => readFileSync(new URL(name,import.meta.url),"utf8");
const row=(id,values,answers,next=[])=>({id,values,answers,next});
const field=(name,price)=>({name,price});
const schema=(fields,rows,actions=[])=>({format:"retained-fields/1",basis:"sample",questions:["leave"],actions,fields,rows});

const twin=schema([field("stamp",3),field("tag",1)],[row("a",[1,true],["go"]),row("b",[2,false],["hold"])]);
const r=retainedFields(twin);
assert.deepEqual([r.status,r.minimumPrice,r.fields],["minimum",1,["tag"]]);
assert.deepEqual(r.necessities[0].witness.answers,["go","hold"]);
assert.equal(retainedFields({...twin,observationBudget:0}).status,"over_budget");
assert.equal(retainedFields({...twin,observationBudget:0}).shortfall,1);
assert.equal(retainedFields({...twin,observationBudget:1}).shortfall,0);
assert.throws(()=>retainedFields({...twin,observationBudget:null}));
assert.equal(recordedReader(twin).read([2,true]).status,"unseen_record");
assert.equal(recordedReader(twin).read([1,true]).answers[0].value,"go");
assert.throws(()=>recordedReader(twin).read([1]));
assert.deepEqual(retainedFields({...twin,fields:[field("free",0),field("other",0)]}).fields,["free"]);
assert.equal(retainedFields({...twin,rows:[twin.rows[0]]}).minimumFieldCountAtThatPrice,0);
assert.equal(retainedFields(twin,{workLimit:0}).status,"hold");

const future=schema([field("venue",1),field("form",2)],[
  row("a",["open","draft"],[false],["x"]),row("b",["closed","draft"],[false],["y"]),
  row("x",["open","issued"],[true],["x"]),row("y",["closed","issued"],[false],["y"])],["release"]);
assert.equal(retainedFields(future).minimumPrice,3);
const blind={...future,fields:[field("form",2)],rows:future.rows.map(r=>({...r,values:r.values.slice(1)}))};
const blocked=retainedFields(blind);
assert.equal(blocked.status,"unavailable");
assert.deepEqual(blocked.witness.after,["release"]);
assert.deepEqual(blocked.witness.histories,["a","b"]);
const partial=recordedReader(blind).read(["draft"]);
assert.equal(partial.status,"ambiguous_record");
assert.deepEqual(partial.answers,[{question:"leave",known:true,value:false}]);
const multiple={...twin,questions:["call","why"],rows:[row("a",[1,true],[true,"one"]),row("b",[1,true],[true,"two"])]};
assert.deepEqual(recordedReader(multiple).read([1,true]).answers,[
  {question:"call",known:true,value:true},{question:"why",known:false}]);
assert.equal(retainedFields({...twin,rows:[row("a",[true,true],["a"]),row("b",["true",true],["b"])]}).minimumPrice,3);
assert.throws(()=>retainedFields({...future,rows:[row("a",[1,2],[true],["missing"])]}));
assert.throws(()=>retainedFields({...twin,rows:[row("a",[null,true],["no"])]}));
assert.throws(()=>retainedFields(twin,{workLimit:1.1}));
assert.throws(()=>retainedFields({...twin,fields:[field("x",1),field("x",2)]}));
assert.equal(recordedReader(twin,{workLimit:1}).status,"hold");

const tmp=mkdtempSync(join(tmpdir(),"phaseline-reader-"));
function cliRead(table,queries,limits={}) {
  const files=[table,queries,limits].map((v,i)=>{
    const path=join(tmp,i+".json");
    writeFileSync(path,JSON.stringify(v));
    return path;
  });
  const run=spawnSync(process.execPath,[fileURLToPath(new URL("./phase.mjs",import.meta.url)),
    "retain","--read",...files],{encoding:"utf8"});
  assert.ifError(run.error);
  return [run.status,JSON.parse(run.stdout)];
}
try {
  const [ok,full]=cliRead(twin,[[1,true],[2,false]]);
  assert.equal(ok,0);assert.equal(full.status,"read");assert.equal(full.recorded,2);
  assert.equal(full.queryWork,8);assert.equal(full.work,full.indexWork+full.queryWork);
  const [held,mixed]=cliRead(twin,[[1,true],[2,true]]);
  assert.equal(held,2);assert.equal(mixed.status,"read_with_holds");
  assert.deepEqual([mixed.recorded,mixed.held,mixed.unprocessed],[1,1,0]);
  assert.equal(mixed.calls[0].answers[0].value,"go");assert.equal(mixed.calls[1].status,"unseen_record");
  const [ambiguous,now]=cliRead(blind,[["draft"]]);
  assert.equal(ambiguous,2);assert.deepEqual(now.calls[0],partial);
  assert.equal(cliRead(twin,[])[1].reason,"no_observations");
  assert.equal(cliRead(twin,[])[0],2);
  assert.equal(cliRead(twin,[[1,true]],{workLimit:0})[1].unprocessed,1);
  const [cost,short]=cliRead(twin,[[1,true],[2,false],[1,true]],{workLimit:full.work-1});
  assert.equal(cost,2);assert.equal(short.calls[1].reason,"work_limit");
  assert.equal(short.work,full.work-1);assert.deepEqual([short.recorded,short.held,short.unprocessed],[1,2,1]);
  assert.equal(cliRead(twin,[[1,true],[2,false]],{workLimit:full.work})[0],0);
} finally {rmSync(tmp,{recursive:true,force:true});}

const native=regimeTable(read("retention-proposed.phase"),JSON.parse(read("retention-regime.json")));
assert.equal(retainedFields(native).minimumPrice,3);

// Independent oracle: enumerate all subsets and all reachable pairs, without refinement.
function brute(t) {
  const rows=t.rows, n=t.fields.length;
  const byId=new Map(rows.map((r,i)=>[r.id,i]));
  let best=null;
  for (let mask=0;mask<(1<<n);mask++) {
    const ids=t.fields.flatMap((_,j)=>mask & (1<<j)?[j]:[]);
    const price=ids.reduce((v,j)=>v+t.fields[j].price,0);
    if (best && (price>best[0] || (price===best[0] && ids.length>=best[1]))) continue;
    const seen=new Set(), queue=[];
    for(let a=0;a<rows.length;a++) for(let b=a+1;b<rows.length;b++)
      if(ids.every(i=>rows[a].values[i]===rows[b].values[i])) queue.push([a,b]);
    let ok=true;
    while(queue.length && ok) {
      const [a,b]=queue.pop(),k=a+","+b;
      if(seen.has(k)) continue;
      seen.add(k);
      if(rows[a].answers.some((v,j)=>v!==rows[b].answers[j])) {ok=false;break;}
      for(let j=0;j<t.actions.length;j++) queue.push([byId.get(rows[a].next[j]),byId.get(rows[b].next[j])]);
    }
    if(ok) best=[price,ids.length];
  }
  return best;
}
let seed=20261123;
const pick=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed>>>7)%n;};
let feasible=0,blockedCount=0;
for(let trial=0;trial<500;trial++) {
  const n=2+pick(8),f=pick(7),actionCount=pick(3);
  const fields=Array.from({length:f},(_,j)=>field("field"+j,pick(5)));
  const rows=Array.from({length:n},(_,i)=>row(String(i),fields.map(()=>pick(3)),[pick(2)],
    Array.from({length:actionCount},()=>String(pick(n)))));
  const t=schema(fields,rows,Array.from({length:actionCount},(_,i)=>"a"+i)), oracle=brute(t);
  const got=retainedFields(t);
  if(oracle) {
    feasible++;assert.equal(got.status,"minimum");assert.deepEqual([got.minimumPrice,got.fields.length],oracle);
    for(const n of got.necessities) {
      const ids=n.witness.histories.map(x=>+x);
      for(const name of got.fields.filter(k=>k!==n.without)) {
        const j=fields.findIndex(v=>v.name===name);assert.equal(rows[ids[0]].values[j],rows[ids[1]].values[j]);
      }
    }
  } else {blockedCount++;assert.equal(got.status,"unavailable");}
}
console.log(JSON.stringify({explicitCases:"passed",randomTables:500,feasible,unavailable:blockedCount}));
