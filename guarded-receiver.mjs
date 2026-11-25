// Local receiver for synchronous, deterministic readers deployed by the destination owner.
// The calling application controls DB access and selects its installed reader. The source
// and destination are opened on one machine. One transaction writes only the destination.
import {openSync,closeSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {confirmsCurrent} from "./current-source.mjs";
import {requireSourceBasis} from "./version-source.mjs";
import {exactValue} from "./exact-json.mjs";
import {hash,Hold,id,key,need,serial,signedBy,transaction} from "./review-journal.mjs";

function connect(path,create=false) {
  closeSync(openSync(path,create?"wx":"r+",0o600));
  const db=new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout=8000; PRAGMA synchronous=FULL");
  return db;
}
function configuration(config) {
  need(plainValue(config) && Buffer.byteLength(serial(config))<=65536,"supply a bounded, serializable reader configuration");
  return serial(config);
}
function plainValue(value) {
  if(!exactValue(value))return false;
  if(value===null || typeof value!=="object")return true;
  if(Array.isArray(value))return Object.keys(value).length===value.length &&
    Array.from({length:value.length},(_,i)=>Object.hasOwn(value,i) && plainValue(value[i])).every(Boolean);
  const proto=Object.getPrototypeOf(value);
  return (proto===Object.prototype || proto===null) && Object.values(value).every(plainValue);
}
export function createReceivingStore(path,binding,store,config,{base="initial",fence="active"}={}) {
  need(key(binding) && id(store) && id(base) && id(fence),"supply a bound initial receiving edition");
  const saved=configuration(config),db=connect(path,true);
  try {
    transaction(db,()=>{
      db.exec(`CREATE TABLE live(id INTEGER PRIMARY KEY CHECK(id=1),binding TEXT,store TEXT,release TEXT,fence TEXT,payload TEXT,reader TEXT,next_reader TEXT);
        CREATE TABLE effects(job_key TEXT PRIMARY KEY,attempt TEXT UNIQUE,reader TEXT,observed TEXT);
        CREATE TABLE results(pulse TEXT PRIMARY KEY,ticket TEXT,packet TEXT, recovery INTEGER NOT NULL);`);
      db.prepare("INSERT INTO live VALUES(1,?,?,?,?,NULL,NULL,?)").run(binding,store,base,fence,saved);
    });
  } finally {db.close();}
}
// This is a destination administrator action. A staged reader does not change the running one.
export function stageReceivingReader(path,config) {
  const saved=configuration(config),db=connect(path);
  try {db.prepare("UPDATE live SET next_reader=? WHERE id=1").run(saved);} finally {db.close();}
}
export function readVisibleRelease(path,adapter,inputs) {
  const db=new DatabaseSync(path,{readOnly:true});
  try {
    const head=db.prepare("SELECT release,payload,reader FROM live WHERE id=1").get();
    if(head.payload===null)return {release:head.release,values:null};
    const reader=JSON.parse(head.reader),actual=adapter.identify(structuredClone(reader.config));
    need(actual===reader.implementation,"the active reader implementation changed");
    const values=observe(adapter,head.payload,reader.config,inputs);
    return {release:head.release,values};
  } finally {db.close();}
}
// Read a historical outcome once per independently funded ticket. This operation
// cannot call the installed reader, publish content, or create a terminal outcome.
export function readTerminalReceipt(path,sourcePath,ticket) {
  need(ticket?.status==="terminal_read_ticket","a funded terminal read is required");
  const db=connect(path);
  try {
    closeSync(openSync(sourcePath,"r+"));
    db.prepare("ATTACH DATABASE ? AS origin").run(sourcePath);
    return transaction(db,()=>{
      const origin=db.prepare("SELECT binding,terms FROM origin.account WHERE singleton=1").get();
      const terms=JSON.parse(origin.terms), dest=db.prepare("SELECT binding,store FROM live WHERE id=1").get();
      const issued=db.prepare("SELECT actor,answer FROM origin.operations WHERE id=?").get(ticket.pulse);
      const authorized=db.prepare("SELECT 1 FROM origin.grants WHERE key=? AND role='receiver' AND active=1").get(terms.receiverKey);
      need(authorized && origin.binding===ticket.binding && dest.binding===ticket.binding && dest.store===ticket.store &&
        issued?.actor===terms.receiverKey && issued.answer===serial(ticket),"no matching authorized receipt read");
      db.exec("CREATE TABLE IF NOT EXISTS terminal_reads(pulse TEXT PRIMARY KEY)");
      const used=db.prepare("INSERT OR IGNORE INTO terminal_reads(pulse) VALUES(?)").run(ticket.pulse);
      if(!used.changes)return {status:"hold",reason:"terminal read already consumed"};
      const row=db.prepare("SELECT ticket,packet FROM results WHERE pulse=?").get(ticket.attempt);
      if(!row)return {status:"hold",reason:"the destination has no terminal outcome for this attempt"};
      const receipt=JSON.parse(row.packet);
      need(row.ticket===ticket.ticketHash && signedBy("checked-release",receipt,terms.receiverKey) &&
        receipt.body.ticketHash===ticket.ticketHash && receipt.body.attempt===ticket.attempt && receipt.body.job===ticket.job &&
        Buffer.byteLength(row.packet)<=4096,"the stored receipt does not match the funded read");
      return {status:"terminal_receipt",receipt};
    });
  } finally {db.close();}
}
function observe(adapter,content,config,inputs) {
  const values=adapter.read(content,structuredClone(config),structuredClone(inputs));
  need(Array.isArray(values) && values.length===inputs.length && plainValue(values) &&
    Buffer.byteLength(serial(values))<=262144,"incomplete or unsupported values from the installed reader");
  return values;
}
export function activateCheckedRelease(path,sourcePath,ticket,adapter,signOutcome,currentGrants=[]) {
  return applyFirstUse(path,sourcePath,ticket,adapter,signOutcome,currentGrants,null);
}
function applyFirstUse(path,sourcePath,ticket,adapter,signOutcome,currentGrants,editQuery) {
  need(ticket?.status==="guarded_ticket" && ticket.purpose==="guarded_first_use","a checked first-use ticket is required");
  const db=connect(path);
  try {
    // Open an existing source; a mistaken path must never create an empty source database.
    closeSync(openSync(sourcePath,"r+"));
    db.prepare("ATTACH DATABASE ? AS origin").run(sourcePath);
    return transaction(db,()=>{
      const a=db.prepare("SELECT * FROM origin.account WHERE singleton=1").get(),terms=JSON.parse(a.terms);
      const live=db.prepare("SELECT * FROM live WHERE id=1").get();
      need(live.binding===a.binding && live.binding===ticket.binding && live.store===ticket.store &&
        terms.behaviorPort?.question?.beforeUse==="checked/1" && ["store","history","repeat"].every(k=>terms.receiverContract[k]===ticket[k]),
        "different source or receiving contract");
      const issuance=db.prepare("SELECT actor,answer FROM origin.operations WHERE id=?").get(ticket.pulse);
      need(issuance?.actor===terms.receiverKey && issuance.answer===serial(ticket),"no matching issued receiver request");
      if(editQuery) {
        const paid=db.prepare("SELECT actor,answer FROM origin.operations WHERE id=?").get(editQuery.pulse);
        need(paid?.actor===terms.receiverKey && paid.answer===serial(editQuery),"no funded request to coordinate this source edit");
      }
      const digest=hash(ticket),saved=db.prepare("SELECT ticket,packet,recovery FROM results WHERE pulse=?").get(ticket.pulse);
      if(saved) {
        need(saved.ticket===digest,"the issued attempt changed");
        need(saved.recovery===1,"the paid recovery was used; fund a receipt read for this attempt");
        db.prepare("UPDATE results SET recovery=0 WHERE pulse=?").run(ticket.pulse);
        return JSON.parse(saved.packet);
      }
      const j=db.prepare("SELECT * FROM origin.jobs WHERE id=?").get(ticket.job);
      const paid=db.prepare("SELECT 1 FROM origin.release_attempts WHERE job=? AND pulse=?").get(ticket.job,ticket.pulse);
      need(paid && j,"guarded first use has no funded reservation");
      const r={ticketHash:digest,attempt:ticket.pulse,job:ticket.job,result:"basis_changed",reader:null,observed:null,
        before:live.release,after:live.release,effect:null,difference:null};
      const original=db.prepare("SELECT * FROM effects WHERE job_key=?").get(ticket.jobKey);
      if(original) {
        Object.assign(r,{result:"previously_applied",effect:original.attempt,reader:original.reader,observed:original.observed});
      } else if(!editQuery && activeSource(db,terms,a,ticket,j,live) && confirmsCurrent(ticket,currentGrants)) {
        const config=JSON.parse(live.next_reader);
        try {
          r.reader=adapter.identify(structuredClone(config));
          need(key(r.reader),"unavailable reader identity");
          if(r.reader!==ticket.implementation)r.result="reader_changed";
          else {
            const values=observe(adapter,j.content,config,ticket.inputs);
            r.observed=hash(["release-observations/1",values]);
            r.result=r.observed===ticket.expectedDigest?"applied":"meaning_changed";
            if(r.result==="meaning_changed") {
              const index=values.findIndex((v,i)=>hash(["release-value/1",v])!==ticket.perInput[i]);
              need(index>=0,"receiver could not locate the changed reading");
              const v=values[index];
              r.difference={index,digest:hash(["release-value/1",v]),...(Buffer.byteLength(serial(v))<=1024?{value:v}:{})};
            }
          }
        } catch {
          r.result="unavailable";
          if(!key(r.reader))r.reader=null;
          r.observed=null;r.difference=null;
        }
        if(r.result==="applied") {
          r.effect=ticket.pulse;r.after="release-"+ticket.jobKey;
          db.prepare("UPDATE live SET release=?,payload=?,reader=? WHERE id=1")
            .run(r.after,j.content,serial({config,implementation:r.reader}));
          db.prepare("INSERT INTO effects VALUES(?,?,?,?)").run(ticket.jobKey,ticket.pulse,r.reader,r.observed);
        }
      }
      const packet=signOutcome("checked-release",structuredClone(r));
      need(signedBy("checked-release",packet,terms.receiverKey) && serial(packet.body)===serial(r),
        "the receiving identity did not sign the actual first-use result");
      db.prepare("INSERT INTO results VALUES(?,?,?,1)").run(ticket.pulse,digest,serial(packet));
      return packet;
    });
  } finally {db.close();}
}
export function honorSourceFence(path,projectPath,ticket,fence,signOutcome) {
  const body=fence?.body;
  need(body && signedBy("source-edit-fence",fence,body.source) && body.status==="source_edit_ticket" &&
    ticket?.live?.some(c=>c.sourceKey===body.source) && body.ticketHash===hash(ticket) &&
    body.binding===ticket.binding && body.store===ticket.store && body.job===ticket.job && body.attempt===ticket.pulse &&
    id(body.edit) && key(body.ownerEditHash),"source fence does not identify this first use");
  const {ownerEditHash,...query}=body;
  return applyFirstUse(path,projectPath,ticket,null,signOutcome,[],query);
}
function activeSource(db,terms,a,ticket,j,live) {
  const granted=(key,role)=>db.prepare("SELECT 1 FROM origin.grants WHERE key=? AND role=? AND active=1").get(key,role);
  if(ticket.live?.some(c=>!granted(c.sourceKey,"version_source")))return false;
  const head=db.prepare("SELECT id,choice FROM origin.owner_decisions ORDER BY seq DESC LIMIT 1").get();
  const jobDecision=db.prepare("SELECT decision FROM origin.job_decisions WHERE job=?").get(j.id);
  const disputed=db.prepare("SELECT 1 FROM origin.disputes WHERE cell=?").get(2*j.position+j.claim);
  if(terms.behaviorPort.question.recordSources) {
    try {requireSourceBasis(db,ticket.requirements.map(r=>r.decision),"origin");}
    catch(e){if(e instanceof Hold)return false;throw e;}
  }
  const disputedResult=db.prepare("SELECT 1 FROM origin.release_attempts WHERE job=? AND disputed=1").get(j.id);
  return granted(terms.receiverKey,"receiver") && granted(j.actor,"operator") && !disputed && !disputedResult &&
    a.revision===j.revision && j.revision===ticket.revision && head && head.choice!==null &&
    head.id===jobDecision?.decision && head.id===ticket.decision && live.release===ticket.base &&
    live.fence===ticket.fence && hash(["text/1",j.content])===ticket.contentHash;
}
