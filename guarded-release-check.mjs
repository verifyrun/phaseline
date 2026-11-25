// Exercise the normal signed API, local reader, funded first use and receiver restart.
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {enroll,hash,Hold,openExisting,signedBytes} from "./review-journal.mjs";
import {advanceReview} from "./funded-review.mjs";
import {activateCheckedRelease,createReceivingStore,readVisibleRelease,stageReceivingReader} from "./guarded-receiver.mjs";
import {briefDigest} from "./owner-question.mjs";

function identity(){
  const {privateKey,publicKey}=generateKeyPairSync("ed25519");
  const key=publicKey.export({type:"spki",format:"der"}).subarray(-32).toString("hex");
  return {key,sign:(kind,body)=>({key,body,signature:sign(null,signedBytes(kind,body),privateKey).toString("hex")})};
}
const [owner,author,peer,source,receiver]=Array.from({length:5},identity);
const brief="Keep annotations on an imported sketch.",inp=["note"];
const adapter={identify:config=>hash(["drawing viewer/1",config]),read:(content,cfg,inputs)=>{
  const doc=JSON.parse(content);
  return inputs.map(([field])=>Object.hasOwn(doc,field)?doc[field]:cfg.default);
}};
const dir=mkdtempSync(join(tmpdir(),"phaseline-first-use-"));
const terms={account:"studio",subject:"sketch",before:"v1",edition:"v2",destination:"viewer",operators:[author.key,peer.key],
  sourceKey:source.key,receiverKey:receiver.key,size:1,tariff:"review-operations/1",
  receiverContract:{store:"portfolio",repeat:"stable_job",history:"complete_job_log"},behaviorPort:{id:"drawing",
    basis:"the released drawing's annotation",price:3,inputs:[inp],output:"exact-json/1",
    question:{brief:briefDigest(brief),beforeUse:"checked/1"}}};
