// One scoped product commitment. A suggestion, an owner's decision and an
// observed customer outcome are different events in the same funded account.
import {debit,exact,grant,hash,id,need,serial} from "./review-journal.mjs";
import {exactValue} from "./exact-json.mjs";
import {validateProbe} from "./behavior-port.mjs";
import {jointTables,observeJoint,ownerMeaning,prepareJoint,reading,topicOf,validateJointEvidence,version} from "./joint-decisions.mjs";
import {adoptSource,approveSelectorUse,locator,requireSourceBasis} from "./version-source.mjs";
import {validLookup} from "./record-catalog.mjs";
import {sourceValue} from "./late-port.mjs";

const blocks=s=>Math.max(1,Math.ceil(Buffer.byteLength(s)/256));
const text=(value,max)=>typeof value==="string" && value.trim().length>0 && Buffer.byteLength(value)<=max;
export const briefDigest=brief=>hash(["product-brief/1",brief]);

function tables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS brief_proposals(id TEXT PRIMARY KEY, actor TEXT NOT NULL, base TEXT NOT NULL, body TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS questions_by_base ON brief_proposals(base);
    CREATE TABLE IF NOT EXISTS owner_decisions(seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, prior TEXT NOT NULL,
      proposal TEXT NOT NULL REFERENCES brief_proposals(id), choice INTEGER, answer TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS owner_meanings(decision TEXT PRIMARY KEY REFERENCES owner_decisions(id),
      source TEXT NOT NULL REFERENCES owner_decisions(id), reading TEXT NOT NULL, expected TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS job_decisions(job TEXT PRIMARY KEY REFERENCES jobs(id), decision TEXT NOT NULL REFERENCES owner_decisions(id));`);
}
function head(db) {
  return db.prepare("SELECT * FROM owner_decisions ORDER BY seq DESC LIMIT 1").get();
}
function lookup(db,proposal) {
  const row=db.prepare("SELECT id,actor,base,body FROM brief_proposals WHERE id=?").get(proposal);
  need(row,"the proposed question has no project record");
  return {...row,body:JSON.parse(row.body)};
}
export function validateQuestion(port,op,d) {
  need(port?.question,"this project has not enrolled an owner decision for delivery");
  const topics=port.question.topics;
  if(op==="check_joint"){validateJointEvidence(topics,d);return;}
  if(op==="check_decision")need(!topics,"this release requires checking all enrolled topics with check_joint");
  if(d.topic!==undefined)need(topics?.includes(d.topic),"unknown product requirement");
  if(topics && d.after!==undefined)need(d.topic!==undefined,"name the topic whose pending proposals should be paged");
  if(d.at!==undefined)need(topics && id(d.at) && d.proposal===undefined && d.after===undefined,"invalid historical release request");
  if(op==="suggest_question") {
    need(!topics || topics.includes(d.topic),"name an enrolled release requirement");
    need(id(d.base) && text(d.brief,32768) && briefDigest(d.brief)===port.question.brief &&
      text(d.question,2048) && Array.isArray(d.options) && [0,2].includes(d.options.length),"supply the enrolled brief, an open question or two distinct interpretations");
    validateProbe(port,[d.input]);
    if(d.lookup!==undefined)need(validLookup(d.lookup) && d.record===undefined && !d.options.length &&
      port.question.recordSources?.some(p=>p.catalog && p.product===d.lookup.product) &&
      port.question.recordSources.some(p=>p.product===d.lookup.product && p.fields.includes(d.lookup.field)),
      "declare a bounded catalog selector and the field needed for this question");
    if(d.record!==undefined)need(locator(d.record) && port.question.recordSources?.some(p=>p.product===d.record.product && p.fields.includes(d.record.field)) &&
      !d.options.length,"an acquired field requires an enrolled source and an open interpretation");
    if(!d.options.length)return;
    const typed=port.output==="exact-json/1";
    need(d.options.every(x=>exact(x,["reading","expected"]) && text(x.reading,2048) &&
      (typed?exactValue(x.expected):typeof x.expected==="boolean")) && Buffer.byteLength(serial(d.options))<=16384 &&
      d.options[0].reading.trim()!==d.options[1].reading.trim() && serial(d.options[0].expected)!==serial(d.options[1].expected),
      "the two interpretations must predict different typed answers on the same input");
  } else if(op==="answer_question") {
    need(id(d.proposal) && id(d.base) && [null,0,1,"owner","record"].includes(d.choice) && text(d.answer,8192),
      "record the owner's answer and chosen reading, or leave the question open");
    if(d.choice==="record") {
      need(port.question.recordSources && id(d.sourcePulse) && /^[0-9a-f]{64}$/.test(d.sourceDigest) &&
        d.meaning===undefined && d.sourceDecision===undefined,"sign the specific retrieved record value");
      if(d.chosen!==undefined)need(exact(d.chosen,["record","version","catalogDigest"]) && id(d.chosen.record) &&
        Number.isSafeInteger(d.chosen.version) && d.chosen.version>=1 && /^[0-9a-f]{64}$/.test(d.chosen.catalogDigest),
        "sign the named catalog and one offered record version");
      return;
    }
    need(d.chosen===undefined && d.sourcePulse===undefined && d.sourceDigest===undefined,"source receipts require a record adoption");
    if(d.choice==="owner") {
      need(id(d.sourceDecision) && d.sourceDecision===d.base,"reference the current unanswered owner reply for this question");
      if(d.meaning===undefined)need(port.output==="exact-json/1","the verbatim owner reply requires a text-capable destination");
      else need(exact(d.meaning,["reading","expected"]) && text(d.meaning.reading,2048) &&
        (port.output==="exact-json/1"?exactValue(d.meaning.expected):typeof d.meaning.expected==="boolean") &&
        Buffer.byteLength(serial(d.meaning))<=16384,"supply the owner's explicit description and typed result on the proposed input");
    } else need(d.meaning===undefined && d.sourceDecision===undefined,"a source projection requires an explicit owner choice");
  } else if(op==="question_status") {
    if(d.proposal!==undefined)need(id(d.proposal),"invalid proposal identifier");
    if(d.after!==undefined)need(Number.isSafeInteger(d.after)&&d.after>=0,"invalid pending-question cursor");
  }
}
export function currentDecision(db,a,decision,acceptsLive=true) {
  if(!a.terms.behaviorPort?.question) {
    need(decision===undefined,"this account has not enrolled an owner decision");
    return;
  }
  tables(db);
  const current=head(db);
  if(a.terms.behaviorPort.question.topics) {
    need(current && current.id===decision,"the issued set of product decisions is missing or superseded");
    const row=db.prepare("SELECT members,obstacle FROM joint_versions WHERE id=?").get(decision);
    need(row && !row.obstacle,row?.obstacle??"the issued release membership is missing");
    if(a.terms.behaviorPort.question.recordSources)requireSourceBasis(db,JSON.parse(row.members).map(m=>m.decision),"main",acceptsLive);
    return;
  }
  need(current && current.choice!==null && current.id===decision,"the current product owner decision is missing, open or superseded");
  if(a.terms.behaviorPort.question.recordSources)requireSourceBasis(db,[decision],"main",acceptsLive);
}
export function bindDecision(db,a,job,decision) {
  if(a.terms.behaviorPort?.question)
    db.prepare("INSERT INTO job_decisions(job,decision) VALUES(?,?)").run(job,decision);
}
export function issuedDecision(db,a,job) {
  if(!a.terms.behaviorPort?.question)return undefined;
  tables(db);
  const row=db.prepare("SELECT decision FROM job_decisions WHERE job=?").get(job);
  need(row,"this delivery has no issued product owner decision");
  return row.decision;
}
export function questionStep(db,a,request) {
  const {op,data:d,id:rid}=request.body,port=a.terms.behaviorPort;
  need(port?.question,"this project has not enrolled an owner decision for delivery");
  tables(db);
  const current=head(db),globalHead=current?.id??"initial",topics=port.question.topics;
  if(topics)jointTables(db);
  const topic=op==="answer_question" && topics?topicOf(db,d.proposal):d.topic;
  const edition=d.at??globalHead;
  const book=topics?version(db,topics,edition):null;
  const selected=book?.members.find(m=>m.topic===topic);
  const base=selected?(selected.decision??"initial"):globalHead;
  if(op==="suggest_question") {
    need(d.base===base,"the proposal's base is already superseded");
    const body=serial({brief:d.brief,question:d.question,input:d.input,options:d.options,...(d.record?{record:d.record}:{}),...(d.lookup?{lookup:d.lookup}:{})});
    db.prepare("INSERT INTO brief_proposals VALUES(?,?,?,?)").run(rid,request.key,base,body);
    if(topics)db.prepare("INSERT INTO topic_proposals VALUES(?,?,?)").run(rid,topic,base);
    return {status:"question_proposed",proposal:rid,base,brief:port.question.brief,scope:d.options.length?"two proposed consequences on one supplied input":"open owner question on one supplied input"};
  }
  if(op==="answer_question") {
    need(rid!=="initial","the original base is reserved");
    const proposal=lookup(db,d.proposal);
    debit(db,rid,"inspect proposed interpretations",blocks(serial(proposal.body)));
    const latest=selected?reading(db,selected.decision,rid):current;
    need(base===d.base && (proposal.base===base || latest?.proposal===d.proposal),
      "the owner decision or the proposed question's base has changed");
    need(grant(db,proposal.actor)==="operator","the question's proposer is no longer enrolled");
    if(proposal.body.record || proposal.body.lookup)need(d.choice===null || d.choice==="record","the declared source field must be acquired before adoption");
    let picked=null;
    if(d.choice==="record") {
      need(proposal.body.record || proposal.body.lookup,"this question does not name a versioned source field");
      picked=adoptSource(db,rid,d.proposal,d.sourcePulse,d.sourceDigest);
      approveSelectorUse(db,rid,picked,request);
      need(port.output==="exact-json/1" || typeof picked.expected==="boolean","the observed source type does not match the receiving contract");
    } else if(d.choice==="owner") {
      need(latest && latest.choice===null && latest.proposal===d.proposal && base===d.sourceDecision,
        "acquire the current owner's answer on this question before approving its meaning");
      picked=d.meaning??{reading:"Use the owner's words exactly.",expected:latest.answer};
      debit(db,rid,"recover original answer and retain its approved meaning",blocks(latest.answer)+blocks(serial(picked)));
    } else if(d.choice!==null) {
      picked=proposal.body.options[d.choice];
      need(picked,"the owner must supply the meaning for an open question");
    }
    const joined=topics?prepareJoint(db,rid,book,topic,d.choice,proposal,picked):null;
    db.prepare("INSERT INTO owner_decisions(id,prior,proposal,choice,answer) VALUES(?,?,?,?,?)")
      .run(rid,base,d.proposal,d.choice,d.answer);
    if(d.choice==="owner")db.prepare("INSERT INTO owner_meanings(decision,source,reading,expected) VALUES(?,?,?,?)")
      .run(rid,d.sourceDecision,picked.reading,serial(picked.expected));
    if(d.choice==="record")db.prepare("INSERT INTO version_adoptions VALUES(?,?)").run(rid,d.sourcePulse);
    if(picked?.recordSource?.origin)db.prepare("INSERT INTO selector_endorsements VALUES(?,?)").run(rid,serial(request));
    if(joined)db.prepare("INSERT INTO joint_versions VALUES(?,?,?)").run(rid,joined.members,joined.obstacle);
    return {status:d.choice===null?"question_open":"question_adopted",decision:rid,prior:base,proposal:d.proposal,
      ...(joined?{topic,edition:rid,releaseReady:joined.obstacle===null,obstacle:joined.obstacle}:{}),
      owner:request.key,scope:"owner decision for the selected product question"};
  }
  if(op==="question_status") {
    if(topics) {
      const members=(topic?[selected]:book.members).map(m=>({topic:m.topic,active:reading(db,m.decision,rid)}));
      const out={status:"question_state",brief:port.question.brief,owner:a.root,edition,head:globalHead,currentlyAdopted:edition===globalHead,
        releaseReady:!book.obstacle,obstacle:book.obstacle,requirements:members};
      if(topic && d.at===undefined) {
        const page=db.prepare("SELECT rowid AS cursor,proposal FROM topic_proposals WHERE topic=? AND base=? AND rowid>? ORDER BY rowid LIMIT 33").all(topic,base,d.after??0);
        out.pending=page.slice(0,32).map(x=>x.proposal);out.nextCursor=page.length>32?page[31].cursor:null;
      }
      if(d.proposal!==undefined) {
        const belonging=topicOf(db,d.proposal);need(!topic || belonging===topic,"proposal belongs to another requirement");
        const q=lookup(db,d.proposal);out.proposed={id:q.id,topic:belonging,base:q.base,author:q.actor,...q.body};
      }
      debit(db,rid,"recover the versioned product decisions",blocks(serial(out)));
      return out;
    }
    const pending=db.prepare("SELECT id FROM brief_proposals WHERE base=? ORDER BY rowid DESC LIMIT 1").get(base);
    const page=db.prepare("SELECT rowid AS cursor,id FROM brief_proposals WHERE base=? AND rowid>? ORDER BY rowid LIMIT 33").all(base,d.after??0);
    const proposal=d.proposal??pending?.id??current?.proposal;
    const q=proposal?lookup(db,proposal):null;
    const active=current?lookup(db,current.proposal):null;
    const picked=current?ownerMeaning(db,rid,current,active.body):null;
    const result={status:"question_state",brief:port.question.brief,head:base,owner:a.root,pending:page.slice(0,32).map(x=>x.id),nextCursor:page.length>32?page[31].cursor:null,
      proposed:q&&{id:q.id,author:q.actor,base:q.base,...q.body},active:current?{decision:current.id,prior:current.prior,
        proposal:current.proposal,question:active.body.question,answer:current.answer,choice:current.choice,
        reading:picked?.reading??null,input:active.body.input,
        expected:picked?.expected??null,...(picked?.ownerSource?{ownerSource:picked.ownerSource}:{}),...(picked?.recordSource?{recordSource:picked.recordSource}:{})}:null};
    debit(db,rid,"recover the project question and owner decision",blocks(serial(result)));
    return result;
  }
  const decision=issuedDecision(db,a,d.job);
  if(op==="check_joint")return observeJoint(db,a,request,decision,globalHead);
  const at=db.prepare("SELECT * FROM owner_decisions WHERE id=?").get(decision),q=lookup(db,at.proposal);
  need(at.choice!==null,"the issued decision is unresolved");
  debit(db,rid,"read the issued product question",blocks(serial(q.body))+blocks(at.answer));
  const picked=ownerMeaning(db,rid,at,q.body),expected=picked.expected;
  const sample=sourceValue(db,a,rid,d.job,d.pulse,q.body.input,true);
  const matches=serial(sample.value)===serial(expected);
  return {status:matches?"intent_observed":"intent_mismatch",decision,proposal:q.id,brief:port.question.brief,
    head:base,currentlyAdopted:base===decision,owner:a.root,ownerAnswer:at.answer,...(picked.ownerSource?{ownerSource:picked.ownerSource}:{}),...(picked.recordSource?{recordSource:picked.recordSource}:{}),job:d.job,pulse:d.pulse,
    snapshot:sample.row.snapshot,implementation:sample.row.runtime,input:q.body.input,expected,observed:sample.value,
    scope:"observed outcome on the issued concrete input and immutable receiver snapshot"};
}
