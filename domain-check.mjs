import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {writeFileSync,mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {compareContracts,decide} from "./evidence-source.mjs";
import {analyze} from "./inquiry.mjs";
import {retain} from "./retention.mjs";

const declaration="fact temp in deg range -40..85 from sensor.temp owner operator";
const rule=expr=>declaration+"\nguarantee alarm when "+expr;
const negative=rule("temp < 0 deg"), zero=rule("temp <= 0 deg");
const changed=compareContracts(negative,zero);
assert.deepEqual(changed.result.changes[0].witness,{temp:0});
assert.equal(compareContracts(rule("temp < -41 deg"),rule("false")).result.changes.length,0);
assert.equal(compareContracts(rule("temp <= 86 deg"),rule("true")).result.changes.length,0);
const packet=value=>({subject:"meter",at:1,asOf:2,records:[
  {subject:"meter",at:1,recorded:2,source:"sensor.temp",by:"operator",value}
]});
for(const [temp,status] of [[-41,"hold"],[-40,"release"],[-1,"release"],[0,"withhold"],[85,"withhold"],[86,"hold"]])
  assert.equal(decide(negative,packet(temp)).alarm.status,status);
for(const declarationError of ["85..-40","-9007199254740992..0","0..1.5","forty..80"])
  assert.throws(()=>compareContracts(negative.replace("-40..85",declarationError),zero));
assert.throws(()=>compareContracts(negative,negative.replace("-40..85","-41..85")),/domain migration/);
assert.throws(()=>compareContracts(negative,negative.replaceAll("deg","kelvin")),/fact types/);
assert.equal(compareContracts(negative,negative.replace("owner operator","owner operator missing hold_dependents")).bindings.length,0);
assert.throws(()=>compareContracts(negative,negative.replace("owner operator","owner operator missing allow")));
const quantity="fact order_total in EUR_cents range 0..1000 from pos.total owner shop\nguarantee gift when order_total = 0 EUR_cents";
assert.deepEqual(compareContracts(quantity,quantity.replace("= 0","> 0")).result.changes[0].witness,{order_total:0});
assert.equal(compareContracts("guarantee ok when order_total > 0 USD_cents","guarantee ok when true").result.changes.length,0);
assert.throws(()=>compareContracts(quantity,quantity.replaceAll("EUR_cents","USD_cents")),/fact types/);
const renamed="fact order_total from form.entered owner clerk\nguarantee confirmed when order_total";
assert.equal(compareContracts(renamed,renamed).result.changes.length,0);
const observer="question alarm\nobserve temp\nbudget 0";
const cases={histories:[{id:"cold",facts:{temp:-2}},{id:"warm",facts:{temp:2}}]};
assert.deepEqual(analyze(negative,observer,cases).cells.map(c=>c.answer),[true,false]);
const regime={questions:["alarm"],observe:["temp"],offers:{},budget:0,actions:["wait"],
  states:cases.histories.map(r=>({...r,next:{wait:r.id}}))};
assert.equal(retain(negative,regime).issued.classes.length,2);
assert.throws(()=>retain(negative,{...regime,states:[{id:"outside",facts:{temp:90},next:{wait:"outside"}}]}),/invalid fact/);
// A wide dependency set can still have exactly one relevant missing input.
const flags=Array.from({length:20},(_,i)=>"flag"+i);
const bound=flags.map(f=>"fact "+f+" from sensors."+f+" owner shop").join("\n");
const tautology=flags.slice(1).map(f=>"("+f+" or not "+f+")").join(" and ");
const wideRules=bound+"\nguarantee alarm when flag0 and "+tautology;
const empty={subject:"device",at:1,asOf:1,records:[]};
assert.deepEqual(decide(wideRules,empty).alarm,{status:"hold",needs:[{fact:"flag0",source:"sensors.flag0",owner:"shop"}]});
const observed={...empty,records:[{subject:"device",at:1,recorded:1,source:"sensors.flag0",by:"shop",value:false}]};
assert.deepEqual(decide(wideRules,observed).alarm,{status:"withhold"});
observed.records[0].value=true;
assert.deepEqual(decide(wideRules,observed).alarm,{status:"release"});
const cli=fileURLToPath(new URL("phase.mjs",import.meta.url));
const root=mkdtempSync(join(tmpdir(),"phaseline-spelling-"));
try {
  const before="guarantee save_draft when true\nguarantee persist when save_draft";
  const a=join(root,"issued.phase"), b=join(root,"proposed.phase");
  function go(source) {
    writeFileSync(a,before); writeFileSync(b,source);
    const result=spawnSync(process.execPath,[cli,"compare",a,b],{encoding:"utf8"});
    assert.equal(result.status,0,result.stderr);
    return JSON.parse(result.stdout);
  }
  const typo=go(before.replace("persist when save_draft","persist when save_drft"));
  assert.equal(typo.status,"review");
  assert.equal(typo.warnings[0].fact,"save_drft");
  assert.deepEqual(typo.warnings[0].suggestions,["save_draft"]);
  const intentional=go("fact save_drft from source.short owner author\n"+before.replace("persist when save_draft","persist when save_drft"));
  assert.equal(intentional.warnings,undefined);
  assert.equal(go(before).warnings,undefined);
} finally {
  rmSync(root,{recursive:true,force:true});
}
console.log("Declared signed ranges, domain migration holds, shorthand, historical USD, observation bounds and spelling diagnostics passed.");
