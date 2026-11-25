// Independent reference predicates enumerate both truth values and every integer
// in a domain extending past every boundary used in the test expressions.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {readFileSync} from "node:fs";
import {compareContracts,decide,enumeratedDifference} from "./evidence-source.mjs";
import {readEdition} from "./contract-language.mjs";
import {readJSON} from "./exact-json.mjs";
const file=name=>readFileSync(new URL(name,import.meta.url),"utf8");
const declarations=[
  "fact paid from billing.active owner ops missing hold_dependents",
  "fact legacy from terms.legacy owner contracts missing hold_dependents",
  "fact qty in seats from billing.qty owner ops missing hold_dependents"
].join("\n");
const samples=[
  ["false",()=>false],["true",()=>true],["paid",p=>p],["not paid",p=>!p],
  ["paid unless paid",()=>false],["paid or not paid",()=>true],
  ["paid and (legacy or qty >= 3 seats)",(p,l,q)=>p&&(l||q>=3)],
  ["paid and (legacy or qty > 3 seats)",(p,l,q)=>p&&(l||q>3)],
  ["not (paid or legacy) unless qty < 2 seats",(p,l,q)=>!(p||l)&&q>=2],
  ["paid or legacy and qty = 4 seats",(p,l,q)=>p||(l&&q===4)],
  ["qty <= 2 seats or legacy",(p,l,q)=>q<=2||l],
  ["qty >= 0 seats",()=>true],["qty < 0 seats",()=>false]
];
const source=expr=>declarations+"\nguarantee follow when outcome\nguarantee outcome when "+expr;
const all=[];
for(const paid of [false,true]) for(const legacy of [false,true]) for(let qty=0;qty<=6;qty++) all.push({paid,legacy,qty});
const answer=(f,w)=>f(w.paid??false,w.legacy??false,w.qty??0);
let pairs=0;
for(const [a,left] of samples) for(const [b,right] of samples) {
  const expected=all.some(w=>answer(left,w)!==answer(right,w));
  const result=compareContracts(source(a),source(b)).result;
  assert.equal(result.changes.length,expected?2:0,a+" → "+b);
  for(const c of result.changes) {
    assert.equal(c.before,answer(left,c.witness)); assert.equal(c.after,answer(right,c.witness));
    assert.notEqual(c.before,c.after);
  }
  pairs++;
}

const packet={subject:"shop",at:5,asOf:8,records:[]};
const mapping={paid:["billing.active","ops"],legacy:["terms.legacy","contracts"],qty:["billing.qty","ops"]};
const record=(id,value)=>({subject:"shop",at:5,recorded:6,source:mapping[id][0],by:mapping[id][1],value});
const signed=record("paid",true), withdrawn={...signed,recorded:7,value:false};
const approvalNeed={fact:"paid",source:"billing.active",owner:"ops"};
const conflict={...approvalNeed,reason:"conflicting_evidence",
  observations:[{recorded:6,value:true},{recorded:7,value:false}]};
const review=(records,extra={})=>decide(source("paid"),{...packet,records,...extra}).outcome;
assert.deepEqual(review([]),{status:"hold",needs:[approvalNeed]});
for (const rows of [[signed,withdrawn],[withdrawn,signed,signed]]) {
  assert.deepEqual(review(rows),{status:"hold",needs:[conflict]});
  assert.deepEqual(review(rows,{asOf:6}),{status:"release"});
}
assert.deepEqual(review([withdrawn]),{status:"withhold"});
assert.deepEqual(review([signed,{...signed,recorded:7}]),{status:"release"});
const simultaneous={...withdrawn,recorded:signed.recorded};
assert.deepEqual(review([signed,simultaneous]),review([simultaneous,signed]));
assert.deepEqual(review([signed,{...withdrawn,value:"false"}]).needs,[{...approvalNeed,reason:"invalid_evidence"}]);
for (const changes of [{by:"other"},{subject:"other"},{at:4},{recorded:9}]) {
  assert.deepEqual(review([signed,{...withdrawn,...changes}]),{status:"release"});
}
const extras=Array.from({length:17},(_,i)=>"extra_"+i);
const wideRule=[declarations,...extras.map(f=>"fact "+f+" from source."+f+" owner ops"),
  "guarantee go when paid and "+extras.join(" and ")].join("\n");
