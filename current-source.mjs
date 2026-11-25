// An authoritative record service can promise that a named historical selection will
// remain eligible until its registered receiver returns a terminal first-use receipt.
// The service must own every write to this store, including changes to audience.
import {closeSync,openSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {account,exact,grant,hash,Hold,id,key,need,openExisting,serial,signedBy,transaction} from "./review-journal.mjs";
import {exactValue} from "./exact-json.mjs";
import {catalogLabel} from "./record-catalog.mjs";

export const liveContract="reserve-until-receiver-receipt/1";
const bounded=(n,max)=>Number.isSafeInteger(n) && n>0 && n<=max;
const terminal=new Set(["applied","previously_applied","meaning_changed","basis_changed","reader_changed","unavailable"]);
export function validLive(terms) {
  return exact(terms,["contract","price"],["editPrice","chosenRecords"]) && terms.contract===liveContract && bounded(terms.price,1000000) &&
    (terms.chosenRecords===undefined || terms.chosenRecords===true) &&
    (terms.editPrice===undefined || bounded(terms.editPrice,1000000));
}
function using(path,operation,create=false) {
  closeSync(openSync(path,create?"wx":"r+",0o600));
  const db=new DatabaseSync(path);
  try {
    db.function("phaseline_priority_writer",()=>1);
    db.function("phaseline_chosen_record_writer",()=>1);
    // Setting synchronous can consult a locked schema while the connection opens.
    db.exec("PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL");
    return transaction(db,()=>operation(db));
  } finally {db.close();}
}
// Evidence describes one committed snapshot. Reading it must not reserve a
// writer slot. Mutating permissions and first-use reservations still use using().
function snapshot(path,operation) {
  const db=new DatabaseSync(path,{readOnly:true});
  try {
    db.exec("PRAGMA busy_timeout=5000; BEGIN");
    const result=operation(db);
    db.exec("COMMIT");
    return result;
  } finally {db.close();}
}
export function createCurrentSource(path,subscription) {
  need(exact(subscription,["binding","store","product","sourceKey","receiverKey","fields","maxActive"],["chosenRecords"]) &&
    (subscription.chosenRecords===undefined || subscription.chosenRecords===true) &&
    key(subscription.binding) && id(subscription.store) && id(subscription.product) &&
    key(subscription.sourceKey) && key(subscription.receiverKey) && subscription.sourceKey!==subscription.receiverKey &&
    bounded(subscription.maxActive,64) && Array.isArray(subscription.fields) && bounded(subscription.fields.length,32) &&
    new Set(subscription.fields).size===subscription.fields.length && subscription.fields.every(id),
    "supply the source-approved subscription and its receiver");
  using(path,db=>{
    db.exec(`CREATE TABLE subscription(spec TEXT NOT NULL, active INTEGER NOT NULL);
      CREATE TABLE records(record TEXT PRIMARY KEY, version INTEGER NOT NULL, title TEXT NOT NULL, type TEXT NOT NULL,
        title_key TEXT NOT NULL, type_key TEXT NOT NULL, shared INTEGER NOT NULL, fields TEXT NOT NULL);
      CREATE INDEX matching ON records(shared,type_key,title_key);
      CREATE TABLE uses(attempt TEXT PRIMARY KEY, request TEXT NOT NULL, state TEXT NOT NULL, grant_packet TEXT, terminal TEXT,
        recovery INTEGER NOT NULL DEFAULT 1);
      CREATE INDEX active_uses ON uses(state);`);
    db.prepare("INSERT INTO subscription VALUES(?,1)").run(serial(subscription));
  },true);
}
const subscription=db=>JSON.parse(db.prepare("SELECT spec FROM subscription").get().spec);
// A pending owner edit projects one prospective source state. Admission must be
// justified in both the current and prospective states so late work cannot starve it.
function satisfies(db,checks,edit=null) {
  const active=edit?.sharing ?? Boolean(db.prepare("SELECT active FROM subscription").get().active);
  if(!active)return false;
  const next=edit?.record;
  const select=db.prepare("SELECT record,version,fields FROM records WHERE shared=1 AND type_key=? AND title_key=? AND record<>? LIMIT 2");
  return checks.every(check=>{
    if(check.selection==="chosen_record") {
      const selected=next?.record===check.record?next:db.prepare("SELECT version,shared,fields FROM records WHERE record=?").get(check.record);
      if(!selected?.shared || selected.version!==check.version)return false;
      const fields=next?.record===check.record?selected.fields:JSON.parse(selected.fields);
      return Object.hasOwn(fields,check.field) && hash(["current-field/1",fields[check.field]])===check.valueDigest;
    }
    const type=catalogLabel(check.type),title=catalogLabel(check.title);
    const rows=select.all(type,title,next?.record??"");
    if(next?.shared && catalogLabel(next.type)===type && catalogLabel(next.title)===title)
      rows.push({record:next.record,version:next.version,fields:serial(next.fields)});
    if(rows.length!==1 || rows[0].record!==check.record || rows[0].version!==check.version)return false;
    const fields=JSON.parse(rows[0].fields);
    return Object.hasOwn(fields,check.field) && hash(["current-field/1",fields[check.field]])===check.valueDigest;
  });
}
function editTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS source_epochs(target TEXT PRIMARY KEY, epoch INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS source_edits(id TEXT PRIMARY KEY, command TEXT NOT NULL, state TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS source_pending_edit ON source_edits(state) WHERE state='pending';`);
}
// Once an owner uses the queue, an older source process must not silently admit
// new conflicting work against the same database. SQLite enforces this even when
// that process was already running. All current source writers register the marker.
function requireWriters(db,profile) {
  const marker=profile==="chosen_record"?"phaseline_chosen_record_writer":"phaseline_priority_writer";
  for(const table of ["records","uses","subscription"]) {
    for(const action of ["INSERT","UPDATE","DELETE"])
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${profile}_${table}_${action} BEFORE ${action} ON ${table}
        BEGIN SELECT CASE WHEN ${marker}()<>1 THEN RAISE(ABORT,'source writer upgrade required') END; END`);
  }
}
// Local source-administrator operation. The project still needs its own signed
// enrollment for this mode. Existing records, reservations and receipts stay in place.
export function enableChosenRecordUse(path,expectedBinding) {
  return using(path,db=>{
    const spec=subscription(db);
    need(spec.binding===expectedBinding,"the source is enrolled to a different project");
    requireWriters(db,"chosen_record");
    if(!spec.chosenRecords)db.prepare("UPDATE subscription SET spec=?").run(serial({...spec,chosenRecords:true}));
    return {status:"enabled",binding:spec.binding};
  });
}
// A storage capacity decision by the local source administrator does not change
// the project's disclosure limit, evidence budget or existing use predicates.
export function raiseSourceCapacity(path,expectedBinding,capacity) {
  return using(path,db=>{
    const spec=subscription(db);
    need(spec.binding===expectedBinding && Number.isSafeInteger(capacity) && capacity>=(spec.populationLimit??4096),
      "supply the enrolled binding and a nondecreasing source storage capacity");
    if(capacity!==(spec.populationLimit??4096))
      db.prepare("UPDATE subscription SET spec=?").run(serial({...spec,populationLimit:capacity}));
    return {status:"configured",capacity};
  });
}
const editTarget=change=>change.record?"r:"+change.record.record:"sharing";
function targetBasis(db,target) {
  const spec=subscription(db);
  const revision=db.prepare("SELECT epoch FROM source_epochs WHERE target=?").get(target)?.epoch??0;
  const row=target==="sharing"?db.prepare("SELECT active FROM subscription").get():
    db.prepare("SELECT * FROM records WHERE record=?").get(target.slice(2))??null;
  return hash(["source-edit-basis/1",spec.binding,spec.sourceKey,spec.store,target,revision,row]);
}
function validRecordShape(row) {
  need(exact(row,["record","version","type","title","shared","fields"]) && id(row.record) &&
    Number.isSafeInteger(row.version) && row.version>=1 && typeof row.shared==="boolean" &&
    [row.title,row.type].every(x=>typeof x==="string" && catalogLabel(x).length>0 && Buffer.byteLength(x)<=256) &&
    row.fields && !Array.isArray(row.fields) && typeof row.fields==="object" && exactValue(row.fields) &&
    Object.keys(row.fields).every(id) && Buffer.byteLength(serial(row.fields))<=16384,"invalid current record");
}

