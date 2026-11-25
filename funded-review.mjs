// Native private runtime for a single funded, versioned checker handoff.
// Reserve the cost before doing the work. A cold retry fences an abandoned attempt.
import {account, debit, exact, grant, hash, Hold, id, key, need, observations, receiverTerms, serial, signedBy, transaction} from "./review-journal.mjs";
import {behaviorCharge,comparePorts,rememberRuntime,validateProbe} from "./behavior-port.mjs";
import {bindDecision,currentDecision,issuedDecision,questionStep,validateQuestion} from "./owner-question.mjs";
import {editQueryPrice,editQueryTicket,guarded,guardTicket,readGuarded,recordGuarded,settleReservedGate,terminalReadTicket} from "./release-gate.mjs";
import {decoderOps,decoderStep,settleReservedDictionary,validateDecoder} from "./decoder-port.mjs";
import {lateStep} from "./late-port.mjs";
import {withdrawStep} from "./withdrawal.mjs";
import {memoryCharge,memoryStep} from "./memory-port.mjs";
import {planControl} from "./control.mjs";
import {acceptObservation, prepareDelivery} from "./delivery-observation.mjs";
import {cell, certifyReview, compileReview, constructReview, MAX_WORK, validAnswer, validInput} from "./review-program.mjs";

import {recordOps,recordPrice,sourceStep,validateRecordRequest} from "./version-source.mjs";

