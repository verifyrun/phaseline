// Reopen a real account and recover the authorized reading alongside new suggestions.
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {enroll,openExisting,signedBytes} from "./review-journal.mjs";
import {advanceReview} from "./funded-review.mjs";
import {briefDigest} from "./owner-question.mjs";

function identity() {
  const {publicKey,privateKey}=generateKeyPairSync("ed25519");
  const key=publicKey.export({format:"der",type:"spki"}).subarray(-32).toString("hex");
  return {key,sign:(kind,body)=>({key,body,signature:sign(null,signedBytes(kind,body),privateKey).toString("hex")})};
}
const [owner,author,peer,src,dst]=Array.from({length:5},identity);
const directory=mkdtempSync(join(tmpdir(),"phaseline-owner-")),path=join(directory,"account.sqlite");
const brief="Show the editor who reviewed a drawing.",input=["drawing"];
const terms={account:"shop",subject:"drawing",before:"one",edition:"two",destination:"local",
  operators:[author.key,peer.key],sourceKey:src.key,receiverKey:dst.key,budget:4000,size:1,tariff:"review-operations/1",
  receiverContract:{store:"store",history:"complete_job_log",repeat:"stable_job"},
  behaviorPort:{id:"reviewer",basis:"an approved exact JSON value returned by the recipient",inputs:[input],price:1,
    output:"exact-json/1",question:{brief:briefDigest(brief)}}};