function validRecord(db,row) {
  validRecordShape(row);
  const previous=db.prepare("SELECT * FROM records WHERE record=?").get(row.record);
  if(previous)need(row.version===previous.version+1 || (row.version===previous.version &&
    previous.title===row.title && previous.type===row.type && previous.fields===serial(row.fields)),"content edits require the next edition");
  else need(row.version===1 && db.prepare("SELECT COUNT(*) AS n FROM records").get().n<(subscription(db).populationLimit??4096),"source population or starting edition out of bounds");
}
function validEdit(db,change) {
  if(Object.hasOwn(change,"record"))validRecord(db,change.record);
  else need(typeof change.sharing==="boolean","specify the intended sharing state");
}
function wouldChange(db,change) {
  if(!change.record)return Boolean(db.prepare("SELECT active FROM subscription").get().active)!==change.sharing;
  const row=change.record,old=db.prepare("SELECT * FROM records WHERE record=?").get(row.record);
  return !old || old.version!==row.version || old.title!==row.title || old.type!==row.type ||
    Boolean(old.shared)!==row.shared || old.fields!==serial(row.fields);
}
function applyEdit(db,change) {
  if(!wouldChange(db,change))return;
  const target=editTarget(change);
  if(change.record) {
    const row=change.record;
    db.prepare("INSERT OR REPLACE INTO records VALUES(?,?,?,?,?,?,?,?)").run(row.record,row.version,row.title,row.type,
      catalogLabel(row.title),catalogLabel(row.type),row.shared?1:0,serial(row.fields));
  } else db.prepare("UPDATE subscription SET active=?").run(change.sharing?1:0);
  db.prepare("INSERT INTO source_epochs VALUES(?,1) ON CONFLICT(target) DO UPDATE SET epoch=epoch+1").run(target);
}
function pendingEdit(db) {
  const row=db.prepare("SELECT command FROM source_edits WHERE state='pending'").get();
  return row && JSON.parse(row.command);
}
function blockers(db,change) {
  const found=[];
  for(const row of db.prepare("SELECT attempt,request FROM uses WHERE state='reserved' ORDER BY attempt").all()) {
    if(!satisfies(db,JSON.parse(row.request).checks,change))found.push(row.attempt);
  }
  return found;
}
function editResult(db,command,state) {
  if(state==="pending")return {status:"edit_pending",edit:command.id,waitingFor:blockers(db,command)};
  return {status:"edit_applied",edit:command.id,historical:true};
}
function finishPendingEdit(db) {
  const current=pendingEdit(db);
  if(!current || blockers(db,current).length)return;
  need(targetBasis(db,editTarget(current))===current.basis,"pending source basis changed");
  validEdit(db,current);
  applyEdit(db,current);
  db.prepare("UPDATE source_edits SET state='applied' WHERE id=?").run(current.id);
}
// Maintains the original writer entry points and supports existing RC36 stores.
function ordinaryWrite(path,change) {
  try {
    return using(path,db=>{
      editTables(db);validEdit(db,change);
      const written=change.record?{status:"written",version:change.record.version}:{status:"written"};
      if(!wouldChange(db,change))return written;
      const pending=pendingEdit(db);
      const prior=pending && new Set(blockers(db,pending));
      need(!pending || editTarget(pending)!==editTarget(change),"a source owner has an earlier pending change to this record");
      need(blockers(db,change).length===0,"a promised first use is still pending");
      applyEdit(db,change);
      if(pending) {
        // Preserve capacity for a queued insert and prevent a new dependency
        // on any previously nonblocking first use.
        validEdit(db,pending);
        need(blockers(db,pending).every(attempt=>prior.has(attempt)),"this write would add a blocker to the pending source change");
        finishPendingEdit(db);
      }
      return written;
    });
  } catch(e) {if(e instanceof Hold)return {status:"hold",reason:e.message};throw e;}
}
// Import source-controlled first editions in atomic, bounded batches. An
// existing row must agree exactly; normal edits still use the ordinary writer.
export function seedCurrentRecords(path,expectedBinding,rows) {
  try {
    return using(path,db=>{
      const spec=subscription(db);
      need(spec.binding===expectedBinding && Array.isArray(rows) && bounded(rows.length,512),"invalid source import");
      editTables(db);
      need(!pendingEdit(db) && !db.prepare("SELECT 1 FROM uses WHERE state='reserved' LIMIT 1").get(),
        "settle pending source work or use the ordinary writer");
      const limit=spec.populationLimit??4096;
      let count=db.prepare("SELECT COUNT(*) AS n FROM records").get().n;
      const previous=db.prepare("SELECT version,title,type,shared,fields FROM records WHERE record=?");
      const insert=db.prepare("INSERT INTO records VALUES(?,?,?,?,?,?,?,?)");
      const epoch=db.prepare("INSERT INTO source_epochs(target,epoch) VALUES(?,1)");
      let inserted=0;
      for(const row of rows) {
        validRecordShape(row);
        need(row.version===1,"source import requires an initial edition");
        const fields=serial(row.fields),prior=previous.get(row.record);
        if(prior) {
          need(prior.version===1 && prior.title===row.title && prior.type===row.type &&
            Boolean(prior.shared)===row.shared && prior.fields===fields,"existing source record differs");
          continue;
        }
        need(count<limit,"source storage capacity exhausted");
        insert.run(row.record,1,row.title,row.type,catalogLabel(row.title),catalogLabel(row.type),row.shared?1:0,fields);
        epoch.run("r:"+row.record);
        count++;inserted++;
      }
      return {status:"seeded",inserted,total:count};
    });
  } catch(e) {if(e instanceof Hold)return {status:"hold",reason:e.message};throw e;}
}

