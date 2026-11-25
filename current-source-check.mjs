import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {hash,signedBytes} from "./review-journal.mjs";
import {confirmsCurrent,createCurrentSource,currentCatalog,currentField,liveRequest,putCurrentRecord,
  readSourceState,reserveCurrentSource,setSourceSharing,settleCurrentSource} from "./current-source.mjs";

function identity() {
  const {publicKey,privateKey}=generateKeyPairSync("ed25519");
  const key=publicKey.export({format:"der",type:"spki"}).subarray(-32).toString("hex");
  return {key,sign:(kind,body)=>({key,body,signature:sign(null,signedBytes(kind,body),privateKey).toString("hex")})};
}
const folder=mkdtempSync(join(tmpdir(),"phaseline-current-"));
try {
  const path=join(folder,"record.sqlite"),reader=identity(),source=identity(),binding=hash("subscription"),product="mill";
  const row={record:"manual",title:"Café gauge",type:"Procedure",version:1,shared:true,fields:{words:"Use blue."}};
  const obligation={product,record:row.record,type:row.type,title:"Cafe\u0301    gauge",version:1,field:"words",
    valueDigest:hash(["current-field/1","Use blue."]),sourceKey:source.key};
  createCurrentSource(path,{binding,store:"display",fields:["words"],product,sourceKey:source.key,receiverKey:reader.key,maxActive:2});
  assert.equal(putCurrentRecord(path,row).status,"written");
  const retention={binding,policy:"project-version/1"};
  const field={product,record:row.record,version:1,field:"words"};
  assert.equal(currentField(path,field,retention).value,"Use blue.");
  assert.equal(currentCatalog(path,{product,field:"words"},retention,10).rows.length,1);
  const ticket=pulse=>({status:"guarded_ticket",binding,store:"display",pulse,job:"show-"+pulse,live:[obligation]});
  const request=t=>reader.sign("current-request",liveRequest(t,source.key));
  const prep=t=>reserveCurrentSource(path,request(t),source.sign);
  const terminal=(t,result)=>reader.sign("checked-release",{ticketHash:hash(t),attempt:t.pulse,job:t.job,result});
  const close=(t,result)=>settleCurrentSource(path,request(t),terminal(t,result));
  const a=ticket("first"),b=ticket("second");
  const reservation=prep(a);
  assert.equal(reservation.status,"reserved");
  assert.deepEqual(prep(a),reservation);
  assert.equal(prep(a).status,"hold");
  assert.equal(readSourceState(path).pending,1);
  assert.ok(confirmsCurrent(a,[reservation.grant]));
  assert.equal(confirmsCurrent(b,[reservation.grant]),false);
  assert.equal(confirmsCurrent(a,[]),false);
  assert.equal(prep(b).status,"reserved");
  assert.equal(prep(ticket("capacity")).status,"hold");
  assert.equal(putCurrentRecord(path,{...row,record:"other",title:"Unrelated"}).status,"written");
  for(const change of [{...row,record:"duplicate"},{...row,version:2},{...row,shared:false}]) {
    assert.equal(putCurrentRecord(path,change).status,"hold");
    assert.equal(currentField(path,field,retention).value,"Use blue.");
  }
  assert.equal(setSourceSharing(path,false).status,"hold");
  assert.equal(close(a,"applied").status,"settled");
  assert.equal(readSourceState(path).pending,1);
  assert.equal(putCurrentRecord(path,{...row,shared:false}).status,"hold");
  assert.equal(close(b,"basis_changed").status,"settled");
  assert.equal(putCurrentRecord(path,{...row,shared:false}).status,"written");
  assert.equal(currentCatalog(path,{product,field:"words"},retention,10).rows.length,1);
  assert.equal(prep(ticket("no-longer-shared")).status,"hold");
  assert.equal(prep(a).status,"hold");
  const canceled=ticket("early-cancel");
  assert.equal(close(canceled,"basis_changed").status,"settled");
  assert.equal(prep(canceled).status,"hold");
  assert.equal(setSourceSharing(path,false).status,"written");
  assert.equal(currentField(path,field,retention).status,"denied");
  assert.equal(readSourceState(path).pending,0);
  console.log("PASS: two independent reservations, selected-field checks, bounded capacity, unrelated writes and terminal recovery");
} finally {rmSync(folder,{recursive:true,force:true});}