function course(label,budget){
  const file=join(dir,label+".sqlite"),dest=join(dir,label+"-reader.sqlite");
  const opening={...terms,budget},binding=enroll(file,owner.key,owner.sign("enrollment",opening)).binding;
  let db=openExisting(file);
  const act=(who,id,op,data)=>advanceReview(db,who.sign("request",{binding,id,op,data}));
  const cfg={default:"keep the original sketch"},target=cfg.default;
  createReceivingStore(dest,binding,"portfolio",cfg);
  function queue(job,content,base,config=cfg) {
    const revision=db.prepare("SELECT revision FROM account").get().revision;
    const data={job,content,revision,position:0,claim:false,decision:"owner-approved",
      expectedRuntime:adapter.identify(config),receiver:{base,fence:"active"}};
    assert.equal(act(author,"queue-"+job,"queue",data).status,"queued");
    assert.equal(act(receiver,"review-"+job,"receive",{job}).status,"received");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM publications").get().n,0);
  }
  const issue=(job,id,base)=>act(receiver,id,"dispatch",{job,base,fence:"active"});
  const activate=(ticket,signer=receiver.sign)=>activateCheckedRelease(dest,file,ticket,adapter,signer);
  const settle=(ticket,receipt,id)=>act(peer,id,"record_release",{job:ticket.job,attempt:ticket.pulse,receipt});
  const seen=()=>readVisibleRelease(dest,adapter,[inp]);
  try {
    for(const [n,verdict] of ["allow","refuse"].entries()) {
      const pulse="ask-"+n,claim=!!n;
      assert.equal(act(author,pulse,"ask",{position:0,claim}).status,"requested");
      const receipt=source.sign("observation",{binding,pulse,position:0,claim,verdict,work:1});
      assert.equal(act(author,"observation-"+n,"observe",{pulse,receipt}).status,"observed");
    }
    const c=act(author,"candidate","form",{base:"v1"}),ref={base:"v1",candidate:"candidate",digest:c.digest};
    assert.equal(act(author,"offer","offer",ref).status,"offered");
    assert.equal(act(owner,"certify","certify",ref).status,"preserved");
    assert.equal(act(owner,"adopt","adopt",ref).status,"adopted");
    assert.equal(act(author,"ask-owner","suggest_question",{brief,base:"initial",question:"What should the new viewer show?",
      input:inp,options:[]}).status,"question_proposed");
    assert.equal(act(owner,"words","answer_question",{base:"initial",proposal:"ask-owner",choice:null,answer:target}).status,"question_open");
    assert.equal(act(owner,"owner-approved","answer_question",{base:"words",sourceDecision:"words",proposal:"ask-owner",choice:"owner",
      answer:"Use the original note."}).status,"question_adopted");
    queue("first","{}","initial");
    const t=issue("first","first-switch","initial");
    if(t.status==="hold") {
      assert.match(t.reason,/insufficient balance/);
      assert.deepEqual(seen(),{release:"initial",values:null});
      return {held:true};
    }
    assert.equal(t.purpose,"guarded_first_use");
    const cost=budget-db.prepare("SELECT balance FROM account").get().balance;
    assert.deepEqual(seen(),{release:"initial",values:null});
    // A negative acknowledgement at signing time must roll back a would-be activation.
    assert.throws(()=>activate(t,peer.sign),Hold);
    assert.deepEqual(seen(),{release:"initial",values:null});
    const packet=activate(t);assert.equal(packet.body.result,"applied");
    db.close();db=openExisting(file);
    const recovered=activate(t);assert.deepEqual(recovered,packet);
    assert.throws(()=>activate(t),/paid recovery was used/);
    assert.deepEqual(seen().values,[target]);
    const answer=settle(t,recovered,"return");
    assert.equal(answer.status,"release_confirmed");
    assert.equal(budget-db.prepare("SELECT balance FROM account").get().balance,cost);
    if(budget===cost)return {cost,exact:true};
    const stored=act(peer,"cold-read","read",{job:"first"});assert.equal(stored.content,"{}");
    assert.equal(stored.observed.release,seen().release);
    const base=seen().release;
    queue("mismatch",JSON.stringify({note:"discard the annotation"}),base);
    const wrong=issue("mismatch","wrong",base);
    const rejected=settle(wrong,activate(wrong),"wrong-return");
    assert.equal(rejected.reason,"meaning_changed");assert.equal(rejected.difference.value,"discard the annotation");
    assert.deepEqual(seen(),{release:base,values:[target]});
    assert.equal(act(peer,"blocked-read","read",{job:"mismatch"}).status,"hold");
    queue("staged","{}",base);
    const staged=issue("staged","staged-ticket",base);
    stageReceivingReader(dest,{default:"discard the annotation"});
    assert.equal(settle(staged,activate(staged),"staged-return").reason,"reader_changed");
    assert.deepEqual(seen(),{release:base,values:[target]});
    const staleAdapter={...adapter,identify:()=>hash(["replacement"])};
    assert.throws(()=>readVisibleRelease(dest,staleAdapter,[inp]),Hold);
    const live=new DatabaseSync(dest,{readOnly:true});
    try {assert.equal(live.prepare("SELECT COUNT(*) AS n FROM effects").get().n,1);} finally {live.close();}
    return {cost,exact:false};
  } finally {db.close();}
}
try {
  for(const contract of [{...terms.receiverContract,repeat:"may_repeat"},{...terms.receiverContract,history:"current_content_only"}]) {
    const invalid={...terms,budget:1000,receiverContract:contract};
    assert.throws(()=>enroll(join(dir,"wrong.sqlite"),owner.key,owner.sign("enrollment",invalid)),Hold);
  }
  const {cost}=course("normal",3000);
  assert.deepEqual(course("exact",cost),{cost,exact:true});
  assert.deepEqual(course("one-less",cost-1),{held:true});
  console.log(JSON.stringify({firstUse:"checked",exactBudget:cost,oneLess:"withheld",lostReply:"recovered",duplicateEffects:0}));
} finally {rmSync(dir,{recursive:true,force:true});}