assert.deepEqual(decide(wideRule,{...packet,records:[signed,withdrawn]}).go.needs.find(n=>n.fact==="paid"),conflict);
assert.deepEqual(decide(source("true or paid"),{...packet,records:[signed,withdrawn]}).outcome,{status:"release"});
const unread={...signed,source:"recall.notice"};
const explained=decide(source("paid"),{...packet,records:[signed,unread,{...unread,subject:"other"},
  {...unread,at:4},{...unread,recorded:9},{...withdrawn,by:"other"}]},{explain:true});
assert.equal(explained.undeclaredSourceRecords,1);
assert.deepEqual(explained.actions.outcome,{status:"release"});
assert.equal(decide(source("paid"),{...packet,records:[signed,
  {...unread,get value(){throw Error("Read a value from an undeclared source");}}]},{explain:true}).undeclaredSourceRecords,1);
let packets=0;
for(const [expr,predicate] of samples) for(const paid of [undefined,false,true])
for(const legacy of [undefined,false,true]) for(const qty of [undefined,0,1,2,3,4,5,6]) {
  const given={paid,legacy,qty};
  const records=Object.entries(given).filter(([,v])=>v!==undefined).map(([k,v])=>record(k,v));
  const compatible=all.filter(w=>Object.keys(w).every(k=>given[k]===undefined || given[k]===w[k]));
  const outcomes=new Set(compatible.map(w=>answer(predicate,w)));
  const expected=[...Object.keys(given)].filter(k=>compatible.some(w=>compatible.some(v=>
    Object.keys(given).every(j=>j===k || w[j]===v[j]) && answer(predicate,w)!==answer(predicate,v))));
  const actions=decide(source(expr),{...packet,records});
  for(const action of Object.values(actions)) {
    assert.equal(action.status,outcomes.size===2?"hold":outcomes.has(true)?"release":"withhold");
    assert.deepEqual((action.needs??[]).map(n=>n.fact).sort(),expected.sort());
  }
  packets++;
}
const issued=file("plans-issued.phase"), proposed=file("plans-proposed.phase"), account=JSON.parse(file("plans-records.json"));
const changes=compareContracts(issued,proposed).result.changes;
assert.deepEqual(changes.map(c=>c.id),["exports","scheduled_export"]);
assert.deepEqual(changes[0].witness,{seat_count:10,paid:true,grandfathered:false});
assert.equal(decide(issued,account).exports.status,"release");
assert.deepEqual(decide(proposed,account).exports.needs,[{fact:"grandfathered",source:"terms.legacy",owner:"contracts"}]);
assert.equal(decide(proposed,account).view_records.status,"release");
const observation={subject:account.subject,at:10,recorded:12,source:"terms.legacy",by:"contracts",value:true};
for(const invalid of [{subject:"other"},{at:9},{recorded:13},{by:"other"},{source:"old.terms"},{value:1}])
  assert.equal(decide(proposed,{...account,records:[...account.records,{...observation,...invalid}]}).exports.status,"hold");
