// Which observer actually read the field? Exercise acquisition, authorization, a cold
// project return and the existing guarded release to a separately opened receiver.
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {account,enroll,hash,openExisting,signedBy,signedBytes} from "./review-journal.mjs";
import {advanceReview} from "./funded-review.mjs";
import {acquireVersion} from "./version-source.mjs";
import {activateCheckedRelease,createReceivingStore,readVisibleRelease} from "./guarded-receiver.mjs";
import {briefDigest} from "./owner-question.mjs";

function identity() {
  const pair=generateKeyPairSync("ed25519");
  const key=pair.publicKey.export({format:"der",type:"spki"}).subarray(-32).toString("hex");
  return {key,sign:(kind,body)=>({key,body,signature:sign(null,signedBytes(kind,body),pair.privateKey).toString("hex")})};
}
const [owner,worker,peer,incumbent,recipient,agent,service]=Array.from({length:7},identity);
const folder=mkdtempSync(join(tmpdir(),"phaseline-source-"));
const brief="Restore the customer's approved note on the drawing.",input=["note"],wording="Preserve both finishes in equal proportions.";
const product="studio/drawings",field={product,record:"A",version:1,field:"words"};
const surface={identify:()=>hash("studio reader"),read:(bytes,config,inputs)=>inputs.map(()=>JSON.parse(bytes).note)};

