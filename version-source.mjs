// A versioned source supplies only an observation. The owner signs its adoption separately.
import {account,debit,exact,grant,hash,Hold,id,key,need,openExisting,serial,signedBy,transaction} from "./review-journal.mjs";
import {catalogBudget,locateRecord,validCatalog,validLookup} from "./record-catalog.mjs";
import {validLive} from "./current-source.mjs";
import {exactValue} from "./exact-json.mjs";

const chunk=value=>Math.max(1,Math.ceil(Buffer.byteLength(serial(value))/256));
export const recordOps=["request_source","read_source","request_catalog","read_catalog"];

export function locator(value) {
  return exact(value,["product","record","version","field"]) && [value.product,value.record,value.field].every(id) &&
    Number.isSafeInteger(value.version) && value.version>=1;
}
export function validSourcePorts(ports) {
  return Array.isArray(ports) && ports.length>0 && ports.length<=8 && ports.every(p=>
    exact(p,["id","product","key","fields","price","maxBytes","retention"],["catalog","live"]) && (p.catalog===undefined || validCatalog(p.catalog)) && (p.live===undefined || validLive(p.live)) && id(p.id) && id(p.product) && key(p.key) &&
    p.retention==="project-version/1" && Number.isSafeInteger(p.price) && p.price>=1 && p.price<=1000000 &&
    Number.isSafeInteger(p.maxBytes) && p.maxBytes>=1 && p.maxBytes<=16384 &&
    Array.isArray(p.fields) && p.fields.length>0 && p.fields.length<=32 && p.fields.every(id) &&
    new Set(p.fields).size===p.fields.length) && new Set(ports.map(p=>p.id)).size===ports.length;
}
function tables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS version_reads(pulse TEXT PRIMARY KEY, proposal TEXT NOT NULL,
    coordinates TEXT NOT NULL, requester TEXT NOT NULL, claimed INTEGER NOT NULL DEFAULT 0, recovery INTEGER NOT NULL DEFAULT 1,
    result TEXT, value TEXT, digest TEXT, receipt TEXT);
    CREATE INDEX IF NOT EXISTS version_reads_by_locator ON version_reads(coordinates,digest);
    CREATE TABLE IF NOT EXISTS version_conflicts(coordinates TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS selector_endorsements(decision TEXT PRIMARY KEY,packet TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS version_adoptions(decision TEXT PRIMARY KEY, pulse TEXT NOT NULL REFERENCES version_reads(pulse));`);
}
const ports=a=>a.terms.behaviorPort?.question?.recordSources??[];
function portFor(a,name) {
  const port=ports(a).find(p=>p.id===name);
  need(port,"this versioned source is not enrolled");
  return port;
}
export function validateRecordRequest(a,op,d) {
  const issue=op==="request_source" || op==="request_catalog";
  need(ports(a).length && id(d.proposal) && (issue?id(d.port):id(d.attempt)),"identify the proposed question and its source");
  if(issue)portFor(a,d.port);
  if(op==="request_catalog")need(key(d.queryDigest) && portFor(a,d.port).catalog,"name an enrolled catalog and sign the exact selector");
  if(d.selection!==undefined)need(id(d.selection),"invalid paid catalog result");
  if(d.offeredRecord!==undefined)need(exact(d.offeredRecord,["record","version"]) && id(d.offeredRecord.record) &&
    Number.isSafeInteger(d.offeredRecord.version) && d.offeredRecord.version>=1,"name a specific offered record and edition");
}
export function recordPrice(a,op,d) {
  return 2+chunk(d);
}
function fundSource(db,pulse,p,query=null) {
  // Rejecting an invalid local request consumes only local work. Once the authority,
  // query and selected version agree, prepay the bounded external operation before issuing it.
  const units=p.price+8+3*Math.ceil((p.maxBytes+4096)/256)+(query?catalogBudget(p.catalog,query):0);
  debit(db,pulse,"fund the external lookup, receipt and bounded recovery",units);
}
function byProposal(db,proposal) {
  const initialized=db.prepare("SELECT 1 FROM sqlite_master WHERE name='brief_proposals' AND type='table'").get();
  const q=initialized && db.prepare("SELECT actor,body FROM brief_proposals WHERE id=?").get(proposal);
  need(q && grant(db,q.actor)==="operator","a currently authorized project proposal is required");
  return JSON.parse(q.body);
}
export function sourceStep(db,a,request) {
  const {op,id:pulse,data:d}=request.body;
  tables(db);
  if(op==="read_source" || op==="read_catalog")return recovered(db,pulse,d.proposal,d.attempt,true,op==="read_catalog"?"catalog_ticket":"version_ticket");
  const proposal=byProposal(db,d.proposal),port=portFor(a,d.port);
  const common={binding:a.binding,pulse,proposal:d.proposal,port:port.id,maxBytes:port.maxBytes,sourceKey:port.key,retention:port.retention};
  let field=proposal.record,origin;
  if(op==="request_catalog") {
    const q=proposal.lookup;
    need(validLookup(q) && hash(["record-query/1",q])===d.queryDigest && grant(db,port.key)==="version_source" &&
      port.catalog && port.product===q.product,"the owner's selector does not match the issued proposal and catalog");
    // Whether a lookup held must not reveal a teammate's private record count or title.
    // This decision is independent of the query results and precedes source I/O.
    need(port.catalog.disclosure==="shared-metadata/1","this source offers an individual index; use a permitted shared catalog for this product");
    fundSource(db,pulse,port,q);
    const ticket={status:"catalog_ticket",...common,lookup:q,limits:port.catalog};
    db.prepare("INSERT INTO version_reads(pulse,proposal,coordinates,requester) VALUES(?,?,?,?)").run(pulse,d.proposal,coordinates(ticket),request.key);
    return ticket;
  }
  if(proposal.lookup) {
    const q=proposal.lookup;
    const chosenLive=q.time==="at_use" && q.keep==="chosen_record";
    if(chosenLive)need(port.live?.chosenRecords===true,"the source has not enrolled owner-chosen records for current first use");
    need(q.time==="at_lookup" || (port.live && (q.search===undefined || chosenLive)),
      "a catalog snapshot cannot establish the live head at first use without an enrolled current source and an explicit selection contract");
    need(id(d.selection),"recover a unique authorized record from the paid catalog");
    const c=recovered(db,pulse,d.proposal,d.selection,false,"catalog_ticket");
    need(c.status==="catalog_observed","the catalog has no retained answer for this selector");
    const ranked=c.value.outcome==="suggestions",choice=ranked || c.value.outcome==="choice" || chosenLive;
    if(chosenLive)need(["suggestions","choice","located"].includes(c.value.outcome),"no offered source selection for first use");
    else if(q.time==="at_use")need(c.value.outcome==="located","the enrolled first-use contract requires a unique exact selector");
    const candidate=choice?c.value.matches.find(m=>d.offeredRecord && m.record===d.offeredRecord.record && m.version===d.offeredRecord.version):
      c.value.outcome==="located" && d.offeredRecord===undefined?c.value.matches[0]:null;
    need(candidate,"the catalog must identify one record or the reader must request an expressly offered candidate");
    field={product:q.product,field:q.field,record:candidate.record,version:candidate.version};
    origin={selection:c.pulse,catalogDigest:c.digest,query:q,scope:c.value.scope,...(q.time==="at_use"?{live:port.live}:{}),
      ...(chosenLive?{selectionKind:c.value.outcome}:{}),...(ranked?{provider:c.value.provider}:{}),...(choice?{requiresChoice:true}:{})};
  } else need(d.selection===undefined && d.offeredRecord===undefined,"this proposal already specifies a versioned field");
  need(locator(field) && port.product===field.product && port.fields.includes(field.field) && grant(db,port.key)==="version_source",
    "this reader has no grant for the proposed versioned field");
  fundSource(db,pulse,port);
  db.prepare("INSERT INTO version_reads(pulse,proposal,coordinates,requester) VALUES(?,?,?,?)")
    .run(pulse,d.proposal,serial(field),request.key);
  return {status:"version_ticket",...common,field,...(origin?{origin}:{})};
}
function enrolled(db,ticket) {
  const a=account(db),p=portFor(a,ticket.port);
  const issued=db.prepare("SELECT actor,answer FROM operations WHERE id=?").get(ticket.pulse);
  need(a.binding===ticket.binding && issued?.answer===serial(ticket) && p.key===ticket.sourceKey &&
    grant(db,issued.actor)===(ticket.status==="catalog_ticket"?"predecessor":"operator") && grant(db,p.key)==="version_source","no current authorization for this funded source read");
  byProposal(db,ticket.proposal);
  return p;
}
// The adapter runs under the enrolled source's own credentials, enforces its release policy
// for the named subscribing account, and returns the identity actually read. Its affirmative
// retention grant must originate at the source; the calling project's enrollment only requests it.
// Its refusal, a missing field, a bad version and an expired grant never manufacture a value.
// Reads are asynchronous. A durable claim precedes I/O, so a crash cannot repeat an unpaid source call.
function coordinates(ticket) {
  return serial(ticket.status==="catalog_ticket"?["catalog-at-lookup/1",ticket.pulse,ticket.lookup]:ticket.field);
}
export function acquireVersion(path,ticket,read,sign) {
  return acquireOnce(path,ticket,"version_ticket",read,sign);
}
export function acquireCatalog(path,ticket,adapter,sign) {
  return acquireOnce(path,ticket,"catalog_ticket",async (lookup,retention)=>{
    const value=await locateRecord(lookup,retention,ticket.limits,adapter);
    return {lookup,status:"observed",value,retention};
  },sign);
}
async function acquireOnce(path,ticket,kind,read,sign) {
  const attr=kind==="catalog_ticket"?"lookup":"field";
  const db=openExisting(path);
  try {
    const claim=transaction(db,()=>{
      need(ticket?.status===kind,"the appropriate paid source ticket is required");
      const p=enrolled(db,ticket);
      const body={binding:ticket.binding,ticket:hash(ticket)},auth=sign("begin-version-read",body);
      need(signedBy("begin-version-read",auth,p.key) && serial(auth.body)===serial(body),"wrong versioned source identity");
      const row=db.prepare("SELECT claimed,recovery,result FROM version_reads WHERE pulse=?").get(ticket.pulse);
      need(row,"no acquisition was funded for this ticket");
      if(row.claimed) {
        need(row.recovery===1,"the funded source recovery was used; request a paid project read or a fresh source attempt");
        db.prepare("UPDATE version_reads SET recovery=0 WHERE pulse=?").run(ticket.pulse);
        return row.result??"attempt_pending";
      }
      db.prepare("UPDATE version_reads SET claimed=1 WHERE pulse=?").run(ticket.pulse);
      return null;
    });
    if(claim!==null)return {status:claim,pulse:ticket.pulse,historical:true};
    const retention={binding:ticket.binding,policy:ticket.retention};
    let result="unavailable",value=null;
    try {
      const observation=await read(structuredClone(ticket[attr]),structuredClone(retention),ticket.maxBytes);
      if(exact(observation,[attr,"status"],["value","retention"]) && serial(observation[attr])===serial(ticket[attr])) {
        if(["missing","denied"].includes(observation.status) && !Object.hasOwn(observation,"value"))result=observation.status;
        if(observation.status==="observed" && (!observation.retention || serial(observation.retention)!==serial(retention)))result="denied";
        else if(observation.status==="observed" && Object.hasOwn(observation,"value") && exactValue(observation.value) &&
            Buffer.byteLength(serial(observation.value))<=ticket.maxBytes) {
          result="observed";
          value=JSON.parse(serial(observation.value));
        }
      }
    } catch { /* A failed lookup still consumes this paid attempt. */ }
    return transaction(db,()=>{
      const p=enrolled(db,ticket),body={ticket:hash(ticket),[attr]:ticket[attr],result,...(result==="observed"?{value,retention}:{})};
      const packet=sign("version-reading",structuredClone(body));
      need(signedBy("version-reading",packet,p.key) && serial(packet.body)===serial(body),"the source did not sign the actual acquired reading");
      const digest=hash(body),coords=coordinates(ticket),encoded=result==="observed"?serial(value):null;
      const conflicting=kind==="version_ticket" && result==="observed" && db.prepare("SELECT 1 FROM version_reads WHERE coordinates=? AND result='observed' AND value<>? LIMIT 1").get(coords,encoded);
      if(conflicting)db.prepare("INSERT OR IGNORE INTO version_conflicts VALUES(?)").run(coords);
      db.prepare("UPDATE version_reads SET result=?,value=?,digest=?,receipt=? WHERE pulse=?")
        .run(result,encoded,digest,serial(packet),ticket.pulse);
      return {status:result,pulse:ticket.pulse,digest,...(conflicting?{disputed:true}:{})};
    });
  } catch(e) {
    if(e instanceof Hold)return {status:"hold",reason:e.message};
    throw e;
  } finally {db.close();}
}
function recovered(db,rid,proposal,attempt,includeReceipt=false,kind="version_ticket") {
  tables(db);
  const row=db.prepare("SELECT * FROM version_reads WHERE pulse=? AND proposal=?").get(attempt,proposal);
  need(row?.result,"no retained source reply for this funded question");
  const t=db.prepare("SELECT answer FROM operations WHERE id=?").get(attempt),a=account(db);
  need(t?.answer && row.receipt,"the source ticket or signed reply is missing");
  debit(db,rid,"recover and verify the retained versioned source reply",chunk(row.receipt)+chunk(t.answer)+1);
  let packet,ticket;
  try {packet=JSON.parse(row.receipt);ticket=JSON.parse(t.answer);} catch {throw new Hold("the retained source could not be decoded");}
  const p=portFor(a,ticket.port),r=packet.body,attr=kind==="catalog_ticket"?"lookup":"field";
  need(ticket.status===kind && ticket.binding===a.binding && ticket.proposal===proposal && ticket.pulse===attempt &&
    ticket.sourceKey===p.key && ticket.retention===p.retention && coordinates(ticket)===row.coordinates &&
    signedBy("version-reading",packet,p.key) && r.ticket===hash(ticket) && r.result===row.result &&
    serial(r[attr])===serial(ticket[attr]) && hash(r)===row.digest &&
    (row.result!=="observed" || (Object.hasOwn(r,"value") && serial(r.value)===row.value &&
      r.retention?.binding===a.binding && r.retention.policy===p.retention)), "the retained value does not match its signed source receipt and issued version");
  const disputed=Boolean(db.prepare("SELECT 1 FROM version_conflicts WHERE coordinates=?").get(row.coordinates));
  const data={pulse:attempt,proposal,[attr]:ticket[attr],digest:row.digest,sourceKey:p.key,retention:p.retention,
    ...(ticket.origin?{origin:ticket.origin}:{}),
    ...(includeReceipt?{ticket,receipt:packet}:{})};
  return row.result==="observed" && !disputed ? {status:kind==="catalog_ticket"?"catalog_observed":"source_observed",...data,value:JSON.parse(row.value)} :
    {status:"hold",reason:disputed?"inconsistent observations of the same versioned field":row.result,...data};
}
export function adoptSource(db,rid,proposal,attempt,digest) {
  const r=recovered(db,rid,proposal,attempt);
  need(r.status==="source_observed" && digest===r.digest,"a consistent acquired reading matching the owner's signed digest is required");
  if(r.origin) {
    const c=recovered(db,rid,proposal,r.origin.selection,false,"catalog_ticket");
    const offered=c.value?.matches?.some(m=>m.record===r.field.record && m.version===r.field.version);
    const kind=r.origin.selectionKind??(r.origin.provider?"suggestions":r.origin.requiresChoice?"choice":"located");
    need(c.status==="catalog_observed" && c.digest===r.origin.catalogDigest && c.value.outcome===kind &&
      (!r.origin.provider || c.value.provider===r.origin.provider) &&
      offered && c.lookup.product===r.field.product && c.lookup.field===r.field.field,
      "the source field can no longer be justified from the retained catalog observation");
  }
  return {reading:"Use the observed value of the issued record field.",expected:r.value,
    recordSource:{pulse:r.pulse,digest:r.digest,field:r.field,sourceKey:r.sourceKey,retention:r.retention,...(r.origin?{origin:r.origin}:{})}};
}
export function approveSelectorUse(db,rid,picked,request) {
  const source=picked.recordSource,origin=source.origin,d=request.body.data;
  if(origin?.requiresChoice)
    need(d.chosen && d.chosen.record===source.field.record && d.chosen.version===source.field.version &&
      d.chosen.catalogDigest===origin.catalogDigest,"the owner must explicitly choose this offered version from the catalog");
  else need(d.chosen===undefined,"this source was not offered as an ambiguous choice");
  if(origin)debit(db,rid,"retain the owner's signed catalog and edition decision",chunk(request)+1);
}
export function sourceMeaning(db,rid,decision) {
  const row=db.prepare("SELECT a.pulse,r.digest FROM version_adoptions a JOIN version_reads r ON r.pulse=a.pulse WHERE a.decision=?").get(decision.id);
  need(row,"the record for this source-backed adoption is unavailable");
  const p=adoptSource(db,rid,decision.proposal,row.pulse,row.digest);
  if(p.recordSource.origin) {
    const stored=db.prepare("SELECT packet FROM selector_endorsements WHERE decision=?").get(decision.id);
    need(stored,"the original owner decision for this catalog selection is missing");
    debit(db,rid,"verify the original owner's record selection",chunk(stored.packet)+1);
    let packet;
    try {packet=JSON.parse(stored.packet);} catch {throw new Hold("the retained owner selection cannot be decoded");}
    const a=account(db),op=db.prepare("SELECT actor,fingerprint FROM operations WHERE id=?").get(decision.id);
    const body=packet?.body,d=body?.data;
    need(signedBy("request",packet,a.root) && op?.actor===a.root && hash(body)===op.fingerprint &&
      body.binding===a.binding && body.id===decision.id && body.op==="answer_question" && d.proposal===decision.proposal &&
      d.choice==="record" && d.sourcePulse===row.pulse && d.sourceDigest===row.digest &&
      d.answer===decision.answer && d.base===decision.prior,"the recovered record selection differs from the signed owner decision");
    p.recordSource.endorsement=hash(packet);
  }
  return p;
}
export function requireSourceBasis(db,ids,schema="main",acceptsLive=true) {
  // schema is selected by the local implementation. Only the two existing connections are supported.
  need(schema==="main" || schema==="origin","unknown review account");
  const present=db.prepare("SELECT 1 FROM "+schema+".sqlite_master WHERE name='version_adoptions' AND type='table'").get();
  if(!present)return;
  const disputed=db.prepare("SELECT 1 FROM "+schema+".version_adoptions a JOIN "+schema+".version_reads r ON r.pulse=a.pulse JOIN "+
    schema+".version_conflicts c ON c.coordinates=r.coordinates WHERE a.decision=?");
  if(!acceptsLive) {
    const current=db.prepare("SELECT 1 FROM "+schema+".owner_decisions d JOIN "+schema+
      ".brief_proposals p ON p.id=d.proposal WHERE d.id=? AND d.choice='record' AND json_extract(p.body,'$.lookup.time')='at_use'");
    for(const id of ids)need(!current.get(id),"use a receiver that enforces the current source reservation");
  }
  for(const id of ids)need(!disputed.get(id),"the source has given inconsistent values for this versioned field");
}
