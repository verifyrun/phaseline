// Generate throwaway keys and verify the same on-disk journal consumed by the CLI.
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {account,enroll,hash,Hold,openExisting,signedBytes} from "./review-journal.mjs";
import {advanceReview,finishReview,reserveReview} from "./funded-review.mjs";
import {constructReview} from "./review-program.mjs";

function identity() {
  const {privateKey,publicKey}=generateKeyPairSync("ed25519");
  return {hex:publicKey.export({format:"der",type:"spki"}).subarray(-32).toString("hex"),
    issue(type,body) { return {body,key:this.hex,signature:sign(null,signedBytes(type,body),privateKey).toString("hex")}; }};
}
const root=identity(),alice=identity(),bea=identity(),source=identity(),receiver=identity();
const terms={account:"studio",subject:"private-gallery",before:"v1",edition:"v2",destination:"internal-receiver",
  operators:[alice.hex,bea.hex],sourceKey:source.hex,receiverKey:receiver.hex,budget:2000,size:1,tariff:"review-operations/1"};
const directory=mkdtempSync(join(tmpdir(),"phaseline-review-")), file=join(directory,"review.sqlite");
let db;
try {
  const enrollment=root.issue("enrollment",terms);
  assert.throws(()=>enroll(file,bea.hex,enrollment),Hold);
  const {binding}=enroll(file,root.hex,enrollment);
  assert.equal(enroll(file,root.hex,enrollment).status,"already_enrolled");
  assert.throws(()=>enroll(file,root.hex,root.issue("enrollment",{...terms,budget:2001})),Hold);
  db=openExisting(file);
  const msg=(who,id,op,data)=>who.issue("request",{binding,id,op,data});
  const step=(who,id,op,data)=>advanceReview(db,msg(who,id,op,data));
  const note=(pulse,claim,verdict,work)=>source.issue("observation",{binding,pulse,position:0,claim,verdict,work});
  assert.equal(step(alice,"early","form",{base:"v1"}).status,"hold");
  const initial=account(db).balance;
  const forbidden=msg(alice,"bogus","ask",{position:0,claim:true});
  forbidden.body.id="altered";
  assert.equal(advanceReview(db,forbidden).status,"hold");assert.equal(account(db).balance,initial);
  const table=[{verdict:"refuse",work:2},{verdict:"allow",work:3}];
  for (const [i,o] of table.entries()) {
    const claim=Boolean(i),pulse="query-"+i;
    assert.equal(step(alice,pulse,"ask",{position:0,claim}).status,"requested");
    assert.equal(step(alice,"spare-"+i,"ask",{position:0,claim}).status,"requested");
    const r=note(pulse,claim,o.verdict,o.work);
    assert.equal(step(alice,"read-"+i,"observe",{pulse,receipt:r}).status,"observed");
  }
  const bad=step(alice,"wrong-work","form",{base:"v1",source:constructReview(1,[table[0],{...table[1],work:2}])});
  const wrong={candidate:bad.candidate,digest:bad.digest,base:"v1"};
  assert.equal(step(bea,"wrong-author","offer",wrong).status,"hold");
  assert.equal(step(alice,"emit-bad","offer",wrong).status,"offered");
  const failed=step(root,"check-bad","certify",wrong);
  assert.equal(failed.witness.expected.verdict,failed.witness.proposed.verdict);
  assert.notEqual(failed.witness.expected.work,failed.witness.proposed.work);
  assert.equal(step(root,"install-bad","adopt",wrong).status,"hold");
  const candidate=step(alice,"good","form",{base:"v1"});
  const detail={candidate:candidate.candidate,digest:candidate.digest,base:"v1"};
  const sent=msg(alice,"emit","offer",detail);
  const first=reserveReview(db,sent);
  db.close(); db=openExisting(file);
  assert.match(reserveReview(db,sent).done.reason,/pending/);
  const second=reserveReview(db,sent,true);
  assert.ok(second.ticket.epoch>first.ticket.epoch);
  assert.equal(finishReview(db,sent,first.ticket).status,"hold");
  assert.equal(finishReview(db,sent,second.ticket).status,"offered");
  assert.equal(step(root,"allow-too-early","adopt",detail).status,"hold");
  assert.equal(step(root,"check","certify",detail).status,"preserved");
  assert.equal(step(root,"install","adopt",detail).status,"adopted");
  const payload={job:"photo",revision:detail.digest,position:0,claim:true,content:"sunrise"};
  const queued=msg(alice,"send","queue",payload);
  assert.equal(advanceReview(db,queued).status,"queued");
  assert.equal(advanceReview(db,queued).replayed,true);
  assert.equal(step(alice,"send","queue",{...payload,content:"unapproved"}).status,"hold");
  const accept=msg(receiver,"receive","receive",{job:"photo"});
  assert.equal(advanceReview(db,accept).status,"received");
  db.close(); db=openExisting(file);
  assert.equal(advanceReview(db,accept).replayed,true);
  assert.equal(step(receiver,"duplicate","receive",{job:"photo"}).status,"already_received");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM publications").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM charges WHERE stage='first-use review work'").get().n,1);
  const inspected=step(bea,"read-back","read",{job:"photo"});
  assert.equal(inspected.content,"sunrise");assert.equal(inspected.basisDisputed,false);
  const late=note("spare-1",true,"refuse",3);
  assert.equal(step(bea,"dispute","observe",{pulse:"spare-1",receipt:late}).status,"hold");
  const oldRequest=msg(bea,"read-back","read",{job:"photo"});
  const beforeReplay=account(db).balance;
  const reread=advanceReview(db,oldRequest);
  assert.equal(reread.basisDisputed,true);
  assert.equal(reread.freshRead,true);
  assert.equal(beforeReplay-account(db).balance,3);
  db.prepare("UPDATE publications SET content=? WHERE job=?").run("different bytes","photo");
  assert.match(advanceReview(db,oldRequest).reason,/actual destination content/);
  db.prepare("UPDATE publications SET content=? WHERE job=?").run("sunrise","photo");
  assert.equal(advanceReview(db,oldRequest).content,"sunrise");
  assert.equal(step(alice,"second","queue",{...payload,job:"later"}).status,"queued");
  assert.equal(step(receiver,"block-disputed","receive",{job:"later"}).status,"hold");
  assert.equal(step(bea,"other","queue",{...payload,job:"private",claim:false}).status,"queued");
  assert.equal(step(receiver,"safe","receive",{job:"private"}).verdict,"refuse");
  assert.equal(step(bea,"check-private","read",{job:"private"}).content,null);
  assert.equal(step(root,"revoke-alice","revoke",{actor:alice.hex}).status,"revoked");
  assert.equal(advanceReview(db,queued).status,"hold");
  assert.equal(advanceReview(db,accept).status,"hold");
  assert.equal(step(bea,"check-again","read",{job:"photo"}).status,"hold");
  const billed=db.prepare("SELECT SUM(units) AS n FROM charges").get().n;
  assert.equal(account(db).balance+billed,terms.budget);
  assert.equal(account(db).revision,hash(["review-program/1",candidate.source]));
  const collision=join(directory,"same-label.sqlite");
  const oldDigest=detail.digest;
  const aliased={...terms,before:oldDigest};
  const opened=enroll(collision,root.hex,root.issue("enrollment",aliased));
  const alternate=openExisting(collision);
  try {
    const run=(identity,id,op,data)=>advanceReview(alternate,identity.issue("request",{binding:opened.binding,id,op,data}));
    for (const [i,result] of table.entries()) {
      const input={position:0,claim:Boolean(i)},pulse="p"+i;
      assert.equal(run(alice,pulse,"ask",input).status,"requested");
      const receipt=source.issue("observation",{binding:opened.binding,pulse,...input,...result});
      assert.equal(run(bea,"o"+i,"observe",{pulse,receipt}).status,"observed");
    }
    const c=run(alice,"first","form",{base:oldDigest});
    assert.equal(c.digest,oldDigest);
    const d={base:oldDigest,candidate:c.candidate,digest:c.digest};
    for (const [who,op,v] of [[alice,"offer","offered"],[root,"certify","preserved"],[root,"adopt","adopted"]]) {
      assert.equal(run(who,op,op,d).status,v);
    }
    assert.match(run(alice,"next","form",{base:oldDigest}).reason,/stale/);
    assert.match(run(alice,"old-source","ask",{position:0,claim:false}).reason,/no longer active/);
  } finally {alternate.close();}
  console.log("Funded checkout verified grants, signed measurements, priced-witness rejection, interruption, one effect and independent readback.");
} finally {
  db?.close();rmSync(directory,{recursive:true,force:true});
}
