// The caller binds its own project schema and the enrolled confirmation policy.
import {readFileSync,writeFileSync} from "node:fs";
import {decide,suggestPrerequisite} from "@verifyrun/phaseline";
const read=p=>JSON.parse(readFileSync(p,"utf8"));
const [schema,train,past,raw,destination,target="Hotels_4",method="ReserveHotel"] = process.argv.slice(2);
const fields = read(schema).find(s=>s.service_name===target).intents.find(i=>i.name===method).required_slots;
const candidate=suggestPrerequisite(read(train));
const rawStates=read(raw);
const results={};
function check(keys,known) {
  const rules=keys.map(k=>"fact "+k+" from user."+k+" owner reader").join("\n")+"\nguarantee ready when "+keys.join(" and ");
  const records=keys.filter(k=>known.has(k)).map(k=>({subject:"case",at:1,recorded:1,source:"user."+k,by:"reader",value:true}));
  const result=decide(rules,{subject:"case",at:1,asOf:1,records}).ready;
  const missing=(result.needs??[]).map(n=>n.fact);
  // Collect concrete parameters first. Then ask the owner to confirm those details.
  const asks=missing.filter(k=>k!=="approval");
  if(!asks.length && missing.includes("approval")) asks.push("approval");
  const wording={check_in_date:"What date would you like to check in?",stay_length:"How many nights will you stay?",
    place_name:"Which hotel would you like to reserve?",location:"In which city?",
    approval:"Do you approve the reservation details just shown?"};
  return {ready:result.status==="release",asks,question:wording[asks[0]]??null};
}
for(const [id,r] of Object.entries(read(past))) {
  const known=new Set(Object.keys(r.known).filter(k=>r.known[k].length));
  const observed=new Set(r.seen);
  const rawEvidence=new Set(rawStates[id]);
  const rawKnown=new Set([...rawEvidence].filter(k=>k.startsWith("slot.")).map(k=>k.slice(5)));
  const row={no_receiver_policy:{ready:false,asks:[],question:null}, inputs:check(fields,known), raw_inputs:check(fields,rawKnown)};
  for(const [name,have,events] of [["",known,observed],["raw_",rawKnown,rawEvidence]]) {
    const suggested = candidate.status==="candidate" && candidate.features.every(k=>events.has(k));
    const scoped = suggested && events.has("previous.CONFIRM") && !events.has("user.NEGATE") && !events.has("user.INFORM");
    row[name+"association"]=check([...fields,"approval"],new Set([...have,...(suggested?["approval"]:[])]));
    row[name+"receiver"]=check([...fields,"approval"],new Set([...have,...(scoped?["approval"]:[])]));
  }
  // A statistical dialogue-act estimate alone can accept an unrelated "yes".
  const priorText = r.text.at(-2)?.[1] ?? "", userText = r.text.at(-1)?.[1] ?? "";
  const offered = /\b(confirm|confirmation|correct|is that right|sound right|sound good|is that okay)\b/i.test(priorText);
  const assent = /\b(yes|yep|yeah|correct|right|confirm|perfect|absolutely|please do|go ahead|sounds good|sounds great|sounds fine|sounds (?:quite )?alright|book it|that works)\b/i.test(userText);
  const changed = /\b(no|nope|actually|instead|change|different|except|rather|wrong|wait|cancel)\b/i.test(userText);
  const scopedRaw = rawEvidence.has("previous.CONFIRM") && rawEvidence.has("user.AFFIRM") &&
    !rawEvidence.has("user.NEGATE") && !rawEvidence.has("user.INFORM");
  row.raw_quoted=check([...fields,"approval"],new Set([...rawKnown,...(scopedRaw && offered && assent && !changed?["approval"]:[])]));
  results[id]=row;
}
writeFileSync(destination,JSON.stringify({candidate,results}));