async function course(label,topics,budget=15000) {
  const file=join(folder,label+".sqlite"),sink=join(folder,label+"-reader.sqlite");
  const ports=[agent,service].map((s,i)=>({id:i?"archive":"chat",key:s.key,product,fields:i?["words","approved"]:["words"],
    retention:"project-version/1",price:5,maxBytes:1024}));
  const terms={account:"trial",subject:"drawing",before:"v1",edition:"v2",destination:"viewer",
    operators:[worker.key,peer.key],sourceKey:incumbent.key,receiverKey:recipient.key,size:1,budget,tariff:"review-operations/1",
    receiverContract:{store:"studio",repeat:"stable_job",history:"complete_job_log"},behaviorPort:{id:"note",basis:"the owner's approved annotation",
      output:"exact-json/1",inputs:[input],price:1,question:{brief:briefDigest(brief),beforeUse:"checked/1",recordSources:ports,...(topics?{topics}: {})}}};
  const binding=enroll(file,owner.key,owner.sign("enrollment",terms)).binding;
  createReceivingStore(sink,binding,"studio",{});
  let db=openExisting(file),reads=0;
  const act=(who,id,op,data)=>advanceReview(db,who.sign("request",{binding,id,op,data}));
  const ask=(id,port="archive")=>act(worker,id,"request_source",{proposal:"q",port});
  const adopt=(id,pulse,digest,proposal="q",base="initial")=>act(owner,id,"answer_question",{base,proposal,choice:"record",
    answer:"Use the specified version.",sourcePulse:pulse,sourceDigest:digest});
  const proposal={base:"initial",brief,input,question:"What were the exact words?",options:[],record:field,...(topics?{topic:topics[0]}:{})};
  const call=(t,f=async (locator,retention)=>({field:locator,status:"observed",value:wording,retention}),s=service.sign)=>
    acquireVersion(file,t,async (loc,retention)=>{reads++;return f(loc,retention);},s);
  try {
    assert.equal(act(worker,"q","suggest_question",proposal).status,"question_proposed");
    const refused=adopt("unearned","nonexistent",hash("unseen"));
    assert.equal(refused.status,"hold");
    const opening=account(db).balance;
    const ticket=ask("acquire");
    if(ticket.status==="hold") {
      assert.match(ticket.reason,/balance/);assert.equal(reads,0);return {cost:budget-opening};
    }
    const spent=opening-account(db).balance;
    assert.equal((await call(ticket,undefined,agent.sign)).status,"hold");
    assert.equal(reads,0);
    const good=await call(ticket);
    assert.equal(good.status,"observed");assert.equal(reads,1);
    assert.equal((await call(ticket)).historical,true);assert.equal(reads,1);
    assert.equal((await call(ticket)).status,"hold");assert.equal(reads,1);
    assert.equal(act(peer,"unadopted","question_status",{}).head,"initial");
    const got=act(owner,"inspect","read_source",{proposal:"q",attempt:"acquire"});
    assert.equal(got.value,wording);assert.deepEqual(got.field,field);
    assert.equal(signedBy("version-reading",got.receipt,service.key),true);
    assert.equal(got.receipt.body.ticket,hash(got.ticket));assert.equal(got.receipt.body.value,got.value);
    const saved=db.prepare("SELECT value FROM version_reads WHERE pulse='acquire'").get();
    db.prepare("UPDATE version_reads SET value=? WHERE pulse='acquire'").run(JSON.stringify("incomplete restore"));
    assert.equal(act(peer,"damaged-cache","read_source",{proposal:"q",attempt:"acquire"}).status,"hold");
    db.prepare("UPDATE version_reads SET value=? WHERE pulse='acquire'").run(saved.value);
    assert.equal(ask("unknown-port","other").status,"hold");
    assert.equal(adopt("wrong-hash","acquire",hash("something else")).status,"hold");
    const short=ask("missing","chat");
    assert.equal((await call(short,async loc=>({field:loc,status:"missing"}),agent.sign)).status,"missing");
    assert.equal(adopt("missing-adopt","missing",hash("missing")).status,"hold");
    const wrong=ask("newer");
    assert.equal((await call(wrong,async loc=>({field:{...loc,version:2},status:"observed",value:wording}))).status,"unavailable");
    const long=ask("large");
    assert.equal((await call(long,async (loc,retention)=>({field:loc,status:"observed",value:"a".repeat(1100),retention}))).status,"unavailable");
    const restricted=ask("restricted");
    assert.equal((await call(restricted,async loc=>({field:loc,status:"observed",value:wording}))).status,"denied");
    const wrongAccount=ask("wrong-subscriber");
    assert.equal((await call(wrongAccount,async (loc,r)=>({field:loc,status:"observed",value:wording,
      retention:{...r,binding:hash("a different project account")}}))).status,"denied");
    const race=ask("inflight");
    let started,release;
    const waiting=new Promise(resolve=>{started=resolve;}),resume=new Promise(resolve=>{release=resolve;});
    const inflight=call(race,async (loc,retention)=>{
      started();await resume;return {field:loc,status:"observed",value:wording,retention};
    });
    await waiting;
    assert.equal((await call(race)).status,"attempt_pending");
    assert.equal(act(peer,"premature","read_source",{proposal:"q",attempt:"inflight"}).status,"hold");
    release();assert.equal((await inflight).status,"observed");
    assert.equal(act(peer,"after-settlement","read_source",{proposal:"q",attempt:"inflight"}).value,wording);
    const pending=ask("denied");
    assert.equal((await call(pending,async loc=>({field:loc,status:"denied"}))).status,"denied");
    assert.equal(act(worker,"q2","suggest_question",{...proposal,question:"A different record?",record:{...field,record:"B"}}).status,"question_proposed");
    assert.equal(adopt("different-question","acquire",good.digest,"q2").status,"hold");
    assert.equal(act(peer,"worker-decision","answer_question",{proposal:"q",base:"initial",choice:"record",answer:"Yes",sourcePulse:"acquire",sourceDigest:good.digest}).status,"hold");
    assert.equal(adopt("approved","acquire",good.digest).status,"question_adopted");
    db.close();db=openExisting(file);
    const returned=act(peer,"return","question_status",{}),active=topics?returned.requirements[0].active:returned.active;
    assert.equal(active.expected,wording);assert.equal(active.recordSource.sourceKey,service.key);assert.deepEqual(active.recordSource.field,field);
    for(const [n,verdict] of ["allow","refuse"].entries()) {
      const pulse="cell"+n,claim=!!n;
      assert.equal(act(worker,pulse,"ask",{position:0,claim}).status,"requested");
      const receipt=incumbent.sign("observation",{binding,pulse,position:0,claim,verdict,work:1});
      assert.equal(act(worker,"receipt"+n,"observe",{pulse,receipt}).status,"observed");
    }
    const c=act(worker,"candidate","form",{base:"v1"}),ref={base:"v1",candidate:"candidate",digest:c.digest};
    assert.equal(act(worker,"offer","offer",ref).status,"offered");
    assert.equal(act(owner,"certify","certify",ref).status,"preserved");
    assert.equal(act(owner,"replace","adopt",ref).status,"adopted");
    const enqueue={revision:c.digest,position:0,claim:false,decision:"approved",expectedRuntime:surface.identify(),
      receiver:{base:"initial",fence:"active"}};
    let stable;
    for(const [job,note] of [["mismatch","Preserve a finish."],["match",wording]]) {
      assert.equal(act(worker,job+"-q","queue",{...enqueue,job,content:JSON.stringify({note})}).status,"queued");
      assert.equal(act(recipient,job+"-r","receive",{job}).status,"received");
      const t=act(recipient,job+"-dispatch","dispatch",{job,base:"initial",fence:"active"});
      assert.equal(t.status,"guarded_ticket");
      if(job==="mismatch") {
        const receipt=activateCheckedRelease(sink,file,t,surface,recipient.sign);
        assert.equal(receipt.body.result,"meaning_changed");
        assert.equal(act(peer,job+"-reply","record_release",{job,attempt:t.pulse,receipt}).status,"release_withheld");
        assert.equal(readVisibleRelease(sink,surface,[input]).values,null);
      } else stable=t;
    }
    if(topics) {
      const conflict=ask("changed-source");
      const disagreement=await call(conflict,async (loc,retention)=>({field:loc,status:"observed",value:"Different words.",retention}));
      assert.equal(disagreement.disputed,true);
      assert.equal(act(peer,"dispute","read_source",{proposal:"q",attempt:"acquire"}).status,"hold");
      const receipt=activateCheckedRelease(sink,file,stable,surface,recipient.sign);
      assert.equal(receipt.body.result,"basis_changed");
      assert.equal(readVisibleRelease(sink,surface,[input]).values,null);
    } else {
      const later=ask("later");
      const interrupted=await call(later,async loc=>{
        assert.equal(act(owner,"retire-reader","revoke",{actor:service.key}).status,"revoked");
        return {field:loc,status:"observed",value:wording};
      });
      assert.equal(interrupted.status,"hold");
      assert.equal(ask("after-revocation").status,"hold");
      // The root explicitly enrolled retention in the project. A previously completed read survives.
      assert.equal(act(peer,"history","read_source",{proposal:"q",attempt:"acquire"}).value,wording);
      const receipt=activateCheckedRelease(sink,file,stable,surface,recipient.sign);
      assert.equal(receipt.body.result,"applied");
      assert.deepEqual(readVisibleRelease(sink,surface,[input]).values,[wording]);
    }
    return {spent,before:budget-opening};
  } finally {db.close();}
}
try {
  const ordinary=await course("individual");
  await course("joint",["drawing-wording"]);
  assert.equal((await course("underfunded",undefined,ordinary.before+ordinary.spent-1)).cost,ordinary.before);
  console.log("PASS: charged version reads, distinct observer grants, owner adoption, cold return and guarded first use");
} finally {rmSync(folder,{recursive:true,force:true});}