export function putCurrentRecord(path,row) {return ordinaryWrite(path,{record:row});}
export function setSourceSharing(path,active) {return ordinaryWrite(path,{sharing:active});}

// These three methods are source-administrator operations. The project cannot
// grant itself permission to edit an upstream record. A null target is the subscription.
export function sourceEditBasis(path,record=null) {
  need(record===null || id(record),"invalid source edit target");
  return using(path,db=>{editTables(db);return targetBasis(db,record===null?"sharing":"r:"+record);});
}
export function requestSourceEdit(path,command) {
  try {
    return using(path,db=>{
      editTables(db);
      need((exact(command,["id","basis","record"]) || exact(command,["id","basis","sharing"])) &&
        id(command.id) && key(command.basis),"identify the owner change and its original basis");
      const issued=db.prepare("SELECT command,state FROM source_edits WHERE id=?").get(command.id);
      if(issued) {
        need(issued.command===serial(command),"this identifier denotes a different owner change");
        return editResult(db,command,issued.state);
      }
      need(command.basis===targetBasis(db,editTarget(command)),"source change was prepared against a different edition or audience");
      validEdit(db,command);
      need(!pendingEdit(db),"another source edit is waiting; retry after its terminal result");
      requireWriters(db,"priority");
      const waiting=blockers(db,command),state=waiting.length?"pending":"applied";
      db.prepare("INSERT INTO source_edits VALUES(?,?,?)").run(command.id,serial(command),state);
      if(!waiting.length)applyEdit(db,command);
      return waiting.length?{status:"edit_pending",edit:command.id,waitingFor:waiting}:{status:"edit_applied",edit:command.id,historical:true};
    });
  } catch(e) {if(e instanceof Hold)return {status:"hold",reason:e.message};throw e;}
}
export function readSourceEdit(path,edit) {
  need(id(edit),"invalid source edit identifier");
  return using(path,db=>{
    editTables(db);
    const r=db.prepare("SELECT command,state FROM source_edits WHERE id=?").get(edit);
    return r?editResult(db,JSON.parse(r.command),r.state):{status:"hold",reason:"unknown source edit"};
  });
}
// The independently administered source accepts the enrolled receiver's signature
// on an issued project expense. Paying for the query alone cannot recall a release.
export function signEditQuery(projectPath,ticket,sign) {
  const db=openExisting(projectPath);
  try {
    return transaction(db,()=>{
      const a=account(db),row=db.prepare("SELECT actor,answer FROM operations WHERE id=?").get(ticket.pulse);
      need(ticket.status==="source_edit_ticket" && a.binding===ticket.binding && row?.actor===a.terms.receiverKey &&
        row.answer===serial(ticket) && grant(db,row.actor)==="receiver","no issued source edit query");
      const packet=sign("source-edit-query",structuredClone(ticket));
      need(signedBy("source-edit-query",packet,row.actor) && serial(packet.body)===serial(ticket),"receiver did not authorize this query");
      return packet;
    });
  } finally {db.close();}
}
export function answerEditQuery(path,query,sign) {
  return using(path,db=>{
    editTables(db);
    const spec=subscription(db),q=query?.body;
    need(signedBy("source-edit-query",query,spec.receiverKey) &&
      exact(q,["status","binding","store","source","job","attempt","edit","pulse","ticketHash"]) &&
      q.status==="source_edit_ticket" && q.binding===spec.binding && q.store===spec.store && q.source===spec.sourceKey &&
      [q.job,q.attempt,q.edit,q.pulse].every(id) && key(q.ticketHash),"a paid query from the enrolled receiver is required");
    db.exec("CREATE TABLE IF NOT EXISTS answered_edit_queries(pulse TEXT PRIMARY KEY)");
    if(!db.prepare("INSERT OR IGNORE INTO answered_edit_queries VALUES(?)").run(q.pulse).changes)
      return {status:"hold",reason:"source edit query already consumed"};
    const pending=pendingEdit(db),use=db.prepare("SELECT request FROM uses WHERE attempt=? AND state='reserved'").get(q.attempt);
    const original=use && JSON.parse(use.request);
    if(pending?.id!==q.edit || original?.ticketHash!==q.ticketHash || original.job!==q.job ||
      satisfies(db,original.checks,pending))return {status:"hold",reason:"no pending source edit requires closing this exact first use"};
    const body={...q,ownerEditHash:hash(pending)},packet=sign("source-edit-fence",structuredClone(body));
    need(signedBy("source-edit-fence",packet,spec.sourceKey) && serial(packet.body)===serial(body),"source did not confirm this owner edit");
    return {status:"source_fence",packet};
  });
}
// The ranker supplies ordered identities inside the source process. Check the
// current authorized audience at the same snapshot using only primary-key reads.
export function eligibleRankedRecords(path,query,retention,ids,limit) {
  return snapshot(path,db=>{
    const spec=subscription(db);
    need(query.product===spec.product && spec.fields.includes(query.field) && retention?.binding===spec.binding &&
      retention.policy==="project-version/1" && db.prepare("SELECT active FROM subscription").get().active,
      "source sharing is unavailable for ranked lookup");
    need(bounded(limit,3) && Array.isArray(ids) && ids.length<=100 && ids.every(id) &&
      new Set(ids).size===ids.length,"invalid bounded ranked shortlist");
    const get=db.prepare("SELECT record,version FROM records WHERE record=? AND shared=1");
    const matches=[];
    for(const candidate of ids){
      const row=get.get(candidate);
      if(row)matches.push({record:row.record,version:row.version,shared:true});
      if(matches.length===limit)break;
    }
    return matches;
  });
}