const jobs={
  request_catalog:["predecessor",["proposal","port","queryDigest"]], read_catalog:["operator",["proposal","attempt"]],
  request_source:["operator",["proposal","port"],["selection","offeredRecord"]], read_source:["operator",["proposal","attempt"]],
  record_release:["operator",["job","attempt","receipt"]],
  recover_terminal:["receiver",["job","attempt"]],
  coordinate_source_edit:["receiver",["job","attempt","source","edit"]],
  pack_dictionary:["operator",["job","pulse"]], route_dictionary:["operator",["job","snapshot"],["memory","first","terminal","readings"]],
  deliver_dictionary:["receiver",["job","snapshot"],["memory","first","terminal","readings"]],record_dictionary:["operator",["job","attempt","receipt"]],
  suggest_question:["operator",["brief","base","question","input","options"],["topic","record","lookup"]],
  answer_question:["predecessor",["proposal","base","choice","answer"],["sourceDecision","meaning","sourcePulse","sourceDigest","chosen"]], question_status:["operator",[],["proposal","after","topic","at"]],
  check_decision:["operator",["job","pulse"]], check_joint:["operator",["job","snapshot","evidence"]],
  ask:["operator",["position","claim"]], observe:["operator",["pulse","receipt"]],
  form:["operator",["base"],["source"]], offer:["operator",["candidate","digest","base"]],
  certify:["predecessor",["candidate","digest","base"]], adopt:["predecessor",["candidate","digest","base"]],
  queue:["operator",["job","revision","position","claim","content"],["receiver","expectedRuntime","decision"]], receive:["receiver",["job"]],
  plan:["operator",["job","rules","system","role","task","workAllowance"]],
  dispatch:["receiver",["job","base","fence"]], inspect:["operator",["job","base","fence"],["inputs","returning"]],
  record:["operator",["job","pulse","observation"]],
  withdraw:["predecessor",["actor","job","oldFence"]], fence:["predecessor",["withdrawal"]],
  confirm_fence:["predecessor",["withdrawal","pulse","observation"]], withdrawal_status:["predecessor",["withdrawal"]],
  compare_ports:["operator",["before","after"]],
  pack_later:["operator",["job","pulse","relation","workAllowance"]], read_later:["operator",["job","memory","question"],["pulse"]],
  pack_memory:["operator",["job","pulse","workAllowance"]], recall_memory:["operator",["job","memory","input","workAllowance"]],
  read:["operator",["job"]], revoke:["predecessor",["actor"]]
};
const ceilBlocks=text=>Math.max(1,Math.ceil(Buffer.byteLength(text,"utf8")/256));
const bound=a=>({account:a.terms.account,subject:a.terms.subject,destination:a.terms.destination,edition:a.terms.edition});
const stopped=reason=>({status:"hold",reason});
function fromProgram(operation) {
  try { return operation(); }
  catch(e) { throw new Hold("Unsupported reviewer: "+e.message); }
}
const permitted=(db,k,op)=>grant(db,k)===jobs[op][0] || (["read_source","read_catalog"].includes(op) && grant(db,k)==="predecessor");
function candidate(db,body) {
  const c=db.prepare("SELECT * FROM candidates WHERE id=?").get(body.candidate);
  need(c && c.digest===body.digest && c.base===body.base,"candidate identity, bytes or base changed");
  return c;
}
function job(db,id) {
  const j=db.prepare("SELECT * FROM jobs WHERE id=?").get(id);
  need(j && grant(db,j.actor)==="operator","delivery unavailable under the current grant");
  return j;
}
function permitRead(db,actor,j) {
  // A project's enrolled operators can recover one another's deliverables. The originating
  // operator must still be authorized. External/public reads have a different contract.
  need(grant(db,actor)==="operator" && grant(db,j.actor)==="operator","delivery unavailable under the current grant");
}
function budgetPrice(db,a,op,d) {
  if(recordOps.includes(op))return recordPrice(a,op,d);
  if (["suggest_question","answer_question","question_status","check_decision","check_joint"].includes(op))return 2+ceilBlocks(serial(d));
  if(op==="pack_later" || op==="read_later")return 2;
  if (op==="pack_memory" || op==="recall_memory") return memoryCharge(db,a,op,d);
  if(op==="record_release" || decoderOps.includes(op))return 2+ceilBlocks(serial(d));
  if(op==="recover_terminal")return 2+Math.ceil(4096/256); // one bounded durable receipt read, including return
  if(op==="coordinate_source_edit")return editQueryPrice(a,d.source);
  const portPrice=behaviorCharge(db,a.terms,op,d);
  if (portPrice!==undefined)return portPrice;
  switch(op) {
    case "ask": return 1+MAX_WORK; // provider's fixed signed observation price, prepaid for the most costly old call
    case "observe": return 2; // receipt verification plus durable retention
    case "form": return 1+2*a.terms.size+(Object.hasOwn(d,"source")?ceilBlocks(d.source):0);
    case "offer": return 1+ceilBlocks(candidate(db,d).image);
    case "certify": return 1+2*a.terms.size+ceilBlocks(candidate(db,d).image);
    case "adopt": return 1+ceilBlocks(candidate(db,d).image);
    case "queue": return 1+ceilBlocks(d.content);
    case "receive": return 1+ceilBlocks(a.installed??""); // load/evaluate; produced work is debited atomically at consumption
    case "plan": return 1+ceilBlocks(serial(d))+Math.ceil(d.workAllowance/64);
    case "dispatch": return 4; // issue ticket, receiver intake, conditional application and durable receipt
    case "inspect": return 3; // issue ticket, independent snapshot and contents
    case "record": return 2; // verify and retain the receiving observation
    case "read": return 2; // separate read of delivery and actual published content
    case "revoke": case "withdrawal_status": return 1;
    case "withdraw": return 2;
    case "fence": return 4;
    case "confirm_fence": return 2;
  }
}
function fields(a,op,d) {
  const [,required,optional]=jobs[op];
  need(exact(d,required,optional),"invalid fields for "+op);
  if(recordOps.includes(op))validateRecordRequest(a,op,d);
  for (const k of ["pulse","base","fence","candidate","job","revision","withdrawal","oldFence","memory"]) if(Object.hasOwn(d,k)) need(id(d[k]),"invalid "+k);
  if (Object.hasOwn(d,"digest")) need(key(d.digest),"invalid image digest");
  if (Object.hasOwn(d,"actor")) need(key(d.actor),"invalid actor");
  if (["suggest_question","answer_question","question_status","check_decision","check_joint"].includes(op))validateQuestion(a.terms.behaviorPort,op,d);
  if(op==="record_release")need(guarded(a) && id(d.attempt) && d.receipt && Buffer.byteLength(serial(d))<=4096,"supply a bounded first-use receipt on the enrolled port");
  if(op==="recover_terminal")need(guarded(a) && id(d.attempt),"supply the original receiving attempt");
  if(op==="coordinate_source_edit")need(guarded(a) && id(d.attempt) && key(d.source) && id(d.edit),"identify the enrolled source edit and original receiving attempt");
  if(decoderOps.includes(op))validateDecoder(a.terms.behaviorPort,op,d);
  if (op==="compare_ports") need(a.terms.behaviorPort && id(d.before) && id(d.after) && d.before!==d.after,"supply two jobs on the enrolled port");
  if (op==="pack_memory" || op==="recall_memory") {
    need(a.terms.behaviorPort?.memory && Number.isSafeInteger(d.workAllowance) && d.workAllowance>=1 && d.workAllowance<=1000000,
      "supply an enrolled memory port and a bounded computation allowance");
    if (op==="recall_memory")validateProbe(a.terms.behaviorPort,[d.input]);
  }
  if(op==="pack_later")need(a.terms.behaviorPort?.late && d.relation && typeof d.relation==="object" &&
    Number.isSafeInteger(d.workAllowance) && d.workAllowance>=1 && d.workAllowance<=5000000 &&
    Buffer.byteLength(serial(d.relation))<=1048576,"supply the approved late relation and a finite construction allowance");
  if(op==="read_later")need(a.terms.behaviorPort?.late && id(d.question),"supply an approved returning question");
  if(Object.hasOwn(d,"returning"))need(a.terms.behaviorPort?.late && d.inputs?.length===1 &&
    exact(d.returning,["memory","question"]) && id(d.returning.memory) && id(d.returning.question),"invalid returning observation route");
  if (Object.hasOwn(d,"expectedRuntime")) need(a.terms.behaviorPort && d.receiver && key(d.expectedRuntime),"a runtime digest needs a funded receiver and enrolled port");
  if (Object.hasOwn(d,"inputs")) validateProbe(a.terms.behaviorPort,d.inputs);
  if (op==="plan") {
    need(typeof d.rules==="string" && d.system && d.task && id(d.role) && Number.isSafeInteger(d.workAllowance) &&
      d.workAllowance>=1 && d.workAllowance<=1000000 && Buffer.byteLength(serial(d),"utf8")<=65536,
      "supply a bounded plan, explicit computation allowance and enrolled job");
  }
  if (Object.hasOwn(d,"receiver")) {
    need(receiverTerms(a.terms.receiverContract) && exact(d.receiver,["base","fence"]) &&
      id(d.receiver.base) && id(d.receiver.fence),"external work must name its enrolled base and grant epoch");
  }
  if (Object.hasOwn(d,"position")) need(validInput(a.terms.size,d.position,d.claim),"input outside the enrolled domain");
  if (Object.hasOwn(d,"content")) need(typeof d.content==="string" && Buffer.byteLength(d.content,"utf8")<=8192,"delivery exceeds the enrolled payload size");
  if (op==="form" && Object.hasOwn(d,"source")) need(typeof d.source==="string" && d.source.length>0 && d.source.length<=10000,"invalid review program size");
}