assert.equal(decide(proposed,{...account,records:[...account.records,observation,{...observation,value:false}]}).exports.status,"hold");
assert.equal(decide(proposed,{...account,records:[...account.records,observation]}).exports.status,"release");
assert.equal(decide(proposed,{...account,records:[...account.records,{...observation,value:false}]}).exports.status,"withhold");
assert.throws(()=>compareContracts(declarations+"\nfact second_name from billing.active owner ops missing hold_dependents\nguarantee go when paid and not second_name",issued),/one fact name/);
assert.throws(()=>compareContracts(source("paid"),source("paid").replaceAll("paid","active")),/migration/);
const maximum="9007199254740991";
assert.deepEqual(compareContracts(source("qty = "+maximum+" seats"),source("false")).result.changes[0].witness,{qty:Number.MAX_SAFE_INTEGER});
assert.throws(()=>compareContracts(source("qty > 2 days"),issued),/declared unit/);
assert.throws(()=>compareContracts(source("qty > 9007199254740992 seats"),issued),/exact/);
assert.throws(()=>compareContracts("guarantee x when y\nguarantee y when x",issued),/circular/);
assert.throws(()=>compareContracts(source("qty"),issued),/quantity/);
assert.throws(()=>compareContracts(source("qty = 1 seats"),"guarantee result when qty"),/Incompatible/);
for(const n of [8,9,16,32,64,128]) {
  const lines=Array.from({length:n},(_,i)=>"guarantee p_"+i+" when f_"+i);
  const {result}=compareContracts(lines.join("\n"),lines.map(s=>s.replace("when ","when not ")).join("\n"));
  assert.equal(result.changes.length,n); assert.equal(result.combinations,2*n);
}
const wide=Array.from({length:17},(_,i)=>"f_"+i).join(" and ");
assert.throws(()=>compareContracts(source(wide),source("true"),enumeratedDifference),/65,536/);
assert.equal(compareContracts(source(wide),source("true")).result.changes.length,2);
const joint=Array.from({length:16},(_,i)=>"f_"+i).join(" and ");
const repeated=Array.from({length:16},(_,i)=>"guarantee x_"+i+" when "+joint).join("\n");
assert.throws(()=>compareContracts(repeated,repeated.replaceAll(" and "," or "),enumeratedDifference),/1,000,000/);
assert.equal(compareContracts(repeated,repeated.replaceAll(" and "," or ")).result.changes.length,16);
// Forty pairs whose names sort apart. The diagram follows the rule's own grouping, so this
// is answered by the built-in engine, with the same first case the alphabetical order defines.
const lefts=Array.from({length:40},(_,i)=>"left_"+i), rights=Array.from({length:40},(_,i)=>"right_"+i);
const paired="guarantee pairs when "+lefts.map((l,i)=>"("+l+" and "+rights[i]+")").join(" or ");
const crossed=compareContracts(paired,paired+" or (left_0 and right_1)").result.changes;
assert.deepEqual(crossed.map(c=>c.id),["pairs"]);
assert.deepEqual(Object.entries(crossed[0].witness).filter(([,v])=>v).map(([k])=>k),["left_0","right_1"]);
assert.equal(compareContracts(paired,"guarantee pairs when "+lefts.map((l,i)=>"("+rights[i]+" and "+l+")").reverse().join(" or ")).result.changes.length,0);
// An edition that declares a source and owner for each of 1,000 facts is within the size limit.
const declared=Array.from({length:1000},(_,i)=>"d_"+i);
const declaredHead=[...declared,"extra"].map(f=>"fact "+f+" from s."+f+" owner o_"+f).join("\n")+"\n";
const declaredOld=declaredHead+"guarantee all when "+declared.join(" and ");
assert.ok(declaredOld.length>40000);
assert.deepEqual(compareContracts(declaredOld,declaredOld+" and extra").result.changes.map(c=>c.id),["all"]);
assert.equal(compareContracts(declaredOld,declaredHead+"guarantee all when "+declared.toReversed().join(" and ")).result.changes.length,0);
assert.throws(()=>compareContracts("guarantee g when a\n"+" ".repeat(200000),"guarantee g when a"),/200,000 characters/);
const path=name=>fileURLToPath(new URL(name,import.meta.url));
const explainedRun=spawnSync(process.execPath,[path("phase.mjs"),"decide","--explain",
  path("plans-proposed.phase"),path("plans-records.json")],{encoding:"utf8"});
