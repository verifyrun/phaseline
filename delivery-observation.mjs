// Reconcile one external release with what the receiving store could actually see.
import {returnTicket} from "./late-port.mjs";
import {acceptBehavior,disputeBehavior,expectedRuntime,validateReading} from "./behavior-port.mjs";
import {exact, grant, hash, id, key, need, receiverTerms, signedBy} from "./review-journal.mjs";

// A scope is admitted by the opening predecessor grant. Old enrollments
// have no external destination budget or authority by implication.
export function prepareDelivery(db, account, request, job, delivery) {
  const terms=account.terms.receiverContract;
  need(receiverTerms(terms), "this account has no enrolled external receiver contract");
  const {id:pulse, op, data} = request.body;
  need(account.revision===job.revision && delivery?.revision===job.revision,
    "the queued job has no reviewed result under the active edition");
  need(delivery.verdict==="allow", "the local reviewed job is ineligible for external delivery");
  const hasRoutes=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='receiver_routes'").get();
  const route=hasRoutes && db.prepare("SELECT base,fence FROM receiver_routes WHERE job=?").get(job.id);
  need(route && route.base===data.base && route.fence===data.fence,
    "the job was not authorized for this destination version and grant epoch");
  const jobKey=hash(["phaseline.delivery/1",account.binding,terms.store,job.id,job.fingerprint]);
  if (op==="dispatch" && terms.repeat==="may_repeat") {
    // A negative observation of the destination cannot cancel a delayed message.
    // Issue just one transport attempt until a separately supported fencing protocol exists.
    db.exec("CREATE TABLE IF NOT EXISTS single_dispatch(job TEXT PRIMARY KEY, pulse TEXT NOT NULL)");
    const prior=db.prepare("SELECT pulse FROM single_dispatch WHERE job=?").get(job.id);
    need(!prior,"previous dispatch may still take effect at this non-deduplicating receiver");
    db.prepare("INSERT INTO single_dispatch VALUES(?,?)").run(job.id,pulse);
  }
  return {status:"receiver_ticket",purpose:op==="dispatch"?"attempt":"inspect",
    binding:account.binding, pulse, store:terms.store, history:terms.history, repeat:terms.repeat, job:job.id,
    jobKey, revision:job.revision, contentHash:hash(["text/1",job.content]),
    base:data.base, fence:data.fence,
    ...(data.returning?{returning:returnTicket(db,account,request)}:{}),
    ...(data.inputs?{behavior:{port:account.terms.behaviorPort.id,expected:expectedRuntime(db,job.id),inputs:data.inputs,
      ...(account.terms.behaviorPort.output?{output:account.terms.behaviorPort.output}:{})}}:{})};
}

export function interpretObservation(ticket, reading) {
  const {receipt, current, activeFence, snapshot}=reading;
  need(id(snapshot) && id(activeFence) && exact(current,["release","contentHash"]) &&
       id(current.release) && key(current.contentHash),"receiver observation is incomplete");
  need(receipt===null || (exact(receipt,["jobKey","revision","contentHash","base","fence","release","attempt"])
    && key(receipt.jobKey) && key(receipt.revision) && key(receipt.contentHash)
    && id(receipt.base) && id(receipt.fence) && id(receipt.release) && id(receipt.attempt)),"invalid receiver receipt");
  need(ticket.history==="complete_job_log" || receipt===null,
    "the enrolled interface only observes current content");
  const common={atSnapshot:snapshot, matchesCurrentBytes:current.contentHash===ticket.contentHash,
    observedRelease:current.release, observedFence:activeFence};
  if (receipt!==null) {
    if (receipt.jobKey!==ticket.jobKey || receipt.revision!==ticket.revision ||
        receipt.contentHash!==ticket.contentHash || receipt.base!==ticket.base || receipt.fence!==ticket.fence)
      return {...common, status:"hold", reason:"the receiver record disagrees with the requested release"};
    if (current.release===receipt.release && !common.matchesCurrentBytes)
      return {...common, status:"hold", reason:"the recorded release currently serves different bytes"};
    return {...common, status:current.release===receipt.release?"delivery_confirmed":"delivery_superseded", occurrence:"applied",
      observedJobRelease:receipt.release, appliedAttempt:receipt.attempt, currentJobRelease:current.release===receipt.release};
  }
  // A matching current file cannot identify its author. Loss of a reply at a
  // consumer without a complete job record leaves occurrence unresolved.
  if (ticket.history==="current_content_only")
    return {...common,status:"occurrence_unknown",occurrence:"unknown",repeatProtected:ticket.repeat==="stable_job"};
  return {...common,status:"delivery_absent",occurrence:"absent",currentJobRelease:false,
    repeatProtected:ticket.repeat==="stable_job", baseAndFenceStillMatch:ticket.base===current.release && ticket.fence===activeFence};
}

