// Historical reads from a priced, receiver-attested inspection. The physical donor
// need not be available. Current source behavior is a separate question.
import {debit,grant,hash,need,serial,Hold} from "./review-journal.mjs";
import {MemoryError,memoryCodebook,memoryMeter,encodeMemory,decodeMemory} from "./earned-memory.mjs";
import {expectedRuntime,validateProbe,sampleBinding} from "./behavior-port.mjs";

const hasTable=(db,name)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
const blocks=s=>Math.max(1,Math.ceil(Buffer.byteLength(s)/256));
function permitted(db,a,pulse) {
  need(grant(db,a.terms.receiverKey)==="receiver" && hasTable(db,"receiver_observations"),"the earned reading requires an active receiver and retained provenance");
  const receipt=db.prepare(`SELECT t.actor,o.disputed,o.digest FROM operations t
    JOIN receiver_observations o ON o.pulse=t.id WHERE t.id=?`).get(pulse);
  need(receipt && grant(db,receipt.actor)==="operator","the original funded inspection is unavailable under the current grants");
  return receipt;
}
function disputed(db,pulse,token) {
  return hasTable(db,"port_disputes") && db.prepare("SELECT 1 FROM port_disputes WHERE pulse=? AND input=?").get(pulse,token);
}
function scanUnits(db,job,anchor) {
  if (!hasTable(db,"port_origins")) return 0;
  return db.prepare("SELECT COALESCE(SUM(units),0) AS n FROM port_origins WHERE job=? AND snapshot=? AND runtime=? AND pulse!=?")
    .get(job,anchor.snapshot,anchor.runtime,anchor.pulse).n;
}
export function memoryCharge(db,a,op,d) {
  const p=a.terms.behaviorPort;
  need(p?.memory,"the predecessor did not grant an earned-memory port");
  let price=1+blocks(serial(p))+Math.ceil(d.workAllowance/64);
  if (op==="pack_memory" && hasTable(db,"port_samples")) {
    price+=db.prepare("SELECT units FROM port_samples WHERE pulse=? AND job=?").get(d.pulse,d.job)?.units??0;
  } else if (op==="recall_memory") {
    const memory=hasTable(db,"port_memories") && db.prepare("SELECT units,pulse,snapshot,runtime FROM port_memories WHERE id=? AND job=?").get(d.memory,d.job);
    if (memory) price+=memory.units+scanUnits(db,d.job,memory);
  }
  return price;
}
function payloadBinding(a,row,bytes) {
  return hash(["earned-memory/1",a.binding,row.id,row.actor,row.job,row.pulse,row.snapshot,row.runtime,row.receipt,bytes.toString("hex")]);
}
function bookFor(port,meter) {return memoryCodebook(port.inputs.length,port.memory.alphabet.length,port.memory.capacity,meter);}
function store(db,a,r,p,book,meter) {
  const d=r.body.data,receipt=permitted(db,a,d.pulse);
  need(hasTable(db,"port_samples"),"missing signed observation on the requested job");
  const raw=db.prepare("SELECT job,snapshot,implementation,rows FROM port_samples WHERE pulse=? AND job=?").get(d.pulse,d.job);
  need(raw && raw.implementation===expectedRuntime(db,d.job),"missing observation of the intended running edition");
  const origin=hasTable(db,"port_origins") && db.prepare("SELECT binding FROM port_origins WHERE pulse=?").get(d.pulse);
  need(origin && origin.binding===sampleBinding(receipt.digest,d.pulse,d.job,raw.implementation,raw.snapshot,raw.rows),
    "the retained source rows no longer match the paid receipt");
  meter.charge(p.inputs.length+p.memory.alphabet.length);
  const positions=new Map(p.inputs.map((x,i)=>[serial(x),i]));
  const labels=new Map(p.memory.alphabet.map((v,i)=>[serial(v),i]));
  const values=[];
  for (const {input,answer} of JSON.parse(raw.rows)) {
    meter.charge();const token=serial(input);
    if (answer===null || (receipt.disputed && disputed(db,d.pulse,token))) continue;
    const label=labels.get(serial(p.output==="exact-json/1"?answer.value:answer));
    need(positions.has(token) && label!==undefined,"an observed key or value falls outside the granted memory alphabet");
    values.push([positions.get(token),label]);
  }
  const bytes=encodeMemory(book,values,meter);
  const row={id:r.body.id,actor:r.key,job:d.job,pulse:d.pulse,snapshot:raw.snapshot,runtime:raw.implementation,receipt:receipt.digest};
  const digest=payloadBinding(a,row,bytes);
  const units=1+blocks(serial(row))+blocks(bytes);
  debit(db,r.body.id,"bind and retain earned observation memory",units);
  db.exec(`CREATE TABLE IF NOT EXISTS port_memories(
    id TEXT PRIMARY KEY,actor TEXT NOT NULL,job TEXT NOT NULL REFERENCES jobs(id),pulse TEXT NOT NULL,
    snapshot TEXT NOT NULL,runtime TEXT NOT NULL,receipt TEXT NOT NULL,bytes BLOB NOT NULL,
    digest TEXT NOT NULL,units INTEGER NOT NULL,invalid INTEGER NOT NULL DEFAULT 0)`);
  db.prepare("INSERT INTO port_memories(id,actor,job,pulse,snapshot,runtime,receipt,bytes,digest,units) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(row.id,row.actor,row.job,row.pulse,row.snapshot,row.runtime,row.receipt,bytes,digest,units);
  return {status:"memory_stored",memory:row.id,job:row.job,pulse:row.pulse,snapshot:row.snapshot,payloadBits:book.bits,
    payloadBytes:bytes.length,possibleMaps:book.states.toString(),represented:values.length,computationUsed:meter.used,
    metadataUnits:units,scope:"named historical receiver inspection"};
}
function competing(db,record,input,wanted,p,meter) {
  if (!hasTable(db,"port_origins"))return false;
  const others=db.prepare(`SELECT i.pulse,i.binding,i.runtime,i.snapshot,i.job,s.rows,o.disputed,o.digest,t.answer
    FROM port_origins i JOIN receiver_observations o ON o.pulse=i.pulse
    JOIN operations t ON t.id=i.pulse JOIN grants g ON g.key=t.actor
    LEFT JOIN port_samples s ON s.pulse=i.pulse
    WHERE g.active=1 AND i.job=? AND i.snapshot=? AND i.runtime=? AND i.pulse!=?`)
    .iterate(record.job,record.snapshot,record.runtime,record.pulse);
  for (const other of others) {
    const probe=JSON.parse(other.answer).behavior;
    meter.charge(probe.inputs.length);
    if (!probe.inputs.some(v=>serial(v)===input)) continue;
    need(other.rows!==null && other.binding===sampleBinding(other.digest,other.pulse,other.job,other.runtime,other.snapshot,other.rows),
      "another funded reading of this input has unavailable source rows");
    if (other.disputed && disputed(db,other.pulse,input)) return true;
    for (const row of JSON.parse(other.rows)) {
      meter.charge();
      if (serial(row.input)!==input || row.answer===null)continue;
      if (serial(p.output==="exact-json/1"?row.answer.value:row.answer)!==wanted) return true;
    }
  }
  return false;
}
function recall(db,a,r,p,book,meter) {
  const d=r.body.data;
  validateProbe(p,[d.input]);
  need(hasTable(db,"port_memories"),"no retained earned memory");
  const row=db.prepare("SELECT * FROM port_memories WHERE id=? AND job=?").get(d.memory,d.job);
  need(row && grant(db,row.actor)==="operator" && row.runtime===expectedRuntime(db,d.job),"memory unavailable under the requested job or grant");
  const receipt=permitted(db,a,row.pulse);
  const bytes=Buffer.from(row.bytes);
  need(payloadBinding(a,row,bytes)===row.digest && row.receipt===receipt.digest,"retained bytes or provenance binding changed");
  const token=serial(d.input);
  need(!row.invalid && !(receipt.disputed && disputed(db,row.pulse,token)),"the original source reading is disputed");
  meter.charge(p.inputs.length);
  const target=BigInt(p.inputs.findIndex(x=>serial(x)===token));
  const earned=decodeMemory(book,bytes,meter).find(([k])=>k===target);
  const common={job:row.job,pulse:row.pulse,memory:row.id,snapshot:row.snapshot,scope:"named historical receiver inspection"};
  if (!earned)return {...common,status:"hold",reason:"no earned answer for this input",computationUsed:meter.used};
  const value=p.memory.alphabet[Number(earned[1])];
  need(!competing(db,row,token,serial(value),p,meter),"another funded reading of this snapshot conflicts with the earned answer");
  debit(db,r.body.id,"emit historical observed value",blocks(serial(value)));
  return {...common,status:"historical_observation",value,computationUsed:meter.used};
}
export function memoryStep(db,a,r) {
  const port=a.terms.behaviorPort;
  need(port?.memory,"the predecessor did not grant an earned-memory port");
  const meter=memoryMeter(r.body.data.workAllowance);
  try {
    const book=bookFor(port,meter);
    return r.body.op==="pack_memory"?store(db,a,r,port,book,meter):recall(db,a,r,port,book,meter);
  } catch(e) {
    if (e instanceof MemoryError) throw new Hold(e.message);
    throw e;
  }
}
