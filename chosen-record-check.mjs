import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import * as now from "./current-source.mjs";
import {validLookup} from "./record-catalog.mjs";
import {hash,signedBytes} from "./review-journal.mjs";

function principal() {
  const pair=generateKeyPairSync("ed25519");
  const key=pair.publicKey.export({format:"der",type:"spki"}).subarray(-32).toString("hex");
  return {key,stamp:(kind,body)=>({key,body,signature:sign(null,signedBytes(kind,body),pair.privateKey).toString("hex")})};
}
const original=process.argv[2]?await import(pathToFileURL(join(resolve(process.argv[2]),"current-source.mjs"))):now;
const dir=mkdtempSync(join(tmpdir(),"chosen-source-"));
try {
  const source=principal(),receiver=principal(),binding=hash("test/1"),store="wall";
  const path=join(dir,"source.db");
  const query={product:"plant",search:"Which instructions apply?",field:"text",time:"at_use",keep:"chosen_record"};
  assert.equal(validLookup(query),true);
  assert.equal(validLookup({...query,time:"at_lookup"}),false);
  if(process.argv[2]) {
    const older=await import(pathToFileURL(join(resolve(process.argv[2]),"record-catalog.mjs")));
    assert.equal(older.validLookup(query),false);
  }
  original.createCurrentSource(path,{binding,product:"plant",store,fields:["text"],sourceKey:source.key,receiverKey:receiver.key,maxActive:4});
  const row={record:"blue",title:"Guide",version:1,type:"Guide",shared:true,fields:{text:"Identical."}};
  const peer={...row,record:"red"};
  assert.equal(original.putCurrentRecord(path,row).status,"written");
  function request(attempt,mode) {
    const base={record:row.record,product:"plant",version:1,field:"text",sourceKey:source.key,valueDigest:hash(["current-field/1",row.fields.text])};
    const check=mode==="unique"?{...base,title:"Guide",type:"Guide"}:{...base,selection:"chosen_record"};
    const ticket={binding,store,job:"job-"+attempt,pulse:attempt,status:"guarded_ticket",live:[check]};
    return receiver.stamp("current-request",now.liveRequest(ticket,source.key));
  }
  const reserve=(r,writer=now)=>writer.reserveCurrentSource(path,r,source.stamp);
  const end=r=>now.settleCurrentSource(path,r,receiver.stamp("checked-release",{
    ticketHash:r.body.ticketHash,attempt:r.body.attempt,job:r.body.job,result:"applied"
  }));
  const before=request("before","unique");
  assert.equal(reserve(before,original).status,"reserved");
  assert.equal(now.seedCurrentRecords(path,binding,[peer]).status,"hold");
  assert.throws(()=>reserve(request("no-opt-in")),/cannot promise/);
  assert.throws(()=>now.enableChosenRecordUse(path,hash("wrong")),/different project/);
  assert.equal(now.enableChosenRecordUse(path,binding).status,"enabled");
  assert.equal(now.enableChosenRecordUse(path,binding).status,"enabled");
  assert.equal(now.readSourceState(path).pending,1);
  assert.equal(now.putCurrentRecord(path,peer).status,"hold"); // the earlier unique-title grant is still binding
  assert.equal(end(before).status,"settled");
  assert.equal(now.putCurrentRecord(path,peer).status,"written");
  assert.equal(reserve(request("ambiguous","unique")).status,"hold");
  const nominated=request("accepted");
  assert.equal(reserve(nominated).status,"reserved");
  assert.equal(now.putCurrentRecord(path,{...peer,version:2,fields:{text:"Other edition."}}).status,"written");
  assert.equal(now.putCurrentRecord(path,{...row,shared:false}).status,"hold");
  if(process.argv[2]) {
    assert.throws(()=>original.putCurrentRecord(path,{...peer,record:"legacy-active"}));
    assert.equal(original.readSourceState(path).pending,1);
  }
  assert.equal(end(nominated).status,"settled");
  if(process.argv[2]){
    assert.throws(()=>original.putCurrentRecord(path,{...peer,record:"legacy"}),/phaseline_chosen_record_writer/);
  }
  assert.equal(now.putCurrentRecord(path,{...row,shared:false}).status,"written");
  assert.equal(reserve(request("withdrawn")).status,"hold");
  assert.equal(now.putCurrentRecord(path,{...row,shared:true,version:2}).status,"written");
  assert.equal(reserve(request("old-edition")).status,"hold");
  console.log("PASS: explicit current choice, old uniqueness, scoped source upgrade, existing grants, audience and new edition");
} finally {rmSync(dir,{recursive:true,force:true});}