function perform(db,a,request) {
  const k=request.key, {id:rid,op,data:d}=request.body, size=a.terms.size;
  if(recordOps.includes(op))return sourceStep(db,a,request);
  if (op==="ask") {
    need(a.installed===null && a.revision===a.terms.before && grant(db,a.terms.sourceKey)==="source","the incumbent source edition is no longer active");
    const known=db.prepare("SELECT cell FROM observations WHERE cell=?").get(cell(d.position,d.claim));
    need(!known,"this input already has an issued observation");
    db.prepare("INSERT INTO pulses VALUES(?,?,?,?)").run(rid,k,d.position,Number(d.claim));
    return {status:"requested",pulse:rid,binding:a.binding,sourceKey:a.terms.sourceKey,position:d.position,claim:d.claim};
  }
  if (op==="observe") {
    const q=db.prepare("SELECT * FROM pulses WHERE id=?").get(d.pulse);
    need(q && grant(db,q.actor)==="operator" && grant(db,a.terms.sourceKey)==="source","no authorized live source request");
    need(signedBy("observation",d.receipt,a.terms.sourceKey),"source signature did not verify");
    const r=d.receipt.body;
    need(exact(r,["binding","pulse","position","claim","verdict","work"]) && r.binding===a.binding && r.pulse===q.id &&
      q.position===r.position && Boolean(q.claim)===r.claim && validAnswer(r),"observation does not cover this funded question");
    const i=cell(q.position,Boolean(q.claim)), answer=serial({verdict:r.verdict,work:r.work});
    const old=db.prepare("SELECT answer FROM observations WHERE cell=?").get(i);
    if (old) {
      if (old.answer!==answer) {
        db.prepare("INSERT OR IGNORE INTO disputes VALUES(?,?)").run(i,serial(d.receipt));
        return {status:"hold",reason:"contradictory signed readings invalidate reliance on this input",position:q.position,claim:Boolean(q.claim)};
      }
      return {status:"already_observed",position:q.position,claim:Boolean(q.claim)};
    }
    db.prepare("INSERT INTO observations VALUES(?,?,?,?)").run(i,q.id,answer,serial(d.receipt));
    return {status:"observed",position:q.position,claim:Boolean(q.claim)};
  }
  if (["suggest_question","answer_question","question_status"].includes(op))return questionStep(db,a,request);
  if (op==="form") {
    need(a.installed===null && d.base===a.revision && a.revision===a.terms.before,"candidate base is stale");
    const prior=observations(db,size);
    const image=d.source??constructReview(size,prior);
    fromProgram(()=>compileReview(size,image));
    const digest=hash(["review-program/1",image]);
    db.prepare("INSERT INTO candidates VALUES(?,?,?,?,?,?)").run(rid,k,d.base,image,digest,"formed");
    return {status:"formed",candidate:rid,digest,base:d.base,source:image};
  }
  if (["offer","certify","adopt"].includes(op)) {
    const c=candidate(db,d);
    need(a.installed===null && c.base===a.revision && a.revision===a.terms.before,"candidate base is stale");
    need(grant(db,c.actor)==="operator","candidate author no longer has authority");
    if (op==="offer") {
      need(c.actor===k && c.stage==="formed","only the forming caller can emit this pending candidate");
      db.prepare("UPDATE candidates SET stage='offered' WHERE id=?").run(c.id);
      return {status:"offered",candidate:c.id,digest:c.digest};
    }
    if (op==="certify") {
      need(c.stage==="offered","the predecessor has no pending offer");
      const prior=observations(db,size);
      const comparison=fromProgram(()=>certifyReview(size,c.image,prior));
      db.prepare("UPDATE candidates SET stage=? WHERE id=?").run(comparison.status==="preserved"?"certified":"rejected",c.id);
      return {...comparison,candidate:c.id,digest:c.digest};
    }
    need(!db.prepare("SELECT cell FROM disputes LIMIT 1").get(),"incumbent evidence changed after certification");
    need(c.stage==="certified","the predecessor must certify the exact offered image before authorizing its use");
    db.prepare("UPDATE account SET revision=?,installed=? WHERE singleton=1").run(c.digest,c.image);
    db.prepare("UPDATE candidates SET stage='adopted' WHERE id=?").run(c.id);
    return {status:"adopted",candidate:c.id,digest:c.digest,...bound(a)};
  }
  if (["withdraw","fence","confirm_fence","withdrawal_status"].includes(op)) return withdrawStep(db,a,request);
  if (op==="revoke") {
    need(["operator","source","receiver","version_source"].includes(grant(db,d.actor)),"no such revocable current grant");
    db.prepare("UPDATE grants SET active=0 WHERE key=?").run(d.actor);
    return {status:"revoked",scope:"source_account"};
  }
  if (op==="compare_ports") {
    const result=comparePorts(db,a,request,job);
    debit(db,rid,"emit the observed comparison",ceilBlocks(serial(result)));
    return result;
  }
  if (op==="queue") {
    currentDecision(db,a,d.decision);
    const old=db.prepare("SELECT * FROM jobs WHERE id=?").get(d.job);
    const fingerprint=hash([k,d]);
    if (old) {
      need(old.fingerprint===fingerprint,"job identifier already binds different work");
      return {status:"already_queued",job:d.job,revision:old.revision};
    }
    if (a.terms.behaviorPort?.question)need(d.expectedRuntime && d.receiver,"the decided job requires a named destination and observable running implementation");
    need(a.installed!==null && a.revision===d.revision,"new work must use the installed predecessor-authorized image");
    db.prepare("INSERT INTO jobs VALUES(?,?,?,?,?,?,?)").run(d.job,k,d.revision,d.position,Number(d.claim),d.content,fingerprint);
    if (d.receiver) {
      db.exec("CREATE TABLE IF NOT EXISTS receiver_routes(job TEXT PRIMARY KEY REFERENCES jobs(id), base TEXT NOT NULL, fence TEXT NOT NULL)");
      db.prepare("INSERT INTO receiver_routes VALUES(?,?,?)").run(d.job,d.receiver.base,d.receiver.fence);
    }
    bindDecision(db,a,d.job,d.decision);
    if(d.expectedRuntime) rememberRuntime(db,d.job,d.expectedRuntime);
    return {status:"queued",job:d.job,revision:d.revision};
  }
  const j=job(db,d.job);
  if(op==="record_release")return recordGuarded(db,a,request);
  if(op==="recover_terminal")return terminalReadTicket(db,a,request);
  if(op==="coordinate_source_edit")return editQueryTicket(db,a,request);
  if(decoderOps.includes(op)) {
    if(op==="deliver_dictionary")currentDecision(db,a,issuedDecision(db,a,j.id),false);
    return decoderStep(db,a,request);
  }
  if(op==="check_decision" || op==="check_joint")return questionStep(db,a,request);
  if(["dispatch","plan","receive"].includes(op))currentDecision(db,a,issuedDecision(db,a,j.id));
  if(op==="pack_later" || op==="read_later")return lateStep(db,a,request);
  if(op==="pack_memory" || op==="recall_memory")return memoryStep(db,a,request);
  const previous=db.prepare("SELECT * FROM deliveries WHERE job=?").get(j.id);
  if (op==="plan") {
    need(receiverTerms(a.terms.receiverContract) && previous?.verdict==="allow" && previous.revision===j.revision,
      "the planner needs a reviewed job and separately enrolled destination");
    need(!db.prepare("SELECT cell FROM disputes WHERE cell=?").get(cell(j.position,Boolean(j.claim))),
      "the evidence for this delivery is disputed");
    const system=structuredClone(d.system);
    need(system.roles && Object.hasOwn(system.roles,d.role) && system.roles[d.role] && typeof system.roles[d.role]==="object",
      "unknown role in the submitted model");
    system.roles[d.role].budget=a.balance;
    let plan;
    try { plan=planControl(d.rules,system,d.role,d.task,d.workAllowance); }
    catch(error) { throw new Hold("Unsupported planning input: "+error.message); }
    const written=ceilBlocks(serial(plan.policy??plan.obstruction??[plan.status,plan.minimumWorstCaseCost]));
    debit(db,rid,"emit the recovery decision or policy",written);
    const remaining=account(db).balance;
    if (plan.status==="within_budget" && plan.minimumWorstCaseCost>remaining)
      plan={...plan,status:"over_budget"};
    return {...plan,budget:remaining,job:j.id,revision:j.revision,modelDigest:hash([d.rules,d.system,d.role,d.task]),
      prepaidComputation:d.workAllowance,emissionCharge:written,openingExecutionBalance:remaining};
  }
  if (["dispatch","inspect","record"].includes(op)) {
    need(receiverTerms(a.terms.receiverContract),"this account has no enrolled external receiver contract");
    if (op==="record") return acceptObservation(db,a,d,j);
    if (op==="dispatch") need(!db.prepare("SELECT cell FROM disputes WHERE cell=?").get(cell(j.position,Boolean(j.claim))),
      "the evidence for this authorized job is disputed");
    const route=prepareDelivery(db,a,request,j,previous);
    return op==="dispatch" && guarded(a)?guardTicket(db,a,request,j,route):route;
  }
  if (op==="receive") {
    if (previous) return {status:"already_received",job:j.id,revision:previous.revision};
    need(a.installed!==null && a.revision===j.revision && hash(["review-program/1",a.installed])===j.revision,"installed revision does not match the destination job");
    need(!db.prepare("SELECT cell FROM disputes WHERE cell=?").get(cell(j.position,Boolean(j.claim))),"this input has contradictory authenticated readings");
    const result=fromProgram(()=>compileReview(size,a.installed)(j.position,Boolean(j.claim)));
    // This debit, delivery and the asset visible to a separate connection are one
    // transactional effect. The parse and attempted execution were prepaid.
    debit(db,rid,"first-use review work",result.work);
    db.prepare("INSERT INTO deliveries VALUES(?,?,?,?)").run(j.id,j.revision,result.verdict,result.work);
    if (result.verdict==="allow" && !guarded(a)) db.prepare("INSERT INTO publications VALUES(?,?)").run(j.id,j.content);
    return {status:"received",job:j.id,revision:j.revision,...result};
  }
  permitRead(db,k,j);
  need(previous,"no received result for this job");
  if(guarded(a) && previous.verdict==="allow") {
    const observed=readGuarded(db,j);
    return {status:"read_back",job:j.id,revision:previous.revision,verdict:previous.verdict,work:previous.work,
      content:j.content,observed,basisDisputed:Boolean(db.prepare("SELECT cell FROM disputes WHERE cell=?").get(cell(j.position,Boolean(j.claim)))),...bound(a)};
  }
  const asset=db.prepare("SELECT content FROM publications WHERE job=?").get(j.id);
  need((previous.verdict==="allow")===Boolean(asset) && (!asset || asset.content===j.content),"actual destination content disagrees with the reviewed delivery");
  return {status:"read_back",job:j.id,revision:previous.revision,verdict:previous.verdict,work:previous.work,
    content:asset?asset.content:null,basisDisputed:Boolean(db.prepare("SELECT cell FROM disputes WHERE cell=?").get(cell(j.position,Boolean(j.claim)))),...bound(a)};
}