export function currentCatalog(path,query,retention,limit) {
  return snapshot(path,db=>{
    const spec=subscription(db);
    need(db.prepare("SELECT active FROM subscription").get().active && query.product===spec.product &&
      spec.fields.includes(query.field) && bounded(limit,4096) && retention?.binding===spec.binding &&
      retention.policy==="project-version/1","source sharing is unavailable for this catalog");
    const count=db.prepare("SELECT COUNT(*) AS n FROM records WHERE shared=1").get().n;
    const rows=db.prepare("SELECT record,version,title,type FROM records WHERE shared=1 ORDER BY record LIMIT ?").all(limit);
    return {product:spec.product,rows:rows.map(x=>({...x,shared:true})),more:count-rows.length,retention};
  });
}
export function currentField(path,field,retention) {
  return snapshot(path,db=>{
    const spec=subscription(db);
    if(!db.prepare("SELECT active FROM subscription").get().active || field.product!==spec.product ||
      !spec.fields.includes(field.field) || retention?.binding!==spec.binding || retention.policy!=="project-version/1")
      return {field,status:"denied"};
    const row=db.prepare("SELECT fields FROM records WHERE record=? AND version=? AND shared=1").get(field.record,field.version);
    if(!row)return {field,status:"missing"};
    const values=JSON.parse(row.fields);
    return Object.hasOwn(values,field.field)?{field,status:"observed",value:values[field.field],retention}:{field,status:"missing"};
  });
}

