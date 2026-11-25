import assert from "node:assert/strict";
import {mkdtempSync,rmSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {DatabaseSync} from "node:sqlite";
import {performance} from "node:perf_hooks";

const [kit=dirname(fileURLToPath(import.meta.url)),expected="snapshot"]=process.argv.slice(2);
const source=await import(pathToFileURL(join(resolve(kit),"current-source.mjs")));
const binding="a".repeat(64),q={product:"mill",field:"words"},ret={binding,policy:"project-version/1"};
const rows=[];
for(const journal of ["DELETE","WAL"]) {
 const root=mkdtempSync(join(tmpdir(),"concurrent-source-")),path=join(root,"source.db"),missing=join(root,"absent.db");
 let editor;
 try {
  source.createCurrentSource(path,{binding,product:"mill",store:"screen",fields:["words"],sourceKey:"b".repeat(64),receiverKey:"c".repeat(64),maxActive:4});
  const row={record:"guide",type:"Guide",title:"Onboarding",version:1,shared:true,fields:{words:"First edition."}};
  assert.equal(source.putCurrentRecord(path,row).status,"written");
  editor=new DatabaseSync(path);
  assert.equal(editor.prepare("PRAGMA journal_mode="+journal).get().journal_mode.toLowerCase(),journal.toLowerCase());
  const observed=()=>source.eligibleRankedRecords(path,q,ret,["guide"],3).map(r=>r.version);
  const native=()=>{const db=new DatabaseSync(path,{readOnly:true});try{return db.prepare("SELECT version FROM records WHERE shared=1 AND record=?").all("guide").map(r=>r.version);}finally{db.close();}};
  for(const change of ["rollback","withdraw","new-edition"]) {
   editor.exec("BEGIN IMMEDIATE");
   if(change==="new-edition")editor.prepare("UPDATE records SET version=2,title='Onboarding',fields=? WHERE record='guide'").run(JSON.stringify({words:"Second edition."}));
   else editor.exec("UPDATE records SET shared=0 WHERE record='guide'");
   const start=performance.now(),normal=native(),nativeMs=performance.now()-start;assert.deepEqual(normal,[1]);
   let got,reason=null;const then=performance.now();
   try {got=observed();}catch(e){reason=e.message;}
   const readMs=performance.now()-then;
   if(expected==="snapshot"){
     assert.equal(reason,null);assert.deepEqual(got,normal);
     assert.equal(source.currentCatalog(path,q,ret,1).rows[0].version,1);
     assert.equal(source.currentField(path,{...q,record:"guide",version:1},ret).value,"First edition.");
     assert.equal(source.readSourceState(path).pending,0);
   }else {assert.match(reason,/locked/);}
   editor.exec(change==="rollback"?"ROLLBACK":"COMMIT");
   const after=change==="withdraw"?[]:change==="new-edition"?[2]:[1];
   assert.deepEqual(observed(),after);assert.deepEqual(native(),after);
   if(change==="withdraw")assert.equal(source.putCurrentRecord(path,row).status,"written");
   if(change==="new-edition"){
     assert.equal(source.currentField(path,{...q,record:"guide",version:1},ret).status,"missing");
     assert.equal(source.currentField(path,{...q,record:"guide",version:2},ret).value,"Second edition.");
   }
   rows.push({journal,change,nativeBefore:normal,packageBefore:got??null,reason,nativeMs:+nativeMs.toFixed(3),packageMs:+readMs.toFixed(3),after});
  }
  assert.throws(()=>source.eligibleRankedRecords(path,q,{...ret,binding:"f".repeat(64)},["guide"],3));
  assert.throws(()=>source.eligibleRankedRecords(missing,q,ret,["guide"],3));assert.equal(existsSync(missing),false);
 } finally{editor?.close();rmSync(root,{recursive:true,force:true});}
}
console.log(JSON.stringify(rows,null,2));
