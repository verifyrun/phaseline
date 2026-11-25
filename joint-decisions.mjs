// Versioned release membership. A change to one topic keeps every other approved decision.
import {debit,exact,Hold,id,need,serial} from "./review-journal.mjs";
import {sourceMeaning} from "./version-source.mjs";
import {sourceValue} from "./late-port.mjs";

const blocks=value=>Math.max(1,Math.ceil(Buffer.byteLength(serial(value))/256));

export function jointTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS topic_proposals(proposal TEXT PRIMARY KEY,topic TEXT NOT NULL,base TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS topic_pending ON topic_proposals(topic,base);
    CREATE TABLE IF NOT EXISTS joint_versions(id TEXT PRIMARY KEY,members TEXT NOT NULL,obstacle TEXT);`);
}
export function initialMembers(topics) {
  return topics.map(topic=>({topic,decision:null}));
}
export function version(db,topics,decision) {
  if(decision==="initial")return {members:initialMembers(topics),obstacle:"the declared requirements are undecided"};
  const row=db.prepare("SELECT members,obstacle FROM joint_versions WHERE id=?").get(decision);
  need(row,"the issued set of requirements is unavailable");
  return {...row,members:JSON.parse(row.members)};
}
export function topicOf(db,proposal) {
  const row=db.prepare("SELECT topic FROM topic_proposals WHERE proposal=?").get(proposal);
  need(row,"the proposal does not belong to this release contract");
  return row.topic;
}
export function ownerMeaning(db,rid,decision,proposal) {
  if(decision.choice===null)return null;
  if(decision.choice==="record")return sourceMeaning(db,rid,decision);
  if(decision.choice!=="owner")return proposal.options[decision.choice];
  const row=db.prepare(`SELECT m.reading,m.expected,m.source,s.answer FROM owner_meanings m
    JOIN owner_decisions s ON m.source=s.id AND s.choice IS NULL
    WHERE m.decision=? AND s.proposal=? AND s.id=?`).get(decision.id,decision.proposal,decision.prior);
  need(row,"the source reply for this owner-approved interpretation is unavailable");
  debit(db,rid,"read the source reply and its authorized projection",blocks(row));
  return {reading:row.reading,expected:JSON.parse(row.expected),ownerSource:{decision:row.source,answer:row.answer}};
}
export function reading(db,decision,rid) {
  if(decision===null)return null;
  const r=db.prepare(`SELECT d.id,d.prior,d.proposal,d.choice,d.answer,p.body FROM owner_decisions d
    JOIN brief_proposals p ON p.id=d.proposal WHERE d.id=?`).get(decision);
  need(r,"the issued product reading is unavailable");
  debit(db,rid,"read original proposed meanings",Math.max(1,Math.ceil(Buffer.byteLength(r.body)/256)));
  const p=JSON.parse(r.body),picked=ownerMeaning(db,rid,r,p);
  return {decision:r.id,prior:r.prior,proposal:r.proposal,question:p.question,input:p.input,choice:r.choice,
    answer:r.answer,reading:picked?.reading??null,expected:picked?.expected??null,...(picked?.ownerSource?{ownerSource:picked.ownerSource}:{}),...(picked?.recordSource?{recordSource:picked.recordSource}:{})};
}
// Buy the read and write work before either the decision or its joint version is installed.
export function prepareJoint(db,rid,previous,topic,choice,proposal,picked) {
  const members=previous.members.map(m=>m.topic===topic?{topic,decision:rid}:m);
  const outputs=new Map();
  let obstacle=null;
  for(const m of members) {
    const active=m.topic===topic?{choice,input:proposal.body.input,expected:picked?.expected??null}:reading(db,m.decision,rid);
    debit(db,rid,"check release requirement "+m.topic,blocks(active));
    if(!active || active.choice===null) {obstacle??="owner decision open for "+m.topic;continue;}
    const input=serial(active.input),answer=serial(active.expected),other=outputs.get(input);
    if(other && other.answer!==answer)
      obstacle="incompatible answers for "+other.topic+" and "+m.topic+" on "+input;
    else outputs.set(input,{topic:m.topic,answer});
  }
  debit(db,rid,"store the complete release membership",blocks(members)+1);
  return {members:serial(members),obstacle};
}
export function validateJointEvidence(topics,d) {
  need(topics && id(d.snapshot) && Array.isArray(d.evidence) && d.evidence.length<=topics.length &&
    d.evidence.every(v=>exact(v,["topic","pulse"]) && topics.includes(v.topic) && id(v.pulse)) &&
    new Set(d.evidence.map(v=>v.topic)).size===d.evidence.length,"supply a destination snapshot and at most one paid receipt per named requirement");
}
export function observeJoint(db,a,request,issued,current) {
  const {id:rid,data:d}=request.body,topics=a.terms.behaviorPort.question.topics;
  const book=version(db,topics,issued);
  need(!book.obstacle,"the issued release has an unresolved decision");
  const evidence=new Map(d.evidence.map(v=>[v.topic,v.pulse])),results=[];
  for(const {topic,decision} of book.members) {
    const active=reading(db,decision,rid);
    debit(db,rid,"read issued release requirement "+topic,blocks(active));
    const pulse=evidence.get(topic);
    const row={topic,decision,input:active.input,expected:active.expected,...(active.ownerSource?{ownerSource:active.ownerSource}:{}),...(active.recordSource?{recordSource:active.recordSource}:{})};
    if(!pulse) {results.push({...row,status:"unknown",reason:"no receipt supplied"});continue;}
    try {
      const sample=sourceValue(db,a,rid,d.job,pulse,active.input,true);
      need(sample.row.snapshot===d.snapshot,"receipt belongs to a different destination snapshot");
      results.push({...row,status:serial(active.expected)===serial(sample.value)?"agrees":"differs",pulse,observed:sample.value});
    } catch(e) {
      if(!(e instanceof Hold))throw e;
      results.push({...row,status:"unknown",pulse,reason:e.message});
    }
  }
  const status=results.some(r=>r.status==="differs")?"intent_mismatch":results.every(r=>r.status==="agrees")?"intent_observed":"hold";
  return {status,job:d.job,snapshot:d.snapshot,edition:issued,head:current,currentlyAdopted:current===issued,requirements:results,
    ...(status==="hold"?{reason:"one or more required outcomes are unknown"}:{}),
    scope:"the issued named requirements on the supplied inputs at this destination snapshot"};
}
