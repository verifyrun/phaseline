// Finite completion oracle for partially visible catalogs, plus their normal funded account entry points.
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {enroll,hash,openExisting,signedBytes,account} from "./review-journal.mjs";
import {acquireCatalog,acquireVersion} from "./version-source.mjs";
import {locateRecord} from "./record-catalog.mjs";
import {advanceReview} from "./funded-review.mjs";
import {briefDigest} from "./owner-question.mjs";

const query={product:"factory",title:"Café opening",type:"Procedure",field:"words",time:"at_lookup"};
const limits={population:"project-shared/1",disclosure:"shared-metadata/1",maxRows:8,rowPrice:2,maxLookups:2,lookupPrice:4};
const r={binding:"account",policy:"project-version/1"};
const row=(record,shared)=>({record,version:2,type:"Procedure",title:"Cafe\u0301    opening",...(shared===undefined?{}:{shared})});
const list=(rows,more,snapshot)=>({list:async()=>({rows,more,product:query.product,retention:r,...(snapshot?{snapshot}:{})})});

// Ground truth ranges over all compatible source histories. Unknown audience and each
// unobserved catalog slot may independently add one match. A singleton or absence
// needs unanimity, while two proved matches settle non-uniqueness even in a partial view.
let count=0;
for(let n=0;n<=4;n++)for(let encoded=0;encoded<3**n;encoded++)for(const more of [0,1]) {
  const rows=Array.from({length:n},(_,i)=>row("item-"+i,[true,false,undefined][Math.floor(encoded/(3**i))%3]));
  const known=rows.filter(x=>x.shared===true).map(x=>x.record);
  const unknown=rows.filter(x=>x.shared===undefined).map(x=>x.record);
  if(more)unknown.push("unseen");
  const possibilities=new Set();
  for(let mask=0;mask<2**unknown.length;mask++){
    const matches=[...known,...unknown.filter((_,i)=>mask&(1<<i))];
    possibilities.add(matches.length>=2?"choice":matches.length===1?"one:"+matches[0]:"absent");
  }
  const exact=possibilities.size===1?[...possibilities][0]:"incomplete";
  const result=await locateRecord(query,r,limits,list(rows,more));
  const got=result.outcome==="located"?"one:"+result.matches[0].record:result.outcome;
  assert.equal(got,exact);count++;
}
let privateReads=0;
for(const hidden of [[],[row("private",false)]]) {
  const privateSource={list:async()=>{privateReads++;return {rows:hidden,more:0,product:query.product,retention:r};}};
  await assert.rejects(()=>locateRecord(query,r,{...limits,disclosure:"individual-only/1"},privateSource),/individual source/);
}
assert.equal(privateReads,0);
const uncertain=list([row("A")],0);
let calls=0;
uncertain.visibility=async()=>{calls++;return {product:"factory",record:"A",version:2,shared:true};};
assert.equal((await locateRecord(query,r,limits,uncertain)).outcome,"incomplete");
assert.equal(calls,0);
const stamped=list([row("A")],0,"policy-snapshot-2");
stamped.visibility=async request=>({...request,shared:true,snapshot:"policy-snapshot-3"});
assert.equal((await locateRecord(query,r,limits,stamped)).outcome,"incomplete");
stamped.visibility=async request=>({...request,shared:true});
assert.equal((await locateRecord(query,r,limits,stamped)).outcome,"located");
assert.equal((await locateRecord(query,r,{...limits,maxLookups:0},stamped)).outcome,"incomplete");
assert.equal((await locateRecord(query,r,{...limits,maxRows:1},list([row("A",true),row("B",true)],0))).outcome,"incomplete");
await assert.rejects(()=>locateRecord(query,r,limits,list([row("A",true),row("A",true)],0)),/inconsistent/);

// A rank is an invitation to examine sources. Empty, singleton and plural rankings
// never establish absence, uniqueness or an approved answer.
const natural={product:"factory",search:"Which gauge do we use?",field:"words",time:"at_lookup"};
const searchLimits={...limits,search:{provider:"stock",limit:3,price:21}};
function searchReply(items,overrides={}) {
  return {search:async(_query,retention)=>({product:"factory",provider:"stock",retention,matches:items,...overrides})};
}
for (const ids of [[],["A"],["A","B"],["A","B","C"]]) {
  const rows=ids.map(record=>({record,version:1,shared:true}));
  const result=await locateRecord(natural,r,searchLimits,searchReply(rows));
  assert.equal(result.outcome,"suggestions");
  assert.deepEqual(result.matches.map(m=>m.record),ids);
}
const hit={record:"A",version:1,shared:true};
for(const adapter of [searchReply([hit,hit]),searchReply([{...hit,shared:false}]),
    searchReply([hit],{provider:"other"}),searchReply([hit],{retention:{...r,binding:"other"}})]) {
  await assert.rejects(()=>locateRecord(natural,r,searchLimits,adapter));
}
await assert.rejects(()=>locateRecord(natural,r,limits,searchReply([hit])),/no enrolled search/);
let attempts=0;
await assert.rejects(()=>locateRecord(natural,r,{...searchLimits,disclosure:"individual-only/1"},
  {search:()=>{attempts++;}}),/individual source/);
assert.equal(attempts,0);