export function acceptObservation(db, account, data, job) {
  const stored=db.prepare("SELECT actor,answer FROM operations WHERE id=?").get(data.pulse);
  need(stored?.answer && grant(db,stored.actor)==="operator","no funded inspection under an active grant");
  const ticket=JSON.parse(stored.answer);
  need(ticket.status==="receiver_ticket" && ticket.purpose==="inspect" && ticket.job===job.id &&
       ticket.binding===account.binding,"inspection ticket does not cover the job");
  const packet=data.observation;
  need(signedBy("destination_observation",packet,account.terms.receiverKey),
    "receiver did not attest this observation");
  const r=packet.body;
  need(exact(r,["ticketHash","snapshot","activeFence","current","receipt"],["behavior"]) && r.ticketHash===hash(ticket),
    "receiver statement covers a different funded inspection");
  // Each accepted observation is indexed by its exact signed inspection. Do not
  // accept two claims as current for a single paid sample.
  db.exec("CREATE TABLE IF NOT EXISTS receiver_observations(pulse TEXT PRIMARY KEY, digest TEXT NOT NULL, disputed INTEGER NOT NULL)");
  const digest=hash(r);
  const old=db.prepare("SELECT digest,disputed FROM receiver_observations WHERE pulse=?").get(data.pulse);
  if (old && (old.digest!==digest || old.disputed)) {
    validateReading(ticket.behavior,r.behavior);
    interpretObservation(ticket,r);
    db.exec("CREATE TABLE IF NOT EXISTS receiver_conflicts(pulse TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(pulse,digest))");
    const known=db.prepare("SELECT 1 FROM receiver_conflicts WHERE pulse=? AND digest=?").get(data.pulse,digest);
    if (digest!==old.digest && !known) {
      disputeBehavior(db,ticket,r);
      db.prepare("INSERT INTO receiver_conflicts VALUES(?,?)").run(data.pulse,digest);
    }
    db.prepare("UPDATE receiver_observations SET disputed=1 WHERE pulse=?").run(data.pulse);
    return {status:"hold",reason:"the receiver issued incompatible accounts of one inspection"};
  }
  const result=interpretObservation(ticket,r);
  if (result.occurrence==="applied") {
    const entry=db.prepare("SELECT answer FROM operations WHERE id=?").get(result.appliedAttempt);
    const attempted=entry?.answer && JSON.parse(entry.answer);
    const authorized=(attempted?.status==="receiver_ticket" && attempted.purpose==="attempt") ||
      (account.terms.behaviorPort?.question?.beforeUse==="checked/1" && attempted?.status==="guarded_ticket" && attempted.purpose==="guarded_first_use");
    need(authorized &&
      ["binding","store","jobKey","revision","contentHash","base","fence"].every(k=>attempted[k]===ticket[k]),
      "the claimed effect has no matching funded dispatch from this account");
  }
  const observed=acceptBehavior(db,ticket,r,result,account.terms.behaviorPort?.memory || account.terms.behaviorPort?.late || account.terms.behaviorPort?.decoder || account.terms.behaviorPort?.question);
  if (!old) db.prepare("INSERT INTO receiver_observations VALUES(?,?,0)").run(data.pulse,digest);
  return {...observed, job:job.id, revision:job.revision, pulse:ticket.pulse};
}