export function readSourceState(path) {
  // Administrative inspection on the source host, never included in a receiving grant.
  return snapshot(path,db=>({shared:!!db.prepare("SELECT active FROM subscription").get().active,
    records:db.prepare("SELECT record,version,shared FROM records ORDER BY record").all(),
    pending:db.prepare("SELECT COUNT(*) AS n FROM uses WHERE state='reserved'").get().n}));
}
export function liveRequest(ticket,sourceKey) {
  need(ticket?.status==="guarded_ticket" && Array.isArray(ticket.live) && key(sourceKey),"no first-use contract in this ticket");
  const checks=ticket.live.filter(c=>c.sourceKey===sourceKey).map(({sourceKey,...remaining})=>remaining);
  need(checks.length>0 && checks.length<=32,"no bounded current requirements for this source");
  return {binding:ticket.binding,store:ticket.store,job:ticket.job,attempt:ticket.pulse,
    sourceKey,ticketHash:hash(ticket),checks};
}
function authorized(spec,packet) {
  const r=packet?.body;
  need(signedBy("current-request",packet,spec.receiverKey) && exact(r,["binding","store","job","attempt","sourceKey","ticketHash","checks"]) &&
    r.sourceKey===spec.sourceKey && r.binding===spec.binding && r.store===spec.store && id(r.job) && id(r.attempt) &&
    key(r.ticketHash) && Array.isArray(r.checks) && bounded(r.checks.length,32),"receiver did not authorize this request for this source");
  for(const c of r.checks) {
    const common=["product","record","version","field","valueDigest"];
    const selected=exact(c,[...common,"selection"]) && c.selection==="chosen_record";
    const unique=exact(c,[...common,"type","title"]) && [c.title,c.type].every(v=>typeof v==="string" && Buffer.byteLength(v)<=256 && catalogLabel(v).length>0);
    need(((selected && spec.chosenRecords===true) || unique) && c.product===spec.product && id(c.record) && Number.isSafeInteger(c.version) &&
      c.version>=1 && spec.fields.includes(c.field) && key(c.valueDigest),"the enrolled source cannot promise this requirement");
  }
  return r;
}
const grantBody=r=>({contract:liveContract,requestHash:hash(r),ticketHash:r.ticketHash,attempt:r.attempt});
export function reserveCurrentSource(path,request,sign) {
  return using(path,db=>{
    const spec=subscription(db),r=authorized(spec,request),saved=db.prepare("SELECT * FROM uses WHERE attempt=?").get(r.attempt);
    if(saved) {
      need(saved.request===serial(r),"a different use already has this attempt");
      if(saved.state==="reserved" && saved.recovery===1) {
        db.prepare("UPDATE uses SET recovery=0 WHERE attempt=?").run(r.attempt);
        return {status:"reserved",grant:JSON.parse(saved.grant_packet)};
      }
      if(saved.state==="reserved")return {status:"hold",reason:"source grant recovery used; reconcile this attempt at the destination"};
      return {status:"hold",reason:saved.state};
    }
    editTables(db);
    const pending=pendingEdit(db);
    const count=db.prepare("SELECT COUNT(*) AS n FROM uses WHERE state='reserved'").get().n;
    if(count>=spec.maxActive || !satisfies(db,r.checks) || (pending && !satisfies(db,r.checks,pending))) {
      db.prepare("INSERT INTO uses(attempt,request,state) VALUES(?,?,'declined')").run(r.attempt,serial(r));
      return {status:"hold",reason:"no current reservation for this receiving attempt"};
    }
    const body=grantBody(r),grant=sign("current-grant",structuredClone(body));
    need(signedBy("current-grant",grant,spec.sourceKey) && serial(grant.body)===serial(body),"current source did not confirm its reservation");
    if(r.checks.some(c=>c.selection==="chosen_record"))requireWriters(db,"chosen_record");
    db.prepare("INSERT INTO uses(attempt,request,state,grant_packet) VALUES(?,?,'reserved',?)").run(r.attempt,serial(r),serial(grant));
    return {status:"reserved",grant};
  });
}
export function confirmsCurrent(ticket,grants) {
  if(!ticket.live?.length)return true;
  const sources=[...new Set(ticket.live.map(c=>c.sourceKey))];
  if(!Array.isArray(grants) || grants.length!==sources.length || sources.length>8)return false;
  return sources.every(source=>{
    const receipt=grants.find(candidate=>candidate?.key===source);
    return signedBy("current-grant",receipt,source) &&
      serial(receipt.body)===serial(grantBody(liveRequest(ticket,source)));
  });
}
export function settleCurrentSource(path,request,receipt) {
  return using(path,db=>{
    const spec=subscription(db),r=authorized(spec,request),v=receipt?.body;
    need(signedBy("checked-release",receipt,spec.receiverKey) && v.ticketHash===r.ticketHash &&
      v.attempt===r.attempt && v.job===r.job && terminal.has(v.result),"a terminal receipt from the named destination is required");
    const previous=db.prepare("SELECT request,terminal FROM uses WHERE attempt=?").get(r.attempt);
    const end=hash(receipt);
    if(previous) {
      need(previous.request===serial(r) && (!previous.terminal || previous.terminal===end),"receiving histories disagree");
      db.prepare("UPDATE uses SET state='settled',terminal=? WHERE attempt=?").run(end,r.attempt);
    } else {
      // A receiver may withhold before the source sees the request. A delayed prepare
      // must never recreate the reservation after the terminal outcome is acknowledged.
      db.prepare("INSERT INTO uses(attempt,request,state,terminal) VALUES(?,?,'settled',?)").run(r.attempt,serial(r),end);
    }
    editTables(db);finishPendingEdit(db);
    return {status:"settled",outcome:v.result};
  });
}
