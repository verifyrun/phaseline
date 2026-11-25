// A transient writer must get its configured wait before connection setup touches the schema.
import assert from "node:assert/strict";
import {fork} from "node:child_process";
import {once} from "node:events";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {fileURLToPath,pathToFileURL} from "node:url";
import {setTimeout as pause} from "node:timers/promises";
const file=fileURLToPath(import.meta.url);
if(process.argv[2]==="owner-lock"){
  const db=new DatabaseSync(process.argv[3]);
  try {
    db.exec("BEGIN EXCLUSIVE");
    process.send("ready");
    await once(process,"message");await pause(200);
    db.exec("COMMIT");
  } finally {db.close();process.disconnect();}
} else {
  const kit=process.argv[2]?resolve(process.argv[2]):dirname(file);
  const source=await import(pathToFileURL(join(kit,"current-source.mjs")));
  const dir=mkdtempSync(join(tmpdir(),"source-writer-")),path=join(dir,"db");
  let owner;
  try {
    source.createCurrentSource(path,{binding:"a".repeat(64),product:"mill",store:"display",fields:["words"],sourceKey:"b".repeat(64),receiverKey:"c".repeat(64),maxActive:4});
    owner=fork(file,["owner-lock",path],{stdio:["ignore","ignore","inherit","ipc"]});
    const end=once(owner,"exit");await once(owner,"message");
    owner.send("release-after-delay");
    const row={record:"guide",version:1,type:"Guide",title:"Guide",shared:true,fields:{words:"First."}};
    const write=()=>source.putCurrentRecord(path,row);
    if(process.argv[3]==="blocked")assert.throws(write,/locked/);
    else assert.equal(write().status,"written");
    await end;
    const before=source.readSourceState(path).records.length;
    assert.equal(before,process.argv[3]==="blocked"?0:1);
    assert.equal(write().status,"written");
    assert.equal(source.readSourceState(path).records.length,1);
    console.log("PASS: concurrent source writer and one durable first edition; rows before replay",before);
  } finally {if(owner?.connected)owner.kill();rmSync(dir,{recursive:true,force:true});}
}