function identity(){
  const {privateKey,publicKey}=generateKeyPairSync("ed25519");
  const key=publicKey.export({format:"der",type:"spki"}).subarray(-32).toString("hex");
  return {key,sign:(kind,body)=>({key,body,signature:sign(null,signedBytes(kind,body),privateKey).toString("hex")})};
}
const [owner,agent,peer,src,dst,index]=Array.from({length:6},identity),brief="What is the recorded opening procedure?";
const folder=mkdtempSync(join(tmpdir(),"phaseline-catalog-"));
function trial(name,budget,when,ambiguous=false,ranked=false) {
  const file=join(folder,name+".sqlite"),lookup={...(ranked?natural:query),time:when};
  const terms={account:"mill",subject:"opening",before:"a",edition:"b",destination:"local",sourceKey:src.key,receiverKey:dst.key,
    operators:[agent.key,peer.key],size:1,budget,tariff:"review-operations/1",receiverContract:{store:"board",repeat:"stable_job",history:"complete_job_log"},
    behaviorPort:{id:"display",basis:"the actual adopted opening instructions",inputs:[["sign"]],price:2,output:"exact-json/1",
      question:{brief:briefDigest(brief),beforeUse:"checked/1",recordSources:[{id:"catalog",product:"factory",key:index.key,fields:["words"],
        price:4,maxBytes:2048,retention:"project-version/1",catalog:ranked?searchLimits:limits}]}}};
  const {binding}=enroll(file,owner.key,owner.sign("enrollment",terms));let db=openExisting(file);
  const act=(who,id,op,data)=>advanceReview(db,who.sign("request",{binding,id,op,data}));
  const demand={brief,base:"initial",question:brief,input:["sign"],options:[],lookup};
  const approved={proposal:"q",port:"catalog",queryDigest:hash(["record-query/1",lookup])};
  const reader={list:async (_q,retention)=>({product:"factory",retention,rows:ambiguous?[row("A",true),row("B",true)]:[row("A",true)],more:0})};
  if(ranked)reader.search=async (_q,retention)=>({provider:"stock",product:"factory",retention,matches:[{record:"B",version:2,shared:true}]});
  return (async()=>{
    try {
      assert.equal(act(agent,"q","suggest_question",demand).status,"question_proposed");
      assert.equal(act(agent,"unfunded-authority","request_catalog",approved).status,"hold");
      assert.equal(act(owner,"wrong-selector","request_catalog",{...approved,queryDigest:hash(["record-query/1",{...lookup,type:"Audit"}])}).status,"hold");
      const ticket=act(owner,"ticket","request_catalog",approved);
      const spent=budget-account(db).balance;
      if(ticket.status==="hold"){assert.match(ticket.reason,/balance/);return spent;}
      assert.equal(ticket.status,"catalog_ticket");
      if(budget<1000) {assert.equal((await acquireCatalog(file,ticket,reader,index.sign)).status,"observed");return spent;}
      assert.equal((await acquireVersion(file,ticket,async()=>{throw Error("wrong connector");},index.sign)).status,"hold");
      assert.equal((await acquireCatalog(file,ticket,reader,index.sign)).status,"observed");
      assert.equal(act(agent,"no-pick","request_source",{port:"catalog",proposal:"q"}).status,"hold");
      assert.equal(act(agent,"wrong-read","read_source",{proposal:"q",attempt:"ticket"}).status,"hold");
      const found=act(peer,"found","read_catalog",{proposal:"q",attempt:"ticket"});
      assert.equal(found.value.matches[0].record,ranked?"B":"A");
      if(ranked)assert.equal(found.value.outcome,"suggestions");
      const sourceRequest={proposal:"q",port:"catalog",selection:"ticket"};
      if(ambiguous) {
        assert.equal(act(peer,"implicit","request_source",sourceRequest).status,"hold");
        assert.equal(act(peer,"unoffered","request_source",{...sourceRequest,offeredRecord:{record:"C",version:2}}).status,"hold");
        sourceRequest.offeredRecord=found.value.matches[ranked?0:1];
      }
      const t=act(peer,"value-ticket","request_source",sourceRequest);
      if(when==="at_use"){assert.equal(t.status,"hold");assert.match(t.reason,/live head/);return spent;}
      assert.equal(t.field.version,2);
      const value=await acquireVersion(file,t,async (field,retention)=>({field,retention,status:"observed",value:"At seven."}),index.sign);
      assert.equal(value.status,"observed");
      const decision={proposal:"q",base:"initial",choice:"record",answer:"Post the original.",sourcePulse:"value-ticket",sourceDigest:value.digest};
      if(ambiguous) {
        assert.equal(act(owner,"no-choice","answer_question",decision).status,"hold");
        assert.equal(act(owner,"other-choice","answer_question",{...decision,chosen:{record:"A",version:2,catalogDigest:found.digest}}).status,"hold");
        decision.chosen={...sourceRequest.offeredRecord,catalogDigest:found.digest};
        assert.equal(act(peer,"agent-choice","answer_question",decision).status,"hold");
      }
      assert.equal(act(owner,"use","answer_question",decision).status,"question_adopted");
      db.close();db=openExisting(file);
      const saved=act(peer,"return","question_status",{}).active;
      assert.equal(saved.expected,"At seven.");assert.equal(saved.recordSource.origin.catalogDigest,found.digest);
      if(ambiguous) {
        assert.equal(saved.recordSource.field.record,"B");
        db.prepare("DELETE FROM selector_endorsements WHERE decision=?").run("use");
        db.close();db=openExisting(file);
        assert.equal(act(peer,"missing-original","question_status",{}).status,"hold");
      }
      return spent;
    } finally {db.close();}
  })();
}
try {
  const cost=await trial("issued",3000,"at_lookup");
  await trial("current",3000,"at_use");
  await trial("choice",3000,"at_lookup",true);
  await trial("single-ranked",3000,"at_lookup",true,true);
  assert.equal(await trial("exact",cost,"at_lookup"),cost);
  assert.ok(await trial("short",cost-1,"at_lookup")<cost);
  console.log(JSON.stringify({partialCatalogCompletions:count,firstFundedLookupCost:cost,unboundVisibility:"incomplete",currentHead:"hold"}));
} finally {rmSync(folder,{recursive:true,force:true});}
