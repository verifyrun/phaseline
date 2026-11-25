import assert from "node:assert/strict";
import {symbolicRetain,symbolicEncode,symbolicChallenge} from "./symbolic-retention.mjs";
import {readFileSync} from "node:fs";
const sample=name=>readFileSync(new URL(name,import.meta.url),"utf8");
const schema=JSON.parse(sample("archive-model.json"));
const archive=sample("archive-rules.phase");
const archived=symbolicRetain(archive,schema);
assert.equal(archived.states,"16");
assert.equal(archived.issued.classes.length,16);
const archivedPacket=JSON.parse(sample("archive-case.json"));
assert.equal(symbolicEncode(archive,schema,archivedPacket).spent,2);
const trace=JSON.parse(sample("archive-trace.json"));
assert.equal(symbolicChallenge(archive,schema,trace).status,"consistent");
const altered=structuredClone(trace);
altered.steps.at(-1).accepted=true;
assert.equal(symbolicChallenge(archive,schema,altered).firstIncompatibleStep,3);

let rng=372611;
const rand=n=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return Math.floor(n*rng/2**32);};
const field=["x","y","z"];
function raw(i){return Object.fromEntries(field.map((k,j)=>[k,Boolean(i&(1<<j))]));}
const rowCode=f=>field.reduce((s,k,j)=>s+(f[k]?1<<j:0),0);
function expr(table) {
  const terms=table.flatMap((on,i)=>on?["("+field.map((k,j)=>(i&(1<<j))?k:"not "+k).join(" and ")+")"]:[]);
  return terms.join(" or ")||"false";
}
const range=Array.from({length:8},(_,i)=>i);
const table=()=>range.map(()=>Boolean(rand(2)));
const packet=world=>({subject:"archive",at:1,asOf:1,records:Object.entries(world).map(([k,value])=>
  ({at:1,recorded:1,subject:"archive",source:"s."+k,by:"reader",value}))});
let comparisons=0,issues=0,changed=0,disabledFirst=0,reachableTotal=0;
for(let trial=0;trial<120;trial++) {
  const allowed=[table(),table()],goals=table(),revised=table(),initial=table();
  initial[0]=true;
  const moves=[range.map(()=>rand(8)),range.map(()=>rand(8))];
  const rules=field.map(k=>"fact "+k+" from s."+k+" owner reader");
  rules.push("guarantee begin when "+expr(initial));
  const actions={};
  const names=["alpha","beta"];
  for(const [a,n] of names.entries()) {
    rules.push("guarantee ok_"+n+" when "+expr(allowed[a]));
    const set={};
    for(const [j,k] of field.entries()) {
      const id=n+"_"+k;
      rules.push("guarantee "+id+" when "+expr(moves[a].map(to=>Boolean(to&(1<<j)))));
      set[k]={rule:id};
    }
    actions[n]={enabledWhen:"ok_"+n,set};
  }
  const source=rules.join("\n")+"\nguarantee decide when "+expr(goals);
  const nextSource=rules.join("\n")+"\nguarantee decide when "+expr(revised);
  const spec={form:"finite-variables/1",variables:{x:"boolean",y:"boolean",z:"boolean"},initial:"begin",questions:["decide"],actions,
    observe:field.slice(0,rand(4))};
  const scan=range.filter(i=>initial[i]),seen=new Set(scan);
  for(let j=0;j<scan.length;j++) for(let a=0;a<2;a++) {
    const s=scan[j],t=moves[a][s];
    if(allowed[a][s]&&!seen.has(t)){seen.add(t);scan.push(t);}
  }
  function separator(x,y,truth) {
    const frontier=[[x,y,0]],visited=new Set();
    let cost=Infinity;
    for(let i=0;i<frontier.length;i++) {
      const [a,b,n]=frontier[i],key=a+","+b;
      if(visited.has(key)||n>=cost) continue;
      visited.add(key);
      if(truth[a]!==truth[b]) {cost=Math.min(cost,n);continue;}
      for(let m=0;m<2;m++) {
        if(allowed[m][a]!==allowed[m][b]) cost=Math.min(cost,n+1);
        else if(allowed[m][a]) frontier.push([moves[m][a],moves[m][b],n+1]);
      }
    }
    return cost;
  }
  const r=symbolicRetain(source,spec,nextSource);
  assert.equal(Number(r.states),scan.length);
  reachableTotal+=scan.length;
  const full={...spec,observe:field};
  const codes=xs=>Object.fromEntries(scan.map(s=>[s,symbolicEncode(xs,full,packet(raw(s))).code]));
  const a=codes(source),b=codes(nextSource);
  assert.equal(r.issued.classes.reduce((s,c)=>s+Number(c.count),0),scan.length);
  const counts=new Map();
  for(const left of scan) for(const right of scan) {
    const eq=separator(left,right,goals)===Infinity;
    assert.equal(a[left]===a[right],eq);
    assert.equal(b[left]===b[right],separator(left,right,revised)===Infinity);
    assert.equal(r.migration.decoder[a[left]].includes(b[right]),
      scan.some(k=>a[k]===a[left] && b[k]===b[right]));
    comparisons++;
  }
  for(const world of scan) counts.set(a[world],(counts.get(a[world])??0)+1);
  assert.equal(counts.size,r.issued.classes.length);
  for(const c of r.issued.classes) {
    assert.equal(Number(c.count),counts.get(c.code));
    const rep=rowCode(c.example);
    assert.ok(seen.has(rep));
    assert.equal(a[rep],c.code);
    assert.equal(c.answers[0],goals[rep]);
    for(let op=0;op<2;op++) assert.equal(c.next[op],allowed[op][rep]?a[moves[op][rep]]:null);
  }
  const enc=r.issued.encoder;
  const insufficient=scan.some(i=>scan.some(j=>a[i]!==a[j]&&spec.observe.every(k=>raw(i)[k]===raw(j)[k])));
  assert.equal(enc.status==="unavailable_from_snapshot",insufficient);
  if(insufficient) {
    issues++;
    const [x,y]=enc.examples.map(rowCode);
    assert.equal(enc.experiment.after.length,separator(x,y,goals));
    if(enc.experiment.action) disabledFirst++;
  }
  if(r.migration.witness) {
    changed++;
    const [x,y]=r.migration.witness.examples.map(rowCode);
    assert.equal(a[x],a[y]);assert.notEqual(b[x],b[y]);
    assert.equal(r.migration.witness.experiment.after.length,separator(x,y,revised));
  }
}
assert.ok(disabledFirst && changed && issues);
const declarations=Array.from({length:24},(_,i)=>"fact flag"+i+" from s.flag"+i+" owner reader");
const detailed=declarations.join("\n")+"\nguarantee current when flag0\nguarantee old when flag1";
const variables=Object.fromEntries(Array.from({length:24},(_,i)=>["flag"+i,"boolean"]));
const large={form:"finite-variables/1",variables,questions:["current"],actions:{promote:{set:{flag0:{from:"flag1"}}}},observe:["flag0","flag1"]};
const many=symbolicRetain(detailed,large);
assert.equal(many.states,String(2**24));
assert.equal(many.issued.classes.length,4);
assert.ok(many.issued.classes.every(c=>Number(c.count)===2**22));
const shift={...large,variables:Object.fromEntries(Object.entries(variables).slice(0,12)),
  actions:{rotate:{set:Object.fromEntries(Array.from({length:12},(_,i)=>["flag"+i,{from:"flag"+((i+1)%12)}]))}}};