const {binding}=enroll(path,owner.key,owner.sign("enrollment",terms));
let db=openExisting(path);
try {
  const act=(actor,id,op,data)=>advanceReview(db,actor.sign("request",{binding,id,op,data}));
  const suggestion={brief,base:"initial",question:"Who is shown before the first review?",input,
    options:[{reading:"Show an empty reviewer.",expected:null},{reading:"Show the editor.",expected:"editor"}]};
  const pick=(base,choice,proposal="q")=>({base,proposal,choice,answer:choice===null?"Neither.":"Show the empty reviewer."});
  assert.equal(act(author,"same","suggest_question",{...suggestion,options:[suggestion.options[0],{reading:"A different wording.",expected:null}]}).status,"hold");
  assert.equal(act(author,"absent","suggest_question",{...suggestion,options:[suggestion.options[0],{reading:"Show nobody."}]}).status,"hold");
  assert.equal(act(author,"q","suggest_question",suggestion).status,"question_proposed");
  assert.equal(act(peer,"try-adopt","answer_question",pick("initial",0)).status,"hold");
  assert.equal(act(owner,"decline","answer_question",pick("initial",null)).status,"question_open");
  assert.equal(act(owner,"adopt","answer_question",pick("decline",0)).status,"question_adopted");
  assert.equal(act(owner,"stale","answer_question",pick("decline",1)).status,"hold");
  db.close(); db=openExisting(path);
  for(let i=0;i<34;i++)
    assert.equal(act(author,"new-"+i,"suggest_question",{...suggestion,base:"adopt",question:"Proposed follow-up "+i+"?"}).status,"question_proposed");
  const first=act(peer,"return","question_status",{}),next=act(peer,"return-more","question_status",{after:first.nextCursor});
  assert.equal(first.active.question,suggestion.question);
  assert.equal(first.active.reading,suggestion.options[0].reading);
  assert.equal(first.active.expected,null);
  assert.equal(first.active.choice,0);
  assert.equal(first.proposed.question,"Proposed follow-up 33?");
  assert.equal(first.head,"adopt"); assert.equal(first.pending.length,32);
  assert.deepEqual(next.pending,["new-32","new-33"]); assert.equal(next.nextCursor,null);
  const asked=act(peer,"specific","question_status",{proposal:"new-8"});
  assert.equal(asked.proposed.question,"Proposed follow-up 8?");
  assert.equal(asked.active.question,suggestion.question);
  const words="Use both finishes in equal amounts, with no lacquer.";
  assert.equal(act(peer,"open-ask","suggest_question",{...suggestion,base:"adopt",options:[]}).status,"question_proposed");
  assert.equal(act(owner,"raw","answer_question",{base:"adopt",proposal:"open-ask",choice:null,answer:words}).status,"question_open");
  const approve={base:"raw",sourceDecision:"raw",proposal:"open-ask",choice:"owner",answer:"Use the recorded answer."};
  assert.equal(act(peer,"operator-projection","answer_question",approve).status,"hold");
  assert.equal(act(owner,"stale-source","answer_question",{...approve,sourceDecision:"decline"}).status,"hold");
  assert.equal(act(owner,"other-question","answer_question",{...approve,proposal:"q"}).status,"hold");
  assert.equal(act(owner,"option-zero","answer_question",{base:"raw",proposal:"open-ask",choice:0,answer:words}).status,"hold");
  assert.equal(act(owner,"approved-quote","answer_question",approve).status,"question_adopted");
  db.close();db=openExisting(path);
  const original=act(peer,"after-restart","question_status",{}).active;
  assert.equal(original.expected,words);
  assert.deepEqual(original.ownerSource,{decision:"raw",answer:words});
  const second={base:"approved-quote",proposal:"open-ask",choice:null,answer:"Show no finish when it is unreviewed."};
  assert.equal(act(owner,"new-words","answer_question",second).status,"question_open");
  const typed={...approve,base:"new-words",sourceDecision:"new-words",
    meaning:{reading:"Use JSON null for no finish.",expected:null}};
  assert.equal(act(owner,"malformed-meaning","answer_question",{...typed,meaning:{reading:"No finish."}}).status,"hold");
  assert.equal(act(owner,"typed","answer_question",typed).status,"question_adopted");
  const mapped=act(peer,"mapped","question_status",{}).active;
  assert.equal(mapped.choice,"owner");assert.equal(mapped.expected,null);
  assert.equal(mapped.ownerSource.answer,second.answer);
  const multi=join(directory,"multiple.sqlite"),multiTerms={...terms,behaviorPort:{...terms.behaviorPort,question:{brief:briefDigest(brief),topics:["display","privacy"]}}};
  const mb=enroll(multi,owner.key,owner.sign("enrollment",multiTerms)).binding;
  db.close();db=openExisting(multi);
  const run=(who,id,op,data)=>advanceReview(db,who.sign("request",{binding:mb,id,op,data}));
  for(const topic of ["display","privacy"])
    assert.equal(run(author,"suggest-"+topic,"suggest_question",{...suggestion,topic}).status,"question_proposed");
  const display=run(owner,"display-one","answer_question",pick("initial",0,"suggest-display"));
  assert.equal(display.releaseReady,false);
  const privacy=run(owner,"privacy-one","answer_question",pick("initial",1,"suggest-privacy"));
  assert.equal(privacy.releaseReady,false);assert.match(privacy.obstacle,/incompatible.*display.*privacy/);
  const revised=run(owner,"privacy-two","answer_question",pick("privacy-one",0,"suggest-privacy"));
  assert.equal(revised.releaseReady,true);
  db.close();db=openExisting(multi);
  const version=run(peer,"project","question_status",{});
  assert.deepEqual(version.requirements.map(m=>m.active.expected),[null,null]);
  assert.deepEqual(version.requirements.map(m=>m.active.decision),["display-one","privacy-two"]);
  assert.equal(run(peer,"past","question_status",{at:"privacy-one"}).releaseReady,false);
  assert.equal(run(peer,"different-topic","question_status",{topic:"privacy",proposal:"suggest-display"}).status,"hold");
  assert.equal(run(peer,"no-such-topic","question_status",{topic:"third"}).status,"hold");
  assert.equal(run(peer,"unscoped-page","question_status",{after:1}).status,"hold");
  const ownerWords={proposal:"suggest-display",base:"display-one",choice:null,answer:"Both the artist and the reviewer."};
  assert.equal(run(owner,"extra","answer_question",ownerWords).status,"question_open");
  assert.equal(run(owner,"different-source","answer_question",{...approve,base:"extra",sourceDecision:"extra",proposal:"suggest-privacy"}).status,"hold");
  const map=run(owner,"new-display","answer_question",{...approve,base:"extra",sourceDecision:"extra",proposal:"suggest-display",
    meaning:{reading:"Return both names.",expected:["artist","reviewer"]}});
  assert.equal(map.releaseReady,false);assert.match(map.obstacle,/incompatible/);
  const newer=run(peer,"read-new-display","question_status",{topic:"display"}).requirements[0].active;
  assert.deepEqual(newer.ownerSource,{decision:"extra",answer:ownerWords.answer});
  assert.deepEqual(newer.expected,["artist","reviewer"]);
  assert.equal(run(peer,"prior-null","question_status",{at:"privacy-two",topic:"display"}).requirements[0].active.expected,null);
} finally {db.close();rmSync(directory,{recursive:true,force:true});}
console.log("Passed signed owner choice, mixed pending/approved recovery, typed null, stale choice and pagination.");
