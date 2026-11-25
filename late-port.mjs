// A concrete one-later return. The paid early pulse, decoder and later pulse
// must refer to the same enrolled source edition. Raw answers are never inferred.
import {debit,grant,hash,Hold,need,serial} from "./review-journal.mjs";
import {earlyRecord,oneLater,returnQuestion} from "./one-later.mjs";
import {expectedRuntime,sampleBinding} from "./behavior-port.mjs";

const exists=(db,name)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
const blocks=value=>Math.max(1,Math.ceil(Buffer.byteLength(value)/256));
function receipt(db,a,job,pulse,input,allowBatch=false) {
  need(grant(db,a.terms.receiverKey)==="receiver" && exists(db,"port_origins"),"the enrolled source or its protected receipt is unavailable");
  const row=db.prepare(`SELECT i.*,o.digest,o.disputed,t.actor,t.answer,s.rows FROM port_origins i
    JOIN operations t ON t.id=i.pulse JOIN receiver_observations o ON o.pulse=i.pulse
    LEFT JOIN port_samples s ON s.pulse=i.pulse WHERE i.job=? AND i.pulse=?`).get(job,pulse);
  need(row && grant(db,row.actor)==="operator" && row.runtime===expectedRuntime(db,job),"the paid inspection is no longer accessible for this edition");
  const ticket=JSON.parse(row.answer);
  need(allowBatch?ticket.behavior?.inputs.some(q=>serial(q)===serial(input)):serial(ticket.behavior?.inputs)===serial([input]),"the paid inspection must cover this named input under the granted reading contract");
  if(row.disputed){
    const missing=exists(db,"port_unlocalized") && db.prepare("SELECT 1 FROM port_unlocalized WHERE pulse=?").get(pulse);
    const conflict=exists(db,"port_disputes") && db.prepare("SELECT 1 FROM port_disputes WHERE pulse=? AND input=?").get(pulse,serial(input));
    need(!missing && !conflict,"the paid source reading is disputed");
  }
  return {row,ticket};
}
function answerAt(row,input,typed) {
  need(row.rows!==null && row.binding===sampleBinding(row.digest,row.pulse,row.job,row.runtime,row.snapshot,row.rows),
    "the purchased source rows are missing or no longer match the receipt");
  const cell=JSON.parse(row.rows).find(v=>serial(v.input)===serial(input));
  need(cell,"the paid inspection did not request this input");
  return cell.answer===null?{observed:false}:{observed:true,value:typed?cell.answer.value:cell.answer};
}
// An overlapping independent receipt must support the same warranted answer.
// Source raw rows can be removed once the original compact record is earned.
function reconcile(db,rid,origin,input,typed,accept) {
  const token=serial(input);
  const peers=db.prepare(`SELECT i.*,o.digest,o.disputed,t.answer,s.rows FROM port_origins i
    JOIN operations t ON t.id=i.pulse JOIN receiver_observations o ON o.pulse=i.pulse
    JOIN grants g ON g.key=t.actor LEFT JOIN port_samples s ON s.pulse=i.pulse
    WHERE g.active=1 AND i.job=? AND i.snapshot=? AND i.runtime=? AND i.pulse!=?`)
    .iterate(origin.job,origin.snapshot,origin.runtime,origin.pulse);
  for(const peer of peers) {
    debit(db,rid,"inspect competing receipt",peer.units);
    if(!JSON.parse(peer.answer).behavior.inputs.some(v=>serial(v)===token))continue;
    if(peer.disputed) {
      const general=exists(db,"port_unlocalized") && db.prepare("SELECT 1 FROM port_unlocalized WHERE pulse=?").get(peer.pulse);
      const local=exists(db,"port_disputes") && db.prepare("SELECT 1 FROM port_disputes WHERE pulse=? AND input=?").get(peer.pulse,token);
      need(!general && !local,"a competing receipt disputes this input");
    }
    const answer=answerAt(peer,input,typed);
    if(answer.observed)need(accept(answer.value),"a competing return observation disagrees");
  }
}
export function sourceValue(db,a,rid,job,pulse,input,allowBatch=false) {
  const {row,ticket}=receipt(db,a,job,pulse,input,allowBatch),typed=a.terms.behaviorPort.output==="exact-json/1";
  debit(db,rid,"read the funded source and check its provenance",row.units);
  const answer=answerAt(row,input,typed);
  need(answer.observed,"the source did not return an answer to this paid input");
  const value=answer.value;
  reconcile(db,rid,row,input,typed,v=>serial(v)===serial(value));
  return {row,ticket,value};
}
// The old donor can stop serving. Rely on a sealed historical reading and its
// still-current provenance; an independently obtained conflicting reading can defeat it.
export function supportHistorical(db,a,rid,job,pulse,input,origin,value,compatible=v=>serial(v)===serial(value)) {
  const {row}=receipt(db,a,job,pulse,input,true);
  debit(db,rid,"verify the retained historical source grant",row.units);
  need(row.digest===origin.receipt && row.runtime===origin.runtime && row.snapshot===origin.snapshot,
    "the historical dictionary no longer has the same source binding");
  reconcile(db,rid,row,input,true,compatible);
}
function canonicalCode(code,bits) {
  const out=Buffer.alloc(Math.ceil(bits/8));
  if(out.length)out.writeUIntBE(code,0,out.length);
  return out;
}
function binding(a,row,bytes) {
  return hash(["one-later-memory/1",a.binding,row.id,row.actor,row.job,row.pulse,row.snapshot,row.runtime,row.receipt,row.book,bytes.toString("hex")]);
}
function seal(db,a,request) {
  const d=request.body.data,rid=request.body.id,p=a.terms.behaviorPort,grant=p.late;
  need(hash(d.relation)===grant.relation && serial(d.relation.probes)===serial(grant.probes.map(v=>v.id)),
    "the submitted relation differs from the predecessor-approved decoder contract");
  debit(db,rid,"construct the fixed decoder",blocks(serial(d.relation))+Math.ceil(d.workAllowance/64));
  let plan;
  try {plan=oneLater(d.relation,{workLimit:d.workAllowance});}
  catch(e) {throw new Hold("Unsupported retained relation: "+e.message);}
  if(plan.status!=="minimum")return {status:"hold",cause:plan.status,reason:plan.reason,work:plan.work};
  const source=sourceValue(db,a,rid,d.job,d.pulse,grant.early),encoded=earlyRecord(plan,source.value);
  need(encoded.status==="encoded","the paid early observation falls outside the supplied relation");
  const text=serial(plan),book=hash(plan),bytes=canonicalCode(encoded.code,plan.payloadBits);
  const row={id:rid,actor:request.key,job:d.job,pulse:d.pulse,snapshot:source.row.snapshot,runtime:source.row.runtime,
    receipt:source.row.digest,book};
  db.exec(`CREATE TABLE IF NOT EXISTS late_books(book TEXT PRIMARY KEY,plan TEXT NOT NULL,units INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS late_memories(id TEXT PRIMARY KEY,actor TEXT NOT NULL,job TEXT NOT NULL,pulse TEXT NOT NULL,
    snapshot TEXT NOT NULL,runtime TEXT NOT NULL,receipt TEXT NOT NULL,book TEXT NOT NULL,bytes BLOB NOT NULL,binding TEXT NOT NULL)`);
  const fresh=!db.prepare("SELECT 1 FROM late_books WHERE book=?").get(book);
  debit(db,rid,"commit the decoder and issued record",(fresh?blocks(text):1)+blocks(serial(row))+blocks(bytes));
  if(fresh)db.prepare("INSERT INTO late_books VALUES(?,?,?)").run(book,text,blocks(text));
  db.prepare("INSERT INTO late_memories VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(rid,request.key,d.job,d.pulse,row.snapshot,row.runtime,row.receipt,book,bytes,binding(a,row,bytes));
  return {status:"memory_stored",memory:rid,job:d.job,snapshot:row.snapshot,payloadBits:plan.payloadBits,possibleRecords:plan.distinctRecords,
    decoderUnits:blocks(text),constructionWork:plan.work,scope:"one later declared source read for the same snapshot"};
}
function open(db,a,rid,job,memory,question) {
  need(exists(db,"late_memories"),"no enrolled single-read memory has been committed");
  const state=db.prepare("SELECT m.*,b.plan,b.units FROM late_memories m JOIN late_books b ON b.book=m.book WHERE m.job=? AND m.id=?").get(job,memory);
  need(state && grant(db,state.actor)==="operator","the single-read memory is unavailable under the active grant");
  debit(db,rid,"open the bound returning decoder",state.units+1);
  const plan=JSON.parse(state.plan),bytes=Buffer.from(state.bytes);
  need(hash(plan)===state.book && state.binding===binding(a,state,bytes),"the retained code or decoder binding changed");
  const code=bytes.length?bytes.readUIntBE(0,bytes.length):0,terms=a.terms.behaviorPort;
  const {row}=receipt(db,a,job,state.pulse,terms.late.early);
  need(row.digest===state.receipt && row.snapshot===state.snapshot && row.runtime===state.runtime,"the original observation changed");
  reconcile(db,rid,row,terms.late.early,terms.output==="exact-json/1",v=>earlyRecord(plan,v).code===code);
  return {state,plan,code,choice:returnQuestion(plan,code,question)};
}
export function returnTicket(db,a,request) {
  const {id:rid,data:d}=request.body,{memory,question}=d.returning;
  const {state,choice}=open(db,a,rid,d.job,memory,question);
  const pin=a.terms.behaviorPort.late.probes.find(x=>x.id===choice.probe);
  need(choice.status==="needs_observation" && pin && serial([pin.input])===serial(d.inputs),"the selected return channel differs from the authorized decoder");
  return {memory,question,probe:pin.id,snapshot:state.snapshot,runtime:state.runtime};
}
export function lateStep(db,a,request) {
  if(request.body.op==="pack_later")return seal(db,a,request);
  const {id:rid,data:d}=request.body,p=a.terms.behaviorPort;
  const {state,plan,code,choice}=open(db,a,rid,d.job,d.memory,d.question);
  if(choice.status==="hold")return choice;
  let answer=choice;
  if(choice.status==="needs_observation") {
    const route=p.late.probes.find(v=>v.id===choice.probe);
    if(!d.pulse)return {status:"needs_observation",probe:route.id,inputs:[route.input],snapshot:state.snapshot,
      returning:{memory:d.memory,question:d.question}};
    const {row,ticket,value}=sourceValue(db,a,rid,d.job,d.pulse,route.input);
    need(serial(ticket.returning??null)===serial({memory:d.memory,question:d.question,probe:route.id,snapshot:state.snapshot,runtime:state.runtime}),
      "the later reading was not purchased for this record and announced question");
    need(row.snapshot===state.snapshot && row.runtime===state.runtime,"the later reading belongs to a different snapshot or implementation");
    answer=returnQuestion(plan,code,d.question,{probe:route.id,value});
    if(answer.status!=="determined")return answer;
  } else need(!d.pulse,"a constant decoder accepts no later observation");
  debit(db,rid,"emit the earned one-read answer",blocks(serial(answer.value)));
  return {status:"historical_observation",memory:d.memory,job:d.job,question:d.question,snapshot:state.snapshot,
    lateReads:d.pulse?1:0,value:answer.value,scope:"predecessor-supplied relation on this observed edition"};
}
