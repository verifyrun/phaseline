// Issue a paid first-use inspection to an enrolled atomic compare-and-publish receiver.
import {exactValue} from "./exact-json.mjs";
import {expectedRuntime} from "./behavior-port.mjs";
import {reading,version} from "./joint-decisions.mjs";
import {issuedDecision} from "./owner-question.mjs";
import {debit,exact,grant,hash,Hold,id,key,need,serial,signedBy} from "./review-journal.mjs";

const returnCapacity=4096;
const blocks=s=>Math.max(1,Math.ceil(Buffer.byteLength(s)/256));
export const guarded=a=>a.terms.behaviorPort?.question?.beforeUse==="checked/1";

function tables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS release_attempts(
    pulse TEXT PRIMARY KEY, job TEXT NOT NULL, receipt TEXT, disputed INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS release_job ON release_attempts(job);
  CREATE TABLE IF NOT EXISTS released_jobs(job TEXT PRIMARY KEY, pulse TEXT NOT NULL, release TEXT NOT NULL);`);
}
export function guardTicket(db,a,request,j,route) {
  tables(db);
  const pulse=request.body.id,decision=issuedDecision(db,a,j.id),port=a.terms.behaviorPort;
  need(!db.prepare("SELECT 1 FROM release_attempts WHERE job=? AND disputed=1").get(j.id),"the receiver gave conflicting results for this job");
  const topics=port.question.topics;
  const members=topics?version(db,topics,decision).members:[{topic:null,decision}];
  const inputs=[],expected=[],seen=new Map(),requirements=[],live=[];
  for(const m of members) {
    const r=reading(db,m.decision,pulse);
    need(r && r.choice!==null,"a release obligation has no approved reading");
    const locator=serial(r.input);
    if(!seen.has(locator)) {
      seen.set(locator,inputs.length);
      inputs.push(r.input);
      expected.push(r.expected);
    }
    const index=seen.get(locator);
    need(serial(expected[index])===serial(r.expected),"approved readings disagree at one input");
    const record=r.recordSource;
    if(record?.origin?.query.time==="at_use") {
      const q=record.origin.query;
      const port=a.terms.behaviorPort.question.recordSources.find(p=>p.key===record.sourceKey);
      need(port?.live && record.origin.live?.contract===port.live.contract && grant(db,record.sourceKey)==="version_source",
        "no current source agreement for this dispatch");
      const selection=q.keep==="chosen_record"?{selection:"chosen_record"}:{type:q.type,title:q.title};
      const entry={sourceKey:record.sourceKey,product:q.product,record:record.field.record,version:record.field.version,
        ...selection,field:q.field,valueDigest:hash(["current-field/1",r.expected])};
      if(!live.some(e=>serial(e)===serial(entry))) {
        need(live.length<32,"too many current source promises for one receiving effect");
        debit(db,pulse,"fund current-source reservation, receiver inspection and terminal reconciliation",port.live.price);
        live.push(entry);
      }
    }
    requirements.push({...m,index});
  }
  const expectedDigest=hash(["release-observations/1",expected]);
  const ticket={...route,status:"guarded_ticket",purpose:"guarded_first_use",decision,...(live.length?{live}:{}),
    port:port.id,implementation:expectedRuntime(db,j.id),inputs,requirements,expectedDigest,perInput:expected.map(v=>hash(["release-value/1",v]))};
  debit(db,pulse,"read the candidate, evaluate each distinct input and bind the observations",
    blocks(j.content)+inputs.length*port.price+blocks(serial(ticket))+blocks(serial(expected)));
  debit(db,pulse,"prepay a bounded signed outcome and its durable settlement",6+3*Math.ceil(returnCapacity/256));
  db.prepare("INSERT INTO release_attempts(pulse,job) VALUES(?,?)").run(pulse,j.id);
  return ticket;
}
function receiptFor(db,a,request) {
  const {data:d}=request.body;
  const packet=d.receipt;
  need(guarded(a) && grant(db,a.terms.receiverKey)==="receiver" &&
    signedBy("checked-release",packet,a.terms.receiverKey),"an enrolled receiver must attest the release result");
  const row=db.prepare("SELECT answer,actor FROM operations WHERE id=?").get(d.attempt);
  const t=row?.answer && JSON.parse(row.answer),r=packet.body;
  need(t?.status==="guarded_ticket" && t.purpose==="guarded_first_use" && t.job===d.job &&
    row.actor===a.terms.receiverKey && t.binding===a.binding &&
    exact(r,["ticketHash","attempt","job","result","reader","observed","before","after","effect","difference"]) &&
    r.attempt===d.attempt && r.job===t.job && r.ticketHash===hash(t) && id(r.before) && id(r.after) &&
    (r.reader===null || key(r.reader)) && (r.observed===null || key(r.observed)),"outcome does not identify this funded first use");
  if(r.result==="meaning_changed") {
    const w=r.difference;
    need(exact(w,["index","digest"],["value"]) && Number.isInteger(w.index) && w.index>=0 && w.index<t.inputs.length &&
      key(w.digest) && w.digest!==t.perInput[w.index] && (!Object.hasOwn(w,"value") ||
      (exactValue(w.value) && Buffer.byteLength(serial(w.value))<=1024 && w.digest===hash(["release-value/1",w.value]))),
      "no independently addressed differing reading in this receipt");
  } else need(r.difference===null,"a mismatch witness does not apply to this result");
  const release="release-"+t.jobKey;
  if(r.result==="applied" || r.result==="previously_applied") {
    need(r.reader===t.implementation && r.observed===t.expectedDigest && id(r.effect),"there is no agreeing reader result for the activation");
    if(r.result==="applied")need(r.before===t.base && r.after===release && r.effect===t.pulse,"invalid first activation");
    else {
      const prior=db.prepare("SELECT actor,answer FROM operations WHERE id=?").get(r.effect);
      const original=prior?.answer && JSON.parse(prior.answer);
      need(r.before===r.after && prior?.actor===a.terms.receiverKey && original?.status==="guarded_ticket" &&
        original.pulse!==t.pulse && ["jobKey","base","fence","decision","expectedDigest","implementation","binding"].every(k=>original[k]===t[k]),
        "no matching original attempt for the earlier activation");
    }
  } else {
    need(["meaning_changed","reader_changed","basis_changed","unavailable"].includes(r.result) &&
      r.before===r.after && r.effect===null,"invalid withheld-release result");
    if(r.result==="meaning_changed")need(r.reader===t.implementation && key(r.observed) && r.observed!==t.expectedDigest,"no observed difference in the authorized reader");
    if(r.result==="reader_changed")need(key(r.reader) && r.reader!==t.implementation && r.observed===null,"no changed reader identity");
  }
  return {r,t,release};
}
export function terminalReadTicket(db,a,request) {
  tables(db);
  const {id:pulse,data:{job,attempt}}=request.body;
  const issued=db.prepare("SELECT o.actor,o.answer FROM operations o JOIN release_attempts r ON r.pulse=o.id WHERE r.pulse=? AND r.job=?")
    .get(attempt,job);
  const original=issued?.answer && JSON.parse(issued.answer);
  need(issued?.actor===a.terms.receiverKey && original?.status==="guarded_ticket" && original.job===job &&
    original.binding===a.binding,"no such funded first-use attempt at this receiver");
  return {status:"terminal_read_ticket",binding:a.binding,store:original.store,pulse,job,attempt,ticketHash:hash(original)};
}
export function editQueryPrice(a,source) {
  const price=a.terms.behaviorPort?.question?.recordSources?.find(p=>p.key===source)?.live?.editPrice;
  need(Number.isSafeInteger(price) && price>0,"no edit coordination tariff for this source");
  return price+2;
}
export function editQueryTicket(db,a,request) {
  const original=terminalReadTicket(db,a,request),{source,edit}=request.body.data;
  const row=db.prepare("SELECT answer FROM operations WHERE id=?").get(original.attempt);
  need(JSON.parse(row.answer).live?.some(c=>c.sourceKey===source),"the original first use has no obligation to this source");
  return {...original,status:"source_edit_ticket",source,edit};
}
function settle(db,a,request) {
  const {r,t,release}=receiptFor(db,a,request);
  const record=db.prepare("SELECT receipt,disputed FROM release_attempts WHERE pulse=? AND job=?").get(t.pulse,t.job);
  need(record,"no reservation at the guarded receiver");
  if(record.disputed || (record.receipt && record.receipt!==serial(r))) {
    db.prepare("UPDATE release_attempts SET disputed=1 WHERE pulse=?").run(t.pulse);
    return {status:"hold",reason:"receiver gave inconsistent results for this issued attempt"};
  }
  const applied=["applied","previously_applied"].includes(r.result);
  if(applied) {
    const old=db.prepare("SELECT pulse,release FROM released_jobs WHERE job=?").get(t.job);
    need(!old || (old.pulse===r.effect && old.release===release),"receiver reported two activations of one job");
    db.prepare("INSERT OR IGNORE INTO released_jobs VALUES(?,?,?)").run(t.job,r.effect,release);
  }
  db.prepare("UPDATE release_attempts SET receipt=? WHERE pulse=?").run(serial(r),t.pulse);
  return {status:applied?"release_confirmed":"release_withheld",job:t.job,reason:r.result,
    observedHead:r.after,appliedBy:r.effect,activatedRelease:applied?release:null,
    ...(r.difference?{difference:{...r.difference,expectedDigest:t.perInput[r.difference.index]}}:{})};
}
export function recordGuarded(db,a,request) {
  need(guarded(a),"this account has no guarded receiver");
  tables(db);
  return settle(db,a,request);
}
export function settleReservedGate(db,a,request) {
  const {id:rid,data:d}=request.body;
  if(!guarded(a) || grant(db,request.key)!=="operator" || !exact(d,["job","attempt","receipt"]) ||
    !id(d.job) || !id(d.attempt) || Buffer.byteLength(serial(d))>returnCapacity ||
    db.prepare("SELECT id FROM operations WHERE id=?").get(rid))return;
  tables(db);
  const pay=db.prepare("SELECT receipt FROM release_attempts WHERE pulse=? AND job=?").get(d.attempt,d.job);
  if(!pay || pay.receipt)return;
  const author=db.prepare("SELECT actor FROM jobs WHERE id=?").get(d.job);
  if(!author || grant(db,author.actor)!=="operator")return;
  let answer;
  try {answer=settle(db,a,request);} catch(e){if(!(e instanceof Hold))throw e;return;}
  db.prepare("INSERT INTO operations VALUES(?,?,?,1,?)").run(rid,request.key,hash(request.body),serial(answer));
  return answer;
}
export function readGuarded(db,j) {
  tables(db);
  need(!db.prepare("SELECT 1 FROM release_attempts WHERE job=? AND disputed=1").get(j.id),"conflicting receiving observations for this job");
  const receipt=db.prepare("SELECT pulse,release FROM released_jobs WHERE job=?").get(j.id);
  need(receipt,"the receiving system has not confirmed an approved first use");
  return {release:receipt.release,attempt:receipt.pulse,historical:true};
}