assert.throws(()=>symbolicRetain(detailed,shift),/2048 retained classes/);
// A 64-step counter with four switches has 1,024 reachable states and needs every one.
// The smaller comparison ceiling refused it. Retention has its own, so this is answered.
const counted=Array.from({length:4},(_,i)=>"fact flag"+i+" from s.flag"+i+" owner o").join("\n")+
  "\nfact count in tick range 0..63 from s.count owner o"+
  "\nguarantee go when (flag0 or flag1) and count >= 31 tick and not flag3"+
  "\nguarantee early when flag2 and count < 3 tick\nguarantee room when count < 63 tick";
const counter={form:"finite-variables/1",questions:["go","early"],
  variables:{flag0:"boolean",flag1:"boolean",flag2:"boolean",flag3:"boolean",count:{range:[0,63]}},
  actions:{tick:{enabledWhen:"room",set:{count:{from:"count",plus:1}}},reset:{set:{count:0}},
    ...Object.fromEntries([0,1,2,3].flatMap(i=>[["on"+i,{set:{["flag"+i]:true}}],["off"+i,{set:{["flag"+i]:false}}]]))}};
const stepped=symbolicRetain(counted,counter);
assert.equal(stepped.states,"1024");
assert.equal(stepped.issued.classes.length,1024);
assert.equal(stepped.issued.fixedWidthBits,10);
const drop=structuredClone(schema);
drop.actions.next_crate.enabledWhen="intake";
assert.throws(()=>symbolicRetain(archive,drop),/leaves its admissible domain/);
const changedGraph=archive.replace("guarantee intake when not open","guarantee intake when open");
assert.throws(()=>symbolicRetain(archive,schema,changedGraph),/changed|migration/i);
const differentGrant=archive.replace("scanner.signed owner conservator","scanner.signed owner curator");
assert.throws(()=>symbolicRetain(archive,schema,differentGrant),/source migration/);
console.log(JSON.stringify({randomMachines:120,reachableStates:reachableTotal,orderedPairDecisions:comparisons,
  inaccessibleSnapshot:issues,shortestWordEndsInRefusal:disabledFirst,migrationsRequiringMoreInformation:changed,
  wideReachableStates:many.states,wideClasses:many.issued.classes.length,shiftRegisterHeldAt:2048}));
