import {exact,grant,hash,id,need,signedBy} from "./review-journal.mjs";

function openTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS withdrawals(
      id TEXT PRIMARY KEY, actor TEXT NOT NULL, job TEXT NOT NULL, store TEXT NOT NULL,
      old_fence TEXT NOT NULL, new_fence TEXT NOT NULL, confirmed_pulse TEXT, snapshot TEXT,
      observed_generation INTEGER NOT NULL DEFAULT -1, observation_identity TEXT,
      disputed_through INTEGER NOT NULL DEFAULT -1, state TEXT NOT NULL DEFAULT 'pending',
      UNIQUE(store,old_fence));
    CREATE TABLE IF NOT EXISTS withdrawal_readings(pulse TEXT PRIMARY KEY, digest TEXT NOT NULL, generation INTEGER NOT NULL, disputed INTEGER NOT NULL);
  `);
}
function view(entry) {
  const result={withdrawal:entry.id,actor:entry.actor,store:entry.store,oldFence:entry.old_fence,
    newFence:entry.new_fence,sourceRevoked:true};
  if (entry.state==="confirmed") return {...result,status:"withdrawal_confirmed",asOfSnapshot:entry.snapshot,
    generation:entry.observed_generation,acknowledgedPulse:entry.confirmed_pulse};
  return {...result,status:entry.state==="disputed"?"withdrawal_disputed":"withdrawal_pending"};
}
function start(db,a,request) {
  const {actor,job,oldFence}=request.body.data,store=a.terms.receiverContract.store;
  need(id(oldFence),"withdrawal must identify an existing receiver epoch");
  const owner=db.prepare("SELECT role FROM grants WHERE key=?").get(actor);
  need(owner?.role==="operator","unsupported withdrawal target");
  const routed=db.prepare("SELECT 1 FROM sqlite_master WHERE name='receiver_routes' AND type='table'").get();
  const route=routed&&db.prepare("SELECT j.actor,r.fence FROM jobs j JOIN receiver_routes r ON j.id=r.job WHERE j.id=?").get(job);
  need(route?.actor===actor && route.fence===oldFence,"the requested scope does not match this operator's routed job");
  const prior=db.prepare("SELECT * FROM withdrawals WHERE store=? AND old_fence=?").get(store,oldFence);
  if (prior) {
    need(prior.actor===actor && prior.job===job,"this epoch already has a different withdrawal in progress");
    return view(prior);
  }
  const wid=request.body.id;
  const next=hash(["phaseline.receiver-epoch/1",a.binding,store,oldFence,wid]);
  need(next!==oldFence,"withdrawal did not produce a fresh epoch");
  db.prepare("INSERT INTO withdrawals(id,actor,job,store,old_fence,new_fence) VALUES(?,?,?,?,?,?)").run(wid,actor,job,store,oldFence,next);
  db.prepare("UPDATE grants SET active=0 WHERE key=?").run(actor);
  return view(db.prepare("SELECT * FROM withdrawals WHERE id=?").get(wid));
}

export function withdrawStep(db,a,request) {
  need(a.terms.withdrawal==="receiver_ack/1","no external withdrawal was granted at enrollment");
  openTables(db);
  const {op,data:d,id:pulse}=request.body;
  if (op==="withdraw") return start(db,a,request);
  const e=db.prepare("SELECT * FROM withdrawals WHERE id=?").get(d.withdrawal);
  need(e && !grant(db,e.actor),"unknown withdrawal or local originator remains active");
  if (op==="withdrawal_status") return view(e);
  if (op==="fence") return {status:"fence_ticket",purpose:"withdraw",binding:a.binding,pulse,withdrawal:e.id,
    actor:e.actor,store:e.store,oldFence:e.old_fence,newFence:e.new_fence};
  const issue=db.prepare("SELECT actor,answer FROM operations WHERE id=?").get(d.pulse);
  const t=issue?.answer && JSON.parse(issue.answer);
  need(t?.status==="fence_ticket"&&issue.actor===a.root&&t.binding===a.binding&&t.withdrawal===e.id,"the account never issued this fence pulse");
  need(signedBy("fence_observation",d.observation,a.terms.receiverKey),"the enrolled receiver must attest its own fence");
  const body=d.observation.body;
  need(exact(body,["ticketHash","snapshot","generation","activeFence","receipt","oldRetired"]) &&
    body.ticketHash===hash(t) && id(body.snapshot) && id(body.activeFence) &&
    Number.isSafeInteger(body.generation) && body.generation>=0 && typeof body.oldRetired==="boolean",
    "receiver evidence does not cover this funded request");
  if (body.receipt!==null) {
    const r=body.receipt;
    need(exact(r,["withdrawal","store","oldFence","newFence"]) && r.withdrawal===e.id && r.store===e.store &&
      r.oldFence===e.old_fence && r.newFence===e.new_fence, "receipt names a different transition");
    need(body.oldRetired && body.activeFence!==e.old_fence,"receiver contradicts its retirement receipt");
  }
  const readings=db.prepare("SELECT * FROM withdrawal_readings WHERE pulse=?");
  const current=()=>view(db.prepare("SELECT * FROM withdrawals WHERE id=?").get(e.id));
  const dispute=(through,reason)=>{
    db.prepare("UPDATE withdrawals SET state='disputed', disputed_through=MAX(disputed_through,?), confirmed_pulse=NULL WHERE id=?").run(through,e.id);
    return {...current(),reason};
  };
  const old=readings.get(d.pulse), dig=hash(body);
  if (old && (old.disputed || old.digest!==dig)) {
    db.prepare("UPDATE withdrawal_readings SET disputed=1, generation=MAX(generation,?) WHERE pulse=?").run(body.generation,d.pulse);
    const through=Math.max(old.generation,body.generation);
    if (through<e.observed_generation) return {...current(),olderObservation:true};
    return dispute(through,"two statements for one paid fence observation");
  }
  if (!old) db.prepare("INSERT INTO withdrawal_readings VALUES(?,?,?,0)").run(d.pulse,dig,body.generation);
  if (body.generation<e.observed_generation || body.generation<=e.disputed_through)
    return {...current(),olderObservation:true};
  const identity=hash([body.snapshot,body.activeFence,body.oldRetired,body.receipt]);
  if (e.observation_identity!==null && e.observed_generation===body.generation && e.observation_identity!==identity)
    return dispute(body.generation,"incompatible receiver records at one generation");
  const state=body.receipt?"confirmed":e.state==="pending"?"pending":"disputed";
  db.prepare("UPDATE withdrawals SET state=?, observed_generation=?, observation_identity=?, snapshot=?, confirmed_pulse=? WHERE id=?")
    .run(state,body.generation,identity,body.snapshot,body.receipt?d.pulse:null,e.id);
  return body.receipt?current():{...current(),reason:"the destination has no receipt for this withdrawal"};
}
