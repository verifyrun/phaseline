// A source-earned historical ordering helps propose a slot. Only an actual current
// reading at that slot can become a ticket for the one-shot receiver.
import {Hold,debit,exact,grant,hash,id,need,serial,signedBy} from "./review-journal.mjs";
import {exactValue} from "./exact-json.mjs";
import {expectedRuntime} from "./behavior-port.mjs";
import {sourceValue,supportHistorical} from "./late-port.mjs";
import {bundleWidth,nextBundle,openBundle,packBundle} from "./several-targets.mjs";
import {nextAddress,packOrder,unpackOrder,width} from "./revised-decoder.mjs";

const blocks=text=>Math.max(1,Math.ceil(Buffer.byteLength(text)/256));
export const decoderOps=["pack_dictionary","route_dictionary","deliver_dictionary","record_dictionary"];
export function validateDecoder(port,op,d) {
  need(port?.decoder,"no approved historical code dictionary on this receiver");
  if(op==="route_dictionary" || op==="deliver_dictionary") {
    if(port.decoder.targets) {
      const cfg=port.decoder,targets=targetIndices(cfg),book=bundleWidth(cfg.slots.length,targets);
      need(id(d.snapshot) && (book.bits?id(d.memory):d.memory===undefined) && d.first===undefined && d.terminal===undefined &&
        Array.isArray(d.readings) && d.readings.length<=book.queries && d.readings.every(id),"supply the applicable stored record and the ordered paid current readings");
    } else need(d.readings===undefined && id(d.memory) && id(d.snapshot) && (d.first===undefined || id(d.first)) &&
      (d.terminal===undefined || (id(d.first) && id(d.terminal))),"name the retained record, current snapshot and any actual current readings");
  }
  if(op==="record_dictionary")need(id(d.attempt) && d.receipt?.body,"supply the receiving system's signed first-use outcome");
}
function targetIndices(config) {
  const labels=config.alphabet.map(serial);
  return config.targets.map(value=>labels.indexOf(serial(value)));
}
function tie(a,row,bytes) {
  return hash(["historical-dictionary/1",a.binding,row.id,row.actor,row.job,row.pulse,row.receipt,row.snapshot,row.runtime,bytes.toString("hex")]);
}
function table(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS sealed_dictionaries(id TEXT PRIMARY KEY,actor TEXT NOT NULL,job TEXT NOT NULL,pulse TEXT NOT NULL,
    receipt TEXT NOT NULL,snapshot TEXT NOT NULL,runtime TEXT NOT NULL,rank BLOB NOT NULL,binding TEXT NOT NULL)`);
}
function seal(db,a,request,config) {
  const {id:rid,data:d}=request.body;
  const alphabet=new Map(config.alphabet.map((v,i)=>[serial(v),i])),order=[];
  let source;
  for(const input of config.slots) {
    const observation=sourceValue(db,a,rid,d.job,d.pulse,input,true);
    source=observation.row;
    const label=alphabet.get(serial(observation.value));
    need(label!==undefined,"historical source returned a label outside the grant");
    order.push(label);
  }
  debit(db,rid,"rank the acquired dictionary",1+Math.ceil(order.length**2/32));
  const targets=config.targets && targetIndices(config);
  const bytes=targets?packBundle(order,targets):packOrder(order);
  const book=targets?bundleWidth(order.length,targets):width(order.length);
  need(book.bits>0,"this target set can be read directly without acquiring a historical dictionary");
  const row={id:rid,actor:request.key,job:d.job,pulse:d.pulse,receipt:source.digest,snapshot:source.snapshot,runtime:source.runtime};
  debit(db,rid,"retain the historical dictionary and provenance",blocks(bytes)+blocks(serial(row)));
  table(db);
  db.prepare("INSERT INTO sealed_dictionaries VALUES(?,?,?,?,?,?,?,?,?)")
    .run(rid,request.key,d.job,d.pulse,row.receipt,row.snapshot,row.runtime,bytes,tie(a,row,bytes));
  return {status:"memory_stored",memory:rid,job:d.job,snapshot:row.snapshot,retainedBits:book.bits,
    storedPayloadBytes:bytes.length,possibleOrders:book.states,scope:"permutation payload excluding identity and receipt metadata"};
}
function evidenceVersion(db,oldJob,newJob) {
  // Two bounded reads at the sink replace an unfunded rescan after the ticket was issued.
  // A new reading for either participating job conservatively requires a fresh decision.
  db.exec(`CREATE TABLE IF NOT EXISTS dictionary_versions(job TEXT PRIMARY KEY,revision INTEGER NOT NULL);
    CREATE TRIGGER IF NOT EXISTS dictionary_new_origin AFTER INSERT ON port_origins BEGIN
      INSERT INTO dictionary_versions VALUES(NEW.job,1) ON CONFLICT(job) DO UPDATE SET revision=revision+1;
    END;
    CREATE TRIGGER IF NOT EXISTS dictionary_new_dispute AFTER UPDATE OF disputed ON receiver_observations WHEN NEW.disputed=1 BEGIN
      INSERT INTO dictionary_versions SELECT job,1 FROM port_origins WHERE pulse=NEW.pulse
      ON CONFLICT(job) DO UPDATE SET revision=revision+1;
    END;`);
  const version=db.prepare("SELECT revision FROM dictionary_versions WHERE job=?");
  return [oldJob,newJob].map(job=>version.get(job)?.revision??0);
}
function recoveredOrder(db,a,request,config,targets) {
  const {id:rid,data:d}=request.body;
  if(targets && !bundleWidth(config.slots.length,targets).bits) {
    debit(db,rid,"construct the current full-scan order",1+blocks(serial(config)));
    return {plan:openBundle(config.slots.length,targets,Buffer.alloc(0)),oldJob:null};
  }
  table(db);
  const record=db.prepare("SELECT * FROM sealed_dictionaries WHERE id=?").get(d.memory);
  need(record && grant(db,record.actor)==="operator","the acquired dictionary is unavailable to this project");
  const old=Buffer.from(record.rank);
  need(record.binding===tie(a,record,old),"the acquired order and its evidence do not have the same binding");
  debit(db,rid,"read the original permutation and its grant",blocks(old)+blocks(serial(config))+Math.ceil(config.slots.length**2/32));
  const plan=targets?openBundle(config.slots.length,targets,old):null;
  const order=plan?plan.known:unpackOrder(config.slots.length,old);
  const owed=new Set((config.targets??[]).map(serial));
  for(const [i,input] of config.slots.entries()) {
    if(plan && order[i]===null)
      supportHistorical(db,a,rid,record.job,record.pulse,input,record,undefined,v=>owed.has(serial(v)));
    else supportHistorical(db,a,rid,record.job,record.pulse,input,record,config.alphabet[order[i]]);
  }
  return {order,plan,oldJob:record.job};
}
function route(db,a,request,config) {
  const {op,id:rid,data:d}=request.body;
  const targets=config.targets && targetIndices(config);
  const {order,plan,oldJob}=recoveredOrder(db,a,request,config,targets);
  const runtime=expectedRuntime(db,d.job),alphabet=config.alphabet.map(serial),target=targets?null:alphabet.indexOf(serial(config.target));
  const purchases=new Map();
  const read=(pulse,slot)=>{
    need(config.read.includes(slot),"current inspection is outside the enrolled read grant");
    const live=sourceValue(db,a,rid,d.job,pulse,config.slots[slot],Boolean(plan));
    if(plan && !purchases.has(pulse)) {
      const requested=live.ticket.behavior.inputs;
      need(requested.every(q=>config.read.some(i=>serial(config.slots[i])===serial(q))),"a batch includes an input outside the enrolled read grant");
      purchases.set(pulse,requested.length);
      need([...purchases.values()].reduce((sum,count)=>sum+count,0)<=plan.cap,"the selected purchases exceed the declared live-read budget");
    }
    need(live.row.snapshot===d.snapshot && live.row.runtime===runtime,"the live confirmation belongs to a different consuming edition");
    return alphabet.indexOf(serial(live.value));
  };
  let result;
  if(plan) {
    const observations=[];
    result=nextBundle(plan,observations,config.offer);
    for(const pulse of d.readings) {
      need(result.status==="inspect_bundle","the extra reading does not belong to this return");
      observations.push({slot:result.slot,label:read(pulse,result.slot)});
      result=nextBundle(plan,observations,config.offer);
    }
  } else {
    result=nextAddress(order,target,config.offer);
    if(d.first!==undefined) {
      const first=read(d.first,result.slot);
      result=nextAddress(order,target,config.offer,first);
      if(d.terminal!==undefined) {
        need(result.status==="inspect_terminal","an extra terminal reading does not belong to this route");
        result=nextAddress(order,target,config.offer,first,read(d.terminal,result.slot));
      }
    }
  }
  if(result.status==="hold")return result;
  if(result.status!=="confirmed") {
    need(config.read.includes(result.slot),"the required current inspection is outside the enrolled read grant");
    return {status:"needs_observation",stage:result.status,input:config.slots[result.slot],slot:result.slot,job:d.job,snapshot:d.snapshot};
  }
  const confirmed=plan?
    {mode:"bundle",purchasedCurrentReads:[...purchases.values()].reduce((sum,count)=>sum+count,0),slot:result.slots,input:result.slots.map(i=>config.slots[i]),target:config.targets,readings:d.readings}:
    {slot:result.slot,input:config.slots[result.slot],target:config.target,first:d.first,...(d.terminal?{terminal:d.terminal}:{})};
  const body={binding:a.binding,pending:config.request,destination:a.terms.destination,job:d.job,
    ...(d.memory?{memory:d.memory}:{}),snapshot:d.snapshot,runtime,...confirmed};
  if(op==="route_dictionary")return {...body,status:"address_confirmed",scope:"actual positive at the proposed input of the named observed edition"};
  debit(db,rid,"authorize one conditional receiver effect and its return",3+blocks(serial(body)));
  // Reserve one authenticated, bounded return before the consumer may act.
  // No other operator call can spend these units, even after a process restart.
  const returnBytes=4096+Buffer.byteLength(serial(body.target));
  debit(db,rid,"prepay the first receiving result, validation and durable return",4+2*Math.ceil(returnBytes/256));
  db.exec("CREATE TABLE IF NOT EXISTS dictionary_returns(attempt TEXT PRIMARY KEY,capacity INTEGER NOT NULL,settled TEXT UNIQUE)");
  db.prepare("INSERT INTO dictionary_returns VALUES(?,?,NULL)").run(rid,returnBytes);
  return {...body,status:"decoder_ticket",pulse:rid,returnBytes,evidenceVersion:evidenceVersion(db,oldJob,d.job)};
}
function receive(db,a,request,prepaid=false) {
  const {id:rid,data:d}=request.body;
  need(grant(db,a.terms.receiverKey)==="receiver" && signedBy("dictionary-outcome",d.receipt,a.terms.receiverKey),
    "the independently enrolled receiver must attest the first use");
  const r=d.receipt.body;
  need(exact(r,["binding","attempt","pending","destination","job","snapshot","status","slot","value","actualSnapshot","effects","effectId"]) &&
    ["consumed","stale_snapshot","source_changed","already_consumed"].includes(r.status) && exactValue(r.value) &&
    Number.isSafeInteger(r.effects) && [0,1].includes(r.effects) && id(r.actualSnapshot),"invalid first-use outcome");
  const row=db.prepare("SELECT answer,actor FROM operations WHERE id=?").get(d.attempt);
  const ticket=row?.answer && JSON.parse(row.answer);
  need(ticket?.status==="decoder_ticket" && grant(db,row.actor)==="receiver" &&
    r.binding===a.binding && d.job===ticket.job && d.attempt===r.attempt && r.job===d.job && serial(r.slot)===serial(ticket.slot) &&
    r.snapshot===ticket.snapshot && r.pending===ticket.pending && r.destination===ticket.destination,"the observed outcome is not for this issued use");
  if(!prepaid)debit(db,rid,"check the external first-use outcome",1+blocks(serial(r)));
  if(r.status!=="consumed") {
    need((r.status==="source_changed" && r.value===null && r.effects===0 && r.effectId===null) ||
      (r.status==="stale_snapshot" && r.actualSnapshot!==r.snapshot && r.value===null && r.effects===0 && r.effectId===null) ||
      (r.status==="already_consumed" && r.effects===1 && id(r.effectId) && r.effectId!==r.attempt),"invalid held first-use receipt");
    return {status:"hold",reason:r.status,actualSnapshot:r.actualSnapshot,effects:r.effects,originalEffect:r.effectId};
  }
  need(r.actualSnapshot===r.snapshot && r.effects===1 && r.effectId===r.attempt,"the receiver did not bind its actual effect to the confirmed edition");
  return {status:serial(r.value)===serial(ticket.target)?"intent_observed":"intent_mismatch",job:d.job,pending:r.pending,
    actualSnapshot:r.actualSnapshot,slot:r.slot,expected:ticket.target,observed:r.value,effects:r.effects,
    scope:"first use of the one pending request reported by the enrolled receiver"};
}
// One receiving result can use this reservation. Replays remain independently priced.
// The caller is authenticated by reserveReview, and the result is signed independently.
export function settleReservedDictionary(db,a,request) {
  const r=request.body;
  if(r.op!=="record_dictionary" || grant(db,request.key)!=="operator" ||
     !exact(r.data,["job","attempt","receipt"]) || !id(r.data.attempt) ||
     !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='dictionary_returns'").get())return;
  const pay=db.prepare("SELECT capacity,settled FROM dictionary_returns WHERE attempt=?").get(r.data.attempt);
  if(!pay || pay.settled || Buffer.byteLength(serial(r.data))>pay.capacity ||
     db.prepare("SELECT id FROM operations WHERE id=?").get(r.id))return;
  // A mistaken submission gets the ordinary priced validation path. It cannot consume the return.
  if(!signedBy("dictionary-outcome",r.data.receipt,a.terms.receiverKey))return;
  let answer;
  try {answer=receive(db,a,request,true);} catch(e) {if(!(e instanceof Hold))throw e;return;}
  db.prepare("INSERT INTO operations VALUES(?,?,?,1,?)").run(r.id,request.key,hash(r),serial(answer));
  db.prepare("UPDATE dictionary_returns SET settled=? WHERE attempt=?").run(r.id,r.data.attempt);
  return answer;
}
export function decoderStep(db,a,request) {
  const config=a.terms.behaviorPort.decoder;
  if(request.body.op==="pack_dictionary")return seal(db,a,request,config);
  if(request.body.op==="record_dictionary")return receive(db,a,request);
  return route(db,a,request,config);
}