assert.equal(explainedRun.status,0,explainedRun.stderr);
assert.deepEqual(JSON.parse(explainedRun.stdout),JSON.parse(JSON.stringify(decide(proposed,account,{explain:true}))));
// The gate is opt-in: without it a completed evaluation exits 0 whatever it decided.
const gated=(...flags)=>spawnSync(process.execPath,[path("phase.mjs"),"decide",...flags,
  path("plans-proposed.phase"),path("plans-records.json")],{encoding:"utf8"});
assert.equal(gated().status,0);
assert.equal(gated("--gate","view_records").status,0);
assert.equal(gated("--gate","exports").status,2);
assert.equal(gated("--gate","exports").stdout,gated().stdout);
assert.equal(gated("--explain","--gate","exports").status,2);
assert.equal(gated("--gate","exports","--explain").stdout,explainedRun.stdout);
assert.equal(gated("--gate","undeclared").status,1);
assert.equal(gated("--gate").status,1);
assert.equal(gated("--gate","exports","--gate","exports").status,1);
for(const [a,b,code,status] of [
  ["plans-issued.phase","plans-issued.phase",0,"preserved"],
  ["plans-issued.phase","plans-proposed.phase",2,"review"],
  ["plans-issued.phase","plans-records.json",1,"hold"]]) {
  const run=spawnSync(process.execPath,[path("phase.mjs"),"check",path(a),path(b)],{encoding:"utf8"});
  assert.equal(run.status,code); assert.equal(JSON.parse(run.stdout||run.stderr).status,status);
}
// A mistaken command or unreadable file gets a short reason that names the problem.
const refusal=(...words)=>{const run=spawnSync(process.execPath,[path("phase.mjs"),...words],{encoding:"utf8"});
  assert.equal(run.status,1); return JSON.parse(run.stderr).reason;};
