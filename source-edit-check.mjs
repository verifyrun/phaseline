import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import * as current from "./current-source.mjs";
import {hash,signedBytes} from "./review-journal.mjs";

// Optionally supply the exact earlier package directory for an actual in-place upgrade.
const earlier=process.argv[2]?await import(pathToFileURL(join(resolve(process.argv[2]),"current-source.mjs"))):current;
function identity() {
  const {publicKey,privateKey}=generateKeyPairSync("ed25519");
  const key=publicKey.export({format:"der",type:"spki"}).subarray(-32).toString("hex");
  return {key,stamp:(kind,body)=>({key,body,signature:sign(null,signedBytes(kind,body),privateKey).toString("hex")})};
}
const root=mkdtempSync(join(tmpdir(),"owner-edits-"));
try {
  const path=join(root,"source.db"),source=identity(),reader=identity(),binding=hash("shop");
  const terms={binding,product:"mill",store:"screen",fields:["words"],sourceKey:source.key,receiverKey:reader.key,maxActive:5};
  earlier.createCurrentSource(path,terms);
  const parts=["guide","clock"].map(record=>({record,title:record,type:"Instruction",version:1,shared:true,fields:{words:record}}));
  for(const r of parts)assert.equal(earlier.putCurrentRecord(path,r).status,"written");
  function ticket(r,pulse) {
    return {status:"guarded_ticket",binding,store:"screen",job:"job-"+pulse,pulse,live:[{record:r.record,title:r.title,version:r.version,
      product:"mill",type:r.type,field:"words",valueDigest:hash(["current-field/1",r.fields.words]),sourceKey:source.key}]};
  }
  const req=t=>reader.stamp("current-request",current.liveRequest(t,source.key));
  const reserve=(t,service=current)=>service.reserveCurrentSource(path,req(t),source.stamp);
  const close=t=>current.settleCurrentSource(path,req(t),reader.stamp("checked-release",{
    ticketHash:hash(t),attempt:t.pulse,job:t.job,result:"basis_changed"}));
  const [guide,clock]=parts,a=ticket(guide,"one"),b=ticket(clock,"two");
  assert.equal(reserve(a,earlier).status,"reserved");
  const old=current.sourceEditBasis(path,"guide");
  assert.equal(current.putCurrentRecord(path,guide).status,"written");
  assert.equal(current.sourceEditBasis(path,"guide"),old);
  const hide={id:"hide",basis:old,record:{...guide,shared:false}};
  assert.deepEqual(current.requestSourceEdit(path,hide),{status:"edit_pending",edit:"hide",waitingFor:["one"]});
  assert.deepEqual(current.readSourceEdit(path,"hide").waitingFor,["one"]);
  assert.equal(current.putCurrentRecord(path,{...guide,version:2}).status,"hold");
  assert.equal(current.putCurrentRecord(path,guide).status,"written");
  assert.equal(reserve(ticket(guide,"new")).status,"hold");
  assert.equal(reserve(b).status,"reserved"); // unrelated work can continue
  assert.equal(current.putCurrentRecord(path,{...clock,record:"different",title:"Different"}).status,"written");
  if(process.argv[2]) {
    assert.throws(()=>reserve(ticket(guide,"old-writer"),earlier),/phaseline_priority_writer/);
    assert.throws(()=>earlier.putCurrentRecord(path,{...clock,record:"legacy",title:"Legacy"}),/phaseline_priority_writer/);
    assert.equal(earlier.readSourceState(path).pending,2);
  }
  assert.equal(close(a).status,"settled");
  assert.equal(current.readSourceEdit(path,"hide").status,"edit_applied");
  assert.equal(current.readSourceState(path).pending,1);
  assert.equal(current.currentField(path,{product:"mill",record:"guide",version:1,field:"words"},{binding,policy:"project-version/1"}).status,"missing");
  const restore={id:"restore",basis:current.sourceEditBasis(path,"guide"),record:guide};
  assert.equal(current.requestSourceEdit(path,restore).status,"edit_applied");
  assert.notEqual(current.sourceEditBasis(path,"guide"),old); // hide/restore at the same content version
  assert.equal(current.requestSourceEdit(path,{...hide,id:"obsolete-basis"}).status,"hold");
  assert.equal(current.requestSourceEdit(path,hide).status,"edit_applied"); // historical idempotent receipt
  assert.equal(current.readSourceState(path).records.find(r=>r.record==="guide").shared,1);
  const pause={id:"stop-sharing",basis:current.sourceEditBasis(path),sharing:false};
  assert.deepEqual(current.requestSourceEdit(path,pause).waitingFor,["two"]);
  assert.equal(reserve(ticket(guide,"when-paused")).status,"hold");
  assert.equal(close(b).status,"settled");
  assert.equal(current.readSourceState(path).shared,false);
  assert.equal(current.readSourceEdit(path,pause.id).status,"edit_applied");
  console.log("PASS: source owner priority, independent work, current audience, version-bound changes and cold recovery");
} finally {rmSync(root,{recursive:true,force:true});}