function authenticate(db,request) {
  const a=account(db),r=request?.body,k=request?.key;
  need(exact(r,["binding","id","op","data"]) && r.binding===a.binding && id(r.id) &&
       typeof r.op==="string" && Object.hasOwn(jobs,r.op) && signedBy("request",request,k),"request denied");
  need(grant(db,k)!==undefined,"request denied");
  return a;
}

export function reserveReview(db,request,recover=false) {
  return transaction(db,()=>{
    let a;
    try {
      a=authenticate(db,request);
      const k=request.key,{id:rid,op,data:d}=request.body;
      if(op==="record_release") {
        const settled=settleReservedGate(db,a,request);
        if(settled)return {done:settled};
      }
      if(op==="record_dictionary") {
        const settled=settleReservedDictionary(db,a,request);
        if(settled)return {done:settled};
      }
      debit(db,rid,"authenticate and reopen the account",1);
      need(permitted(db,k,op),"operation unavailable for this role");
      fields(a,op,d);
      const fingerprint=hash(request.body), existing=db.prepare("SELECT * FROM operations WHERE id=?").get(rid);
      if (existing) {
        need(existing.actor===k && existing.fingerprint===fingerprint,"request identifier already binds different work");
        if (["read","receive","plan","dispatch","inspect","record","pack_memory","recall_memory","pack_later","read_later"].includes(op)) job(db,d.job);
        if (existing.answer!==null) {
          if(op==="recover_terminal" || op==="coordinate_source_edit")return {done:JSON.parse(existing.answer)};
          if (op==="dispatch") {
            currentDecision(db,a,issuedDecision(db,a,d.job));
            if(guarded(a))return {done:JSON.parse(existing.answer)};
          }
          if (op==="queue")currentDecision(db,a,d.decision);
          if (op==="check_decision" || op==="check_joint" || decoderOps.includes(op))job(db,d.job);
          if (op==="deliver_dictionary") {
            currentDecision(db,a,issuedDecision(db,a,d.job),false);
            // Return the original paid ticket. The actual sink checks current grants,
            // evidence and the running edition at the one-shot point of use.
            return {done:JSON.parse(existing.answer)};
          }
          if (op==="plan") {
            const previousPlan=JSON.parse(existing.answer);
            return {done:{status:"historical_plan",issuedStatus:previousPlan.status,modelDigest:previousPlan.modelDigest,
              issuedExecutionBalance:previousPlan.openingExecutionBalance,remainingNow:account(db).balance,
              replayed:true,historical:true,reason:"a fresh planning decision requires current evidence and funding"}};
          }
          if (["read_source","read_catalog","withdraw","confirm_fence","withdrawal_status","compare_ports","recall_memory","read_later","question_status","check_decision","check_joint","route_dictionary","record_dictionary","record_release","deliver_dictionary"].includes(op)) {
            debit(db,rid,"reassess current evidence",budgetPrice(db,a,op,d));
            return {done:{...perform(db,a,request),replayed:true}};
          }
          if (op==="record") {
            debit(db,rid,"reassess destination observation",budgetPrice(db,a,op,d));
            return {done:{...perform(db,a,request),replayed:true,historical:true}};
          }
          if (op==="read") {
            // Reading the current destination has observable freshness and cost even when
            // the caller repeats the exact request after a dispute or a failed delivery.
            debit(db,rid,"reinspect destination",budgetPrice(db,a,op,d));
            return {done:{...perform(db,a,request),replayed:true,freshRead:true}};
          }
          return {done:{...JSON.parse(existing.answer),replayed:true,historical:true}};
        }
        need(recover,"paid attempt pending; explicitly recover this same signed request");
      }
      const price=budgetPrice(db,a,op,d);
      debit(db,rid,"reserved "+op,price);
      const epoch=(existing?.epoch??0)+1;
      if (existing) db.prepare("UPDATE operations SET epoch=? WHERE id=?").run(epoch,rid);
      else db.prepare("INSERT INTO operations VALUES(?,?,?,?,NULL)").run(rid,k,fingerprint,epoch);
      return {ticket:{id:rid,epoch,fingerprint}};
    } catch(e) {
      if(e instanceof Hold) return {done:stopped(e.message)};
      throw e;
    }
  });
}

export function finishReview(db,request,ticket) {
  return transaction(db,()=>{
    const a=account(db),r=request.body,p=db.prepare("SELECT * FROM operations WHERE id=?").get(ticket.id);
    if (!p || p.fingerprint!==ticket.fingerprint || p.fingerprint!==hash(r) || p.actor!==request.key ||
        p.epoch!==ticket.epoch || p.answer!==null) return stopped("attempt superseded or already finished");
    let answer;
    try {
      need(permitted(db,request.key,r.op),"authority changed before the operation committed");
      answer=perform(db,a,request);
    } catch(e) {
      if (!(e instanceof Hold)) throw e;
      answer=stopped(e.message);
    }
    db.prepare("UPDATE operations SET answer=? WHERE id=?").run(serial(answer),ticket.id);
    return answer;
  });
}
export function advanceReview(db,request,recover=false) {
  const pending=reserveReview(db,request,recover);
  return pending.done??finishReview(db,request,pending.ticket);
}