assert.match(refusal("bogus"),/^Unknown command: bogus\./);
assert.match(refusal("decide"),/^Usage:\nphaseline decide /);
assert.ok(refusal("compare").length<500);
assert.equal(refusal("compare","no-such.phase",path("plans-issued.phase")),"No file at no-such.phase.");
assert.match(refusal("decide",path("plans-issued.phase"),path("plans-issued.phase")),/plans-issued\.phase is not valid JSON\.$/);
assert.match(refusal("compare",path("plans-issued.phase"),path(".")),/is a directory/);
assert.throws(()=>readEdition("// note\nguarantee g when a"),/Line 1: Start each line with fact, guarantee or #/);
// Notes change nothing: an edition with notes compares as preserved and decides the same.
{ const plain="fact a from s.a owner o\nguarantee g when a", noted="# refund rules\nfact a from s.a owner o\n  # who may release\nguarantee g when a\n#end";
  assert.equal(compareContracts(plain,noted).result.changes.length,0);
  const one={subject:"s",at:1,asOf:2,records:[{subject:"s",at:1,recorded:1,source:"s.a",by:"o",value:true}]};
  assert.deepEqual(JSON.parse(JSON.stringify(decide(noted,one))),JSON.parse(JSON.stringify(decide(plain,one))));
  assert.throws(()=>readEdition("guarantee g when a # trailing"),/Line 1/); }
assert.throws(()=>readEdition("guarantee g when a\nguarantee g when b"),/Line 2: Repeated guarantee: g/);
assert.throws(()=>readEdition("guarantee g when a AND b"),/Write and in lowercase/);
assert.throws(()=>readEdition("guarantee g when n != 3 items"),/Line 1: Unexpected "!"\. .*no !=/);
assert.throws(()=>readEdition("guarantee g when a + b <= 3 items"),/Unexpected "\+"/);
assert.throws(()=>readEdition("guarantee g when amount <= limit"),/cannot be compared with another fact/);
assert.match(refusal("bogus"),/--help all/);
const helpRun=words=>spawnSync(process.execPath,[path("phase.mjs"),...words],{encoding:"utf8"}).stdout.trim().split("\n").length;
assert.ok(helpRun(["--help"])<=12 && helpRun(["--help","all"])>30);
// A misspelled or repeated field in a case is refused instead of being ignored.
const caseText='{"subject":"s","at":1,"asOf":2,"records":[]';
assert.throws(()=>decide("fact a from s.a owner o\nguarantee g when a",JSON.parse(caseText+',"recrods":[]}')),/Unknown field in the case: recrods/);
assert.throws(()=>readJSON(caseText+',"subject":"t"}'),/"subject" appears twice/);
assert.throws(()=>readJSON('{"records":[{"value":false,"value":true}]}'),/"value" appears twice/);
assert.deepEqual(readJSON('{"a":"x\\": {","b":[{"a":1},{"a":2}],"c":{"a":":"}}').b,[{a:1},{a:2}]);
// A fact may say which of its records count: the latest one, and only recent ones.
{ const row=(recorded,value,by="ci")=>({subject:"b",at:100,recorded,source:"ci.result",by,value});
  const run=(line,records,asOf=200)=>JSON.parse(JSON.stringify(decide(line+"\nguarantee deploy when passed",{subject:"b",at:100,asOf,records}).deploy));
  const plainFact="fact passed from ci.result owner ci";
  assert.equal(run(plainFact,[row(120,false),row(150,true)]).needs[0].reason,"conflicting_evidence");
  assert.deepEqual(run(plainFact+" latest",[row(120,false),row(150,true)]),{status:"release"});
  assert.deepEqual(run(plainFact+" latest",[row(150,true),row(120,false)]),{status:"release"});
  assert.deepEqual(run(plainFact+" latest",[row(120,true),row(150,false)]),{status:"withhold"});
  assert.equal(run(plainFact+" latest",[row(150,true),row(150,false)]).needs[0].reason,"conflicting_evidence");
  assert.equal(run(plainFact+" latest",[row(120,true),row(150,"yes")]).needs[0].reason,"invalid_evidence");
  assert.deepEqual(run(plainFact+" latest",[row(120,"yes"),row(150,true)]),{status:"release"});
  assert.deepEqual(run(plainFact+" latest",[row(120,true),row(150,false,"intern")]),{status:"release"});
  assert.deepEqual(run(plainFact+" latest",[row(120,true),row(250,false)]),{status:"release"});
  assert.deepEqual(run(plainFact+" within 60",[row(150,true)]),{status:"release"});
  assert.deepEqual(run(plainFact+" within 50",[row(150,true)]),{status:"release"});
  const expired=run(plainFact+" within 49",[row(150,true)]);
  assert.equal(expired.status,"hold"); assert.equal(expired.needs[0].reason,"expired_evidence"); assert.equal(expired.needs[0].owner,"ci");
  assert.equal(run(plainFact+" within 49",[]).needs[0].reason,undefined);
  assert.deepEqual(run(plainFact+" latest within 60",[row(120,false),row(150,true)]),{status:"release"});
  assert.equal(run(plainFact+" latest within 10",[row(120,false),row(150,true)]).needs[0].reason,"expired_evidence");
  assert.equal(run(plainFact+" within 60",[row(145,false),row(150,true)]).needs[0].reason,"conflicting_evidence");
  assert.deepEqual(run(plainFact+" within 60",[row(120,false),row(150,true)]),{status:"release"});
  assert.deepEqual(run("fact passed from ci.result owner ci missing hold_dependents latest within 60",[row(150,true)]),{status:"release"});
  for(const bad of [" within 0"," within -3"," within 1.5"," latest latest"," within 5 latest"," newest"])
    assert.throws(()=>readEdition(plainFact+bad+"\nguarantee deploy when passed"),/Line 1: /,bad);
  const changed=compareContracts(plainFact+"\nguarantee deploy when passed",plainFact+" latest\nguarantee deploy when passed");
  assert.equal(changed.result.changes.length,0); assert.equal(changed.bindings.length,1); assert.equal(changed.bindings[0].after.latest,true); }
// An access request and its standing qualification keep their original event times.
{
  const event = "fact trained from hr.training owner hr";
  const rule = mode => event + mode + "\nfact requested from desk.request owner desk\nguarantee access when trained and requested";
  const rec = (at, recorded, value) => ({subject:"employee", source:"hr.training", by:"hr", at, recorded, value});
  const request = {subject:"employee", source:"desk.request", by:"desk", at:30, recorded:30, value:true};
  const check = (asOf, records, mode=" standing", requestRecord=request) =>
    decide(rule(mode), {subject:"employee", at:30, asOf, records:[requestRecord, ...records]}).access;
  const history = [rec(10,11,true), rec(40,42,false)];
  for (const [review, expected] of [[31,"release"],[41,"release"],[43,"withhold"],[31,"release"]]) {
    assert.equal(check(review,history).status,expected);
    assert.equal(check(review,history.toReversed()).status,expected);
    assert.equal(check(review,history," latest").status,"hold");
  }
  assert.equal(check(55,[...history,rec(10,50,true)]).status,"withhold"); // Late correction to an older period.
  assert.equal(check(55,[...history,rec(40,50,true)]).status,"release"); // Correction to the governing period.
  assert.equal(check(43,[history[0],rec(50,35,false)]).status,"release"); // Scheduled, not yet in force.
  assert.equal(check(51,[history[0],rec(50,35,false)]).status,"withhold");
  for (const key of ["subject","by","source"]) assert.equal(check(31,[{...history[0],[key]:"other"}]).status,"hold");
  assert.equal(check(31,[]).status,"hold");
  assert.equal(check(31,[rec(10,32,true)]).status,"hold"); // Unavailable at review.
  assert.equal(check(31,history," standing",{...request,at:10}).status,"hold"); // Event binding stays local.
  const conflict=check(45,[...history,rec(40,42,true)]);
  assert.equal(conflict.needs[0].reason,"conflicting_evidence");
  assert.deepEqual(conflict.needs[0].observations,[{at:40,recorded:42,value:false},{at:40,recorded:42,value:true}]);
  assert.equal(check(55,[...history,rec(10,54,true)]," standing within 5").needs[0].reason,"expired_evidence");
  assert.equal(check(31,[history[0],rec(25,28,"yes")]).needs[0].reason,"invalid_evidence");
  assert.equal(compareContracts(rule(" latest"),rule(" standing")).bindings[0].after.standing,true);
}
// A malformed case or record is refused by name rather than read as missing evidence.
{
  const rule="fact approved from hr.approval owner hr\nguarantee ship when approved";
  const good={subject:"a",at:1,recorded:1,source:"hr.approval",by:"hr",value:true};
  const run=(records,patch={})=>decide(rule,{subject:"a",at:1,asOf:2,records,...patch});
  assert.equal(run([good]).ship.status,"release");
  for (const [records,patch,message] of [
    [[{...good,at:"2026-01-01"}],{},/Record 1's at must be a whole number/],
    [[{...good,recorded:1.5}],{},/Record 1's recorded must be a whole number/],
    [[good,{subject:"a",at:1,recorded:1,source:"hr.approval",owner:"hr",value:true}],{},/Record 2 has unknown field owner/],
    [[{subject:"a",at:1,recorded:1,source:"hr.approval",by:"hr"}],{},/Record 1 has no value/],
    [[{...good,by:""}],{},/Record 1's by must be non-empty text/],
    [[null],{},/Record 1 must be an object/],
    [[],{at:"2026-01-01T00:00:00Z"},/case's at must be a whole number/],
    [[],{at:5},/asOf \(review time\) must not be earlier/],
    [[],{subject:7},/subject must be non-empty text/],
    [{},{},/records must be a list/],
  ]) assert.throws(()=>run(records,patch),message,String(message));
  assert.throws(()=>decide(rule,[]),/A case is a JSON object/);
  assert.equal(run([{...good,value:"true"}]).ship.needs[0].reason,"invalid_evidence"); // Well-formed record, wrong value type.
}
// "standing at event" reads what was in force at the request's own time, with every record known by the review.
{
  const rule = mode => "fact approved from hr.approval owner hr" + mode + "\nfact requested from desk.request owner desk\nguarantee access when approved and requested";
  const rec = (at, recorded, value) => ({subject:"employee", source:"hr.approval", by:"hr", at, recorded, value});
  const request = {subject:"employee", source:"desk.request", by:"desk", at:30, recorded:30, value:true};
  const check = (asOf, records, mode=" standing at event") =>
    decide(rule(mode), {subject:"employee", at:30, asOf, records:[request, ...records]}).access;
  const revokedThenRegranted = [rec(10,11,true), rec(20,22,false), rec(40,42,true)];
  assert.equal(check(45,revokedThenRegranted," standing").status,"release"); // In force at the review.
  assert.equal(check(45,revokedThenRegranted).status,"withhold"); // Not in force at the request.
  assert.equal(check(45,revokedThenRegranted.toReversed()).status,"withhold");
  assert.equal(check(31,[rec(10,11,true), rec(20,60,false)]).status,"release"); // Withdrawal not yet known.
  assert.equal(check(61,[rec(10,11,true), rec(20,60,false)]).status,"withhold"); // Learned later, still applies to the request.
  assert.equal(check(45,[rec(35,36,true)]).status,"hold"); // Granted only after the request.
  assert.equal(check(45,[rec(35,36,true)]," standing").status,"release");
  assert.equal(check(45,[rec(10,11,true), rec(40,15,false)]).status,"release"); // Scheduled after the request.
  assert.equal(check(45,[rec(10,11,true), rec(20,22,true), rec(20,22,false)]).needs[0].reason,"conflicting_evidence");
  assert.equal(check(45,[rec(10,11,true)]," standing at event within 5").needs[0].reason,"expired_evidence");
  assert.equal(check(45,[rec(10,11,true)]).status,"release");
  assert.equal(check(45,[rec(10,11,true)]).status,check(45,[rec(10,11,true)]," standing").status);
  assert.equal(check(45,[]).needs[0].atEvent,true);
  for (const bad of [" latest at event"," at event"," standing at"," standing at event latest"])
    assert.throws(()=>readEdition(rule(bad)),/Line 1: /,bad);
  const diff = compareContracts(rule(" standing"),rule(" standing at event"));
  assert.equal(diff.bindings[0].after.atEvent,true);
}
// Delayed training completion and a correction to original approval, from the audit.
{
  const rules="fact approved from hr.approval owner hr standing\nfact completed from hr.training owner hr standing\nfact requested from desk.request owner desk\nguarantee access when approved and completed and requested";
  const row=(source,by,at,recorded,value)=>({subject:"employee",source,by,at,recorded,value});
  const records=[row("hr.approval","hr",100,110,true),row("hr.training","hr",100,400,true),
    row("desk.request","desk",500,510,true),row("hr.approval","hr",100,950,false)];
  const read=(at,asOf)=>decide(rules,{subject:"employee",at,asOf,records}).access.status;
  assert.equal(read(500,500),"hold");
  assert.equal(read(500,510),"release");
  assert.equal(read(500,949),"release");
  assert.equal(read(500,950),"withhold");
  assert.equal(read(500,510),"release");
}
console.log(pairs+" edition pairs and "+packets+" partial-record cases matched the independent reference; witness, authority, units, limits and 128 independent guarantees passed.");
